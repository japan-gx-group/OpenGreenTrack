import { describe, it, expect } from 'vitest';
import {
  LOCATION_CSV_EXAMPLE_PREFIX,
  LOCATION_CSV_HEADERS,
  buildLocationCsvTemplateRows,
  buildLocationImportPlan,
  locationToCsvRow,
} from '../locationCsvImport';
import type { LocationRecord } from '../../types';

// エクスポート（downloadCsv）と同じタブ区切りでCSVテキストを組み立てるヘルパー
const csv = (rows: string[][]): string =>
  [[...LOCATION_CSV_HEADERS], ...rows].map(row => row.join('\t')).join('\r\n');

const existing: LocationRecord[] = [
  {
    id: 'loc-1',
    name: '大阪支社',
    region: 'Kansai',
    type: 'branch',
    person: '支社 花子',
    status: 'active',
  },
  {
    id: 'loc-2',
    name: '横浜研究所',
    region: 'Kanto',
    type: 'other',
    person: '研究 三郎',
    status: 'active',
  },
];

describe('buildLocationImportPlan', () => {
  it('ID列が空で拠点名が既存にない行は新規追加になる', () => {
    const plan = buildLocationImportPlan(
      csv([['', '仙台営業所', '東北', '支社', '営業 十郎', '稼働中']]),
      existing,
    );

    expect(plan.errors).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toEqual([
      {
        row: 2,
        location: {
          name: '仙台営業所',
          region: 'Tohoku',
          type: 'branch',
          person: '営業 十郎',
          status: 'active',
        },
      },
    ]);
  });

  it('ID列で既存拠点を特定して更新する', () => {
    const plan = buildLocationImportPlan(
      csv([['loc-1', '大阪支社', '関西', '支社', '新 担当', '稼働中']]),
      existing,
    );

    expect(plan.errors).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('loc-1');
    expect(plan.updates[0].location.person).toBe('新 担当');
  });

  it('ID列が空でも拠点名が一致すれば更新になる（テンプレート経由の二重登録を防ぐ）', () => {
    const plan = buildLocationImportPlan(
      csv([['', '横浜研究所', '関東', '工場', '研究 三郎', '稼働中']]),
      existing,
    );

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('loc-2');
    expect(plan.updates[0].location.type).toBe('factory');
  });

  it('内容が既存と同じ行はスキップする', () => {
    const plan = buildLocationImportPlan(
      csv([['loc-1', '大阪支社', '関西', '支社', '支社 花子', '稼働中']]),
      existing,
    );

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipCount).toBe(1);
  });

  it('拠点名の前後空白・全角空白の違いは同じ拠点として扱う', () => {
    const plan = buildLocationImportPlan(
      csv([['', ' 大阪支社 ', '関西', '工場', '支社 花子', '稼働中']]),
      existing,
    );

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('loc-1');
  });

  it('同名拠点が既に複数ある場合は行エラーにしてID列での指定を促す', () => {
    const duplicated: LocationRecord[] = [
      ...existing,
      { ...existing[0], id: 'loc-3', person: '別 担当' },
    ];
    const plan = buildLocationImportPlan(
      csv([['', '大阪支社', '関西', '工場', '新 担当', '稼働中']]),
      duplicated,
    );

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].row).toBe(2);
    expect(plan.errors[0].reasons[0]).toContain('ID列で対象を指定してください');
  });

  it('別の拠点と同名になる改名は行エラーにする（同名拠点を作らせない）', () => {
    const plan = buildLocationImportPlan(
      csv([['loc-2', '大阪支社', '関東', 'その他', '研究 三郎', '稼働中']]),
      existing,
    );

    expect(plan.updates).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].reasons[0]).toContain('別の拠点が既に使っています');
  });

  it('自分自身の名前はそのままでも改名でも更新できる', () => {
    const plan = buildLocationImportPlan(
      csv([['loc-2', '横浜テクニカルセンター', '関東', 'その他', '研究 三郎', '稼働中']]),
      existing,
    );

    expect(plan.errors).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].location.name).toBe('横浜テクニカルセンター');
  });

  it('改名先の名前を同じCSV内で新規追加する行はエラーにする（改名＋追加で同名拠点を作らせない）', () => {
    const plan = buildLocationImportPlan(
      csv([
        ['loc-2', '横浜テクニカルセンター', '関東', 'その他', '研究 三郎', '稼働中'],
        ['', '横浜テクニカルセンター', '関東', 'オフィス', '担当 A', '稼働中'],
      ]),
      existing,
    );

    expect(plan.updates).toHaveLength(1);
    expect(plan.creates).toHaveLength(0);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].row).toBe(3);
    expect(plan.errors[0].reasons[0]).toContain('別の拠点が既に使っています');
  });

  it('2つの既存拠点を同じ名前へ改名する行は後の行をエラーにする', () => {
    const plan = buildLocationImportPlan(
      csv([
        ['loc-1', '統合拠点', '関西', '支社', '支社 花子', '稼働中'],
        ['loc-2', '統合拠点', '関東', 'その他', '研究 三郎', '稼働中'],
      ]),
      existing,
    );

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('loc-1');
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].row).toBe(3);
  });

  it('CSV内に同名の新規行が異なる内容で複数あるとエラーになる', () => {
    const plan = buildLocationImportPlan(
      csv([
        ['', '新規拠点', '関東', 'オフィス', '担当 A', '稼働中'],
        ['', '新規拠点', '関西', '工場', '担当 B', '準備中'],
      ]),
      existing,
    );

    expect(plan.creates).toHaveLength(1);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].row).toBe(3);
  });

  it('選択肢にない値は行エラーになり、正しい選択肢を理由に含める', () => {
    const plan = buildLocationImportPlan(
      csv([['', 'どこかの拠点', '関東地方', '倉庫', '担当', '稼動中']]),
      existing,
    );

    expect(plan.creates).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    const reasons = plan.errors[0].reasons.join('\n');
    expect(reasons).toContain('地域「関東地方」は認識できません');
    expect(reasons).toContain('北海道 / 東北 / 関東');
    expect(reasons).toContain('拠点種別「倉庫」は認識できません');
    expect(reasons).toContain('稼働状況「稼動中」は認識できません');
  });

  it('拠点名が空欄の行はエラーになる', () => {
    const plan = buildLocationImportPlan(
      csv([['', '', '関東', 'オフィス', '担当', '稼働中']]),
      existing,
    );

    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].reasons).toContain('拠点名が空欄です');
  });

  it('Excelで再保存されたカンマ区切りも読める', () => {
    const text = [
      LOCATION_CSV_HEADERS.join(','),
      ',仙台営業所,東北,支社,"営業, 十郎",稼働中',
    ].join('\r\n');

    const plan = buildLocationImportPlan(text, existing);

    expect(plan.errors).toEqual([]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].location.person).toBe('営業, 十郎');
  });

  it('廃止前のフォーマット（Scope対象区分あり）でエクスポートしたファイルも取り込める', () => {
    const legacyHeaders = ['ID', '拠点名', '地域', '拠点種別', '担当者', 'Scope対象区分', '稼働状況'];
    const text = [
      legacyHeaders,
      ['loc-1', '大阪支社', '関西', '支社', '新 担当', 'Scope 1,2,3', '稼働中'],
      ['', '仙台営業所', '東北', '支社', '営業 十郎', '', '稼働中'],
    ]
      .map(row => row.join('\t'))
      .join('\r\n');

    const plan = buildLocationImportPlan(text, existing);

    expect(plan.errors).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('loc-1');
    expect(plan.updates[0].location.person).toBe('新 担当');
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].location).toEqual({
      name: '仙台営業所',
      region: 'Tohoku',
      type: 'branch',
      person: '営業 十郎',
      status: 'active',
    });
  });

  it('廃止前のフォーマットで列が欠けた行は、旧フォーマットの列数（7列）で不足を案内する', () => {
    const legacyHeaders = ['ID', '拠点名', '地域', '拠点種別', '担当者', 'Scope対象区分', '稼働状況'];
    const text = [
      legacyHeaders,
      // 末尾の稼働状況が欠けて6列しかない行
      ['', '仙台営業所', '東北', '支社', '営業 十郎', 'Scope 1,2,3'],
    ]
      .map(row => row.join('\t'))
      .join('\r\n');

    const plan = buildLocationImportPlan(text, existing);

    expect(plan.creates).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].reasons[0]).toBe('列数が足りません（7列必要ですが、6列のみです）');
  });

  it('ヘッダーが一致しないファイルは取込自体を中止する', () => {
    expect(() => buildLocationImportPlan('拠点名\t地域\n大阪支社\t関西', existing)).toThrow(
      /ヘッダー列が一致しません/,
    );
  });

  it('空ファイルは取込自体を中止する', () => {
    expect(() => buildLocationImportPlan('', existing)).toThrow(/CSVファイルが空です/);
  });

  // テンプレートの記入例行を残したまま取り込んでも実拠点として登録しない
  describe('記入例行の除外', () => {
    it('拠点名が「（記入例）」で始まる行は追加せず、除外件数として数える', () => {
      const plan = buildLocationImportPlan(
        csv([
          ['', `${LOCATION_CSV_EXAMPLE_PREFIX}東京本社`, '関東', '本社', '環境 太郎', '稼働中'],
          ['', '仙台営業所', '東北', '支社', '営業 十郎', '稼働中'],
        ]),
        existing,
      );

      expect(plan.errors).toEqual([]);
      expect(plan.exampleRowCount).toBe(1);
      expect(plan.skipCount).toBe(0);
      expect(plan.creates.map(create => create.location.name)).toEqual(['仙台営業所']);
    });

    it('半角括弧の「(記入例)」や前後の空白があっても記入例として除外する', () => {
      const plan = buildLocationImportPlan(
        csv([[' ', ' (記入例)東京本社 ', '関東', '本社', '環境 太郎', '稼働中']]),
        existing,
      );

      expect(plan.exampleRowCount).toBe(1);
      expect(plan.creates).toEqual([]);
    });

    it('記入例行は他の列が不正でもエラーにせず除外する', () => {
      const plan = buildLocationImportPlan(
        csv([['', `${LOCATION_CSV_EXAMPLE_PREFIX}東京本社`, '不明な地域', '本社', '', '稼働中']]),
        existing,
      );

      expect(plan.errors).toEqual([]);
      expect(plan.exampleRowCount).toBe(1);
    });

    it('ID列が入っている行は、拠点名が「（記入例）」で始まっていても既存拠点の更新として扱う', () => {
      const exampleLike: LocationRecord = {
        id: 'loc-3',
        name: `${LOCATION_CSV_EXAMPLE_PREFIX}展示ルーム`,
        region: 'Kanto',
        type: 'other',
        person: '展示 一郎',
        status: 'active',
      };
      const plan = buildLocationImportPlan(
        csv([['loc-3', `${LOCATION_CSV_EXAMPLE_PREFIX}展示ルーム`, '関東', 'その他', '展示 一郎', '一時停止']]),
        [...existing, exampleLike],
      );

      expect(plan.exampleRowCount).toBe(0);
      expect(plan.errors).toEqual([]);
      expect(plan.updates).toHaveLength(1);
      expect(plan.updates[0].targetId).toBe('loc-3');
      expect(plan.updates[0].location.status).toBe('paused');
    });

    it('「記入例」が拠点名の途中に含まれるだけの行は通常の行として扱う', () => {
      const plan = buildLocationImportPlan(
        csv([['', '記入例センター', '関東', 'オフィス', '担当 者', '稼働中']]),
        existing,
      );

      expect(plan.exampleRowCount).toBe(0);
      expect(plan.creates).toHaveLength(1);
    });
  });
});

describe('buildLocationCsvTemplateRows', () => {
  it('エクスポートと同じヘッダーで始まり、記入例の行は取り込んでも除外される', () => {
    const rows = buildLocationCsvTemplateRows();

    expect(rows[0]).toEqual([...LOCATION_CSV_HEADERS]);

    const plan = buildLocationImportPlan(rows.map(row => row.join('\t')).join('\r\n'), existing);
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.exampleRowCount).toBe(1);
  });

  it('記入例の拠点名を書き換えれば、他の列はそのまま取り込める値になっている', () => {
    const [headers, example] = buildLocationCsvTemplateRows();
    const filled = [...example];
    filled[1] = '東京本社';

    const plan = buildLocationImportPlan([headers, filled].map(row => row.join('\t')).join('\r\n'), existing);
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toHaveLength(1);
  });
});

// エクスポートした CSV をそのまま取り込めること（ラウンドトリップ）。
// 列の並びが出力側とインポート側でずれると、エクスポートしたファイルが
// ヘッダー不一致・列数不足で弾かれるため、ここで固定する。
describe('locationToCsvRow', () => {
  it('列数がヘッダーと一致する', () => {
    expect(locationToCsvRow(existing[0])).toHaveLength(LOCATION_CSV_HEADERS.length);
  });

  it('エクスポートした内容をそのまま取り込むと、全行が「変更なし」になる', () => {
    const text = [[...LOCATION_CSV_HEADERS], ...existing.map(locationToCsvRow)]
      .map(row => row.join('\t'))
      .join('\r\n');

    const plan = buildLocationImportPlan(text, existing);

    expect(plan.errors).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipCount).toBe(existing.length);
  });
});
