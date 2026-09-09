// パスワード再設定リンク経由であることの目印 Cookie 名。
// /auth/callback（Route Handler）が張り、proxy.ts が /reset-password の入場判定に、
// completePasswordRecovery（Server Action）が更新の前提条件として読む。
// 3箇所で同じ名前を使う必要があるため、ここを唯一の定義にする
// （route.ts は Handler 以外を export できず、'use server' ファイルは async 関数しか export できない）。
export const RECOVERY_MARKER_COOKIE = 'pw-recovery';
