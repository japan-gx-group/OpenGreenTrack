// ヘッダーのベル用お知らせ（notificationService）の単体テスト。
//
// 実DBは使わず、@/lib/supabase/client をテーブルごとの固定行を返すスタブに差し替えて
//   - 算定バッチ / IDEA 取込の各状態 → お知らせ（level / title / href）への対応
//   - 2 ソースを occurredAt の新しい順に結合し、MAX_NOTIFICATIONS（8 件）で切ること
//   - 片方のテーブルが読めなくても、読めた側だけでお知らせを出すこと
// と、既読マーカー（localStorage）・未読数・相対時刻の純粋ロジックを検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

// テーブル名 → クエリ結果。テストごとに差し替える。
const tableResults = vi.hoisted(() => new Map<string, QueryResult>());

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      // 実装のチェーン（select → order → limit）をそのまま受け、最後に固定結果を返す。
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: async () => tableResults.get(table) ?? { data: [], error: null },
      };
      return builder;
    },
  }),
}));

import {
  countUnread,
  formatRelativeTime,
  getNotifications,
  getReadMarker,
  setReadMarker,
  type AppNotification,
} from '../notificationService';

const batch = (overrides: Partial<{
  id: string;
  status: string;
  processedCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}> = {}) => ({
  id: 'b1',
  status: 'completed',
  processedCount: 1234,
  errorMessage: null,
  startedAt: '2026-09-01T00:00:00.000Z',
  completedAt: '2026-09-01T00:01:00.000Z',
  ...overrides,
});

const ideaImport = (overrides: Partial<{
  id: string;
  version: string;
  status: string;
  rowCount: number;
  unmappedRecordCount: number;
  errorMessage: string | null;
  updatedAt: string;
}> = {}) => ({
  id: 'i1',
  version: 'IDEA v3.4',
  status: 'completed',
  rowCount: 5000,
  unmappedRecordCount: 0,
  errorMessage: null,
  updatedAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
});

describe('getNotifications: 行 → お知らせへの対応', () => {
  beforeEach(() => {
    tableResults.clear();
  });

  it('算定バッチ: completed は info / dashboard 遷移で件数を桁区切りにする', async () => {
    tableResults.set('calculation_batches', { data: [batch()], error: null });

    const [notification] = await getNotifications();
    expect(notification).toEqual<AppNotification>({
      id: 'batch:b1',
      level: 'info',
      title: '排出量の算定が完了しました',
      description: '1,234 件の活動量を算定しました。',
      occurredAt: '2026-09-01T00:01:00.000Z',
      href: '/dashboard',
    });
  });

  it('算定バッチ: failed は danger / data-input 遷移で errorMessage をそのまま出す', async () => {
    tableResults.set('calculation_batches', {
      data: [batch({ status: 'failed', errorMessage: '係数が見つかりません' })],
      error: null,
    });

    const [notification] = await getNotifications();
    expect(notification).toMatchObject({
      id: 'batch:b1',
      level: 'danger',
      description: '係数が見つかりません',
      href: '/data-input',
    });
  });

  it('算定バッチ: failed で errorMessage が無ければ既定の説明文', async () => {
    tableResults.set('calculation_batches', {
      data: [batch({ status: 'failed', errorMessage: null })],
      error: null,
    });

    const [notification] = await getNotifications();
    expect(notification.description).toContain('算定バッチがエラーで終了しました');
  });

  it('算定バッチ: pending は遷移先なし・completedAt が無いので startedAt を発生時刻にする', async () => {
    tableResults.set('calculation_batches', {
      data: [batch({ status: 'pending', completedAt: null })],
      error: null,
    });

    const [notification] = await getNotifications();
    expect(notification).toMatchObject({
      level: 'info',
      title: '排出量を算定しています',
      occurredAt: '2026-09-01T00:00:00.000Z',
    });
    expect(notification.href).toBeUndefined();
  });

  it('IDEA取込: completed は info / factors 遷移で版と行数を出す', async () => {
    tableResults.set('idea_imports', { data: [ideaImport()], error: null });

    const [notification] = await getNotifications();
    expect(notification).toEqual<AppNotification>({
      id: 'idea:i1',
      level: 'info',
      title: 'IDEAデータベースの取込が完了しました',
      description: 'IDEA v3.4（5,000 行）を取り込みました。',
      occurredAt: '2026-09-02T00:00:00.000Z',
      href: '/factors',
    });
  });

  it('IDEA取込: 未紐付け明細があれば warning（completed より優先される分岐）', async () => {
    tableResults.set('idea_imports', {
      data: [ideaImport({ unmappedRecordCount: 12 })],
      error: null,
    });

    const [notification] = await getNotifications();
    expect(notification).toMatchObject({
      level: 'warning',
      title: '係数の再選択が必要な明細があります',
      description: 'IDEA v3.4 の取込により 12 件が未紐付けになりました。',
      href: '/factors',
    });
  });

  it('IDEA取込: failed は danger、processing は info（未紐付け件数があっても状態が優先）', async () => {
    tableResults.set('idea_imports', {
      data: [
        ideaImport({ id: 'f', status: 'failed', errorMessage: null, updatedAt: '2026-09-03T00:00:00.000Z' }),
        ideaImport({ id: 'p', status: 'processing', unmappedRecordCount: 3, updatedAt: '2026-09-02T00:00:00.000Z' }),
      ],
      error: null,
    });

    const [failed, processing] = await getNotifications();
    expect(failed).toMatchObject({
      id: 'idea:f',
      level: 'danger',
      description: 'IDEA v3.4 の取込がエラーで終了しました。',
    });
    expect(processing).toMatchObject({
      id: 'idea:p',
      level: 'info',
      title: 'IDEAデータベースを取り込んでいます',
    });
  });
});

describe('getNotifications: 結合・並び順・件数', () => {
  beforeEach(() => {
    tableResults.clear();
  });

  it('2 ソースを occurredAt の新しい順に混ぜる', async () => {
    tableResults.set('calculation_batches', {
      data: [
        batch({ id: 'old', completedAt: '2026-09-01T00:00:00.000Z' }),
        batch({ id: 'newest', completedAt: '2026-09-05T00:00:00.000Z' }),
      ],
      error: null,
    });
    tableResults.set('idea_imports', {
      data: [ideaImport({ id: 'mid', updatedAt: '2026-09-03T00:00:00.000Z' })],
      error: null,
    });

    const ids = (await getNotifications()).map((notification) => notification.id);
    expect(ids).toEqual(['batch:newest', 'idea:mid', 'batch:old']);
  });

  it('結合後は 8 件までに切る（各ソース 5 件 → 合計 10 件でも 8 件）', async () => {
    const batches = Array.from({ length: 5 }, (_, index) =>
      batch({ id: `b${index}`, completedAt: `2026-09-1${index}T00:00:00.000Z` }),
    );
    const imports = Array.from({ length: 5 }, (_, index) =>
      ideaImport({ id: `i${index}`, updatedAt: `2026-09-0${index + 1}T00:00:00.000Z` }),
    );
    tableResults.set('calculation_batches', { data: batches, error: null });
    tableResults.set('idea_imports', { data: imports, error: null });

    const notifications = await getNotifications();
    expect(notifications).toHaveLength(8);
    // 新しい順なので、切り落とされるのは最も古い 2 件（i0, i1）
    expect(notifications.map((notification) => notification.id)).not.toContain('idea:i0');
    expect(notifications.map((notification) => notification.id)).not.toContain('idea:i1');
    expect(notifications[0].id).toBe('batch:b4');
  });

  it('片方のテーブルが読めなくても、読めた側だけでお知らせを出す', async () => {
    tableResults.set('calculation_batches', { data: null, error: { message: 'permission denied' } });
    tableResults.set('idea_imports', { data: [ideaImport()], error: null });

    const notifications = await getNotifications();
    expect(notifications.map((notification) => notification.id)).toEqual(['idea:i1']);
  });

  it('どちらも空なら空配列', async () => {
    await expect(getNotifications()).resolves.toEqual([]);
  });
});

describe('countUnread', () => {
  const notifications: AppNotification[] = [
    { id: 'a', level: 'info', title: '', description: '', occurredAt: '2026-09-03T00:00:00.000Z' },
    { id: 'b', level: 'info', title: '', description: '', occurredAt: '2026-09-02T00:00:00.000Z' },
    { id: 'c', level: 'info', title: '', description: '', occurredAt: '2026-09-01T00:00:00.000Z' },
  ];

  it('既読マーカーが無ければ全件未読', () => {
    expect(countUnread(notifications, null)).toBe(3);
  });

  it('マーカーより新しいものだけを数える（同時刻は既読扱い）', () => {
    expect(countUnread(notifications, '2026-09-02T00:00:00.000Z')).toBe(1);
    expect(countUnread(notifications, '2026-09-03T00:00:00.000Z')).toBe(0);
    expect(countUnread(notifications, '2026-08-01T00:00:00.000Z')).toBe(3);
  });

  it('お知らせが無ければ 0', () => {
    expect(countUnread([], null)).toBe(0);
  });
});

describe('getReadMarker / setReadMarker（localStorage）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('保存した既読時刻を読み戻せる（キーはアプリ固有の名前空間）', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });

    expect(getReadMarker()).toBeNull();
    setReadMarker('2026-09-01T00:00:00.000Z');
    expect(getReadMarker()).toBe('2026-09-01T00:00:00.000Z');
    expect([...store.keys()]).toEqual(['opengreentrack.notifications.readAt']);
  });

  it('localStorage が使えない（例外を投げる）場合は null / 何もしない', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });

    expect(getReadMarker()).toBeNull();
    expect(() => setReadMarker('2026-09-01T00:00:00.000Z')).not.toThrow();
  });

  it('window 自体が無い（サーバ側）でも null', () => {
    // node 環境では window は未定義。ReferenceError を握りつぶして「常に未読」に倒す。
    expect(getReadMarker()).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-07T12:00:00+09:00');

  it('1 分未満は「たった今」', () => {
    expect(formatRelativeTime('2026-09-07T11:59:30+09:00', now)).toBe('たった今');
  });

  it('60 分未満は分、24 時間未満は時間、7 日未満は日の単位で切り捨てる', () => {
    expect(formatRelativeTime('2026-09-07T11:57:10+09:00', now)).toBe('2分前');
    expect(formatRelativeTime('2026-09-07T11:00:00+09:00', now)).toBe('1時間前');
    expect(formatRelativeTime('2026-09-07T08:30:00+09:00', now)).toBe('3時間前');
    expect(formatRelativeTime('2026-09-06T11:00:00+09:00', now)).toBe('1日前');
    expect(formatRelativeTime('2026-09-01T12:00:01+09:00', now)).toBe('5日前');
  });

  it('7 日以上前は日付（yyyy/mm/dd）を出す', () => {
    expect(formatRelativeTime('2026-08-31T12:00:00+09:00', now)).toBe('2026/08/31');
  });

  it('解釈できない時刻は空文字', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});
