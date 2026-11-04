-- TNFD 開示レポート（試行版 R1）: レポート本体と基本情報（docs/tnfd-spec.md §3・§7.3）。
--
-- レポートは組織と算定年度に必ず結び付き、後続の機能（文章・コア指標・拠点の自然関連情報・保存版 …）は
-- すべて tnfd_reports.id から組織・年度を辿る。版管理の列（draftRevision）と保存版のテーブルは
-- 保存機能（TN-03）のマイグレーションが追加する（作成・識別 → 保存・版生成 の一方向の依存を保つため、ここには置かない）。
-- R1 ではレポートの削除を提供しないため、delete のポリシーと GRANT は作らない。
-- ssbj_reports（20260927170328_ssbj_reports.sql）を写しているが、TNFD は組織 × 算定年度につき 1 件だけ
-- 作れる点が違う（docs/tnfd-spec.md §2。SSBJ は同じ年度に複数作れる）。

-- §1 テーブル

create table tnfd_reports (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  -- 年度は on delete の指定なし（no action）。年度削除でレポートが連鎖削除されないようにする。
  -- restrict にしないのは、組織削除（デモ seed の再投入を含む）で fiscal_years と tnfd_reports が
  -- 同じ文の中で連鎖削除されるとき、restrict は即時に検査して失敗しうるため（no action は文の終わりに検査する）。
  -- アプリからの年度削除は src/features/settings/services/fiscalYears.ts の参照チェックで先に止める。
  "fiscalYearId" uuid not null references fiscal_years(id),
  title varchar(200) not null,
  purpose text,
  "reportingScope" text,
  "standardVersion" varchar(100),
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint tnfd_reports_title_not_blank check (btrim(title) <> ''),
  -- 組織 × 算定年度につき 1 件（docs/tnfd-spec.md §2）。後続機能が「その年度の TNFD レポート」を一意に辿れるようにする。
  constraint tnfd_reports_organization_fiscal_year_key unique ("organizationId", "fiscalYearId")
);

comment on table tnfd_reports is
  'TNFD 開示レポート（試行版 R1）の本体と基本情報。社内確認用であり、TNFD 提言への準拠や対外提出を保証しない。'
  '仕様は docs/tnfd-spec.md。';
comment on column tnfd_reports.purpose is '作成目的（任意）。';
comment on column tnfd_reports."reportingScope" is '報告範囲・対象範囲（任意。例: 単体 / 主要な事業所）。';
comment on column tnfd_reports."standardVersion" is '参照する基準の版（任意。例: Recommendations of the TNFD, October 2026）。';

-- 組織 × 年度の引き当ては unique 制約の索引が担う。
-- 年度の参照チェック（fiscal_years の削除可否）と外部キー検査のため、年度単独でも引けるようにする。
create index tnfd_reports_fiscal_year_idx
  on tnfd_reports ("fiscalYearId");

-- §2 トリガー
-- 同一イベントの before トリガーは名前順に起動する（set_tnfd_reports_actor → set_tnfd_reports_updated_at）。

create trigger set_tnfd_reports_actor
before insert or update on tnfd_reports
for each row execute function set_row_actor();

create trigger set_tnfd_reports_updated_at
before update on tnfd_reports
for each row execute function set_updated_at();

-- §3 RLS

alter table tnfd_reports enable row level security;

create policy "tnfd_reports_select_own_organization"
on tnfd_reports
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- 年度の組織帰属は FK では担保できない（FK は行の存在しか見ない）ため exists で検証する。
-- 検証を落とすと、PostgREST を直接叩いて他組織の年度に結び付いた自組織のレポートを作れてしまう
-- （ssbj_reports・activity_records の検証と同じ理由）。
create policy "tnfd_reports_insert_own_organization"
on tnfd_reports
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

-- 更新できる列は §4 の列 GRANT で基本情報だけに絞っている（組織・年度は作成後に変えない）。
-- with check でも年度の帰属を検証し、GRANT 側が将来広げられても他組織の年度を指せないようにする。
create policy "tnfd_reports_update_own_organization"
on tnfd_reports
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

-- §4 GRANT
-- 20260831000001_rls.sql §4.1 の default privileges により、新しいテーブルは明示しない限り
-- anon / authenticated から触れない。必要な権限だけを付与する。
-- insert / update は列指定にする: id・監査列・日時は DB（default・トリガー）が決め、
-- 組織と年度は作成時にだけ指定できる（作成後に年度を付け替えると、後続機能が採用した
-- その年度の OGT 値や保存版と食い違うため）。

grant select on tnfd_reports to authenticated;
grant insert (
  "organizationId",
  "fiscalYearId",
  title,
  purpose,
  "reportingScope",
  "standardVersion"
) on tnfd_reports to authenticated;
grant update (
  title,
  purpose,
  "reportingScope",
  "standardVersion"
) on tnfd_reports to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。
