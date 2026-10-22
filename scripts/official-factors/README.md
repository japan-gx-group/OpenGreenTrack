# 公式排出係数のシード生成

環境省・経済産業省の公表資料から公式排出係数マスタ（`emission_factors` の
`organizationId is null` 行）のシード SQL を生成するスクリプト。

生成物は `supabase/seeds/production/` の次のファイルで、OpenGreenTrack の初期データのうち
**本番環境にも投入する共通マスタ**（seed）。データはマイグレーション（スキーマ定義）には置かず、
seed として管理する（`AGENTS.md` R12）。
テスト/デモ用の `supabase/seeds/demo/demo.sql` とは独立していて、どちらか一方だけでも投入できる。

| ファイル | 内容 |
|---|---|
| `official_emission_factors_<年度>.sql` | 年度ごとの公式係数（`data/<年度>/` から生成。年度ごとに独立していて、投入の順番に依存しない） |
| `official_emission_factors_cleanup.sql` | 以前の版が作っていた翌年度コピー行の後始末（後述） |

```bash
node scripts/official-factors/generate.ts
# => supabase/seeds/production/official_emission_factors_<年度>.sql と official_emission_factors_cleanup.sql を上書き生成
#    （data/ から消した年度のファイルや、以前の全年度 1 ファイルの official_emission_factors.sql は削除する）
```

リポジトリに収録しているのは公表資料のある最近の年度だけ（現在は 2025 年度）。それより前の年度は同梱しないので、
必要な導入先は「[過年度の公式係数を自分で登録する](#過年度の公式係数を自分で登録する)」の手順で登録する。

## 投入方法

| 目的 | コマンド |
|---|---|
| ローカル DB 作り直し（スキーマ + 本番マスタ） | `npm run db:reset`（= `npx supabase db reset`。`config.toml` の `[db.seed].sql_paths` で自動投入） |
| 稼働中ローカル DB へ（再）投入 | `npm run db:seed:production`（= `node scripts/db/seed.ts production`。ローカル Supabase の DB コンテナ内で `psql` を実行） |
| 任意の DB（クラウド / 自前ホスト）へ（再）投入 | `npm run db:seed:production -- --db-url postgresql://…`（ホストの `psql` を使用。無ければ Dashboard の SQL Editor でファイルの内容を実行） |
| クラウド（スキーマ + 本番マスタ） | `npx supabase db push --include-seed`（`config.toml` の `sql_paths` = production だけが流れる） |

## データソース（data/<年度>/）

公表資料は**年度別のディレクトリ**（`data/2025/` など。ディレクトリ名は `applicableYear`）に置く。
`generate.ts` は `data/` 配下の年度ディレクトリを自動で見つけ、年度ごとに、そのディレクトリの資料と
年度の定義 `source.json`（公表資料の名称・都市ガスと熱の代替値・スポットチェック）**だけ**から行を作る。
年度を足すときに `generate.ts` を変更する必要はない。
ある年度の資料をほかの年度に使い回すと、ID が同じ（「安定キー + 年度」）その年度の行が upsert で
書き換わるため、過年度のディレクトリは変更しない（訂正を除く）。

各年度のディレクトリには次のファイルを置く（2025 年度の内容）。

| ファイル | 内容 | 由来 |
|---|---|---|
| `denki.txt` | 電気事業者別排出係数（R8.1.9公表・R8.8.3更新） | 公表PDFを `pdftotext -layout` で抽出した生テキスト。`parse.ts` がパースする |
| `gas.tsv` | ガス事業者別排出係数（R8.6.30公表） | 公表PDFから手書き転記（件数が少なくレビュー可能にするため） |
| `heat.tsv` | 熱供給事業者別排出係数（R8.6.30公表） | 同上 |
| `fuels.tsv` | 燃料の排出係数（算定省令別表） | 「算定方法・排出係数一覧」p.23 から手書き転記。先頭列 `key` は行の安定キー（後述） |
| `scope3.tsv` | Scope3 代表排出原単位 | 排出原単位データベース Ver.3.6 から厳選・転記。先頭列 `key` は行の安定キー（後述） |
| `source.json` | 年度の定義 | 下記「source.json の書式」。公表資料から機械的に読み取れない値と、スポットチェックの期待値を書く |

公表元:

| 公表元 | URL | 対象 |
|---|---|---|
| 「温室効果ガス排出量 算定・報告・公表制度」（環境省・経済産業省） | https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html | `denki.txt` / `gas.tsv` / `heat.tsv` / `fuels.tsv` |
| 「排出原単位データベース Ver.3.6」（環境省。2026年4月リリース） | https://www.env.go.jp/earth/ondanka/supply_chain/gvc/estimate_05.html | `scope3.tsv` |

### source.json の書式

`data/2025/source.json` がそのまま雛形になる。読み込みと検証は `yearSource.ts`。書式の誤り（必須項目の欠落・
数値でない値・JSON の構文誤り）や、スポットチェックの不一致は、どのファイルのどの項目かを示して生成が止まる。

| 項目 | 必須 | 内容 |
|---|---|---|
| `documents.denki` / `gas` / `heat` / `fuels` / `scope3` | ○ | 各行の `sourceDocumentName` に保存する公表資料の名称（公表日・実績年度まで書く）。電気・ガス・熱の名称が別年度と同じだと、資料の差し替え忘れとして止まる |
| `scope3DatabaseVersion` | ○ | 生成 SQL の出典表示に載せる排出原単位データベースの版（例: `Ver.3.6`） |
| `cityGasSubstituteValue` / `heatSubstituteValue` | ○ | 都市ガス（t-CO2/千m3）・熱（t-CO2/GJ）の代替値（省令の排出係数。事業者別の公表資料に載らないため年度ごとに書く） |
| `checks` | 任意 | パース結果の妥当性検証。書いた項目だけ検証する。件数の下限（`electricityRetailerCountAtLeast` / `electricityRetailerRowsAtLeast` / `gasProviderCountAtLeast` / `heatProviderCountAtLeast` / `scope3CountAtLeast`）、件数の一致（`gridOperatorCount` / `fuelCount`）、電気の代替値（`electricitySubstituteValue`）、公表資料と突き合わせた値（`electricityRetailers` / `gridOperators` / `gasProviders` / `heatProviders` / `fuels`）。書式は `data/2025/source.json` を参照 |

`checks` は任意だが、公表資料の書式の読み違いで行が欠けたり値がずれたりしたまま生成するのを防ぐため、
公表資料と突き合わせた値を数件ずつ書くことを勧める。

### データソースの利用条件（変更時に必ず読むこと）

同梱データは **Apache License 2.0 の対象外**で、リポジトリ直下の [`NOTICE`](../../NOTICE) が正本。

- 両公表元とも環境省ウェブサイトの[利用規約](https://www.env.go.jp/mail.html)（**公共データ利用規約（第1.0版）**。
  政府標準利用規約（第2.0版）準拠、**CC BY 4.0 互換**）に基づく。商用利用・改変・再配布が可能で、条件は
  **①出典の記載 ②編集・加工したこと及びその主体の記載**の2つ。本リポジトリでは加工の主体は Japan GX Group。
- そのため `data/<年度>/` の各ファイル先頭・生成SQLのヘッダ・`NOTICE`・`README.md` に出典と加工した旨を書いている。
  **これらの表示を消さないこと**（消すと利用条件を満たさなくなる）。`generate.ts` のヘッダは
  `SOURCE_URL_SHK` / `SOURCE_URL_SCOPE3` を埋め込むので、URL の修正は定数1か所で足りる。
- `fuels.tsv` の値は算定省令別表（法令）由来で著作権法第13条により権利の目的とならないが、
  転記元は環境省の解説PDF（「算定方法・排出係数一覧」p.23）なので上記の表示は同じく必要。
- 上記規約は**第三者が権利を有するコンテンツには適用されない**。`scope3.tsv` のうち出張（交通費・宿泊・
  従業員当たり）と廃棄物（焼却・埋立）の原単位は、環境省が **IDEAv2.3 を参照して作成した「事務局原単位」**
  （Ver.3.6 のシート [8][11][13] に明記）であり、環境省の公表値として利用している。IDEA データベース本体は
  同梱しない（利用者が SuMPO と契約して持ち込む: [`docs/idea-scope3-spec.md`](../../docs/idea-scope3-spec.md)）。
  **IDEA 由来と明示されている原単位を新たに追加するときは、この境界を `NOTICE` にも反映すること。**
- 出典URLが変わっていないかは年度更新のたびに確認する（`ghg-santeikohyo.env.go.jp` は廃止され
  `policies.env.go.jp/earth/ghg-santeikohyo/` へ移転した実績がある）。

## 値・出典・名称の訂正

該当年度の `data/<年度>/`（公表資料の名称・代替値はその年度の `source.json`）を直して
再生成し、再投入する。生成 SQL は `on conflict (id) do update` の upsert なので、
既存行の値・出典・名称・有効期間（`name` / `factorValue` / `unit` / `regionName` / `source` /
`providerName` / `providerNumber` / `menuName` / `factorType` / `effectiveFrom` / `effectiveTo` /
`sourceDocumentName` / `sourceUrl`）が上書きされる。`status` は上書きしない（運用で `archived` に
した行を再投入で `active` に戻さないため）。変更のない行は `where … is distinct from` で更新を
スキップするため、再投入しても `updatedAt` が動くのは実際に値が変わった行だけ。
既存行の訂正もこの手順で行う（マイグレーションに `update` を書かない: R12）。

## 原典改版の追従（rev 更新）

公表資料は公表後も改版される（ファイル名の rev 番号が上がる。例: R6年度実績の電気は R8.1.9 公表後、
R8.2.25・R8.6.4・R8.7.23・R8.8.3 に一部追加・更新。7月下旬〜8月上旬は、1月公表時に係数が確定して
いなかった事業者へ実績値が反映されるため変更が大きい）。改版では**係数値の変更だけでなく、事業者の
追加・削除・メニュー構成の変更（残差メニューの改名を含む）**が起きる（R8.8.3 版では177社でメニュー構成が
変わり、東京電力EPの残差は メニューM(残差)→メニューL(残差) になった）。年度更新のタイミングに加えて、
夏の更新後にも公表ページ（calc.html）の rev を確認すること。

手順は「値・出典・名称の訂正」と同じ（`data/<年度>/` を最新 rev で差し替え → 再生成 → 再投入）だが、
次の2点を必ず行う:

1. その年度の `source.json` の `documents`（`denki` など）を新しい版の表記に更新する。**出典表記の変更が
   「最新版に存在しない行」の検出キー**になっている（生成 SQL は upsert 後に、旧版の出典表記のまま
   残った行を後始末する）。出典表記を変えずにデータだけ差し替えると後始末が働かない
2. `source.json` の `checks` を新しい版の値で更新する（残差メニュー名の変更があればそこで検出される）

生成 SQL（年度ごとの `official_emission_factors_<年度>.sql`）が upsert の後に自動で行う後始末
（その年度の行だけが対象。冪等。詳細は `generate.ts` のコメント）:

- **残差メニューの読み替え**: 改名された旧残差行への明示選択（`activity_records."emissionFactorId"`）を、
  同一事業者・同一係数種別・同一年度の現行残差行へ付け替える（残差メニューは事業者ごとに高々1つ。
  生成時に検証する）。`emission_results` は過去の算定の記録なので付け替えない
- **消滅行のアーカイブ**: 最新版に存在しない事業者別係数行を `archived` にする。ただし
  `activity_records` から参照中の行は `active` のまま残す（`archived` にすると算定時の明示選択フィルタ
  から外れ、黙って代替値に落ちるため。残差以外は新旧メニューの対応を機械的に決められない）

再投入後は次の2つを確認する:

```sql
-- (1) 最新版に存在しないのに参照が残っていて active のまま残った行（個別対処が必要）。
--     <現行出典> はその年度の source.json の documents にある現行の出典表記（denki / gas / heat）
select ef.id, ef.name, ef."applicableYear", ef."factorValue", count(ar.id) as refs
from emission_factors ef
join activity_records ar on ar."emissionFactorId" = ef.id
where ef."organizationId" is null
  and ef.source = 'utility'
  and ef.status = 'active'
  and ef."sourceDocumentName" <> '<現行出典>'
group by ef.id, ef.name, ef."applicableYear", ef."factorValue";

-- (2) 算定時の係数と現在の明示選択・係数値が食い違う算定済みレコード（再算定の対象。
--     読み替えで付け替えたレコードと、改版で値が変わった係数で算定済みのレコードが出る。
--     appliedFactorValue が null の行はスナップショット列追加前の算定なので、値の異同は個別に確認する）
select a.id, a."organizationId", a."periodStart", f.name as current_factor,
       r."appliedFactorValue", f."factorValue" as current_value
from activity_records a
join emission_results r on r."activityRecordId" = a.id
join emission_factors f on f.id = a."emissionFactorId"
where a."isCalculated"
  and (r."emissionFactorId" is distinct from a."emissionFactorId"
    or r."appliedFactorValue" is distinct from f."factorValue");
```

(2) の再算定は「年度更新の手順」6 と同じ（対象レコードを `isCalculated = false` に戻して算定を実行する。
戻したら必ず算定まで実行すること）。

### 行の ID（安定キー）

ID は「安定キー + 年度」から md5 で決定的に導出する。安定キーには名称・値・出典を含めないため、
それらの訂正（事業者の社名変更を含む）は同じ行への更新になる。

| 種別 | 安定キー | 例 |
|---|---|---|
| 事業者別係数（電気・ガス・熱） | `energyType:登録番号:メニュー名:係数種別` | `electricity:A0269:メニューM(残差):adjusted` |
| 代替値 | `energyType:substitute` | `electricity:substitute` |
| 燃料・Scope3 原単位 | `energyType:key`（`fuels.tsv` / `scope3.tsv` の先頭列） | `fuel_kerosene:kerosene` |

安定キーの構成要素（登録番号・メニュー名・`energyType`・TSV の `key`）を変えると**別の行（新しい ID）**になり、
元の行は `active` のまま残る。原典改版でメニュー名が変わった場合の後始末は自動化されている
（「原典改版の追従」。出典表記の変更が検出キー）。出典表記が変わらない変更（転記ミスの修正で
安定キーを変えた場合など）はこの仕組みでは拾えないため、元の行を `status='archived'` にする冪等な文を
seed に出力する（「年度更新の手順」5 と同じ要領）。`fuels.tsv` / `scope3.tsv` に行を追加するときは、小文字英数字と `_` だけの
一意な `key` を付ける（一度公開した `key` は変更しない）。

## 未公表年度の扱い（暫定適用）

このスクリプトは **公表資料が存在する年度の行しか作らない**。対象年度の係数が未公表の間、
その年度の行は DB に存在しない。

同じ値を翌年度へコピー登録してはいけない。コピー行は正式な当該年度係数と DB 上で見分けが付かず、
利用者が正式値として受け取ってしまううえ、公表後に正式値へ差し替えたことを誰も検知できない。

対象年度の係数が無い間は算定側でフォールバックする（詳細は
[`docs/calculation-logic.md`](../../docs/calculation-logic.md) の「未公表年度の暫定適用」）。

- `resolveEmissionFactor` の `effectiveYearsFor` が、対象年度の公式係数が 1 件も無い energyType に限り、
  直近の過年度（`PROVISIONAL_FALLBACK_YEARS = 1` 年前まで）の公式係数を **暫定適用** する
- 入力フォームの係数詳細に「〈年度〉年度の係数を暫定適用」と理由を表示する
- 1 年前より古い係数は使わず未算定にする（根拠として説明できない値で算定しないため）。未算定は
  データ入力画面とレポートの「データ充足状況」に件数として出る

この方式のため、公表され次第 `data/<新年度>/` に公表資料と `source.json` を置いて再生成・再投入すれば
**暫定適用は自動的に止まる**（表示の消し忘れが起きない）。

ただし止まるのは**これから算定するレコード**だけで、**暫定適用で算定済みの結果は古い係数のまま残る**
（算定バッチは未算定レコードしか処理しない）。再投入後は必ず「年度更新の手順」6 の再算定まで行うこと。

### 翌年度コピー行の後始末（`official_emission_factors_cleanup.sql` の `delete`）

以前の版（#283 時点）は「翌年度公表までのつなぎ」として 2025 年度と同じ値を 2026 年度にもコピー登録
していた。その seed を投入した DB にはコピー行が `active` のまま残り、「2026 年度の正式係数」として
解決されて暫定適用も「暫定適用」の表示も効かない。

`official_emission_factors_cleanup.sql` には、`applicableYear` が収録年度の最大値より後の公式係数行を消す
冪等な `delete` が出力される。新年度のディレクトリを足せば、この文は自動的に何も消さなくなる。年度ごとの seed が
入れるのは収録年度の行だけなので、投入の順番には依存しない。過年度（収録年度の最大値より前）を足しても
このファイルは変わらない。`archived` にせず `delete`
するのは、行 ID が「安定キー + 年度」から決定的に導出されるため、将来その年度が正式公表されたときの
行が**同じ ID**になり、`status` は upsert の上書き対象外なので archived のまま不可視になってしまうため。

削除対象は**どこからも参照されていない行だけ**に限っている（`emission_results` / `activity_records`
から参照されている行は `not exists` で除外する）。両テーブルの FK は `on delete set null` なので、
参照されている行を消すと算定済み結果から根拠係数の記録が消え、手動入力で明示選択した係数の指定も
黙って外れて再算定で代替値に戻るため。`emission_results` の `appliedFactorValue` /
`appliedFactorName` スナップショットは後から追加した列で、それ以前に算定された行は null のまま
（遡って埋められない）ので、スナップショットだけでは根拠を担保できない。

参照の有無は**行単位ではなく `energyType` + 年度の単位**で判定し、参照が 1 件でも残るグループは
コピー行を**全部残す**（#405）。行単位で判定すると「参照の付いた事業者別の行だけが残る」部分削除状態に
なり、次の形で**全組織の未算定**を招くため:

- 残存行があるので `officialYearIndex`（`resolveEmissionFactor`）はその `energyType` のその年度を
  「公表済み」と数え、**暫定適用が発動しなくなる**
- 一方で自動解決の唯一の受け皿である代替値行（`providerName` なし）は参照が無いので削除済みで、
  事業者別係数は自動解決の対象外（`tierOf`）。候補が 1 件も無く**すべて未算定（`not_found`）**になる
- 公式係数は `organizationId is null` の全組織共有なので、**1 組織の明示指定が全組織に波及する**

グループ全残しなら旧 seed 投入直後と同じ状態（コピー行がその年度の係数として解決される）のまま動き、
その年度が正式公表されてディレクトリが足されれば、同じ ID の upsert で正式値に上書きされて解消する。

> **注意**: 参照が残っているコピー行はこの `delete` では消えず、`active` のまま「その年度の正式係数」
> として解決され続ける（＝その `energyType`・その年度は暫定適用も「暫定適用」の表示も効かない）。
> 稼働中 DB へ再投入したあとは次のクエリで残存行を確認し、参照元の活動量・
> 算定結果を確認したうえで個別に対処すること（該当年度が正式公表されていれば、その年度のディレクトリを足して
> 再生成・再投入すれば同じ ID の行が正式値で上書きされ、解消する）。
>
> ```sql
> select ef.id, ef.name, ef."applicableYear", ef."factorValue"
> from emission_factors ef
> where ef."organizationId" is null
>   and ef."applicableYear" > 2025
> order by ef."applicableYear", ef.name;
> ```

## 年度更新の手順

1. 新年度のディレクトリ `data/<新年度>/` を作り、新年度の公表資料から 5 ファイルを置く
   （PDFは `pdftotext -layout 元.pdf data/<新年度>/denki.txt`）。過年度のディレクトリは**変更しない**。
   燃料（算定省令別表）や Scope3 原単位のように前年度から変わらない資料も、新年度の資料で確認したうえで
   新年度のディレクトリに置く（ファイル先頭の出典表示も新年度の資料に合わせる）
2. 新年度のディレクトリに `source.json` を置く（前年度のものを写して書き換える）。公表資料の名称（`documents`）・
   排出原単位 DB の版・都市ガスと熱の代替値・スポットチェック（`checks`）を新年度の資料に合わせて書く。
   電気・ガス・熱の公表資料名が過年度と同じだと、資料の差し替え忘れとして生成が止まる。`generate.ts` は変更しない
3. `node scripts/official-factors/generate.ts` で生成し、スクリプトの件数 assert・スポットチェックが
   通ることを確認する
4. `npm run db:reset`（または稼働中 DB へ `npm run db:seed:production`）で再投入して確認する。
   クラウドへは `npx supabase db push --include-seed`
5. 過年度の行を `status='archived'` にする必要がある場合は、マイグレーションではなく `generate.ts` から
   冪等な文を seed に出力する（例:
   `update emission_factors set status = 'archived' where "organizationId" is null and "applicableYear" < 2026 and status = 'active';`。
   何度流しても同じ結果になる）
6. **暫定適用で算定済みのデータを再算定する**（#382）。未公表の間に暫定適用で算定した結果は、正式係数を
   投入しても自動では置き換わらない。投入後にデータ入力画面を開くと「暫定適用で算定したデータが N 件あります」
   のバナーが出るので、「正式係数で再算定」から組織ごとに再算定する（該当レコードを `isCalculated = false` に
   戻してから通常の算定バッチを流す。詳細は
   [`docs/calculation-logic.md`](../../docs/calculation-logic.md) の「公表後の再算定」）。
   対象の有無は SQL でも確認できる（下記）

生成される ID は安定キーから決定的に導出（md5）されるため、同じ入力からは常に同じ SQL になり、
`on conflict (id) do update` により再投入は冪等。

### 暫定適用のまま残っている算定済みデータの確認（管理者向け SQL）

手順 6 の対象が組織をまたいでどれだけ残っているかを確認する（アプリ側の
`isSupersededProvisionalFactor` と同一の判定。レコードの温対法年度だけで決まるため、
非4月始まりの会計年度が温対法年度をまたいだ月も含めて厳密に拾える）。

```sql
select r."organizationId", f."energyType", f."applicableYear" as applied_year, count(*)
from emission_results r
join activity_records a on a.id = r."activityRecordId"
join emission_factors f on f.id = r."emissionFactorId"
cross join lateral (
  -- periodStart の温対法年度（4月〜翌3月。1〜3月は前年扱い）= deriveApplicableYear と同じ
  select extract(year from a."periodStart")::int
       - case when extract(month from a."periodStart") < 4 then 1 else 0 end as target_year
) t
where a."isCalculated"
  and not f."isCustom"
  and f."applicableYear" < t.target_year
  and exists (
    select 1 from emission_factors current
    where current."energyType" = f."energyType"
      and current."applicableYear" = t.target_year
      and current.status = 'active'
      and not current."isCustom"
  )
group by 1, 2, 3
order by 1, 2;
```

`update activity_records set "isCalculated" = false where id in (…)` で直接戻すこともできる
（旧 `emission_results` はトリガーが消す）が、その場合は戻したあとに必ず算定を実行すること。
実行しないとその分の排出量が未算定のまま残る。

## 過年度の公式係数を自分で登録する

OpenGreenTrack は OSS のため、リポジトリには公表資料のある最近の年度（現在は 2025 年度）の公式係数だけを収録し、
それより前の年度は同梱しない。基準年度や過年度の活動量を公式係数で算定したい導入先は、公的データから
公表資料を取得して自分で登録する。暫定適用は 1 年前までしか遡らないため、収録していない年度の活動量は
登録するまで未算定（データ充足状況に件数が出る）になる。

### 方法 1: シードとして登録する（事業者別係数を含めて公式係数として入る）

導入先のリポジトリ（フォーク）で行う。年度ごとにファイルが分かれているため、追加した年度のディレクトリと
seed は OSS 側の年度のファイルと衝突しない（OSS 側の更新を取り込んでも、追加した年度はそのまま残る）。

1. 対象年度の公表資料を入手する
   - 電気・ガス・熱の事業者別排出係数と、燃料の排出係数（「算定方法・排出係数一覧」）:
     [「温室効果ガス排出量 算定・報告・公表制度」](https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html)
     の排出係数のページ（過年度の公表資料も同じページから辿れる）
   - Scope3 代表原単位: [「排出原単位データベース」](https://www.env.go.jp/earth/ondanka/supply_chain/gvc/estimate_05.html)
     の、その年度に使う版
   - どの公表回をどの適用年度（温対法年度）に使うかは、算定・報告・公表制度のマニュアルに従って判断する
     （収録済みの年度の対応は `data/2025/source.json` の `documents` を参照）
2. `data/<年度>/` を作り、「データソース」の表の 5 ファイルを置く。書式は `data/2025/` の各ファイルと同じ
   （電気は公表 PDF を `pdftotext -layout` でテキスト化、ガス・熱・燃料・Scope3 は TSV に転記。燃料・Scope3 の
   `key` 列は行の安定キーなので、2025 年度と同じ係数には同じ `key` を使う）
3. `data/2025/source.json` を写して `data/<年度>/source.json` を作り、公表資料名・代替値・版・スポットチェックを
   その年度の資料に合わせて書き換える
4. `node scripts/official-factors/generate.ts` で生成する。`seeds/production/official_emission_factors_<年度>.sql` が
   増え、ほかの年度のファイルは変わらない
5. 「投入方法」のとおり投入する（稼働中の DB へは `npm run db:seed:production`、クラウドへは
   `npx supabase db push --include-seed`）

注意:

- 電気の公表 PDF の書式が年度によって異なり、`parse.ts` で読めない場合がある。生成が止まったときは `parse.ts` の
  対応が必要（件数の下限やスポットチェックを `checks` に書いておくと、読み違いに気づける）
- 追加したファイルにも出典と加工した旨の表示を残す（「データソースの利用条件」）。`data/2025/` の各ファイル先頭の
  表示をその年度の公表資料に合わせて書く

### 方法 2: アプリの係数 CSV 取込でカスタム係数として登録する

係数管理画面の「CSVインポート」で、その年度の代替値・燃料などの係数を**カスタム係数**として組織ごとに登録できる
（コードやシードを触らない）。算定には使えるが、次の制約がある。

- 事業者別係数（供給事業者・メニュー・係数種別のある行）は CSV から登録できない
- 公式係数ではなく組織のカスタム係数として扱われる（一覧の種別が「カスタム」になり、組織ごとに登録が要る）
