// ブラウザでのファイルダウンロードの共通ヘルパー。
// Blob / document を使うため Client Component からのみ呼ぶこと。

// Blob を指定ファイル名でダウンロードさせる（アンカー生成 → click → 後始末）。
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

// 日時をファイル名向けの YYYYMMDD-HHmm に整形。不正な ISO 文字列は現在時刻にフォールバックする。
export const timestampForFileName = (iso: string): string => {
  const date = new Date(iso);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${valid.getFullYear()}${pad(valid.getMonth() + 1)}${pad(valid.getDate())}` +
    `-${pad(valid.getHours())}${pad(valid.getMinutes())}`
  );
};
