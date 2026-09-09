// アカウント削除（退会）の Route Handler。
// auth ユーザーの削除は service_role（admin client）が必要なためサーバで行う。
//
// セキュリティ設計:
//   - 削除対象は「セッションのユーザー自身」に固定する。リクエストボディの id 等は一切信用しない。
//   - service_role は RLS をバイパスするため、必ず先にセッションでログイン本人を確定させる。
//   - 組織で最後の1人（メンバー不在になる削除）は拒否する（isLastMember ガード）。
//   - 破壊的操作のため、Origin ヘッダがサイト自身であることを確認する（CSRF緩和）。

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isLastMember } from '@/features/settings/services/accountGuards';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

// サイト自身の公開ホスト（Origin の比較相手）を求める。
// 運用者が明示した APP_URL を最優先する（Host 系ヘッダはプロキシ構成次第で書き換わるため）。
// 未設定のセルフホスト環境では x-forwarded-host → host の順で見る。nginx 等のリバースプロキシ
// 越しでは proxy_set_header Host が無いと Host が「localhost:3000」等の内部値になり、
// ブラウザが送る Origin（公開ドメイン）と一致せず常に 403 になるため、素の Host だけを
// 見てはいけない（invites.ts の resolveRequestOrigin と同じ解決順）。
// 判定できない場合は null を返し、呼び出し側で拒否する（fail-closed）。
const resolveExpectedHost = (request: NextRequest): string | null => {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      return new URL(appUrl).host;
    } catch {
      // APP_URL が不正な形式なら「設定なし」扱いにせず拒否する（設定ミスを黙って緩めない）。
      return null;
    }
  }
  // x-forwarded-host は多段プロキシでカンマ区切りになり得るため先頭だけを使う。
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  return forwardedHost || request.headers.get('host') || null;
};

// Origin がサイト自身の公開ホストと一致するか（クロスサイトからの POST を弾く）。
// ブラウザの fetch(POST) は同一オリジンでも Origin を必ず送るため、欠落・不一致は拒否してよい。
const isSameOrigin = (request: NextRequest): boolean => {
  const origin = request.headers.get('origin');
  const expectedHost = resolveExpectedHost(request);
  if (!origin || !expectedHost) return false;
  try {
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
};

export const POST = async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  // 1) セッションからログイン本人を確定する（ここが削除対象の唯一の根拠）。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2) 本人のプロフィール（組織・権限）を取得する。
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, organizationId')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) {
    return NextResponse.json({ error: 'プロフィールが見つかりません' }, { status: 404 });
  }

  // 3) 安全ガード: 組織で最後の1人なら削除を拒否する（ロール判定が無効なため、
  //    「最後の admin」ではなく「最後のメンバー」を守る）。
  // 既知の限界（TOCTOU）: このカウントと下の削除はトランザクション化できないため
  // （supabase-js は複数文のトランザクションを張れない）、2人がミリ秒差で同時に退会すると
  // 両方が count>1 を通過し、メンバー不在の組織が残り得る。
  // 自社ホスト・単一テナント運用では実質発生しないため、DB関数化まではしない。
  const { count, error: countError } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('organizationId', profile.organizationId);
  if (countError) {
    return NextResponse.json(
      { error: 'アカウント削除の事前確認に失敗しました' },
      { status: 500 },
    );
  }
  if (isLastMember(count ?? 0)) {
    return NextResponse.json(
      {
        error:
          '組織で最後のメンバーのため削除できません。先に別のメンバーを招待してください',
      },
      { status: 409 },
    );
  }

  // 4) auth ユーザーを削除する。
  //    profiles.id は auth.users を on delete cascade で参照するため、profiles 行も同時に消える。
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return NextResponse.json({ error: 'アカウントの削除に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
};
