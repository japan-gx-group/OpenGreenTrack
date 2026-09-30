-- SSBJ 開示レポート（試行版 R1）: OGT の候補値の明示採用（docs/ssbj-spec.md §7・§8・§10）。
--
-- 利用者が「GHG排出量の候補値」画面で確認した候補値を、明示の操作でレポートに採用する。
-- 採用値は OGT の元データ（dashboard_aggregates など）から複写して持ち、OGT で算定し直しても上書きしない
-- （保存版には ssbj_snapshot_section__ghg で取り込む）。
--
-- 改ざん防止: authenticated には select と delete（採用の取り消し）だけを許し、insert / update は許さない。
-- 書き込みは、サーバ（Route Handler）が OGT から候補値を取り直してから呼ぶ service_role 限定の
-- adopt_ssbj_ogt_values だけで行う。クライアントが送った数値を OGT 由来として保存する経路を作らないため。

-- §1 テーブル

create table ssbj_ogt_adoptions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  -- レポートごとに 1 行。採用し直すと行を置き換える（Scope 合計とカテゴリ別の値を同じ時点にそろえるため）。
  "reportId" uuid not null unique references ssbj_reports(id) on delete cascade,
  -- OgtAdoptedValue[]（src/features/ssbj/types.ts）。数値は十進文字列のまま持つ（§6）。
  "adoptedValues" jsonb not null,
  -- OgtSupplierReference[]。参考値で、合計には足さない（§7.2）。
  "supplierReferences" jsonb not null default '[]'::jsonb,
  "adoptedAt" timestamptz not null,
  "adoptedByUserId" uuid not null,
  constraint ssbj_ogt_adoptions_adopted_values_is_array check (jsonb_typeof("adoptedValues") = 'array'),
  constraint ssbj_ogt_adoptions_supplier_references_is_array check (jsonb_typeof("supplierReferences") = 'array')
);

comment on table ssbj_ogt_adoptions is
  'SSBJ レポートに明示採用した OGT の値（作業中データ。レポートごとに 1 行）。書き込みは adopt_ssbj_ogt_values（service_role 限定）だけ。'
  '保存版には ssbj_snapshot_section__ghg で取り込む（docs/ssbj-spec.md §7・§10）。';
comment on column ssbj_ogt_adoptions."adoptedValues" is
  'OgtAdoptedValue[]。候補値に採用日時・採用者を付けたもの。OGT の元データが変わっても書き換えない。';

-- §2 トリガー

-- 作業中データの変更を ssbj_reports.draftRevision に反映する（§10 の手順2）。
create trigger bump_ssbj_ogt_adoptions_draft_revision
after insert or update or delete on ssbj_ogt_adoptions
for each row execute function bump_ssbj_draft_revision();

-- §3 RLS

alter table ssbj_ogt_adoptions enable row level security;

create policy "ssbj_ogt_adoptions_select_own_organization"
on ssbj_ogt_adoptions
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- 取り消し（削除）は値を作らないため、画面から直接行ってよい。
create policy "ssbj_ogt_adoptions_delete_own_organization"
on ssbj_ogt_adoptions
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- §4 GRANT
-- insert / update は付与しない（上の改ざん防止）。service_role へは 20260831000001_rls.sql §4.4 の
-- default privileges で自動付与される。

grant select, delete on ssbj_ogt_adoptions to authenticated;

-- §5 採用 RPC（Route Handler から service_role で呼ぶ）
-- p_candidates はサーバが OGT から取り直した OgtCandidateValue[]。採用日時・採用者はここで付ける
-- （行の "adoptedAt" と各値の adoptedAt を同じ時刻にそろえるため）。
-- 組織・年度の一致は service_role が RLS を越えるためここで検証する（Route Handler のバグで他組織に書かないため）。

create function adopt_ssbj_ogt_values(
  p_report_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_candidates jsonb,
  p_supplier_references jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fiscal_year_id uuid;
  v_adopted_at timestamptz := now();
  v_adopted_values jsonb;
begin
  select "fiscalYearId" into v_fiscal_year_id
  from ssbj_reports
  where id = p_report_id
    and "organizationId" = p_organization_id;

  if not found then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id
      using errcode = 'P2041';
  end if;

  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) = 0
     or jsonb_typeof(p_supplier_references) <> 'array' then
    raise exception '採用する候補値の形式が正しくありません'
      using errcode = 'P2042';
  end if;

  -- 候補値・参考値がすべてレポートの年度のものであること（別の年度の値を採用させない）。
  if exists (
    select 1 from jsonb_array_elements(p_candidates || p_supplier_references) as item(value)
    where item.value ->> 'fiscalYearId' is distinct from v_fiscal_year_id::text
  ) then
    raise exception '候補値の年度がレポートの年度と一致しません'
      using errcode = 'P2042';
  end if;

  select jsonb_agg(
    item.value || jsonb_build_object('adoptedAt', v_adopted_at, 'adoptedBy', p_actor_user_id)
    order by item.ordinality
  )
  into v_adopted_values
  from jsonb_array_elements(p_candidates) with ordinality as item(value, ordinality);

  insert into ssbj_ogt_adoptions
    ("organizationId", "reportId", "adoptedValues", "supplierReferences", "adoptedAt", "adoptedByUserId")
  values
    (p_organization_id, p_report_id, v_adopted_values, p_supplier_references, v_adopted_at, p_actor_user_id)
  on conflict ("reportId") do update set
    "adoptedValues" = excluded."adoptedValues",
    "supplierReferences" = excluded."supplierReferences",
    "adoptedAt" = excluded."adoptedAt",
    "adoptedByUserId" = excluded."adoptedByUserId";

  return jsonb_build_object('adoptedAt', v_adopted_at);
end;
$$;

comment on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb) is
  'サーバが OGT から取り直した候補値をレポートに採用する（採用し直すと置き換える）。service_role 限定。'
  'P2041 = レポートが無い・組織不一致、P2042 = 候補値の形式・年度が不正。';

revoke execute on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- §6 保存版セクション（§10 の手順3）
-- create_ssbj_report_version が名前で自動収集し、snapshot.sections.ghg に入れる。
-- 形は src/features/ssbj/types.ts の SsbjGhgAdoption。採用していないレポートは null（未採用と欠落を区別するため）。

create function ssbj_snapshot_section__ghg(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'adoptedAt', a."adoptedAt",
    'adoptedBy', a."adoptedByUserId",
    'values', a."adoptedValues",
    'supplierReferences', a."supplierReferences"
  )
  from ssbj_ogt_adoptions a
  where a."reportId" = p_report_id;
$$;

comment on function ssbj_snapshot_section__ghg(uuid) is
  '保存版の sections.ghg。create_ssbj_report_version が自動収集する（docs/ssbj-spec.md §10）。service_role 限定。';

revoke execute on function ssbj_snapshot_section__ghg(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__ghg(uuid) to service_role;
