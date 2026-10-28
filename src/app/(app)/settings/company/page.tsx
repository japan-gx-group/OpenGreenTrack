import { CompanySettings } from '@/features/settings/components/CompanySettings.client';

// 企業・メンバー設定。ロールによる出し分け（変更は管理者だけ）は各カードのクライアントコンポーネントが行い、
// 権限の正しさは Server Action と RLS で確かめるため、ページはクライアントコンポーネントを描画するだけにする。
// 未ログインのアクセスは src/proxy.ts（Next.js のミドルウェア）がログイン画面へ振り分ける。
export default function CompanySettingsPage() {
  return <CompanySettings />;
}
