// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';

// 作業中の内容の画面の入口: 閲覧者には画面の代わりに承認した保存版の見方を案内し、それ以外のロールには画面を出す。

vi.mock('../../services/memberRoleService', () => ({ getMySsbjRole: vi.fn() }));

import { getMySsbjRole } from '../../services/memberRoleService';
import { SsbjReportContentsNav } from '../SsbjReportContentsNav';
import { SsbjWorkingAccessGuard } from '../SsbjWorkingAccessGuard.client';

const REPORT_ID = '5b1f0000-1111-4000-8000-000000000001';
let rendered: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjWorkingAccessGuard', () => {
  it.each(['admin', 'editor', 'approver'] as const)('%s には画面を出す', async role => {
    vi.mocked(getMySsbjRole).mockResolvedValue(role);
    rendered = render(<SsbjWorkingAccessGuard reportId={REPORT_ID}><p data-testid="screen">画面</p></SsbjWorkingAccessGuard>);
    await flush();
    expect(rendered.container.querySelector('[data-testid="screen"]')).not.toBeNull();
  });

  it('閲覧者・ロールが分からない人には画面を出さず、承認した保存版の見方を案内する', async () => {
    for (const role of ['viewer', null] as const) {
      vi.mocked(getMySsbjRole).mockResolvedValue(role);
      rendered = render(<SsbjWorkingAccessGuard reportId={REPORT_ID}><p data-testid="screen">画面</p></SsbjWorkingAccessGuard>);
      await flush();
      expect(rendered.container.querySelector('[data-testid="screen"]')).toBeNull();
      expect(rendered.container.querySelector('[data-testid="ssbj-working-access-denied"]')?.textContent).toContain('作業中の内容は見られません');
      const link = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent === '承認した保存版を見る');
      expect(link?.getAttribute('href')).toBe(`/ssbj/${REPORT_ID}/preview`);
      rendered.unmount();
      rendered = null;
    }
  });
});

describe('SsbjReportContentsNav', () => {
  it('作業中の内容を見られない人（閲覧者）には、プレビューと保存履歴だけを出す', () => {
    rendered = render(<SsbjReportContentsNav reportId={REPORT_ID} workingAccess={false} />);
    const hrefs = Array.from(rendered.container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual([`/ssbj/${REPORT_ID}/preview`, `/ssbj/${REPORT_ID}/versions`]);
  });

  it('それ以外の人には、すべての入口を出す', () => {
    rendered = render(<SsbjReportContentsNav reportId={REPORT_ID} />);
    expect(rendered.container.querySelectorAll('a')).toHaveLength(9);
  });
});
