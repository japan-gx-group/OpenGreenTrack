// 招待リンクについての判定（画面から使う純関数）。
// 招待の発行・取り消しそのものは同じディレクトリの invites.ts（Server Action）。

// このPCの中だけを指すホスト名。共有先のPCで開くと相手自身のPCを指してしまい、
// 招待リンクとしては機能しない。
const LOCAL_ONLY_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::1]']);

/**
 * 招待リンクが「発行したPCでしか開けない」URL かどうかを判定する。
 *
 * README 推奨のローカル構成では招待リンクが http://localhost:3000/invite/... になる。
 * localhost は開いた人自身のPCを指すため、このリンクをメールやチャットで共有しても
 * 相手の環境では開けない（双方とも原因に気づきにくい）。
 *
 * URL として解釈できない文字列は判定できないので false を返す（注意文を出さない）。
 */
export const isLocalOnlyInviteUrl = (url: string): boolean => {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (LOCAL_ONLY_HOSTNAMES.has(hostname)) return true;
  // RFC 6761 により *.localhost はループバックに解決される予約名
  if (hostname.endsWith('.localhost')) return true;
  // 127.0.0.0/8 はすべてループバック（127.0.0.1 以外も含む）
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
};
