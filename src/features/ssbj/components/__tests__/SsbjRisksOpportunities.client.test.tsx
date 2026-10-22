// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import {
  FICTIONAL_DRAFT_REVIEW,
  fictionalReportBasicInfo,
  fictionalRisksOpportunities,
  fictionalTimeHorizonDefinitions,
} from '../../__fixtures__/fictionalReport';
import type { SsbjReportWorkingRecord, SsbjRiskOpportunityWorkingRecord } from '../../types';
import { SSBJ_EDIT_CONFLICT_MESSAGE, SsbjEditConflictError } from '../../utils/writeError';

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
vi.mock('../../services/riskCandidateService', () => ({
  adoptSsbjRiskCandidate: vi.fn(),
  listSsbjRiskCandidateDecisions: vi.fn(),
  createSsbjRiskCandidateDecision: vi.fn(),
  deleteSsbjRiskCandidateDecision: vi.fn(),
}));
vi.mock('../../services/timeHorizonService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/timeHorizonService')>()),
  getSsbjTimeHorizons: vi.fn(),
  saveSsbjTimeHorizons: vi.fn(),
}));

import { getSsbjReport } from '../../services/reportService';
import {
  adoptSsbjRiskCandidate,
  createSsbjRiskCandidateDecision,
  deleteSsbjRiskCandidateDecision,
  listSsbjRiskCandidateDecisions,
} from '../../services/riskCandidateService';
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
  basicInfoRevision: 0,
  review: FICTIONAL_DRAFT_REVIEW,
};

// 画面が読み込んだ時点の一覧（更新の競合検知に使う行の更新日時を持つ）。
const LOADED_AT = '2026-10-01T00:00:00.000001+00:00';
const ITEMS: SsbjRiskOpportunityWorkingRecord[] = fictionalRisksOpportunities.map(item => ({ ...item, updatedAt: LOADED_AT }));

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
  vi.mocked(listSsbjRisksOpportunities).mockResolvedValue(ITEMS);
  vi.mocked(getSsbjTimeHorizons).mockResolvedValue(fictionalTimeHorizonDefinitions);
  vi.mocked(listSsbjRiskCandidateDecisions).mockResolvedValue([]);
  vi.mocked(createSsbjRiskCandidateDecision).mockImplementation(async (_report, input) => ({
    ...input, updatedAt: '2025-06-01T00:00:00.000Z',
  }));
  vi.mocked(deleteSsbjRiskCandidateDecision).mockResolvedValue();
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
    const created: SsbjRiskOpportunityWorkingRecord = {
      id: 'new-item',
      updatedAt: LOADED_AT,
      kind: 'opportunity',
      title: '再生可能エネルギーの調達',
      riskType: { state: 'not_applicable' },
      description: { disclosure: { state: 'answered', value: '調達コストの低減が見込まれる。' }, internalNote: null },
      timeHorizon: { state: 'answered', value: 'long_term' },
      linkTargets: ['strategy', 'strategy.business_model_impact'],
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
    setSelectValue(field('select[name="linkItem"]'), 'strategy.business_model_impact');
    click(findButton('関連付けを追加', dialog()));
    click(findButton('登録する', dialog()));
    await flushPromises();

    expect(createSsbjRiskOpportunity).toHaveBeenCalledWith(REPORT, {
      kind: 'opportunity',
      title: '再生可能エネルギーの調達',
      riskType: { state: 'not_applicable' },
      description: { disclosure: { state: 'answered', value: '調達コストの低減が見込まれる。' }, internalNote: null },
      timeHorizon: { state: 'answered', value: 'long_term' },
      linkTargets: ['strategy', 'strategy.business_model_impact'],
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(itemCards()).toHaveLength(fictionalRisksOpportunities.length + 1);
  });

  it('項目は要求項目マスターから選び、任意の識別子は入力できない', async () => {
    await renderScreen();

    click(findButton('リスク・機会を追加'));
    expect(dialog().querySelector('input[name="linkItem"]')).toBeNull();
    setSelectValue(field('select[name="linkSection"]'), 'governance');
    const options = Array.from(field<HTMLSelectElement>('select[name="linkItem"]').options).map(option => option.value);
    expect(options).toEqual(['governance', 'governance.oversight_body', 'governance.oversight_information',
      'governance.management_role', 'governance.company_supplement']);
    setSelectValue(field('select[name="linkItem"]'), 'governance.oversight_body');
    click(findButton('関連付けを追加', dialog()));
    expect(dialog().textContent).toContain('ガバナンス：監督する機関・責任者');
  });

  it('マスターに無い以前の関連先は、マスターに無いと出したうえで、編集しても残せる', async () => {
    const [first] = ITEMS;
    vi.mocked(updateSsbjRiskOpportunity).mockResolvedValue(first);
    await renderScreen();

    click(findButton('編集', itemCards()[0]));
    expect(dialog().textContent).toContain('戦略：strategy.climate_resilience（要求項目マスターに無い項目）');
    click(findButton('変更を保存', dialog()));
    await flushPromises();
    expect(vi.mocked(updateSsbjRiskOpportunity).mock.calls[0][1].linkTargets).toEqual(first.linkTargets);
  });

  it('編集すると入力済みの内容から始まり、保存した内容で置き換わる', async () => {
    const [first] = ITEMS;
    vi.mocked(updateSsbjRiskOpportunity).mockResolvedValue({ ...first, title: '炭素価格の導入（改訂）' });
    await renderScreen();

    click(findButton('編集', itemCards()[0]));
    const title = field<HTMLInputElement>('input[name="title"]');
    expect(title.value).toBe(first.title);
    setInputValue(title, '炭素価格の導入（改訂）');
    click(findButton('変更を保存', dialog()));
    await flushPromises();

    expect(updateSsbjRiskOpportunity).toHaveBeenCalledWith(first, {
      kind: first.kind,
      title: '炭素価格の導入（改訂）',
      riskType: first.riskType,
      description: first.description,
      timeHorizon: first.timeHorizon,
      linkTargets: first.linkTargets,
    });
    expect(itemCards()[0].textContent).toContain('炭素価格の導入（改訂）');
  });

  it('他の画面で先に同じリスク・機会が保存されていたら、競合を知らせて入力を残し、一覧を読み直す', async () => {
    const [first] = ITEMS;
    // 画面 B が開いた後、画面 A が同じ行の名称を変えて保存した。
    const savedByOther = { ...first, title: '画面Aが保存した名称', updatedAt: '2026-10-02T00:00:00.000001+00:00' };
    vi.mocked(listSsbjRisksOpportunities).mockResolvedValueOnce(ITEMS).mockResolvedValue([savedByOther, ...ITEMS.slice(1)]);
    vi.mocked(updateSsbjRiskOpportunity).mockRejectedValue(new SsbjEditConflictError());
    await renderScreen();

    click(findButton('編集', itemCards()[0]));
    setTextareaValue(field<HTMLTextAreaElement>('textarea[name="internalNote"]'), '画面Bのメモ');
    click(findButton('変更を保存', dialog()));
    await flushPromises();
    await flushPromises();

    // 開いた時点の行（更新日時）を条件に保存しようとし、拒否される。
    expect(updateSsbjRiskOpportunity).toHaveBeenCalledWith(first, expect.objectContaining({ title: first.title }));
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(SSBJ_EDIT_CONFLICT_MESSAGE);
    // 入力中の値は消さず、一覧は最新に読み直す（先に保存された名称が見える）。
    expect(field<HTMLTextAreaElement>('textarea[name="internalNote"]').value).toBe('画面Bのメモ');
    expect(listSsbjRisksOpportunities).toHaveBeenCalledTimes(2);
    expect(itemCards()[0].textContent).toContain('画面Aが保存した名称');

    // 閉じて開き直すと、最新の内容と更新日時から編集し直せる。
    click(findButton('キャンセル', dialog()));
    click(findButton('編集', itemCards()[0]));
    expect(field<HTMLInputElement>('input[name="title"]').value).toBe('画面Aが保存した名称');
    vi.mocked(updateSsbjRiskOpportunity).mockResolvedValue(savedByOther);
    click(findButton('変更を保存', dialog()));
    await flushPromises();
    expect(vi.mocked(updateSsbjRiskOpportunity).mock.calls[1][0]).toEqual(savedByOther);
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
    const [first] = ITEMS;
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

describe('SsbjRisksOpportunities（承認ロック）', () => {
  it('承認済みのレポートでは追加・編集・削除・定義の編集を出さず、ロックの案内を出す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({ ...REPORT, review: { status: 'approved' as const, approverUserId: 'u', approvedAt: '2025-06-05T00:00:00.000Z', approvedByUserId: 'u',
      approvedVersionId: null, statusChangedAt: null, reviewRequestedByUserId: null } });
    const { container } = await renderScreen();
    const labels = Array.from(container.querySelectorAll('button')).map(element => element.textContent?.trim());
    expect(labels).not.toContain('リスク・機会を追加');
    expect(labels).not.toContain('編集');
    expect(labels).not.toContain('削除');
    expect(labels).not.toContain('定義を編集');
    expect(container.querySelector('[data-testid="ssbj-locked-notice"]')).not.toBeNull();
  });
});

describe('SsbjRisksOpportunities（業種から出した候補）', () => {
  const candidateRow = (candidateId: string): HTMLElement => {
    const row = document.querySelector<HTMLElement>(`[data-candidate-id="${candidateId}"]`);
    if (!row) throw new Error(`候補がありません: ${candidateId}`);
    return row;
  };

  it('基本情報の業種（SICS）のセクターの候補と、全業種に共通の候補を出し、自動で確定しないと明示する', async () => {
    await renderScreen();
    const panel = document.querySelector<HTMLElement>('[data-testid="ssbj-risk-candidates"]');
    expect(panel?.textContent).toContain('業種: RT-IG 工業用機械及び製品');
    expect(panel?.querySelector('[role="note"]')?.textContent).toContain('該当性・重要性は確定しません');
    expect(candidateRow('rt.energy_intensive_process').textContent).toContain('エネルギーを多く使う製造工程の費用の上昇');
    expect(candidateRow('common.carbon_pricing')).toBeDefined();
    expect(document.querySelector('[data-candidate-id="tr.fuel_regulation"]')).toBeNull();
  });

  it('業種が選ばれていなければ、業種の候補は出さず、基本情報で選ぶよう案内する', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({ ...REPORT, industryCode: null });
    await renderScreen();
    const panel = document.querySelector<HTMLElement>('[data-testid="ssbj-risk-candidates"]');
    expect(panel?.textContent).toContain('業種が選ばれていないため');
    expect(document.querySelector('[data-candidate-id^="rt."]')).toBeNull();
    expect(candidateRow('common.carbon_pricing')).toBeDefined();
  });

  it('採用すると候補の内容で登録フォームを開き、説明・時間軸は未入力のまま。登録と採用の記録を一緒に保存する', async () => {
    vi.mocked(adoptSsbjRiskCandidate).mockImplementation(async (_reportId, candidate, input) => ({
      riskOpportunity: { ...input, id: 'adopted-risk', updatedAt: '2025-06-01T00:00:00.000Z' },
      decision: {
        candidateId: candidate.candidateId, candidateVersion: candidate.candidateVersion, industryCode: 'RT-IG', decision: 'adopted',
        reason: null, riskOpportunityId: 'adopted-risk', updatedAt: '2025-06-01T00:00:00.000Z',
      },
    }));
    await renderScreen();

    click(findButton('採用して登録', candidateRow('rt.energy_intensive_process')));
    expect(dialog().querySelector('[data-testid="ssbj-risk-adopting-candidate"]')).not.toBeNull();
    expect(field<HTMLInputElement>('input[name="title"]').value).toBe('エネルギーを多く使う製造工程の費用の上昇');
    expect(field<HTMLSelectElement>('select[name="descriptionState"]').value).toBe('unanswered');
    expect(field<HTMLSelectElement>('select[name="timeHorizon"]').value).toBe('unanswered');
    setInputValue(field('input[name="title"]'), '第一工場の電力費用の上昇');
    click(findButton('登録する', dialog()));
    await flushPromises();
    await flushPromises();

    expect(adoptSsbjRiskCandidate).toHaveBeenCalledWith(
      REPORT.id,
      { candidateId: 'rt.energy_intensive_process', candidateVersion: 'r2-trial-1' },
      {
        kind: 'risk',
        title: '第一工場の電力費用の上昇',
        riskType: { state: 'answered', value: 'transition' },
        description: { disclosure: { state: 'unanswered' }, internalNote: null },
        timeHorizon: { state: 'unanswered' },
        linkTargets: ['strategy.business_model_impact', 'metrics_targets.internal_carbon_price'],
      },
    );
    // 登録と採用の記録を別々に書かない（片方だけ残る経路を作らない）。
    expect(createSsbjRiskOpportunity).not.toHaveBeenCalled();
    expect(createSsbjRiskCandidateDecision).not.toHaveBeenCalled();
    const row = candidateRow('rt.energy_intensive_process');
    expect(row.textContent).toContain('採用済み');
    expect(row.textContent).toContain('登録したリスク・機会: 第一工場の電力費用の上昇');
  });

  it('採用して登録が失敗したら、フォームを開いたまま理由を出し、リスク・機会も採用も増やさない', async () => {
    vi.mocked(adoptSsbjRiskCandidate).mockRejectedValue(new Error('この候補は他の画面で先に採用されました。画面を開き直してください'));
    await renderScreen();
    const before = document.querySelectorAll('[data-testid="ssbj-risk-opportunity"]').length;

    click(findButton('採用して登録', candidateRow('rt.energy_intensive_process')));
    click(findButton('登録する', dialog()));
    await flushPromises();
    await flushPromises();

    expect(dialog().textContent).toContain('この候補は他の画面で先に採用されました');
    expect(document.querySelectorAll('[data-testid="ssbj-risk-opportunity"]').length).toBe(before);
    expect(candidateRow('rt.energy_intensive_process').textContent).not.toContain('採用済み');
  });

  it('採用のフォームを閉じたら、何も登録・記録しない', async () => {
    await renderScreen();
    click(findButton('採用して登録', candidateRow('common.energy_price')));
    click(findButton('キャンセル', dialog()));
    expect(adoptSsbjRiskCandidate).not.toHaveBeenCalled();
    expect(createSsbjRiskOpportunity).not.toHaveBeenCalled();
    expect(createSsbjRiskCandidateDecision).not.toHaveBeenCalled();
    expect(candidateRow('common.energy_price').textContent).not.toContain('採用済み');
  });

  it('除外は理由が必須で、保存した理由を出し、未検討に戻せる', async () => {
    await renderScreen();
    const row = () => candidateRow('rt.efficient_products');

    click(findButton('除外', row()));
    await act(async () => { click(findButton('除外を保存', row())); });
    await flushPromises();
    expect(row().querySelector('[role="alert"]')?.textContent).toContain('除外する理由を入力してください');
    expect(createSsbjRiskCandidateDecision).not.toHaveBeenCalled();

    // 改行・タブ・全角スペースだけの理由は、理由が無いものとして保存しない。
    setInputValue(row().querySelector<HTMLInputElement>('input')!, '\t\u3000\n');
    await act(async () => { click(findButton('除外を保存', row())); });
    await flushPromises();
    expect(row().querySelector('[role="alert"]')?.textContent).toContain('除外する理由を入力してください');
    expect(createSsbjRiskCandidateDecision).not.toHaveBeenCalled();

    setInputValue(row().querySelector<HTMLInputElement>('input')!, ' 当社は完成品を作らないため ');
    await act(async () => { click(findButton('除外を保存', row())); });
    await flushPromises();
    expect(createSsbjRiskCandidateDecision).toHaveBeenCalledWith(REPORT, expect.objectContaining({
      candidateId: 'rt.efficient_products', decision: 'excluded', reason: '当社は完成品を作らないため', riskOpportunityId: null,
    }));
    expect(row().textContent).toContain('除外した理由（開示しない）: 当社は完成品を作らないため');

    await act(async () => { click(findButton('未検討に戻す', row())); });
    await flushPromises();
    // 読み込んだ（保存した）時点の判断の更新日時を条件にする（他の画面で先に変えた判断を消さない）。
    expect(deleteSsbjRiskCandidateDecision).toHaveBeenCalledWith(REPORT.id, expect.objectContaining({
      candidateId: 'rt.efficient_products', updatedAt: '2025-06-01T00:00:00.000Z',
    }));
    expect(row().textContent).not.toContain('除外した理由');
    expect(findButton('除外', row())).toBeDefined();
  });

  it('他の画面で先に判断されていたら、除外を保存せずに理由を出し、未検討のままにする', async () => {
    vi.mocked(createSsbjRiskCandidateDecision).mockRejectedValue(
      new Error('この候補は他の画面で先に判断されました。画面を開き直してください'),
    );
    await renderScreen();
    const row = () => candidateRow('rt.efficient_products');

    click(findButton('除外', row()));
    setInputValue(row().querySelector<HTMLInputElement>('input')!, '当社は完成品を作らないため');
    await act(async () => { click(findButton('除外を保存', row())); });
    await flushPromises();

    expect(row().querySelector('[role="alert"]')?.textContent).toContain('この候補は他の画面で先に判断されました');
    expect(row().textContent).not.toContain('除外した理由');
  });

  it('未検討に戻すのが他の画面の変更で止められたら、理由を出して判断を残す', async () => {
    vi.mocked(listSsbjRiskCandidateDecisions).mockResolvedValue([
      { candidateId: 'common.energy_price', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG', decision: 'excluded',
        reason: '電力は固定価格で購入しているため', riskOpportunityId: null, updatedAt: '2025-06-01T00:00:00.123456+00:00' },
    ]);
    vi.mocked(deleteSsbjRiskCandidateDecision).mockRejectedValue(
      new Error('他の画面で変更されたため、未検討に戻していません。画面を開き直してください'),
    );
    await renderScreen();
    const row = () => candidateRow('common.energy_price');

    await act(async () => { click(findButton('未検討に戻す', row())); });
    await flushPromises();

    expect(deleteSsbjRiskCandidateDecision).toHaveBeenCalledWith(REPORT.id, expect.objectContaining({
      candidateId: 'common.energy_price', updatedAt: '2025-06-01T00:00:00.123456+00:00',
    }));
    expect(row().querySelector('[role="alert"]')?.textContent).toContain('他の画面で変更されたため');
    expect(row().textContent).toContain('除外した理由（開示しない）: 電力は固定価格で購入しているため');
  });

  it('保存済みの判断を再表示し、採用したリスク・機会が削除されていればそうと出す', async () => {
    vi.mocked(listSsbjRiskCandidateDecisions).mockResolvedValue([
      { candidateId: 'common.carbon_pricing', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG', decision: 'adopted',
        reason: null, riskOpportunityId: fictionalRisksOpportunities[0].id, updatedAt: '2025-06-01T00:00:00.000Z' },
      // 外部キーにしていないので、登録したリスク・機会を削除しても ID は残る（存在しなければ削除済みとして出す）。
      { candidateId: 'common.energy_price', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG', decision: 'adopted',
        reason: null, riskOpportunityId: 'risk-deleted', updatedAt: '2025-06-01T00:00:00.000Z' },
    ]);
    await renderScreen();
    expect(candidateRow('common.carbon_pricing').textContent).toContain(`登録したリスク・機会: ${fictionalRisksOpportunities[0].title}`);
    expect(candidateRow('common.energy_price').textContent).toContain('登録したリスク・機会は削除済み');
  });

  it('登録したリスク・機会が残っている採用は未検討に戻せず、削除済みなら戻せる（再採用で重複して登録しないため）', async () => {
    vi.mocked(listSsbjRiskCandidateDecisions).mockResolvedValue([
      { candidateId: 'common.carbon_pricing', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG', decision: 'adopted',
        reason: null, riskOpportunityId: fictionalRisksOpportunities[0].id, updatedAt: '2025-06-01T00:00:00.000Z' },
      { candidateId: 'common.energy_price', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG', decision: 'adopted',
        reason: null, riskOpportunityId: 'risk-deleted', updatedAt: '2025-06-01T00:00:00.000Z' },
    ]);
    await renderScreen();
    const buttonLabels = (row: HTMLElement) => Array.from(row.querySelectorAll('button')).map(button => button.textContent);
    expect(buttonLabels(candidateRow('common.carbon_pricing'))).not.toContain('未検討に戻す');
    expect(buttonLabels(candidateRow('common.carbon_pricing'))).not.toContain('採用して登録');
    expect(candidateRow('common.carbon_pricing').textContent).toContain('先に登録したリスク・機会を一覧から削除してください');
    expect(buttonLabels(candidateRow('common.energy_price'))).toContain('未検討に戻す');
    expect(buttonLabels(candidateRow('common.energy_price'))).toContain('採用して登録');
  });

  it('承認済みのレポートでは候補を出すが、採用・除外の操作は出さない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({ ...REPORT, review: { status: 'approved' as const, approverUserId: 'u', approvedAt: '2025-06-05T00:00:00.000Z', approvedByUserId: 'u',
      approvedVersionId: null, statusChangedAt: null, reviewRequestedByUserId: null } });
    await renderScreen();
    expect(candidateRow('common.carbon_pricing').querySelector('button')).toBeNull();
  });
});
