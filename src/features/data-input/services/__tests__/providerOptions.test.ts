import { describe, expect, it } from 'vitest';
import {
  buildProviderOptions,
  normalizeProviderName,
  type ProviderOptionRow,
} from '../providerOptions';

const row = (overrides: Partial<ProviderOptionRow> = {}): ProviderOptionRow => ({
  providerName: '東京電力エナジーパートナー',
  providerNumber: 'A0269',
  ...overrides,
});

describe('buildProviderOptions', () => {
  it('コード付きの事業者は説明付きのラベルを生成する', () => {
    expect(buildProviderOptions([row()])).toEqual([
      {
        value: '東京電力エナジーパートナー',
        label: '東京電力エナジーパートナー（事業者コード: A0269）',
        searchText: '東京電力エナジーパートナー A0269',
      },
    ]);
  });

  it('コードがない事業者は事業者名だけをラベルにする', () => {
    expect(buildProviderOptions([row({ providerName: '東京ガス', providerNumber: null })])).toEqual([
      { value: '東京ガス', label: '東京ガス', searchText: '東京ガス' },
    ]);
  });

  it('同じ事業者名・同じコードの重複を1つの選択肢にまとめる', () => {
    expect(
      buildProviderOptions([
        row(),
        row({ providerNumber: 'A0269', providerName: '東京電力エナジーパートナー' }),
      ]),
    ).toEqual([
      {
        value: '東京電力エナジーパートナー',
        label: '東京電力エナジーパートナー（事業者コード: A0269）',
        searchText: '東京電力エナジーパートナー A0269',
      },
    ]);
  });

  it('同名でコードが食い違う場合は全てのコードをラベルに並べる', () => {
    // 選択肢の value は事業者名のため、この選択肢は両方のコードの係数を束ねる。
    // どちらか片方だけを表示すると実際に適用される係数と食い違うので、両方見せる。
    expect(
      buildProviderOptions([
        row({ providerNumber: 'A0001' }),
        row({ providerNumber: 'A0001' }),
        row({ providerNumber: 'A0002' }),
      ]),
    ).toEqual([
      {
        value: '東京電力エナジーパートナー',
        label: '東京電力エナジーパートナー（事業者コード: A0001 / A0002）',
        searchText: '東京電力エナジーパートナー A0001 A0002',
      },
    ]);
  });

  it('先頭行にコードがなくても後続行のコードを使う', () => {
    expect(
      buildProviderOptions([row({ providerNumber: null }), row({ providerNumber: ' A0269 ' })]),
    ).toEqual([
      {
        value: '東京電力エナジーパートナー',
        label: '東京電力エナジーパートナー（事業者コード: A0269）',
        searchText: '東京電力エナジーパートナー A0269',
      },
    ]);
  });

  it('事業者名の初出順を維持し、値には事業者名を使う', () => {
    expect(
      buildProviderOptions([
        row({ providerName: null }),
        row({ providerName: '東京ガス', providerNumber: null }),
        row({ providerName: '大阪ガス', providerNumber: 'B0001' }),
        row({ providerName: '東京ガス', providerNumber: 'A0001' }),
      ]),
    ).toEqual([
      { value: '東京ガス', label: '東京ガス（事業者コード: A0001）', searchText: '東京ガス A0001' },
      {
        value: '大阪ガス',
        label: '大阪ガス（事業者コード: B0001）',
        searchText: '大阪ガス B0001',
      },
    ]);
  });

  it('前後に空白のある事業者名は同じ選択肢へまとめ、値は空白を除いた名前にする', () => {
    expect(
      buildProviderOptions([
        row({ providerName: ' 東京ガス ', providerNumber: null }),
        row({ providerName: '東京ガス', providerNumber: 'A0001' }),
      ]),
    ).toEqual([
      { value: '東京ガス', label: '東京ガス（事業者コード: A0001）', searchText: '東京ガス A0001' },
    ]);
  });

  it('事業者名が空文字や空白だけの行は選択肢にしない', () => {
    expect(
      buildProviderOptions([
        row({ providerName: '' }),
        row({ providerName: '   ' }),
        row({ providerName: undefined }),
      ]),
    ).toEqual([]);
  });

  it('検索用テキストには装飾を含めず、コードで引けるようにする', () => {
    const [option] = buildProviderOptions([row()]);

    expect(option.searchText).toBe('東京電力エナジーパートナー A0269');
    expect(option.searchText.includes('事業者コード')).toBe(false);
  });
});

describe('normalizeProviderName', () => {
  it('前後の空白を落とし、null/undefined は空文字にする', () => {
    expect(normalizeProviderName(' 東京ガス ')).toBe('東京ガス');
    expect(normalizeProviderName(null)).toBe('');
    expect(normalizeProviderName(undefined)).toBe('');
  });
});
