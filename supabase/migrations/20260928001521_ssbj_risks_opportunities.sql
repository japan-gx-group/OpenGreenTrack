-- SSBJ 開示レポート（試行版 R1）: リスク・機会（docs/ssbj-spec.md §3〜§5・§10）。
--
-- 1 つのレポートに複数のリスク・機会を登録し、説明・時間軸・章 / 項目への関連を持つ。
-- 保存版への取り込みは ssbj_snapshot_section__risks_opportunities（§10 の命名規約）で行い、
-- 版生成 RPC（create_ssbj_report_version）は変更しない。
--
-- 区分の持ち方: kind（リスク / 機会）と timeHorizon（短期 / 中期 / 長期）は enum ではなく check 制約にする。
-- 時間軸は初回レポート例の合意待ちの仮置き（§12）で、区分の追加・変更を新しいマイグレーションで
-- 制約の張り替えだけで済ませられるようにするため（enum は値の削除・改名ができない）。
-- リスクの分類（物理的 / 移行 など）は方針が未確定のため持たない。決まったら NULL 可の列として追加する。

-- §1 テーブル

create table ssbj_risks_opportunities (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  kind varchar(20) not null,
  title varchar(200) not null,
  -- 開示する説明文（§4 の状態＋値の対）と内部記録（§5。開示欄には出さない）。
  "descriptionState" ssbj_field_state not null default 'unanswered',
  "descriptionText" text,
  "internalNote" text,
  "timeHorizonState" ssbj_field_state not null default 'unanswered',
  "timeHorizon" varchar(20),
  -- 関連する章 ID または項目 ID（§3 の形式）。章だけに関連付ける場合は章 ID、項目まで決まっていれば項目 ID。
  -- 章を別の列で持たないのは、項目 ID の接頭辞と食い違わせないため（§3）。
  "linkTargets" text[] not null default '{}',
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_risks_opportunities_kind_check check (kind in ('risk', 'opportunity')),
  constraint ssbj_risks_opportunities_title_not_blank check (btrim(title) <> ''),
  constraint ssbj_risks_opportunities_description_state_check check (
    ("descriptionState" = 'answered' and "descriptionText" is not null and btrim("descriptionText") <> '')
    or ("descriptionState" <> 'answered' and "descriptionText" is null)
  ),
  constraint ssbj_risks_opportunities_time_horizon_check check (
    "timeHorizon" in ('short_term', 'medium_term', 'long_term')
  ),
  constraint ssbj_risks_opportunities_time_horizon_state_check check (
    ("timeHorizonState" = 'answered' and "timeHorizon" is not null)
    or ("timeHorizonState" <> 'answered' and "timeHorizon" is null)
  ),
  -- 各要素が章 ID / 項目 ID の形式であること（正規表現は src/features/ssbj/utils/ids.ts と同じ）。
  -- array_to_string は NULL 要素を読み飛ばすため、NULL 要素は別に拒否する。
  constraint ssbj_risks_opportunities_link_targets_check check (
    array_position("linkTargets", null) is null
    and (
      cardinality("linkTargets") = 0
      or array_to_string("linkTargets", ',') ~
        '^(governance|strategy|risk_management|metrics_targets)(\.[a-z0-9_]+)?(,(governance|strategy|risk_management|metrics_targets)(\.[a-z0-9_]+)?)*$'
    )
  )
);

comment on table ssbj_risks_opportunities is
  'SSBJ 開示レポートのリスク・機会（作業中データ）。変更のたびに ssbj_reports.draftRevision を進め、'
  '保存版には ssbj_snapshot_section__risks_opportunities で取り込む（docs/ssbj-spec.md §8・§10）。';
comment on column ssbj_risks_opportunities."timeHorizon" is
  '短期 / 中期 / 長期（short_term / medium_term / long_term）。各区分の期間の定義は持たない（仮置き）。';
comment on column ssbj_risks_opportunities."linkTargets" is
  '関連する章 ID（例 strategy）または項目 ID（例 strategy.climate_resilience）の配列。';

create index ssbj_risks_opportunities_report_idx
  on ssbj_risks_opportunities ("reportId", "createdAt");

-- §2 トリガー

create trigger set_ssbj_risks_opportunities_actor
before insert or update on ssbj_risks_opportunities
for each row execute function set_row_actor();

create trigger set_ssbj_risks_opportunities_updated_at
before update on ssbj_risks_opportunities
for each row execute function set_updated_at();

-- 作業中データの変更を ssbj_reports.draftRevision に反映する（§10 の手順2）。
create trigger bump_ssbj_risks_opportunities_draft_revision
after insert or update or delete on ssbj_risks_opportunities
for each row execute function bump_ssbj_draft_revision();

-- §3 RLS
-- レポートの組織帰属は FK では担保できない（FK は行の存在しか見ない）ため exists で検証する（§10 の手順1）。

alter table ssbj_risks_opportunities enable row level security;

create policy "ssbj_risks_opportunities_select_own_organization"
on ssbj_risks_opportunities
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_risks_opportunities_insert_own_organization"
on ssbj_risks_opportunities
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId"
      and r."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_risks_opportunities_update_own_organization"
on ssbj_risks_opportunities
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId"
      and r."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_risks_opportunities_delete_own_organization"
on ssbj_risks_opportunities
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- §4 GRANT
-- insert / update は列指定にする: id・監査列・日時は DB が決め、組織とレポートは作成時にだけ指定できる
-- （作成後に別のレポートへ付け替えると、そのレポートの保存版・draftRevision と食い違うため）。

grant select, delete on ssbj_risks_opportunities to authenticated;
grant insert (
  "organizationId",
  "reportId",
  kind,
  title,
  "descriptionState",
  "descriptionText",
  "internalNote",
  "timeHorizonState",
  "timeHorizon",
  "linkTargets"
) on ssbj_risks_opportunities to authenticated;
grant update (
  kind,
  title,
  "descriptionState",
  "descriptionText",
  "internalNote",
  "timeHorizonState",
  "timeHorizon",
  "linkTargets"
) on ssbj_risks_opportunities to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。

-- §5 保存版セクション（§10 の手順3）
-- create_ssbj_report_version が名前（ssbj_snapshot_section__<key>）で自動収集し、snapshot.sections.risks_opportunities に入れる。
-- 形は src/features/ssbj/types.ts の SsbjRiskOpportunity[]（値の状態は SsbjFieldValue と同じ { state, value? }）。

create function ssbj_snapshot_section__risks_opportunities(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ro.id,
        'kind', ro.kind,
        'title', ro.title,
        'description', jsonb_build_object(
          'disclosure',
          case when ro."descriptionState" = 'answered'
            then jsonb_build_object('state', ro."descriptionState", 'value', ro."descriptionText")
            else jsonb_build_object('state', ro."descriptionState")
          end,
          'internalNote', ro."internalNote"
        ),
        'timeHorizon',
        case when ro."timeHorizonState" = 'answered'
          then jsonb_build_object('state', ro."timeHorizonState", 'value', ro."timeHorizon")
          else jsonb_build_object('state', ro."timeHorizonState")
        end,
        'linkTargets', to_jsonb(ro."linkTargets")
      )
      order by ro."createdAt", ro.id
    ),
    '[]'::jsonb
  )
  from ssbj_risks_opportunities ro
  where ro."reportId" = p_report_id;
$$;

comment on function ssbj_snapshot_section__risks_opportunities(uuid) is
  '保存版の sections.risks_opportunities。create_ssbj_report_version が自動収集する（docs/ssbj-spec.md §10）。service_role 限定。';

revoke execute on function ssbj_snapshot_section__risks_opportunities(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__risks_opportunities(uuid) to service_role;
