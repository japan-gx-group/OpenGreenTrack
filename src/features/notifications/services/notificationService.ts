// ヘッダーのベルに出す「お知らせ」。
// 独立した通知テーブルは持たず、既に記録されている非同期処理の結果
// （算定バッチ・IDEAデータベース取込）を新しい順に読み出して組み立てる。
// 取得は RLS 任せ（自組織のみ）で、既読状態はブラウザに閉じた localStorage で持つ。
import { createClient } from '@/lib/supabase/client';

export type AppNotificationLevel = 'info' | 'warning' | 'danger';

export type AppNotification = {
  id: string;
  level: AppNotificationLevel;
  title: string;
  description: string;
  /** ISO 8601。表示は相対時刻に整形する */
  occurredAt: string;
  /** クリックしたときの遷移先。無ければクリックしても遷移しない */
  href?: string;
};

/** ベルに出す最大件数。多すぎると「お知らせ」ではなく履歴になるため絞る。 */
const MAX_NOTIFICATIONS = 8;
/** 各テーブルから読む件数（結合後に MAX_NOTIFICATIONS まで切る） */
const PER_SOURCE_LIMIT = 5;

type BatchRow = {
  id: string;
  status: string;
  processedCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

type ImportRow = {
  id: string;
  version: string;
  status: string;
  rowCount: number;
  unmappedRecordCount: number;
  errorMessage: string | null;
  updatedAt: string;
};

const toBatchNotification = (row: BatchRow): AppNotification => {
  const occurredAt = row.completedAt ?? row.startedAt;
  if (row.status === 'failed') {
    return {
      id: `batch:${row.id}`,
      level: 'danger',
      title: '排出量の算定に失敗しました',
      description: row.errorMessage ?? '算定バッチがエラーで終了しました。データ入力の内容を確認してください。',
      occurredAt,
      href: '/data-input',
    };
  }
  if (row.status === 'pending') {
    return {
      id: `batch:${row.id}`,
      level: 'info',
      title: '排出量を算定しています',
      description: '算定バッチが実行中です。完了すると集計に反映されます。',
      occurredAt,
    };
  }
  return {
    id: `batch:${row.id}`,
    level: 'info',
    title: '排出量の算定が完了しました',
    description: `${row.processedCount.toLocaleString('ja-JP')} 件の活動量を算定しました。`,
    occurredAt,
    href: '/dashboard',
  };
};

const toImportNotification = (row: ImportRow): AppNotification => {
  if (row.status === 'failed') {
    return {
      id: `idea:${row.id}`,
      level: 'danger',
      title: 'IDEAデータベースの取込に失敗しました',
      description: row.errorMessage ?? `${row.version} の取込がエラーで終了しました。`,
      occurredAt: row.updatedAt,
      href: '/factors',
    };
  }
  if (row.status === 'processing') {
    return {
      id: `idea:${row.id}`,
      level: 'info',
      title: 'IDEAデータベースを取り込んでいます',
      description: `${row.version} を処理中です。`,
      occurredAt: row.updatedAt,
      href: '/factors',
    };
  }
  if (row.unmappedRecordCount > 0) {
    return {
      id: `idea:${row.id}`,
      level: 'warning',
      title: '係数の再選択が必要な明細があります',
      description: `${row.version} の取込により ${row.unmappedRecordCount.toLocaleString('ja-JP')} 件が未紐付けになりました。`,
      occurredAt: row.updatedAt,
      href: '/factors',
    };
  }
  return {
    id: `idea:${row.id}`,
    level: 'info',
    title: 'IDEAデータベースの取込が完了しました',
    description: `${row.version}（${row.rowCount.toLocaleString('ja-JP')} 行）を取り込みました。`,
    occurredAt: row.updatedAt,
    href: '/factors',
  };
};

export const getNotifications = async (): Promise<AppNotification[]> => {
  const supabase = createClient();

  const [batches, imports] = await Promise.all([
    supabase
      .from('calculation_batches')
      .select('id, status, processedCount, errorMessage, startedAt, completedAt')
      .order('startedAt', { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from('idea_imports')
      .select('id, version, status, rowCount, unmappedRecordCount, errorMessage, updatedAt')
      .order('updatedAt', { ascending: false })
      .limit(PER_SOURCE_LIMIT),
  ]);

  // どちらか一方が読めなくても、読めた側だけで通知を出す（ベルは補助的な導線のため）。
  const notifications = [
    ...(((batches.data ?? []) as unknown as BatchRow[]).map(toBatchNotification)),
    ...(((imports.data ?? []) as unknown as ImportRow[]).map(toImportNotification)),
  ];

  return notifications
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, MAX_NOTIFICATIONS);
};

const READ_MARKER_KEY = 'greentrack.notifications.readAt';

/** 既読の基準時刻（これより新しいお知らせを未読として数える）。 */
export const getReadMarker = (): string | null => {
  try {
    return window.localStorage.getItem(READ_MARKER_KEY);
  } catch {
    // プライベートブラウズ等で localStorage が使えない場合は「常に未読」に倒す。
    return null;
  }
};

export const setReadMarker = (isoTimestamp: string): void => {
  try {
    window.localStorage.setItem(READ_MARKER_KEY, isoTimestamp);
  } catch {
    // 保存できなくてもお知らせの表示自体には影響しない。
  }
};

export const countUnread = (notifications: AppNotification[], readMarker: string | null): number => {
  if (readMarker === null) return notifications.length;
  return notifications.filter(notification => notification.occurredAt > readMarker).length;
};

/** 「3分前」「昨日」など、一覧で読み流せる粒度の相対表記に整形する。 */
export const formatRelativeTime = (isoTimestamp: string, now: Date = new Date()): string => {
  const occurred = new Date(isoTimestamp);
  const diffMinutes = Math.floor((now.getTime() - occurred.getTime()) / 60000);

  if (Number.isNaN(diffMinutes)) return '';
  if (diffMinutes < 1) return 'たった今';
  if (diffMinutes < 60) return `${diffMinutes}分前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}時間前`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}日前`;

  return occurred.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
};
