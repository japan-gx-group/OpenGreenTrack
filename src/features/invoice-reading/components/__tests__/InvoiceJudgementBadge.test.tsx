// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { InvoiceJudgementBadge } from '../InvoiceJudgementBadge';

// 表の「判定」の列: 判定のバッジと、AI の判断の理由。アプリが添える説明は AI の判断と分けて出す。

let view: RenderResult | null = null;

// バッジの下に並ぶ文（バッジそのものは除く）
const lines = () =>
  Array.from(view!.container.querySelectorAll('span > span:not([data-slot="badge"])')).map((element) => element.textContent);

describe('InvoiceJudgementBadge', () => {
  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('判定のバッジと、AI の判断の理由を出す', () => {
    view = render(<InvoiceJudgementBadge judgement={{ status: 'matched', label: '燃料 揮発油', reason: 'ガソリンは揮発油' }} />);
    expect(view.container.textContent).toContain('当てはまる係数あり');
    expect(lines()).toContain('AI の判断: ガソリンは揮発油');
  });

  it('AI が選んだメニューを採らなかったときは、その理由を「AI の判断」とは分けて出す', () => {
    view = render(
      <InvoiceJudgementBadge
        judgement={{
          status: 'provider_only',
          label: '東京電力エナジーパートナー(株)',
          reason: '東京電力エナジーパートナー(株)の「メニューL(残差)」を選択',
          note: '「残差」のメニューが複数あるため（メニューL(残差)・メニューM(残差)）、AI が選んだメニューは使わず、事業者だけを入れました',
        }}
      />,
    );
    expect(view.container.textContent).toContain('メニューを選んでください');
    expect(lines()).toEqual([
      '「残差」のメニューが複数あるため（メニューL(残差)・メニューM(残差)）、AI が選んだメニューは使わず、事業者だけを入れました',
      'AI の判断: 東京電力エナジーパートナー(株)の「メニューL(残差)」を選択',
    ]);
  });
});
