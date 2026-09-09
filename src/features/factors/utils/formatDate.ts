// 一覧・履歴カードで使う日付表示（yyyy/mm/dd）。未設定は「-」。
export const formatDate = (value?: string): string => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
};
