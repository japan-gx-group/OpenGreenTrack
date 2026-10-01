-- SSBJ 開示レポート（試行版 R1）: 四本柱と企業固有の補足の文章（T05。docs/ssbj-spec.md §3〜§5・§10）。
--
-- 要求項目マスター（src/features/ssbj/utils/requirementMaster.ts）の文章の項目ごとに、開示する文章と内部メモを持つ。
-- 1 つの項目で複数の要求（一般開示基準と気候関連開示基準の同じ趣旨の要求）に答えるため、要求 ID ではなく項目 ID で持つ。
-- 項目 ID がマスターにあるかはアプリで検証する（マスターはコードの定数で、DB からは見えないため）。DB は形式だけを検証する。
-- 保存版への取り込みは ssbj_snapshot_section__narratives（§10 の命名規約）で行い、版生成 RPC は変更しない。

-- §1 テーブル

create table ssbj_narratives (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  -- 項目 ID（§3。src/features/ssbj/utils/ids.ts の SSBJ_ITEM_ID_PATTERN と同じ形式）。
  "itemId" varchar(100) not null,
  -- 開示する文章（§4 の状態＋値の対）と内部記録（§5。開示欄には出さない）。
  "disclosureState" ssbj_field_state not null default 'unanswered',
  "disclosureText" text,
  "internalNote" text,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_narratives_report_item_key unique ("reportId", "itemId"),
  constraint ssbj_narratives_item_id_format check (
    "itemId" ~ '^(governance|strategy|risk_management|metrics_targets)\.[a-z0-9_]+$'
  ),
  constraint ssbj_narratives_disclosure_state check (
    ("disclosureState" = 'answered' and "disclosureText" is not null and btrim("disclosureText") <> '')
    or ("disclosureState" <> 'answered' and "disclosureText" is null)
  )
);

comment on table ssbj_narratives is
  'SSBJ レポートの四本柱と企業固有の補足の文章（作業中データ。レポートと項目 ID の組ごとに 1 行）。'
  '保存版には ssbj_snapshot_section__narratives で取り込む（docs/ssbj-spec.md §8・§10）。';
comment on column ssbj_narratives."itemId" is
  '要求項目マスターの文章の項目 ID（例 governance.oversight_body）。マスターにあるかはアプリが検証する。';
comment on column ssbj_narratives."internalNote" is '内部の検討メモ。開示しない（§5）。';

-- §2 トリガー

create trigger set_ssbj_narratives_actor
before insert or update on ssbj_narratives
for each row execute function set_row_actor();

create trigger set_ssbj_narratives_updated_at
before update on ssbj_narratives
for each row execute function set_updated_at();

-- 作業中データの変更を ssbj_reports.draftRevision に反映する（§10 の手順2）。
create trigger bump_ssbj_narratives_draft_revision
after insert or update or delete on ssbj_narratives
for each row execute function bump_ssbj_draft_revision();

-- §3 RLS
-- レポートの組織帰属は FK では担保できない（FK は行の存在しか見ない）ため exists で検証する（§10 の手順1）。

alter table ssbj_narratives enable row level security;

create policy "ssbj_narratives_select_own_organization"
on ssbj_narratives
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_narratives_insert_own_organization"
on ssbj_narratives
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

create policy "ssbj_narratives_update_own_organization"
on ssbj_narratives
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

create policy "ssbj_narratives_delete_own_organization"
on ssbj_narratives
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- §4 GRANT
-- insert / update は列指定にする: id・監査列・日時は DB が決め、組織・レポート・項目は作成時にだけ指定できる
-- （作成後に別のレポート・項目へ付け替えると、そのレポートの保存版・draftRevision と食い違うため）。

grant select, delete on ssbj_narratives to authenticated;
grant insert (
  "organizationId",
  "reportId",
  "itemId",
  "disclosureState",
  "disclosureText",
  "internalNote"
) on ssbj_narratives to authenticated;
grant update (
  "disclosureState",
  "disclosureText",
  "internalNote"
) on ssbj_narratives to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。

-- §5 保存版セクション（§10 の手順3）
-- create_ssbj_report_version が名前（ssbj_snapshot_section__<key>）で自動収集し、snapshot.sections.narratives に入れる。
-- 形は src/features/ssbj/types.ts の SsbjNarrative[]（項目 ID の順）。行の無い項目は含めない（表示側がマスターの全項目を並べ、未入力と出す）。

create function ssbj_snapshot_section__narratives(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'itemId', n."itemId",
        'text', jsonb_build_object(
          'disclosure', ssbj_field_value_json(n."disclosureState", n."disclosureText"),
          'internalNote', n."internalNote"
        )
      ) order by n."itemId"
    ),
    '[]'::jsonb
  )
  from ssbj_narratives n
  where n."reportId" = p_report_id;
$$;

comment on function ssbj_snapshot_section__narratives(uuid) is
  '保存版の sections.narratives。create_ssbj_report_version が自動収集する（docs/ssbj-spec.md §10）。service_role 限定。';

revoke execute on function ssbj_snapshot_section__narratives(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__narratives(uuid) to service_role;
