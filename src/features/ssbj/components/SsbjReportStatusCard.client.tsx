'use client';

// SSBJ レポートの状態と承認の欄（詳細画面）。状態・承認者・承認の記録を出し、今の状態でできる操作
// （レビュー依頼・取り下げ・承認・差戻し）を出す。承認すると、その時点の内容で保存版を作り、作業中の内容を編集できなくする。
// 承認・差戻しは、指定された承認者か管理者だけが押せる（サーバも同じ判定をする）。

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjMembers } from '../hooks/useSsbjMembers';
import { useSsbjReportStatus } from '../hooks/useSsbjReportStatus';
import { memberName } from '../services/memberService';
import type { SsbjReportStatusChangeResult } from '../services/reportWorkflowClient';
import type { SsbjReportWorkingRecord } from '../types';
import { SSBJ_STATUS_ACTION_LABELS, ssbjStatusActions } from '../utils/reportStatus';
import { SsbjReportStatusBadge } from './SsbjReportStatusBadge';

const DESCRIPTIONS = {
  draft: '入力が終わったら、承認者を選んでレビューを依頼します。',
  in_review: '承認者が内容を確認しています。承認すると、その時点の内容で保存版を作り、編集できなくなります。',
  approved: '承認済みのため、作業中の内容を編集できません。変更するには、承認者か管理者が差戻します。',
} as const;

interface SsbjReportStatusCardProps {
  report: SsbjReportWorkingRecord;
  /** 状態を変えた後（レポートを読み直させる）。 */
  onChanged: (result: SsbjReportStatusChangeResult) => void;
  /** 基本情報の編集中など、未保存の入力があるとき true（承認・依頼させない）。 */
  disabled: boolean;
}

export const SsbjReportStatusCard = ({ report, onChanged, disabled }: SsbjReportStatusCardProps) => {
  const { members, currentUserId, currentRole, errorMessage: membersError } = useSsbjMembers();
  const status = useSsbjReportStatus(report, onChanged);
  const { review } = report;
  const actions = ssbjStatusActions(review, currentUserId, currentRole);
  const reasons = [...new Set(actions.flatMap(option => (option.allowed || !option.reason ? [] : [option.reason])))];

  return (
    <Card data-testid="ssbj-report-status-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-base font-bold">状態と承認</h2>
        <SsbjReportStatusBadge status={review.status} />
      </div>
      <p className="m-0 mb-3 text-sm text-text-muted">{DESCRIPTIONS[review.status]}</p>

      <dl className="m-0 mb-4 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-xs font-semibold text-text-muted">承認者</dt>
        <dd className="m-0">{review.approverUserId ? memberName(members, review.approverUserId) : '未指定'}</dd>
        {review.status === 'approved' && review.approvedAt && (
          <>
            <dt className="text-xs font-semibold text-text-muted">承認</dt>
            <dd className="m-0">
              {memberName(members, review.approvedByUserId)}（{formatDateTime(review.approvedAt)}）
              {review.approvedVersionId && (
                <>
                  {' '}・{' '}
                  <Link
                    href={`/ssbj/${encodeURIComponent(report.id)}/preview?source=${encodeURIComponent(review.approvedVersionId)}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    承認した保存版を見る
                  </Link>
                </>
              )}
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-col gap-3">
        {review.status === 'draft' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssbj-status-approver">承認者</Label>
            <select
              id="ssbj-status-approver"
              className="gt-field gt-field-select"
              value={status.approverUserId}
              disabled={status.isSaving || disabled}
              onChange={event => status.setApproverUserId(event.target.value)}
            >
              <option value="">選んでください</option>
              {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ssbj-status-comment">コメント（任意。操作履歴に残ります）</Label>
          <Textarea
            id="ssbj-status-comment"
            rows={2}
            maxLength={1000}
            value={status.comment}
            disabled={status.isSaving || disabled}
            onChange={event => status.setComment(event.target.value)}
          />
        </div>
        {(status.errorMessage || membersError) && (
          <p role="alert" className="m-0 text-sm text-danger">{status.errorMessage || membersError}</p>
        )}
        {disabled && (
          <p className="m-0 text-xs text-text-muted">基本情報の編集中は操作できません。先に変更を保存するか、キャンセルしてください。</p>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.map(option => (
            <Button
              key={option.action}
              type="button"
              variant={option.action === 'approve' || option.action === 'submit' ? 'default' : 'outline'}
              disabled={!option.allowed || status.isSaving || disabled}
              onClick={() => void status.run(option.action)}
            >
              {status.isSaving ? '処理中...' : SSBJ_STATUS_ACTION_LABELS[option.action]}
            </Button>
          ))}
        </div>
        {reasons.map(reason => <p key={reason} className="m-0 text-xs text-text-muted">{reason}</p>)}
      </div>
    </Card>
  );
};
