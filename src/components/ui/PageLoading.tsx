import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

/**
 * スピナー＋ラベルの最小単位。ルート境界（loading.tsx）でも、ページ内のデータ取得中でも
 * 同じ見た目にするための共通パーツ。
 *
 * 対象ルートは静的プリレンダリングされるため loading.tsx の境界は一瞬しか出ず、
 * 実際に利用者が見るのはクライアント側フェッチ中の表示のほうが長い。両者を同じ部品に
 * 揃えることで、遷移中に別デザインのスピナーが二段で出る「二重ローディング」を避ける。
 */
export const LoadingIndicator = ({
  label = '読み込み中...',
  size = 24,
  className,
}: {
  label?: string;
  size?: number;
  className?: string;
}) => {
  return (
    <div className={clsx('flex items-center gap-3', className)} role="status" aria-live="polite">
      <Loader2 aria-hidden="true" size={size} className="shrink-0 animate-spin text-primary" />
      <span className="text-sm font-semibold text-text-muted">{label}</span>
    </div>
  );
};

/**
 * App Router の `loading.tsx` 用フォールバック。
 * `.main-content` は flex-column なので `flex-1` で本文領域いっぱいに伸ばし、
 * ビューポート中央にスピナーが来るようにする（固定 vh だと上寄りになる）。
 */
export const PageLoading = ({ label }: { label?: string }) => {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <LoadingIndicator label={label} />
    </div>
  );
};
