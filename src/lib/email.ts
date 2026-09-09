// メールアドレスの形式チェック（画面側・Server Action 側で共通に使う）。
//
// 厳密な RFC 準拠ではなく「@ を挟んで前後に文字があり、ドメインにドットがある」程度の
// ゆるい判定にとどめる。入力ミス（@ の欠落など）を早めに弾くのが目的で、実在確認は
// Supabase Auth 側のメール送信・確認に委ねる。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());
