// 公式排出係数マスタのシードSQL（supabase/seeds/production/）を生成するスクリプト。
//
// 実行: node scripts/official-factors/generate.ts
// 出力: supabase/seeds/production/official_emission_factors_<年度>.sql（年度ごと）と
//       supabase/seeds/production/official_emission_factors_cleanup.sql（以前の版の翌年度コピー行の後始末）
//
// 生成物は OpenGreenTrack の初期データのうち、本番環境にも投入する共通マスタ（seed）。
// データはスキーマ定義ファイルではなく seed として管理する（AGENTS.md R12）。投入方法:
//   ローカル DB 作り直し      : npx supabase db reset（config.toml [db.seed].sql_paths で自動投入）
//   稼働中ローカル DB へ再投入: npm run db:seed:production（= node scripts/db/seed.ts production）
//   クラウド                  : npx supabase db push --include-seed
//   任意の DB（自前ホストなど）: npm run db:seed:production -- --db-url postgresql://…（ホストの psql を使用）
//
// データソース（data/<年度>/ 配下。年度ごとにその年度の公表資料と年度の定義 source.json を置く。
// 取得元は各ファイルのヘッダコメント参照。source.json の書式は yearSource.ts と README.md）:
//   denki.txt  : 電気事業者別排出係数（pdftotext -layout の生テキストをパース）
//   gas.tsv    : ガス事業者別排出係数（手書き転記）
//   heat.tsv   : 熱供給事業者別排出係数（手書き転記）
//   fuels.tsv  : 燃料の使用に関する排出係数（算定省令別表、手書き転記）
//   scope3.tsv : Scope3 代表排出原単位（排出原単位DB から厳選・手書き転記）
//
// 出力は決定的で、再実行しても同一のSQLになる。ID は行の安定キー（FactorSeedRow.idKey: 事業者別は
// energyType + 登録番号 + メニュー名 + 係数種別、代替値は energyType、燃料・Scope3 は TSV の key 列）と
// 年度から導出した md5 ベース UUID で、名称・値・出典を訂正しても同じ ID のまま。
// 生成SQLは on conflict (id) do update の upsert なので、値・出典・名称の訂正は data/<年度>/ を直して再生成し、
// 再投入すれば既存行に反映される（既存行の訂正もこの seed の再投入で行う）。status は上書きせず、
// 変更のない行は更新しない（where … is distinct from）ので updatedAt が動くのは値が変わった行だけ。
// 年度の追加は data/<年度>/ に公表資料と source.json を置いて再生成・再投入するだけで、このファイルは変更しない
// （OSS の導入先がリポジトリに同梱しない過年度を自分で登録しても、コードと衝突しないようにするため）。
// seed を年度ごとのファイルに分けるのも同じ理由（導入先が足した年度のファイルは OSS 側の年度のファイルと別になる）。
// 過年度の data/<年度>/ は変更しない（変更すると、その年度の行が upsert で書き換わる）。
// 過年度行の archive が必要な場合も、冪等な文としてこの seed に出力する（手順は README.md）。
// 未公表年度ぶんの行は作らない（理由は YEAR_SOURCES のコメントを参照）。

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  parseDenki,
  parseProviderTsv,
  parseSimpleTsv,
  type ProviderFactorRow,
} from './parse.ts';
import {
  assert,
  loadYearSources,
  runYearSourceChecks,
  type ParsedYearData,
  type YearSource,
} from './yearSource.ts';

const DATA_DIR = join(import.meta.dirname, 'data');
const OUTPUT_DIR = join(import.meta.dirname, '../../supabase/seeds/production');
const OUTPUT_PREFIX = 'official_emission_factors';
const CLEANUP_FILE_NAME = `${OUTPUT_PREFIX}_cleanup.sql`;
const yearFileName = (year: number): string => `${OUTPUT_PREFIX}_${year}.sql`;

const SOURCE_URL_SHK = 'https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html';
const SOURCE_URL_SCOPE3 =
  'https://www.env.go.jp/earth/ondanka/supply_chain/gvc/estimate_05.html';

// 収録する適用年度は、data/ 配下の年度ディレクトリ（source.json を持つもの）で決まる（yearSource.ts の loadYearSources）。
// **公表資料が存在する年度だけ**を置く。
// 同じ値を翌年度へコピーしないこと: コピー行は「正式な当該年度係数」と DB 上で見分けが付かず、
// 公表後に正式値へ差し替えたことを誰も検知できない。
// 対象年度の係数が無い間は、算定側が直近の過年度（PROVISIONAL_FALLBACK_YEARS = 1 年前まで）の
// 公式係数を暫定適用し、入力フォームに「暫定適用」と理由を表示する（resolveEmissionFactor の
// effectiveYearsFor / isProvisionalFactor）。公表され次第 data/<新年度>/ を置けば、
// 暫定適用は自動的に止まる（表示の消し忘れが起きない）。
// 過年度の行は消さずに残す（過年度の再算定・監査で参照するため）。過年度の data/<年度>/ は変更しない。
// 電気・ガス・熱の公表資料名が複数年度で同じなら、資料の差し替え忘れとして止める（assertDistinctDocuments）。
const YEAR_SOURCES = loadYearSources(DATA_DIR);
const YEARS = YEAR_SOURCES.map((source) => source.year);

interface FactorSeedRow {
  /**
   * 行の安定キー（年度を除く ID の導出元）。名称・値・出典を訂正しても変わらない識別子だけで組む:
   *   事業者別係数: energyType:登録番号:メニュー名:係数種別 / 代替値: energyType:substitute /
   *   燃料・Scope3: energyType:TSV の key 列
   * これを変えると別の行（新しい ID）になり、元の行は archive が必要になる（README.md）。
   */
  idKey: string;
  energyType: string;
  scope: 'scope1' | 'scope2' | 'scope3';
  name: string;
  factorValue: number;
  unit: string;
  source: 'moe' | 'meti' | 'ketsoho' | 'utility' | 'custom';
  providerName: string | null;
  providerNumber: string | null;
  menuName: string | null;
  factorType: 'basic' | 'adjusted' | null;
  sourceDocumentName: string;
  sourceUrl: string;
}

/** 1 年度分の生成結果（ヘッダ・ログの件数表示にも使う） */
interface YearRows {
  source: YearSource;
  data: ParsedYearData;
  rows: FactorSeedRow[];
}

/** その年度の data/<year>/ と source.json の定義だけから、その年度の行を作る。 */
const buildYearRows = (source: YearSource): YearRows => {
  const dataDir = source.dataDir;
  const readData = (fileName: string): string => readFileSync(join(dataDir, fileName), 'utf8');
  const rows: FactorSeedRow[] = [];

  // --- 電気（事業者別・一般送配電・代替値） ---------------------------------

  const denkiDoc = source.documents.denki;

  const denki = parseDenki(readData('denki.txt'));

  // 原典改版の読み替え SQL（revisionFollowupStatements）の前提検証: 残差メニューは事業者ごとに高々1つ。
  // 複数あると「旧残差行 → 現行残差行」の対応が providerNumber + factorType で一意に決まらなくなる。
  const residualCounts = new Map<string, number>();
  for (const retailer of denki.retailers) {
    if (retailer.menuName?.includes('残差')) {
      residualCounts.set(retailer.providerNumber, (residualCounts.get(retailer.providerNumber) ?? 0) + 1);
    }
  }
  for (const [providerNumber, count] of residualCounts) {
    assert(
      count === 1,
      `${source.year}年度 ${providerNumber} の残差メニューが${count}件あります（原典改版の読み替えの前提が崩れる）`,
    );
  }

  const pushProviderRows = (
    provider: ProviderFactorRow,
    base: Pick<FactorSeedRow, 'energyType' | 'scope' | 'unit' | 'sourceDocumentName' | 'sourceUrl'> & {
      labelPrefix: string;
    },
  ): void => {
    const menuLabel = provider.menuName ? ` ${provider.menuName}` : '';
    const variants = [
      { factorType: 'basic' as const, value: provider.basic, label: '基礎' },
      { factorType: 'adjusted' as const, value: provider.adjusted, label: '調整後' },
    ];
    for (const variant of variants) {
      if (variant.value === null) {
        continue;
      }
      rows.push({
        // 事業者名は社名変更で変わりうるため含めない（登録番号 + メニュー名で事業者・メニューを特定する）
        idKey: `${base.energyType}:${provider.providerNumber}:${provider.menuName ?? '-'}:${variant.factorType}`,
        energyType: base.energyType,
        scope: base.scope,
        name: `${base.labelPrefix} ${provider.providerName}${menuLabel}（${variant.label}）`,
        factorValue: variant.value,
        unit: base.unit,
        source: 'utility',
        providerName: provider.providerName,
        providerNumber: provider.providerNumber,
        menuName: provider.menuName,
        factorType: variant.factorType,
        sourceDocumentName: base.sourceDocumentName,
        sourceUrl: base.sourceUrl,
      });
    }
  };

  for (const retailer of denki.retailers) {
    pushProviderRows(retailer, {
      energyType: 'electricity',
      scope: 'scope2',
      unit: 't-CO2/kWh',
      sourceDocumentName: denkiDoc,
      sourceUrl: SOURCE_URL_SHK,
      labelPrefix: '電気',
    });
  }
  for (const grid of denki.gridOperators) {
    pushProviderRows(grid, {
      energyType: 'electricity',
      scope: 'scope2',
      unit: 't-CO2/kWh',
      sourceDocumentName: denkiDoc,
      sourceUrl: SOURCE_URL_SHK,
      labelPrefix: '電気（一般送配電）',
    });
  }
  // 代替値は事業者を選ばない場合の自動解決フォールバック（providerName なし＝全国標準 tier5）
  rows.push({
    energyType: 'electricity',
    scope: 'scope2',
    idKey: 'electricity:substitute',
    name: '電気 代替値（環境省・経済産業省公表）',
    factorValue: denki.substituteValue,
    unit: 't-CO2/kWh',
    source: 'moe',
    providerName: null,
    providerNumber: null,
    menuName: null,
    factorType: null,
    sourceDocumentName: denkiDoc,
    sourceUrl: SOURCE_URL_SHK,
  });

  // --- ガス（事業者別・代替値） ---------------------------------------------

  const gasDoc = source.documents.gas;
  const gasProviders = parseProviderTsv(readData('gas.tsv'));
  for (const provider of gasProviders) {
    pushProviderRows(provider, {
      energyType: 'city_gas',
      scope: 'scope1',
      unit: 't-CO2/千m3',
      sourceDocumentName: gasDoc,
      sourceUrl: SOURCE_URL_SHK,
      labelPrefix: '都市ガス',
    });
  }
  rows.push({
    energyType: 'city_gas',
    scope: 'scope1',
    idKey: 'city_gas:substitute',
    name: '都市ガス 代替値（省令の排出係数）',
    factorValue: source.cityGasSubstituteValue,
    unit: 't-CO2/千m3',
    source: 'moe',
    providerName: null,
    providerNumber: null,
    menuName: null,
    factorType: null,
    sourceDocumentName: gasDoc,
    sourceUrl: SOURCE_URL_SHK,
  });

  // --- 熱（事業者別・代替値） -----------------------------------------------

  const heatDoc = source.documents.heat;
  const heatProviders = parseProviderTsv(readData('heat.tsv'));
  for (const provider of heatProviders) {
    pushProviderRows(provider, {
      energyType: 'heat',
      scope: 'scope2',
      unit: 't-CO2/GJ',
      sourceDocumentName: heatDoc,
      sourceUrl: SOURCE_URL_SHK,
      labelPrefix: '熱',
    });
  }
  rows.push({
    energyType: 'heat',
    scope: 'scope2',
    idKey: 'heat:substitute',
    name: '熱 代替値（省令の排出係数）',
    factorValue: source.heatSubstituteValue,
    unit: 't-CO2/GJ',
    source: 'moe',
    providerName: null,
    providerNumber: null,
    menuName: null,
    factorType: null,
    sourceDocumentName: heatDoc,
    sourceUrl: SOURCE_URL_SHK,
  });

  // --- 燃料（算定省令別表） -------------------------------------------------

  const fuelsDoc = source.documents.fuels;
  const fuels = parseSimpleTsv(readData('fuels.tsv'));
  for (const fuel of fuels) {
    rows.push({
      idKey: `${fuel.energyType}:${fuel.key}`,
      energyType: fuel.energyType,
      scope: 'scope1',
      name: `燃料 ${fuel.name}`,
      factorValue: fuel.value,
      unit: fuel.unit,
      source: 'ketsoho',
      providerName: null,
      providerNumber: null,
      menuName: null,
      factorType: null,
      sourceDocumentName: fuelsDoc,
      sourceUrl: SOURCE_URL_SHK,
    });
  }

  // --- Scope3 代表原単位 -----------------------------------------------------

  const scope3Doc = source.documents.scope3;
  const scope3 = parseSimpleTsv(readData('scope3.tsv'));
  for (const item of scope3) {
    rows.push({
      idKey: `${item.energyType}:${item.key}`,
      energyType: item.energyType,
      scope: 'scope3',
      name: item.name,
      factorValue: item.value,
      unit: item.unit,
      source: 'moe',
      providerName: null,
      providerNumber: null,
      menuName: null,
      factorType: null,
      sourceDocumentName: scope3Doc,
      sourceUrl: SOURCE_URL_SCOPE3,
    });
  }

  const data: ParsedYearData = { denki, gasProviders, heatProviders, fuels, scope3 };
  // パース結果の妥当性検証（件数の下限と、公表資料と突合したスポットチェック。期待値は source.json の checks）
  runYearSourceChecks(source, data);

  // numeric(12,6) に収まることを確認（小数第7位以下があると黙って丸められるため弾く）
  for (const row of rows) {
    assert(
      Math.round(row.factorValue * 1e6) / 1e6 === row.factorValue,
      `係数値が小数6桁を超えています: ${source.year}年度 ${row.name} = ${row.factorValue}`,
    );
    assert(row.name.length <= 200, `係数名が200文字を超えています: ${row.name}`);
  }

  // 安定キーが重複していると 2 行が同じ ID になり、upsert で片方が黙って消えるため先に検出する
  const seenKeys = new Set<string>();
  for (const row of rows) {
    assert(!seenKeys.has(row.idKey), `安定キーが重複しています: ${source.year}年度 ${row.idKey}（${row.name}）`);
    seenKeys.add(row.idKey);
  }

  return { source, data, rows };
};

const yearRows = YEAR_SOURCES.map(buildYearRows);

// --- SQL生成 ---------------------------------------------------------------

/** 安定キー + 年度から決定的に導出するUUID（md5）。再生成しても同じIDになり、on conflict で冪等になる。 */
const deterministicUuid = (key: string): string => {
  const hex = createHash('md5').update(`official-factor:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const sqlString = (value: string | null): string =>
  value === null ? 'null' : `'${value.replaceAll("'", "''")}'`;

interface SqlRow extends FactorSeedRow {
  id: string;
  applicableYear: number;
  effectiveFrom: string;
  effectiveTo: string;
}

const sqlRows: SqlRow[] = [];
for (const { source, rows } of yearRows) {
  const year = source.year;
  for (const row of rows) {
    sqlRows.push({
      ...row,
      id: deterministicUuid(`${row.idKey}:${year}`),
      applicableYear: year,
      effectiveFrom: `${year}-04-01`,
      effectiveTo: `${year + 1}-03-31`,
    });
  }
}
assert(new Set(sqlRows.map((r) => r.id)).size === sqlRows.length, '生成IDが重複しています');

const toValuesTuple = (r: SqlRow): string =>
  `(${[
    `'${r.id}'`,
    'null', // organizationId: 公式係数は全組織共通
    sqlString(r.name),
    `'${r.energyType}'`,
    `'${r.scope}'`,
    String(r.factorValue),
    sqlString(r.unit),
    String(r.applicableYear),
    `'全国'`,
    `'${r.source}'`,
    `'active'`,
    'false', // isCustom
    sqlString(r.providerName),
    sqlString(r.providerNumber),
    sqlString(r.menuName),
    r.factorType === null ? 'null' : `'${r.factorType}'`,
    `'${r.effectiveFrom}'`,
    `'${r.effectiveTo}'`,
    sqlString(r.sourceDocumentName),
    sqlString(r.sourceUrl),
  ].join(', ')})`;

// 再投入時に既存行へ上書きする列（値・出典・名称・有効期間の訂正を seed の再適用だけで反映するため）。
// 上書きしない列: status（運用で archived にした行を active に戻さない）、"isCustom" / "organizationId"
// （公式係数であることそのもの）、"energyType" / scope / "applicableYear"（ID の導出元・分類キー）。
// "updatedAt" は set_emission_factors_updated_at トリガーが更新する。
const UPSERT_COLUMNS = [
  'name',
  '"factorValue"',
  'unit',
  '"regionName"',
  'source',
  '"providerName"',
  '"providerNumber"',
  '"menuName"',
  '"factorType"',
  '"effectiveFrom"',
  '"effectiveTo"',
  '"sourceDocumentName"',
  '"sourceUrl"',
];
// 変更のない行は更新しない（where … is distinct from）。無条件に update すると再投入のたびに全行が
// 書き換わり、不要な dead tuple と updatedAt の更新が起きて「いつ値が変わったか」を追えなくなるため。
// null 同士も等しいと判定する is distinct from を、行値コンストラクタで全上書き列に対してまとめて使う。
const changeGuard = `where (${UPSERT_COLUMNS.map((column) => `ef.${column}`).join(', ')})\n  is distinct from (${UPSERT_COLUMNS.map((column) => `excluded.${column}`).join(', ')})`;
const conflictClause = `on conflict (id) do update set\n${UPSERT_COLUMNS.map(
  (column) => `  ${column} = excluded.${column}`,
).join(',\n')}\n${changeGuard};`;

const CHUNK_SIZE = 500;
/** 1 年度分の行を insert 文（CHUNK_SIZE 行ずつ）にする。 */
const insertStatements = (rows: SqlRow[]): string[] => {
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    statements.push(
      `insert into emission_factors as ef\n  (id, "organizationId", name, "energyType", scope, "factorValue", unit, "applicableYear", "regionName", source, status, "isCustom", "providerName", "providerNumber", "menuName", "factorType", "effectiveFrom", "effectiveTo", "sourceDocumentName", "sourceUrl")\nvalues\n${chunk.map(toValuesTuple).join(',\n')}\n${conflictClause}`,
    );
  }
  return statements;
};

// --- 原典改版の後始末（残差メニューの読み替えと消滅行のアーカイブ） -----------------
//
// 公表資料は公表後も改版され、メニュー名の変更・メニューの消滅が起きる（例: R6年度実績の
// R8.7.23・R8.8.3 一部追加・更新では、1月公表時に係数が確定していなかった事業者へ実績値が反映され、
// 177社でメニュー構成が変わった。東京電力EPの残差は メニューM(残差)→メニューL(残差)）。
// メニュー名は行の安定キーの構成要素なので、改名された行は別 ID の新規行になり、upsert だけでは旧名の行が
// active のまま残って「原典の最新版に存在しないメニュー」が選択肢と算定に使われ続ける。upsert の後に:
//
//   1. 残差メニューの読み替え: 旧残差行への明示選択（activity_records."emissionFactorId"）を、同一事業者・
//      同一係数種別・同一年度の現行残差行へ付け替える。残差メニューは原典上事業者ごとに高々1つ
//      （buildYearRows で検証）なので、新旧の対応は providerNumber + factorType で一意に決まる。
//      改名は呼び名の変更であって契約メニューの実体（残差メニュー）は変わらないため、付け替えが正しい解釈。
//      emission_results は付け替えない（過去の算定がどの行・どの値で行われたかの記録のため）。
//      付け替えたレコードの再算定の要否確認は README「原典改版の追従」参照。
//   2. 消滅行のアーカイブ: upsert 後も旧版の出典表記（sourceDocumentName）のまま残った行＝最新版に
//      存在しない行を archived にする。ただし activity_records から参照中の行は active のまま残す
//      （archived にすると算定時の明示選択フィルタ（status='active'）から外れ、黙って代替値に落ちる。
//      残差以外のメニューは新旧の対応を機械的に決められず読み替えもできない。残存行は README の
//      確認SQLで洗い出して個別対処する）。
//
// 検出キーは source.json の documents（出典表記）なので、改版を取り込むときは出典表記も必ず新しい版に変える。
// どちらも冪等（1 は旧行への参照が無くなれば対象ゼロ、2 は archived 済み・参照中を除外）。
// 年度ごとの seed に、その年度の行だけを対象として出力する（年度ごとのファイルは互いに独立のまま）。
// 出典表記が変わらない訂正（転記ミスの修正など）で安定キーを変えた場合はこの仕組みでは拾えないため、
// 従来どおり個別の冪等文を出力すること（README「行の ID（安定キー）」）。
const revisionFollowupStatements = (source: YearSource): string[] => {
  const year = source.year;
  const denkiDocSql = sqlString(source.documents.denki);
  const statements = [
    `-- ${year}年度 電気: 原典改版で改名された残差メニューの読み替え（旧残差行への明示選択を現行残差行へ付け替える）
update activity_records as ar
set "emissionFactorId" = cur.id
from emission_factors as old
join emission_factors as cur
  on cur."organizationId" is null
  and cur."energyType" = 'electricity'
  and cur."applicableYear" = old."applicableYear"
  and cur."providerNumber" = old."providerNumber"
  and cur."factorType" = old."factorType"
  and cur."menuName" like '%残差%'
  and cur."sourceDocumentName" = ${denkiDocSql}
where ar."emissionFactorId" = old.id
  and old."organizationId" is null
  and old."energyType" = 'electricity'
  and old."applicableYear" = ${year}
  and old."menuName" like '%残差%'
  and old."sourceDocumentName" is distinct from ${denkiDocSql};`,
  ];
  const utilityDocs = [
    ['electricity', source.documents.denki],
    ['city_gas', source.documents.gas],
    ['heat', source.documents.heat],
  ] as const;
  for (const [energyType, doc] of utilityDocs) {
    statements.push(
      `-- ${year}年度 ${energyType}: 最新の公表資料に存在しない事業者別係数行のアーカイブ（明示選択から参照中の行は残す）
update emission_factors as ef
set status = 'archived'
where ef."organizationId" is null
  and ef.source = 'utility'
  and ef."energyType" = '${energyType}'
  and ef."applicableYear" = ${year}
  and ef."sourceDocumentName" is distinct from ${sqlString(doc)}
  and ef.status = 'active'
  and not exists (select 1 from activity_records ar where ar."emissionFactorId" = ef.id);`,
    );
  }
  return statements;
};

// 1 年度分の seed のヘッダ。出典と権利の表示は年度ごとのファイルそれぞれに入れる（再配布時もこの表示を保持する）。
const yearFileHeader = ({ source, data }: YearRows): string => `-- 公式排出係数マスタ ${source.year} 年度分（OpenGreenTrack の初期データ。本番環境にも投入する共通マスタ）
-- scripts/official-factors/generate.ts による自動生成。手編集しないこと（修正は data/${source.year}/ を直して再生成する）。
--
-- 出典と権利（再配布時もこの表示を保持すること。詳細はリポジトリ直下の NOTICE）:
--   電気・ガス・熱の事業者別排出係数: 「温室効果ガス排出量 算定・報告・公表制度」
--     （環境省・経済産業省 ${SOURCE_URL_SHK} ）を加工して作成
--   Scope3 排出原単位: 「サプライチェーンを通じた組織の温室効果ガス排出等の算定のための
--     排出原単位データベース ${source.scope3DatabaseVersion}」（環境省
--     ${SOURCE_URL_SCOPE3} ）を加工して作成
--   燃料の排出係数: 算定省令別表に基づく（法令。著作権法第13条により権利の目的とならない）
--   加工（公表 PDF からの抽出・転記・単位換算・DB 形式への再構成）の主体は Japan GX Group であり、
--   加工後の値について環境省・経済産業省その他の公表元は責任を負わない。値は原典で確認すること。
--   環境省ウェブサイトの利用規約（公共データ利用規約（第1.0版） https://www.env.go.jp/mail.html ）に基づき利用。
--   このデータは Apache License 2.0 の対象ではない（原典に対する権利は各公表元に帰属する）。ただし上記規約は
--   CC BY 4.0 と互換で、出典と加工した旨を表示すれば商用利用・改変・再配布ができる。
--
-- 投入方法（supabase/seeds/production/ の *.sql をすべて投入する。年度ごとのファイルは互いに独立）:
--   ローカル DB 作り直し      : npx supabase db reset（config.toml [db.seed].sql_paths で自動投入）
--   稼働中ローカル DB へ再投入: npm run db:seed:production（= node scripts/db/seed.ts production）
--   クラウド                  : npx supabase db push --include-seed
--   任意の DB（自前ホストなど）: npm run db:seed:production -- --db-url postgresql://…（ホストの psql を使用）、
--                              または Dashboard の SQL Editor で seeds/production/ のファイルを実行する
--
-- 収録内容（applicableYear ${source.year}。data/${source.year}/ の資料と source.json だけから生成）:
--   電気   : 電気事業者別排出係数 小売${data.denki.retailerCount}事業者（メニュー別・基礎/調整後）+ 一般送配電${data.denki.gridOperators.length}社 + 代替値 ${data.denki.substituteValue} t-CO2/kWh
--   都市ガス: ガス事業者別排出係数 ${new Set(data.gasProviders.map((p) => p.providerNumber)).size}事業者 + 代替値 ${source.cityGasSubstituteValue} t-CO2/千m3
--   熱     : 熱供給事業者別排出係数 ${new Set(data.heatProviders.map((p) => p.providerNumber)).size}事業者 + 代替値 ${source.heatSubstituteValue} t-CO2/GJ
--   燃料   : 算定省令別表の燃料${data.fuels.length}種（scope1）
--   Scope3 : 排出原単位DB ${source.scope3DatabaseVersion} の代表原単位${data.scope3.length}件
--
-- organizationId は null（全組織共通・読み取り専用。emission_factors のテーブル定義は
-- 20260831000000_schema.sql、全組織から読める RLS ポリシーは 20260831000001_rls.sql を参照）。
-- 事業者別係数（providerName あり）は自動解決の対象外で、手動入力の明示選択専用。
-- ID は行の安定キー（事業者別: energyType + 登録番号 + メニュー名 + 係数種別 / 代替値: energyType /
-- 燃料・Scope3: energyType + data/<年度>/*.tsv の key 列）と年度から決定的に導出した md5 ベース UUID。
-- 再投入は on conflict (id) do update の upsert で冪等で、値・出典・名称・有効期間の訂正は
-- 「data/<年度>/ を直して再生成 → 再投入」で既存行に反映される（データの訂正はスキーマ定義ファイルに書かず seed で行う: AGENTS.md R12）。
-- 変更のない行は where … is distinct from で更新をスキップするため、再投入で updatedAt が動くのは値が変わった行だけ。
-- status は上書きしない（運用で archived にした行を再投入で active に戻さないため）。
-- updatedAt は set_emission_factors_updated_at トリガーが更新する。
-- upsert の後の update 群は原典改版（rev 更新）の後始末（この年度の行だけが対象。冪等。詳細は generate.ts）:
--   1. 改名された残差メニューの読み替え（旧残差行への明示選択を現行残差行へ付け替える）
--   2. 最新の公表資料に存在しない事業者別係数行のアーカイブ（明示選択から参照中の行は残す）
-- 公表資料のある年度の行だけを作る（未公表年度の行は作らない）。対象年度の係数が無い間は算定側
-- （resolveEmissionFactor の effectiveYearsFor）が直近の過年度を暫定適用し、入力フォームに「暫定適用」と
-- 理由を表示する。以前の版が作っていた翌年度コピー行の後始末は ${CLEANUP_FILE_NAME} にある。
-- 年度の追加は data/<年度>/ に公表資料と source.json を置いて再生成し、再投入する（過年度の data/<年度>/ は
-- 変更しない。手順は scripts/official-factors/README.md）。

`;

// 収録年度より後の公式係数行の後始末。
// 以前の版は「翌年度公表までのつなぎ」として同じ値を翌年度にもコピー登録していた（以前の seed は
// 2025 年度と同値の 2026 年度行を持つ）が、正式な当該年度係数と区別できないため取りやめた。
// 既存 DB に残っているコピー行は active のままだと「その年度の正式係数」として解決され、暫定適用も
// 「暫定適用」の表示も効かなくなるため、ここで消す。
// archive ではなく delete にする理由: 行 ID は「安定キー + 年度」から決定的に導出するので、将来その年度が
// 正式公表されたときの行は**同じ ID**になる。archived にすると status は upsert の上書き対象外（運用で
// archived にした行を戻さないため）なので、正式値を投入しても archived のまま残り不可視になる。
// 条件を「収録年度の最大値より後」に限ることで、YEAR_SOURCES に新年度を足せばこの文は自動的に何も消さなくなる。
// 何度流しても同じ結果になる。
//
// ただし削除対象は「どこからも参照されていない行」だけに限る。emission_results と activity_records の
// FK はどちらも on delete set null なので、参照されている行を消すと:
//   - 算定済みの結果から根拠係数の記録が消える（appliedFactorValue / appliedFactorName のスナップショットは
//     後から入れた列で、それ以前に算定された行は null のまま。遡って埋められない）
//   - 手動入力で明示選択した係数の指定が消え、再算定で全国代替値へ黙って戻る
//
// 参照の有無は行単位ではなく **energyType + 年度の単位** で見て、参照が 1 件でも残るグループは
// コピー行を全部残す。行単位で判定すると、明示指定・算定済みで参照が付いた事業者別の行だけが
// 残る「部分削除」状態になり:
//   - 残存行があるため officialYearIndex（resolveEmissionFactor）はその energyType のその年度を
//     「公表済み」と数え、暫定適用が発動しなくなる
//   - 一方で自動解決の唯一の受け皿である代替値行（providerName なし）は参照が無いので消えており、
//     事業者別係数は自動解決の対象外（tierOf）なので候補が 1 件も無く、全部 not_found に落ちる
// 公式係数は organizationId is null の全組織共有なので、1 組織の明示指定が全組織の未算定を招く。
// グループ全残しなら旧 seed 投入直後と同じ状態のまま（コピー行がその年度の係数として解決される）で
// 動き、その年度が正式公表されて YEAR_SOURCES に足されれば同じ ID の upsert で正式値に上書きされて解消する。
// 参照が残っているコピー行は削除されず active のまま残るので、稼働中 DB へ再投入したあとは
// scripts/official-factors/README.md の手順で残存行を確認し、個別に対処する。
const MAX_YEAR = Math.max(...YEARS);
const cleanupStatement = `-- 収録年度（${MAX_YEAR}）より後の公式係数行の後始末（以前の版が作っていた翌年度コピー行。冪等）。
-- 参照の有無は energyType + 年度の単位で見る（1 件でも参照が残るグループは全部残す。理由は generate.ts）。
delete from emission_factors as ef
where ef."organizationId" is null
  and ef."applicableYear" > ${MAX_YEAR}
  and not exists (
    select 1
    from emission_factors ref
    where ref."organizationId" is null
      and ref."energyType" = ef."energyType"
      and ref."applicableYear" = ef."applicableYear"
      and (
        exists (select 1 from emission_results er where er."emissionFactorId" = ref.id)
        or exists (select 1 from activity_records ar where ar."emissionFactorId" = ref.id)
      )
  );`;

const cleanupFileHeader = `-- 公式排出係数マスタ: 以前の版が作っていた翌年度コピー行の後始末（OpenGreenTrack の本番でも投入する共通マスタ）
-- scripts/official-factors/generate.ts による自動生成。手編集しないこと。
-- 収録年度の最大値（${MAX_YEAR}）より後の公式係数行のうち、
-- 算定結果・活動量からの参照が energyType・年度ごとに 1 件も無いものだけを消す（冪等）。
-- 年度ごとの seed（${OUTPUT_PREFIX}_<年度>.sql）が入れるのは収録年度の行だけなので、投入の順番には依存しない。
-- 過年度（収録年度の最大値より前）を足してもこのファイルは変わらない。

`;

// 年度ごとの seed と後始末を書き出す。以前の生成物（全年度 1 ファイルの official_emission_factors.sql や、
// data/ から消した年度のファイル）が残っていると古い行が投入され続けるため、今回生成しなかった生成物は消す。
const written = new Set<string>();
for (const yearRow of yearRows) {
  const year = yearRow.source.year;
  const fileName = yearFileName(year);
  const rows = sqlRows.filter((row) => row.applicableYear === year);
  const statements = [...insertStatements(rows), ...revisionFollowupStatements(yearRow.source)];
  writeFileSync(join(OUTPUT_DIR, fileName), yearFileHeader(yearRow) + statements.join('\n\n') + '\n');
  written.add(fileName);
}
writeFileSync(join(OUTPUT_DIR, CLEANUP_FILE_NAME), cleanupFileHeader + cleanupStatement + '\n');
written.add(CLEANUP_FILE_NAME);

const generatedFilePattern = new RegExp(`^${OUTPUT_PREFIX}(_\\d{4}|_cleanup)?\\.sql$`);
const removed = readdirSync(OUTPUT_DIR).filter((name) => generatedFilePattern.test(name) && !written.has(name));
for (const name of removed) {
  rmSync(join(OUTPUT_DIR, name));
}

console.log(`生成完了: ${OUTPUT_DIR}`);
console.log(`  ${YEARS.length} 年度 合計 ${sqlRows.length} 行`);
for (const { source, data, rows } of yearRows) {
  console.log(`  [${source.year} 年度] ${yearFileName(source.year)} 係数定義 ${rows.length} 件`);
  console.log(`    電気: 小売${data.denki.retailerCount}事業者 ${data.denki.retailers.length}行 / 送配電${data.denki.gridOperators.length}社`);
  console.log(
    `    ガス: ${data.gasProviders.length}行 / 熱: ${data.heatProviders.length}行 / 燃料: ${data.fuels.length}行 / Scope3: ${data.scope3.length}行`,
  );
}
console.log(`  後始末: ${CLEANUP_FILE_NAME}（収録年度の最大値 ${Math.max(...YEARS)} より後の参照の無い行を削除）`);
if (removed.length > 0) {
  console.log(`  削除した以前の生成物: ${removed.join(', ')}`);
}
