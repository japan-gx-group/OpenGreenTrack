// 排出係数CSVインポートの純関数ロジック（UIから分離してテスト可能にする）。
//
// 対象フォーマットは排出係数管理画面のCSVエクスポート（Factors.client.tsx の handleExportCSV）と
// 同じ列構成。エクスポート→Excel等で編集→インポートのラウンドトリップを想定する。
// エクスポート（lib/files/csv.ts の downloadCsv）は UTF-16LE + タブ区切りで出力するが、
// Excel で再保存すると UTF-8 / Shift_JIS のカンマ区切りになることが多いため、
// 文字コード・区切り文字の両方を自動判別する。
//
// 取込ルール:
// - 既存係数と「重複」する行 → 値が変わっていれば更新、変わっていなければスキップ
// - 重複しない行 → 新規追加
// - 重複判定キーは係数解決ロジック（calculation/engine/resolveEmissionFactor.ts）の
//   前提フィルタに合わせて「エネルギー種別 + 適用年度 + Scope + 事業者/メニュー/係数種別」とする。
//   DB側でも V-FAC-002 として、自組織の active カスタム係数は同条件1件に制限する。
// - RLS 上、標準係数（isCustom=false）は authenticated から更新できないため、
//   インポートで登録・更新するのは常にカスタム係数（isCustom=true・データソース「自社設定」）。
//   標準係数と重複し値が同じ行はスキップ、値を変えた行は「カスタム係数として新規追加」する
//   （算定エンジンはカスタム係数を標準係数より優先するため、上書きとして機能する）。
//   ただし同じキーのカスタム上書きが既にあれば二重に追加せずそのカスタム係数を更新する
//   （毎回新規追加を試みると、再取込のたびに V-FAC-002 違反で恒久的にエラーになる）。
// - 事業者別係数（供給事業者・メニュー・係数種別を持つ標準係数）は上書き対象外。
//   インポートで作るカスタム係数は事業者に紐付かず組織全体（tier 3）に適用されるため、
//   1事業者の係数を直したつもりが全レコードの係数を静かに差し替えてしまう。
//   未編集の行はスキップし、値を変えた行・事業者列を持つ新規行は明示的なエラーにする。

import { decodeCsvBufferAllowingUtf16, splitCsvLine } from '@/lib/files/csv';
import {
  ENERGY_VALUE_BY_LABEL,
  SCOPE_VALUE_BY_LABEL,
  STATUS_VALUE_BY_LABEL,
  scopeLabelForEnergyLabel,
  type EmissionFactor,
} from './factorService';

/** CSVエクスポートと同一のヘッダー列（この並びで一致しない場合は取込を中止する） */
export const FACTOR_CSV_HEADERS = [
  'ID', '係数名', 'エネルギー種別', '適用範囲', '係数値', '単位', '適用年度',
  '供給事業者', 'メニュー', '係数種別', 'データソース', 'ステータス', 'カスタム区分', '出典資料名', '出典URL',
] as const;

/**
 * エクスポート1行ぶんのセル。列の並びは FACTOR_CSV_HEADERS と一対一で対応させる。
 * ヘッダーと出力行を同じファイルに置き、片方だけ列が増減してラウンドトリップが
 * 壊れるのを防ぐ（実際に「ステータス」列が出力から欠けていた）。
 */
export const factorToCsvRow = (factor: EmissionFactor): (string | number)[] => [
  factor.id,
  factor.name,
  factor.energyType,
  factor.scope,
  factor.factorValue,
  factor.unit,
  factor.applicableYear,
  factor.providerName ?? '',
  factor.menuName ?? '',
  factor.factorType ?? '',
  factor.source,
  factor.status,
  factor.isCustom ? 'カスタム' : '標準',
  factor.sourceDocument ?? '',
  factor.sourceUrl ?? '',
];

/** 行単位のエラー（row はヘッダー行を含むファイル内の1始まり行番号） */
export interface FactorImportRowError {
  row: number;
  reasons: string[];
}

/** 新規追加アクション */
export interface FactorImportCreate {
  row: number;
  factor: Omit<EmissionFactor, 'id'>;
}

/** 既存カスタム係数の更新アクション */
export interface FactorImportUpdate {
  row: number;
  targetId: string;
  factor: Omit<EmissionFactor, 'id'>;
}

export interface FactorImportPlan {
  creates: FactorImportCreate[];
  updates: FactorImportUpdate[];
  skipCount: number;
  errors: FactorImportRowError[];
}

// CSVから読み取った1行分の係数値（ID列は既存行の特定にのみ使う）
interface ParsedFactorRow {
  row: number;
  id: string;
  /**
   * 供給事業者・メニュー・係数種別の列（空文字 = 未指定）。
   * factor には載せない（カスタム係数は事業者に紐付かない）が、事業者別係数の行を見分けて
   * 既存の標準係数へ照合するために保持する。
   */
  providerColumns: ProviderColumns;
  factor: Omit<EmissionFactor, 'id'>;
}

/** 事業者別係数の行を追加・上書きしようとしたときのエラー理由（確認モーダルに行番号つきで表示される） */
export const PROVIDER_FACTOR_IMPORT_ERROR =
  '事業者別係数（供給事業者・メニュー・係数種別のある行）はCSVからの上書き・追加に対応していません。組織全体に適用するカスタム係数として登録する場合は、ID・供給事業者・メニュー・係数種別を空にしてください';

// エクスポートのフォーミュラインジェクション対策（=+-@ 始まりの値へ ' を前置）を復元する。
// Excel を経由せず直接再インポートした場合でも元の値へ戻るようにする。
const unescapeFormulaGuard = (value: string): string => value.replace(/^'(?=[=+\-@])/, '');

// 拠点CSVインポートと共通の実装（@/lib/files/csv）。名前は既存の呼び出し元のまま残す。
export const decodeFactorCsvBuffer = decodeCsvBufferAllowingUtf16;

/** 重複判定キーを構成する項目。既存係数（EmissionFactor）と CSV 行（factor + providerColumns）の両方から組み立てる。 */
type ResolutionKeyFields = Pick<EmissionFactor, 'energyType' | 'applicableYear' | 'scope'> & {
  providerName?: string;
  menuName?: string;
  factorType?: string;
};

/** 事業者別係数の識別列（供給事業者・メニュー・係数種別）。未設定は空文字に正規化する。 */
type ProviderColumns = { providerName: string; menuName: string; factorType: string };

// 既存係数から事業者列を取り出す。DB の null（→ undefined）と空文字を区別しないことで、
// 「providerName が null か空文字か」に判定が依存しないようにする（エクスポートも両方 '' で出力する）。
const providerColumnsOf = (factor: ResolutionKeyFields): ProviderColumns => ({
  providerName: factor.providerName ?? '',
  menuName: factor.menuName ?? '',
  factorType: factor.factorType ?? '',
});

// 事業者別係数か（識別列のいずれかに値があるか）。CSV 行と既存係数の両方に同じ基準を使う。
const hasProviderColumns = (columns: ProviderColumns): boolean =>
  Object.values(columns).some(value => value !== '');

const providerColumnsEqual = (a: ProviderColumns, b: ProviderColumns): boolean =>
  a.providerName === b.providerName && a.menuName === b.menuName && a.factorType === b.factorType;

// 重複判定キー。resolveEmissionFactor の前提フィルタ（energyType / applicableYear）+ Scope に
// 事業者別係数の識別列（供給事業者・メニュー・係数種別）を加えたもの。
// インポートで作るのは常にカスタム係数（事業者列は空）のため、追加・更新の判定は実質「種別+年度+Scope」。
// 事業者列は、エクスポートした事業者別係数の行を（ID が未知でも）同じ標準係数へ照合するために使う。
// \u0000 は値に現れない区切り文字として使う。
const resolutionKey = (factor: ResolutionKeyFields): string =>
  [
    factor.energyType,
    factor.applicableYear,
    factor.scope,
    factor.providerName ?? '',
    factor.menuName ?? '',
    factor.factorType ?? '',
  ].join('\u0000');

// 「値が変わっているか」の比較対象フィールド。キー4項目以外でCSVから取り込む値を比べる。
// データソース・カスタム区分の列は比較しない（インポートでは常に自社設定/カスタム扱いのため）。
const valuesEqual = (
  a: Omit<EmissionFactor, 'id'>,
  b: Pick<EmissionFactor, 'name' | 'factorValue' | 'unit' | 'status' | 'sourceDocument' | 'sourceUrl'>,
): boolean =>
  a.name === b.name &&
  a.factorValue === b.factorValue &&
  a.unit === b.unit &&
  a.status === b.status &&
  (a.sourceDocument ?? '') === (b.sourceDocument ?? '') &&
  (a.sourceUrl ?? '') === (b.sourceUrl ?? '');

// 旧ラベルの読み替え。通勤係数（business_travel_commuting）はかつて「出張・通勤」と表示・出力していた
// （「通勤」に改名済み）ため、改名前にエクスポートした CSV をそのまま再取込できるようにする。
const LEGACY_ENERGY_LABEL_ALIASES: Record<string, EmissionFactor['energyType']> = {
  '出張・通勤': '通勤',
};

const normalizeEnergyLabel = (value: string): string =>
  LEGACY_ENERGY_LABEL_ALIASES[value] ?? value;

const isValidEnergyType = (value: string): value is EmissionFactor['energyType'] =>
  value in ENERGY_VALUE_BY_LABEL;

const isValidScope = (value: string): value is EmissionFactor['scope'] =>
  value in SCOPE_VALUE_BY_LABEL;

const isValidStatus = (value: string): value is EmissionFactor['status'] =>
  value in STATUS_VALUE_BY_LABEL;

/**
 * CSVテキストをパースして行ごとの係数値とバリデーションエラーへ変換する。
 * ヘッダー不一致・空ファイルはファイル全体のエラーとして throw する。
 */
export const parseFactorCsvText = (
  text: string,
): { rows: ParsedFactorRow[]; errors: FactorImportRowError[] } => {
  // デコーダがBOMを残した場合に備えて除去する
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  if (lines.length === 0 || !lines[0].trim()) {
    throw new Error('CSVファイルが空です。');
  }

  // 区切り文字の自動判別: エクスポート直後はタブ区切り、Excelで再保存するとカンマ区切りになる
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitCsvLine(lines[0].trim(), delimiter).map(col => col.trim());

  if (
    headers.length !== FACTOR_CSV_HEADERS.length ||
    !headers.every((h, idx) => h === FACTOR_CSV_HEADERS[idx])
  ) {
    throw new Error(
      'CSVファイルのヘッダー列が一致しません。排出係数管理画面のCSVエクスポートと同じ列構成（ID, 係数名, エネルギー種別, 適用範囲, 係数値, 単位, 適用年度, 供給事業者, メニュー, 係数種別, データソース, ステータス, カスタム区分, 出典資料名, 出典URL）を使用してください。',
    );
  }

  const rows: ParsedFactorRow[] = [];
  const errors: FactorImportRowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    // 行全体を trim すると「末尾列が空のタブ区切り行」の区切り文字まで消えて列数が狂うため、
    // 行はそのまま分割し、各フィールド側で trim する。
    const line = lines[i];
    if (!line.trim()) continue;

    const columns = splitCsvLine(line, delimiter).map(col => unescapeFormulaGuard(col.trim()));

    // 区切り文字だけの空行（Excelが末尾に残しがち）はスキップする
    if (columns.every(col => col === '')) continue;

    const rowNumber = i + 1;

    if (columns.length < FACTOR_CSV_HEADERS.length) {
      errors.push({
        row: rowNumber,
        reasons: [`列数が足りません（${FACTOR_CSV_HEADERS.length}列必要ですが、${columns.length}列のみです）`],
      });
      continue;
    }

    // 列: 0=ID, 1=係数名, 2=エネルギー種別, 3=適用範囲, 4=係数値, 5=単位, 6=適用年度,
    //     7=供給事業者, 8=メニュー, 9=係数種別, 10=データソース, 11=ステータス, 12=カスタム区分,
    //     13=出典資料名, 14=出典URL
    // データソース(10)・カスタム区分(12)は読み飛ばす（インポートでは常に「自社設定のカスタム係数」として扱うため）。
    // 供給事業者(7)・メニュー(8)・係数種別(9)は係数の値としては取り込まないが、
    // 事業者別係数の行の識別と既存係数との照合に使うため providerColumns として保持する。
    const [id, name, rawEnergyType, scope, factorValueStr, unit, yearStr, providerName, menuName, factorType, , status, , sourceDocument, sourceUrl] = columns;
    const energyType = normalizeEnergyLabel(rawEnergyType);

    const reasons: string[] = [];

    if (!name) reasons.push('係数名が空欄です');
    if (!isValidEnergyType(energyType)) {
      reasons.push(`エネルギー種別「${rawEnergyType}」は認識できません`);
    }
    if (!isValidScope(scope)) {
      reasons.push(`適用範囲「${scope}」は認識できません（Scope 1 / Scope 2 / Scope 3）`);
    } else if (isValidEnergyType(energyType) && scope !== scopeLabelForEnergyLabel(energyType)) {
      // 種別と食い違う Scope を取り込ませない。集計は係数の Scope で積むのに対しレポートの
      // データ充足状況は種別から Scope を判定するため、食い違うと同じ排出量がどの集計にも
      // 載らないまま「算定済み」と数えられる（calculation/engine/energyTypeScope.ts）。
      reasons.push(
        `適用範囲「${scope}」はエネルギー種別「${energyType}」と一致しません（${scopeLabelForEnergyLabel(energyType)}）`,
      );
    }

    // 桁区切りカンマ・空白のみ除去し、厳密なパターンで検証する（数値以外を通さない方針）
    const cleanFactorValue = factorValueStr.replace(/[,\s]/g, '');
    const isValidFactorValue = /^\d+(\.\d+)?$/.test(cleanFactorValue);
    if (!isValidFactorValue) {
      reasons.push(`係数値「${factorValueStr}」は0以上の数値として正しくありません`);
    }

    if (!unit) reasons.push('単位が空欄です');

    const cleanYear = yearStr.replace(/[,\s]/g, '');
    if (!/^\d{4}$/.test(cleanYear)) {
      reasons.push(`適用年度「${yearStr}」は4桁の西暦年として正しくありません`);
    }

    if (!isValidStatus(status)) {
      reasons.push(`ステータス「${status}」は認識できません（有効 / 確認中 / 下書き / アーカイブ済み）`);
    }

    if (reasons.length > 0) {
      errors.push({ row: rowNumber, reasons });
      continue;
    }

    rows.push({
      row: rowNumber,
      id,
      providerColumns: { providerName, menuName, factorType },
      factor: {
        name,
        energyType: energyType as EmissionFactor['energyType'],
        scope: scope as EmissionFactor['scope'],
        factorValue: parseFloat(cleanFactorValue),
        unit,
        applicableYear: parseInt(cleanYear, 10),
        // カスタム係数は地域概念を持たない（regionName は既定の「全国」で保存する）。
        region: '全国',
        source: '自社設定',
        status: status as EmissionFactor['status'],
        isCustom: true,
        sourceDocument: sourceDocument || undefined,
        sourceUrl: sourceUrl || undefined,
      },
    });
  }

  return { rows, errors };
};

/**
 * CSVテキストと既存係数一覧から取込プラン（追加・更新・スキップ・エラー）を組み立てる。
 * DBアクセスは行わない純関数。実際の insert/update は呼び出し側（UI）が
 * factorService の addEmissionFactor / updateEmissionFactor で実行する。
 */
export const buildFactorImportPlan = (
  text: string,
  existingFactors: EmissionFactor[],
): FactorImportPlan => {
  const { rows, errors } = parseFactorCsvText(text);

  const creates: FactorImportCreate[] = [];
  const updates: FactorImportUpdate[] = [];
  let skipCount = 0;

  const byId = new Map(existingFactors.map(factor => [factor.id, factor]));
  const byKey = new Map<string, EmissionFactor[]>();
  for (const factor of existingFactors) {
    const key = resolutionKey(factor);
    const group = byKey.get(key);
    if (group) {
      group.push(factor);
    } else {
      byKey.set(key, [factor]);
    }
  }

  // CSV内の重複（同一キーの新規行が複数、同一係数への更新が複数）を検出するための作業領域
  const plannedCreatesByKey = new Map<string, Omit<EmissionFactor, 'id'>>();
  const plannedUpdatesById = new Map<string, Omit<EmissionFactor, 'id'>>();

  const planCreate = (row: ParsedFactorRow, key: string): void => {
    const planned = plannedCreatesByKey.get(key);
    if (planned) {
      // 同一キーの新規行がCSV内に複数ある場合、同値ならスキップ・異なる値ならエラーにする
      // （両方追加すると係数解決が不安定になる重複データを作ってしまうため）
      if (valuesEqual(row.factor, planned)) {
        skipCount++;
      } else {
        errors.push({
          row: row.row,
          reasons: ['CSV内に同一キー（エネルギー種別・適用年度・Scope・供給事業者・メニュー・係数種別）の行が複数あります。1行にまとめてください'],
        });
      }
      return;
    }
    plannedCreatesByKey.set(key, row.factor);
    creates.push({ row: row.row, factor: row.factor });
  };

  const planUpdate = (row: ParsedFactorRow, target: EmissionFactor): void => {
    if (valuesEqual(row.factor, target)) {
      skipCount++;
      return;
    }
    const planned = plannedUpdatesById.get(target.id);
    if (planned) {
      if (valuesEqual(row.factor, planned)) {
        skipCount++;
      } else {
        errors.push({
          row: row.row,
          reasons: [`同じ係数「${target.name}」を複数の行が異なる内容で更新しようとしています`],
        });
      }
      return;
    }
    // CSVに列が無い有効期間（effectiveFrom/To）は更新で消さないよう既存値を引き継ぐ
    const factor: Omit<EmissionFactor, 'id'> = {
      ...row.factor,
      effectiveFrom: target.effectiveFrom,
      effectiveTo: target.effectiveTo,
    };
    plannedUpdatesById.set(target.id, row.factor);
    updates.push({ row: row.row, targetId: target.id, factor });
  };

  for (const row of rows) {
    const key = resolutionKey({ ...row.factor, ...row.providerColumns });

    // 1) ID列が既存係数と一致すればそれを対象にする（同一キーの係数が複数ある場合の特定手段）。
    //    別環境からのCSVなどで未知のIDならキー照合へフォールバックする。
    const idTarget = row.id ? byId.get(row.id) : undefined;

    // 事業者別係数の行（ID が事業者別係数を指す、または事業者列に値がある）は上書き対象外。
    // 未編集のラウンドトリップ行だけスキップし、それ以外は組織全体へ静かに適用される前に弾く。
    // 「未編集」は係数値だけでなく事業者列も含めて判定する: 事業者列は取込先が無く保存できないため、
    // 事業者名やメニューだけ書き換えた行を「変更なし」として黙って握りつぶさず、同じエラーで知らせる
    // （ID 無しの行はキーに事業者列が含まれるので、キー一致＝事業者列一致）。
    const isProviderRow =
      (idTarget !== undefined && hasProviderColumns(providerColumnsOf(idTarget))) ||
      hasProviderColumns(row.providerColumns);
    if (isProviderRow) {
      const unchanged = idTarget
        ? valuesEqual(row.factor, idTarget) &&
          providerColumnsEqual(row.providerColumns, providerColumnsOf(idTarget))
        : (byKey.get(key) ?? []).some(factor => valuesEqual(row.factor, factor));
      if (unchanged) {
        skipCount++;
      } else {
        errors.push({ row: row.row, reasons: [PROVIDER_FACTOR_IMPORT_ERROR] });
      }
      continue;
    }

    if (idTarget?.isCustom) {
      planUpdate(row, idTarget);
      continue;
    }
    if (idTarget && valuesEqual(row.factor, idTarget)) {
      // 標準係数の行が未編集のまま → 何もしない
      skipCount++;
      continue;
    }
    // ここに来る ID 一致行は「値を変えた標準係数」。RLS 上その標準係数は更新できないため
    // カスタム係数で上書きするが、同じキーのカスタム上書きが既にあれば（前回の取込で作成済み）
    // 新規追加ではなくそのカスタム係数の更新に振り替える。判定はキー照合と同じなので 2) に合流する。

    // 2) キー照合。カスタム係数を優先的に「重複」とみなす
    //    （算定エンジンもカスタム係数を標準係数より優先するため）。
    const candidates = byKey.get(key) ?? [];
    const customCandidates = candidates.filter(factor => factor.isCustom);

    if (customCandidates.length === 1) {
      planUpdate(row, customCandidates[0]);
      continue;
    }

    if (customCandidates.length > 1) {
      const identical = customCandidates.find(factor => valuesEqual(row.factor, factor));
      if (identical) {
        skipCount++;
      } else {
        errors.push({
          row: row.row,
          reasons: ['同一キー（エネルギー種別・適用年度・Scope・供給事業者・メニュー・係数種別）のカスタム係数が複数登録されているため、更新対象を特定できません。ID列で対象を指定してください'],
        });
      }
      continue;
    }

    // カスタム係数の重複なし。標準係数と同値ならスキップ、それ以外は新規追加
    if (candidates.some(factor => valuesEqual(row.factor, factor))) {
      skipCount++;
      continue;
    }

    planCreate(row, key);
  }

  return { creates, updates, skipCount, errors };
};
