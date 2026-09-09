// 企業情報（organizations）の取得・更新サービス。
// Supabase のブラウザクライアント（RLS 前提）から呼ぶ。
// サブカンパニー削除後の単一組織 RLS（organizations_select_own / organizations_update_own）
// により、取得・更新ともログインユーザーの所属組織1件だけが対象になる。
import { createClient } from '@/lib/supabase/client';
import type { OrganizationInfo } from '../types';

// apiKeyHash は authenticated へ GRANT していない列なので select に含めない。
const ORG_COLUMNS =
  'id, name, corporateNumber, industrySector, address, envManagerName, fiscalYearStartMonth';

interface OrgRow {
  id: string;
  name: string;
  corporateNumber: string | null;
  industrySector: string | null;
  address: string | null;
  envManagerName: string | null;
  fiscalYearStartMonth: number | null;
}

const toOrganizationInfo = (row: OrgRow): OrganizationInfo => ({
  id: row.id,
  name: row.name,
  corporateNumber: row.corporateNumber ?? '',
  industrySector: row.industrySector ?? '',
  address: row.address ?? '',
  envManagerName: row.envManagerName ?? '',
  fiscalYearStartMonth: row.fiscalYearStartMonth,
});

export interface OrganizationUpdateInput {
  name: string;
  corporateNumber: string;
  industrySector: string;
  address: string;
  envManagerName: string;
  fiscalYearStartMonth: number | null;
}

// 自組織の企業情報を1件取得する。
// RLS が自組織の行だけを返すため、絞り込みなしの single() で自組織が一意に取得できる。
export const getOrganization = async (): Promise<OrganizationInfo> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('organizations')
    .select(ORG_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('企業情報の取得に失敗しました');
  }
  return toOrganizationInfo(data as OrgRow);
};

// 企業情報を更新する。ロール無効化中のため、認証済みユーザーなら自組織を更新できる。
// 自組織以外の id を渡した場合は RLS で更新対象が0行になり、single() がエラーになる。
export const updateOrganization = async (
  id: string,
  input: OrganizationUpdateInput,
): Promise<OrganizationInfo> => {
  const supabase = createClient();
  // 空文字は null に正規化して保存する（未入力を空文字で残さない）。
  const { data, error } = await supabase
    .from('organizations')
    .update({
      name: input.name.trim(),
      corporateNumber: input.corporateNumber.trim() || null,
      industrySector: input.industrySector.trim() || null,
      address: input.address.trim() || null,
      envManagerName: input.envManagerName.trim() || null,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
    })
    .eq('id', id)
    .select(ORG_COLUMNS)
    .single();

  if (error || !data) {
    // RLS で弾かれた（自組織以外を指定した）場合もここに来る。
    throw new Error('企業情報の保存に失敗しました');
  }
  return toOrganizationInfo(data as OrgRow);
};
