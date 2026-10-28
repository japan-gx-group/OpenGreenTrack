// 「画像を WebP に変換して容量を減らす」の選択（ブラウザ専用）。使う人ごとの好みなので、このブラウザに覚えておく。
// 帳票の欄（データ入力フォーム）と、請求書をまとめて読むカードで同じ選択を使う。同じ画面に並ぶため、
// 変わったことを知らせて（subscribeConvertPreference）、片方で切り替えるともう片方にも反映する（hooks/useConvertPreference.ts）。
// 読み書きできない環境（プライベートブラウズなど）では、覚えずに画面を開いている間だけの選択として持つ。

const CONVERT_PREFERENCE_KEY = 'ogt.activityEvidence.convertToWebp';

const listeners = new Set<() => void>();
// 覚えられなかった選択（書き込みに失敗したときだけ持つ）
let unsavedPreference: boolean | null = null;

export const readConvertPreference = (): boolean => {
  if (unsavedPreference !== null) return unsavedPreference;
  try {
    return window.localStorage.getItem(CONVERT_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeConvertPreference = (value: boolean): void => {
  try {
    window.localStorage.setItem(CONVERT_PREFERENCE_KEY, String(value));
    unsavedPreference = null;
  } catch {
    unsavedPreference = value;
  }
  for (const listener of listeners) listener();
};

/** 選択が変わったら listener を呼ぶ（別のタブで変えたときも）。戻り値で購読をやめる */
export const subscribeConvertPreference = (listener: () => void): (() => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONVERT_PREFERENCE_KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};
