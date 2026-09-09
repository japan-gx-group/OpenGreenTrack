# 公式排出係数のシード生成

環境省・経済産業省の公表資料から公式排出係数マスタ（`emission_factors` の
`organizationId is null` 行）のシード SQL を生成するスクリプト。

生成物 `supabase/seeds/production/official_emission_factors.sql` は、GreenTrack の初期データのうち
**本番環境にも投入する共通マスタ**（seed）。データはマイグレーション（スキーマ定義）には置かず、
seed として管理する（`AGENTS.md` R12）。
テスト/デモ用の `supabase/seeds/demo/demo.sql` とは独立していて、どちらか一方だけでも投入できる。

```bash
node scripts/official-factors/generate.ts
# => supabase/seeds/production/official_emission_factors.sql を上書き生成
```

## 投入方法

| 目的 | コマンド |
|---|---|
| ローカル DB 作り直し（スキーマ + 本番マスタ） | `npm run db:reset`（= `npx supabase db reset`。`config.toml` の `[db.seed].sql_paths` で自動投入） |
| 稼働中ローカル DB へ（再）投入 | `npm run db:seed:production`（= `node scripts/db/seed.ts production`。ローカル Supabase の DB コンテナ内で `psql` を実行） |
| 任意の DB（クラウド / 自前ホスト）へ（再）投入 | `npm run db:seed:production -- --db-url postgresql://…`（ホストの `psql` を使用。無ければ Dashboard の SQL Editor でファイルの内容を実行） |
| クラウド（スキーマ + 本番マスタ） | `npx supabase db push --include-seed`（`config.toml` の `sql_paths` = production だけが流れる） |

## データソース（data/）

| ファイル | 内容 | 由来 |
|---|---|---|
| `denki.txt` | 電気事業者別排出係数（R8.1.9公表・R8.6.4更新） | 公表PDFを `pdftotext -layout` で抽出した生テキスト。`parse.ts` がパースする |
| `gas.tsv` | ガス事業者別排出係数（R8.6.30公表） | 公表PDFから手書き転記（件数が少なくレビュー可能にするため） |
| `heat.tsv` | 熱供給事業者別排出係数（R8.6.30公表） | 同上 |
| `fuels.tsv` | 燃料の排出係数（算定省令別表） | 「算定方法・排出係数一覧」p.23 から手書き転記。先頭列 `key` は行の安定キー（後述） |
| `scope3.tsv` | Scope3 代表排出原単位 | 排出原単位データベース Ver.3.6 から厳選・転記。先頭列 `key` は行の安定キー（後述） |

公表元:

| 公表元 | URL | 対象 |
|---|---|---|
| 「温室効果ガス排出量 算定・報告・公表制度」（環境省・経済産業省） | https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html | `denki.txt` / `gas.tsv` / `heat.tsv` / `fuels.tsv` |
| 「排出原単位データベース Ver.3.6」（環境省。2026年4月リリース） | https://www.env.go.jp/earth/ondanka/supply_chain/gvc/estimate_05.html | `scope3.tsv` |

### データソースの利用条件（変更時に必ず読むこと）

同梱データは **Apache License 2.0 の対象外**で、リポジトリ直下の [`NOTICE`](../../NOTICE) が正本。

- 両公表元とも環境省ウェブサイトの[利用規約](https://www.env.go.jp/mail.html)（**公共データ利用規約（第1.0版）**。
  政府標準利用規約（第2.0版）準拠、**CC BY 4.0 互換**）に基づく。商用利用・改変・再配布が可能で、条件は
  **①出典の記載 ②編集・加工したこと及びその主体の記載**の2つ。本リポジトリでは加工の主体は Japan GX Group。
- そのため `data/` の各ファイル先頭・生成SQLのヘッダ・`NOTICE`・`README.md` に出典と加工した旨を書いている。
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

`data/` を直して再生成し、再投入する。生成 SQL は `on conflict (id) do update` の upsert なので、
既存行の値・出典・名称・有効期間（`name` / `factorValue` / `unit` / `regionName` / `source` /
`providerName` / `providerNumber` / `menuName` / `factorType` / `effectiveFrom` / `effectiveTo` /
`sourceDocumentName` / `sourceUrl`）が上書きされる。`status` は上書きしない（運用で `archived` に
した行を再投入で `active` に戻さないため）。変更のない行は `where … is distinct from` で更新を
スキップするため、再投入しても `updatedAt` が動くのは実際に値が変わった行だけ。
既存行の訂正もこの手順で行う（マイグレーションに `update` を書かない: R12）。

### 行の ID（安定キー）

ID は「安定キー + 年度」から md5 で決定的に導出する。安定キーには名称・値・出典を含めないため、
それらの訂正（事業者の社名変更を含む）は同じ行への更新になる。

| 種別 | 安定キー | 例 |
|---|---|---|
| 事業者別係数（電気・ガス・熱） | `energyType:登録番号:メニュー名:係数種別` | `electricity:A0269:メニューM(残差):adjusted` |
| 代替値 | `energyType:substitute` | `electricity:substitute` |
| 燃料・Scope3 原単位 | `energyType:key`（`fuels.tsv` / `scope3.tsv` の先頭列） | `fuel_kerosene:kerosene` |

安定キーの構成要素（登録番号・メニュー名・`energyType`・TSV の `key`）を変えると**別の行（新しい ID）**になり、
元の行は `active` のまま残る。その場合は元の行を `status='archived'` にする冪等な文を seed に出力する
（「年度更新の手順」5 と同じ要領）。`fuels.tsv` / `scope3.tsv` に行を追加するときは、小文字英数字と `_` だけの
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

この方式のため、公表され次第 `data/` を差し替えて `YEARS` に年度を足し、再生成・再投入すれば
**暫定適用は自動的に止まる**（表示の消し忘れが起きない）。

ただし止まるのは**これから算定するレコード**だけで、**暫定適用で算定済みの結果は古い係数のまま残る**
（算定バッチは未算定レコードしか処理しない）。再投入後は必ず「年度更新の手順」6 の再算定まで行うこと。

### 翌年度コピー行の後始末（生成 SQL 末尾の `delete`）

以前の版（#283 時点）は「翌年度公表までのつなぎ」として 2025 年度と同じ値を 2026 年度にもコピー登録
していた。その seed を投入した DB にはコピー行が `active` のまま残り、「2026 年度の正式係数」として
解決されて暫定適用も「暫定適用」の表示も効かない。

生成 SQL の末尾には、`applicableYear` が収録年度の最大値より後の公式係数行を消す冪等な `delete` が
出力される。`YEARS` に新年度を足せば、この文は自動的に何も消さなくなる。`archived` にせず `delete`
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
その年度が正式公表されて `YEARS` に足されれば同じ ID の upsert で正式値に上書きされて解消する。

> **注意**: 参照が残っているコピー行はこの `delete` では消えず、`active` のまま「その年度の正式係数」
> として解決され続ける（＝その `energyType`・その年度は暫定適用も「暫定適用」の表示も効かない）。
> 稼働中 DB へ再投入したあとは次のクエリで残存行を確認し、参照元の活動量・
> 算定結果を確認したうえで個別に対処すること（該当年度が正式公表されていれば、`YEARS` に足して
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

1. 新年度の公表資料を取得し、`data/` の各ファイルを更新する
   （PDFは `pdftotext -layout 元.pdf data/denki.txt`）
2. `generate.ts` の `YEARS` に新年度を**追加**する（過年度は消さない。出力ファイル名は固定で変えない）
3. `node scripts/official-factors/generate.ts` で生成し、スクリプトの件数 assert・スポットチェックが
   通ることを確認する
4. `npm run db:reset`（または稼働中 DB へ `npm run db:seed:production`）で再投入して確認する。
   クラウドへは `npx supabase db push --include-seed`
5. 過年度の行を `status='archived'` にする必要がある場合は、マイグレーションではなく `generate.ts` から
   冪等な文をこの seed の末尾に出力する（例:
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
