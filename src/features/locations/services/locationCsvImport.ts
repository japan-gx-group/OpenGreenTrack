// 拠点CSVインポートの純関数ロジック（UIから分離してテスト可能にする）。
//
// 対象フォーマットは拠点管理画面のCSVエクスポート（Locations.client.tsx の handleExportCSV）と
// 同じ列構成。エクスポート→Excel等で編集→インポートのラウンドトリップと、
// テンプレートからの新規一括登録の両方を想定する。
// 排出係数CSVインポート（factors/services/factorCsvImport.ts）と同じ作法に揃えてある。
//
// 取込ルール:
// - ID列が既存拠点と一致 → その拠点を更新（内容が同じならスキップ）
// - ID列が空・未知 → 拠点名で照合。1件だけ一致すれば更新、複数一致ならエラー、無ければ新規追加
// - 拠点名で照合するのは、テンプレートから作ったCSV（ID列が空）でも
//   同じ拠点を二重登録しないため。DBに (organizationId, name) の一意制約は無いため、
//   同名拠点が既に複数ある場合だけはID列での指定を求める。
// - ID列が空で拠点名が「（記入例）」で始まる行はテンプレートの記入例とみなして取り込まない

import { decodeCsvBufferAllowingUtf16, splitCsvLine } from '@/lib/files/csv';
import { validateLocationNameAndPerson } from './locationValidation';
import {
  LOCATION_STATUS_LABELS,
  LOCATION_TYPE_LABELS,
  REGION_LABELS,
  type LocationRecord,
  type LocationStatus,
  type LocationType,
  type NewLocationInput,
  type Region,
} from '../types';

/** CSVエクスポートと同一のヘッダー列（この並びで一致しない場合は取込を中止する） */
export const LOCATION_CSV_HEADERS = [
  'ID', '拠点名', '地域', '拠点種別', '担当者', '稼働状況',
] as const;

/**
 * 「Scope対象区分」列を含むヘッダー列。この列はもう使わないが、この並びのファイルも
 * 受け付けて Scope対象区分の列だけ読み飛ばす（値は何にも使わない）。
 */
const LEGACY_LOCATION_CSV_HEADERS = [
  'ID', '拠点名', '地域', '拠点種別', '担当者', 'Scope対象区分', '稼働状況',
] as const;
const LEGACY_SCOPE_COLUMN_INDEX = LEGACY_LOCATION_CSV_HEADERS.indexOf('Scope対象区分');

/**
 * テンプレートの記入例行に付ける拠点名の接頭辞。
 * 取込時は「ID列が空」かつ「拠点名がこの接頭辞で始まる」行を記入例とみなして除外する。
 * テンプレートに追記してそのまま取り込む運用で「（記入例）東京本社」が実拠点として
 * 作られてしまうのを防ぐ。半角括弧で書き直された場合も同じ扱いにする。
 * ID列も条件に入れるのは、たまたまこの接頭辞で始まる名前の実拠点があっても、
 * エクスポート（IDが必ず付く）からの再取込で黙って除外されないようにするため。
 */
export const LOCATION_CSV_EXAMPLE_PREFIX = '（記入例）';
const EXAMPLE_ROW_NAME_PATTERN = /^[（(]記入例[）)]/;

/** 拠点名がテンプレートの記入例か（全角・半角どちらの括弧でも記入例とみなす） */
export const isLocationCsvExampleName = (name: string): boolean =>
  EXAMPLE_ROW_NAME_PATTERN.test(name.trim());

/**
 * エクスポート1行ぶんのセル。列の並びは LOCATION_CSV_HEADERS と一対一で対応させる。
 * ヘッダーと出力行を同じファイルに置き、片方だけ列が増減してラウンドトリップが
 * 壊れるのを防ぐ（排出係数側で実際に「ステータス」列が出力から欠けていた）。
 */
export const locationToCsvRow = (location: LocationRecord): string[] => [
  location.id,
  location.name,
  REGION_LABELS[location.region],
  LOCATION_TYPE_LABELS[location.type],
  location.person,
  LOCATION_STATUS_LABELS[location.status],
];

/** 行単位のエラー（row はヘッダー行を含むファイル内の1始まり行番号） */
export interface LocationImportRowError {
  row: number;
  reasons: string[];
}

export interface LocationImportCreate {
  row: number;
  location: NewLocationInput;
}

export interface LocationImportUpdate {
  row: number;
  targetId: string;
  location: NewLocationInput;
}

export interface LocationImportPlan {
  creates: LocationImportCreate[];
  updates: LocationImportUpdate[];
  skipCount: number;
  /** テンプレートの記入例として除外した行数（skipCount とは別に数え、確認画面で案内する） */
  exampleRowCount: number;
  errors: LocationImportRowError[];
}

// CSVから読み取った1行分の拠点（ID列は既存行の特定にのみ使う）
interface ParsedLocationRow {
  row: number;
  id: string;
  location: NewLocationInput;
}

// 表示ラベル → 内部値の逆引き。CSVは人が読み書きするためラベル（例「関東」）で入出力する。
const valueByLabel = <T extends string>(labels: Record<T, string>): Record<string, T> =>
  Object.fromEntries(
    (Object.entries(labels) as [T, string][]).map(([value, label]) => [label, value]),
  ) as Record<string, T>;

const REGION_VALUE_BY_LABEL = valueByLabel(REGION_LABELS);
const TYPE_VALUE_BY_LABEL = valueByLabel(LOCATION_TYPE_LABELS);
const STATUS_VALUE_BY_LABEL = valueByLabel(LOCATION_STATUS_LABELS);

const labelList = (labels: Record<string, string>): string => Object.values(labels).join(' / ');

// エクスポートのフォーミュラインジェクション対策（=+-@ 始まりの値へ ' を前置）を復元する。
const unescapeFormulaGuard = (value: string): string => value.replace(/^'(?=[=+\-@])/, '');

// 「内容が変わっているか」の比較。
const valuesEqual = (a: NewLocationInput, b: NewLocationInput): boolean =>
  a.name === b.name &&
  a.region === b.region &&
  a.type === b.type &&
  a.person === b.person &&
  a.status === b.status;

const toComparable = (location: LocationRecord): NewLocationInput => ({
  name: location.name,
  region: location.region,
  type: location.type,
  person: location.person,
  status: location.status,
});

const headersMatch = (headers: string[], expected: readonly string[]): boolean =>
  headers.length === expected.length && headers.every((header, index) => header === expected[index]);

/** 拠点名の照合キー。前後空白と全角空白の差で別拠点と誤判定しないよう正規化する。 */
const nameKey = (name: string): string => name.trim().replace(/[\s\u3000]+/g, ' ');

/** UTF-16（BOM付き。未編集の再インポート）と UTF-8 / Shift_JIS を判別してデコードする。 */
export const decodeLocationCsvBuffer = decodeCsvBufferAllowingUtf16;

/**
 * CSVテキストをパースして行ごとの拠点とバリデーションエラーへ変換する。
 * ヘッダー不一致・空ファイルはファイル全体のエラーとして throw する。
 */
export const parseLocationCsvText = (
  text: string,
): { rows: ParsedLocationRow[]; errors: LocationImportRowError[]; exampleRowCount: number } => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  if (lines.length === 0 || !lines[0].trim()) {
    throw new Error('CSVファイルが空です。');
  }

  // 区切り文字の自動判別: エクスポート直後はタブ区切り、Excelで再保存するとカンマ区切りになる
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitCsvLine(lines[0].trim(), delimiter).map(col => col.trim());

  // 廃止前のフォーマット（Scope対象区分あり）なら、その列を各行から取り除いて現行の並びに揃える
  const isLegacyFormat = headersMatch(headers, LEGACY_LOCATION_CSV_HEADERS);

  if (!isLegacyFormat && !headersMatch(headers, LOCATION_CSV_HEADERS)) {
    throw new Error(
      `CSVファイルのヘッダー列が一致しません。拠点管理画面のCSVテンプレート／CSVエクスポートと同じ列構成（${LOCATION_CSV_HEADERS.join(', ')}）を使用してください。`,
    );
  }

  const rows: ParsedLocationRow[] = [];
  const errors: LocationImportRowError[] = [];
  let exampleRowCount = 0;

  for (let i = 1; i < lines.length; i++) {
    // 行全体を trim すると「末尾列が空のタブ区切り行」の区切り文字まで消えて列数が狂うため、
    // 行はそのまま分割し、各フィールド側で trim する。
    const line = lines[i];
    if (!line.trim()) continue;

    const columns = splitCsvLine(line, delimiter).map(col => unescapeFormulaGuard(col.trim()));
    if (columns.every(col => col === '')) continue;

    const rowNumber = i + 1;

    // 列数の不足はファイルのヘッダー基準で判定する（旧フォーマットなら7列）。
    // 旧フォーマットで列が欠けた行は「どの列が欠けたか」を特定できないため、Scope列を
    // 取り除く前にここで弾き、ユーザーがファイル上で数えた列数と同じ数字で案内する。
    const expectedColumnCount = isLegacyFormat
      ? LEGACY_LOCATION_CSV_HEADERS.length
      : LOCATION_CSV_HEADERS.length;
    if (columns.length < expectedColumnCount) {
      errors.push({
        row: rowNumber,
        reasons: [`列数が足りません（${expectedColumnCount}列必要ですが、${columns.length}列のみです）`],
      });
      continue;
    }

    // 旧フォーマットは列数が揃っていると確認できたので、Scope対象区分の列を取り除いて現行の並びに揃える
    if (isLegacyFormat) {
      columns.splice(LEGACY_SCOPE_COLUMN_INDEX, 1);
    }

    // 列: 0=ID, 1=拠点名, 2=地域, 3=拠点種別, 4=担当者, 5=稼働状況
    const [id, name, regionLabel, typeLabel, person, statusLabel] = columns;

    // テンプレートの記入例行は、他の列を書き換えていてもバリデーションより前に除外する
    // （残したまま取り込んだ人に、記入例行のエラーで悩ませないため）。
    // IDが入っている行は既存拠点の再取込なので、名前が記入例風でも通常どおり扱う。
    if (!id && isLocationCsvExampleName(name)) {
      exampleRowCount++;
      continue;
    }

    // 必須・文字数上限は追加/編集フォームと同じ定義（locationValidation.ts）
    const reasons: string[] = validateLocationNameAndPerson(name, person);

    const region = REGION_VALUE_BY_LABEL[regionLabel];
    if (!region) reasons.push(`地域「${regionLabel}」は認識できません（${labelList(REGION_LABELS)}）`);

    const type = TYPE_VALUE_BY_LABEL[typeLabel];
    if (!type) reasons.push(`拠点種別「${typeLabel}」は認識できません（${labelList(LOCATION_TYPE_LABELS)}）`);

    const status = STATUS_VALUE_BY_LABEL[statusLabel];
    if (!status) reasons.push(`稼働状況「${statusLabel}」は認識できません（${labelList(LOCATION_STATUS_LABELS)}）`);

    if (reasons.length > 0) {
      errors.push({ row: rowNumber, reasons });
      continue;
    }

    rows.push({
      row: rowNumber,
      id,
      location: {
        name,
        region: region as Region,
        type: type as LocationType,
        person,
        status: status as LocationStatus,
      },
    });
  }

  return { rows, errors, exampleRowCount };
};

/**
 * CSVテキストと既存拠点一覧から取込プラン（追加・更新・スキップ・エラー）を組み立てる。
 * DBアクセスは行わない純関数。実際の insert/update は呼び出し側（UI）が
 * locationService の addLocation / updateLocation で実行する。
 */
export const buildLocationImportPlan = (
  text: string,
  existingLocations: LocationRecord[],
): LocationImportPlan => {
  const { rows, errors, exampleRowCount } = parseLocationCsvText(text);

  const creates: LocationImportCreate[] = [];
  const updates: LocationImportUpdate[] = [];
  let skipCount = 0;

  const byId = new Map(existingLocations.map(location => [location.id, location]));
  const byName = new Map<string, LocationRecord[]>();
  for (const location of existingLocations) {
    const key = nameKey(location.name);
    const group = byName.get(key);
    if (group) {
      group.push(location);
    } else {
      byName.set(key, [location]);
    }
  }

  // CSV内の重複（同名の新規行が複数、同一拠点への更新が複数）を検出するための作業領域
  const plannedCreatesByName = new Map<string, NewLocationInput>();
  const plannedUpdatesById = new Map<string, NewLocationInput>();
  // 改名で新たに使われる名前（照合キー）。「行1で A→B に改名、行2で B を新規追加」のように
  // 既存にも新規行にも無い名前が改名先と衝突するケースを検出する（通すと B が2件できる）。
  const plannedRenameKeys = new Set<string>();

  const planCreate = (row: ParsedLocationRow): void => {
    const key = nameKey(row.location.name);
    if (plannedRenameKeys.has(key)) {
      errors.push({
        row: row.row,
        reasons: [`拠点名「${row.location.name}」は別の拠点が既に使っています。拠点名は重複させないでください`],
      });
      return;
    }
    const planned = plannedCreatesByName.get(key);
    if (planned) {
      // 同名の新規行がCSV内に複数ある場合、同値ならスキップ・異なる値ならエラーにする
      // （両方追加すると同名拠点が増えて、次回以降の取込で対象を特定できなくなるため）
      if (valuesEqual(row.location, planned)) {
        skipCount++;
      } else {
        errors.push({
          row: row.row,
          reasons: [`CSV内に同じ拠点名「${row.location.name}」の行が複数あります。1行にまとめてください`],
        });
      }
      return;
    }
    plannedCreatesByName.set(key, row.location);
    creates.push({ row: row.row, location: row.location });
  };

  const planUpdate = (row: ParsedLocationRow, target: LocationRecord): void => {
    if (valuesEqual(row.location, toComparable(target))) {
      skipCount++;
      return;
    }
    // 改名で別の拠点と同名になるのを止める。通してしまうと同名拠点が2件になり、
    // 次回以降その名前の行は「更新対象を特定できません」になって、
    // その状態を作ったCSV自体が取り込めなくなる。
    const renamedKey = nameKey(row.location.name);
    if (renamedKey !== nameKey(target.name)) {
      const collidesWithExisting = (byName.get(renamedKey) ?? []).some(
        location => location.id !== target.id,
      );
      if (
        collidesWithExisting ||
        plannedCreatesByName.has(renamedKey) ||
        plannedRenameKeys.has(renamedKey)
      ) {
        errors.push({
          row: row.row,
          reasons: [`拠点名「${row.location.name}」は別の拠点が既に使っています。拠点名は重複させないでください`],
        });
        return;
      }
    }
    const planned = plannedUpdatesById.get(target.id);
    if (planned) {
      if (valuesEqual(row.location, planned)) {
        skipCount++;
      } else {
        errors.push({
          row: row.row,
          reasons: [`同じ拠点「${target.name}」を複数の行が異なる内容で更新しようとしています`],
        });
      }
      return;
    }
    if (renamedKey !== nameKey(target.name)) plannedRenameKeys.add(renamedKey);
    plannedUpdatesById.set(target.id, row.location);
    updates.push({ row: row.row, targetId: target.id, location: row.location });
  };

  for (const row of rows) {
    // 1) ID列が既存拠点と一致すればそれを対象にする（同名拠点が複数ある場合の特定手段）。
    //    別環境からのCSVなどで未知のIDなら拠点名の照合へフォールバックする。
    const idTarget = row.id ? byId.get(row.id) : undefined;
    if (idTarget) {
      planUpdate(row, idTarget);
      continue;
    }

    // 2) 拠点名で照合
    const candidates = byName.get(nameKey(row.location.name)) ?? [];

    if (candidates.length === 1) {
      planUpdate(row, candidates[0]);
      continue;
    }

    if (candidates.length > 1) {
      const identical = candidates.find(candidate => valuesEqual(row.location, toComparable(candidate)));
      if (identical) {
        skipCount++;
      } else {
        errors.push({
          row: row.row,
          reasons: [`同じ拠点名「${row.location.name}」の拠点が複数登録されているため、更新対象を特定できません。ID列で対象を指定してください`],
        });
      }
      continue;
    }

    planCreate(row);
  }

  return { creates, updates, skipCount, exampleRowCount, errors };
};

/**
 * 新規一括登録用のテンプレート（ヘッダー + 記入例1行）。
 * 選択肢のある列（地域・拠点種別・稼働状況）は実際に通る値を例に入れ、
 * 何を書けばよいかがファイル単体で分かるようにする。
 * 記入例の行は残したまま取り込んでも、拠点名の接頭辞（LOCATION_CSV_EXAMPLE_PREFIX）で
 * 判別して除外されるので、実拠点として登録されることはない。
 */
export const buildLocationCsvTemplateRows = (): string[][] => [
  [...LOCATION_CSV_HEADERS],
  ['', `${LOCATION_CSV_EXAMPLE_PREFIX}東京本社`, '関東', '本社', '環境 太郎', '稼働中'],
];
