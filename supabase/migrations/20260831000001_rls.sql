-- OpenGreenTrack v1.0 初期スキーマ (2/3): RLS と権限
-- 組織単位のデータ分離と最小権限を DB 層で担保する（PostgREST を直接叩いても他組織へ到達できず、未認証では何も見えない）。
-- §1 RLS 補助関数 4 本と EXECUTE 権限  §2 enable row level security（20 テーブル）  §3 ポリシー 51 本  §4 GRANT / REVOKE と default privileges
-- 適用順: 20260831000000_schema.sql の後。
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用）

-- §1 RLS 補助関数
-- ポリシー内で profiles を直接引くと自身のポリシー評価が再帰するため、security definer で RLS を介さずに引く。
-- ポリシーからは必ず (select fn()) の形で呼ぶ（行ごとではなく文ごとに 1 回評価）。

create function current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p."organizationId"
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create function current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

-- ロール別権限は未導入のため両関数とも「認証済みか」だけを返す。参照側は必ず組織スコープ条件と AND されるので組織分離は崩れない。
-- 導入時は本体を profiles.role 参照に差し替えるだけでよい。current_user_can_edit はポリシー未参照（将来用）。
create function current_user_can_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
$$;

create function current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
$$;

comment on function current_user_can_edit() is
  'ロール別権限は無効のため常に「認証済みか」を返す。ロールでは絞らない。';
comment on function current_user_is_admin() is
  'ロール別権限は無効のため常に「認証済みか」を返す。ロールでは絞らない。組織の範囲は各ポリシーの organizationId 条件で担保する。';

-- EXECUTE は authenticated のみ（既定の PUBLIC 付与と anon を剥奪。service_role は default privileges で保持）。
revoke all on function current_user_organization_id() from public, anon, authenticated;
revoke all on function current_user_role() from public, anon, authenticated;
revoke all on function current_user_can_edit() from public, anon, authenticated;
revoke all on function current_user_is_admin() from public, anon, authenticated;

grant execute on function current_user_organization_id() to authenticated;
grant execute on function current_user_role() to authenticated;
grant execute on function current_user_can_edit() to authenticated;
grant execute on function current_user_is_admin() to authenticated;

-- §2 enable row level security
-- anon 向けポリシーは作らないため、有効化だけで未認証アクセスは全テーブル拒否。ポリシーを持たないテーブルは authenticated からも不可。
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table fiscal_years enable row level security;
alter table suppliers enable row level security;
alter table locations enable row level security;
alter table emission_factors enable row level security;
alter table activity_records enable row level security;
alter table calculation_batches enable row level security;
alter table emission_results enable row level security;
alter table scope3_category_emissions enable row level security;
alter table dashboard_aggregates enable row level security;
alter table system_audit_logs enable row level security;
alter table invites enable row level security;
alter table supplier_emissions enable row level security;
alter table idea_imports enable row level security;
alter table idea_factors enable row level security;
alter table scope3_category_methods enable row level security;
alter table reduction_targets enable row level security;
alter table reduction_target_years enable row level security;

-- §3 ポリシー
-- 組織スコープは自組織 1 社限定（グループ会社横断はしない）。書き込みポリシーを持たないテーブルは service_role の Server Action / RPC 経由でのみ書く。

-- organizations: INSERT / DELETE ポリシーは作らない（組織作成は初回登録の service_role 経由。自組織の削除は全データ喪失のため不可）。
create policy "organizations_select_own"
on organizations
for select
to authenticated
using (id = (select current_user_organization_id()));

create policy "organizations_update_own"
on organizations
for update
to authenticated
using (
  id = (select current_user_organization_id())
  and (select current_user_is_admin())
)
with check (
  id = (select current_user_organization_id())
  and (select current_user_is_admin())
);

-- profiles: INSERT ポリシーは無い（作成は初回登録 / 招待受諾の service_role 経由）。with check の organizationId / role 据え置きは列 GRANT と重ねた多層防御。
create policy "profiles_select_same_organization"
on profiles
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "profiles_update_own_profile"
on profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and "organizationId" = (select current_user_organization_id())
  and role = (select current_user_role())
);

-- fiscal_years: 追加・削除は service_role のみ。organizationId が null の行は誰にも見えない。
create policy "fiscal_years_select_own_organization"
on fiscal_years
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "suppliers_select_own_organization"
on suppliers
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "suppliers_insert_own_organization"
on suppliers
for insert
to authenticated
with check ("organizationId" = (select current_user_organization_id()));

create policy "suppliers_update_own_organization"
on suppliers
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check ("organizationId" = (select current_user_organization_id()));

create policy "suppliers_delete_own_organization"
on suppliers
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "locations_select_own_organization"
on locations
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "locations_insert_own_organization"
on locations
for insert
to authenticated
with check ("organizationId" = (select current_user_organization_id()));

create policy "locations_update_own_organization"
on locations
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check ("organizationId" = (select current_user_organization_id()));

create policy "locations_delete_own_organization"
on locations
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- emission_factors: 公式係数（organizationId is null）は全組織が読める読み取り専用マスタ。投入は seed（postgres ロール）のみで authenticated は書けない。
-- 標準係数（isCustom = false）は API 直叩きでも改変不可。with check の isCustom = true でカスタム→標準への反転も防ぐ。
create policy "emission_factors_select_own_organization"
on emission_factors
for select
to authenticated
using (
  "organizationId" is null
  or "organizationId" = (select current_user_organization_id())
);

create policy "emission_factors_insert_own_organization"
on emission_factors
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  -- isCustom = true を INSERT でも要求する: false で作れると update / delete ポリシー
  -- （isCustom = true が条件）の対象外になり、誰も編集・削除できない行として残るため。
  and "isCustom" = true
  and (
    "locationId" is null
    or exists (
      select 1 from locations l
      where l.id = "locationId"
        and l."organizationId" = (select current_user_organization_id())
    )
  )
  and (
    "supplierId" is null
    or exists (
      select 1 from suppliers s
      where s.id = "supplierId"
        and s."organizationId" = (select current_user_organization_id())
    )
  )
);

create policy "emission_factors_update_own_organization"
on emission_factors
for update
to authenticated
using (
  "organizationId" = (select current_user_organization_id())
  and "isCustom" = true
)
with check (
  "organizationId" = (select current_user_organization_id())
  and "isCustom" = true
  and (
    "locationId" is null
    or exists (
      select 1 from locations l
      where l.id = "locationId"
        and l."organizationId" = (select current_user_organization_id())
    )
  )
  and (
    "supplierId" is null
    or exists (
      select 1 from suppliers s
      where s.id = "supplierId"
        and s."organizationId" = (select current_user_organization_id())
    )
  )
);

create policy "emission_factors_delete_own_organization"
on emission_factors
for delete
to authenticated
using (
  "organizationId" = (select current_user_organization_id())
  and "isCustom" = true
);

create policy "activity_records_select_own_organization"
on activity_records
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- 参照する側（拠点・係数）の組織帰属は FK では担保できない（FK は行の存在しか見ない）ため、
-- 自身の "organizationId" だけでなく他テーブルを指す列もすべて exists で検証する。
-- 検証を落とすと、PostgREST を直接叩いて他組織のカスタム係数や他組織の idea_factors を
-- 参照する自組織レコードを作れてしまう（idea_factors は §3 の select ポリシーのとおり
-- IDEA ライセンス上、契約組織の外に出せない境界）。
-- 公式係数（emission_factors の "organizationId" is null）は全組織共通マスタなので許可する。
create policy "activity_records_insert_own_organization"
on activity_records
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from locations l
    where l.id = "locationId"
      and l."organizationId" = (select current_user_organization_id())
  )
  and (
    "emissionFactorId" is null
    or exists (
      select 1 from emission_factors ef
      where ef.id = "emissionFactorId"
        and (
          ef."organizationId" is null
          or ef."organizationId" = (select current_user_organization_id())
        )
    )
  )
  and (
    "ideaFactorId" is null
    or exists (
      select 1 from idea_factors f
      where f.id = "ideaFactorId"
        and f."organizationId" = (select current_user_organization_id())
    )
  )
);

create policy "activity_records_update_own_organization"
on activity_records
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from locations l
    where l.id = "locationId"
      and l."organizationId" = (select current_user_organization_id())
  )
  and (
    "emissionFactorId" is null
    or exists (
      select 1 from emission_factors ef
      where ef.id = "emissionFactorId"
        and (
          ef."organizationId" is null
          or ef."organizationId" = (select current_user_organization_id())
        )
    )
  )
  and (
    "ideaFactorId" is null
    or exists (
      select 1 from idea_factors f
      where f.id = "ideaFactorId"
        and f."organizationId" = (select current_user_organization_id())
    )
  )
);

create policy "activity_records_delete_own_organization"
on activity_records
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- 算定結果 3 本（calculation_batches / emission_results / dashboard_aggregates）は authenticated には
-- 読み取り専用。組織スコープを満たす書き込みを許すと、PostgREST 直叩きで算定エンジン・レート制限
-- （create_calculation_batch_with_rate_limit）・system_audit_logs を通さずに排出量の任意値上書き・バッチの
-- completed 偽装・集計の書き換えができ、書き込み RPC の EXECUTE を service_role 限定にした意味が無くなる
-- （20260831000002_rpc.sql 冒頭）。GHG 報告値の完全性が製品価値であり、第三者検証では
-- 「アプリを介さず報告値を書き換えられ、改変が監査ログに残らない」こと自体が指摘対象になる。
-- 書き込みポリシーを足す代わりに、認証・組織検証・監査ログを通せる Route Handler + service_role の経路を作ること。
-- 活動量・拠点の削除に伴う結果行の後始末は on delete cascade と security definer トリガーが行うため、
-- 書き込みポリシーが無くても止まらない（20260831000000_schema.sql の clear_emission_results_on_recalculation）。
create policy "calculation_batches_select_own_organization"
on calculation_batches
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- emission_results: IDEA ライセンス境界（docs/IDEA連携Scope3算定仕様.md §0.2・§8-1）。IDEA 由来の原単位は契約組織外に見せられず、列を隠しても emissions ÷ 活動量で復元できるため行ごと自組織限定。
-- 可視範囲を広げる場合も IDEA 由来行（ideaFactorId / appliedFactor* 非 null）は自組織限定のまま残すこと。
create policy "emission_results_select_own_organization"
on emission_results
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "scope3_category_emissions_select_own_organization"
on scope3_category_emissions
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- "fiscalYearId" は FK では行の存在しか担保できないため、activity_records と同じく exists で組織帰属を検証する
-- （落とすと PostgREST を直接叩いて他組織の年度 UUID を指す自組織行を作れる = 自組織データの汚損）。
create policy "scope3_category_emissions_insert_own_organization"
on scope3_category_emissions
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from fiscal_years fy
    where fy.id = "fiscalYearId"
      and fy."organizationId" = (select current_user_organization_id())
  )
);

create policy "scope3_category_emissions_update_own_organization"
on scope3_category_emissions
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from fiscal_years fy
    where fy.id = "fiscalYearId"
      and fy."organizationId" = (select current_user_organization_id())
  )
);

create policy "scope3_category_emissions_delete_own_organization"
on scope3_category_emissions
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "dashboard_aggregates_select_own_organization"
on dashboard_aggregates
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- system_audit_logs: 追記専用（UPDATE / DELETE は意図的に無し）。
create policy "system_audit_logs_select_own_organization"
on system_audit_logs
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "system_audit_logs_insert_own_organization"
on system_audit_logs
for insert
to authenticated
with check ("organizationId" = (select current_user_organization_id()));

-- invites: current_user_is_admin() は認証済みなら true のため、自組織の認証ユーザーなら誰でも発行・削除できる（role は既定値 logger）。
-- token（招待リンクの秘密）を誰に見せるかを決めているのもこの SELECT ポリシーで、列 GRANT 側ではない。§4.3 の invites の項を参照。
-- UPDATE ポリシーは作らない（受諾処理は service_role の Server Action のみ）。
create policy "invites_select_own_organization_admin"
on invites
for select
to authenticated
using (
  "organizationId" = (select current_user_organization_id())
  and (select current_user_is_admin())
);

create policy "invites_insert_own_organization_admin"
on invites
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and (select current_user_is_admin())
);

create policy "invites_delete_own_organization_admin"
on invites
for delete
to authenticated
using (
  "organizationId" = (select current_user_organization_id())
  and (select current_user_is_admin())
);

create policy "supplier_emissions_select_own_organization"
on supplier_emissions
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "supplier_emissions_insert_own_organization"
on supplier_emissions
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from suppliers s
    where s.id = "supplierId"
      and s."organizationId" = (select current_user_organization_id())
  )
  and exists (
    select 1 from fiscal_years fy
    where fy.id = "fiscalYearId"
      and fy."organizationId" = (select current_user_organization_id())
  )
);

create policy "supplier_emissions_update_own_organization"
on supplier_emissions
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from suppliers s
    where s.id = "supplierId"
      and s."organizationId" = (select current_user_organization_id())
  )
  and exists (
    select 1 from fiscal_years fy
    where fy.id = "fiscalYearId"
      and fy."organizationId" = (select current_user_organization_id())
  )
);

create policy "supplier_emissions_delete_own_organization"
on supplier_emissions
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- idea_imports / idea_factors: ライセンスは法人単位のため SELECT は自組織のみ（グループ会社にも共有しない。docs/IDEA連携Scope3算定仕様.md §3.2）。取込・削除は service_role のインポート API のみ。
-- 同 §3.2 の admin 検証 / editor 制限 RESTRICTIVE ポリシーは意図的に不採用（本スキーマはロールで判定しない）。
create policy "idea_imports_select_own_organization"
on idea_imports
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "idea_factors_select_own_organization"
on idea_factors
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "scope3_category_methods_select_own_organization"
on scope3_category_methods
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "scope3_category_methods_insert_own_organization"
on scope3_category_methods
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from fiscal_years fy
    where fy.id = "fiscalYearId"
      and fy."organizationId" = (select current_user_organization_id())
  )
);

create policy "scope3_category_methods_update_own_organization"
on scope3_category_methods
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from fiscal_years fy
    where fy.id = "fiscalYearId"
      and fy."organizationId" = (select current_user_organization_id())
  )
);

create policy "scope3_category_methods_delete_own_organization"
on scope3_category_methods
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- 削減目標（組織あたり1行の基準年度 + 年度別削減率）。組織一致のみで CRUD を許す。
create policy "reduction_targets_select_own_organization"
on reduction_targets
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "reduction_targets_insert_own_organization"
on reduction_targets
for insert
to authenticated
with check ("organizationId" = (select current_user_organization_id()));

create policy "reduction_targets_update_own_organization"
on reduction_targets
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check ("organizationId" = (select current_user_organization_id()));

create policy "reduction_targets_delete_own_organization"
on reduction_targets
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "reduction_target_years_select_own_organization"
on reduction_target_years
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "reduction_target_years_insert_own_organization"
on reduction_target_years
for insert
to authenticated
with check ("organizationId" = (select current_user_organization_id()));

create policy "reduction_target_years_update_own_organization"
on reduction_target_years
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check ("organizationId" = (select current_user_organization_id()));

create policy "reduction_target_years_delete_own_organization"
on reduction_target_years
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- §4 GRANT / REVOKE
-- Supabase 既定の default privileges で public のテーブル・関数・シーケンスは anon / authenticated / service_role に ALL が自動付与される。
-- RLS は行しか絞らないため、列を隠すテーブル（organizations.apiKeyHash、profiles.role 等）は列指定 GRANT にする。anon には何も付与しない。

-- 4.1 デフォルト拒否（自動付与分の剥奪）
revoke all on
  organizations,
  profiles,
  fiscal_years,
  suppliers,
  locations,
  emission_factors,
  activity_records,
  calculation_batches,
  emission_results,
  scope3_category_emissions,
  dashboard_aggregates,
  system_audit_logs,
  -- 以下は 4.3 で列/操作を明示 grant するテーブル。ここで revoke しないと default privileges の
  -- ALL が残り、4.3 の grant が「最小権限の明示」にとどまって実効的な制限にならない。
  invites,
  supplier_emissions,
  idea_imports,
  idea_factors,
  scope3_category_methods,
  reduction_targets,
  reduction_target_years
from anon, authenticated;

-- 上は今ある分の剥奪でしかない。default privileges を残したままだと、テーブルを追加したときに
-- ここへの追記を忘れるだけで anon / authenticated に ALL が付き、GRANT 側の防御が外れる。
-- 以後 public に作られるオブジェクトには自動付与が効かないようにして、既定を拒否側に倒しておく。
-- 自動付与の有無は CLI / クラウドの版でも変わる（config.toml の [api] auto_expose_new_tables）ため、
-- どの版でも同じ状態に落ち着くよう明示的に剥奪する。service_role へは 4.4 で別に与える。
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- 関数は PUBLIC への EXECUTE が PostgreSQL 組み込みの既定で、スキーマ単位の default privileges からは外せない
-- （スキーマ指定は組み込み既定に足し込まれるだけで、そこから引くことはできない）。ここで消せるのは
-- anon / authenticated への明示付与だけなので、関数ごとの revoke execute … from public は 20260831000002_rpc.sql
-- の書き方を続けること。
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- 新しいテーブルは、必要な権限だけを 4.2 / 4.3 の要領で grant すること（書かなければ anon / authenticated からは触れない）。

-- 4.2 authenticated への最小権限

-- organizations: apiKeyHash を一般メンバーに見せないための列指定。列を追加したら GRANT も追加すること（自動では見えない）。
grant select (
  id,
  name,
  "createdAt",
  "updatedAt",
  "corporateNumber",
  "industrySector",
  address,
  "envManagerName",
  "fiscalYearStartMonth"
) on organizations to authenticated;
grant update (
  name,
  "corporateNumber",
  "industrySector",
  address,
  "envManagerName",
  "fiscalYearStartMonth"
) on organizations to authenticated;

-- profiles: role / organizationId / email は自己更新不可（列 GRANT から外す）。
grant select on profiles to authenticated;
grant update ("fullName", phone) on profiles to authenticated;

grant select on fiscal_years to authenticated;

grant select, insert, update, delete on
  suppliers,
  locations,
  emission_factors,
  activity_records,
  scope3_category_emissions
to authenticated;

-- 算定結果 3 本は読み取りのみ（§3 の同名テーブルのポリシーと対）。書き込みは service_role 経由の
-- run_calculation_commit / create_calculation_batch_with_rate_limit / refresh_dashboard_aggregates だけを通す。
-- ポリシーと GRANT はどちらか一方でも欠ければ書き込みは通らないが、権限表だけを見た読み手が
-- 「書けるが行が絞られている」と誤読しないよう両方を閉じる。
grant select on
  calculation_batches,
  emission_results,
  dashboard_aggregates
to authenticated;

grant select, insert on system_audit_logs to authenticated;

-- 4.3 RLS 側でも絞るテーブル群（4.1 で revoke 済みのため、以下の grant がそのまま実効権限になる）。
-- anon にはどのテーブルにも付与しない（ポリシーも無いため全拒否）。

-- invites: 列指定 INSERT は token・expiresAt・acceptedAt を列 default に、invitedByUserId をトリガーに任せる意図。
-- SELECT は organizations の apiKeyHash と違って列を絞らず、招待リンクの秘密である token も含める。これは意図的:
--   * createInvite の insert … returning token、revokeInvite の delete … where token = $1 returning token
--     （DELETE は条件で読む列にも SELECT 権限が要る）、未受諾一覧からのリンク再コピーが、いずれも
--     authenticated セッションで token を読む。列から外すとこの3フローが service_role 頼みになり、
--     RLS による防御をアプリ側の自前チェックへ格下げすることになる。
--   * token を admin だけに見せる防壁は列 GRANT ではなく invites_select_own_organization_admin（§3）。
--     current_user_is_admin() がスタブ（常に true）の間は自組織の認証ユーザー全員が読めるが、ロール制を
--     有効化すると同ポリシーにより一般メンバーは invites を1行も取れなくなり、この列 GRANT は冗長になる。
--     つまりロール制の有効化はこの可視性を「塞ぐ」側で、昇格経路を開くわけではない。→ #408
grant select on invites to authenticated;
grant insert ("organizationId", email, role) on invites to authenticated;
grant delete on invites to authenticated;
grant select, insert, update, delete on invites to service_role;

grant select, insert, update, delete on supplier_emissions to authenticated;
grant select, insert, update, delete on supplier_emissions to service_role;

grant select on idea_imports to authenticated;
grant select on idea_factors to authenticated;
grant select, insert, update, delete on idea_imports to service_role;
grant select, insert, update, delete on idea_factors to service_role;
grant select, insert, update, delete on scope3_category_methods to authenticated;
grant select, insert, update, delete on scope3_category_methods to service_role;

grant select, insert, update, delete on reduction_targets to authenticated;
grant select, insert, update, delete on reduction_targets to service_role;
grant select, insert, update, delete on reduction_target_years to authenticated;
grant select, insert, update, delete on reduction_target_years to service_role;

-- 4.4 service_role: 今後追加されるテーブル / シーケンスにも default privileges で自動付与する（BYPASSRLS のため RLS には影響しない）。
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
