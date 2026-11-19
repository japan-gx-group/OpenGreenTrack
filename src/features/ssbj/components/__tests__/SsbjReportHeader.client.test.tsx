// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import type { SsbjAuditLog } from '../../types';

// レポートの中の画面の上に出す部品: 差し戻されたときの帯（理由・誰が・いつ・次にすること）と、閲覧者に出さないことを検証する。
// レイアウトと同じく Provider の下に描き、今いる画面はレイアウトの下の選択中のセグメントから決める。

const navigation = vi.hoisted(() => ({ segments: [] as string[] }));
vi.mock('next/navigation', () => ({ useSelectedLayoutSegments: () => navigation.segments }));

vi.mock('../../services/memberRoleService', () => ({ getMySsbjRole: vi.fn() }));
vi.mock('../../services/auditLogService', () => ({ getLatestSsbjStatusChange: vi.fn() }));
vi.mock('../../services/memberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberService')>()),
  listSsbjMembers: vi.fn(async () => [{ id: 'user-approver', name: '承認 次郎', role: 'logger' }]),
  getCurrentSsbjUserId: vi.fn(async () => 'user-editor'),
}));

import { getLatestSsbjStatusChange } from '../../services/auditLogService';
import { getMySsbjRole } from '../../services/memberRoleService';
import { listSsbjMembers } from '../../services/memberService';
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
