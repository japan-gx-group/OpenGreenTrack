// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import {
  fictionalReportBasicInfo,
  fictionalRisksOpportunities,
  fictionalTimeHorizonDefinitions,
} from '../../__fixtures__/fictionalReport';
import type { SsbjReportWorkingRecord, SsbjRiskOpportunity } from '../../types';

// SSBJ リスク・機会画面: 一覧の再表示（状態ラベル・内部メモの区別・リスクの種類・関連先）、Not Found、
// 登録（検証・関連付け・一覧への反映）、編集、削除、時間軸の定義の表示・保存を検証する。
// Supabase を呼ぶ I/O だけをモックする。

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()),
  getSsbjReport: vi.fn(),
}));
vi.mock('../../services/riskOpportunityService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/riskOpportunityService')>()),
  listSsbjRisksOpportunities: vi.fn(),
  createSsbjRiskOpportunity: vi.fn(),
  updateSsbjRiskOpportunity: vi.fn(),
  deleteSsbjRiskOpportunity: vi.fn(),
}));
vi.mock('../../services/timeHorizonService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/timeHorizonService')>()),
  getSsbjTimeHorizons: vi.fn(),
  saveSsbjTimeHorizons: vi.fn(),
}));

import { getSsbjReport } from '../../services/reportService';
import {
  createSsbjRiskOpportunity,
  deleteSsbjRiskOpportunity,
  listSsbjRisksOpportunities,
  updateSsbjRiskOpportunity,
} from '../../services/riskOpportunityService';
import { getSsbjTimeHorizons, saveSsbjTimeHorizons } from '../../services/timeHorizonService';
import { SsbjRisksOpportunities } from '../SsbjRisksOpportunities.client';

const REPORT: SsbjReportWorkingRecord = {
  ...fictionalReportBasicInfo,
  fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01',
  periodEnd: '2025-03-31',
  draftRevision: 1,
};

const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const findButton = (label: string, root: ParentNode = document): HTMLButtonElement => {
  const button = Array.from(root.querySelectorAll('button')).find(element => element.textContent?.trim() === label);
  if (!button) throw new Error(`ボタンが見つかりません: ${label}`);
  return button;
};

const dialog = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!element) throw new Error('ダイアログが開いていません');
  return element;
};

const field = <T extends Element>(selector: string): T => {
  const element = dialog().querySelector<T>(selector);
  if (!element) throw new Error(`入力欄がありません: ${selector}`);
  return element;
};

/** React の onChange を発火させる（setInputValue と同じく、ネイティブの setter で値を入れてからイベントを流す）。 */
const setSelectValue = (select: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const setTextareaValue = (textarea: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const itemCards = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ssbj-risk-opportunity"]'));

let rendered: RenderResult | null = null;

const renderScreen = async (): Promise<RenderResult> => {
  rendered = render(<SsbjRisksOpportunities reportId={REPORT.id} />);
  await flushPromises();
  await flushPromises();
  return rendered;
};

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
  vi.mocked(listSsbjRisksOpportunities).mockResolvedValue(fictionalRisksOpportunities);
  vi.mocked(getSsbjTimeHorizons).mockResolvedValue(fictionalTimeHorizonDefinitions);
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.clearAllMocks();
});

describe('SsbjRisksOpportunities', () => {
  it('登録済みのリスク・機会を、状態ラベル・内部メモ・関連先を区別して表示する', async () => {
    await renderScreen();

    expect(listSsbjRisksOpportunities).toHaveBeenCalledWith(REPORT.id);
    const [answered, unconfirmed, unanswered] = itemCards().map(card => card.textContent ?? '');
    expect(answered).toContain('移行リスク');
    expect(unconfirmed).not.toContain('リスクの種類');
    expect(answered).toContain('中期');
    expect(answered).toContain('炭素価格が導入された場合');
    expect(answered).toContain('影響額の試算は経営企画部で実施中');
    expect(answered).toContain('戦略、戦略：strategy.climate_resilience');
    expect(unconfirmed).toContain('未確認');
    expect(unanswered).toContain('未入力');
    expect(unanswered).toContain('関連付けなし');
  });

  it('存在しない・他組織のレポートは「見つかりません」を表示し、一覧を読みに行かない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    const { container } = await renderScreen();

    expect(container.textContent).toContain('SSBJレポートが見つかりません');
    expect(listSsbjRisksOpportunities).not.toHaveBeenCalled();
  });

  it('名称が空白だけなら登録しない（required をすり抜ける入力も検証で止める）', async () => {
    await renderScreen();

    click(findButton('リスク・機会を追加'));
    setInputValue(field('input[name="title"]'), '   ');
    click(findButton('登録する', dialog()));
    await flushPromises();

    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('名称を入力してください');
    expect(createSsbjRiskOpportunity).not.toHaveBeenCalled();
  });

  it('説明・時間軸・関連先を入れて登録すると一覧に加わる', async () => {
    const created: SsbjRiskOpportunity = {
      id: 'new-item',
      kind: 'opportunity',
      title: '再生可能エネルギーの調達',
      riskType: { state: 'not_applicable' },
      description: { disclosure: { state: 'answered', value: '調達コストの低減が見込まれる。' }, internalNote: null },
      timeHorizon: { state: 'answered', value: 'long_term' },
      linkTargets: ['strategy', 'strategy.climate_resilience'],
    };
    vi.mocked(createSsbjRiskOpportunity).mockResolvedValue(created);
    await renderScreen();

    click(findButton('リスク・機会を追加'));
    setSelectValue(field('select[name="kind"]'), 'opportunity');
    setInputValue(field('input[name="title"]'), '再生可能エネルギーの調達');
    setSelectValue(field('select[name="timeHorizon"]'), 'long_term');
    setSelectValue(field('select[name="descriptionState"]'), 'answered');
    setTextareaValue(field('textarea[name="descriptionText"]'), '調達コストの低減が見込まれる。');
    setSelectValue(field('select[name="linkSection"]'), 'strategy');
    click(findButton('関連付けを追加', dialog()));
    setInputValue(field('input[name="linkItem"]'), 'climate_resilience');
    click(findButton('関連付けを追加', dialog()));
    click(findButton('登録する', dialog()));
    await flushPromises();

    expect(createSsbjRiskOpportunity).toHaveBeenCalledWith(REPORT, {
      kind: 'opportunity',
      title: '再生可能エネルギーの調達',
      riskType: { state: 'not_applicable' },
      description: { disclosure: { state: 'answered', value: '調達コストの低減が見込まれる。' }, internalNote: null },
      timeHorizon: { state: 'answered', value: 'long_term' },
      linkTargets: ['strategy', 'strategy.climate_resilience'],
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(itemCards()).toHaveLength(fictionalRisksOpportunities.length + 1);
  });

  it('項目の識別子の形式が違うと関連付けを追加しない', async () => {
    await renderScreen();

    click(findButton('リスク・機会を追加'));
    setInputValue(field('input[name="linkItem"]'), 'Climate Resilience');
    click(findButton('関連付けを追加', dialog()));

    expect(dialog().textContent).toContain('項目の識別子は英小文字・数字・アンダースコア');
    expect(dialog().textContent).toContain('まだ関連付けていません');
  });

  it('編集すると入力済みの内容から始まり、保存した内容で置き換わる', async () => {
    const [first] = fictionalRisksOpportunities;
    vi.mocked(updateSsbjRiskOpportunity).mockResolvedValue({ ...first, title: '炭素価格の導入（改訂）' });
    await renderScreen();

    click(findButton('編集', itemCards()[0]));
    const title = field<HTMLInputElement>('input[name="title"]');
    expect(title.value).toBe(first.title);
    setInputValue(title, '炭素価格の導入（改訂）');
    click(findButton('変更を保存', dialog()));
    await flushPromises();

    expect(updateSsbjRiskOpportunity).toHaveBeenCalledWith(first.id, {
      kind: first.kind,
      title: '炭素価格の導入（改訂）',
      riskType: first.riskType,
      description: first.description,
      timeHorizon: first.timeHorizon,
      linkTargets: first.linkTargets,
    });
    expect(itemCards()[0].textContent).toContain('炭素価格の導入（改訂）');
  });

  it('確認のうえ削除すると一覧から消える', async () => {
    vi.mocked(deleteSsbjRiskOpportunity).mockResolvedValue();
    await renderScreen();

    click(findButton('削除', itemCards()[2]));
    expect(dialog().textContent).toContain('豪雨による拠点の操業停止');
    click(findButton('削除する', dialog()));
    await flushPromises();

    expect(deleteSsbjRiskOpportunity).toHaveBeenCalledWith(fictionalRisksOpportunities[2].id);
    expect(itemCards()).toHaveLength(fictionalRisksOpportunities.length - 1);
  });

  it('リスクの種類は区分がリスクのときだけ選べ、選んだ種類で登録する', async () => {
    const [first] = fictionalRisksOpportunities;
    vi.mocked(createSsbjRiskOpportunity).mockResolvedValue({ ...first, id: 'new-risk' });
    await renderScreen();

    click(findButton('リスク・機会を追加'));
    expect(dialog().querySelector('select[name="riskType"]')).not.toBeNull();
    setSelectValue(field('select[name="kind"]'), 'opportunity');
    expect(dialog().querySelector('select[name="riskType"]')).toBeNull();
    setSelectValue(field('select[name="kind"]'), 'risk');
    setSelectValue(field('select[name="riskType"]'), 'physical');
    setInputValue(field('input[name="title"]'), '猛暑による生産性の低下');
    click(findButton('登録する', dialog()));
    await flushPromises();

    expect(vi.mocked(createSsbjRiskOpportunity).mock.calls[0][1]).toMatchObject({
      kind: 'risk',
      riskType: { state: 'answered', value: 'physical' },
    });
  });

  it('時間軸の定義を表示し、編集して保存すると保存後の内容を再表示する', async () => {
    vi.mocked(saveSsbjTimeHorizons).mockImplementation(async (_report, input) => input);
    await renderScreen();

    const view = document.querySelector('[data-testid="ssbj-time-horizon-definitions"]');
    expect(view?.textContent).toContain('3年以内（中期経営計画の期間）');
    expect(view?.textContent).toContain('未確認');
    expect(view?.textContent).toContain('計画期間との関係は経営企画部に確認中');

    click(findButton('定義を編集'));
    const form = document.querySelector<HTMLElement>('[data-testid="ssbj-time-horizon-form"]');
    if (!form) throw new Error('時間軸の定義のフォームがありません');
    const relationState = form.querySelector<HTMLSelectElement>('select[name="planningHorizonRelationState"]');
    const relationText = form.querySelector<HTMLTextAreaElement>('textarea[name="planningHorizonRelation"]');
    if (!relationState || !relationText) throw new Error('計画期間との関係の入力欄がありません');
    setSelectValue(relationState, 'answered');
    setTextareaValue(relationText, '短期は中期経営計画の期間と一致させている。');
    click(findButton('定義を保存', form));
    await flushPromises();

    expect(saveSsbjTimeHorizons).toHaveBeenCalledWith(REPORT, {
      ...fictionalTimeHorizonDefinitions,
      planningHorizonRelation: { state: 'answered', value: '短期は中期経営計画の期間と一致させている。' },
    });
    expect(document.querySelector('[data-testid="ssbj-time-horizon-definitions"]')?.textContent).toContain(
      '短期は中期経営計画の期間と一致させている。',
    );
  });
});
