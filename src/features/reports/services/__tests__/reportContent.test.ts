import { describe, expect, it } from 'vitest';
import {
  buildDataCoverageSection,
  buildReportMeta,
  buildScope3MethodSection,
  coverageScopeForReport,
  splitCoverageByAdoption,
  uncalculatedWarningNote,
} from '../reportContent';
import type { ActivityCoverageRow, Scope3CoverageRow } from '../reportContent';
import type { Scope3Method } from '@/features/scope-analysis/services/scopeAnalysisService';

const methodsOf = (entries: [number, Scope3Method][]): Map<number, Scope3Method> =>
  new Map(entries);

describe('buildScope3MethodSection', () => {
  it('方式未設定のカテゴリは direct として15カテゴリ全行を出力する', () => {
    const section = buildScope3MethodSection({ methods: methodsOf([]), citations: [] });

    expect(section.heading).toBe('Scope 3 算定方法');
    expect(section.columns).toEqual(['カテゴリ', '算定方法']);
    expect(section.rows).toHaveLength(15);
    expect(section.rows[0]).toEqual(['1. 購入した製品・サービス', '直接入力（カテゴリ別排出量の登録値）']);
    // 全カテゴリ direct のときは IDEA の出典注記を付けない。
    expect(section.note).toBeUndefined();
  });

  it('積上げ算定のカテゴリがあれば IDEA 引用表記と GWP モデル名を注記に載せる', () => {
    const section = buildScope3MethodSection({
      methods: methodsOf([[1, 'calculated']]),
      citations: [
        {
          version: 'Ver.4.0 標準版',
          citationText:
            'AIST-IDEA Ver.4.0 標準版 (2026/05/15) 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ',
          gwpModel: '気候変動 IPCC 2021 GWP 100a without LULUCF',
        },
      ],
    });

    expect(section.rows[0][1]).toBe('積上げ算定（IDEA原単位 × 活動量）');
    expect(section.note).toContain('AIST-IDEA Ver.4.0 標準版');
    expect(section.note).toContain('GWPモデル: 気候変動 IPCC 2021 GWP 100a without LULUCF');
    // 出典が「現在 active な版」ではなく算定時の版であることを注記でも明示する。
    expect(section.note).toContain('対象年度の算定に適用した版');
    // ライセンス制約（仕様書 §0.2）: 係数値の一覧を載せない旨を明記する。
    expect(section.note).toContain('係数値）の一覧は本レポートに掲載しない');
  });

  it('版更新をまたいで算定した年度は参照している版をすべて列挙する', () => {
    const section = buildScope3MethodSection({
      methods: methodsOf([[1, 'calculated']]),
      citations: [
        { version: 'Ver.4.0', citationText: 'AIST-IDEA Ver.4.0', gwpModel: 'IPCC 2021 GWP100a' },
        { version: 'Ver.5.0', citationText: 'AIST-IDEA Ver.5.0', gwpModel: 'IPCC 2021 GWP100a' },
      ],
    });

    expect(section.note).toContain('AIST-IDEA Ver.4.0');
    expect(section.note).toContain('AIST-IDEA Ver.5.0');
  });

  it('係数値そのものはどの行にも含めない（ライセンス制約の回帰テスト）', () => {
    const section = buildScope3MethodSection({
      methods: methodsOf([[1, 'calculated'], [4, 'calculated']]),
      citations: [
        { version: 'Ver.4.0', citationText: 'AIST-IDEA Ver.4.0', gwpModel: 'IPCC 2021 GWP100a' },
      ],
    });

    // 行は「カテゴリ名 × 方式ラベル」の2列のみで、数値セルが存在しない。
    for (const row of section.rows) {
      expect(row).toHaveLength(2);
      for (const cell of row) {
        expect(typeof cell).toBe('string');
      }
    }
  });

  it('積上げ採用中に取込情報の取得が失敗した場合はフォールバック注記を出す', () => {
    const section = buildScope3MethodSection({
      methods: methodsOf([[15, 'calculated']]),
      citations: null,
    });

    expect(section.note).toContain('取込情報を取得できませんでした');
  });

  it('積上げ採用中でも IDEA を参照した結果が無ければ出典を載せない', () => {
    const section = buildScope3MethodSection({
      methods: methodsOf([[15, 'calculated']]),
      citations: [],
    });

    // 標準係数だけで算定した年度も引用は空になるため、「結果が無い」とは書かない。
    expect(section.note).toContain('IDEA データベースを参照したものがありません');
    expect(section.note).not.toContain('IDEA データベースに基づく');
  });
});

describe('buildDataCoverageSection', () => {
  it('算定済み・未算定の件数と充足率を出す', () => {
    const section = buildDataCoverageSection({
      rows: [
        { calculatedCount: 8, uncalculatedCount: 2 },
        { calculatedCount: 0, uncalculatedCount: 10 },
      ],
      scopeLabel: '対象拠点の活動量データ',
    });

    expect(section.heading).toBe('データ充足状況');
    expect(section.columns).toEqual(['区分', '件数', '割合']);
    expect(section.rows).toEqual([
      ['算定済み', 8, '40.0%'],
      ['未算定', 12, '60.0%'],
      ['合計', 20, '100.0%'],
    ]);
    // 充足率の限界（件数ベース・未入力は検知不能）を注記で明示する。
    expect(section.note).toContain('対象拠点の活動量データ');
    expect(section.note).toContain('欠落している排出量の規模を表すものではありません');
    expect(section.note).toContain('未入力のデータは検知できません');
  });

  it('未算定があるときだけ解消方法を注記に添える', () => {
    const withUncalculated = buildDataCoverageSection({
      rows: [{ calculatedCount: 5, uncalculatedCount: 1 }],
      scopeLabel: '対象拠点の活動量データ',
    });
    const allCalculated = buildDataCoverageSection({
      rows: [{ calculatedCount: 4, uncalculatedCount: 0 }],
      scopeLabel: '対象拠点の活動量データ',
    });

    expect(withUncalculated.note).toContain('算定を再実行すると解消します');
    expect(allCalculated.rows[1]).toEqual(['未算定', 0, '0.0%']);
    expect(allCalculated.note).not.toContain('算定を再実行すると解消します');
  });

  it('対象データが1件も無くても0除算せず0.0%を出す', () => {
    const section = buildDataCoverageSection({
      rows: [],
      scopeLabel: '対象拠点の活動量データ',
    });

    expect(section.rows).toEqual([
      ['算定済み', 0, '0.0%'],
      ['未算定', 0, '0.0%'],
      ['合計', 0, '0.0%'],
    ]);
  });

  it('算定済みと未算定の割合は必ず合計 100.0% になる（独立に丸めない）', () => {
    // 1/16・15/16 は独立に丸めると 6.3% + 93.8% = 100.1% になる組み合わせ。
    const section = buildDataCoverageSection({
      rows: [{ calculatedCount: 1, uncalculatedCount: 15 }],
      scopeLabel: '対象拠点の活動量データ',
    });

    expect(section.rows[0][2]).toBe('6.3%');
    expect(section.rows[1][2]).toBe('93.7%');
  });

  it('未算定の注記は係数不足以外の原因（同順位競合・算定未実行）も挙げる', () => {
    const section = buildDataCoverageSection({
      rows: [{ calculatedCount: 1, uncalculatedCount: 1 }],
      scopeLabel: '対象拠点の活動量データ',
    });

    expect(section.note).toContain('同順位の係数が複数該当して一意に決まらない');
    expect(section.note).toContain('算定をまだ実行していない');
  });

  it('集計に採用されない活動量は件数・充足率から外し、除外件数を注記に出す', () => {
    const section = buildDataCoverageSection({
      rows: [{ calculatedCount: 4, uncalculatedCount: 0 }],
      scopeLabel: '対象年度・組織全体の Scope 3 活動量データ',
      excludedCount: 10,
    });

    // 除外分は分母にも分子にも入れない（100% と出しつつ1件も反映されていない、を避ける）。
    expect(section.rows).toEqual([
      ['算定済み', 4, '100.0%'],
      ['未算定', 0, '0.0%'],
      ['合計', 4, '100.0%'],
    ]);
    expect(section.note).toContain('10 件');
    expect(section.note).toContain('採用されない');
  });

  it('除外が無ければ採用の注記を出さない', () => {
    const section = buildDataCoverageSection({
      rows: [{ calculatedCount: 4, uncalculatedCount: 0 }],
      scopeLabel: '対象年度・組織全体の Scope 3 活動量データ',
      excludedCount: 0,
    });

    expect(section.note).not.toContain('採用されない');
  });

  it('件数の取得に失敗した場合は数値を出さずフォールバック注記だけを出す', () => {
    const section = buildDataCoverageSection({
      rows: null,
      scopeLabel: '対象拠点の活動量データ',
    });

    expect(section.rows).toEqual([]);
    expect(section.note).toContain('取得できませんでした');
  });
});

describe('splitCoverageByAdoption', () => {
  const row = (energyType: string, counts: [number, number]): ActivityCoverageRow => ({
    locationId: 'loc-1',
    energyType,
    calculatedCount: counts[0],
    uncalculatedCount: counts[1],
  });
  const scope3Row = (
    categoryId: number | null,
    method: Scope3Method,
    counts: [number, number],
  ): Scope3CoverageRow => ({
    categoryId,
    method,
    calculatedCount: counts[0],
    uncalculatedCount: counts[1],
  });

  it('方式が直接入力のカテゴリの Scope 3 は、算定済みでも採用側に入れない', () => {
    const { adopted, excludedCount } = splitCoverageByAdoption({
      // 廃棄物 = カテゴリ5（方式未設定 = direct 既定）、出張 = カテゴリ6（積上げ算定）
      rows: [row('electricity', [6, 1]), row('waste', [10, 0]), row('business_travel', [2, 3])],
      scope3ActivityRows: [],
      methods: new Map([[6, 'calculated']]),
    });

    expect(adopted).toEqual([row('electricity', [6, 1]), row('business_travel', [2, 3])]);
    expect(excludedCount).toBe(10);
  });

  it('IDEA 積上げ明細はカテゴリ×方式の件数で数え、拠点×種別の行からは外す', () => {
    const { adopted, excludedCount } = splitCoverageByAdoption({
      // 拠点×種別側の scope3_activity 行は二重計上になるため使わない。
      rows: [row('scope3_activity', [11, 0])],
      scope3ActivityRows: [
        scope3Row(1, 'direct', [10, 0]),
        scope3Row(4, 'calculated', [3, 2]),
        // カテゴリ未設定の明細はどのカテゴリの採用値にもならない。
        scope3Row(null, 'direct', [1, 0]),
      ],
      methods: new Map([[4, 'calculated']]),
    });

    expect(adopted).toEqual([scope3Row(4, 'calculated', [3, 2])]);
    expect(excludedCount).toBe(11);
  });

  it('取得に失敗した側があれば null を伝播し、除外件数は 0 にする', () => {
    expect(
      splitCoverageByAdoption({ rows: null, scope3ActivityRows: [], methods: new Map() }),
    ).toEqual({ adopted: null, excludedCount: 0 });
    expect(
      splitCoverageByAdoption({ rows: [], scope3ActivityRows: null, methods: new Map() }),
    ).toEqual({ adopted: null, excludedCount: 0 });
  });
});

describe('uncalculatedWarningNote', () => {
  it('未算定が無ければ警告を付けない', () => {
    expect(uncalculatedWarningNote(0)).toBeUndefined();
  });

  it('未算定があれば件数と「含まれていない」旨を示す', () => {
    const note = uncalculatedWarningNote(3);
    expect(note).toContain('3 件');
    expect(note).toContain('含まれていません');
  });
});

describe('buildReportMeta', () => {
  const base = {
    reportTypeLabel: 'テスト',
    fiscalYearLabel: '2024年度',
    selectedLocationCount: 1,
    generatedAt: '2026-07-15T09:30:00.000Z',
  };

  it('拠点選択を使う種別は選択した拠点数を印字する', () => {
    const meta = buildReportMeta({ ...base, reportType: 'annual_summary' });
    expect(meta).toContainEqual({ label: '対象拠点数', value: '1 拠点' });
  });

  it('Scope 3 詳細は拠点選択を使わないため拠点数ではなく「組織全体」を印字する', () => {
    const meta = buildReportMeta({ ...base, reportType: 'scope3_detail' });
    expect(meta).toContainEqual({ label: '対象拠点', value: '組織全体' });
    expect(meta.some(item => item.label === '対象拠点数')).toBe(false);
  });
});

describe('coverageScopeForReport', () => {
  const row = (locationId: string, energyType: string): ActivityCoverageRow => ({
    locationId,
    energyType,
    calculatedCount: 0,
    uncalculatedCount: 1,
  });

  const rows: ActivityCoverageRow[] = [
    row('loc-1', 'electricity'),
    row('loc-2', 'electricity'),
    row('loc-1', 'waste'),
    row('loc-2', 'business_travel'),
    row('loc-2', 'business_travel_commuting'),
    row('loc-2', 'scope3_activity'),
  ];

  const pick = (reportType: Parameters<typeof coverageScopeForReport>[0]['reportType']): string[] =>
    rows
      .filter(coverageScopeForReport({ reportType, locationIds: ['loc-1'] }).predicate)
      .map(item => `${item.locationId}/${item.energyType}`);

  it('年次サマリは Scope 3 の種別を拠点に関わらず数える（選択外拠点の出張・通勤・廃棄物を見逃さない）', () => {
    // Scope 3 は組織全体の集計値がレポートに載るため、選択外の loc-2 の未算定も対象にする。
    expect(pick('annual_summary')).toEqual([
      'loc-1/electricity',
      'loc-1/waste',
      'loc-2/business_travel',
      'loc-2/business_travel_commuting',
      'loc-2/scope3_activity',
    ]);
  });

  it('Scope 3 詳細は拠点で絞らず Scope 3 の種別だけを数える', () => {
    expect(pick('scope3_detail')).toEqual([
      'loc-1/waste',
      'loc-2/business_travel',
      'loc-2/business_travel_commuting',
      'loc-2/scope3_activity',
    ]);
  });

  it('拠点別は集計表が Scope 1・2 限定のため選択拠点の Scope 3 種別を除く', () => {
    // 算定しても拠点別排出量（Scope 1・2）の表には入らない明細を警告件数に含めない。
    expect(pick('location_breakdown')).toEqual(['loc-1/electricity']);
  });

  it('注記の集計範囲は種別ごとに書き分ける', () => {
    const labelOf = (reportType: Parameters<typeof coverageScopeForReport>[0]['reportType']): string =>
      coverageScopeForReport({ reportType, locationIds: ['loc-1'] }).scopeLabel;

    expect(labelOf('annual_summary')).toBe(
      '対象拠点の Scope 1・2 活動量データおよび組織全体の Scope 3 活動量データ',
    );
    expect(labelOf('scope3_detail')).toBe('対象年度・組織全体の Scope 3 活動量データ');
    expect(labelOf('location_breakdown')).toBe('対象拠点の Scope 1・2 活動量データ');
  });
});
