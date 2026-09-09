'use client';

// メンバー管理: 自組織メンバーの一覧・削除（下書き→保存で確定）と、
// 招待リンクの発行・コピー・取り消しを行う。招待発行時はサーバ側で招待メールを送信し、
// その結果（送信済み / メール未設定 / 送信失敗）をモーダル内で案内する。
// メンバー・招待の読み取りは RLS 前提でブラウザから直接行い、書き込みは Server Action 経由で行う。
// ロールによる出し分けは行わない（ロール判定は無効）。ロールを変更する UI も持たない。

import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/Modal.client';
import { Plus, Trash2, Send, Copy, Check, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isValidEmail } from '@/lib/email';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { saveMemberChanges } from '@/features/settings/services/members';
import { createInvite, revokeInvite } from '@/features/settings/services/invites';
// 型のみの import（実体はサーバ専用モジュールのためバンドルされない）
import type { InviteEmailStatus } from '@/features/settings/services/inviteEmail';

interface Member {
  id: string;
  name: string;
  email: string;
}

// 発行直後の招待（モーダルに結果を表示するための情報）。
// emailStatus により「送信済み / メール未設定 / 送信失敗」の案内を出し分ける。
interface IssuedInviteView {
  url: string;
  email: string;
  emailStatus: InviteEmailStatus;
}

interface PendingInvite {
  token: string;
  email: string;
  expiresAt: string;
  /** 取得時点で期限切れか（レンダー中に Date.now() を呼ばないよう取得時に判定する） */
  expired: boolean;
}

const buildInviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

// 一覧の取得はコンポーネント外の純粋な fetch 関数に分け、state 反映は呼び出し側の
// コールバックで行う（react-hooks/set-state-in-effect 対応。Locations.tsx と同じ方針）。
const fetchMembers = async (): Promise<Member[] | null> => {
  const supabase = createClient();
  // RLS により自組織の profiles のみ返る。
  const { data, error } = await supabase
    .from('profiles')
    .select('id, fullName, email')
    .order('createdAt', { ascending: true });
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.fullName as string | null) ?? '(未設定)',
    email: row.email as string,
  }));
};

const fetchPendingInvites = async (): Promise<PendingInvite[]> => {
  const supabase = createClient();
  // RLS により自組織の招待のみ返る。
  const { data, error } = await supabase
    .from('invites')
    .select('token, email, expiresAt')
    .is('acceptedAt', null)
    .order('createdAt', { ascending: false });
  if (error) return [];
  const now = Date.now();
  return (data ?? []).map((row) => ({
    token: row.token as string,
    email: row.email as string,
    expiresAt: row.expiresAt as string,
    expired: new Date(row.expiresAt as string).getTime() < now,
  }));
};

const formatExpiry = (expiresAt: string) => {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
};

export const MemberList = ({ showToast }: { showToast: (message: string, type: 'success' | 'error') => void }) => {
  const { profile } = useCurrentUser();

  const [members, setMembers] = useState<Member[]>([]);
  const [draftMembers, setDraftMembers] = useState<Member[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [issuedInvite, setIssuedInvite] = useState<IssuedInviteView | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // fetch 結果を state へ反映する（初期表示と保存後の再取得で共用）。
  const applyMembers = useCallback((rows: Member[] | null) => {
    if (rows) {
      setLoadError('');
      setMembers(rows);
      setDraftMembers(rows);
      setHasDraft(false);
    } else {
      setLoadError('メンバー一覧の取得に失敗しました');
    }
    setIsLoading(false);
  }, []);

  const loadMembers = useCallback(
    async () => applyMembers(await fetchMembers()),
    [applyMembers],
  );

  const loadInvites = useCallback(async () => {
    setPendingInvites(await fetchPendingInvites());
  }, []);

  useEffect(() => {
    fetchMembers().then(applyMembers);
  }, [applyMembers]);

  useEffect(() => {
    fetchPendingInvites().then(setPendingInvites);
  }, []);

  const handleRemove = (id: string) => {
    setMemberToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteMember = () => {
    if (memberToDelete) {
      setDraftMembers(prev => prev.filter(m => m.id !== memberToDelete));
      setHasDraft(true);
    }
    setIsDeleteModalOpen(false);
    setMemberToDelete(null);
  };

  const handleSaveClick = () => {
    setIsSaveModalOpen(true);
  };

  const confirmSaveChanges = async () => {
    if (isSaving) return;
    setIsSaving(true);

    // 下書きと現状の差分から「削除」を組み立てる。
    const draftIds = new Set(draftMembers.map(m => m.id));
    const removedMemberIds = members.filter(m => !draftIds.has(m.id)).map(m => m.id);

    try {
      const result = await saveMemberChanges({ removedMemberIds });
      if (!result.ok) {
        showToast(result.error, 'error');
      } else {
        showToast('メンバーの変更内容を保存しました', 'success');
      }
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      // 成否にかかわらず一覧を取り直し、実データと画面を一致させる。
      await loadMembers();
      setIsSaving(false);
      setIsSaveModalOpen(false);
    }
  };

  const cancelChanges = () => {
    setDraftMembers(members);
    setHasDraft(false);
  };

  const handleSendInvite = async () => {
    if (isInviting) return;
    if (!isValidEmail(inviteEmail)) {
      showToast('有効なメールアドレスを入力してください', 'error');
      return;
    }

    setIsInviting(true);
    try {
      const result = await createInvite({ email: inviteEmail });
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      // 招待メールの送信結果はモーダル内の案内で出し分ける。送信できなかった
      // 場合（未設定・失敗）も招待自体は成立しているため、リンクの共有で代替できる。
      setIssuedInvite({
        url: buildInviteUrl(result.data.token),
        email: result.data.email,
        emailStatus: result.data.emailStatus,
      });
      if (result.data.emailStatus === 'sent') {
        showToast('招待メールを送信しました', 'success');
      } else if (result.data.emailStatus === 'failed') {
        showToast('招待メールの送信に失敗しました。招待リンクを共有してください', 'error');
      }
      await loadInvites();
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      setIsInviting(false);
    }
  };

  const closeInviteModal = () => {
    setIsInviteOpen(false);
    setInviteEmail('');
    setIssuedInvite(null);
  };

  const copyToClipboard = async (text: string, token: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(prev => (prev === token ? null : prev)), 2000);
    } catch {
      showToast('コピーに失敗しました。リンクを選択して手動でコピーしてください', 'error');
    }
  };

  const handleRevokeInvite = async (token: string) => {
    try {
      const result = await revokeInvite(token);
      if (!result.ok) {
        showToast(result.error, 'error');
      } else {
        showToast('招待を取り消しました', 'success');
      }
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      await loadInvites();
    }
  };

  return (
    <Card className="flex flex-col gap-4 relative">
      <div className="flex justify-between items-center">
        <h2 className="font-serif font-semibold text-lg text-text-heading flex items-center gap-2">メンバー管理</h2>
        <button
          type="button"
          onClick={() => setIsInviteOpen(true)}
          className="gt-btn-primary flex items-center gap-1 text-xs"
        >
          <Plus size={16} /> メンバーを招待
        </button>
      </div>
      <hr className="border-border" />

      <div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-text-muted text-sm">
              <th className="font-semibold px-4 py-2">氏名</th>
              <th className="font-semibold px-4 py-2">メールアドレス</th>
              <th className="font-semibold px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {draftMembers.map(member => {
              const isSelf = member.id === profile?.id;
              return (
                <tr key={member.id} className="border-b border-border-light hover:bg-bg-main transition-colors">
                  <td className="px-4 py-3 font-medium text-text-main">
                    {member.name}
                    {isSelf && <span className="text-xs text-text-muted font-normal">（自分）</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted break-all">{member.email}</td>
                  <td className="px-4 py-3 flex justify-end">
                    {/* 自分自身の削除はサーバ側でも拒否されるが、UIでも塞いでおく */}
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => handleRemove(member.id)}
                        className="text-danger hover:brightness-75 flex items-center gap-1 text-xs p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {isLoading && (
              <tr>
                <td colSpan={3} className="text-text-muted text-sm px-4 py-8 text-center">
                  <Loader2 size={16} className="animate-spin inline-block mr-2" />
                  メンバーを読み込んでいます...
                </td>
              </tr>
            )}
            {!isLoading && loadError && (
              <tr>
                <td colSpan={3} className="text-danger text-sm px-4 py-8 text-center">
                  {loadError}
                </td>
              </tr>
            )}
            {!isLoading && !loadError && draftMembers.length === 0 && (
              <tr>
                <td colSpan={3} className="text-text-muted text-sm px-4 py-8 text-center">
                  メンバーが見つかりません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasDraft && (
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
          <button type="button" onClick={cancelChanges} className="gt-btn">キャンセル</button>
          <button type="button" onClick={handleSaveClick} className="gt-btn-primary">変更を保存</button>
        </div>
      )}

      {/* 未受諾の招待一覧。リンクの再コピーと取り消しができる */}
      {pendingInvites.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          <h3 className="font-serif font-semibold text-sm text-text-heading">招待中</h3>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-text-muted text-sm">
                <th className="font-semibold px-4 py-2">メールアドレス</th>
                <th className="font-semibold px-4 py-2">有効期限</th>
                <th className="font-semibold px-4 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map(invite => {
                const expired = invite.expired;
                return (
                  <tr key={invite.token} className="border-b border-border-light">
                    <td className="px-4 py-3 text-sm text-text-main break-all">{invite.email}</td>
                    <td className="px-4 py-3 text-xs">
                      {expired ? (
                        <span className="text-danger">期限切れ（再招待してください）</span>
                      ) : (
                        <span className="text-text-muted">{formatExpiry(invite.expiresAt)} まで</span>
                      )}
                    </td>
                    <td className="px-4 py-3 flex justify-end gap-2">
                      {!expired && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(buildInviteUrl(invite.token), invite.token)}
                          className="text-text-muted hover:text-text-main flex items-center gap-1 text-xs p-1"
                          title="招待リンクをコピー"
                        >
                          {copiedToken === invite.token ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRevokeInvite(invite.token)}
                        className="text-danger hover:brightness-75 flex items-center gap-1 text-xs p-1"
                        title="招待を取り消す"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Member Modal */}
      <Modal
        isOpen={isInviteOpen}
        onClose={closeInviteModal}
        title="ユーザー招待"
        size="lg"
      >
        {issuedInvite ? (
          // 発行済み: メール送信結果を案内し、招待リンクをコピーできるようにする
          <div className="flex flex-col gap-6">
            {issuedInvite.emailStatus === 'sent' && (
              <p className="text-sm text-text-main">
                {issuedInvite.email} に招待メールを送信しました。メールが届かない場合は、下の招待リンクを直接共有してください（有効期限: 7日間）。
              </p>
            )}
            {issuedInvite.emailStatus === 'skipped' && (
              <p className="text-sm text-text-main">
                メール送信が未設定のため、招待メールは送信されていません。招待リンクをコピーして招待する方に共有してください（有効期限: 7日間）。
              </p>
            )}
            {issuedInvite.emailStatus === 'failed' && (
              <p className="text-sm text-danger">
                招待メールの送信に失敗しました。招待リンクをコピーして招待する方に共有してください（有効期限: 7日間）。
              </p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={issuedInvite.url}
                onFocus={(e) => e.currentTarget.select()}
                className="gt-field flex-1 text-xs"
              />
              <button
                type="button"
                onClick={() => copyToClipboard(issuedInvite.url, 'issued')}
                className="gt-btn flex items-center gap-1 text-xs whitespace-nowrap"
              >
                {copiedToken === 'issued' ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
                コピー
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeInviteModal} className="gt-btn-primary">閉じる</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="inviteEmail" className="text-sm font-semibold text-text-muted">メールアドレス</label>
              <input
                id="inviteEmail"
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                className="gt-field"
                placeholder="例: name@abc.com"
              />
            </div>
            <div className="flex justify-end gap-2 mt-6 pt-6">
              <button
                type="button"
                onClick={handleSendInvite}
                disabled={isInviting}
                className="gt-btn-primary flex items-center gap-2"
              >
                {isInviting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                招待リンクを発行
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Save Confirmation Modal */}
      <Modal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        title="変更の保存確認"
      >
        <div className="flex flex-col gap-6">
          <p className="text-sm text-text-main">
            メンバーの削除を保存しますか？削除したメンバーはログインできなくなります。
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIsSaveModalOpen(false)} className="gt-btn" disabled={isSaving}>
              キャンセル
            </button>
            <button
              type="button"
              onClick={confirmSaveChanges}
              className="gt-btn-primary flex items-center gap-2"
              disabled={isSaving}
            >
              {isSaving && <Loader2 size={16} className="animate-spin" />}
              保存
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setMemberToDelete(null);
        }}
        title="メンバーの削除確認"
      >
        <div className="flex flex-col gap-6">
          <p className="text-sm text-text-main">
            このメンバーを削除してもよろしいですか？（「変更を保存」で確定するまで実行されません）
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsDeleteModalOpen(false);
                setMemberToDelete(null);
              }}
              className="gt-btn"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={confirmDeleteMember}
              className="gt-btn-primary bg-danger hover:bg-danger/90"
            >
              削除
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
