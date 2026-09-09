import { Loader2 } from 'lucide-react';

/**
 * 年度・拠点などの切替後、新データ取得が完了するまで前回の値を表示し続ける
 * （stale-while-revalidate、白画面回避）際に「更新中」を明示する浮遊インジケータ。
 *
 * 通常フローに置くと出現・消滅のたびに周囲のカードやグラフが上下にずれてしまうため、
 * 直近の position:relative 祖先を基準に絶対配置で浮かせ、レイアウトシフトを防ぐ
 * （切替時のグラフの動きを滑らかに保つ）。使う側のスクロールコンテナに `relative` を付けること。
 */
export const RefreshingIndicator = ({
  show,
  label = '最新のデータに更新しています…（表示中の数値は前回の内容です）',
  top = '1.75rem',
  right = '2.5rem',
}: {
  show: boolean;
  label?: string;
  top?: string;
  right?: string;
}) => {
  if (!show) return null;

  return (
    <div
      className="rounded-full absolute z-10 flex items-center"
      role="status"
      aria-live="polite"
      style={{
        top,
        right,
        gap: '8px',
        padding: '7px 14px',
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
        fontSize: '12.5px',
        color: 'var(--color-text-subtle)',
      }}
    >
      <Loader2 size={14} className="animate-spin" />
      {label}
    </div>
  );
};
