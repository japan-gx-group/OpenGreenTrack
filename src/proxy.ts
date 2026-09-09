import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAuthPath } from '@/lib/security/authPaths';
import { buildRuntimeSecurityHeaders, CSP_REPORT_PATH } from '@/lib/security/securityHeaders';
import { RECOVERY_MARKER_COOKIE } from '@/features/auth/utils/passwordRecoveryCookie';

// 環境変数から導出するセキュリティヘッダは next.config.ts の headers() だと
// ビルド時の値で固定されてしまうため、ここでリクエストごとに付与する（詳細は
// src/lib/security/securityHeaders.ts のコメント）。リダイレクト応答にも必ず乗せる。
export async function proxy(request: NextRequest) {
  const response = await handleRequest(request);
  const securityHeaders = buildRuntimeSecurityHeaders(request.nextUrl.origin);
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

async function handleRequest(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has('x-request-id')) {
    requestHeaders.set('x-request-id', crypto.randomUUID());
  }

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const { pathname } = request.nextUrl;

  // CSP Report-Only の違反報告は未ログイン画面からも送られるため、認証ガードの対象外にする。
  // 認証で守れない分は Route Handler 側でレートリミットと本文サイズ上限をかける。
  if (pathname === CSP_REPORT_PATH) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() がトークンをローテーションした場合、リフレッシュ済みクッキーは
  // `response` に書き込まれている。リダイレクト時も必ずコピーしないと新トークンが
  // 破棄され、次回リクエストで更新に失敗してログアウトループになる。
  const redirectTo = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });
    return redirect;
  };

  // 認証コールバック（メールリンクからのコード交換）は未ログインで到達する必要があるため公開扱い。
  // 公開するのは /auth/callback の1本だけ。startsWith('/auth/') だと将来 /auth/ 配下に足した
  // 保護対象ページまで未ログインで晒してしまうため、完全一致で限定する。
  const isAuthCallback = pathname === '/auth/callback';

  if (!user && !isAuthPath(pathname) && !isAuthCallback) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return redirectTo(loginUrl);
  }

  // ログイン済みユーザーが認証系ページ（ログイン・初回登録・招待）に来たらダッシュボードへ送る。
  // 招待リンク（/invite/*）も含めて弾くのが重要: 既ログインのユーザーが招待を開いて受諾すると
  // 別アカウントが作られ、ブラウザのセッションがそちらへ切り替わってしまう（自分からログアウトされる）。
  //
  // 例外: /reset-password は「メールの再設定リンク経由で来た人」だけ通す。
  // リンク経由なら /auth/callback が pw-recovery マーカー（httpOnly・短命）を張っている。
  // このマーカーが無い（＝ただログイン中の人が /reset-password を直接開いた）場合は、
  // 他の認証ページと同様ダッシュボードへ送る。
  // なおマーカーが守るのは「ページを開けるか」だけ。パスワード変更そのものは
  // Server Action（completePasswordRecovery / changePassword）がサーバ側で前提条件を検証し、
  // supabase/config.toml の auth.secure_password_change でブラウザからの
  // auth.updateUser({ password }) を拒否することで強制している。
  const hasRecoveryMarker = request.cookies.get(RECOVERY_MARKER_COOKIE)?.value === '1';
  const isRecoveryReset = pathname === '/reset-password' && hasRecoveryMarker;
  if (user && isAuthPath(pathname) && !isRecoveryReset) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    dashboardUrl.search = '';
    return redirectTo(dashboardUrl);
  }

  // 注: ここでは auth.users のセッション有無のみを確認する。profiles 行（＝組織所属）の
  // 有無は検証していないため、profiles 未作成のユーザーは通過するが RLS で全クエリが空になる。
  // profiles の作成（プロビジョニング）は初回登録ウィザード・招待受諾で行い、失敗時は
  // ベストエフォートで作成済み auth ユーザーを掃除する。掃除も失敗した稀なケースでは profiles
  // 無しのユーザーが残り得る（既知の制限）。厳密に塞ぐには proxy で profiles 存在確認が要るが、
  // 全リクエストに追加クエリが乗るため、発生確率と費用対効果からここでは行わない。
  return response;
}

export const config = {
  matcher: [
    // api/health は死活監視・readiness probe が未認証で叩くため除外する。
    // ここを通すと未ログイン扱いで /login へ 307 リダイレクトされ、監視から使えなくなる。
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
