// スモークテストの前後始末でローカル Supabase を直接触るヘルパー。
//
// 使うのは anon キー + seed ユーザーのログインだけ（service_role キーは使わない）。
// アプリ画面と同じ RLS の下で動くので、テストが「自組織のデータしか消せない」ことが
// 仕組みとして保証される（AGENTS.md R7）。

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  CALCULATION_CONCURRENT_LIMIT,
  CALCULATION_PENDING_WINDOW_MS,
  CALCULATION_PER_MINUTE_LIMIT,
  RATE_LIMIT_WINDOW_MS,
} from '../../src/lib/security/apiRateLimit';
import { E2E_NOTE_MARKER, TEST_USER } from './testData';

const SETUP_HINT = [
  'ローカル Supabase に接続できませんでした。E2E は起動済みのローカル環境を前提にしています。',
  '  1) supabase start',
  '  2) npm run db:reset:demo   # デモシード（supabase/seeds/demo/demo.sql）を流し直す',
  '  3) .env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定',
].join('\n');

/** ローカル Supabase とみなすホスト名（`[::1]` は URL.hostname が角括弧付きで返す） */
const LOCAL_SUPABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/**
 * E2E がローカル以外の Supabase を書き換えないためのガード。
 *
 * global-setup / teardown は活動量レコードを目印で削除し、スモークは算定バッチを走らせて
 * dashboard_aggregates を書き換える。.env.local の NEXT_PUBLIC_SUPABASE_URL が
 * クラウドの検証・本番プロジェクトを向いたまま実行すると、そのデータを壊してしまう。
 * 意図してリモートの検証プロジェクトへ流すときだけ E2E_ALLOW_REMOTE_SUPABASE=1 で解除する。
 */
export const assertLocalSupabaseUrl = (url: string): void => {
  if (process.env.E2E_ALLOW_REMOTE_SUPABASE === '1') {
    console.warn(`[e2e] E2E_ALLOW_REMOTE_SUPABASE=1 のため、ローカル以外の Supabase（${url}）への実行を許可します`);
    return;
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL が URL として解釈できません: ${url}\n${SETUP_HINT}`);
  }

  if (!LOCAL_SUPABASE_HOSTS.has(hostname)) {
    throw new Error(
      [
        `NEXT_PUBLIC_SUPABASE_URL がローカル環境ではありません: ${url}`,
        'E2E はテストデータの作成・削除と算定バッチの実行（dashboard_aggregates の書き換え）を行うため、',
        'ローカル Supabase（localhost / 127.0.0.1 / host.docker.internal）以外への実行を拒否しました。',
        '検証用のリモートプロジェクトへ意図的に流す場合のみ E2E_ALLOW_REMOTE_SUPABASE=1 を付けて実行してください。',
        SETUP_HINT,
      ].join('\n'),
    );
  }
};

/** anon キーでログイン済みのクライアントを返す。ローカル環境が整っていなければ理由付きで落とす。 */
export const createSignedInClient = async (): Promise<SupabaseClient> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。\n${SETUP_HINT}`,
    );
  }

  assertLocalSupabaseUrl(url);

  const supabase = createClient(url, anonKey, {
    // Node 上の使い捨てクライアントなので、セッションの永続化・自動更新は不要。
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });

  if (error) {
    throw new Error(
      `seed ユーザー（${TEST_USER.email}）でログインできませんでした: ${error.message}\n${SETUP_HINT}`,
    );
  }

  return supabase;
};

/**
 * テストが作った活動量レコードを削除する（備考の目印で特定する）。
 * emission_results は activityRecordId の on delete cascade で一緒に消える。
 *
 * 注意: dashboard_aggregates は算定時に絶対値で再計算されるテーブルで、レコードを消しても
 * seed の値には戻らない。seed の状態に戻したいときは `npm run db:reset:demo` を実行すること
 * （`npx supabase db reset` だけではデモシードは入らない）。
 */
export const deleteE2eActivityRecords = async (supabase: SupabaseClient): Promise<number> => {
  const { data, error } = await supabase
    .from('activity_records')
    .delete()
    .eq('note', E2E_NOTE_MARKER)
    .select('id');

  if (error) {
    throw new Error(`テストデータの削除に失敗しました: ${error.message}`);
  }

  return data?.length ?? 0;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 算定API（/api/calculations）のレート制限が空くまで待つ。
 *
 * 制限は「組織あたり1分に CALCULATION_PER_MINUTE_LIMIT 件」で、直近の calculation_batches の
 * 件数で判定される（supabase/migrations/20260831000002_rpc.sql の
 * create_calculation_batch_with_rate_limit）。スモークを続けて流すと
 * 前回の実行ぶんが窓に残り、算定が弾かれてテストが落ちる。原因が分かりにくい失敗になるため、
 * 開始前にここで空くまで待つ。
 */
export const waitForCalculationRateLimit = async (
  supabase: SupabaseClient,
  requiredSlots: number,
): Promise<void> => {
  const allowedExisting = CALCULATION_PER_MINUTE_LIMIT - requiredSlots;

  for (;;) {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    // RLS により自組織の行だけが返るため、組織での絞り込みは不要。
    const { data, error } = await supabase
      .from('calculation_batches')
      .select('startedAt')
      .gte('startedAt', since)
      .order('startedAt', { ascending: true });

    if (error) {
      throw new Error(`算定バッチの確認に失敗しました: ${error.message}`);
    }

    const recent = (data ?? []) as { startedAt: string }[];
    if (recent.length <= allowedExisting) {
      return;
    }

    // いちばん古い1件が窓から外れれば枠が1つ空く。余裕を持たせて1秒足す。
    const waitMs = new Date(recent[0].startedAt).getTime() + RATE_LIMIT_WINDOW_MS - Date.now() + 1_000;
    const waitSeconds = Math.ceil(Math.max(waitMs, 1_000) / 1_000);
    console.log(`[e2e] 直前の算定が残っているため、レート制限が空くまで ${waitSeconds} 秒待ちます`);
    await sleep(Math.max(waitMs, 1_000));
  }
};

/** 稼働中バッチの再確認間隔。実際に走っているバッチなら数秒で完了するので、窓明けを待つ前に拾える。 */
const PENDING_POLL_INTERVAL_MS = 5_000;

/**
 * 算定API（/api/calculations）の「稼働中」制限が空くまで待つ。
 *
 * create_calculation_batch_with_rate_limit には、1分あたりの件数制限（P2024）とは別に
 * 「status='pending' かつ直近 CALCULATION_PENDING_WINDOW_MS 以内のバッチが
 * CALCULATION_CONCURRENT_LIMIT 件以上なら弾く」制限（P2023）がある。
 * テストを Ctrl+C で止めたり dev サーバが落ちたりして pending 行が残ると、その行が窓から
 * 外れるまで（最大10分）すべての算定が弾かれ、「保存はできるのに算定完了トーストが出ない」
 * という原因の分かりにくい失敗になる。開始前にここで検知し、理由を出して空くまで待つ。
 *
 * 実行中のバッチは数秒で完了して pending でなくなるため、窓明けを待ち切るのは
 * 本当に滞留した行が残っている場合だけ。
 */
export const waitForCalculationPendingSlot = async (supabase: SupabaseClient): Promise<void> => {
  let notified = false;

  for (;;) {
    const since = new Date(Date.now() - CALCULATION_PENDING_WINDOW_MS).toISOString();
    // RLS により自組織の行だけが返るため、組織での絞り込みは不要。
    const { data, error } = await supabase
      .from('calculation_batches')
      .select('startedAt')
      .eq('status', 'pending')
      .gte('startedAt', since)
      .order('startedAt', { ascending: true });

    if (error) {
      throw new Error(`実行中の算定バッチの確認に失敗しました: ${error.message}`);
    }

    const pending = (data ?? []) as { startedAt: string }[];
    if (pending.length < CALCULATION_CONCURRENT_LIMIT) {
      if (notified) {
        console.log('[e2e] 実行中の算定バッチが解消しました。テストを開始します');
      }
      return;
    }

    // いちばん古い1件が窓から外れれば枠が1つ空く。余裕を持たせて1秒足す。
    const clearsInMs =
      new Date(pending[0].startedAt).getTime() + CALCULATION_PENDING_WINDOW_MS - Date.now() + 1_000;
    if (!notified) {
      notified = true;
      console.log(
        `[e2e] 実行中（status='pending'）の算定バッチが ${pending.length} 件残っているため、` +
          '算定APIが枠を空けるまで待ちます（前回の実行が中断された場合、' +
          `最大 ${Math.ceil(Math.max(clearsInMs, 0) / 1_000)} 秒かかります）`,
      );
    }
    await sleep(Math.min(PENDING_POLL_INTERVAL_MS, Math.max(clearsInMs, 1_000)));
  }
};
