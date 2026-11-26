// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_DRAFT_REVIEW, fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';
import type { SsbjReportWorkingRecord } from '../../types';
import { SSBJ_EDIT_CONFLICT_MESSAGE, SsbjEditConflictError } from '../../utils/writeError';

// SSBJ レポート詳細画面: 基本情報の再表示・未入力の表示・Not Found・編集保存・保存版の作成を検証する。
// ページと同じく SsbjReportOverviewProvider で包んだときの、依頼の前の点検表も検証する。

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()),
  getSsbjReport: vi.fn(),
  updateSsbjReportBasicInfo: vi.fn(),
}));

// Provider はレイアウトの下の選択中のセグメントで今いる画面を決める（詳細画面は空）。
vi.mock('next/navigation', () => ({ useSelectedLayoutSegments: () => [] }));

// Provider で包んだときだけ読む（作業中の内容・最新の差戻し・OGT の最新の値）。
vi.mock('../../services/previewService', () => ({ getSsbjWorkingPreview: vi.fn(), getSsbjVersionPreview: vi.fn() }));
vi.mock('../../services/auditLogService', () => ({ getLatestSsbjStatusChange: vi.fn(async () => null) }));
vi.mock('../../services/ogtCandidateService', () => ({ getOgtCandidates: vi.fn() }));

vi.mock('../../services/versionClient', () => ({
  saveSsbjReportVersion: vi.fn(),
}));

vi.mock('../../services/memberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberService')>()),
  listSsbjMembers: vi.fn(async () => [
    { id: 'user-admin', name: '環境 太郎', role: 'admin' },
    { id: 'user-logger', name: '算定 花子', role: 'logger' },
  ]),
  getCurrentSsbjUserId: vi.fn(async () => 'user-logger'),
}));

vi.mock('../../services/reportWorkflowClient', () => ({
  changeSsbjReportStatus: vi.fn(),
}));

vi.mock('../../services/approvalBlockerService', () => ({
  getMySsbjApprovalBlocker: vi.fn(async () => null),
}));

// ログイン中の利用者（算定 花子）の SSBJ のロールは既定で入力担当。承認者として操作するテストでは承認担当にする。
vi.mock('../../services/memberRoleService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberRoleService')>()),
  getMySsbjRole: vi.fn(async () => 'editor'),
  listSsbjMemberRoles: vi.fn(async () => new Map()),
}));

import {
  fictionalOgtCandidates,
  fictionalSnapshot,
  fictionalSupplierReferences,
} from '../../__fixtures__/fictionalReport';
import { getMySsbjApprovalBlocker } from '../../services/approvalBlockerService';
import { getOgtCandidates } from '../../services/ogtCandidateService';
import { getSsbjWorkingPreview } from '../../services/previewService';
import { getMySsbjRole } from '../../services/memberRoleService';
import { listSsbjMembers } from '../../services/memberService';
import { SSBJ_WORKING_RELOAD_DELAY_MS } from '../../hooks/useSsbjWorkingChangeReload';
import { notifySsbjWorkingChanged } from '../../utils/workingChange';
import { changeSsbjReportStatus } from '../../services/reportWorkflowClient';
import { getSsbjReport, updateSsbjReportBasicInfo } from '../../services/reportService';
import { saveSsbjReportVersion } from '../../services/versionClient';
import { SsbjReportDetail } from '../SsbjReportDetail.client';
import { SsbjReportOverviewProvider } from '../SsbjReportOverviewProvider.client';

const REPORT: SsbjReportWorkingRecord = {
  ...fictionalReportBasicInfo,
  standardVersion: null,
  fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01',
  periodEnd: '2025-03-31',
  draftRevision: 3,
  basicInfoRevision: 5,
  review: FICTIONAL_DRAFT_REVIEW,
};

const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const findButton = (container: ParentNode, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    element => element.textContent?.trim() === label,
  );
  if (!button) throw new Error(`ボタンが見つかりません: ${label}`);
  return button;
};

let rendered: RenderResult | null = null;

const renderScreen = async (reportId = REPORT.id): Promise<RenderResult> => {
  rendered = render(<SsbjReportDetail reportId={reportId} />);
  await flushPromises();
  return rendered;
};

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.clearAllMocks();
  // テストごとに変えたロールを、既定（入力担当）に戻す。
  vi.mocked(getMySsbjRole).mockResolvedValue('editor');
});

describe('SsbjReportDetail', () => {
  it('基本情報と対象年度を表示し、未入力の項目は「未入力」と表示する', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const { container } = await renderScreen();

    expect(getSsbjReport).toHaveBeenCalledWith(REPORT.id);
    const text = container.textContent ?? '';
    expect(text).toContain(REPORT.purpose ?? '');
    expect(text).toContain('2024年度（2024-04-01 〜 2025-03-31）');
    const standardVersionRow = Array.from(container.querySelectorAll('dt')).find(
      dt => dt.textContent === '参照する基準の版',
    );
    expect(standardVersionRow?.nextElementSibling?.textContent).toBe('未入力');
  });

  it('存在しない・他組織のレポートは「見つかりません」を表示し、内容を出さない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    const { container } = await renderScreen('5b1f0000-0000-4000-8000-0000000000ff');

    expect(container.textContent).toContain('SSBJレポートが見つかりません');
    expect(container.querySelector('dl')).toBeNull();
  });

  it('取得エラーは Not Found と区別して表示する', async () => {
    vi.mocked(getSsbjReport).mockRejectedValue(new Error('SSBJレポートの取得に失敗しました'));
    const { container } = await renderScreen();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('SSBJレポートの取得に失敗しました');
    expect(container.textContent).not.toContain('SSBJレポートが見つかりません');
  });

  it('編集して保存すると更新後の内容を再表示する', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const updated: SsbjReportWorkingRecord = { ...REPORT, title: '改訂後のレポート名', draftRevision: 4 };
    vi.mocked(updateSsbjReportBasicInfo).mockResolvedValue(updated);
    const { container } = await renderScreen();

    click(findButton(container, '編集'));
    const titleInput = container.querySelector<HTMLInputElement>('input[name="title"]');
    if (!titleInput) throw new Error('レポート名の入力欄がありません');
    expect(titleInput.value).toBe(REPORT.title);

    setInputValue(titleInput, '改訂後のレポート名');
    click(findButton(container, '変更を保存'));
    await flushPromises();

    expect(updateSsbjReportBasicInfo).toHaveBeenCalledWith(REPORT.id, 5, {
      title: '改訂後のレポート名',
      purpose: REPORT.purpose,
      reportingScope: REPORT.reportingScope,
      standardVersion: null,
      parentCompanyName: REPORT.parentCompanyName,
      parentRelationship: REPORT.parentRelationship,
      ownershipPercentage: REPORT.ownershipPercentage,
      measurementApproach: REPORT.measurementApproach,
      industryCode: REPORT.industryCode,
    });
    expect(container.querySelector('input[name="title"]')).toBeNull();
    expect(container.querySelector('dl')?.textContent).toContain('改訂後のレポート名');
  });

  it('親会社との関係・持分比率・測定アプローチ・業種を表示し、業種には産業別ガイダンスの巻へのリンクを出す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const { container } = await renderScreen();

    const text = container.querySelector('dl')?.textContent ?? '';
    expect(text).toContain('架空サンプルホールディングス株式会社');
    expect(text).toContain('連結子会社');
    expect(text).toContain('100%');
    expect(text).toContain('経営支配力アプローチ');
    expect(text).toContain('RT-IG 工業用機械及び製品');
    const link = container.querySelector<HTMLAnchorElement>('dl a');
    expect(link?.href).toBe('https://www.ssb-j.jp/jp/wp-content/uploads/sites/6/s2-50_20231020.pdf');
    expect(link?.textContent).toContain('第50巻');
  });

  it('業種と持分比率を編集すると、選んだ値で保存する。持分比率の形式が違えば保存しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(updateSsbjReportBasicInfo).mockResolvedValue({ ...REPORT, industryCode: 'TR-RO', ownershipPercentage: '35' });
    const { container } = await renderScreen();

    click(findButton(container, '編集'));
    const industry = container.querySelector<HTMLSelectElement>('select[name="industryCode"]');
    const ownership = container.querySelector<HTMLInputElement>('input[name="ownershipPercentage"]');
    if (!industry || !ownership) throw new Error('業種・持分比率の入力欄がありません');
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    act(() => {
      selectSetter?.call(industry, 'TR-RO');
      industry.dispatchEvent(new Event('change', { bubbles: true }));
    });

    setInputValue(ownership, '101');
    click(findButton(container, '変更を保存'));
    await flushPromises();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('持分比率は 0 より大きく 100 以下');
    expect(updateSsbjReportBasicInfo).not.toHaveBeenCalled();

    setInputValue(ownership, '35');
    click(findButton(container, '変更を保存'));
    await flushPromises();
    expect(vi.mocked(updateSsbjReportBasicInfo).mock.calls[0][2]).toMatchObject({
      industryCode: 'TR-RO',
      ownershipPercentage: '35',
    });
  });

  it('保存版の作成は、読込時の draftRevision を渡して版番号を知らせる', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(saveSsbjReportVersion).mockResolvedValue({ id: 'version-1', versionNumber: 2 });
    const { container } = await renderScreen();

    click(findButton(container, '保存版を作成'));
    await flushPromises();

    expect(saveSsbjReportVersion).toHaveBeenCalledWith(REPORT.id, 3);
    expect(container.textContent).toContain('版 2 として保存しました');
  });

  it('基本情報を保存した後は、更新後の draftRevision で保存版を作る', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(updateSsbjReportBasicInfo).mockResolvedValue({ ...REPORT, draftRevision: 4 });
    vi.mocked(saveSsbjReportVersion).mockResolvedValue({ id: 'version-1', versionNumber: 1 });
    const { container } = await renderScreen();

    click(findButton(container, '編集'));
    click(findButton(container, '変更を保存'));
    await flushPromises();
    click(findButton(container, '保存版を作成'));
    await flushPromises();

    expect(saveSsbjReportVersion).toHaveBeenCalledWith(REPORT.id, 4);
  });

  it('基本情報の編集中は保存版を作成できない（未保存の入力が保存版に入らないため）', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const { container } = await renderScreen();

    click(findButton(container, '編集'));

    expect(findButton(container, '保存版を作成').disabled).toBe(true);
  });

  it('他の画面で先に基本情報が保存されていたら、競合を知らせて入力を残し、表示用のレポートを読み直す', async () => {
    // 画面 B が開いた時点のレポート。その後、画面 A が名称を変えて保存した。
    const savedByOther: SsbjReportWorkingRecord = { ...REPORT, title: '画面Aが保存した名称', basicInfoRevision: 6 };
    vi.mocked(getSsbjReport).mockResolvedValueOnce(REPORT).mockResolvedValue(savedByOther);
    vi.mocked(updateSsbjReportBasicInfo).mockRejectedValue(new SsbjEditConflictError());
    const { container } = await renderScreen();

    click(findButton(container, '編集'));
    const parentInput = container.querySelector<HTMLInputElement>('input[name="parentCompanyName"]');
    if (!parentInput) throw new Error('親会社名の入力欄がありません');
    setInputValue(parentInput, '画面Bで書いた親会社名');
    click(findButton(container, '変更を保存'));
    await flushPromises();
    await flushPromises();

    // 編集を始めた時点の版数で保存しようとし、拒否される。
    expect(updateSsbjReportBasicInfo).toHaveBeenCalledWith(REPORT.id, 5, expect.objectContaining({
      title: REPORT.title, parentCompanyName: '画面Bで書いた親会社名',
    }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(SSBJ_EDIT_CONFLICT_MESSAGE);
    // 入力中の値は消さない。
    expect(container.querySelector<HTMLInputElement>('input[name="parentCompanyName"]')?.value).toBe('画面Bで書いた親会社名');
    expect(getSsbjReport).toHaveBeenCalledTimes(2);

    // 読み直しても、フォームは開いたときの版数のまま（古い入力で再送しても上書きしない）。
    click(findButton(container, '変更を保存'));
    await flushPromises();
    expect(vi.mocked(updateSsbjReportBasicInfo).mock.calls[1][1]).toBe(5);

    // キャンセルすると、他の画面が保存した最新の内容が見え、編集し直すと最新の版数で保存する。
    click(findButton(container, 'キャンセル'));
    expect(container.querySelector('dl')?.textContent).toContain('画面Aが保存した名称');
    vi.mocked(updateSsbjReportBasicInfo).mockResolvedValue(savedByOther);
    click(findButton(container, '編集'));
    expect(container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe('画面Aが保存した名称');
    click(findButton(container, '変更を保存'));
    await flushPromises();
    expect(vi.mocked(updateSsbjReportBasicInfo).mock.calls[2][1]).toBe(6);
  });

  it('競合などで保存できなかった理由を表示する', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(saveSsbjReportVersion).mockRejectedValue(
      new Error('他の変更と競合しました。画面を開き直してから保存し直してください'),
    );
    const { container } = await renderScreen();

    click(findButton(container, '保存版を作成'));
    await flushPromises();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      '他の変更と競合しました。画面を開き直してから保存し直してください',
    );
  });
});

describe('SsbjReportDetail（SSBJ のロール）', () => {
  it('入力担当か管理者でなければ、保存版の作成を出さない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('approver');
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const { container } = await renderScreen();
    await flushPromises();
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.includes('保存版を作成'))).toBe(false);
  });
});

describe('SsbjReportDetail（状態と承認）', () => {
  const setSelect = (select: HTMLSelectElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const setTextarea = (textarea: HTMLTextAreaElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('作成中は承認者を選んでレビューを依頼する（選ばなければ送らない）。依頼したらレポートを読み直す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(changeSsbjReportStatus).mockResolvedValue({
      status: 'in_review', approverUserId: 'user-admin', reviewRequestedByUserId: 'user-logger', approvedVersionId: null,
      approvedVersionNumber: null,
    });
    const { container } = await renderScreen();
    await flushPromises();
    const card = container.querySelector<HTMLElement>('[data-testid="ssbj-report-status-card"]')!;
    expect(card.textContent).toContain('作成中');

    await act(async () => { click(findButton(card, 'レビューを依頼する')); });
    expect(changeSsbjReportStatus).not.toHaveBeenCalled();
    expect(card.querySelector('[role="alert"]')?.textContent).toContain('承認者を選んでください');

    setSelect(card.querySelector<HTMLSelectElement>('#ssbj-status-approver')!, 'user-admin');
    await act(async () => { click(findButton(card, 'レビューを依頼する')); });
    await flushPromises();
    expect(changeSsbjReportStatus).toHaveBeenCalledWith(REPORT.id, {
      action: 'submit', expectedDraftRevision: 3, approverUserId: 'user-admin', comment: null,
    });
    expect(getSsbjReport).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('レビューを依頼しました');
  });

  it('レビュー中: 承認者でも管理者でもない人には承認・差戻しを押させず、理由を出す（取り下げはできる）', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({
      ...REPORT, review: { ...REPORT.review, status: 'in_review', approverUserId: 'user-admin' },
    });
    const { container } = await renderScreen();
    await flushPromises();
    const card = container.querySelector<HTMLElement>('[data-testid="ssbj-report-status-card"]')!;
    expect(findButton(card, '承認する').disabled).toBe(true);
    expect(findButton(card, '差戻す').disabled).toBe(true);
    expect(findButton(card, '依頼を取り下げる').disabled).toBe(false);
    expect(card.textContent).toContain('承認・差戻しは、承認担当か管理者だけができます');
    expect(card.textContent).toContain('環境 太郎');
  });

  it('承認済みは基本情報を編集させず、ロックの案内と承認した保存版へのリンクを出す', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('approver');
    vi.mocked(getSsbjReport).mockResolvedValue({
      ...REPORT,
      review: {
        status: 'approved', approverUserId: 'user-logger', approvedAt: '2025-06-05T00:00:00.000Z',
        approvedByUserId: 'user-logger', approvedVersionId: '5b1f0000-0000-4000-8000-000000000004', statusChangedAt: null,
        reviewRequestedByUserId: 'user-admin',
      },
    });
    const { container } = await renderScreen();
    await flushPromises();
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === '編集')).toBe(false);
    expect(container.querySelector('[data-testid="ssbj-locked-notice"]')).not.toBeNull();
    const link = Array.from(container.querySelectorAll('a')).find(a => a.textContent === '承認した保存版を見る');
    expect(link?.getAttribute('href')).toBe(`/ssbj/${REPORT.id}/preview?source=5b1f0000-0000-4000-8000-000000000004`);
    // 承認者本人には差戻しを押させる。
    expect(findButton(container.querySelector('[data-testid="ssbj-report-status-card"]')!, '差戻す').disabled).toBe(false);
  });

  it('自己承認の防止: 承認者の選択肢に自分は出さない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({ ...REPORT, review: { ...REPORT.review, approverUserId: 'user-logger' } });
    const { container } = await renderScreen();
    await flushPromises();
    const select = container.querySelector<HTMLSelectElement>('#ssbj-status-approver')!;
    expect(Array.from(select.options).map(option => option.value)).toEqual(['', 'user-admin']);
    // 前回の承認者が自分でも、未選択から始める（自分を送らない）。
    expect(select.value).toBe('');
  });

  it('自己承認の防止: 依頼の後に内容を変更した承認者には承認させず、理由を出す（サーバに問い合わせた結果）', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('approver');
    vi.mocked(getSsbjReport).mockResolvedValue({
      ...REPORT,
      review: { ...REPORT.review, status: 'in_review', approverUserId: 'user-logger', reviewRequestedByUserId: 'user-admin' },
    });
    vi.mocked(getMySsbjApprovalBlocker).mockResolvedValue('edited_after_request');
    const { container } = await renderScreen();
    await flushPromises();
    const card = container.querySelector<HTMLElement>('[data-testid="ssbj-report-status-card"]')!;
    expect(getMySsbjApprovalBlocker).toHaveBeenCalledWith(REPORT.id);
    expect(findButton(card, '承認する').disabled).toBe(true);
    expect(card.textContent).toContain('レビューの依頼の後に内容を変更したため、承認できません');
    expect(card.textContent).toContain('レビューの依頼');
    expect(findButton(card, '差戻す').disabled).toBe(false);
  });

  it('差戻しはダイアログで理由を必須にし、理由をコメントとして送る', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValue('approver');
    vi.mocked(getSsbjReport).mockResolvedValue({
      ...REPORT,
      review: { ...REPORT.review, status: 'in_review', approverUserId: 'user-logger', reviewRequestedByUserId: 'user-admin' },
    });
    vi.mocked(changeSsbjReportStatus).mockResolvedValue({
      status: 'draft', approverUserId: 'user-logger', reviewRequestedByUserId: 'user-admin', approvedVersionId: null,
      approvedVersionNumber: null,
    });
    const { container } = await renderScreen();
    await flushPromises();
    const card = container.querySelector<HTMLElement>('[data-testid="ssbj-report-status-card"]')!;
    await act(async () => { click(findButton(card, '差戻す')); });

    const reason = document.querySelector<HTMLTextAreaElement>('#ssbj-reopen-reason');
    expect(reason).not.toBeNull();
    const dialog = reason!.closest<HTMLElement>('[role="dialog"]')!;
    expect(findButton(dialog, '差戻す').disabled).toBe(true);
    expect(changeSsbjReportStatus).not.toHaveBeenCalled();

    setTextarea(reason!, '  数値の根拠を確認してください  ');
    expect(findButton(dialog, '差戻す').disabled).toBe(false);
    await act(async () => { click(findButton(dialog, '差戻す')); });
    await flushPromises();
    expect(changeSsbjReportStatus).toHaveBeenCalledWith(REPORT.id, {
      action: 'reopen', expectedDraftRevision: 3, approverUserId: null, comment: '数値の根拠を確認してください',
    });
    expect(document.querySelector('#ssbj-reopen-reason')).toBeNull();
  });
});

describe('SsbjReportDetail（依頼の前の点検表）', () => {
  const renderWithOverview = async (): Promise<RenderResult> => {
    rendered = render(
      <SsbjReportOverviewProvider reportId={REPORT.id}>
        <SsbjReportDetail reportId={REPORT.id} />
      </SsbjReportOverviewProvider>,
    );
    for (let i = 0; i < 4; i += 1) await flushPromises();
    return rendered;
  };
  const checklistOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="ssbj-review-checklist"]');

  it('作成中のレポートで依頼できる人には、依頼ボタンの上に点検表を出し、各行から該当の画面へ開ける（依頼は止めない）', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 3, snapshot: fictionalSnapshot });
    // 採用した後に Scope 1 の値が変わった。
    vi.mocked(getOgtCandidates).mockResolvedValue({
      candidates: fictionalOgtCandidates.map(candidate => (candidate.scope === 1 && candidate.scope3CategoryId === null
        ? { ...candidate, value: { state: 'answered', value: '999.000' } } as typeof candidate : candidate)),
      suppliers: fictionalSupplierReferences,
    });
    const { container } = await renderWithOverview();

    const checklist = checklistOf(container);
    expect(checklist).not.toBeNull();
    expect(checklist?.textContent).toContain('依頼の前の点検（6 項目中 4 項目に注意）');
    expect(checklist?.querySelector('[data-testid="ssbj-review-checklist-ogt"]')?.textContent).toContain('採用した後に変わった: Scope 1');
    expect(checklist?.querySelector('[data-testid="ssbj-review-checklist-conflict-material_without_text"]')?.textContent)
      .toContain('✓');
    const hrefs = Array.from(checklist?.querySelectorAll('a') ?? []).map(link => link.getAttribute('href'));
    expect(hrefs).toEqual(['narratives', 'judgements', 'evidence', 'ghg'].map(path => `/ssbj/${REPORT.id}/${path}`));
    // 点検表は承認者の選択と依頼ボタンより前にあり、依頼ボタンは押せる。
    const card = container.querySelector<HTMLElement>('[data-testid="ssbj-report-status-card"]')!;
    const submit = findButton(card, 'レビューを依頼する');
    expect(checklist!.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit.disabled).toBe(false);
    // 作業中の内容は画面の上のタブと共有し、1 回だけ読む。
    expect(getSsbjWorkingPreview).toHaveBeenCalledTimes(1);
    expect(getOgtCandidates).toHaveBeenCalledTimes(1);
  });

  it('OGT の値を採用していなければ、OGT の最新の値を読まずに「採用していない」と出す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({
      kind: 'working', draftRevision: 3, snapshot: { ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, ghg: null } },
    });
    const { container } = await renderWithOverview();

    expect(checklistOf(container)?.querySelector('[data-testid="ssbj-review-checklist-ogt"]')?.textContent)
      .toContain('GHG 排出量を採用していない');
    expect(getOgtCandidates).not.toHaveBeenCalled();
  });

  it('依頼できない人（承認担当）・作成中でないレポートには出さない', async () => {
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 3, snapshot: fictionalSnapshot });
    vi.mocked(getMySsbjRole).mockResolvedValue('approver');
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    let { container } = await renderWithOverview();
    expect(checklistOf(container)).toBeNull();
    rendered?.unmount();

    vi.mocked(getMySsbjRole).mockResolvedValue('editor');
    vi.mocked(getSsbjReport).mockResolvedValue({
      ...REPORT,
      review: { ...REPORT.review, status: 'in_review', approverUserId: 'user-admin', reviewRequestedByUserId: 'user-logger' },
    });
    ({ container } = await renderWithOverview());
    expect(checklistOf(container)).toBeNull();
    expect(getOgtCandidates).not.toHaveBeenCalled();
  });

  it('OGT の最新の値を読んでいる間は「確認中」と出す（注意に数えない）', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 3, snapshot: fictionalSnapshot });
    vi.mocked(getOgtCandidates).mockReturnValue(new Promise(() => {}));
    const { container } = await renderWithOverview();

    const ogtRow = checklistOf(container)?.querySelector('[data-testid="ssbj-review-checklist-ogt"]');
    expect(ogtRow?.textContent).toContain('確認中');
    expect(ogtRow?.textContent).toContain('最新の値と比べています');
    expect(checklistOf(container)?.textContent).toContain('（6 項目中 3 項目に注意）');
  });

  it('作業中の内容が書き換わった知らせで、同じ画面の中の点検表も新しくなる。ロールと利用者の一覧は 1 回だけ読む', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({
      kind: 'working', draftRevision: 3, snapshot: { ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, ghg: null } },
    });
    const { container } = await renderWithOverview();
    const evidenceRow = () => checklistOf(container)?.querySelector('[data-testid="ssbj-review-checklist-evidence"]')?.textContent;
    expect(evidenceRow()).toContain('根拠文書の無い入力済みの文章 1');

    // 根拠の無かった入力済みの文章（内部炭素価格）を未確認に戻した後の内容。
    const narratives = (fictionalSnapshot.sections.narratives ?? []).map(narrative =>
      narrative.itemId === 'metrics_targets.internal_carbon_price'
        ? { ...narrative, text: { disclosure: { state: 'unconfirmed' as const }, internalNote: null } } : narrative);
    vi.mocked(getSsbjWorkingPreview).mockResolvedValue({
      kind: 'working', draftRevision: 4,
      snapshot: { ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, ghg: null, narratives } },
    });
    vi.useFakeTimers();
    try {
      act(() => { notifySsbjWorkingChanged(REPORT.id); });
      act(() => { vi.advanceTimersByTime(SSBJ_WORKING_RELOAD_DELAY_MS); });
    } finally {
      vi.useRealTimers();
    }
    for (let i = 0; i < 4; i += 1) await flushPromises();
    expect(evidenceRow()).toContain('入力済みの文章にすべて根拠文書がある');
    expect(getSsbjWorkingPreview).toHaveBeenCalledTimes(2);
    expect(getMySsbjRole).toHaveBeenCalledTimes(1);
    expect(listSsbjMembers).toHaveBeenCalledTimes(1);
  });
});

