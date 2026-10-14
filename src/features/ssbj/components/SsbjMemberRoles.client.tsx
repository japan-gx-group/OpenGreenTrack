'use client';

// SSBJ の権限の画面（/ssbj/roles。docs/authorization-matrix.md §1・§2.4）。
// 自組織の利用者ごとの SSBJ のロール（管理者・入力担当・承認担当・閲覧者）を出し、OGT の管理者だけが割り当てを変えられる。
// ロールを割り当てていない利用者は入力担当。OGT の管理者は割り当てに関係なく管理者（ここでは変えられない）。
// 割り当ての変更は DB が操作履歴に記録し、この画面の下に新しい順に出す。

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toast } from '@/components/ui/Toast.client';
import { useToast } from '@/hooks/useToast';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjMemberRoles } from '../hooks/useSsbjMemberRoles';
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
  const isAdmin = me.role === 'admin';
  const errorMessage = roles.errorMessage || me.errorMessage;

  const change = async (userId: string, role: SsbjMemberRole) => {
    if (await roles.assign(userId, role)) {
      showToast(`${memberName(roles.members, userId)} を${SSBJ_ROLE_LABELS[role]}にしました`, 'success');
    }
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
          <p className="m-0 mt-3 text-xs text-text-muted">
            このロールは SSBJ レポートだけに効きます。OGT のほかの画面の権限は変わりません。
            {isAdmin ? '' : 'ロールを変えられるのは管理者だけです。'}
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
                    const editable = isAdmin && effective !== 'admin';
                    return (
                      <TableRow key={member.id} data-testid="ssbj-member-role-row">
                        <TableCell>{member.name}</TableCell>
                        <TableCell>
                          {editable ? (
                            <select
                              aria-label={`${member.name} の SSBJ のロール`}
                              className="gt-field gt-field-select"
                              value={effective}
                              disabled={roles.savingUserId !== null}
                              onChange={event => void change(member.id, event.target.value as SsbjMemberRole)}
                            >
                              {SSBJ_MEMBER_ROLES.map(role => (
                                <option key={role} value={role}>
                                  {SSBJ_ROLE_LABELS[role]}{role === 'editor' && assigned === null ? '（既定）' : ''}
                                </option>
                              ))}
                            </select>
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
            </Card>

            <Card>
              <h2 className="m-0 mb-1 text-base font-bold">ロールの変更の記録</h2>
              <p className="m-0 mb-3 text-xs text-text-muted">
                誰がいつ、誰のロールを変えたかを自動で記録しています。新しい順に最大 {SSBJ_MEMBER_ROLE_LOG_LIMIT} 件を表示します。
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
    </div>
  );
};
