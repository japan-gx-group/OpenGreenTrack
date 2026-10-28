// 「画像を WebP に変換して容量を減らす」の選択（ブラウザ専用）。使う人ごとの好みなので、このブラウザに覚えておく。
// 帳票の欄（データ入力フォーム）と、請求書をまとめて読むカードで同じ選択を使う。
// 読み書きできない環境（プライベートブラウズなど）では、覚えずに既定（変換しない）で動く。

const CONVERT_PREFERENCE_KEY = 'ogt.activityEvidence.convertToWebp';

export const readConvertPreference = (): boolean => {
  try {
    return window.localStorage.getItem(CONVERT_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeConvertPreference = (value: boolean): void => {
  try {
    window.localStorage.setItem(CONVERT_PREFERENCE_KEY, String(value));
  } catch {
    // 覚えられない環境では、画面を開いている間だけの選択になる。
  }
};
