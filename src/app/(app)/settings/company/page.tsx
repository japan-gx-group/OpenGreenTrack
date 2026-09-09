import { CompanySettings } from '@/features/settings/components/CompanySettings.client';

// 企業・メンバー設定。ロールによる出し分けは行わない（ロール判定は無効）ため、
// 他ページ（dashboard 等）と同じくクライアントコンポーネントを描画するだけにする。
// 未ログインのアクセスは src/proxy.ts（Next.js のミドルウェア）がログイン画面へ振り分ける。
export default function CompanySettingsPage() {
  return <CompanySettings />;
}
