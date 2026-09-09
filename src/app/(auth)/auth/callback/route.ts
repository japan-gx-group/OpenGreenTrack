import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSafeRedirectPath } from '@/features/auth/utils/redirect';
import { RECOVERY_MARKER_COOKIE } from '@/features/auth/utils/passwordRecoveryCookie';

// パスワード再設定リンク経由であることの目印 Cookie（名前は passwordRecoveryCookie.ts が正本）。
// 役割は2つ:
//   1. /reset-password の入場判定（proxy.ts）: マーカーが在る時だけ（＝メールリンクを踏んで
//      来た人だけ）ログイン済みでも開ける。無ければ他の認証ページ同様ダッシュボードへ送る。
//   2. 再設定の完了処理（completePasswordRecovery Server Action）の前提条件: マーカーが無ければ更新しない。
// パスワード変更そのものの防御はこのマーカーではなく、サーバ側の Server Action
// （現行パスワードの検証 → admin API で更新）と supabase/config.toml の
// auth.secure_password_change（ブラウザからの auth.updateUser({ password }) を拒否）が担う。
// httpOnly でJSから読めない/セットできないようにし、10分で失効させる
// （再設定はこの遷移で数秒〜数分内に完了する前提）。

// メールリンク（パスワード再設定など）からのコールバック。
// Supabase の verify を経て ?code= 付きでここへ戻るので、サーバ側で
// exchangeCodeForSession によりセッション Cookie を確立してから目的ページへ送る。
// code_verifier（PKCE）はメール送信時にブラウザが Cookie へ保存しており、
// サーバクライアントはその Cookie を読めるため交換が成立する。
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  // next はオープンリダイレクト対策で相対パスのみ許可する。
  const next = getSafeRedirectPath(searchParams.get('next'));

  // リダイレクト先はリクエストと同一オリジンで組み立てる。request.url を基点にすることで、
  // アクセス元のホスト（localhost / 127.0.0.1 / 本番ドメイン）を保ち、
  // セッション Cookie が別オリジン扱いで失われるのを防ぐ。
  const redirectUrl = (path: string) => new URL(path, request.url);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 再設定リンク（next=/reset-password）で来た時だけ目印を残す。
      // セッション Cookie と同じ next/headers の cookieStore 経由で書くことで、
      // 下の NextResponse.redirect にも確実に載る。
      if (next === '/reset-password') {
        const cookieStore = await cookies();
        cookieStore.set(RECOVERY_MARKER_COOKIE, '1', {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 600,
        });
      }
      return NextResponse.redirect(redirectUrl(next));
    }
  }

  // code 無し / 交換失敗（リンク切れ・改ざん）はログイン画面へ案内する。
  return NextResponse.redirect(redirectUrl('/login?error=auth_callback'));
}
