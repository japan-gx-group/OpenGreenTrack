-- OpenGreenTrack v1.0 初期スキーマ (1/4): スキーマ
-- public スキーマの土台: extension（pgcrypto）/ enum 型 12 / テーブル 20（制約・インデックス・comment on は各テーブル直下）/ トリガー関数 6 + トリガー 20。
-- §1 列挙型  §2 組織・認証  §3 拠点・会計年度  §4 活動量・排出係数・算定結果  §5 Scope3・IDEA  §6  削減目標  §7 監査ログ  §8 トリガー関数とトリガー
-- 適用順: 本ファイル → 20260831000001_rls.sql → 20260831000002_rpc.sql → 20260831000003_storage.sql。データ（公式係数・デモ）は supabase/seeds/ から投入する。
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。storage.buckets の定義のみ例外）

create extension if not exists "pgcrypto";

-- §1 列挙型
-- enum 値は削除不可。値追加（alter type … add value）は同一トランザクション内で新値を使えないため、新値を使う DDL・seed とは別ファイルにする。

create type "Scope" as enum (
  'scope1',
  'scope2',
  'scope3'
);

-- scope3_activity は Scope3 積上げ（IDEA 連携）専用。係数作成 UI・係数 CSV 取込の種別候補からは除外する（カスタム係数が積上げ行に自動マッチする経路を塞ぐ）。
create type "EnergyType" as enum (
  'electricity',
  'city_gas',
  'fuel_heavy_oil',
  'fuel_diesel',
  'water',
  'freight_transport',
  'business_travel',
  'waste',
  'fuel',
  'vehicle',
  'logistics',
  'business_travel_commuting',
  'purchased_goods_services',
  'supplier_data',
  'fuel_gasoline',
  'fuel_kerosene',
  'fuel_crude_oil',
  'fuel_naphtha',
  'fuel_jet',
  'fuel_lpg',
  'fuel_lng',
  'fuel_natural_gas',
  'fuel_coal',
  'heat',
  'scope3_activity'
);

-- 活動量の入力経路。現在は画面からの手入力のみ。
create type "SourceType" as enum (
  'manual'
);

-- 非同期バッチ（算定）の進行状態。
create type "BatchStatus" as enum (
  'pending',
  'completed',
  'failed'
);

create type "Region" as enum (
  'Hokkaido',
  'Tohoku',
  'Kanto',
  'Chubu',
  'Kansai',
  'Chugoku_Shikoku',
  'Kyushu',
  'Overseas'
);

create type "LocationType" as enum (
  'headquarters',
  'branch',
  'factory',
  'office',
  'logistics',
  'service',
  'other'
);

create type "LocationStatus" as enum (
  'active',
  'paused',
  'preparing',
  'closing'
);

create type "FactorSource" as enum (
  'moe',
  'meti',
  'ketsoho',
  'utility',
  'custom'
);

create type "FactorStatus" as enum (
  'active',
  'pending_review',
  'draft',
  'archived'
);

create type "FactorType" as enum (
  'basic',
  'adjusted'
);

create type "IdeaImportStatus" as enum (
  'processing',
  'completed',
  'failed'
);

-- 将来 'hybrid' を値追加で拡張可能（docs/IDEA連携Scope3算定仕様.md §8-6）
create type "Scope3Method" as enum (
  'direct',
  'calculated'
);

-- §2 組織・認証
-- organizationId の索引は RLS がほぼ全クエリに組織条件を付けるため（unique の先頭列で代替できる表では省く）。

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,
  -- 外部 API 連携鍵のハッシュ。authenticated には列 GRANT で晒さない。
  "apiKeyHash" varchar(255) not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "corporateNumber" varchar(13),
  "industrySector" varchar(100),
  address varchar(255),
  "envManagerName" varchar(100),
  "fiscalYearStartMonth" smallint,
  constraint organizations_fiscal_start_month_check
    check ("fiscalYearStartMonth" is null or ("fiscalYearStartMonth" between 1 and 12))
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  "organizationId" uuid not null references organizations(id) on delete cascade,
  email varchar(255) not null,
  "fullName" varchar(100),
  -- 現状は RLS・アプリとも role で権限判定はしない（ロール別権限の導入に備えた列。invites.role も同じ語彙）。
  role varchar(50) not null default 'logger',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  phone varchar(20),
  constraint profiles_role_check check (role in ('admin', 'logger', 'viewer'))
);

create unique index profiles_organization_email_idx
  on profiles ("organizationId", email);

-- 招待リンク（/invite/[token]）の受け皿。受諾（acceptedAt の更新）は service_role のサーバ処理のみ。
create table invites (
  token uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  email varchar(255) not null,
  role varchar(50) not null default 'logger',
  "invitedByUserId" uuid references auth.users(id) on delete set null,
  "expiresAt" timestamptz not null default (now() + interval '7 days'),
  "acceptedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  constraint invites_role_check check (role in ('admin', 'logger', 'viewer'))
);

create unique index invites_org_email_pending_idx
  on invites ("organizationId", email)
  where "acceptedAt" is null;

create index "invites_organizationId_idx" on invites ("organizationId");

-- §3 拠点・会計年度

-- organizationId の索引は無い（拠点数は少ない前提）。
create table locations (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  name varchar(100) not null,
  region "Region" not null,
  type "LocationType" not null,
  "managerName" varchar(100),
  "managerUserId" uuid,
  scopes "Scope"[] not null default '{}',
  status "LocationStatus" not null default 'preparing',
  prefecture varchar(50),
  address varchar(255),
  "isAggregationTarget" boolean not null default true,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- 会計年度は組織別（期首月が組織ごとの設定のため。共通にすると他組織の年度が見える）。
create table fiscal_years (
  id uuid primary key default gen_random_uuid(),
  label varchar(50) not null,
  "startDate" date not null,
  "endDate" date not null,
  "createdAt" timestamptz not null default now(),
  "organizationId" uuid references organizations(id) on delete cascade
);

comment on column fiscal_years."organizationId" is
  '会計年度を所有する組織ID。NULL の行（どの組織にも属さない年度）は RLS 上誰にも公開しない。';

create index fiscal_years_organization_id_idx
  on fiscal_years ("organizationId");

-- 同じ期間の年度行が併存し得るため UNIQUE にしない（重複抑止はアプリ側）。
create index fiscal_years_organization_period_idx
  on fiscal_years ("organizationId", "startDate", "endDate");

-- §4 活動量・排出係数・算定結果

-- organizationId = null は全組織共通の公式係数（seeds で投入。authenticated からは読み取り専用）。組織 ID が入る行は自組織のカスタム係数（isCustom = true）。
create table emission_factors (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid references organizations(id) on delete cascade,
  name varchar(200) not null,
  "energyType" "EnergyType" not null,
  scope "Scope" not null,
  "factorValue" numeric(12, 6) not null,
  unit varchar(50) not null,
  "applicableYear" integer not null,
  "regionName" varchar(100) not null,
  source "FactorSource" not null,
  status "FactorStatus" not null default 'draft',
  "isCustom" boolean not null default false,
  -- cascade（set null にしない）: locationId / supplierId とも null は「組織全体（tier 3）」の判定条件のため、set null だと親削除で拠点専用係数が組織全体へ昇格し他拠点を過小算定する。
  "locationId" uuid references locations(id) on delete cascade,
  "supplierId" uuid,
  "effectiveFrom" date,
  "effectiveTo" date,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "sourceDocumentName" varchar(300),
  "sourceUrl" text,
  "providerName" varchar(200),
  "providerNumber" varchar(20),
  "menuName" varchar(200),
  "factorType" "FactorType"
);

comment on column emission_factors."sourceDocumentName" is '出典となる公表資料名（発行元＝source, 年度＝applicableYear と併せて出典を構成する）';
comment on column emission_factors."sourceUrl" is '出典資料の公開URL。画面から新しいタブで参照する。';
comment on column emission_factors."providerName" is '供給事業者名（事業者別排出係数のみ設定。null = 事業者に紐づかない係数）';
comment on column emission_factors."providerNumber" is '公表資料上の事業者登録番号（電気/ガス: A0002 等、熱: 006 等）';
comment on column emission_factors."menuName" is 'メニュー名・供給区域・地区名（事業者内の係数区分）';
comment on column emission_factors."factorType" is 'basic=基礎排出係数 / adjusted=調整後排出係数 / null=区分なし（燃料・Scope3・カスタム）';

create index "emission_factors_organizationId_idx" on emission_factors ("organizationId");

-- 手動入力画面の事業者検索用。
create index emission_factors_provider_idx
  on emission_factors ("energyType", "applicableYear", "providerName");

-- V-FAC-002: 同一 key（年度 + エネルギー + 地域 + scope）の active カスタム係数は 1 件のみ。公式係数（同 key に複数行あり得る）は対象外。
-- effectiveFrom / effectiveTo は UI / CSV に入力欄が無いため key に含めない。係数解決は scope を見ないため scope 違いのカスタム係数は tier 3 候補に並び得る。
-- 組織全体カスタム係数（tier 3: locationId / supplierId とも null が判定条件）。
create unique index emission_factors_active_custom_org_key_idx
  on emission_factors ("organizationId", "applicableYear", "energyType", "regionName", scope)
  where
    status = 'active'
    and "organizationId" is not null
    and "isCustom" = true
    and "providerName" is null
    and "locationId" is null
    and "supplierId" is null;

-- 拠点固有カスタム係数（tier 1）。判定は locationId のみで supplierId を見ないため key にも含めない（tier 2 導入時は要見直し）。
create unique index emission_factors_active_custom_location_key_idx
  on emission_factors ("organizationId", "locationId", "applicableYear", "energyType", "regionName", scope)
  where
    status = 'active'
    and "organizationId" is not null
    and "isCustom" = true
    and "providerName" is null
    and "locationId" is not null;

-- 事業者に紐づかない utility 公式係数の予防線（対象行 0 件が前提。seed の重複検知用で V-FAC-002 の担保ではない）。
create unique index emission_factors_active_official_utility_key_idx
  on emission_factors ("applicableYear", "energyType", "regionName", scope)
  where
    status = 'active'
    and "organizationId" is null
    and "isCustom" = false
    and source = 'utility'
    and "providerName" is null;

create table activity_records (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "locationId" uuid not null references locations(id) on delete cascade,
  "sourceType" "SourceType" not null,
  "energyType" "EnergyType" not null,
  amount numeric(15, 3) not null,
  unit varchar(50) not null,
  "periodStart" date not null,
  "periodEnd" date not null,
  note varchar(500),
  "isCalculated" boolean not null default false,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "emissionFactorId" uuid references emission_factors(id) on delete set null,
  -- Scope3 積上げ（energyType = 'scope3_activity'）用。
  "scope3CategoryId" integer check ("scope3CategoryId" between 1 and 15),
  "ideaFactorId" uuid,
  constraint activity_records_idea_requires_category
    check ("ideaFactorId" is null or "scope3CategoryId" is not null)
);

comment on column activity_records."emissionFactorId" is
  '手動入力などで明示選択された排出係数ID。NULL なら算定時に優先順位で自動解決する。';

create index "activity_records_organizationId_idx" on activity_records ("organizationId");

create index activity_records_org_period_start_idx
  on activity_records ("organizationId", "periodStart");

create index activity_records_emission_factor_id_idx
  on activity_records ("emissionFactorId");

-- 二重計上防止トリガーの重複キー検索用。
create index activity_records_duplicate_lookup_idx
  on activity_records ("organizationId", "locationId", "energyType", "periodStart");

-- ideaFactorId は Scope1/2 行で常に null のため部分インデックス。
create index activity_records_idea_factor_idx
  on activity_records ("ideaFactorId") where "ideaFactorId" is not null;

create table calculation_batches (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "fiscalYearId" uuid not null references fiscal_years(id) on delete cascade,
  status "BatchStatus" not null default 'pending',
  "processedCount" integer not null default 0,
  "totalEmissionsDelta" numeric(15, 3) not null default 0.000,
  "errorMessage" text,
  "startedAt" timestamptz not null default now(),
  "completedAt" timestamptz
);

create index "calculation_batches_organizationId_idx" on calculation_batches ("organizationId");

-- 並行実行ガード（同じ未算定レコードの二重読み込みを入口で防ぐ）。
create unique index calculation_batches_one_pending_per_year
  on calculation_batches ("organizationId", "fiscalYearId")
  where status = 'pending';

-- レート制限 RPC の稼働中カウント用（pending を startedAt の時間窓で数える）。
create index calculation_batches_rate_limit_pending_idx
  on calculation_batches ("organizationId", "startedAt")
  where status = 'pending';

create index calculation_batches_rate_limit_recent_idx
  on calculation_batches ("organizationId", "startedAt");

create table emission_results (
  id uuid primary key default gen_random_uuid(),
  -- RLS の組織判定用に非正規化（Scope3 集計行は activityRecordId 等の FK を持たない場合がある）。
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "activityRecordId" uuid references activity_records(id) on delete cascade,
  "emissionFactorId" uuid references emission_factors(id) on delete set null,
  "batchId" uuid references calculation_batches(id) on delete set null,
  "locationId" uuid references locations(id) on delete cascade,
  scope "Scope" not null,
  "categoryId" integer,
  -- numeric(15,6): レコード単位の 1kg 丸めは Scope3 積上げで系統的過小計上になるため（仕様 §3.4）。
  emissions numeric(15, 6) not null,
  "calculatedAt" timestamptz not null default now(),
  "ideaFactorId" uuid,
  -- 監査用スナップショット: 参照先が版更新・削除されても適用時の内容を保持する
  "appliedFactorValue" numeric,
  "appliedFactorUnit" varchar(50),  -- 'kg-CO2e/' + unit varchar(30) = 最大38
  -- 長さは仕様 §4.3-4 の生成規則の最大長 444 から（短いと長い製品名で INSERT が全件ロールバックする）。
  "appliedFactorName" varchar(500),
  constraint emission_results_activity_record_unique unique ("activityRecordId")
);

create index "emission_results_organizationId_idx" on emission_results ("organizationId");
create index "emission_results_activityRecordId_idx" on emission_results ("activityRecordId");
create index "emission_results_locationId_idx" on emission_results ("locationId");

create index emission_results_batch_id_idx
  on emission_results ("batchId");

create index emission_results_idea_factor_idx
  on emission_results ("ideaFactorId") where "ideaFactorId" is not null;

-- 派生表。refresh_dashboard_aggregates が絶対値で再計算して upsert する。
create table dashboard_aggregates (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "fiscalYearId" uuid not null references fiscal_years(id) on delete cascade,
  "scope1Total" numeric(15, 3) not null default 0.000,
  "scope2Total" numeric(15, 3) not null default 0.000,
  "scope3Total" numeric(15, 3) not null default 0.000,
  "updatedAt" timestamptz not null default now(),
  unique ("organizationId", "fiscalYearId")
);

-- §5 Scope3・IDEA

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  name varchar(200) not null,
  "categoryId" integer not null,
  "primaryDataRate" numeric(5, 2) not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index "suppliers_organizationId_idx" on suppliers ("organizationId");

alter table emission_factors
  add constraint "emission_factors_supplierId_fkey"
    foreign key ("supplierId") references suppliers(id) on delete cascade;

create table supplier_emissions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "supplierId" uuid not null references suppliers(id) on delete cascade,
  -- 年度削除で実績を巻き込まないよう cascade を付けない。
  "fiscalYearId" uuid not null references fiscal_years(id),
  "categoryId" integer not null,
  emissions numeric not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("supplierId", "fiscalYearId", "categoryId")
);

create index supplier_emissions_organization_idx on supplier_emissions ("organizationId");
create index supplier_emissions_fiscal_year_idx on supplier_emissions ("fiscalYearId");

-- direct 方式の直接入力値。採用値は scope3_category_methods の方式適用後に決まる。
create table scope3_category_emissions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "fiscalYearId" uuid not null,
  "categoryId" integer not null,
  emissions numeric(15, 3) not null,
  "periodStart" date,
  "periodEnd" date,
  "dataSourceNote" varchar(500),
  "updatedAt" timestamptz not null default now(),
  constraint "scope3_category_emissions_organizationId_fiscalYearId_categ_key"
    unique ("organizationId", "fiscalYearId", "categoryId"),
  -- cascade は付けない: 年度削除時の保護はアプリ側（src/features/settings/services/fiscalYears.ts）が
  -- 参照の有無を確認して拒否する方針のため、DB 側は削除を restrict する既定のままにする。
  constraint scope3_category_emissions_fiscal_year_fkey
    foreign key ("fiscalYearId") references fiscal_years(id)
);

-- 行が無いカテゴリ × 年度の既定は 'direct'（仕様 §3.1）。
create table scope3_category_methods (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "fiscalYearId" uuid not null references fiscal_years(id),
  "categoryId" integer not null check ("categoryId" between 1 and 15),
  method "Scope3Method" not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint "scope3_category_methods_organizationId_fiscalYearId_categor_key"
    unique ("organizationId", "fiscalYearId", "categoryId")
);

-- IDEA 係数の取込単位（版）。ライセンスは法人単位のため組織ごとに保持し、グループ横断で共有しない。
create table idea_imports (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  version varchar(100) not null,              -- 例 'Ver.4.0 標準版'（バージョン情報シートから取得）
  "releaseDate" date,                          -- 例 2026-06-19
  "gwpModel" varchar(200) not null,            -- 採用した列識別子。例 '気候変動 IPCC 2021 GWP 100a without LULUCF'
  "citationText" text not null,                -- 引用表記（自動生成。レポート出典欄に表示）
  "fileName" varchar(300) not null,
  status "IdeaImportStatus" not null default 'processing',
  "rowCount" integer not null default 0,
  -- 既定 false: true で作ると旧 active 行と部分一意インデックスで衝突する。切替は complete_idea_import が旧行の false 化と同一トランザクションで行う（§4.1-3）。
  "isActive" boolean not null default false,
  "errorMessage" text,
  "importedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  -- 取込完了時に再選択が必要になった未算定明細の件数。ブラウザがポーリングして警告表示する（§3.6-2）。
  "unmappedRecordCount" integer not null default 0,
  "skippedRowCount" integer not null default 0
);

comment on column idea_imports."skippedRowCount" is
  'GWP値が空欄のため取込対象外にした行数（Scope3の原単位として使えない製品。エラーではない）';

create unique index idea_imports_one_active_per_org
  on idea_imports ("organizationId") where "isActive" = true;

-- 「処理中は組織あたり 1 件」。Route Handler（src/app/api/idea-imports/route.ts）は SELECT で進行中を
-- 確認してから INSERT するが、確認〜INSERT の間に別リクエストが割り込む窓が残る（同時に 2 つの
-- 数十 MB ファイルを解析してメモリを二重に使う）。INSERT 時点に 23505 を出し、409 として返させる。
create unique index idea_imports_one_processing_per_org
  on idea_imports ("organizationId") where status = 'processing';

create table idea_factors (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,  -- RLS用に非正規化
  "importId" uuid not null references idea_imports(id) on delete cascade,
  "ideaCode" varchar(30) not null,             -- 例 '011100000mJPN'（国コード含み一意）
  "productName" varchar(300) not null,
  country varchar(10) not null,                -- 'JPN' / 'GLO' 等
  "dbType" varchar(20) not null,               -- 'CORE' / 'GLO' 等
  "baseFlowAmount" numeric not null default 1, -- 基準フロー量（通常 1）
  unit varchar(30) not null,                   -- kg / kWh / 円 / t-km 等。'/' を含む値は取込エラーにする
  "gwpValue" numeric not null,                 -- kg-CO2e / 単位。無制約 numeric で原典精度を保持
  "createdAt" timestamptz not null default now(),
  -- 版更新時の未算定レコード再マッピング（§3.6-2）はこの一意性に依存する。
  unique ("importId", "ideaCode")
);

create index idea_factors_org_idx on idea_factors ("organizationId");
create index idea_factors_import_country_idx on idea_factors ("importId", country);
-- 製品名検索は ilike + limit で足りる（約 1 万行）。pg_trgm が使える環境では "productName" に gin_trgm_ops の GIN を張る。

alter table activity_records
  add constraint "activity_records_ideaFactorId_fkey"
    foreign key ("ideaFactorId") references idea_factors(id) on delete set null;

alter table emission_results
  add constraint "emission_results_ideaFactorId_fkey"
    foreign key ("ideaFactorId") references idea_factors(id) on delete set null;

-- §6 削減目標

-- 基準年度は組織にひとつ。年度ごとの削減率はすべてこの年度からの削減率として解釈する。
create table reduction_targets (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null unique references organizations(id) on delete cascade,
  -- 削減率の分母になる基準年度。年度を消すと目標の意味が失われるため連鎖削除する。
  "baseFiscalYearId" uuid not null references fiscal_years(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

comment on table reduction_targets is
  '組織の削減目標の基準年度（組織あたり1行）。年度ごとの削減率は reduction_target_years に持つ。';

create table reduction_target_years (
  id uuid primary key default gen_random_uuid(),
  -- 基準年度の設定が消えたら年度ごとの削減率も消える（reduction_targets の一意な組織IDを参照）。
  "organizationId" uuid not null
    references reduction_targets("organizationId") on delete cascade,
  -- 目標年度の開始年（例: 2031年度なら 2031）。未登録の未来年度も入れられるよう整数で持つ。
  "targetYear" integer not null,
  -- 基準年度からの削減率（%）。0 = 現状維持、100 = ゼロ排出。
  "reductionPercent" numeric(5, 2) not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint reduction_target_years_organization_year_key
    unique ("organizationId", "targetYear"),
  constraint reduction_target_years_percent_range
    check ("reductionPercent" >= 0 and "reductionPercent" <= 100),
  constraint reduction_target_years_year_range
    check ("targetYear" between 1900 and 9999)
);

comment on table reduction_target_years is
  '年度ごとの削減率（基準年度比%）。年間目標排出量は「基準年度の実績 × (1 - 削減率/100)」で導出する。';

-- §7 監査ログ

-- 監査ログを持つ組織は削除できない（restrict は意図的）。
create table system_audit_logs (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete restrict,
  "userId" uuid not null,
  action varchar(100) not null,
  "entityName" varchar(100) not null,
  "entityId" uuid,
  detail text,
  "ipAddress" varchar(45),
  "createdAt" timestamptz not null default now()
);

create index "system_audit_logs_organizationId_idx" on system_audit_logs ("organizationId");

-- §8 トリガー関数とトリガー
-- トリガー関数の EXECUTE はアプリから直接呼ばれないため Supabase の既定のまま（個別の revoke / grant はしない）。

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

-- 操作者列（audit の userId / createdBy・updatedBy / invitedBy）は RLS だけではクライアントが任意値を書けるため auth.uid() で上書きする。service_role（auth.uid() = null）は与えた値を尊重。
-- security invoker + set search_path = '' で auth.uid() をスキーマ修飾で解決し、検索パス経由の関数すり替えを防ぐ。

create or replace function set_audit_user_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new."userId" := coalesce(auth.uid(), new."userId");
  return new;
end;
$$;

create or replace function set_row_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT') then
    new."createdByUserId" := coalesce(auth.uid(), new."createdByUserId");
    new."updatedByUserId" := coalesce(auth.uid(), new."updatedByUserId");
  else
    new."createdByUserId" := old."createdByUserId";
    new."updatedByUserId" := coalesce(auth.uid(), new."updatedByUserId");
  end if;
  return new;
end;
$$;

create or replace function set_invite_inviter()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new."invitedByUserId" := coalesce(auth.uid(), new."invitedByUserId");
  return new;
end;
$$;

-- 二重計上防止: 同じ「組織 × 拠点 × 種別 × 対象月 × Scope3 カテゴリ × IDEA 製品」の INSERT・キー変更を DB 側でも止める（アプリ側事前チェックの後段の保険）。
-- unique index でなく trigger なのは重複を含む既存データがあっても導入できるため。キーに scope3CategoryId / ideaFactorId を含めるのは Scope3 積上げが全行 energyType = 'scope3_activity' のため（仕様 §4.3）。
-- 前提は READ COMMITTED（advisory lock 後の再検査が文ごとに新しいスナップショットを取ること）。
create or replace function prevent_duplicate_activity_record()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old."organizationId" is not distinct from new."organizationId"
      and old."locationId" is not distinct from new."locationId"
      and old."energyType" is not distinct from new."energyType"
      and old."periodStart" is not distinct from new."periodStart"
      and old."scope3CategoryId" is not distinct from new."scope3CategoryId"
      and old."ideaFactorId" is not distinct from new."ideaFactorId" then
      return new;
    end if;

    -- 参照を外すだけの遷移（非null → null: IDEA 版削除の FK set null、complete_idea_import の孤児化）は検査しない。
    -- 製品違いの明細が複数あると 1 件目の null 化で残りが同一キーになり、23505 で版削除・版更新全体が失敗するため。
    if old."ideaFactorId" is not null and new."ideaFactorId" is null then
      return new;
    end if;
  end if;

  -- 同一キーの同時 INSERT がすり抜けないよう先にトランザクション内ロックを取る。concat_ws は null を飛ばすため nullable のキー列は coalesce で空文字に固定する。
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        new."organizationId"::text,
        new."locationId"::text,
        new."energyType"::text,
        new."periodStart"::text,
        coalesce(new."scope3CategoryId"::text, ''),
        coalesce(new."ideaFactorId"::text, '')
      ),
      0
    )
  );

  if exists (
    select 1
    from public.activity_records ar
    where ar."organizationId" = new."organizationId"
      and ar."locationId" = new."locationId"
      and ar."energyType" = new."energyType"
      and ar."periodStart" = new."periodStart"
      and ar."scope3CategoryId" is not distinct from new."scope3CategoryId"
      and ar."ideaFactorId" is not distinct from new."ideaFactorId"
      and ar.id is distinct from new.id
  ) then
    -- 'DUPLICATE_ACTIVITY_RECORD' はアプリが重複判定に使う機械可読タグ。変更しないこと。
    raise exception
      using
        errcode = '23505',
        message = '同じ拠点・カテゴリ・対象年月の活動量が既に登録済みです。'
          || '複数メーター・複数請求書の場合は、入力履歴から既存レコードを開いて活動量を合算してください。',
        detail = 'DUPLICATE_ACTIVITY_RECORD',
        hint = 'DUPLICATE_ACTIVITY_RECORD';
  end if;

  return new;
end;
$$;

-- 同一テーブル・同一イベントの before トリガーは名前順に起動する（activity_records: prevent_duplicate_… → set_…_actor → set_…_updated_at）。

create trigger set_activity_records_updated_at
before update on activity_records
for each row execute function set_updated_at();

create trigger set_dashboard_aggregates_updated_at
before update on dashboard_aggregates
for each row execute function set_updated_at();

create trigger set_emission_factors_updated_at
before update on emission_factors
for each row execute function set_updated_at();

create trigger set_idea_imports_updated_at
before update on idea_imports
for each row execute function set_updated_at();

create trigger set_locations_updated_at
before update on locations
for each row execute function set_updated_at();

create trigger set_organizations_updated_at
before update on organizations
for each row execute function set_updated_at();

create trigger set_profiles_updated_at
before update on profiles
for each row execute function set_updated_at();

create trigger set_scope3_category_emissions_updated_at
before update on scope3_category_emissions
for each row execute function set_updated_at();

create trigger set_scope3_category_methods_updated_at
before update on scope3_category_methods
for each row execute function set_updated_at();

create trigger set_supplier_emissions_updated_at
before update on supplier_emissions
for each row execute function set_updated_at();

create trigger set_suppliers_updated_at
before update on suppliers
for each row execute function set_updated_at();

create trigger set_system_audit_logs_user_id
before insert on system_audit_logs
for each row execute function set_audit_user_id();

create trigger set_activity_records_actor
before insert or update on activity_records
for each row execute function set_row_actor();

create trigger set_locations_actor
before insert or update on locations
for each row execute function set_row_actor();

create trigger set_invites_inviter
before insert on invites
for each row execute function set_invite_inviter();

create trigger prevent_duplicate_activity_record_before_write
before insert or update of "organizationId", "locationId", "energyType", "periodStart", "scope3CategoryId", "ideaFactorId"
on activity_records
for each row
execute function prevent_duplicate_activity_record();

create trigger set_reduction_targets_updated_at
before update on reduction_targets
for each row execute function set_updated_at();

create trigger set_reduction_target_years_updated_at
before update on reduction_target_years
for each row execute function set_updated_at();

-- 「isCalculated = false の活動量に算定結果は存在しない」を DB 側の不変条件にする。
-- 活動量の編集（再算定対象へ戻す UPDATE）と旧 emission_results の削除を同一トランザクションで行うため、
-- アプリ側が 2 リクエストに分けて片方だけ失敗し、レコードは新値なのにダッシュボードが旧値を計上し続ける、
-- という状態が起きない。
--
-- security definer: 消すのは呼び出し元が UPDATE できた（= 自組織の）活動量に紐づく結果だけなので、emission_results の RLS を
-- 介さなくても越権にはならない。emission_results の delete ポリシーを絞ってもこの後始末が止まらないようにするため。
-- 手動入力（updateManualActivityRecord）と Scope3 積上げ（updateScope3ActivityRecord）の両方がこのトリガーに乗る。
create function clear_emission_results_on_recalculation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.emission_results where "activityRecordId" = new.id;
  return new;
end;
$$;

-- update of "isCalculated" は SET 句に列があれば値が同じでも発火する。すでに false のレコードを編集した場合でも
-- 残存する結果行を消せるよう、値の変化ではなく new の値で判定する。
-- run_calculation_commit の isCalculated = true 更新では発火しない。
create trigger clear_emission_results_on_recalculation
after update of "isCalculated" on activity_records
for each row
when (new."isCalculated" = false)
execute function clear_emission_results_on_recalculation();

comment on function clear_emission_results_on_recalculation() is
  '活動量レコードが再算定対象（isCalculated = false）へ戻ったとき、同一トランザクションで旧 emission_results を削除するトリガー関数。';

-- トリガー関数はトリガー経由でのみ実行させる（直接 /rpc/ から呼ばせない）。トリガーの発火に呼び出し元の EXECUTE 権限は不要。
revoke execute on function clear_emission_results_on_recalculation() from public, anon, authenticated;
