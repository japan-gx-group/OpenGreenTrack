// ログイン失敗時に画面へ出す日本語メッセージを決める。
// signInWithPassword が返す AuthError の message は Supabase の英語文
// （"Invalid login credentials" 等）で、そのまま表示すると利用者に伝わらない。
// 判定は message の文字列一致ではなく、Supabase が仕様として公開している
// error.code（invalid_credentials 等）と HTTP status で行い、英語文の変更に影響されないようにする。

interface LoginErrorLike {
  code?: string;
  status?: number;
}

export const LOGIN_ERROR_MESSAGES = {
  invalidCredentials: 'メールアドレスまたはパスワードが正しくありません。',
  emailNotConfirmed:
    'メールアドレスの確認が完了していません。届いている確認メールのリンクを開いてから再度お試しください。',
  rateLimited: 'ログインの試行回数が上限に達しました。しばらく時間をおいて再度お試しください。',
  userBanned: 'このアカウントは利用停止されています。管理者にお問い合わせください。',
  network: '通信に失敗しました。時間をおいて再度お試しください。',
  unknown: 'ログインに失敗しました。時間をおいて再度お試しください。',
} as const;

export const toLoginErrorMessage = (error: LoginErrorLike): string => {
  switch (error.code) {
    case 'invalid_credentials':
      return LOGIN_ERROR_MESSAGES.invalidCredentials;
    case 'email_not_confirmed':
      return LOGIN_ERROR_MESSAGES.emailNotConfirmed;
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return LOGIN_ERROR_MESSAGES.rateLimited;
    case 'user_banned':
      return LOGIN_ERROR_MESSAGES.userBanned;
    default:
      break;
  }

  // Supabase Auth 自体ではなく前段（リバースプロキシ等）が 429 を返した場合は code が付かない。
  if (error.status === 429) {
    return LOGIN_ERROR_MESSAGES.rateLimited;
  }
  // 応答を受け取れなかった通信断（AuthRetryableFetchError）は code も status も持たない。
  if (error.code === undefined && error.status === undefined) {
    return LOGIN_ERROR_MESSAGES.network;
  }
  return LOGIN_ERROR_MESSAGES.unknown;
};
