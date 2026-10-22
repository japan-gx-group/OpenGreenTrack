// 根拠のファイルの SHA-256 を、ブラウザの中で計算する（docs/ssbj-spec.md §13「根拠のファイルの SHA-256」）。
// ファイル本体はどこにも送らず、保存もしない。記録するのは計算した値だけ。

/** 記録する SHA-256 の形式（小文字の 16 進 64 文字）。DB の check 制約と同じ。 */
export const isSsbjSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

/**
 * ファイルの SHA-256 を、小文字の 16 進で返す。
 * Web Crypto は安全な接続（https・localhost）でしか使えないため、それ以外では計算できない旨のエラーにする。
 */
export const sha256HexOfFile = async (file: Blob): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('この接続ではファイルの SHA-256 を計算できません。https のアドレスで開き直してください');
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error('ファイルを読み込めませんでした。ファイルを選び直してください');
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
