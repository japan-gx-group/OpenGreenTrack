import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_FACTOR_UNIQUE_ERROR_MESSAGE,
  ACTIVE_FACTOR_UNIQUE_INDEX_NAMES,
  ENERGY_VALUE_BY_LABEL,
  getEmissionFactorMutationErrorMessage,
  toFactorFormValues,
  toMutationRow,
  type EmissionFactor,
} from '../factorService';

// V-FAC-002（active 係数の一意性）を担保する部分一意インデックスの定義元
const ACTIVE_UNIQUE_MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/20260831000000_schema.sql',
);

describe('getEmissionFactorMutationErrorMessage', () => {
  it('V-FAC-002 の一意制約違反をユーザー向け文言へ変換する', () => {
    const message = getEmissionFactorMutationErrorMessage(
      {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "emission_factors_active_custom_org_key_idx"',
        details: 'Key already exists.',
      },
      '排出係数の登録に失敗しました',
    );

    expect(message).toBe(ACTIVE_FACTOR_UNIQUE_ERROR_MESSAGE);
  });

  it('公式 utility 係数用の一意制約違反も同じ文言へ変換する', () => {
    const message = getEmissionFactorMutationErrorMessage(
      {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "emission_factors_active_official_utility_key_idx"',
      },
      '排出係数の更新に失敗しました',
    );

    expect(message).toBe(ACTIVE_FACTOR_UNIQUE_ERROR_MESSAGE);
  });

  it('拠点固有カスタム係数用の一意制約違反も同じ文言へ変換する', () => {
    const message = getEmissionFactorMutationErrorMessage(
      {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "emission_factors_active_custom_location_key_idx"',
      },
      '排出係数の更新に失敗しました',
    );

    expect(message).toBe(ACTIVE_FACTOR_UNIQUE_ERROR_MESSAGE);
  });

  it('別のDBエラーは既存のフォールバック文言を維持する', () => {
    const message = getEmissionFactorMutationErrorMessage(
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "other_unique_idx"',
      },
      '排出係数の登録に失敗しました',
    );

    expect(message).toBe('排出係数の登録に失敗しました');
  });
});

// インデックス名は SQL と TS で二重管理になっており、片方だけ変えても
// 上のテストは同じ文字列をハードコードしているため緑のまま通ってしまう。
// その状態では 23505 が V-FAC-002 の文言へ変換されず汎用エラーになるので、
// マイグレーションSQLとの一致をここで担保する。
// スキーマ SQL には他テーブルの unique index も同居するため、
// 対象は emission_factors_active_ で始まる unique index に限定する。
describe('ACTIVE_FACTOR_UNIQUE_INDEX_NAMES', () => {
  const migrationSql = readFileSync(ACTIVE_UNIQUE_MIGRATION_PATH, 'utf8');

  it.each(ACTIVE_FACTOR_UNIQUE_INDEX_NAMES)(
    'マイグレーションSQLに %s が定義されている',
    indexName => {
      // 名前の後ろに `on` が続くことで、前方一致（〜_idx2 など）ではなく完全一致を確認する
      expect(migrationSql).toMatch(
        new RegExp(`create unique index (if not exists )?${indexName}\\s+on\\s`),
      );
    },
  );

  it('マイグレーションSQLが定義するインデックスをすべて網羅している', () => {
    const definedInSql = [
      ...migrationSql.matchAll(
        /create unique index (?:if not exists )?(emission_factors_active_\S+)/g,
      ),
    ].map(match => match[1]);

    expect(definedInSql.sort()).toEqual([...ACTIVE_FACTOR_UNIQUE_INDEX_NAMES].sort());
  });
});

// Scope3積上げ（scope3_activity）は係数管理のエネルギー種別候補に載せない。
// ENERGY_VALUE_BY_LABEL は係数CSVインポートの種別バリデーション
// （factorCsvImport.ts の isValidEnergyType）の正本なので、ここで除外を担保する。
describe('ENERGY_VALUE_BY_LABEL', () => {
  it('scope3_activity への対応付けを持たない（係数作成UI・CSVの候補から除外）', () => {
    expect(Object.values(ENERGY_VALUE_BY_LABEL)).not.toContain('scope3_activity');
    expect(Object.keys(ENERGY_VALUE_BY_LABEL)).not.toContain('Scope3積上げ');
  });
});

// CSV インポートは検証済みの「ステータス」列を渡してくる。ここで 'active' に固定すると
// 「下書き」「確認中」で取り込んだ行が黙って有効になり算定に使われるため、渡された値を保存する。
describe('toMutationRow', () => {
  const base: Omit<EmissionFactor, 'id'> = {
    name: '都市ガス（自社算定値）',
    energyType: 'ガス',
    scope: 'Scope 1',
    factorValue: 0.00224,
    unit: 't-CO2e/m3',
    applicableYear: 2024,
    region: '全国',
    source: '自社設定',
    status: '有効',
    isCustom: true,
  };

  it('ステータスのラベルを DB の enum 値へ写して保存する', () => {
    expect(toMutationRow(base).status).toBe('active');
    expect(toMutationRow({ ...base, status: '下書き' }).status).toBe('draft');
    expect(toMutationRow({ ...base, status: '確認中' }).status).toBe('pending_review');
    expect(toMutationRow({ ...base, status: 'アーカイブ済み' }).status).toBe('archived');
  });

  // Scope は種別から一意に決まる（calculation/engine/energyTypeScope.ts）。食い違う値が保存できると、
  // 集計は係数の Scope で積むのにデータ充足状況は種別から Scope を判定し、二重基準になる。
  it('Scope はエネルギー種別から決め、渡された値では上書きされない', () => {
    expect(toMutationRow({ ...base, scope: 'Scope 3' }).scope).toBe('scope1');
    expect(toMutationRow({ ...base, energyType: '電気', scope: 'Scope 1' }).scope).toBe('scope2');
    expect(toMutationRow({ ...base, energyType: '水道', scope: 'Scope 1' }).scope).toBe('scope3');
    expect(toMutationRow({ ...base, energyType: '廃棄物', scope: 'Scope 1' }).scope).toBe('scope3');
  });
});

// toMutationRow は「渡された値がすべて」として UPDATE を組み立て、欠けた列へ null を書く。
// 編集フォームの初期値を作る toFactorFormValues が列をこぼすと、その列は保存時に消える。
describe('toFactorFormValues', () => {
  const stored: EmissionFactor = {
    id: 'factor-1',
    name: '電気 再エネメニュー（PPA）',
    energyType: '電気',
    scope: 'Scope 2',
    factorValue: 0.00018,
    unit: 't-CO2/kWh',
    applicableYear: 2026,
    region: '全国',
    source: '自社設定',
    status: '有効',
    isCustom: true,
    effectiveFrom: '2026-04-01',
    effectiveTo: '2027-03-31',
    sourceDocument: '電力購入契約（PPA）契約書 別紙2 排出係数',
    sourceUrl: 'https://example.invalid/ppa-2026',
  };

  it('出典資料名・出典URLを編集フォームへ引き継ぐ', () => {
    const form = toFactorFormValues(stored);

    expect(form.sourceDocument).toBe(stored.sourceDocument);
    expect(form.sourceUrl).toBe(stored.sourceUrl);
  });

  it('係数値だけ変更して保存しても出典情報が消えない', () => {
    const row = toMutationRow({ ...toFactorFormValues(stored), factorValue: 0.00025 });

    expect(row.factorValue).toBe(0.00025);
    expect(row.sourceDocumentName).toBe(stored.sourceDocument);
    expect(row.sourceUrl).toBe(stored.sourceUrl);
  });

  // 個別の列を並べるだけだと、列が増えたときに同じ取りこぼしが再発する。
  // 「フォームを経由しても UPDATE 内容が変わらない」ことで、列の追加漏れをまとめて検知する。
  it('フォームを経由しても保存内容が変わらない（列の載せ替え漏れの検知）', () => {
    // toMutationRow は余分なキー（id）を読まないため、そのまま渡して比較できる。
    const savedDirectly = { ...stored };

    expect(toMutationRow(toFactorFormValues(stored))).toEqual(toMutationRow(savedDirectly));
  });
});
