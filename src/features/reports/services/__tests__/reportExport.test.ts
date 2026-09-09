import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentToRows, buildReportFileName, buildReportPrintUrl, openReportPrintView } from '../reportExport';
import type { ReportDocument } from '../reportContent';

const sampleDocument: ReportDocument = {
  documentTitle: '2024年度_年度温室効果ガス排出サマリ',
  reportTypeLabel: '年度温室効果ガス排出サマリ',
  fiscalYearLabel: '2024年度',
  generatedAt: '2026-07-15T09:30:00.000Z',
  meta: [{ label: '対象年度', value: '2024年度' }],
  sections: [
    {
      heading: '排出量サマリ',
      note: 'テスト用ノート',
      columns: ['区分', '排出量 (t-CO2e)', '構成比'],
      rows: [
        ['Scope 1', 12.3456, '25.0%'],
        // エスケープ（RFC4180 / フォーミュラインジェクション対策）は lib/files/csv 側の責務のため、
        // 変換ではセル値をそのまま保持することを確認する
        ['東京, 本社\n"A"', 0, '0.0%'],
      ],
    },
  ],
};

describe('documentToRows', () => {
  const rows = documentToRows(sampleDocument);

  it('数値は小数3桁までに丸め、数値型のまま出力する（Excelが数値と認識できる）', () => {
    expect(rows).toContainEqual(['Scope 1', 12.346, '25.0%']);
  });

  it('整数はそのまま（小数点なし）', () => {
    expect(rows).toContainEqual(['東京, 本社\n"A"', 0, '0.0%']);
  });

  it('文字列セルはエスケープせずそのまま保持する（エスケープは lib/files/csv 側で行う）', () => {
    const cell = rows.flat().find(value => typeof value === 'string' && value.includes('東京'));
    expect(cell).toBe('東京, 本社\n"A"');
  });

  it('タイトル・メタ情報・見出し・列ヘッダを含み、空行でセクションを区切る', () => {
    expect(rows[0]).toEqual(['2024年度_年度温室効果ガス排出サマリ']);
    expect(rows[1]).toEqual(['対象年度', '2024年度']);
    expect(rows[2]).toEqual([]);
    expect(rows).toContainEqual(['排出量サマリ']);
    expect(rows).toContainEqual(['区分', '排出量 (t-CO2e)', '構成比']);
  });
});

describe('buildReportFileName', () => {
  it('禁止文字を除去し日時付きの拡張子付きファイル名を生成する', () => {
    const name = buildReportFileName(sampleDocument, 'csv');
    expect(name).toMatch(/^2024年度_年度温室効果ガス排出サマリ_\d{8}-\d{4}\.csv$/);
  });
});

describe('buildReportPrintUrl', () => {
  it('拠点があれば locations クエリにカンマ区切りで載せる', () => {
    const url = buildReportPrintUrl({
      reportType: 'location_breakdown',
      fiscalYearId: 'fy-1',
      locationIds: ['loc-a', 'loc-b'],
    });
    expect(url).toBe('/reports/print?type=location_breakdown&fiscalYearId=fy-1&locations=loc-a%2Cloc-b');
  });

  it('拠点が空（Scope 3 詳細など）なら locations クエリを付けない', () => {
    const url = buildReportPrintUrl({
      reportType: 'scope3_detail',
      fiscalYearId: 'fy-1',
      locationIds: [],
    });
    expect(url).toBe('/reports/print?type=scope3_detail&fiscalYearId=fy-1');
  });
});

describe('openReportPrintView', () => {
  const input = { reportType: 'annual_summary' as const, fiscalYearId: 'fy-1', locationIds: [] };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('タブを開けたら true を返し、opener を切る（noopener 相当）', () => {
    const opened = { opener: {} as unknown } as Window;
    const open = vi.fn(() => opened);
    vi.stubGlobal('window', { open });

    expect(openReportPrintView(input)).toBe(true);
    // 'noopener' を features に渡すと成功時も null になり判別できないため、渡していないこと
    expect(open).toHaveBeenCalledWith('/reports/print?type=annual_summary&fiscalYearId=fy-1', '_blank');
    expect(opened.opener).toBeNull();
  });

  it('ポップアップブロック等で開けなかったら false を返す', () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });

    expect(openReportPrintView(input)).toBe(false);
  });
});
