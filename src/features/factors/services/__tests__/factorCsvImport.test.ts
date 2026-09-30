import { describe, it, expect } from 'vitest';
import {
  FACTOR_CSV_HEADERS,
  PROVIDER_FACTOR_IMPORT_ERROR,
  buildFactorImportPlan,
  decodeFactorCsvBuffer,
  parseFactorCsvText,
  factorToCsvRow,
} from '../factorCsvImport';
import type { EmissionFactor } from '../factorService';

// エクスポート（downloadCsv）と同じタブ区切りでCSVテキストを組み立てるヘルパー
const tsv = (rows: (string | number)[][]): string =>
  [FACTOR_CSV_HEADERS.join('\t'), ...rows.map(row => row.join('\t'))].join('\r\n');

// カンマ区切り（Excelで再保存した想定）のヘルパー
const csv = (rows: (string | number)[][]): string =>
  [FACTOR_CSV_HEADERS.join(','), ...rows.map(row => row.join(','))].join('\n');

// 既存係数のフィクスチャ
const customFactor: EmissionFactor = {
  id: 'custom-1',
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
  effectiveFrom: '2024-04-01',
};

const standardFactor: EmissionFactor = {
  id: 'std-1',
  name: '電気（調整後排出係数）',
  energyType: '電気',
  scope: 'Scope 2',
  factorValue: 0.000441,
  unit: 't-CO2e/kWh',
  applicableYear: 2024,
  region: '全国',
  source: '電気事業者別排出係数',
  status: '有効',
  isCustom: false,
  providerName: '東京電力エナジーパートナー株式会社',
  factorType: '調整後',
  sourceDocument: '電気事業者別排出係数一覧',
  sourceUrl: 'https://example.com/factors',
};

// 事業者に紐付かない標準係数（全国の代替値）。CSV からカスタム係数で上書きできる側。
const nationalStandardFactor: EmissionFactor = {
  id: 'std-national-1',
  name: '電気（全国平均・代替値）',
  energyType: '電気',
  scope: 'Scope 2',
  factorValue: 0.000434,
  unit: 't-CO2e/kWh',
  applicableYear: 2024,
  region: '全国',
  source: '環境省',
  status: '有効',
  isCustom: false,
  sourceDocument: '算定方法・排出係数一覧',
};

// customFactor と同じ内容のCSV行（エクスポート出力を模す）
const customRow = (overrides: Partial<Record<'id' | 'name' | 'factorValue' | 'unit' | 'year' | 'status', string | number>> = {}) => [
  overrides.id ?? 'custom-1',
  overrides.name ?? '都市ガス（自社算定値）',
  'ガス',
  'Scope 1',
  overrides.factorValue ?? 0.00224,
  overrides.unit ?? 't-CO2e/m3',
  overrides.year ?? 2024,
  '', // 供給事業者（カスタム係数は空）
  '', // メニュー
  '', // 係数種別
  '自社設定',
  overrides.status ?? '有効',
  'カスタム',
  '',
  '',
];

// standardFactor（事業者別係数）のCSV行。provider* を空にすると事業者列を消した行になる。
const standardRow = (
  overrides: Partial<Record<'id' | 'name' | 'factorValue' | 'providerName' | 'menuName' | 'factorType', string | number>> = {},
) => [
  overrides.id ?? 'std-1',
  overrides.name ?? '電気（調整後排出係数）',
  '電気',
  'Scope 2',
  overrides.factorValue ?? 0.000441,
  't-CO2e/kWh',
  2024,
  overrides.providerName ?? '東京電力エナジーパートナー株式会社',
  overrides.menuName ?? '',
  overrides.factorType ?? '調整後',
  '電気事業者別排出係数',
  '有効',
  '標準',
  '電気事業者別排出係数一覧',
  'https://example.com/factors',
];

// nationalStandardFactor（事業者に紐付かない標準係数）のCSV行
const nationalStandardRow = (overrides: Partial<Record<'id' | 'factorValue', string | number>> = {}) => [
  overrides.id ?? 'std-national-1',
  '電気（全国平均・代替値）',
  '電気',
  'Scope 2',
  overrides.factorValue ?? 0.000434,
  't-CO2e/kWh',
  2024,
  '',
  '',
  '',
  '環境省',
  '有効',
  '標準',
  '算定方法・排出係数一覧',
  '',
];

describe('parseFactorCsvText', () => {
  it('空ファイルはエラーを投げる', () => {
    expect(() => parseFactorCsvText('')).toThrow(/空です/);
  });

  it('ヘッダー列が一致しない場合はエラーを投げる', () => {
    const text = ['係数名,係数値', 'A,1'].join('\n');
    expect(() => parseFactorCsvText(text)).toThrow(/ヘッダー列が一致しません/);
  });

  it('タブ区切り（エクスポート形式）とカンマ区切りの両方をパースできる', () => {
    for (const text of [tsv([customRow()]), csv([customRow()])]) {
      const { rows, errors } = parseFactorCsvText(text);
      expect(errors).toHaveLength(0);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('custom-1');
      expect(rows[0].factor).toMatchObject({
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
      });
    }
  });

  it('ステータス列の値をそのまま取り込む（有効に固定しない）', () => {
    const { rows, errors } = parseFactorCsvText(tsv([customRow({ status: '下書き' })]));
    expect(errors).toHaveLength(0);
    expect(rows[0].factor.status).toBe('下書き');
    // 取込プランでも保持され、既存の有効な係数に対しては「ステータスが変わった」更新になる
    const plan = buildFactorImportPlan(tsv([customRow({ status: '下書き' })]), [customFactor]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].factor.status).toBe('下書き');
  });

  it('ダブルクォート内の区切り文字を列区切りと誤認しない', () => {
    const row = [...customRow({ id: '', name: '"ガス, 補正値"' })];
    const { rows, errors } = parseFactorCsvText(csv([row]));
    expect(errors).toHaveLength(0);
    expect(rows[0].factor.name).toBe('ガス, 補正値');
  });

  it('フォーミュラインジェクション対策の先頭アポストロフィを復元する', () => {
    const row = [...customRow({ id: '', name: "'=補正係数" })];
    const { rows } = parseFactorCsvText(tsv([row]));
    expect(rows[0].factor.name).toBe('=補正係数');
  });

  it('不正な値の行は行番号つきのエラーになり他の行は取り込まれる', () => {
    const badRow = ['', '', '謎エネルギー', 'Scope 9', 'abc', '', '24', '', '', '', '自社設定', '無効', 'カスタム', '', ''];
    const { rows, errors } = parseFactorCsvText(tsv([customRow(), badRow]));

    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    // ヘッダーが1行目なので、2番目のデータ行はファイル内の3行目
    expect(errors[0].row).toBe(3);
    expect(errors[0].reasons).toEqual([
      '係数名が空欄です',
      'エネルギー種別「謎エネルギー」は認識できません',
      '適用範囲「Scope 9」は認識できません（Scope 1 / Scope 2 / Scope 3）',
      '係数値「abc」は0以上の数値として正しくありません',
      '単位が空欄です',
      '適用年度「24」は4桁の西暦年として正しくありません',
      'ステータス「無効」は認識できません（有効 / 確認中 / 下書き / アーカイブ済み）',
    ]);
  });

  // Scope は種別から一意に決まる（calculation/engine/energyTypeScope.ts）。食い違う行を取り込むと、
  // 集計とレポートのデータ充足状況が別々の基準でその排出量を数える。
  it('エネルギー種別と食い違う適用範囲の行は取り込めない', () => {
    const wasteAsScope1 = ['', '廃棄物（自社設定）', '廃棄物', 'Scope 1', 0.5, 't-CO2/t', 2026, '', '', '', '自社設定', '有効', 'カスタム', '', ''];
    const waterAsScope1 = ['', '上水道（自社設定）', '水道', 'Scope 1', 0.00019, 't-CO2e/m3', 2026, '', '', '', '自社設定', '有効', 'カスタム', '', ''];
    const { rows, errors } = parseFactorCsvText(tsv([wasteAsScope1, waterAsScope1]));

    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0].reasons).toEqual(['適用範囲「Scope 1」はエネルギー種別「廃棄物」と一致しません（Scope 3）']);
    expect(errors[1].reasons).toEqual(['適用範囲「Scope 1」はエネルギー種別「水道」と一致しません（Scope 3）']);
  });

  it('種別と一致する適用範囲の行はそのまま取り込む', () => {
    const waterRow = ['', '上水道（自社設定）', '水道', 'Scope 3', 0.00019, 't-CO2e/m3', 2026, '', '', '', '自社設定', '有効', 'カスタム', '', ''];
    const { rows, errors } = parseFactorCsvText(tsv([waterRow]));

    expect(errors).toHaveLength(0);
    expect(rows[0].factor).toMatchObject({ energyType: '水道', scope: 'Scope 3' });
  });

  // Scope3積上げ（scope3_activity）は係数CSVインポートの候補から除外する
  // （IDEA 係数は idea_factors で管理し、emission_factors には登録させない）。
  it('エネルギー種別「Scope3積上げ」の行は取り込めない', () => {
    const scope3Row = ['', 'IDEA係数もどき', 'Scope3積上げ', 'Scope 3', 0.5, 'kg-CO2e/kg', 2026, '', '', '', '自社設定', '有効', 'カスタム', '', ''];
    const { rows, errors } = parseFactorCsvText(tsv([scope3Row]));
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reasons).toContain('エネルギー種別「Scope3積上げ」は認識できません');
  });

  // 通勤係数の種別ラベルは「出張・通勤」→「通勤」に改名した。改名前のエクスポートを再取込できること。
  it('旧ラベル「出張・通勤」の行は「通勤」として取り込む', () => {
    const legacyRow = ['', '通勤 自社調査', '出張・通勤', 'Scope 3', 1.5, 'kg-CO2/人・日', 2026, '', '', '', '自社設定', '有効', 'カスタム', '', ''];
    const { rows, errors } = parseFactorCsvText(tsv([legacyRow]));
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].factor.energyType).toBe('通勤');
  });

  it('列数が足りない行はエラーになる', () => {
    const { rows, errors } = parseFactorCsvText(tsv([['a', 'b', 'c']]));
    expect(rows).toHaveLength(0);
    expect(errors[0].reasons[0]).toMatch(/列数が足りません/);
  });

  it('空行と区切り文字だけの行はスキップする', () => {
    const text = [FACTOR_CSV_HEADERS.join('\t'), '', '\t\t\t\t\t\t\t\t\t\t\t\t\t\t', tsv([customRow()]).split('\r\n')[1]].join('\r\n');
    const { rows, errors } = parseFactorCsvText(text);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
});

describe('buildFactorImportPlan', () => {
  it('既存と重複しない行は新規追加になる', () => {
    const newRow = customRow({ id: '', year: 2025 });
    const plan = buildFactorImportPlan(tsv([newRow]), [customFactor]);

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].factor).toMatchObject({ applicableYear: 2025, isCustom: true, source: '自社設定' });
    expect(plan.updates).toHaveLength(0);
    expect(plan.skipCount).toBe(0);
    expect(plan.errors).toHaveLength(0);
  });

  it('重複キーのカスタム係数と値が同じ行はスキップする', () => {
    const plan = buildFactorImportPlan(tsv([customRow()]), [customFactor]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.skipCount).toBe(1);
    expect(plan.errors).toHaveLength(0);
  });

  it('重複キーのカスタム係数と値が異なる行は更新になり、有効期間を引き継ぐ', () => {
    const changed = customRow({ factorValue: 0.0023, name: '都市ガス（改訂）' });
    const plan = buildFactorImportPlan(tsv([changed]), [customFactor]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('custom-1');
    expect(plan.updates[0].factor).toMatchObject({
      name: '都市ガス（改訂）',
      factorValue: 0.0023,
      // CSVに列がない有効期間は既存値を維持する
      effectiveFrom: '2024-04-01',
    });
    expect(plan.skipCount).toBe(0);
  });

  it('IDが未知でもキー（エネルギー種別+年度+Scope）が一致すれば重複として更新する', () => {
    const changed = customRow({ id: 'unknown-id', factorValue: 0.0025 });
    const plan = buildFactorImportPlan(tsv([changed]), [customFactor]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('custom-1');
  });

  it('標準係数と同値の行はスキップする（エクスポート未編集のラウンドトリップ）', () => {
    const plan = buildFactorImportPlan(tsv([standardRow()]), [standardFactor]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.skipCount).toBe(1);
  });

  it('事業者に紐付かない標準係数の値を変えた行はカスタム係数として新規追加する（RLS上、標準係数は更新不可のため）', () => {
    const changed = nationalStandardRow({ factorValue: 0.0005 });
    const plan = buildFactorImportPlan(tsv([changed]), [nationalStandardFactor]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.errors).toHaveLength(0);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].factor).toMatchObject({
      factorValue: 0.0005,
      isCustom: true,
      source: '自社設定',
    });
  });

  // 1回目の取込で作られたカスタム上書きを、2回目以降は ID が標準係数を指したままでも
  // 見つけて更新/スキップに振り替える。毎回 create を計画すると V-FAC-002 違反で恒久エラーになる。
  it('標準係数を上書きしたカスタム係数が既にあれば、同じファイルの再取込は追加ではなくスキップ/更新になる', () => {
    const changed = nationalStandardRow({ factorValue: 0.0005 });
    const firstPlan = buildFactorImportPlan(tsv([changed]), [nationalStandardFactor]);
    expect(firstPlan.creates).toHaveLength(1);

    // 1回目の取込で DB に保存されたカスタム係数
    const createdCustom: EmissionFactor = { id: 'custom-override-1', ...firstPlan.creates[0].factor };

    const secondPlan = buildFactorImportPlan(tsv([changed]), [nationalStandardFactor, createdCustom]);
    expect(secondPlan.creates).toHaveLength(0);
    expect(secondPlan.updates).toHaveLength(0);
    expect(secondPlan.errors).toHaveLength(0);
    expect(secondPlan.skipCount).toBe(1);

    // さらに値を直した行は、新規追加ではなく既存のカスタム上書きの更新になる
    const changedAgain = nationalStandardRow({ factorValue: 0.0006 });
    const thirdPlan = buildFactorImportPlan(tsv([changedAgain]), [nationalStandardFactor, createdCustom]);
    expect(thirdPlan.creates).toHaveLength(0);
    expect(thirdPlan.errors).toHaveLength(0);
    expect(thirdPlan.updates).toHaveLength(1);
    expect(thirdPlan.updates[0].targetId).toBe('custom-override-1');
    expect(thirdPlan.updates[0].factor.factorValue).toBe(0.0006);
  });

  // 事業者別係数はカスタム係数（事業者に紐付かず組織全体に適用される）で上書きできない。
  // 静かに全レコードの係数を差し替えるのではなく、明示的なエラーで止める。
  describe('事業者別係数の行', () => {
    it('値を変えた行はエラーになり、カスタム係数は作られない', () => {
      const changed = standardRow({ factorValue: 0.0005 });
      const plan = buildFactorImportPlan(tsv([changed]), [standardFactor]);

      expect(plan.creates).toHaveLength(0);
      expect(plan.updates).toHaveLength(0);
      expect(plan.skipCount).toBe(0);
      expect(plan.errors).toEqual([{ row: 2, reasons: [PROVIDER_FACTOR_IMPORT_ERROR] }]);
    });

    it('係数値が同じでも事業者名やメニューだけ書き換えた行はエラーになる（黙ってスキップしない）', () => {
      const renamedProvider = standardRow({ providerName: '東京電力エナジーパートナー（改称）' });
      const renamedMenu = standardRow({ menuName: '新メニュー' });
      const plan = buildFactorImportPlan(tsv([renamedProvider, renamedMenu]), [standardFactor]);

      expect(plan.skipCount).toBe(0);
      expect(plan.creates).toHaveLength(0);
      expect(plan.errors).toEqual([
        { row: 2, reasons: [PROVIDER_FACTOR_IMPORT_ERROR] },
        { row: 3, reasons: [PROVIDER_FACTOR_IMPORT_ERROR] },
      ]);
    });

    it('DB側の providerName が null でなく空文字でも、事業者に紐付かない係数として扱う', () => {
      const emptyProvider: EmissionFactor = { ...nationalStandardFactor, providerName: '' };
      const changed = nationalStandardRow({ factorValue: 0.0005 });
      const plan = buildFactorImportPlan(tsv([changed]), [emptyProvider]);

      expect(plan.errors).toHaveLength(0);
      expect(plan.creates).toHaveLength(1);
    });

    it('IDが事業者別係数を指していれば、事業者列を空にして値を変えてもエラーになる', () => {
      const changed = standardRow({ factorValue: 0.0005, providerName: '', factorType: '' });
      const plan = buildFactorImportPlan(tsv([changed]), [standardFactor]);

      expect(plan.creates).toHaveLength(0);
      expect(plan.errors).toHaveLength(1);
      expect(plan.errors[0].reasons[0]).toBe(PROVIDER_FACTOR_IMPORT_ERROR);
    });

    it('IDが未知でも事業者列が一致する標準係数と同値ならスキップし、値が違えばエラーになる', () => {
      // 別環境でエクスポートした事業者別係数（ID は一致しない）をそのまま取り込む
      const unchanged = standardRow({ id: 'unknown-id' });
      const unchangedPlan = buildFactorImportPlan(tsv([unchanged]), [standardFactor]);
      expect(unchangedPlan.skipCount).toBe(1);
      expect(unchangedPlan.creates).toHaveLength(0);
      expect(unchangedPlan.errors).toHaveLength(0);

      const changed = standardRow({ id: 'unknown-id', factorValue: 0.0005 });
      const changedPlan = buildFactorImportPlan(tsv([changed]), [standardFactor]);
      expect(changedPlan.creates).toHaveLength(0);
      expect(changedPlan.errors).toHaveLength(1);
      expect(changedPlan.errors[0].reasons[0]).toBe(PROVIDER_FACTOR_IMPORT_ERROR);
    });

    it('事業者列のある新規行（既存係数と一致しない）はエラーになる', () => {
      const newProviderRow = standardRow({ id: '', providerName: '架空電力株式会社' });
      const plan = buildFactorImportPlan(tsv([newProviderRow]), [standardFactor]);

      expect(plan.creates).toHaveLength(0);
      expect(plan.errors).toHaveLength(1);
      expect(plan.errors[0].reasons[0]).toBe(PROVIDER_FACTOR_IMPORT_ERROR);
    });

    it('ID・事業者列を空にした行は組織全体のカスタム係数として明示的に追加できる', () => {
      const orgWide = standardRow({ id: '', factorValue: 0.0005, providerName: '', factorType: '' });
      const plan = buildFactorImportPlan(tsv([orgWide]), [standardFactor]);

      expect(plan.errors).toHaveLength(0);
      expect(plan.creates).toHaveLength(1);
      expect(plan.creates[0].factor).toMatchObject({ factorValue: 0.0005, isCustom: true });
      expect(plan.creates[0].factor.providerName).toBeUndefined();
    });
  });

  it('同一キーのカスタム係数が複数あるとき、ID指定があればその係数を更新する', () => {
    const another: EmissionFactor = { ...customFactor, id: 'custom-2', name: '都市ガス（第2係数）' };
    const changed = customRow({ id: 'custom-2', name: '都市ガス（第2係数・改訂）' });
    const plan = buildFactorImportPlan(tsv([changed]), [customFactor, another]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetId).toBe('custom-2');
    expect(plan.errors).toHaveLength(0);
  });

  it('同一キーのカスタム係数が複数あり、IDでも同値でも特定できない行はエラーになる', () => {
    const another: EmissionFactor = { ...customFactor, id: 'custom-2', name: '都市ガス（第2係数）' };
    const ambiguous = customRow({ id: '', name: '都市ガス（第3係数）' });
    const plan = buildFactorImportPlan(tsv([ambiguous]), [customFactor, another]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].reasons[0]).toMatch(/更新対象を特定できません/);
  });

  it('CSV内に同一キーの新規行が複数あるとき、同値ならスキップ・異なる値ならエラーにする', () => {
    const base = customRow({ id: '' });
    const same = customRow({ id: '' });
    const different = customRow({ id: '', factorValue: 0.9 });
    const plan = buildFactorImportPlan(tsv([base, same, different]), []);

    expect(plan.creates).toHaveLength(1);
    expect(plan.skipCount).toBe(1);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].row).toBe(4);
    expect(plan.errors[0].reasons[0]).toMatch(/同一キー/);
  });

  it('同じ係数を複数の行が異なる内容で更新しようとするとエラーになる', () => {
    const first = customRow({ factorValue: 0.003 });
    const second = customRow({ factorValue: 0.004 });
    const plan = buildFactorImportPlan(tsv([first, second]), [customFactor]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].reasons[0]).toMatch(/複数の行が異なる内容で更新/);
  });
});

describe('decodeFactorCsvBuffer', () => {
  const utf16leBuffer = (text: string): ArrayBuffer => {
    // downloadCsv と同じ「UTF-16LE + BOM(FF FE)」形式を組み立てる
    const buffer = new ArrayBuffer((text.length + 1) * 2);
    const view = new DataView(buffer);
    view.setUint16(0, 0xfeff, true);
    for (let i = 0; i < text.length; i++) {
      view.setUint16((i + 1) * 2, text.charCodeAt(i), true);
    }
    return buffer;
  };

  it('エクスポート形式（UTF-16LE + BOM）をデコードできる', () => {
    const text = tsv([customRow()]);
    expect(decodeFactorCsvBuffer(utf16leBuffer(text))).toBe(text);
  });

  it('UTF-8のバイト列もデコードできる', () => {
    const text = csv([customRow()]);
    const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
    expect(decodeFactorCsvBuffer(buffer)).toBe(text);
  });
});

// エクスポートした CSV をそのまま取り込めること（ラウンドトリップ）。
// 出力側の列がヘッダー定義から1つでも欠けると、エクスポートしたファイルがヘッダー不一致で
// 必ず弾かれる。列の増減で壊れないようここで固定する。
describe('factorToCsvRow', () => {
  it('列数がヘッダーと一致する', () => {
    expect(factorToCsvRow(standardFactor)).toHaveLength(FACTOR_CSV_HEADERS.length);
  });

  it('エクスポートした内容をそのまま取り込むと、全行が「変更なし」になる', () => {
    const factors = [customFactor, standardFactor, nationalStandardFactor];
    const text = [
      [...FACTOR_CSV_HEADERS],
      ...factors.map(factorToCsvRow),
    ]
      .map(row => row.join('\t'))
      .join('\r\n');

    const plan = buildFactorImportPlan(text, factors);

    expect(plan.errors).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipCount).toBe(factors.length);
  });
});
