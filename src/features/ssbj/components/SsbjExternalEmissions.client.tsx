'use client';

// 外部で算定した排出量（外部算定値）の画面（/ssbj/[reportId]/external。docs/ssbj-spec.md §13）。
// OGT で算定できない排出量（CO2 以外のガス、対応していない排出源、子会社から届いた値など）を、
// 出典（算定した者・方法・根拠文書）と確認者を付けて登録する。Scope 1・Scope 3 で OGT の採用値と同じ区分の CO2 は
// 登録できない（DB が拒否する。二重計上の防止）。編集できるのは SSBJ の入力担当か管理者だけ。

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjEvidence } from '../hooks/useSsbjEvidence';
import { useSsbjExternalEmissionForm } from '../hooks/useSsbjExternalEmissionForm';
import { useSsbjExternalEmissions } from '../hooks/useSsbjExternalEmissions';
import { useSsbjMembers } from '../hooks/useSsbjMembers';
import { useSsbjMyRole } from '../hooks/useSsbjMyRole';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { deleteSsbjExternalEmission } from '../services/externalEmissionService';
import { memberName } from '../services/memberService';
import type { SsbjExternalEmission, SsbjExternalEmissionSnapshot } from '../types';
import { formatDecimalForDisplay } from '../utils/decimal';
import { externalEmissionGasesLabel, externalEmissionLabel } from '../utils/externalEmission';
import { isSsbjReadOnly } from '../utils/reportStatus';
import { SsbjEditorLayout } from './SsbjEditorLayout.client';
import { SsbjExternalEmissionDialog } from './SsbjExternalEmissionDialog.client';
import { SsbjLockedNotice } from './SsbjLockedNotice';
import { SsbjRoleNotice } from './SsbjRoleNotice';
import { SsbjTrialNotice } from './SsbjTrialNotice';

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className="m-0 whitespace-pre-wrap text-sm">{value}</dd>
  </div>
);

export const SsbjExternalEmissions = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: isReportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  // 承認済みか、SSBJ のロールが入力担当でも管理者でもなければ、編集の操作を出さない（DB も止める）。
  const myRole = useSsbjMyRole();
  const list = useSsbjExternalEmissions(reportId, report !== null);
  const evidence = useSsbjEvidence(reportId, report !== null);
  const { members } = useSsbjMembers();
  const form = useSsbjExternalEmissionForm(report);
  const [deleting, setDeleting] = useState<SsbjExternalEmission | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const readOnly = report ? isSsbjReadOnly(report.review, myRole.role) : true;
  const evidenceTitle = (id: string): string | null => evidence.items.find(item => item.id === id)?.documentTitle ?? null;

  // 保存されている根拠文書・確認者が今の選択肢に無ければ（根拠文書の削除・利用者の退会など）、空にして選び直してもらう。
  // 選択欄には出ないのに値だけ残り、保存すると分かりにくいエラー（権限の拒否など）になるため。
  const openEdit = (item: SsbjExternalEmission) => {
    form.open(item);
    if (evidence.items.length > 0 && !evidence.items.some(evidenceItem => evidenceItem.id === item.evidenceId)) {
      form.setField('evidenceId', '');
    }
    if (members.length > 0 && !members.some(member => member.id === item.confirmedByUserId)) {
      form.setField('confirmedByUserId', '');
    }
  };
  // 右側のプレビューに、入力中の一覧を重ねて出す（資料名・確認者の名前は今の値で補う）。
  const previewItems: SsbjExternalEmissionSnapshot[] = list.items.map(item => ({
    ...item, evidenceTitle: evidenceTitle(item.evidenceId), confirmedByName: memberName(members, item.confirmedByUserId),
  }));

  const save = async () => {
    const saved = await form.save();
    if (saved) list.upsert(saved);
  };

  const remove = async () => {
    if (!deleting || isDeleting) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteSsbjExternalEmission(deleting.id);
      list.remove(deleting.id);
      setDeleting(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '外部算定値の削除に失敗しました');
    } finally {
      setIsDeleting(false);
    }
  };

  const errorMessage = reportError || list.errorMessage || evidence.errorMessage;

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading
        title="外部で算定した排出量"
        description={report?.title ?? 'SSBJレポート'}
        showFiscalYear={false}
        primaryAction={report && !readOnly && evidence.items.length > 0
          ? <Button type="button" onClick={() => form.open('new')}><Plus size={16} />外部算定値を追加</Button>
          : null}
      />
      <div className="flex flex-col gap-4">
        <Link href={`/ssbj/${encodeURIComponent(reportId)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {report && <SsbjLockedNotice report={report} />}
        {report && <SsbjRoleNotice role={myRole.role} isLoading={myRole.isLoading} />}
        {errorMessage && <p role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">{errorMessage}</p>}
        {isReportLoading || (report && (list.isLoading || evidence.isLoading)) ? (
          <Card><LoadingIndicator label="外部算定値を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report && !list.errorMessage ? (
          <SsbjEditorLayout report={report} overrides={{ external_emissions: previewItems }}>
            <Card>
              <p className="m-0 mb-3 text-sm text-text-muted">
                OGT で算定できない排出量（CO2 以外のガス、対応していない排出源、子会社から届いた値など）を、出典と確認者を付けてレポートに使います。
                Scope 1・Scope 3 で OGT の採用値と同じ区分の CO2 と、同じ区分・基準で同じガスの外部算定値は、二重に計上しないよう登録できません。Scope 2 は基準（ロケーション基準・マーケット基準）ごとの値として、OGT の値（基準不明）とは別に示します。
              </p>
              {!readOnly && evidence.items.length === 0 && (
                <p className="m-0 mb-3 text-sm text-text-muted">
                  外部算定値には根拠文書が必要です。先に
                  <Link href={`/ssbj/${encodeURIComponent(reportId)}/evidence`} className="font-semibold text-primary hover:underline">根拠文書・主管部署</Link>
                  で、算定の資料を登録してください。
                </p>
              )}
              <h2 className="mb-4 text-base font-bold">登録済みの外部算定値（{list.items.length}件）</h2>
              {list.items.length === 0 ? <p className="text-sm text-text-muted">外部算定値はまだ登録されていません。</p> : (
                <ul className="flex flex-col gap-3">
                  {list.items.map(item => (
                    <li key={item.id} data-testid="ssbj-external-emission" className="rounded-lg border border-border p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="m-0 text-xs text-text-muted">外部算定値 · {externalEmissionGasesLabel(item.gases)}</p>
                          <h3 className="m-0 text-sm font-bold">
                            {externalEmissionLabel(item)}：{formatDecimalForDisplay(item.value)} {item.unit}
                          </h3>
                        </div>
                        {!readOnly && (
                          <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => openEdit(item)}><Pencil size={14} />編集</Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => { setDeleteError(''); setDeleting(item); }}><Trash2 size={14} />削除</Button>
                          </div>
                        )}
                      </div>
                      <dl className="flex flex-col gap-2">
                        <Detail label="期間" value={`${item.period.startDate} 〜 ${item.period.endDate}`} />
                        <Detail label="算定した者" value={item.calculatedBy} />
                        <Detail label="算定方法" value={item.calculationMethod} />
                        <Detail label="根拠文書" value={evidenceTitle(item.evidenceId) ?? '（見つかりません）'} />
                        <Detail label="確認" value={`${memberName(members, item.confirmedByUserId)}（${formatDateTime(item.confirmedAt)}）`} />
                        {item.internalNote && <Detail label="内部メモ（開示しない）" value={item.internalNote} />}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </SsbjEditorLayout>
        ) : null}
      </div>

      <SsbjExternalEmissionDialog form={form} evidence={evidence.items} members={members} onSubmit={() => void save()} />

      <Dialog open={deleting !== null} onOpenChange={open => { if (!open && !isDeleting) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>外部算定値を削除</DialogTitle>
            <DialogDescription>
              「{deleting ? externalEmissionLabel(deleting) : ''}」を作業中の内容から削除します。保存済みの固定版は変わりません。
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p role="alert" className="text-sm text-danger">{deleteError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeleting} onClick={() => setDeleting(null)}>キャンセル</Button>
            <Button type="button" variant="destructive" disabled={isDeleting} onClick={() => void remove()}>{isDeleting ? '削除中...' : '削除する'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
