// 招待メールの送信。Resend の REST API を fetch で直接呼ぶ（追加ライブラリなし）。
//
// ⚠️ サーバ専用: RESEND_API_KEY / INVITE_EMAIL_FROM を参照するため、
//    Server Action / Route Handler 以外（Client Component）から import しないこと。
//
// セルフホスト環境ではメールプロバイダ未設定でも招待自体は成立させたいので、
// 環境変数が無ければ送信をスキップして 'skipped' を返す（呼び出し側でリンク共有を案内）。
// 送信失敗もエラーにせず 'failed' を返し、招待の発行は成功のまま扱う。

import { buildInviteEmail, type InviteEmailInput } from './inviteEmailTemplate';
import { logger } from '@/lib/logging/logger';

/** 招待メールの送信結果。UI での案内出し分けに使う。
 *  - sent: 送信 API が受理した
 *  - skipped: メール送信が未設定（RESEND_API_KEY / INVITE_EMAIL_FROM が無い）
 *  - failed: 設定済みだが送信に失敗した */
export type InviteEmailStatus = 'sent' | 'skipped' | 'failed';

const RESEND_API_URL = 'https://api.resend.com/emails';

/** Resend の応答を待ちすぎて Server Action 全体が固まらないようにする上限 */
const SEND_TIMEOUT_MS = 10_000;

/** メール送信が設定済みか（キーと差出人が両方あるか）。
 *  未設定なら呼び出し側は本文の材料集め（組織名の取得など）を省略できる。 */
export const isInviteEmailConfigured = (): boolean =>
  Boolean(process.env.RESEND_API_KEY && process.env.INVITE_EMAIL_FROM);

export const sendInviteEmail = async (
  input: InviteEmailInput & { to: string },
): Promise<InviteEmailStatus> => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_EMAIL_FROM;
  if (!apiKey || !from) {
    return 'skipped';
  }

  try {
    // 本文組み立ても try 内で行う。万一ここで例外が出ても Server Action 全体を
    // reject させず（招待自体は成立済みのため）、'failed' として返す。
    const { subject, text, html } = buildInviteEmail(input);

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 失敗理由（ドメイン未認証・キー無効など）は運用者向けにサーバーログへだけ残す。
      // API キーや宛先の詳細を画面へ返さないこと。
      // detail には送信 API のレスポンスがそのまま入り、宛先メールアドレスを含み得る。
      // 構造化ログはログ基盤側でインデックスされるため、長さを絞って残す。
      const detail = await response.text().catch(() => '');
      logger.error(
        { status: response.status, detail: detail.slice(0, 300) },
        '招待メールの送信に失敗しました',
      );
      return 'failed';
    }

    return 'sent';
  } catch (error) {
    logger.error({ error }, '招待メールの送信に失敗しました');
    return 'failed';
  }
};
