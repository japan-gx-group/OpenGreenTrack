// 招待メールの本文組み立て。環境変数やネットワークに依存しない純粋関数のみを
// 置き、単体テスト（inviteEmailTemplate.test.ts）で検証できるようにしている。
// 実際の送信は inviteEmail.ts（サーバ専用）が行う。

/** メールの表示名などに使う値から改行・制御文字を取り除く。
 *  Resend へは JSON で渡すため古典的なヘッダインジェクションは成立しないが、
 *  件名や本文に招待者名（ユーザー入力由来）を差し込むため、多重防御として
 *  改行による本文偽装・レイアウト崩れを防いでおく。 */
export const sanitizeInlineText = (value: string): string =>
  // eslint-disable-next-line no-control-regex -- 制御文字（改行含む）の除去が目的
  value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();

/** HTML 本文へ差し込む値のエスケープ（HTMLインジェクション対策） */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface InviteEmailInput {
  /** 招待者の表示名（profiles.fullName。未設定時は呼び出し側でフォールバックする） */
  inviterName: string;
  /** 招待先の組織名 */
  organizationName: string;
  /** サインアップリンク（{origin}/invite/{token}） */
  inviteUrl: string;
  /** 有効期限（invites.expiresAt の ISO 文字列） */
  expiresAt: string;
}

export interface InviteEmailContent {
  subject: string;
  text: string;
  html: string;
}

/** 有効期限を「YYYY/MM/DD」（日本時間）で表示する。パースできない値は空文字を返し、
 *  呼び出し側で「7日間」という固定表現のみにフォールバックする。 */
const formatExpiryDate = (expiresAt: string): string => {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

/** 招待メールの件名・テキスト本文・HTML本文を組み立てる */
export const buildInviteEmail = (input: InviteEmailInput): InviteEmailContent => {
  const inviterName = sanitizeInlineText(input.inviterName);
  const organizationName = sanitizeInlineText(input.organizationName);
  const inviteUrl = input.inviteUrl.trim();
  const expiryDate = formatExpiryDate(input.expiresAt);
  const expiryLine = expiryDate
    ? `この招待リンクの有効期限は発行から7日間（${expiryDate} まで）です。`
    : 'この招待リンクの有効期限は発行から7日間です。';

  const subject = `【GreenTrack】${organizationName} への招待`;

  const text = [
    `${inviterName} さんから、GHG排出量算定プラットフォーム「GreenTrack」の`,
    `組織「${organizationName}」に招待されました。`,
    '',
    '以下のリンクからアカウントを登録すると、メンバーとして参加できます。',
    inviteUrl,
    '',
    expiryLine,
    '',
    '※このメールには返信しないでください。',
    '※心当たりがない場合は、このメールを破棄してください。',
  ].join('\n');

  // メールクライアントでは CSS 変数や外部 CSS が使えないため、
  // ここだけ例外的に生の色値をインラインスタイルで指定する（AGENTS.md R5 の例外）。
  const html = [
    '<div style="font-family: sans-serif; line-height: 1.8; color: #1f2937; max-width: 560px;">',
    `  <p>${escapeHtml(inviterName)} さんから、GHG排出量算定プラットフォーム「GreenTrack」の組織「${escapeHtml(organizationName)}」に招待されました。</p>`,
    '  <p>以下のリンクからアカウントを登録すると、メンバーとして参加できます。</p>',
    `  <p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>`,
    `  <p>${escapeHtml(expiryLine)}</p>`,
    '  <p style="color: #6b7280; font-size: 12px;">※このメールには返信しないでください。<br />※心当たりがない場合は、このメールを破棄してください。</p>',
    '</div>',
  ].join('\n');

  return { subject, text, html };
};
