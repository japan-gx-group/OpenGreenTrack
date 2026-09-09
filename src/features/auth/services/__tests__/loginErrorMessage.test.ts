import { describe, expect, it } from 'vitest';
import { LOGIN_ERROR_MESSAGES, toLoginErrorMessage } from '../loginErrorMessage';

describe('toLoginErrorMessage', () => {
  it('認証情報の誤りは「メールアドレスまたはパスワードが正しくありません」にする', () => {
    expect(toLoginErrorMessage({ code: 'invalid_credentials', status: 400 })).toBe(
      LOGIN_ERROR_MESSAGES.invalidCredentials,
    );
  });

  it('メール未確認は確認メールを案内する', () => {
    expect(toLoginErrorMessage({ code: 'email_not_confirmed', status: 400 })).toBe(
      LOGIN_ERROR_MESSAGES.emailNotConfirmed,
    );
  });

  it('レート制限は code でも status 429 でも同じ案内にする', () => {
    expect(toLoginErrorMessage({ code: 'over_request_rate_limit', status: 429 })).toBe(
      LOGIN_ERROR_MESSAGES.rateLimited,
    );
    expect(toLoginErrorMessage({ code: 'over_email_send_rate_limit', status: 429 })).toBe(
      LOGIN_ERROR_MESSAGES.rateLimited,
    );
    // 前段のプロキシ等が返す 429 は code を持たない
    expect(toLoginErrorMessage({ status: 429 })).toBe(LOGIN_ERROR_MESSAGES.rateLimited);
  });

  it('利用停止ユーザーは管理者への問い合わせを案内する', () => {
    expect(toLoginErrorMessage({ code: 'user_banned', status: 403 })).toBe(
      LOGIN_ERROR_MESSAGES.userBanned,
    );
  });

  it('code も status も無い（応答を受け取れなかった）場合は通信エラーにする', () => {
    expect(toLoginErrorMessage({})).toBe(LOGIN_ERROR_MESSAGES.network);
  });

  it('未知の code は汎用の失敗メッセージにし、英語の message は表示しない', () => {
    expect(toLoginErrorMessage({ code: 'unexpected_failure', status: 500 })).toBe(
      LOGIN_ERROR_MESSAGES.unknown,
    );
  });
});
