'use client';

// SSBJ の権限の画面（/ssbj/roles。docs/authorization-matrix.md §1・§2.4）。
// 自組織の利用者ごとの SSBJ のロール（管理者・入力担当・承認担当・閲覧者）を出し、OGT の管理者だけが割り当てを変えられる。
// ロールを割り当てていない利用者は入力担当。OGT の管理者は割り当てに関係なく管理者（ここでは変えられず、OGT のメンバー管理で変える）。
// OGT のメンバー管理と同じく、ロールを選んでから「変更を保存」で確定する（確かめてから保存する）。
// 割り当ての変更は DB が操作履歴に記録し、この画面の下に新しい順に出す。

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toast } from '@/components/ui/Toast.client';
import { useToast } from '@/hooks/useToast';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjMemberRoles, type SsbjMemberRoleChange } from '../hooks/useSsbjMemberRoles';
import { useSsbjMyRole } from '../hooks/useSsbjMyRole';
import { memberName } from '../services/memberService';
import { SSBJ_MEMBER_ROLE_LOG_LIMIT } from '../services/memberRoleService';
import {
  SSBJ_MEMBER_ROLES,
  SSBJ_ROLE_DESCRIPTIONS,
  SSBJ_ROLE_LABELS,
  type SsbjEffectiveRole,
  type SsbjMemberRole,
} from '../types';
import { effectiveSsbjRole, ssbjMemberRoleLogText } from '../utils/memberRole';
import { SsbjTrialNotice } from './SsbjTrialNotice';

const ROLE_ORDER: SsbjEffectiveRole[] = ['admin', 'editor', 'approver', 'viewer'];

export const SsbjMemberRoles = () => {
  const roles = useSsbjMemberRoles();
  const me = useSsbjMyRole();
  const { toast, showToast } = useToast();
  // 選んだが保存していないロール（利用者 ID → ロール）。今のロールと同じものは持たない。
  const [drafts, setDrafts] = useState<Map<string, SsbjMemberRole>>(new Map());
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const canAssign = me.role === 'admin';
  const errorMessage = roles.errorMessage || me.errorMessage;

  const currentRoleOf = (userId: string): SsbjEffectiveRole => {
    const member = roles.members.find(candidate => candidate.id === userId);
    return effectiveSsbjRole(member?.role ?? null, roles.roles.get(userId) ?? null);
  };

  const choose = (userId: string, role: SsbjMemberRole) => {
    setDrafts(prev => {
      const next = new Map(prev);
      if (currentRoleOf(userId) === role) next.delete(userId);
      else next.set(userId, role);
      return next;
    });
  };

  const changes: SsbjMemberRoleChange[] = [...drafts].map(([userId, role]) => ({ userId, role }));

  const save = async () => {
    const saved = await roles.saveChanges(changes);
    setIsConfirmOpen(false);
    setDrafts(new Map());
    if (saved) showToast('SSBJ のロールの変更を保存しました', 'success');
  };

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading
        title="SSBJ の権限"
        description="SSBJ レポートで、利用者ごとにできることを決めます"
        showFiscalYear={false}
        primaryAction={null}
      />
      <Toast toast={toast} />
      <div className="flex flex-col gap-4">
        <Link href="/ssbj" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> SSBJレポートの一覧へ戻る
        </Link>
        <SsbjTrialNotice />
        {errorMessage && <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">{errorMessage}</div>}

        <Card>
          <h2 className="m-0 mb-2 text-base font-bold">ロール</h2>
          <dl className="m-0 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
            {ROLE_ORDER.map(role => (
              <div key={role} className="contents">
                <dt className="font-semibold">{SSBJ_ROLE_LABELS[role]}</dt>
                <dd className="m-0 text-text-muted">{SSBJ_ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 mt-3 text-xs text-text-muted" data-testid="ssbj-role-scope-note">
            このロールは SSBJ レポートだけに効きます。OGT のほかの画面の権限は、OGT のロール（管理者・メンバー）で決まり、
            SSBJ の承認担当・閲覧者も、OGT のデータ入力などはメンバーとして行えます。
            OGT の管理者は、
            <Link href="/settings/company" className="font-semibold text-primary hover:underline">企業・メンバー設定</Link>
            の「メンバー管理」で変えます。
            {canAssign ? '' : 'SSBJ のロールの変更は、管理者のみできます。'}
          </p>
        </Card>

        {roles.isLoading || me.isLoading ? (
          <Card><LoadingIndicator label="利用者とロールを読み込んでいます..." /></Card>
        ) : (
          <>
            <Card>
              <h2 className="m-0 mb-3 text-base font-bold">利用者ごとのロール</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>利用者</TableHead>
                    <TableHead>SSBJ のロール</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.members.map(member => {
                    const assigned = roles.roles.get(member.id) ?? null;
                    const effective = effectiveSsbjRole(member.role, assigned);
                    const editable = canAssign && effective !== 'admin';
                    const draft = drafts.get(member.id);
                    return (
                      <TableRow key={member.id} data-testid="ssbj-member-role-row">
                        <TableCell>{member.name}</TableCell>
                        <TableCell>
                          {editable ? (
                            <span className="inline-flex items-center gap-2">
                              <select
                                aria-label={`${member.name} の SSBJ のロール`}
                                className="gt-field gt-field-select"
                                value={draft ?? effective}
                                disabled={roles.isSaving}
                                onChange={event => choose(member.id, event.target.value as SsbjMemberRole)}
                              >
                                {SSBJ_MEMBER_ROLES.map(role => (
                                  <option key={role} value={role}>
                                    {SSBJ_ROLE_LABELS[role]}{role === 'editor' && assigned === null ? '（既定）' : ''}
                                  </option>
                                ))}
                              </select>
                              {draft && <span className="text-xs font-semibold text-warning">未保存</span>}
                            </span>
                          ) : (
                            <span>
                              {SSBJ_ROLE_LABELS[effective]}
                              {effective === 'admin' && <span className="text-xs text-text-muted">（OGT の管理者）</span>}
                              {effective === 'editor' && assigned === null && <span className="text-xs text-text-muted">（既定）</span>}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {changes.length > 0 && (
                <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
                  <Button type="button" variant="outline" disabled={roles.isSaving} onClick={() => setDrafts(new Map())}>
                    キャンセル
                  </Button>
                  <Button type="button" disabled={roles.isSaving} onClick={() => setIsConfirmOpen(true)}>
                    変更を保存
                  </Button>
                </div>
              )}
            </Card>

            <Card>
              <h2 className="m-0 mb-1 text-base font-bold">ロールの変更の記録</h2>
              <p className="m-0 mb-3 text-xs text-text-muted">
                誰がいつ、誰のロールを変えたかを自動で記録しています。新しい順に最大 {SSBJ_MEMBER_ROLE_LOG_LIMIT} 件を表示します。
                OGT のロール（管理者・メンバー）の変更は、ここではなく OGT 本体の監査ログに記録されます。
              </p>
              {roles.logs.length === 0 ? (
                <p className="m-0 py-4 text-center text-sm text-text-muted">記録はまだありません。</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日時</TableHead>
                      <TableHead>操作した人</TableHead>
                      <TableHead>内容</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roles.logs.map(log => (
                      <TableRow key={log.id} data-testid="ssbj-member-role-log">
                        <TableCell className="whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                        <TableCell>{memberName(roles.members, log.actorUserId)}</TableCell>
                        <TableCell>{ssbjMemberRoleLogText(log, memberName(roles.members, log.userId))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </>
        )}
      </div>

      <Dialog open={isConfirmOpen} onOpenChange={open => { if (!open && !roles.isSaving) setIsConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SSBJ のロールの変更を保存しますか</DialogTitle>
            <DialogDescription>保存すると、すぐにその人のできることが変わります。</DialogDescription>
          </DialogHeader>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm" data-testid="ssbj-member-role-changes">
            {changes.map(change => (
              <li key={change.userId}>
                {memberName(roles.members, change.userId)}：{SSBJ_ROLE_LABELS[currentRoleOf(change.userId)]} → {SSBJ_ROLE_LABELS[change.role]}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={roles.isSaving} onClick={() => setIsConfirmOpen(false)}>
              戻る
            </Button>
            <Button type="button" disabled={roles.isSaving} onClick={() => void save()}>
              {roles.isSaving ? '保存しています...' : '保存する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
