// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import type { SsbjAuditLog } from '../../types';

// レポートの中の画面の上に出す部品: 差し戻されたときの帯（理由・誰が・いつ・次にすること）と、閲覧者に出さないことを検証する。
// 画面を移るタブ（入力の画面の進み具合・今いる画面の強調・閲覧者には閲覧できる画面だけ）と、
// 作業中の内容が書き換わった知らせで同じ画面の中のタブの数が新しくなることも検証する。
// レイアウトと同じく Provider の下に描き、今いる画面はレイアウトの下の選択中のセグメントから決める。

const navigation = vi.hoisted(() => ({ segments: [] as string[] }));
vi.mock('next/navigation', () => ({ useSelectedLayoutSegments: () => navigation.segments }));

vi.mock('../../services/memberRoleService', () => ({ getMySsbjRole: vi.fn() }));
vi.mock('../../services/auditLogService', () => ({ getLatestSsbjStatusChange: vi.fn() }));
vi.mock('../../services/previewService', () => ({
  getSsbjWorkingPreview: vi.fn(async () => ({ kind: 'working', draftRevision: 1, snapshot: { sections: {} } })),
  getSsbjVersionPreview: vi.fn(),
}));
vi.mock('../../services/memberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberService')>()),
  listSsbjMembers: vi.fn(async () => [{ id: 'user-approver', name: '承認 次郎', role: 'logger' }]),
  getCurrentSsbjUserId: vi.fn(async () => 'user-editor'),
}));

import { fictionalSnapshot } from '../../__fixtures__/fictionalReport';
import { getLatestSsbjStatusChange } from '../../services/auditLogService';
import { getMySsbjRole } from '../../services/memberRoleService';
import { listSsbjMembers } from '../../services/memberService';
import { getSsbjWorkingPreview } from '../../services/previewService';
import { SSBJ_NARRATIVE_ITEMS, SSBJ_REQUIREMENTS } from '../../utils/requirementMaster';
import { notifySsbjWorkingChanged } from '../../utils/workingChange';
import { SSBJ_WORKING_RELOAD_DELAY_MS } from '../../hooks/useSsbjWorkingChangeReload';
import { SsbjReportHeader } from '../SsbjReportHeader.client';
import { SsbjReportOverviewProvider } from '../SsbjReportOverviewProvider.client';
import { SsbjWorkingAccessGuard } from '../SsbjWorkingAccessGuard.client';

const REPORT_ID = '5b1f0000-0000-4000-8000-000000000003';

const statusChange = (details: Record<string, unknown>): SsbjAuditLog => ({
  id: 9, reportId: REPORT_ID, actorUserId: 'user-approver', action: 'status_change', targetType: 'report',
  targetId: REPORT_ID, changedColumns: null, details, createdAt: '2025-06-10T09:40:00.000Z',
});
const REOPEN = statusChange({ operation: 'reopen', from: 'in_review', to: 'draft', comment: '監督の頻度が未入力です。' });

let rendered: RenderResult | null = null;
const flush = async () => {
  for (let i = 0; i < 3; i += 1) await act(async () => { await Promise.resolve(); });
};

/** current は /ssbj/[reportId]/ の下のパス（詳細画面は ''、印刷ビューは 'preview/print'）。 */
const renderHeader = async (current = 'narratives') => {
  navigation.segments = current ? current.split('/') : [];
  rendered = render(
    <SsbjReportOverviewProvider reportId={REPORT_ID}>
      <SsbjReportHeader />
      <SsbjWorkingAccessGuard reportId={REPORT_ID}><p data-testid="screen">画面本体</p></SsbjWorkingAccessGuard>
    </SsbjReportOverviewProvider>,
  );
  await flush();
  return rendered.container;
};

afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjReportHeader（差戻しの帯）', () => {
  it('最新の状態の変更が差戻しなら、理由・誰が・いつと、次にすること・操作履歴への入口を出す', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(REOPEN);
    const container = await renderHeader();

    const notice = container.querySelector('[data-testid="ssbj-reopen-notice"]');
    expect(notice?.textContent).toContain('差し戻されました（承認 次郎・');
    expect(notice?.textContent).toContain('監督の頻度が未入力です。');
    expect(notice?.textContent).toContain('もう一度レビューを依頼してください');
    expect(getLatestSsbjStatusChange).toHaveBeenCalledWith(REPORT_ID);
    const hrefs = Array.from(notice?.querySelectorAll('a') ?? []).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual([`/ssbj/${REPORT_ID}`, `/ssbj/${REPORT_ID}/history`]);
  });

  it('詳細画面では、詳細へのリンクの代わりに「状態と承認」から依頼するよう案内する', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('approver');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(REOPEN);
    const container = await renderHeader('');

    const notice = container.querySelector('[data-testid="ssbj-reopen-notice"]');
    expect(notice?.textContent).toContain('「状態と承認」からもう一度レビューを依頼してください');
    expect(Array.from(notice?.querySelectorAll('a') ?? []).map(a => a.getAttribute('href'))).toEqual([`/ssbj/${REPORT_ID}/history`]);
  });

  it('依頼し直した後・承認の後は帯を出さない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    for (const operation of ['submit', 'approve', 'withdraw']) {
      vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(statusChange({ operation, from: 'draft', to: 'in_review' }));
      const container = await renderHeader();
      expect(container.querySelector('[data-testid="ssbj-reopen-notice"]')).toBeNull();
      rendered?.unmount();
      rendered = null;
    }
  });

  it('閲覧者・ロールが分からない人には、操作履歴を読まず、帯も出さない', async () => {
    for (const role of ['viewer', null] as const) {
      vi.mocked(getMySsbjRole).mockResolvedValue(role);
      vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(REOPEN);
      const container = await renderHeader();
      expect(container.querySelector('[data-testid="ssbj-reopen-notice"]')).toBeNull();
      expect(getLatestSsbjStatusChange).not.toHaveBeenCalled();
      rendered?.unmount();
      rendered = null;
    }
  });

  it('操作履歴の画面では「操作履歴で見る」を出さない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(REOPEN);
    const container = await renderHeader('history');

    const notice = container.querySelector('[data-testid="ssbj-reopen-notice"]');
    expect(notice?.textContent).not.toContain('操作履歴で見る');
    expect(Array.from(notice?.querySelectorAll('a') ?? []).map(a => a.getAttribute('href'))).toEqual([`/ssbj/${REPORT_ID}`]);
  });

  it('印刷ビューには帯を出さず、操作履歴も読まない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(REOPEN);
    const container = await renderHeader('preview/print');

    expect(container.querySelector('[data-testid="ssbj-report-header"]')).toBeNull();
    expect(getLatestSsbjStatusChange).not.toHaveBeenCalled();
  });

  it('Provider の中の画面（入口の確認）は、Provider が読んだロールを使い、ロールと利用者の一覧を 1 回だけ読む', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(REOPEN);
    const container = await renderHeader('judgements');

    expect(container.querySelector('[data-testid="screen"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ssbj-reopen-notice"]')).not.toBeNull();
    expect(getMySsbjRole).toHaveBeenCalledTimes(1);
    expect(listSsbjMembers).toHaveBeenCalledTimes(1);
  });

  it('差戻しの帯を出さない入力画面では、利用者の一覧を読まない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(null);
    await renderHeader('narratives');
    expect(listSsbjMembers).not.toHaveBeenCalled();
  });
});

describe('SsbjReportHeader（画面のタブ）', () => {
  const REQUIREMENT_ITEMS = SSBJ_NARRATIVE_ITEMS.filter(item => item.kind === 'requirement').length;
  const tabs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-testid="ssbj-report-tabs"] a'));

  it('全画面のタブを出し、入力の画面には進み具合の数を添え、今いる画面に aria-current を付ける', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(null);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 3, snapshot: fictionalSnapshot });
    const container = await renderHeader('judgements');

    const links = tabs(container);
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      '', '/narratives', '/risks', '/judgements', '/ghg', '/external', '/evidence', '/preview', '/versions', '/history',
    ].map(path => `/ssbj/${REPORT_ID}${path}`));
    const text = (path: string) => links.find(a => a.getAttribute('href') === `/ssbj/${REPORT_ID}${path}`)?.textContent;
    expect(text('/narratives')).toBe(`文章2/${REQUIREMENT_ITEMS}`);
    expect(text('/judgements')).toBe(`判断3/${SSBJ_REQUIREMENTS.length}`);
    expect(text('/risks')).toBe('リスク・機会3');
    expect(text('/ghg')).toBe('GHG採用済');
    expect(text('/evidence')).toBe('根拠1/2');
    expect(text('/preview')).toBe('プレビュー');
    expect(links.filter(a => a.getAttribute('aria-current') === 'page').map(a => a.getAttribute('href')))
      .toEqual([`/ssbj/${REPORT_ID}/judgements`]);
    // 作業中の内容は 1 回だけ読む。
    expect(getSsbjWorkingPreview).toHaveBeenCalledTimes(1);
  });

  it('閲覧者には、閲覧できる画面（概要・プレビュー・保存履歴）のタブだけを、数を付けずに出す', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('viewer');
    const container = await renderHeader('preview');

    expect(tabs(container).map(a => a.textContent)).toEqual(['概要', 'プレビュー', '保存履歴']);
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(tabs(container)[1].getAttribute('aria-current')).toBe('page');
  });

  it('作業中の内容を読めないときも、タブは数を付けずに出す', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('approver');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(null);
    vi.mocked(getSsbjWorkingPreview).mockRejectedValue(new Error('プレビューの取得に失敗しました'));
    const container = await renderHeader('');

    const links = tabs(container);
    expect(links).toHaveLength(10);
    expect(links[1].textContent).toBe('文章');
    expect(links[0].getAttribute('aria-current')).toBe('page');
  });

  it('作業中の内容が書き換わった知らせを受けたら、続けて来た知らせをまとめて 1 回だけ読み直し、同じ画面の中で数を新しくする', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(null);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 3, snapshot: fictionalSnapshot });
    const container = await renderHeader('narratives');
    expect(tabs(container)[1].textContent).toBe(`文章2/${REQUIREMENT_ITEMS}`);

    // 文章を 1 つ入力済みにした後の内容。
    const narratives = [...(fictionalSnapshot.sections.narratives ?? []), {
      itemId: 'governance.oversight_information' as const,
      text: { disclosure: { state: 'answered' as const, value: '年 2 回報告を受けている（架空）。' }, internalNote: null },
    }];
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({
      kind: 'working', draftRevision: 4, snapshot: { ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, narratives } },
    });
    vi.useFakeTimers();
    try {
      act(() => {
        notifySsbjWorkingChanged(REPORT_ID);
        notifySsbjWorkingChanged();
      });
      act(() => { vi.advanceTimersByTime(SSBJ_WORKING_RELOAD_DELAY_MS - 1); });
      expect(getSsbjWorkingPreview).toHaveBeenCalledTimes(1);
      act(() => { vi.advanceTimersByTime(1); });
      // 読み直している間も、前の数を出したままにする。
      expect(tabs(container)[1].textContent).toBe(`文章2/${REQUIREMENT_ITEMS}`);
    } finally {
      vi.useRealTimers();
    }
    await flush();
    expect(getSsbjWorkingPreview).toHaveBeenCalledTimes(2);
    expect(tabs(container)[1].textContent).toBe(`文章3/${REQUIREMENT_ITEMS}`);
  });

  it('別のレポートの知らせでは読み直さない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(null);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 3, snapshot: fictionalSnapshot });
    await renderHeader('narratives');
    vi.useFakeTimers();
    try {
      act(() => { notifySsbjWorkingChanged('5b1f0000-0000-4000-8000-0000000000ff'); });
      act(() => { vi.advanceTimersByTime(SSBJ_WORKING_RELOAD_DELAY_MS * 2); });
    } finally {
      vi.useRealTimers();
    }
    await flush();
    expect(getSsbjWorkingPreview).toHaveBeenCalledTimes(1);
  });

  it('入力済みの文章が 0 件なら、根拠のタブは「—」にする。印刷ビューにはタブを出さない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getLatestSsbjStatusChange).mockResolvedValue(null);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({
      kind: 'working', draftRevision: 1, snapshot: { ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, narratives: [] } },
    });
    let container = await renderHeader('evidence');
    expect(tabs(container).find(a => a.getAttribute('href')?.endsWith('/evidence'))?.textContent).toBe('根拠—');
    rendered?.unmount();
    container = await renderHeader('preview/print');
    expect(tabs(container)).toHaveLength(0);
  });
});

