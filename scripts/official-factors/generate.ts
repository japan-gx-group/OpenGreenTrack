// 公式排出係数マスタのシードSQL（supabase/seeds/production/）を生成するスクリプト。
//
// 実行: node scripts/official-factors/generate.ts
// 出力: supabase/seeds/production/official_emission_factors.sql
//
// 生成物は GreenTrack の初期データのうち、本番環境にも投入する共通マスタ（seed）。
// データはスキーマ定義ファイルではなく seed として管理する（AGENTS.md R12）。投入方法:
//   ローカル DB 作り直し      : npx supabase db reset（config.toml [db.seed].sql_paths で自動投入）
//   稼働中ローカル DB へ再投入: npm run db:seed:production（= node scripts/db/seed.ts production）
//   クラウド                  : npx supabase db push --include-seed
//   任意の DB（自前ホストなど）: npm run db:seed:production -- --db-url postgresql://…（ホストの psql を使用）
//
// データソース（data/ 配下。取得元は各ファイルのヘッダコメント参照）:
//   denki.txt  : 電気事業者別排出係数（pdftotext -layout の生テキストをパース）
//   gas.tsv    : ガス事業者別排出係数（手書き転記）
//   heat.tsv   : 熱供給事業者別排出係数（手書き転記）
//   fuels.tsv  : 燃料の使用に関する排出係数（算定省令別表、手書き転記）
//   scope3.tsv : Scope3 代表排出原単位（排出原単位DB Ver.3.6 から厳選・手書き転記）
//
// 出力は決定的で、再実行しても同一のSQLになる。ID は行の安定キー（FactorSeedRow.idKey: 事業者別は
// energyType + 登録番号 + メニュー名 + 係数種別、代替値は energyType、燃料・Scope3 は TSV の key 列）と
// 年度から導出した md5 ベース UUID で、名称・値・出典を訂正しても同じ ID のまま。
// 生成SQLは on conflict (id) do update の upsert なので、値・出典・名称の訂正は data/ を直して再生成し、
// 再投入すれば既存行に反映される（既存行の訂正もこの seed の再投入で行う）。status は上書きせず、
// 変更のない行は更新しない（where … is distinct from）ので updatedAt が動くのは値が変わった行だけ。
// 年度更新時は data/ を差し替えて YEARS に新年度を足し、再生成して再投入する。過年度行の archive が
// 必要な場合も、冪等な文としてこの seed に出力する（手順は README.md）。
// 未公表年度ぶんの行は作らない（理由は YEARS のコメントを参照）。

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  parseDenki,
  parseProviderTsv,
  parseSimpleTsv,
  type ProviderFactorRow,
} from './parse.ts';

const DATA_DIR = join(import.meta.dirname, 'data');
const OUTPUT_PATH = join(
  import.meta.dirname,
  '../../supabase/seeds/production/official_emission_factors.sql',
);

// 収録する適用年度。**公表資料が存在する年度だけ**を入れる。
// 同じ値を翌年度へコピーしないこと: コピー行は「正式な当該年度係数」と DB 上で見分けが付かず、
// 公表後に正式値へ差し替えたことを誰も検知できない。
// 対象年度の係数が無い間は、算定側が直近の過年度（PROVISIONAL_FALLBACK_YEARS = 1 年前まで）の
// 公式係数を暫定適用し、入力フォームに「暫定適用」と理由を表示する（resolveEmissionFactor の
// effectiveYearsFor / isProvisionalFactor）。公表され次第 data/ を差し替えてこの配列へ年度を足せば、
// 暫定適用は自動的に止まる（表示の消し忘れが起きない）。
// 過年度の行は消さずに残す（過年度の再算定・監査で参照するため）。
const YEARS = [2025] as const;

const SOURCE_URL_SHK = 'https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html';
const SOURCE_URL_SCOPE3 =
  'https://www.env.go.jp/earth/ondanka/supply_chain/gvc/estimate_05.html';

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

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`検証エラー: ${message}`);
  }
};

const rows: FactorSeedRow[] = [];

// --- 電気（事業者別・一般送配電・代替値） ---------------------------------

const denkiDoc =
  '電気事業者別排出係数（特定排出者の温室効果ガス排出量算定用）－R6年度実績－ R8.1.9 環境省・経済産業省公表（R8.6.4一部更新）';

const denki = parseDenki(readFileSync(join(DATA_DIR, 'denki.txt'), 'utf8'));

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

// パース結果の妥当性検証（公表資料と突合したスポットチェック）
assert(denki.retailerCount >= 400, `小売電気事業者数が少なすぎます: ${denki.retailerCount}`);
assert(denki.retailers.length >= 1000, `電気の係数行が少なすぎます: ${denki.retailers.length}`);
assert(denki.gridOperators.length === 10, `一般送配電事業者は10社のはず: ${denki.gridOperators.length}`);
assert(denki.substituteValue === 0.000416, `電気の代替値が想定と異なります: ${denki.substituteValue}`);
const spot = (num: string, menu: string | null): ProviderFactorRow | undefined =>
  denki.retailers.find((r) => r.providerNumber === num && r.menuName === menu);
assert(spot('A0002', null)?.basic === 0.000422, 'A0002 イーレックスの基礎係数が一致しません');
assert(
  spot('A0269', 'メニューM(残差)')?.adjusted === 0.000452,
  'A0269 東京電力EP メニューM(残差) の調整後係数が一致しません',
);
assert(
  denki.gridOperators.find((g) => g.providerName.includes('沖縄'))?.basic === 0.000707,
  '沖縄電力の係数が一致しません',
);

// --- ガス（事業者別・代替値） ---------------------------------------------

const gasDoc =
  'ガス事業者別排出係数（特定排出者の温室効果ガス排出量算定用）－R7年度供給実績－ R8.6.30 環境省・経済産業省公表';
const gasProviders = parseProviderTsv(readFileSync(join(DATA_DIR, 'gas.tsv'), 'utf8'));
assert(new Set(gasProviders.map((p) => p.providerNumber)).size >= 30, 'ガス事業者数が少なすぎます');
assert(
  gasProviders.find((p) => p.providerNumber === 'K0052')?.basic === 2.91,
  'K0052 第一ガスの係数が一致しません',
);
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
  factorValue: 2.05,
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

const heatDoc =
  '熱供給事業者別排出係数（特定排出者の温室効果ガス排出量算定用）－R6年度供給実績－ R8.6.30 環境省・経済産業省公表';
const heatProviders = parseProviderTsv(readFileSync(join(DATA_DIR, 'heat.tsv'), 'utf8'));
assert(new Set(heatProviders.map((p) => p.providerNumber)).size >= 15, '熱供給事業者数が少なすぎます');
assert(
  heatProviders.find((p) => p.providerNumber === '032')?.basic === 0.0584,
  '032 ハウステンボス熱供給の係数が一致しません',
);
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
  factorValue: 0.0532,
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

const fuelsDoc =
  '温対法 算定・報告・公表制度「算定方法・排出係数一覧」（参考1）燃料の使用に関する排出係数（算定省令別表第1×別表2×44/12）';
const fuels = parseSimpleTsv(readFileSync(join(DATA_DIR, 'fuels.tsv'), 'utf8'));
assert(fuels.length === 35, `燃料は35種のはず: ${fuels.length}`);
assert(fuels.find((f) => f.name === '灯油')?.value === 2.5, '灯油の係数が一致しません');
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

const scope3Doc =
  'サプライチェーンを通じた組織の温室効果ガス排出等の算定のための排出原単位データベース Ver.3.6（2026年4月 環境省公表）';
const scope3 = parseSimpleTsv(readFileSync(join(DATA_DIR, 'scope3.tsv'), 'utf8'));
assert(scope3.length >= 40, `Scope3原単位が少なすぎます: ${scope3.length}`);
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

// --- SQL生成 ---------------------------------------------------------------

// numeric(12,6) に収まることを確認（小数第7位以下があると黙って丸められるため弾く）
for (const row of rows) {
  assert(
    Math.round(row.factorValue * 1e6) / 1e6 === row.factorValue,
    `係数値が小数6桁を超えています: ${row.name} = ${row.factorValue}`,
  );
  assert(row.name.length <= 200, `係数名が200文字を超えています: ${row.name}`);
}

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

// 安定キーが重複していると 2 行が同じ ID になり、upsert で片方が黙って消えるため先に検出する
const seenKeys = new Set<string>();
for (const row of rows) {
  assert(!seenKeys.has(row.idKey), `安定キーが重複しています: ${row.idKey}（${row.name}）`);
  seenKeys.add(row.idKey);
}

const sqlRows: SqlRow[] = [];
for (const year of YEARS) {
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
const statements: string[] = [];
for (let i = 0; i < sqlRows.length; i += CHUNK_SIZE) {
  const chunk = sqlRows.slice(i, i + CHUNK_SIZE);
  statements.push(
    `insert into emission_factors as ef\n  (id, "organizationId", name, "energyType", scope, "factorValue", unit, "applicableYear", "regionName", source, status, "isCustom", "providerName", "providerNumber", "menuName", "factorType", "effectiveFrom", "effectiveTo", "sourceDocumentName", "sourceUrl")\nvalues\n${chunk.map(toValuesTuple).join(',\n')}\n${conflictClause}`,
  );
}

const header = `-- 公式排出係数マスタ（GreenTrack の初期データ。本番環境にも投入する共通マスタ）
-- scripts/official-factors/generate.ts による自動生成。手編集しないこと（修正は data/ を直して再生成する）。
--
-- 出典と権利（再配布時もこの表示を保持すること。詳細はリポジトリ直下の NOTICE）:
--   電気・ガス・熱の事業者別排出係数: 「温室効果ガス排出量 算定・報告・公表制度」
--     （環境省・経済産業省 ${SOURCE_URL_SHK} ）を加工して作成
--   Scope3 排出原単位: 「サプライチェーンを通じた組織の温室効果ガス排出等の算定のための
--     排出原単位データベース Ver.3.6」（環境省
--     ${SOURCE_URL_SCOPE3} ）を加工して作成
--   燃料の排出係数: 算定省令別表に基づく（法令。著作権法第13条により権利の目的とならない）
--   加工（公表 PDF からの抽出・転記・単位換算・DB 形式への再構成）の主体は Japan GX Group であり、
--   加工後の値について環境省・経済産業省その他の公表元は責任を負わない。値は原典で確認すること。
--   環境省ウェブサイトの利用規約（公共データ利用規約（第1.0版） https://www.env.go.jp/mail.html ）に基づき利用。
--   このデータは Apache License 2.0 の対象ではない（原典に対する権利は各公表元に帰属する）。ただし上記規約は
--   CC BY 4.0 と互換で、出典と加工した旨を表示すれば商用利用・改変・再配布ができる。
--
-- 投入方法:
--   ローカル DB 作り直し      : npx supabase db reset（config.toml [db.seed].sql_paths で自動投入）
--   稼働中ローカル DB へ再投入: npm run db:seed:production（= node scripts/db/seed.ts production）
--   クラウド                  : npx supabase db push --include-seed
--   任意の DB（自前ホストなど）: npm run db:seed:production -- --db-url postgresql://…（ホストの psql を使用）、
--                              または Dashboard の SQL Editor でこのファイルを実行する
--
-- 収録内容（applicableYear ${YEARS.join('・')}。公表資料のある年度のみ）:
--   電気   : 電気事業者別排出係数 小売${denki.retailerCount}事業者（メニュー別・基礎/調整後）+ 一般送配電10社 + 代替値 0.000416 t-CO2/kWh
--   都市ガス: ガス事業者別排出係数 ${new Set(gasProviders.map((p) => p.providerNumber)).size}事業者 + 代替値 2.05 t-CO2/千m3
--   熱     : 熱供給事業者別排出係数 ${new Set(heatProviders.map((p) => p.providerNumber)).size}事業者 + 代替値 0.0532 t-CO2/GJ
--   燃料   : 算定省令別表の燃料${fuels.length}種（scope1）
--   Scope3 : 排出原単位DB Ver.3.6 の代表原単位${scope3.length}件
--
-- organizationId は null（全組織共通・読み取り専用。emission_factors のテーブル定義は
-- 20260831000000_schema.sql、全組織から読める RLS ポリシーは 20260831000001_rls.sql を参照）。
-- 事業者別係数（providerName あり）は自動解決の対象外で、手動入力の明示選択専用。
-- ID は行の安定キー（事業者別: energyType + 登録番号 + メニュー名 + 係数種別 / 代替値: energyType /
-- 燃料・Scope3: energyType + data/*.tsv の key 列）と年度から決定的に導出した md5 ベース UUID。
-- 再投入は on conflict (id) do update の upsert で冪等で、値・出典・名称・有効期間の訂正は
-- 「data/ を直して再生成 → 再投入」で既存行に反映される（データの訂正はスキーマ定義ファイルに書かず seed で行う: AGENTS.md R12）。
-- 変更のない行は where … is distinct from で更新をスキップするため、再投入で updatedAt が動くのは値が変わった行だけ。
-- status は上書きしない（運用で archived にした行を再投入で active に戻さないため）。
-- updatedAt は set_emission_factors_updated_at トリガーが更新する。
-- 公表資料のある年度の行だけを作る（未公表年度の行は作らない）。対象年度の係数が無い間は算定側
-- （resolveEmissionFactor の effectiveYearsFor）が直近の過年度を暫定適用し、入力フォームに「暫定適用」と
-- 理由を表示する。
-- 末尾の delete は、以前の版が作っていた翌年度コピー行の後始末（収録年度より後の公式係数行のうち、
-- 算定結果・活動量からの参照が energyType・年度ごとに 1 件も無いものだけを消す。冪等）。
-- 年度更新時は data/ を更新して再生成し、再投入する（手順は scripts/official-factors/README.md）。

`;

// 収録年度より後の公式係数行の後始末。
// 以前の版は「翌年度公表までのつなぎ」として同じ値を翌年度にもコピー登録していた（以前の seed は
// 2025 年度と同値の 2026 年度行を持つ）が、正式な当該年度係数と区別できないため取りやめた。
// 既存 DB に残っているコピー行は active のままだと「その年度の正式係数」として解決され、暫定適用も
// 「暫定適用」の表示も効かなくなるため、ここで消す。
// archive ではなく delete にする理由: 行 ID は「安定キー + 年度」から決定的に導出するので、将来その年度が
// 正式公表されたときの行は**同じ ID**になる。archived にすると status は upsert の上書き対象外（運用で
// archived にした行を戻さないため）なので、正式値を投入しても archived のまま残り不可視になる。
// 条件を「収録年度の最大値より後」に限ることで、YEARS に新年度を足せばこの文は自動的に何も消さなくなる。
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
// 動き、その年度が正式公表されて YEARS に足されれば同じ ID の upsert で正式値に上書きされて解消する。
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

writeFileSync(OUTPUT_PATH, header + statements.join('\n\n') + '\n\n' + cleanupStatement + '\n');

console.log(`生成完了: ${OUTPUT_PATH}`);
console.log(`  係数定義: ${rows.length} 件 × ${YEARS.length} 年度 = ${sqlRows.length} 行`);
console.log(`  電気: 小売${denki.retailerCount}事業者 ${denki.retailers.length}行 / 送配電${denki.gridOperators.length}社`);
console.log(`  ガス: ${gasProviders.length}行 / 熱: ${heatProviders.length}行 / 燃料: ${fuels.length}行 / Scope3: ${scope3.length}行`);
