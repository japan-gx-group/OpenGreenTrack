// 設定機能（企業情報 / アカウント）で扱う型。

// 個人プロフィール。氏名・電話番号は編集可、メール・組織は表示のみ。
// ロールは持たない（ロール判定は無効。DB の profiles.role は互換のため残るが参照しない）。
export interface CurrentProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  organizationId: string;
}

// 企業情報（organizations の画面表示用）。
export interface OrganizationInfo {
  id: string;
  name: string;
  corporateNumber: string;
  industrySector: string;
  address: string;
  envManagerName: string;
  // 期首月（1〜12）。未設定は null。
  fiscalYearStartMonth: number | null;
}

