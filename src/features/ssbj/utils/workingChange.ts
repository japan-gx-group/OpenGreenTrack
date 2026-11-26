// SSBJ レポートの作業中の内容が書き換わったことの知らせ。作業中の内容を書き換える service の関数が成功した後に
// notifySsbjWorkingChanged を呼び、レイアウトの SsbjReportOverviewProvider がそれを受けて進み具合を読み直す
// （入力の画面の本体に手を入れずに、同じ画面の中でタブの数・点検表を新しくするため）。
// ブラウザの window の CustomEvent で知らせる。サーバ（window が無い）では何もしない。

export const SSBJ_WORKING_CHANGED_EVENT = 'ssbj:working-changed';

/** 知らせの中身。reportId が分からない書き換え（行の ID だけで更新・削除する関数）は null（開いているレポートを読み直す）。 */
export type SsbjWorkingChangedDetail = { reportId: string | null };

export const notifySsbjWorkingChanged = (reportId: string | null = null): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SsbjWorkingChangedDetail>(SSBJ_WORKING_CHANGED_EVENT, { detail: { reportId } }));
};

/** 知らせを受ける。戻り値で受けるのをやめる。reportId のレポートの知らせ（と、レポートの分からない知らせ）だけを渡す。 */
export const onSsbjWorkingChanged = (reportId: string, handler: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SsbjWorkingChangedDetail>).detail;
    if (!detail?.reportId || detail.reportId === reportId) handler();
  };
  window.addEventListener(SSBJ_WORKING_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SSBJ_WORKING_CHANGED_EVENT, listener);
};
