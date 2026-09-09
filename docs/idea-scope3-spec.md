# IDEAデータベース連携によるScope3積上げ算定 設計書（v1.6）

本書は、AIST-IDEA（産総研 LCIデータベース。以下 IDEA）を利用した Scope 3 の活動量ベース算定（積上げ法）を GreenTrack に実装するための設計書である。合意後に §7 の issue 分割に従って実装する。

**本書の読み方（実装者・実装AI向け）**: 本文はすべて「現在の確定仕様」を断定形で記述している（検討経緯・改訂履歴は §9 のみ）。DB の確定 DDL は §3、サービス層とRPC のコード契約（型・JSON形）は §4.3、issue ごとの実装範囲と受け入れ条件は §7 にある。矛盾がある場合は §3・§4.3 のコードブロックを正とする。

関連正本: `docs/calculation-logic.md`（算定エンジン） / `docs/database-design.md` / `docs/functional-spec.md §4.3.3, §7.2` / 実装規約は `AGENTS.md`（特に R7: サーバ専用モジュールの分離、R9: 既存マイグレーション編集禁止）

---

## 0. 前提と基本方針

### 0.1 利用形態（BYOライセンス）

- IDEA は有償の商用データベースであり、**OSS である GreenTrack には同梱できない**。
- 利用者（GreenTrack を導入した顧客）が **一般社団法人サステナブル経営推進機構（SuMPO）と自らライセンス契約**し、IDEA の Excel ファイルを入手して、自身の GreenTrack インスタンスに**アプリ画面からアップロードして取り込む**（Bring Your Own License / Bring Your Own Data 方式）。
- したがって GreenTrack 側に持つのは「**IDEA の Excel を解釈するインポーター**」と「**取り込んだ係数の保管・検索・算定への適用**」であり、**IDEA のデータそのものはリポジトリ・seed・テストコードに一切含めない**（テストは IDEA と同じ「形」のダミーデータで行う）。
- 拡張方針: 算定・集計層は**係数ソース非依存**とする（§4.3, §5.1）。レコード種別 enum を `scope3_activity`（IDEA 固有名にしない）とするのはこのためで、将来、無償の環境省「サプライチェーン排出原単位データベース」等を別プロバイダとして追加できる（§8-5）。

### 0.2 ライセンス上の制約（ファイル内「利用方法」シートより）

| 制約 | 設計への反映 |
|---|---|
| データセットの入出力フロー・特性化結果の**再配布禁止** | IDEA 由来係数は**係数CSVエクスポートの対象外**とする。画面表示は契約組織内の利用者に限る（RLSで組織スコープ）。レポートには算定結果（t-CO2e）と出典表記のみを載せ、係数値の一覧は載せない。 |
| 引用時の記述指定（例: `AIST-IDEA Ver.4.0 標準版 (2026/05/15) 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ`） | インポート時にバージョン情報シートから**引用文字列を自動生成して保存**し、係数詳細・レポートの出典欄に表示する。 |
| 契約は組織（法人）単位 | 係数は**組織スコープ（organizationId 必須）**で保持する。既存の公式係数（`organizationId = NULL` の全組織共通マスタ）とは**異なり**、他組織からは見えない。グループ会社（別 organization）で使う場合は各社のライセンス確認のうえ各組織でインポートする。 |

本表は設計判断の根拠として制約を**要約**したものであり、ライセンス条項の原文転載ではない。正確な許諾条件は各利用者と SuMPO との**ライセンス契約書および配布ファイル同梱の「利用方法」シート**を参照すること（本書の要約と原文が食い違う場合は原文が正）。

### 0.3 対象ファイルと GWP の扱い（重要）

IDEA Ver.4.0 標準版 Excel は影響評価手法別に複数ファイルで提供される（LIME3 / EN / EF / LCI 等。**GHG算定に使う版は AIST の配布一覧で「IPCC」という名称**の可能性が高い: `AIST-IDEA_Ver.4.0_標準版_Excel形式_IPCC_日本語`）。構造確認済みの LIME3 版は被害評価・統合化指標のみで **kg-CO2e（GWP）列を含まない**。

**Scope 3 の GHG 算定に使うのは GWP 列を持つ版（`LCIA結果_*` シート）**である。インポーターは次を仕様とする:

- **シート名は固定とみなさない。** `LCIA結果_` 前方一致でシートを探索する（`LCIA結果_GWP` / `LCIA結果_IPCC` 等の名称差を吸収）。
- 対象列は**列ヘッダーの識別子文字列**（例: `気候変動 IPCC 2021 GWP 100a without LULUCF`）の突き合わせで検出する。
- 指定 GWP モデルの列が**どの `LCIA結果_*` シートにも見つからないファイル（LIME3 版等）は取込エラー**とし、「GWP列を含むファイルではありません（IPCC版をご利用ください）」と明確なメッセージを返す。
- シート名・列識別子の正確な文字列は**実ファイル（IPCC版）で確認済み**（2026-08-17）。`AIST-IDEA_Ver.4.0_標準版_Excel形式_IPCC_日本語.xlsx` のシートは `バージョン情報` / `利用方法` / `LCIA結果_IPCC` / `LCIA係数_IPCC`。`LCIA結果_IPCC` の4行目に `気候変動 IPCC 2021 GWP 100a without LULUCF` 等の列識別子（AR6/AR5/AR4 × 100a/20a × with/without LULUCF の12列）、5行目に単位 `kg-CO₂eq` が入る。設計どおり `LCIA結果_` 前方一致 + 3〜5行目の連結ヘッダーへの部分一致で検出できることを実データで確認した。

- **選択肢の識別子は LULUCF の有無まで含める。** 実ファイルは同じ AR 版について `... without LULUCF` と `... with LULUCF` の両列を持ち（列順は AR6/AR5/AR4 の without 6列 → with 6列）、`IPCC 2013 GWP 100a` のような曖昧な識別子は先に現れる without 側へ黙って一致する。

採用する GWP モデルの既定値は **IPCC 2021 (AR6) GWP 100a without LULUCF** とする。根拠: **SSBJ 基準（ISSB S2 踏襲）が「最新の IPCC 評価報告書に基づく 100 年 GWP」= AR6 を要求**しており、本ツールの SSBJ レポート機能（2026-12 マイルストーン)と整合するため。なお SHK 制度（温対法）は令和6年度報告から AR5 の GWP を採用しているが、**Scope 3 は SHK の報告対象外**のため本機能の既定には影響しない。インポート画面で他モデル（AR5、with LULUCF 等）も選択可とし、選択したモデル名をインポート記録に保存してレポート出典欄に必ず表示する。

### 0.4 ファイル構造（LIME3 版の実測に基づく。GWP を含む版も同一の枠構造）

- シート: `バージョン情報` / `利用方法` / `LCIA結果_*` / `LCIA係数_*`
- `LCIA結果_*` シート: 1〜4行目がメタ情報（3〜4行目に影響評価モデルのグループヘッダー）、**5行目が列ヘッダー、6行目以降がデータ（約10,300行）**
- 固定列（A〜F）: `IDEA製品コード`（例 `999999999mJPN`。国コードを含み一意） / `IDEA製品名` / `国`（JPN / GLO 等） / `DB区分`（CORE / GLO 等） / `基準フロー`（通常 1） / `単位`（kg, kWh, m3, t-km, 円 等、製品ごとに異なる）
- G列以降: 影響評価モデル別の係数値。**列位置は固定とみなさず、3〜5行目のヘッダー文字列の突き合わせで対象列を特定**する（版・バリアントによる列ズレに頑健にする）

---

## 1. 既存実装の前提（実装前に把握すべき事実）

| 既存実装 | 事実 | 本機能への含意 |
|---|---|---|
| Scope3 入力（direct 方式） | `scope3_category_emissions` にカテゴリ別 t-CO2e を直接登録する（`機能仕様 §4.3.3`） | 本機能は活動量ベースの積上げ（calculated 方式）を追加するもの。direct 方式の編集 UI は Scope分析画面に実装済み（§5.2） |
| 算定エンジン | 純粋コア（`computeEmissions` / `resolveEmissionFactor`）と I/O 層を分離。**未算定レコードの取得は energyType で絞らない全件取得** | Scope3 レコードが Scope1/2 の算定に混入しないよう、取得クエリで energyType を明示分離する（§4.3-1） |
| 事業者別係数の先例 | `providerName` 非null の係数は `tierOf = Infinity`（自動解決対象外・明示選択専用）。専用フェッチでページング取得 | IDEA 正規化行も `providerName` 非null を必須とし、同じ仕組みで自動解決から構造的に除外する（§4.3-2） |
| `emission_factors.factorValue` | `numeric(12,6)` | IDEA の係数（有効桁9桁、円単位原単位は t-CO2e 換算 1e-9 オーダー）は**桁落ち・アンダーフローする**。既存テーブル格納は不可 → 案B（§2） |
| `emission_results.emissions` | `numeric(15,3)`。レコード単位で小数第3位（=1kg）に丸め | 積上げでは小口レコードの 0.5kg 未満が全て 0 に落ち**系統的過小計上**になる → `numeric(15,6)` へ拡張（§3.4） |
| `emission_results` | `categoryId integer` 列が既にある。`activityRecordId` に UNIQUE 制約（二重計上防止） | 積上げ結果のカテゴリ受け皿・二重計上防止は既存のまま使える |
| `run_calculation_commit` RPC | 算定確定＋ダッシュボード集計を単一トランザクションで実施。集計は絶対値再計算（自己修復）。EXECUTE は service_role 限定 | 同じ原子性・権限モデルで拡張する。集計部分は独立関数に切り出す（§5.1） |
| CSVインポートの先例 | 係数CSV・活動量CSVはクライアント側で純関数パース＋テスト | IDEA は xlsx・約1万行のため**サーバーサイド（Route Handler）でパース**。パース関数は純関数として切り出す |
| `supplier_emissions` | サプライヤー×年度×カテゴリの実排出量（1次データ）。Scope分析の**表示専用**で scope3Total に算入されない | 将来のハイブリッド法と関係（§8-6）。本機能では変更しない |

## 2. 格納方式（結論: 専用テーブル案Bを採用）

**採用: `idea_imports` + `idea_factors` の専用テーブル新設。** 理由は3点: ①原典精度の保持（無制約 numeric。`emission_factors.factorValue numeric(12,6)` では係数が消滅する）②既存の係数管理画面・5段階自動解決を1万行×組織数で汚染しない ③ライセンスデータの境界（インポート単位の削除・CSVエクスポート除外）を構造で保証する。

不採用: 案A（既存 `emission_factors` に `source='idea'` で投入）。精度（列拡張は seed 済み公式係数と全画面・全テストに波及）、規模（`Factors.client.tsx` は全行ロード前提）、ライセンス境界（除外条件分岐の散在）、意味論（`EnergyType` / `regionName` に対応しない）の4点で劣るため。

## 3. データベース設計（issue 1 の確定 DDL）

マイグレーションは新規ファイルとして追加する（AGENTS.md R9）。以下の DDL を正とする。

### 3.1 新設テーブル

```sql
-- 新規型の CREATE TYPE は同一トランザクション内で使用できる（使用制限があるのは
-- 既存 enum への ALTER TYPE ... ADD VALUE のみ。§3.3）。
create type "IdeaImportStatus" as enum ('processing', 'completed', 'failed');
create type "Scope3Method" as enum ('direct', 'calculated');   -- 将来 'hybrid' を値追加で拡張可能（§8-6）

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
  -- 検索・新規紐付けの対象。★既定は false。取込中の行を true で作ると、旧 active 行が
  -- まだ true のため下の部分一意インデックスに衝突し、2回目以降の取込が INSERT 時点で
  -- 必ず失敗する。true への切替は完了処理で旧行の false 化と同一トランザクションで行う（§4.1-3）
  "isActive" boolean not null default false,
  "errorMessage" text,
  "importedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- 組織内で active なインポートは最大1件
create unique index idea_imports_one_active_per_org
  on idea_imports ("organizationId") where "isActive" = true;

create table idea_factors (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,  -- RLS用に非正規化
  "importId" uuid not null references idea_imports(id) on delete cascade,
  "ideaCode" varchar(30) not null,             -- 例 '999999999mJPN'（国コード含み一意）
  "productName" varchar(300) not null,
  country varchar(10) not null,                -- 'JPN' / 'GLO' 等
  "dbType" varchar(20) not null,               -- 'CORE' / 'GLO' 等
  "baseFlowAmount" numeric not null default 1, -- 基準フロー量（通常 1）
  unit varchar(30) not null,                   -- kg / kWh / 円 / t-km 等。'/' を含む値は取込エラーにする
  "gwpValue" numeric not null,                 -- kg-CO2e / 単位。無制約 numeric で原典精度を保持
  "createdAt" timestamptz not null default now(),
  unique ("importId", "ideaCode")
);

create index idea_factors_org_idx on idea_factors ("organizationId");
create index idea_factors_import_country_idx on idea_factors ("importId", country);
-- 製品名検索: pg_trgm が使える環境では GIN を張る。使えない環境でも ilike + limit で実用（約1万行）。
-- create index idea_factors_product_name_trgm on idea_factors using gin ("productName" gin_trgm_ops);

create table scope3_category_methods (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "fiscalYearId" uuid not null references fiscal_years(id),
  "categoryId" integer not null check ("categoryId" between 1 and 15),
  method "Scope3Method" not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("organizationId", "fiscalYearId", "categoryId")
);
```

- 行が無いカテゴリ×年度の既定は `direct`（**後方互換**: 既存運用は無設定のまま従来どおり動く）。

### 3.2 RLS / GRANT

- `idea_imports` / `idea_factors`: SELECT は自組織のみ（`"organizationId" = (select current_user_organization_id())`）。**グループ会社横断の `current_user_organization_ids()` は使わない**（ライセンスは法人単位）。INSERT/UPDATE/DELETE は authenticated に**付与しない**（取込・削除はインポートAPI = Route Handler + service_role でのみ行い、API側で admin ロールを検証）。GRANT は `select` のみ authenticated へ、全操作を service_role へ（supplier_emissions のマイグレーションの GRANT 方針に倣う）。
- `scope3_category_methods`: `scope3_category_emissions` と同型（SELECT 自組織、書き込みは editor 制限の RESTRICTIVE ポリシー併用）。

### 3.3 既存テーブルへの追加列

```sql
alter table activity_records
  add column "scope3CategoryId" integer check ("scope3CategoryId" between 1 and 15),
  add column "ideaFactorId" uuid references idea_factors(id) on delete set null,
  -- Scope3積上げレコードはカテゴリ必須
  add constraint activity_records_idea_requires_category
    check ("ideaFactorId" is null or "scope3CategoryId" is not null);

alter table emission_results
  add column "ideaFactorId" uuid references idea_factors(id) on delete set null,
  -- 監査用スナップショット: 参照先が版更新・削除されても適用時の内容を保持する
  add column "appliedFactorValue" numeric,
  add column "appliedFactorUnit" varchar(50),  -- 'kg-CO2e/' + unit varchar(30) = 最大38
  -- 例 '999999999mJPN ダミー製品 (AIST-IDEA Ver.4.0)'。
  -- ★長さは §4.3-4 の生成規則の最大長から決めること。
  --   ideaCode(30) + ' '(1) + productName(300) + ' (AIST-IDEA '(12) + version(100) + ')'(1) = 444。
  --   varchar(400) では長い製品名で「value too long」により INSERT が全件ロールバックする
  --   （§4.3-4 の FK 違反と同じ失敗クラス）。余裕をみて 500 とする。
  add column "appliedFactorName" varchar(500);

-- ★ enum への値追加は「単独のマイグレーションファイル」に分けること。
--   PostgreSQL は追加された enum 値を同一トランザクション内で使用できない
--   （ERROR: unsafe use of new value ... / HINT: New enum values must be committed
--   before they can be used. を実測確認）。上記の DDL は新値を参照しないため同居しても
--   通るが、check 述語・部分インデックス・seed で 'scope3_activity' を使った瞬間に落ちる。
alter type "EnergyType" add value 'scope3_activity';
```

### 3.4 排出量の保存精度と丸め（仕様変更）

```sql
-- レコード単位1kg丸めは積上げ算定で系統的過小計上になるため、保存精度を1g粒度（10^-6 t）へ拡張。
-- 既存値は無損失（1.234 → 1.234000）。
-- ★ただしテーブル書き換えは発生する。numeric で書き換えが不要なのは「精度のみ拡張・
--   スケール据え置き」の場合のみで、スケールを 3→6 に変えると格納表現(dscale)が変わり
--   全行が書き換わる（PostgreSQL 17 で filenode 変化を実測）。ACCESS EXCLUSIVE ロックを
--   伴うため、emission_results の本番行数を見積もり、必要なら停止時間を告知すること。
alter table emission_results alter column emissions type numeric(15, 6);
```

- `roundEmissions`（TS）は**小数第6位**丸めに変更する（Scope1/2 含む全結果に適用）。JSDoc が
  `numeric(15,3) に合わせて小数第3位へ丸める` のままなので**コメントも併せて更新**する
  （AGENTS.md R10 は既存コメントの温存を求めるが、事実と食い違うコメントは更新が正）。
  同じ丸めを使う `EmissionResultInsert.emissions` の型コメントも同様。
- **画面・レポートの表示丸めは従来どおり小数第3位**で変えない。
- **`dashboard_aggregates` の `scope1Total` / `scope2Total` / `scope3Total` は `numeric(15,3)` のまま据え置く**（意図的）。
  是正対象はレコード単位の丸めによる系統的過小計上であり、合計値を一度 1kg に丸めるのは実用上無害。
  `scope3_category_emissions.emissions`（direct 入力値）も同様に据え置く。**この2つは広げないこと。**
- 既存テストの期待値見直しを issue 1 のタスクに含める（第3位で丸め切れている値は不変）。

### 3.5 enum とレコード種別の扱い

- `EnergyType` に追加する値は **`scope3_activity`**（表示名「Scope3積上げ」）の1値のみ。カテゴリ識別は `scope3CategoryId` が担う（enum 値は削除不能のため最小限）。
- **`scope3_activity` は係数作成 UI・係数CSVインポートのエネルギー種別候補から除外する**（ユーザー作成のカスタム係数が積上げレコードに自動マッチする経路を塞ぐ）。
- 拠点: `activity_records.locationId` は NOT NULL のまま。Scope3積上げレコードも拠点（本社等）に紐づける。`emission_results.locationId` は on delete cascade のため、**拠点削除 UI は Scope3積上げレコードを持つ拠点の削除をブロック**し「明細の移動または削除が必要」と案内する（issue 5）。

### 3.6 版更新（再インポート）と削除のポリシー

1. 再インポート時: 新規インポートは `isActive=false` で作成し、**取込が完了した時点で**旧インポートの `isActive=false` 化と新インポートの `isActive=true` 化を単一トランザクションで行う（順序と理由は §4.1-3）。取込前に旧を無効化してはならない（失敗時に active が1件も無くなり、既存の算定・検索が止まる）。
2. 取込完了処理内で、**未算定（`isCalculated=false`）の活動量レコードを `ideaCode` 一致で新版係数へ一括再マッピング**する（`UNIQUE(importId, ideaCode)` により対応は一意）。新版に同一コードが無いレコードは `ideaFactorId=null` にし、取込結果画面に「再選択が必要な明細 n 件」として警告表示する。
3. 算定済みレコード・`emission_results` は旧版参照＋スナップショットのまま**変更しない**（適用時点の値を監査用に保持）。
4. インポートの明示削除は、**`emission_results` から参照されている間は不可**（`isActive=false` で運用上は無効化できる）。完全削除は組織削除、または「参照している算定結果ごと削除される」ことを明示した強制削除操作に限る。

## 4. インポーター設計

### 4.1 フロー

```
[係数管理画面 > IDEAデータベースカード]
  1. ファイル選択（.xlsx）+ GWPモデル選択（既定: IPCC 2021 GWP100a without LULUCF）
     + ライセンス確認チェック（SuMPOと契約済みであることの確認文言）
  2. POST /api/idea-imports（multipart）
  3. サーバー側: idea_imports を processing / isActive=false で作成 → パース → 500行単位で
     idea_factors へチャンク挿入 → 完了処理を単一トランザクションで実行:
       completed / rowCount 更新 → 旧インポートを isActive=false 化 → 新インポートを
       isActive=true 化 → 未算定レコードの ideaCode 再マッピング（§3.6）
     ★ isActive の切替順は逆にできない（部分一意インデックスに衝突する。§3.1）
     ★ 新規行を isActive=true で作ると2回目の取込が INSERT 時点で失敗する
     （失敗時は failed + 部分挿入行の削除。旧 active はそのまま残るため運用は継続できる）
  4. 画面はインポート記録をポーリング表示
```

- パース本体は**純関数** `parseIdeaWorkbook(workbook, gwpModel) → { meta, rows, errors }` として `src/features/factors/services/ideaImport.ts` に切り出し、ダミー構造の xlsx フィクスチャでユニットテストする。
- xlsx 読み取りは Route Handler（Node ランタイム）+ `exceljs`（読み取りのみ・**新規依存**）。
- **デプロイ前提**: IDEA Excel は数十MBになり得るため、リクエストボディ制限のあるホスティング（Vercel の 4.5MB 等）では動かない。**セルフホスト（またはボディ制限を設定できる環境）を前提**とし、README / setup-guide に明記する。exceljs のメモリはファイルサイズの数倍になるため、実ファイル相当サイズでのメモリ計測を issue 2 のテスト項目に含める（必要なら対象シートのみのストリーミング読取へ切り替える）。
- バリデーション（すべて満たさない場合は取込全体を failed とし、行単位エラーは行番号付きで収集する。活動量CSVの取込ポリシーに整合）:
  1. `バージョン情報` シートから version / releaseDate を取得できること
  2. いずれかの `LCIA結果_*` シートに指定 GWP モデルの列識別子が存在すること（無ければ「GWP列を含むファイルではありません」エラー）
  3. 固定列（製品コード / 製品名 / 国 / 単位）の存在
  4. `gwpValue` が数値であること。ただし**空欄のセルはエラーにせず、その行を取込対象外にする**（下記）
  5. `unit` に `/` を含まないこと（§4.3-3 の単位分解を壊さないため）

- **GWP 空欄行の扱い（実ファイル検証で判明）**: IPCC 版の実ファイル（Ver.4.0 標準版）には、`LCIA結果_IPCC` の全 GWP 列が空欄の製品が **10,271 行中 48 行**含まれる（上水道 / 工業用水道 / 農業用水 / 養殖用水の消費型・非消費型使用水、水資源バランス調整用の沈殿処理サービス、配分用のごみ焼却火力・廃油(食用油)火力の電力プロセス）。これは IDEA 側の意図的な空欄でデータ不正ではないため、**行エラー（＝取込全体 failed）にはせずスキップ**し、件数を `idea_imports.skippedRowCount` に記録して係数管理画面に表示する。GWP を持たない製品は Scope3 の原単位として使えないため `idea_factors` には入れない。`'N/A'` のような「値はあるが数値化できない」セルは従来どおり行エラーとする（黙って落とすとデータ異常を見逃すため）。全行が空欄だった場合のみ、GWP モデルの選択違いを疑えるようファイル全体のエラーにする。

### 4.2 製品検索 API

- `GET /api/idea-factors?query=鋼&country=JPN&limit=50`（または supabase クライアント直の org スコープ SELECT）。検索対象は **active インポートのみ**。
- 既定は `country=JPN` を優先表示し、無い製品は GLO を提示。`SearchableSelect` を流用したインクリメンタル検索（サーバーサイド `ilike`、debounce、上限50件）。**全行をクライアントにロードしない。**

### 4.3 算定エンジンへの接続（コード契約）

`calculationService.runCalculationBatch` に Scope3 積上げの処理を追加する。純粋コア（`computeEmissions` / `resolveEmissionFactor` / `units.ts`）の係数解決・単位換算ロジックには**手を入れない**。

**1. レコード取得の分離**

- **取得列の追加（必須）**: 既存の活動量取得は列を明示列挙している（`calculationService.ts` の
  `.select('id,organizationId,locationId,energyType,amount,unit,periodStart,periodEnd,isCalculated,emissionFactorId')`）。
  ここに **`scope3CategoryId` と `ideaFactorId` を追加する**。追加を忘れても例外は出ず、
  §4.3-4 の `record.scope3CategoryId` が undefined になって `categoryId=null` で保存され、
  §5.1 の `calculated` 集計が全カテゴリ 0 になる（**気づきにくい黙った誤集計**）。
- Scope1/2 パス: 既存クエリに `.neq('energyType', 'scope3_activity')` を追加（Scope3 レコードの混入防止。`activity_records.energyType` は NOT NULL のため `.neq` で既存行が脱落することはない）。
- Scope3 パス: `energyType = 'scope3_activity'` かつ `ideaFactorId is not null` の未算定レコードと、参照される `idea_factors`（isActive を問わない。旧版参照の算定済み再実行は無いが未算定は §3.6-2 で新版に再マッピング済み）を取得。
- `energyType = 'scope3_activity'` かつ `ideaFactorId is null` のレコード（参照切れの孤児）は**算定に回さず**、未解決理由 `SCOPE3_FACTOR_MISSING` で unresolved に載せる（メッセージ: 「参照していた係数が削除されています。製品を再選択してください」）。

**2. 正規化（idea_factors → EmissionFactorRow）**

```ts
// サービス層のみで使う変換。DBには保存しない。
const normalizeIdeaFactor = (f: IdeaFactorRow, applicableYear: number): EmissionFactorRow => ({
  id: f.id,                                   // = ideaFactorId。明示解決パスで照合される
  organizationId: f.organizationId,
  name: `${f.ideaCode} ${f.productName}`,
  energyType: 'scope3_activity',
  scope: 'scope3',
  factorValue: Number(f.gwpValue) / Number(f.baseFlowAmount),
  unit: `kg-CO2e/${f.unit}`,
  applicableYear,                              // バッチの対象年度（IDEAは年度非依存。前提フィルタを常に通す）
  regionName: '',                              // '全国' を入れないこと（tier5 に載せない多層防御）
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: null,
  effectiveTo: null,
  providerName: 'IDEA',                        // ★必須・非null。tierOf = Infinity（自動解決対象外）を
                                               //   既存の事業者別係数と同じ仕組みで構造的に保証する
  providerNumber: null,
  menuName: null,
  factorType: null,
});
```

- Scope3 の `computeEmissions` 呼び出しは **Scope1/2 とは別に行い、Scope3 レコードと正規化済み係数のみを渡す**（同一呼び出しに混ぜない。誤マッチ防止の多層防御）。
- レコード側は `emissionFactorId = ideaFactorId` の明示指定として渡す → 既存の明示解決パス（前提フィルタのみ・tier 不問）に乗る。
- 単位換算は既存 `units.ts` がそのまま機能する（分子 `kg-CO2e` → t-CO2e の ÷1000。分母は製品単位と活動量単位の完全一致 — 製品選択時に単位を自動設定するため常に 1:1）。

**3. 型の変更（`src/features/calculation/types.ts`）**

```ts
export interface ActivityRecordRow {
  // ...既存フィールドは不変...
  scope3CategoryId?: number | null;   // 追加
}

export interface EmissionResultInsert {
  activityRecordId: string;
  emissionFactorId: string | null;    // 変更: nullable（IDEA由来はnull。emission_factorsへのFKのため）
  ideaFactorId?: string | null;       // 追加: IDEA由来のみセット
  locationId: string;
  scope: Scope;
  categoryId: number | null;
  emissions: number;                  // numeric(15,6)。小数6桁丸め済み
  appliedFactorValue?: number | null; // 追加: スナップショット（IDEA由来のみ）
  appliedFactorUnit?: string | null;
  appliedFactorName?: string | null;
}

export type UnresolvedReason =
  | 'FACTOR_NOT_FOUND'
  | 'UNIT_MISMATCH'
  | 'SCOPE3_FACTOR_MISSING';          // 追加
```

**4. 結果の詰め替え（FK 違反の防止。サービス層で必ず行う）**

純粋コアが返す `EmissionResultInsert.emissionFactorId` には正規化行の id（= ideaFactorId）が入る。これは **`emission_factors` への FK に入れてはならない**（存在しない UUID のため INSERT が FK 違反で全件ロールバックする）。Scope3 積上げ由来の結果は RPC へ渡す前に次のとおり変換する:

```ts
const toScope3Insert = (
  r: EmissionResultInsert,
  f: IdeaFactorRow,
  meta: IdeaImportRow,
  record: ActivityRecordRow,   // categoryId の供給元。r には載っていないので必須
): EmissionResultInsert => ({
  ...r,
  emissionFactorId: null,
  ideaFactorId: f.id,
  categoryId: record.scope3CategoryId ?? null,
  appliedFactorValue: Number(f.gwpValue) / Number(f.baseFlowAmount),
  appliedFactorUnit: `kg-CO2e/${f.unit}`,
  appliedFactorName: `${f.ideaCode} ${f.productName} (AIST-IDEA ${meta.version})`,
});
```

**5. `run_calculation_commit` の拡張（CREATE OR REPLACE の新規マイグレーション）**

`p_results` の JSON 要素を次の形に拡張する（Scope1/2 要素は従来どおり。新フィールドは省略可）:

```jsonc
{
  "activityRecordId": "uuid",
  "emissionFactorId": "uuid | null",   // IDEA由来は null
  "ideaFactorId": "uuid | null",       // IDEA由来のみ
  "locationId": "uuid",
  "scope": "scope3",
  "categoryId": 1,
  "emissions": 12.345678,
  "appliedFactorValue": 0.0903508069,  // IDEA由来のみ
  "appliedFactorUnit": "kg-CO2e/kg",
  "appliedFactorName": "999999999mJPN ダミー製品 (AIST-IDEA Ver.4.0 標準版)"
}
```

INSERT 側の対応: `"emissionFactorId"` は `nullif(r->>'emissionFactorId','')::uuid`、`"ideaFactorId"` / `appliedFactor*` を同様に追加。既存の `emission_results("activityRecordId")` UNIQUE による二重計上防止・all-or-nothing の原子性・service_role 限定の EXECUTE 権限は維持する。

**入力粒度の推奨**: 保存丸めは §3.4 で 1g 粒度に拡張済みのためゼロ落ちは起きないが、件数と運用性のため「明細1行ずつではなく**月次 × 製品での集約入力を推奨**」と画面ヘルプに明記する。

## 5. 集計・画面反映

### 5.1 scope3Total の方式別集計と再集計関数

集計ロジック（カテゴリ 1〜15 それぞれ）:

```
method(組織, 年度, カテゴリ) = scope3_category_methods の設定（無ければ 'direct'）
  direct     → scope3_category_emissions の値（従来どおり）
  calculated → emission_results（scope='scope3', categoryId=当該）を
               activity_records に join し periodStart が年度期間内の行の合計
scope3Total = Σ カテゴリ別採用値
```

- 二重計上は方式の排他選択により構造的に発生しない。`calculated` に切り替えたカテゴリの直接入力値は削除せず保持し、画面上「未採用（積上げ算定を採用中）」と表示する（切替の可逆性）。
- **再集計関数の切り出し**: 上記を含むダッシュボード集計の絶対値再計算を独立関数 `refresh_dashboard_aggregates(p_organization_id uuid, p_fiscal_year_id uuid)` に切り出し、`run_calculation_commit` から呼ぶ。加えて次のタイミングでも専用 API 経由で呼び出す（集計の陳腐化防止）: ①方式切替時 ②Scope3 直接入力値の upsert 時 ③Scope3 積上げレコード（および対応する emission_results）の削除時。EXECUTE 権限は `run_calculation_commit` と同様 service_role 限定。

### 5.2 画面

| 画面 | 変更 |
|---|---|
| 係数管理（`/factors`） | 「IDEAデータベース」カード新設: バージョン・取込日・製品数・引用表記の表示、インポート実行、削除（参照有りは不可 — §3.6）。未取込時は SuMPO 契約の案内文とリンクを表示 |
| データ入力（`/data-input`） | Scope3 積上げ入力: カテゴリ（1〜15）選択 → IDEA 製品検索選択 → 活動量入力（単位は製品から自動設定）→ 期間・拠点。インライン概算表示は既存パターンを踏襲 |
| Scope分析（`/scope-analysis`） | カテゴリごとに算定方法バッジ（直接入力 / 積上げ）と方法切替（切替時に §5.1 の再集計を実行）。積上げカテゴリはドリルダウンで製品別内訳を表示。**direct 方式の値の編集導線（`scope3_category_emissions` の upsert UI）もここに置く**（実装済み。積上げを採用中のカテゴリでも直接入力値は「未採用」として保持・編集できる） |
| レポート | Scope3 の算定方法欄に方式と IDEA 引用表記（GWPモデル名を含む）を自動記載 |

## 6. テスト・検証方針

- パーサー: ダミー xlsx（実データ値を含まない同一構造）で、シート名前方一致・列検出・エラー系（GWP列なし・列欠落・非数値・`/` を含む単位）を網羅。実ファイル相当サイズでのメモリ計測。
- 正規化＋算定: 単位・精度（円単位原単位の t-CO2e 換算で桁落ちしないこと）、**`providerName='IDEA'` により自動解決候補に決して入らないこと（`ideaFactorId=null` の孤児レコードが他の IDEA 係数に誤マッチしない回帰テスト）**、`categoryId` の伝播、明示解決経由の適用、**FK 詰め替え（`emissionFactorId=null` / `ideaFactorId` セット）の回帰テスト**。
- 丸め: 小数第6位丸めで 0.5kg 未満の明細がゼロ落ちしないこと。既存 Scope1/2 テストの期待値見直し。
- 版更新: 再インポートで未算定レコードが ideaCode で新版へ再マッピングされること、コード消滅分が警告に載ること、算定済み結果が不変であること。
- 集計: `direct` / `calculated` 混在時の scope3Total、方式切替の可逆性と**切替直後の再集計反映**、再算定時の自己修復。
- seed には IDEA 実値を**入れない**。検証手順書には「ダミー3製品の取込ファイル」を用意する。

## 7. 実装フェーズ分割と受け入れ条件

マイルストーン（算定ツール機能 2026-08-14）に対し **1→2→4 を先行**し、3・5 を後続で積む。

### issue 1: マイグレーション（依存: なし）

実装範囲: §3 の DDL 全部（idea_imports / idea_factors / scope3_category_methods / 既存テーブル追加列 / emissions 精度拡張 / enum 追加 / RLS / GRANT）+ `roundEmissions` の第6位化。

**マイグレーション分割の注意**（§3.3・§3.4 のコメント参照）:
- `EnergyType` への enum 値追加は**単独ファイル**にする（同一トランザクション内で新値を使えないため）。
- `emission_results.emissions` のスケール変更は**全行書き換え**を伴う。本番行数を事前に見積もる。

受け入れ条件:
- [ ] §3.1〜3.4 の DDL が新規マイグレーションとして適用できる（既存マイグレーションは未編集）
- [ ] `EnergyType` に `scope3_activity` が追加され、係数作成 UI / 係数CSVの候補には**出ない**
- [ ] `emissions` が numeric(15,6) になり、`roundEmissions` が第6位丸め・表示は第3位のまま
- [ ] 既存の Scope1/2 算定テストが（期待値見直しの上）全て通る
- [ ] idea_* テーブルに authenticated で INSERT できないこと、他組織の行が SELECT できないことのRLSテスト

### issue 2: IDEA インポーター（依存: 1）

実装範囲: §4.1（パース純関数 + Route Handler + 係数管理画面カード + 版更新の再マッピング §3.6 + メモリ計測）、§4.2（製品検索 API）。exceljs の依存追加。

受け入れ条件:
- [ ] IPCC 版実ファイルでシート名・列識別子を確認し、フィクスチャと §0.3 の識別子文字列を確定
- [ ] LIME3 版相当のフィクスチャが明確なエラーで弾かれる
- [ ] 1行でも不正があれば取込全体が failed になり、部分挿入行が残らない
- [ ] **同一組織で2回続けて取込を実行しても成功する**（`idea_imports_one_active_per_org` に衝突しないこと。§4.1-3 の isActive 切替順の回帰テスト。初回のみのテストでは検出できない）
- [ ] 再インポートで §3.6-2 の再マッピングと警告表示が動く
- [ ] 参照有りインポートの削除が拒否される
- [ ] 実ファイル相当サイズ（数十MB・約1万行）でメモリ・処理時間を計測し記録

### issue 3: データ入力の Scope3 積上げモード（依存: 1, 2）

実装範囲: §5.2 データ入力行（カテゴリ選択 → 製品検索 → 活動量 → 期間・拠点、インライン概算）。

受け入れ条件:
- [ ] 単位が製品から自動設定され編集不可
- [ ] インライン概算が保存後の算定（§4.3）と同じ値を出す
- [ ] 「月次×製品での集約入力を推奨」のヘルプ表示

### issue 4: 算定サービス + RPC 拡張（依存: 1）

実装範囲: §4.3 のコード契約全部（レコード取得分離 / 正規化 / 型変更 / FK詰め替え / RPC 拡張）+ §5.1 の `refresh_dashboard_aggregates` 切り出し。

受け入れ条件:
- [ ] §4.3-2 の `providerName='IDEA'` 正規化と、孤児レコードの `SCOPE3_FACTOR_MISSING` が実装されている
- [ ] §4.3-4 の詰め替えにより emission_results への INSERT が FK 違反しない（回帰テスト付き）
- [ ] 活動量取得の select に `scope3CategoryId` / `ideaFactorId` が含まれ、保存された `emission_results.categoryId` が入力カテゴリと一致する（§4.3-1。null で保存されると §5.1 の集計が黙って 0 になる）
- [ ] 製品名・バージョンが最大長のケースで `appliedFactorName` が切れずに保存できる（§3.3）
- [ ] Scope1/2 のみの組織で従来の算定結果・集計が不変（回帰テスト）
- [ ] `direct` / `calculated` 混在の scope3Total が §5.1 のとおり集計される
- [ ] 円単位原単位が `idea_factors.gwpValue`（無制約 numeric）に原典精度のまま保持され、
      正規化 `gwpValue / baseFlowAmount` でも桁落ちしない
      （※結果値 `emissions` は §3.4 の第6位丸めにより 1e-6 t 未満が落ちる。これは仕様であり、
        「月次×製品での集約入力を推奨」（§4.3）で運用回避する。結果値の話と混同しないこと）

### issue 5: Scope分析・ダッシュボード・レポート対応（依存: 4）

実装範囲: §5.2 の Scope分析（方式バッジ・切替＋再集計・ドリルダウン・**direct 編集 UI**）、レポート出典、拠点削除ガード（§3.5）、ドキュメント更新（calculation-logic.md / database-design.md への反映）。

受け入れ条件:
- [ ] 方式切替の直後に scope3Total が更新される（バッチ再実行不要）
- [ ] 切替が可逆で、direct 値が「未採用」表示で保持される
- [ ] Scope3積上げレコードを持つ拠点が削除できず案内が出る
- [ ] レポートに方式・IDEA 引用表記・GWPモデル名が出る。係数値の一覧は出ない

## 8. 決定事項（旧「未決事項」。2026-07-29 に全項目を確定）

1. **グループ会社の扱い** — **決定: 組織単位で完全分離する（現設計のまま。DDL / RLS の変更なし）**

   根拠は SuMPO 公表の AIST-IDEA 使用許諾約款の改訂内容（[改訂のお知らせ](https://sumpo.or.jp/consulting/lca/idea/revision_of_license_terms.html)）:
   - 閲覧権限は「**同一社内・同一組織の構成員に限り**、IDEA なしでも IDEA データを含む計算結果を閲覧することが可能」（原単位DBの使用は使用者のみ）。別法人である子会社へは**計算結果すら共有できない**。
   - 「**子会社および孫会社の分のライセンスをまとめて購入することはできない**」（従来は親会社の一括購入が可能だったが改訂で不可に）。

   したがって親ライセンスによる子会社組織への横断参照は実装しない。グループ各社は各社で SuMPO と契約し、各 organization で個別にインポートする（§0.2 のとおり）。
   なお本記述の出典は SuMPO 公式サイトの改訂概要ページであり、約款本体の条文そのものは未照合。**導入顧客の個別契約が標準約款と異なる場合は再検討する**。

   **`emission_results` への反映**: `idea_imports` / `idea_factors`（自組織限定 RLS）だけでなく、算定結果を保存する `emission_results` の **IDEA 由来行**（`scope='scope3'`、または `ideaFactorId` / `appliedFactor*` が非null の行）も、**行ごと自組織限定**とし（グループ会社横断など可視範囲を広げる RLS を導入する場合も、IDEA 由来行はその対象から除外する）、自組織の利用者のみ参照・更新できるものとする（`supabase/migrations/20260831000001_rls.sql` の `emission_results` ポリシー）。列レベル GRANT で `appliedFactor*` を隠すだけでは、横断閲覧可能な `emissions` と `activity_records.quantity` の割り算で IDEA 原単位が復元できるため不十分であり、上記約款の「別法人へは計算結果すら共有できない」にも明細行の共有自体が抵触するため、行単位で除外する。`scope='scope3'` の一括除外は「emission_results の scope3 行は現状 IDEA 積上げ算定でのみ生成される」ことを前提としており、ライセンス制約のない第2プロバイダ（§8-5）を追加する際に緩和を再検討する。`dashboard_aggregates.scope3Total`（direct/calculated 混在の組織合計。個別原単位へ遡れない集計値）は現行どおり据え置き、約款本文照合の際に再確認する。

2. **GWP モデルの複数保持** — 決定: 1インポート=1モデルのまま。SSBJ 用途では単一（AR6）で足りるため、AR5/AR6 併記のニーズが顕在化してから拡張する。
3. **円単位原単位の投入判断** — 決定: 全件取込・検索で判別可能とする（§3.4 の精度拡張が前提）。
4. **exceljs の依存追加** — 決定: 採用する（CSV 代替は UX と検証性で劣る）。§4.1 のサイズ・メモリ前提の確認のみ issue 2 で実施。
5. **環境省「サプライチェーン排出原単位DB」の位置づけ** — **決定: Phase 2 で実施する。ただし着手判断は IDEA 連携（issue 1・2・4: 取込・算定・ライセンス境界）の完了後**。本設計は集計層・レコード種別（`scope3_activity`）を係数ソース非依存にしてあり、第2プロバイダは後から追加できる。IDEA で当該抽象が実証されてから汎用化する。2026-08-14 マイルストーンには含めない。
6. **サプライヤー1次データ（supplier_emissions）とのハイブリッド法** — **決定: 将来課題とする。** 当面は「direct 側の値を残余分として運用する」ガイドで逃がし、`method='hybrid'` の enum 値追加は必要が顕在化してから。現状 supplier_emissions は Scope分析の表示専用で scope3Total に算入されない（`scopeAnalysisService.ts` のみが参照）点は本機能では変更しない。
7. **カテゴリ「16. その他（任意）」** — **決定: 追加しない。** 現行どおり 1..15 のみとする。

## 9. 変更履歴

| 版 | 日付 | 変更 |
|---|---|---|
| v1.0 | 2026-07-28 | 初版ドラフト |
| v1.1 | 2026-07-29 | 設計再考レビュー反映: 明示選択専用の構造保証（providerName 非null・算定呼び出し分離・孤児レコードの専用未解決理由）/ emissionFactorId の FK 詰め替えと RPC 引数拡張 / emissions を numeric(15,6) へ拡張し丸めを第6位へ / 版更新時の ideaCode 再マッピングと削除ガード / `refresh_dashboard_aggregates` 切り出し・direct 編集 UI 未実装の明記 / GWP 既定の根拠を SSBJ 整合へ訂正（SHK は AR5・Scope3 対象外）/ 拠点削除ガード / appliedFactorName 追加・参照有りインポートの削除不可 / enum 名を `scope3_activity` に変更 / 未決事項 5〜7 を追加 |
| v1.2 | 2026-07-29 | AI実装用に再構成: 本文を「現在の確定仕様」の断定形に統一（レビュー指摘番号の参照を除去）/ §3 に確定 DDL、§4.3 にコード契約（正規化関数・型差分・RPC の JSON 形）を追加 / §7 を issue 別の実装範囲＋受け入れ条件チェックリスト化 / シート名を固定しない方針を明確化（実ファイルは「IPCC」名称の可能性。列識別子は実ファイルで確定） |
| v1.3 | 2026-07-29 | §8 を「未決事項」から「決定事項」へ。7項目すべて確定: グループ会社は組織単位で完全分離（SuMPO 約款改訂の閲覧範囲・子会社一括購入不可を根拠に、DDL/RLS 変更なし）/ 環境省DBは Phase 2・着手判断は issue 1・2・4 の完了後 / ハイブリッド法（`method='hybrid'`）は将来課題 / カテゴリ16は追加しない |
| v1.4 | 2026-07-29 | 設計レビュー反映: **再インポートが部分一意インデックスで必ず失敗する不具合を修正**（`idea_imports.isActive` の既定を false にし、§4.1-3 の切替順を単一トランザクションで規定。issue 2 に2回連続取込の受け入れ条件を追加）/ §4.3-4 `toScope3Insert` の未定義変数 `record` を引数に追加 / §3.4 の「テーブル書き換え不要」を訂正（スケール変更は全行書き換え。PostgreSQL 17 で実測）/ §3.3 に enum 値追加を単独マイグレーションにする旨を明記（同一トランザクション内で新値を使用不可。実測確認）/ `dashboard_aggregates`・`scope3_category_emissions` は numeric(15,3) 据え置きと明記 / `roundEmissions` の JSDoc 更新指示 / issue 4 の桁落ち受け入れ条件を係数値の話と明確化 |
| v1.5 | 2026-08-07 | 再レビュー反映: §3.1 の `Scope3Method` を実際の `create type` 文にした（コメント内にしか無く DDL をそのまま流すと型不在で落ちる）/ §3.6-1 を §4.1-3 の切替順に整合させた（旧を先に false 化する読みを排除）/ `appliedFactorName` を varchar(500) に拡張（§4.3-4 の生成規則の最大長 444 を収容できず INSERT が全件ロールバックしていた）/ §4.3-1 に活動量取得 select への `scope3CategoryId`・`ideaFactorId` 追加を明記（欠落すると categoryId が黙って null になり §5.1 の集計が 0 になる）/ issue 4 に対応する受け入れ条件2件を追加 / §9 の版の並び順を昇順に修正 |
| v1.6 | 2026-08-10 | 実装レビュー反映: §8-1 に `emission_results` の IDEA 由来行（`scope='scope3'` または `ideaFactorId` / `appliedFactor*` 非null）をグループ会社横断 RLS から行ごと除外する方針を明文化（`appliedFactorValue` = IDEA 原単位のスナップショットが当時のグループ会社横断 SELECT ポリシー経由で親会社から閲覧できるライセンス境界の破れを是正。列 GRANT 除外では `emissions` ÷ 活動量で原単位が復元可能なため行単位で除外。現在は `20260831000001_rls.sql` の `emission_results` ポリシー（自組織限定）に定義） |
