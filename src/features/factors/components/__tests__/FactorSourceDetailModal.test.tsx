// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, render } from '@/lib/testing/render';
import type { EmissionFactor } from '../../services/factorService';
import { FactorSourceDetailModal } from '../FactorSourceDetailModal';

// 参照元リンクをソース定義にハードコードせず、登録係数の出典から導出して列挙することを検証する。

const SHK_URL = 'https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html';
const SCOPE3_URL = 'https://www.env.go.jp/earth/ondanka/supply_chain/gvc/estimate_05.html';

const factor = (
  overrides: Partial<EmissionFactor> & Pick<EmissionFactor, 'id' | 'source'>,
): EmissionFactor => ({
  name: '係数',
  energyType: '電気',
  scope: 'Scope 2',
  factorValue: 0.001,
  unit: 't-CO2/kWh',
  applicableYear: 2025,
  region: '全国',
  status: '有効',
  isCustom: false,
  ...overrides,
});

/**
 * ソースカードだけを取り出す。
 * data-source-name はこの検証のためにカード要素へ付けた目印で、
 * ラッパー要素を掴んで「全ソースぶんのリンク」を検証してしまう事故を防ぐ。
 */
const sourceCard = (container: HTMLElement, sourceName: string): HTMLElement => {
  const card = container.querySelector<HTMLElement>(`[data-source-name="${sourceName}"]`);
  if (!card) {
    throw new Error(`ソースカードが見つかりません: ${sourceName}`);
  }
  return card;
};

const linkTexts = (card: HTMLElement): string[] =>
  Array.from(card.querySelectorAll('a')).map((link) => link.textContent ?? '');

describe('FactorSourceDetailModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('1ソースが複数資料にまたがる場合、資料ごとにリンクと件数を列挙する', () => {
    const { container, unmount } = render(
      <FactorSourceDetailModal
        factors={[
          factor({ id: '1', source: '環境省', sourceDocument: '電気事業者別排出係数 代替値', sourceUrl: SHK_URL }),
          factor({ id: '2', source: '環境省', sourceDocument: '排出原単位データベース Ver.3.6', sourceUrl: SCOPE3_URL }),
          factor({ id: '3', source: '環境省', sourceDocument: '排出原単位データベース Ver.3.6', sourceUrl: SCOPE3_URL }),
        ]}
        onClose={() => {}}
      />,
    );

    const card = sourceCard(container, '環境省');
    const links = Array.from(card.querySelectorAll<HTMLAnchorElement>('a'));

    // 件数の多い資料が先。ハードコードURLではなく登録係数の sourceUrl が使われる。
    expect(links.map((link) => link.href)).toEqual([SCOPE3_URL, SHK_URL]);
    expect(links.map((link) => link.textContent)).toEqual([
      '排出原単位データベース Ver.3.6',
      '電気事業者別排出係数 代替値',
    ]);
    expect(links.every((link) => link.target === '_blank' && link.rel === 'noopener noreferrer')).toBe(true);

    const items = Array.from(card.querySelectorAll('li')).map((item) => item.textContent);
    expect(items).toEqual([
      '排出原単位データベース Ver.3.6 / 2 件',
      '電気事業者別排出係数 代替値 / 1 件',
    ]);
    expect(card.textContent).toContain('登録 3 件');

    unmount();
  });

  it('出典は登録係数の source ごとに分かれ、他ソースの資料が混ざらない', () => {
    const { container, unmount } = render(
      <FactorSourceDetailModal
        factors={[
          factor({ id: '1', source: '環境省', sourceDocument: 'MOE資料', sourceUrl: SHK_URL }),
          factor({ id: '2', source: '温対法', sourceDocument: 'KETSOHO資料', sourceUrl: SCOPE3_URL }),
        ]}
        onClose={() => {}}
      />,
    );

    expect(linkTexts(sourceCard(container, '環境省'))).toEqual(['MOE資料']);
    expect(linkTexts(sourceCard(container, '温対法'))).toEqual(['KETSOHO資料']);
    expect(sourceCard(container, '環境省').textContent).not.toContain('KETSOHO資料');

    unmount();
  });

  it('出典を持たない係数は「出典なし」として扱い、外部リンクを作らない', () => {
    const { container, unmount } = render(
      <FactorSourceDetailModal
        factors={[
          factor({ id: '1', source: '自社設定', isCustom: true }),
          factor({ id: '2', source: '自社設定', isCustom: true }),
        ]}
        onClose={() => {}}
      />,
    );

    const card = sourceCard(container, '自社設定');
    expect(card.querySelectorAll('a')).toHaveLength(0);
    expect(card.textContent).toContain('出典なし（社内算定根拠）');
    expect(card.textContent).toContain('登録 2 件');

    unmount();
  });

  it('スキーム無しの出典URLはリンクにせずテキストで表示する', () => {
    const { container, unmount } = render(
      <FactorSourceDetailModal
        factors={[
          // CSVインポートの自由入力で起こりうる値。href にすると相対リンク化して壊れる。
          factor({ id: '1', source: '自社設定', isCustom: true, sourceDocument: '社内Wiki', sourceUrl: 'www.example.com/a' }),
        ]}
        onClose={() => {}}
      />,
    );

    const card = sourceCard(container, '自社設定');
    expect(card.querySelectorAll('a')).toHaveLength(0);
    expect(card.textContent).toContain('社内Wiki');

    unmount();
  });

  it('資料が多いときは一部だけ表示し、「他 N 件を表示」で残りを開ける', () => {
    const { container, unmount } = render(
      <FactorSourceDetailModal
        factors={Array.from({ length: 13 }, (_, index) =>
          factor({
            id: `custom-${index}`,
            source: '自社設定',
            isCustom: true,
            sourceDocument: `社内資料${index}`,
            sourceUrl: `https://example.com/${index}`,
          }),
        )}
        onClose={() => {}}
      />,
    );

    const card = sourceCard(container, '自社設定');
    expect(card.querySelectorAll('li')).toHaveLength(10);

    const expandButton = card.querySelector('button');
    expect(expandButton?.textContent).toBe('他 3 件を表示');

    click(expandButton!);
    expect(sourceCard(container, '自社設定').querySelectorAll('li')).toHaveLength(13);
    expect(sourceCard(container, '自社設定').querySelector('button')).toBeNull();

    unmount();
  });

  it('登録0件のソースは表示しない', () => {
    const { container, unmount } = render(
      <FactorSourceDetailModal
        factors={[factor({ id: '1', source: '環境省', sourceDocument: 'MOE資料', sourceUrl: SHK_URL })]}
        onClose={() => {}}
      />,
    );

    // 参照元を開いても該当係数が無いソースは出典を誤認させるため出さない
    expect(container.querySelector('[data-source-name="環境省"]')).not.toBeNull();
    expect(container.querySelector('[data-source-name="経済産業省"]')).toBeNull();

    unmount();
  });

  it('表示できるソースが無いときは呼び出し側の案内文を出す', () => {
    const { container, unmount } = render(
      <FactorSourceDetailModal
        factors={[]}
        emptyMessage="排出係数を取得できなかったため、標準係数ソースを表示できません。"
        onClose={() => {}}
      />,
    );

    expect(container.querySelectorAll('[data-source-name]')).toHaveLength(0);
    expect(container.textContent).toContain('排出係数を取得できなかったため、標準係数ソースを表示できません。');

    unmount();
  });
});
