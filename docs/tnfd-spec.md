# TNFD 開示レポート（試行版 R1）仕様

TNFD（自然関連財務情報開示タスクフォース）の開示提言に沿った開示レポートの下書きを、OGT の組織・年度・算定値と
つないで作成・保存・確認するための機能の仕様書。**各機能が共通で守るデータ契約の正本**であり、
型は `src/features/tnfd/types.ts`、架空の検証データは `src/features/tnfd/__fixtures__/fictionalReport.ts` に置く。

**この機能は SSBJ 開示レポート（[`ssbj-spec.md`](ssbj-spec.md)）の設計を踏襲する。** 同じ判断は繰り返し書かず、
「SSBJ と同じ（`ssbj-spec.md` §n）」と参照する。違うところ・TNFD にしか無いところだけを本文で説明する。
各章の「なぜ」は、後から加わるメンバーが同じ判断を再現できるように書いている。
変更するときは、この文書・`types.ts`・架空データ・テストを同じ PR で揃えること。

> 関連: 規約 [`AGENTS.md`](../AGENTS.md) / 画面・URL [`functional-spec.md`](functional-spec.md) /
> OGT の算定範囲と制約 [`coverage-and-limitations.md`](coverage-and-limitations.md) /
> 踏襲元 [`ssbj-spec.md`](ssbj-spec.md) / 法人別集計 [`reporting-entity-design.md`](reporting-entity-design.md)（R2-15 設計書・未実装）

| 項目 | 内容 |
|---|---|
| 版 | v0.2（TN-01 実装中） |
| 作成日 | 2026-10-30 |
| 作成 | TNFD チーム（PL） |
| 準拠する文書 | **Recommendations of the TNFD, October 2026**（4本柱・14の開示提言。2023年 v1.0 から数と構成は不変、コア指標の確定と環境犯罪の一般要件が追加） |
| 将来の整合先 | ISSB **IFRS Sustainability Disclosure Practice Statement 1 _Nature-related Disclosures_**（公開草案 2026-10-22、コメント期限 2027-02-19、最終化未定、準拠は任意） |
| 着手の基点 | `ssbj` ブランチ。**main から生やさない**（§16）。`ssbj` は 10/23・10/29 に main を取り込み済みで、残差は数コミット（2026-11-04 時点で 3 本・衝突なし） |

---

## 1. 位置付け

- R1 は**社内確認用の試行版**である。TNFD 提言への準拠の認定、第三者保証、対外提出の完了を意味しない。
- 画面・プレビュー・CSV・文書のいずれでも、準拠や提出完了を保証すると読める表現をしない。
- 提言のラベル（Governance A など）・ISSB 草案の段落番号は、確認していないものを確定情報として書かない。
  提言本文も転載しない（要求項目は ID と記載ガイドで扱う。§3）。
- **到達点は「開示情報の集約・出力支援」。** 文章の自動生成、LEAP 評価の実施、外部データとの照合による自動判定は
  R1 の対象外とし、後から足せる形だけを用意する（§10・§15）。

**なぜ:** SSBJ と同じ（`ssbj-spec.md` §1）。加えて TNFD は、開示提言（何を開示するか）と LEAP（どう評価するか）が
別の文書で、LEAP は任意の評価手法である。本機能は開示側だけを扱い、評価側は空けておく。両者を分けておけば、
評価結果から複数の開示項目を生成でき、ISSB・GRI・ESRS へ転用しやすい。

## 2. ルート計画

後続タスクが URL を揃えるための表。実装は各タスクが行い、実装したら `functional-spec.md` §4 と
`directory-structure.md` のルート一覧にも反映する。

| URL | 画面 | 担当タスク |
|---|---|---|
| `/tnfd` | レポート一覧・新規作成 | TN-02 |
| `/tnfd/[reportId]` | 基本情報の表示・編集、手動保存 | TN-02 / TN-03 |
| `/tnfd/[reportId]/narratives` | 四本柱の文章（14提言＋一般要件＋企業固有の補足） | TN-04 |
| `/tnfd/[reportId]/metrics` | コア指標（GHG の候補値の採用＋手入力指標） | TN-05 |
| `/tnfd/[reportId]/locations` | 拠点の自然関連情報（戦略D：位置情報・センシティブロケーション） | TN-06 |
| `/tnfd/[reportId]/judgements` | 該当性・重要性・記載しない理由 | TN-07 |
| `/tnfd/[reportId]/evidence` | 根拠文書・主管部署 | TN-08 |
| `/tnfd/[reportId]/versions` | 保存履歴・過去版からの新版作成・CSV 出力 | TN-10 |
| `/tnfd/[reportId]/preview` | 簡易プレビュー | TN-09 |
| `/tnfd/[reportId]/preview/print` | プレビューの印刷ビュー（PDF） | TN-09 |

機能コードはすべて `src/features/tnfd/` に置く（1 ドメイン。関心ごとはファイル名で分ける）。
API は `src/app/api/tnfd/reports/[reportId]/…` に置く（SSBJ の `api/ssbj/…` と同じ並び）。

**SSBJ との違い:**

- `/ssbj/[reportId]/risks`（リスク・機会の構造化リスト）に相当する画面は **R1 では作らない。** 戦略A の
  依存・インパクト・リスク・機会は文章（`strategy.dependencies_impacts_risks_opportunities`）で受ける。
- `/tnfd/[reportId]/locations` は **TNFD 固有**。SSBJ に対応物は無い。
- `/ssbj/[reportId]/ghg` は TNFD では `/metrics` に含める（GHG はコア指標の一部であり、手入力指標と同じ画面で扱う）。

**なぜ:** `/reports`（GHG 排出量レポート）・`/ssbj` と混同しないよう `/tnfd` に分ける。
リスク・機会を R1 で文章にするのは、到達点が「集約・出力支援」であり、構造化（種類・時間軸・財務影響）は
LEAP の評価側に属するため（§1）。構造化が要る場面では SSBJ の `SsbjRiskOpportunity` を型ごと写して足せる。

## 3. 識別子

| 対象 | 形式 | 例 | 型 |
|---|---|---|---|
| レポート | UUID（`tnfd_reports.id`。DB が生成） | `7c2e…0004` | `TnfdReportId` |
| 章（四本柱） | 固定 4 値 | `governance` / `strategy` / `risk_impact_management` / `metrics_targets` | `TnfdSectionId` |
| 項目 | `<章ID>.<slug>`（slug は `[a-z0-9_]+`） | `governance.board_oversight` | `TnfdItemId` |
| 要求項目 | `REQ-<基準コード>-<3桁連番>` | `REQ-TNFD-001` | `TnfdRequirementId` |
| 指標 | `<slug>`（`[a-z0-9_]+`。TNFD のコードは別列） | `ghg_scope1` / `water_withdrawal` | `TnfdMetricId` |
| 保存版 | UUID（`tnfd_report_versions.id`）＋ レポート内連番 `versionNumber`（1 始まり） | 版 1, 版 2 … | `TnfdVersionId` |

- 基準コード: `TNFD` = TNFD 開示提言（October 2026）/ `ISSB` = ISSB 実務記述書（公開草案。最終化後に版を上げる）。
- 形式の正規表現は `utils/ids.ts` を正本とする。DB の check 制約を書くときも同じ式にする。
  - 項目: `^(governance|strategy|risk_impact_management|metrics_targets)\.[a-z0-9_]+$`
  - 要求: `^REQ-(TNFD|ISSB)-\d{3}$`
  - 指標: `^[a-z][a-z0-9_]*$`
- レポートは必ず 1 つの組織・1 つの算定年度（`fiscal_years`）に結び付く。
- 章の表示ラベルは `TNFD_SECTION_LABELS`（ガバナンス / 戦略 / リスクとインパクトの管理 / 指標と目標）。
  SSBJ の章ラベルと**揃えない**（SSBJ は「リスク管理」「指標及び目標」。基準の語に合わせる）。

**なぜ:**

- 項目 ID・要求 ID・指標 ID は**アプリ内の安定キー**であり、提言のラベル（Governance A）や指標コード（C2.0）ではない。
  **TNFD は 2026年10月の改訂で暫定だった指標コード（C4.0 / C5.0 / C5.1 / C5.2）を確定させた。** コードを ID に
  埋め込んでいたら、保存版の指標がこの改訂で全部付け替えになっていた。ラベル・コードとの対応は要求項目マスター・
  指標マスターの別の列で持つ（SSBJ と同じ理由。`ssbj-spec.md` §3）。
- 章 ID の `risk_impact_management` は SSBJ の `risk_management` と**意図的に別**にする。TNFD の柱は
  「リスク**とインパクト**の管理」で、SSBJ と中身が違う。将来 2 つのレポートを横断で見るときに取り違えないため。
- 1 つの文章が複数の要求項目を説明できるよう、文章（項目）と要求項目の関連は多対多で持つ（SSBJ と同じ）。

## 4. 値の状態（未入力・未確認・非該当・0 の区別）

**SSBJ と同じ**（`ssbj-spec.md` §4）。`unanswered` / `unconfirmed` / `not_applicable` / `answered` の 4 状態を
値と別に持ち、未入力を 0・空文字・「なし」に置き換えない。

- 型は判別共用体 `TnfdFieldValue<T>`（中身は `SsbjFieldValue<T>` と同形）。表示・DB 変換は `utils/fieldValue.ts` に一本化する。
- **DB の enum は `ssbj_field_state` を参照して使う。TNFD 用に別の enum を作らない。**
  列名の規約（`"<名前>State"` + `"<名前>"` の対、check 制約）は SSBJ と同じ。

**なぜ:** 4 状態の意味は SSBJ と完全に同じで、enum を 2 つ作ると後で統合するときに型の付け替えが要る。
名前に `ssbj_` が付いているのは座りが悪いが、`disclosure_field_state` への改名（汎用化）は
SSBJ R2 が落ち着いてから両方同時にやる（§15 未決事項）。R1 で SSBJ の土台を動かさない。

## 5. 開示する文章と内部記録の区分

**SSBJ と同じ**（`ssbj-spec.md` §5）。`disclosure…` と `internal…` を別の列・別のプロパティに分ける。
型 `TnfdDisclosableText = { disclosure: TnfdFieldValue<string>; internalNote: string | null }`。

## 6. 数値と単位

- 数値は**十進表記の文字列**（`TnfdDecimalString`。`ssbj-spec.md` §6 と同じ形式・同じ検証）で受け渡す。`number` に変換して計算・丸めしない。
- **単位は指標ごとに違う**（SSBJ は `t-CO2e` 固定だった）。単位は指標マスター（別表B）が既定値を持ち、
  手入力指標では保存時に単位も一緒に保存する。GHG は `t-CO2e` 固定（`OGT_EMISSION_UNIT` を再利用）。
- 単位の表記は指標マスターの `unit` 列の文字列を正とする（`km²` / `m³` / `t` …）。利用者が単位を変えられるのは
  マスターに `unitSelectable: true` が付いた指標だけ。

**なぜ:** TNFD のコア指標は面積・体積・質量・件数が混在する。単位を値と別に保存しないと、
CSV に出したときに「数値だけ並んで何の単位か分からない」帳票になる。

## 7. OGT 採用値（GHG）の形式

**SSBJ の `OgtCandidateValue` / `OgtAdoptedValue` をそのまま使う**（`ssbj-spec.md` §7）。
候補値の取得・`dataQuality` の判定・取得元・サプライヤー値の扱い（二重加算の防止）・対象ガスの注記は SSBJ と同じ。
TNFD 固有の差分だけを書く。

### 7.1 TNFD で扱う GHG の値

| 指標 ID | 内容 | 取得元 |
|---|---|---|
| `ghg_scope1` | Scope 1 年度合計 | `dashboard_aggregates.scope1Total` |
| `ghg_scope2` | Scope 2 年度合計（従来の単一値。温対法の係数区分に基づく） | `dashboard_aggregates.scope2Total` |
| `ghg_scope2_location_based` | Scope 2 ロケーション基準 | `dashboard_aggregates.scope2LocationBasedTotal` |
| `ghg_scope2_market_based` | Scope 2 マーケット基準（契約根拠分＋代替値補完分） | `dashboard_aggregates.scope2MarketBasedTotal` |
| `ghg_scope2_market_contract` | うち契約根拠（明示選択されたメニュー別係数）に基づく分 | `dashboard_aggregates.scope2MarketContractTotal` |
| `ghg_scope3` | Scope 3 年度合計 | `dashboard_aggregates.scope3Total` |
| `ghg_scope3_category_<n>` | Scope 3 カテゴリ別（1〜15） | RPC `dashboard_scope3_category_emissions` |

- **基準別の Scope 2 は `null`（未算定）がありうる。** OGT は「年度内の全 Scope 2 明細に基準別行が揃ったときだけ値を入れ、
  部分合計は出さない」（`calculation-logic.md`「Scope 2 の基準別算定」）。`null` のときは `dataQuality = not_calculated`・
  値は `unanswered` とし、0 を入れない。画面には「基準別の算定が揃っていない」と出す。
- **基準別の値は SSBJ がすでに `basisTotals`（`locationBased` / `marketBased` / `marketContract`）として候補値に持っている**
  （`ssbj-spec.md` §7.2・10/29 #174。RPC `ssbj_ogt_numeric_values` が十進文字列で返し、列が `null` なら `unanswered`）。
  **TNFD は `OgtCandidateValue` をそのまま使い、基準別の取得を自前で足さない。** 上表の `ghg_scope2_*` は
  `basisTotals` の各値に対応する表示上の指標 ID で、取得経路は 1 本（§7.3）。
- 証書・クレジット等の環境価値の控除は OGT が未対応。注記に載せる（SSBJ と同じ）。

### 7.2 開示に載せる Scope 2

TNFD の「指標と目標 B」の GHG は、GHG プロトコルに沿った開示を想定する。R1 では **ロケーション基準・マーケット基準・
従来の単一値の 3 つを候補値として並べ、どれを採用するかは利用者が明示的に選ぶ**（採用値は 1 つ以上）。

- 採用値ごとに「基準」「根拠種別（契約根拠／代替値補完）」のラベルをプレビュー・CSV に必ず出す。
- 従来の単一値を採用する場合は「温対法の係数区分に基づく値であり、GHG プロトコルの 2 基準とは定義が異なる」旨を注記に出す。

**なぜ:** SSBJ 気候基準はロケーション基準の開示を必須とし、契約証書の情報に代えてマーケット基準を開示できる
（第53項・第54項ただし書き）。TNFD は GHG プロトコル準拠を想定するが、どの値を主にするかは利用者の判断に属する。
ツール側で決め打ちせず、候補をすべて見せて採用を記録するのが「集約・出力支援」の立場に合う。
**同じツールの SSBJ レポートと TNFD レポートで Scope 2 の数値と呼称が食い違わないよう、取得処理は SSBJ の
`ogtCandidateService` を共用し、TNFD 側で再実装しない**。SSBJ は採用時に「基準の区別なし＋両方の基準」を
まとめて保存版に残す方式（`ssbj-spec.md` §7.2）なので、TNFD もこれに合わせ、採用の単位を「Scope 2 一式」にする。

### 7.3 法人別集計（`reporting-entity-design.md`）との関係

SSBJ 担当チームが設計中の法人別集計（R2-15 設計書。**実装は R2-16 以降で、R1 の時点では未実装**）は、組織の中に法人を登録し、
拠点を法人に所属させ、出資関係の版と測定アプローチで取り込み割合を掛けて集計する。**法人を登録しない組織は従来どおり
「組織全体を 1 つの報告単位」として扱う**と明記されている。

**TNFD R1 の `boundary: { kind: 'organization' }` は、この「法人未登録」の経路と同じもの。** 矛盾はない。
ただし法人別集計が入ったときに TNFD が置き去りにならないよう、次を守る。

| 場所 | R1 | 法人別集計の後 | 受け皿 |
|---|---|---|---|
| GHG の候補値 | 組織全体の `dashboard_aggregates` | 報告主体と測定アプローチを反映した共通集計処理の値 | TNFD は SSBJ と同じ候補値サービスを使う（§7.2）。**SSBJ 側が共通集計処理へ切り替われば TNFD も同時に乗る。** TNFD 側で別の取得経路を作らない |
| 手入力指標の `boundary` | `{ kind: 'organization' }` | 法人ごとの値 | `{ kind: 'entity', entityId, structureVersionId }` を**後から足す**（§8.2）。R1 では型に用意しない |
| 拠点一覧（§9） | 組織の全拠点 | 報告主体に所属する拠点 | `location_entity_assignments` で絞る。R1 は絞らない |
| `tnfd_reports` の報告設定 | 組織・年度のみ | 報告主体の法人 ID・構成の版・測定アプローチ | **SSBJ レポートに足される列と同じ名前・同じ型で足す**（U-10）。別名にしない |

**なぜ:** 法人別集計の設計は「共通のサーバー側処理が集計値と内訳を返し、画面や PDF が別々の式で再計算しない」方針を取る。
TNFD が GHG を独自に取りに行くと、法人別集計が入った瞬間に SSBJ と TNFD で数値が食い違う。取得経路を 1 本にしておけば、
切替は SSBJ 側の 1 回で済む。手入力指標は OGT の実績から計算しないので持分は自動では掛からない。法人別の値が要るなら
`boundary` を広げて法人ごとに入力してもらう形になる（自然の側の軸＝拠点別・生態系タイプ別の内訳とは別の軸）。

## 8. コア指標（手入力）の形式

GHG 以外のコア指標は利用者が手入力する。**どの指標に入力欄を用意するかは絞る**（PL 決定）。
具体の指標は別表B を見て専門家（生物多様性）が選定し、選定結果を指標マスター（`utils/metricMaster.ts`）に反映する。

### 8.1 指標マスター（コード定数）

| 列 | 内容 |
|---|---|
| `metricId` | `TnfdMetricId`（安定キー。§3） |
| `tnfdCode` | TNFD のコード（`C1.0` など。**October 2026 版で確定したもの**。版が変わりうるので ID にしない） |
| `category` | 分類（気候変動 / 陸・淡水・海洋の利用変化 / 資源利用 / 汚染 / 侵略的外来種 / 自然の状態 / リスク・機会） |
| `label` | 表示名（日本語） |
| `unit` / `unitSelectable` | 既定の単位と、利用者が変えられるか |
| `inputKind` | `auto`（OGT 採用値）/ `manual_number`（数値＋単位＋補足文）/ `manual_text`（文章のみ） |
| `enabledInR1` | R1 で入力欄を出すか（**専門家選定の結果**） |
| `guidance` | 画面に出す記入ガイド |
| `requirementIds` | 対応する要求項目（§3） |
| `TNFD_METRIC_MASTER_VERSION` | マスターの版。保存版に指標 ID を残す機能は、この版も一緒に残す |

- **DB ではなくコードの定数に置く**（SSBJ の要求項目マスターと同じ理由。`AGENTS.md` R12）。
- `enabledInR1 = false` の指標は画面に出さないが、**マスターからは消さない**。プレビュー・CSV は「R1 では対象外」と明示して名前だけ出す
  （黙って落とさない。`ssbj-spec.md` T12 の方針と同じ）。

### 8.2 手入力値の形式（`TnfdMetricValue`）

| 項目 | 内容 |
|---|---|
| `metricId` | 指標 ID |
| `value` | `TnfdFieldValue<TnfdDecimalString>`（`manual_text` の指標は `TnfdFieldValue<string>`） |
| `unit` | 保存時の単位（マスターの既定値を複写。`unitSelectable` のときだけ変更可） |
| `boundary` | 集計範囲。R1 は `{ kind: 'organization' }` のみ。将来の拡張は 2 軸: 自然の側（`location` / 生態系タイプ別）と会社の側（`entity`。§7.3）。どちらも型を足すだけで R1 の値は読める |
| `method` | 算定方法の説明（文章。`disclosure` / `internalNote` の対。§5） |
| `source` | `{ kind: 'manual', enteredBy, enteredAt }`。OGT 採用値は `{ kind: 'ogt', … }`（§7） |
| `updatedByUserId` / `updatedAt` | 監査用 |

- **`source.kind` で手入力と OGT 由来を区別する。** 将来の外部データ連携は `kind: 'external'` を足すだけにする。
- 数値 0 は `answered` かつ `"0"`。未入力は `unanswered`。「該当しない」は `not_applicable`（SSBJ と同じ）。

**なぜ:** TNFD 2026 Status Report では、14 項目中の平均開示数が 8.1 で、汚染関連の指標が最も報告が難しいとされる。
欄を全部用意すると空欄だらけの帳票になり、「できていない」と読まれる。絞った指標に `enabledInR1` で印を付け、
残りはマスターに残しておけば、後から欄を増やすのは印を変えるだけで済む。

## 9. 拠点の自然関連情報（戦略D）

TNFD 固有のセクション。拠点ごとに、位置情報とセンシティブロケーション該当有無を記録する。
**粒度は「該当有無＋根拠テキスト＋住所・緯度経度（任意入力）」。外部データとの照合による自動判定はしない**（PL 決定）。

### 9.1 `locations` への追加（マイグレーション・追加のみ）

| 列 | 型 | 制約 | 備考 |
|---|---|---|---|
| `latitude` | numeric(9, 6) | NULL 可。check `-90 〜 90` | 任意入力 |
| `longitude` | numeric(9, 6) | NULL 可。check `-180 〜 180` | 任意入力 |

- 既存の `address` / `prefecture` は「未使用」扱いだった（`database-design.md` §3.3）。**TNFD の拠点画面から読み書きする列に格上げする。**
  `functional-spec.md` §3 の「未使用」記載と `database-design.md` を同じ PR で更新する。
- 拠点管理の既存画面（`/locations`）は触らない。入力は `/tnfd/[reportId]/locations` からだけ行う（R1）。

### 9.2 `tnfd_location_assessments`（作業中データ）

| 列 | 内容 |
|---|---|
| `reportId` / `organizationId` / `locationId` | 1 レポート × 1 拠点 = 1 行（unique） |
| `sensitivity` | enum `tnfd_location_sensitivity`（`unassessed` / `sensitive` / `not_sensitive`） |
| `basisDisclosureState` + `basisDisclosure` / `basisInternalNote` | 判定根拠（開示文と内部記録。§5） |
| `assessedByUserId` / `assessedAt` | 監査用 |

- 既定は `unassessed`。`sensitive` のときは根拠の開示文を `answered` にすることを画面で促す（必須にはしない。保存は通す）。
- 保存版には、その時点の拠点名・住所・緯度経度を**複写して**入れる（拠点マスターが後で変わっても版を再現できるように）。
- **ISSB 公開草案の「ロケーション情報」の要求はこのセクションで受ける**（§10）。

**なぜ:** 戦略D は「センシティブロケーションにある拠点」の開示を求め、ISSB 草案は地理的位置情報に具体的な要求を置いた。
緯度経度を列だけ用意して入力画面を後回しにすると、後で全社分の住所を座標に変換し直す作業が発生する。
一方、保護区・水ストレス等との照合はライセンス確認が済むまで着手できない（§15）。
「どこにあるか」は今入れ、「重要地域か」の判定は人が根拠つきで記録する、が R1 の線引き。

## 10. ISSB 公開草案の新要求の受け皿

ISSB の公開草案（2026-10-22）は、TNFD の枠組みを広く取り込んだうえで、**既存の TNFD 開示では自動的に満たせない要求を 3 つ**置いた。
R1 は TNFD October 2026 版に準拠して作り、**この 3 つは「書く欄だけ」先に用意する**（PL 決定）。草案が固まったら欄の中身と位置を直し、骨格は動かさない。

| 草案の要求 | R1 の受け皿 | 型 |
|---|---|---|
| ロケーション（地理的位置）情報 | §9（拠点の自然関連情報） | `TnfdLocationAssessment` |
| 自然関連のシナリオ分析 | 文章の項目 `strategy.scenario_analysis`（基準コード `ISSB` の要求に対応） | `TnfdNarrative` |
| 自然関連リスクに脆弱な資産・事業活動の金額または割合 | 指標 `vulnerable_assets_amount`（数値＋単位＋補足文）と `vulnerable_assets_share`（割合）。**OGT は財務データを持たないため手入力** | `TnfdMetricValue` |

- 要求項目マスターでは、これらを `REQ-ISSB-nnn` として持ち、`standardVersion: 'ED-2026-10'` を付ける。最終化で版を上げる。
- プレビュー・CSV では「ISSB 公開草案への対応（任意）」の見出しの下に出し、TNFD の 14 提言と混ぜない。

**なぜ:** 草案はコメント期限 2027-02-19・最終化未定・準拠任意で、12 月末の時点で寄せきるのは時期尚早。
一方、ロケーション情報は拠点データの構造に効くので欄だけでも先に無いと後で手戻りする。「欄は作る、位置づけは別見出し」で両立させる。

## 11. 保存境界

**SSBJ と同じ 2 層**（`ssbj-spec.md` §8）。作業中データ（`authenticated` + RLS）と固定版（`tnfd_report_versions.snapshot`、
`service_role` 限定 RPC で 1 トランザクション）。`draftRevision` による競合防止、部分保存の防止、固定版の不変性、
`schemaVersion` の扱いも同じ。

- 固定版の形式は `TnfdReportSnapshotV1 = { schemaVersion, report, sections: { <key>: … } }`。
- **GHG の採用値は保存版に固定し、OGT の最新値を再取得しない**（SSBJ と同じ）。基準別 Scope 2 が `null` だった事実も
  `dataQuality` ごと固定する。
- 拠点の自然関連情報（§9）は、拠点名・住所・緯度経度を複写して固定する。

**なぜ:** SSBJ と同じ。加えて拠点マスターは TNFD と無関係に編集されるので、複写しないと「保存版の拠点一覧」が後から変わる。

## 12. 責務の方向

```
TN-02（レポートの作成・識別） ─▶ TN-03（汎用の保存・版生成） ─▶ 各機能（TN-04 / TN-05 / TN-06 / TN-07 / TN-08）
                                                            └▶ 読む側（TN-10 履歴 / TN-09 プレビュー / TN-10 CSV）
```

- **TN-03 は SSBJ の T06 の関数（`bump_*_draft_revision`、版生成、復元）を `tnfd_` 名で写す**（確定・§15）。SSBJ の関数を TNFD のテーブルに付けると、SSBJ 側の改修が TNFD に波及するため、共用しない。
- 逆向きの依存を作らない（SSBJ と同じ）。

## 13. 固定版セクションの登録規約

**SSBJ と同じ**（`ssbj-spec.md` §10）。名前を `tnfd_` に置き換える。

1. テーブルに `"organizationId"` と `"reportId"` を持たせ、RLS で両方を自組織に限定する
2. TN-03 のトリガー関数を AFTER INSERT / UPDATE / DELETE で付け、`tnfd_reports."draftRevision"` を進める
3. `tnfd_snapshot_section__<key>(p_report_id uuid) returns jsonb` を定義する。EXECUTE は `service_role` のみ
4. `types.ts` の `TnfdSnapshotSections` に `<key>` と型を追記する
5. 値の状態は `ssbj_field_state`（§4）、開示文と内部記録は別の列（§5）で持つ
6. 操作履歴のトリガー `tnfd_audit_row_change(...)` を付ける
7. 承認ロックのトリガー `reject_tnfd_change_when_approved()` を付ける。作業中データを書き換える RPC は `lock_tnfd_report_working_rows(p_report_id)` を先に呼ぶ
8. `tnfd_restore_section__<key>(…)` を定義する。EXECUTE は `service_role` のみ

6〜8 の付け忘れは `scripts/db/__tests__/tnfdAuditLogsPolicy.test.ts` が検出する（SSBJ のテストを写す）。

R1 のセクション `<key>`: `basic_info` / `narratives` / `metrics` / `location_assessments` / `judgements` / `evidence`。

## 14. 架空データ

`src/features/tnfd/__fixtures__/fictionalReport.ts` に、架空の 1 社・1 年度の検証データを置く。
会社名・数値・文章・ID は実在の企業・開示・提言のラベルと無関係。**SSBJ の架空サンプル株式会社と同じ会社・同じ年度にする**
（同じ組織の SSBJ レポートと TNFD レポートを並べて、GHG の値が一致することをテストで確かめるため）。

| データ | 内容 |
|---|---|
| `fictionalReportBasicInfo` | 基本情報 |
| `fictionalNarratives` | 四本柱の各章に 1 項目ずつ（開示文＋内部メモ / 未確認 / 非該当 / 未入力）＋ ISSB 草案の受け皿（シナリオ分析） |
| `fictionalRequirementLinks` | 文章と要求項目の対応（TNFD と ISSB の要求に 1 つの文章で答える例を含む） |
| `fictionalMetricValues` | 手入力指標（回答済みの 0 / 未入力 / 非該当 / 単位変更あり）と OGT 採用値（Scope 2 の 3 値のうち基準別が `null` の例） |
| `fictionalLocationAssessments` | 拠点 3 件（`sensitive` 根拠あり / `not_sensitive` / `unassessed`。緯度経度あり・なし） |
| `fictionalEvidence` / `fictionalJudgements` | SSBJ と同じ構造 |
| `fictionalSnapshot` / `fictionalVersion` | 保存版の例 |

- 境界ケース（回答済みの 0 / 未入力 / 未確認 / 非該当 / 基準別 Scope 2 が未算定 / 緯度経度なしの拠点 / 開示文と内部メモの併存）を消さないこと。
- ローカル DB 用のデモデータは `supabase/seeds/demo/tnfd_demo.sql`（本番用の `seeds/production/` には入れない）。デモ組織 A・B の両方に入れる。

## 15. 確定事項と未決事項

### 確定事項

| 事項 | 決定 | 節 |
|---|---|---|
| 到達点 | 開示情報の集約・出力支援。文章生成・LEAP 評価・自動判定は対象外 | §1 |
| 準拠先 | **TNFD Recommendations（October 2026）準拠。ISSB 草案の 3 新要求は「書く欄だけ」** | §10 |
| SSBJ の踏襲の深さ | **(b) データ契約を踏襲。** 型・規約・画面構成を写す。コードの共有は R2 以降 | 全体 |
| 手入力指標の範囲 | **絞る。** 選定は改訂版の指標一覧を見て専門家（画面レビュー時） | §8 |
| 手入力指標の形 | **組織全体で 1 つの数値＋単位＋補足文。拠点別・生態系タイプ別の内訳は R1 で持たない**（2026-11-02 PL 決定） | §8.2 |
| 戦略D の粒度 | **該当有無＋根拠テキスト＋住所・緯度経度（任意入力）。自動判定なし** | §9 |
| 識別子 | 章・項目・要求・指標 ID の形式。提言ラベル・指標コードは ID に埋め込まない | §3 |
| 値の状態 | SSBJ と同じ 4 状態。enum は `ssbj_field_state` を参照 | §4 |
| 開示文と内部記録 | 別の列 | §5 |
| 数値 | 十進文字列。単位は指標ごと | §6 |
| GHG | SSBJ の候補値・採用値の仕組みを共用。Scope 2 は 3 値を候補に出し、採用は利用者が選ぶ | §7 |
| 保存境界・登録規約 | SSBJ と同じ（名前を `tnfd_` に）。**保存・版生成・復元・トリガーの関数は SSBJ のものを共用せず、`tnfd_` 名で写す**（2026-11-04 PL 決定。SSBJ R2 の変更が TNFD に波及しないようにするため） | §11・§13 |
| 画面 | `/tnfd` 配下。リスク・機会の構造化リストは R1 で作らない | §2 |
| レビュー | 専門家（生物多様性）のレビューはある程度実装してから画面で行う | — |

### 未決事項

| # | 事項 | 判断 | 期限の目安 |
|---|---|---|---|
| U-1 | **`ssbj` ブランチをいつ main へマージするか。TNFD の着手基点** | PL・開発担当 ＋ SSBJ 担当チーム | 着手前 |
| U-2 | **手入力指標の選定**（別表B の `enabledInR1`）。改訂版で確定した C4.0 / C5.0 / C5.1 / C5.2 を含む一覧で | 専門家（生物多様性） | TN-05 着手前（11月中旬） |
| U-3 | 一般要件に追加された「環境犯罪」の受け皿。章ごとの企業固有の補足で受けるか、専用項目を置くか | 専門家（生物多様性） | TN-04 着手前 |
| U-6 | 権限。**本体に管理者／メンバー（#180）、SSBJ に入力担当／承認担当／閲覧者の二層（`ssbj_member_roles`・`authorization-matrix.md`）が入った。** TNFD は (a) R1 は本体のロールだけで分岐なし（全員が入力担当相当。自己承認の禁止は入れる）か、(b) SSBJ の三役割を `tnfd_member_roles` で写すか。**推奨は (a)、(b) は R2**。SSBJ 側も「本体のメンバー管理の1か所で設定する」方向へ揃える途中なので、そこに TNFD も乗る | PL・開発担当 | TN-02 着手前 |
| U-7 | `ssbj_field_state` → `disclosure_field_state` への汎用化の時期 | PL・開発担当 ＋ SSBJ 担当チーム | R2 |
| U-8 | 外部データ（ENCORE・IBAT・Protected Planet・GBIF・WRI Aqueduct・Global Forest Watch・環境省生物多様性センター・SBTN）の許諾条件 | PL・開発担当 | R2 着手前 |
| U-9 | 「提出様式ではない」注記の文面と `coverage-and-limitations.md` への追記 | PL・開発担当 | TN-09 まで |
| U-10 | `tnfd_reports` に報告主体（法人 ID・構成の版・測定アプローチ）の列をいつ足すか。SSBJ 側の列名・型が確定してから同じものを足す（§7.3） | PL・開発担当 ＋ SSBJ 担当チーム | R2 |

## 16. 実装タスクと実装状況

着手の基点は **`ssbj` ブランチ**（U-1）。**main から生やさない。** SSBJ の型も規約も無い状態から始めると、後で大きなコンフリクトを抱える。
`ssbj` は main を 10/23・10/29 に取り込み済みで、2026-11-04 時点の残差は 3 コミット（拠点画面の修正のみ・衝突なし）。
`feature/tnfd-r1` を `ssbj` から切り、main の残差を取り込んでから各 issue の枝を切る。

| タスク | 内容 | 依存 | 状況 |
|---|---|---|---|
| TN-01 | 共通データ契約と仕様書（本文書・`types.ts`・`utils/ids.ts`・要求項目マスター・指標マスター・架空データ） | — | 実装中（v0.2） |
| TN-02 | レポートの作成・一覧・基本情報（`/tnfd`、`/tnfd/[reportId]`） | TN-01 | 実装済み |
| TN-03 | 汎用の保存・版生成（`tnfd_report_versions`、`draftRevision`、復元） | TN-02 | 未着手 |
| TN-04 | 四本柱の文章（14提言＋一般要件＋企業固有の補足＋ISSB 受け皿） | TN-03、別表A | 未着手 |
| TN-05 | コア指標（GHG 採用値の共用＋手入力指標） | TN-03、**U-2** | 未着手 |
| TN-06 | 拠点の自然関連情報（`locations` 追加列、`tnfd_location_assessments`） | TN-03 | 未着手 |
| TN-07 | 該当性・重要性・記載しない理由 | TN-03 | 未着手 |
| TN-08 | 根拠文書・主管部署 | TN-03 | 未着手 |
| TN-09 | プレビュー・印刷ビュー（PDF） | TN-04〜08 | 未着手 |
| TN-10 | 保存履歴・過去版からの新版・CSV | TN-03 | 未着手 |
| TN-11 | R1 の全体テスト（E2E） | TN-09・10 | 未着手 |
| TN-12 | 試行手順・制限事項（`tnfd-r1-trial.md`） | TN-11 | 未着手 |

社内マイルストーンは 2026-12-28（対外には出さない）。

---

## 別表A. 開示項目マスター（草案）

項目 ID は安定キー、「提言」は TNFD October 2026 版のラベル（**PL の整理で要検証**）。記載ガイドは専門家の画面レビューを経て確定する。
`sectionId: null` は章にまたがる全般の要求（一般要件）。

| 項目 ID | 章 | 提言（要検証） | 入力種別 | OGT 自動補完 |
|---|---|---|---|---|
| `governance.board_oversight` | ガバナンス | A 取締役会の監督 | 文章 | なし |
| `governance.management_role` | ガバナンス | B 経営者の役割 | 文章 | なし |
| `governance.human_rights_engagement` | ガバナンス | C 人権方針・先住民族・地域社会・影響を受けるステークホルダーとの関わり | 文章 | なし |
| `strategy.dependencies_impacts_risks_opportunities` | 戦略 | A 依存・インパクト・リスク・機会 | 文章 | なし |
| `strategy.business_model_effects` | 戦略 | B 事業モデル・バリューチェーン・戦略・財務計画への影響 | 文章 | なし |
| `strategy.resilience` | 戦略 | C 戦略のレジリエンス | 文章 | なし |
| `strategy.priority_locations` | 戦略 | D センシティブロケーションにある拠点 | 文章＋拠点一覧 | **§9 の拠点一覧を自動表示** |
| `strategy.scenario_analysis` | 戦略 | （ISSB 草案）自然関連のシナリオ分析 | 文章 | なし |
| `risk_impact_management.direct_operations_process` | リスクとインパクトの管理 | A(i) 直接操業における特定・評価・優先順位付け | 文章 | なし |
| `risk_impact_management.value_chain_process` | リスクとインパクトの管理 | A(ii) バリューチェーン上流・下流における同プロセス | 文章 | なし |
| `risk_impact_management.management_process` | リスクとインパクトの管理 | B 管理プロセス | 文章 | なし |
| `risk_impact_management.integration` | リスクとインパクトの管理 | C 全社リスク管理への統合 | 文章 | なし |
| `metrics_targets.risk_opportunity_metrics` | 指標と目標 | A リスク・機会の評価・管理に用いる指標 | 文章＋数値 | 一部（§8） |
| `metrics_targets.dependency_impact_metrics` | 指標と目標 | B 依存・インパクトの評価・管理に用いる指標 | 文章＋数値 | **GHG を自動表示（§7）** |
| `metrics_targets.targets` | 指標と目標 | C 目標と実績 | 文章＋数値 | 削減目標を参照可 |
| `<章>.supplementary` | 各章 | 企業固有の補足（SSBJ と同じ） | 文章 | なし |
| `general.*`（`sectionId: null`） | 全般 | 一般要件（重要性の適用、開示の範囲、ロケーション、他の開示との統合、時間軸、ステークホルダーとの関わり、**環境犯罪**〈U-3〉） | 文章 | なし |

## 別表B. 指標マスター候補（`enabledInR1` は専門家選定待ち・U-2）

**TNFD コードは October 2026 版で確定したものを使う。** 下表のコードはPL の整理で、**確定版の一覧と突き合わせてから**マスターに入れる。

| 指標 ID | 分類 | TNFD コード（要検証） | 指標 | 既定単位 | 入力種別 | `enabledInR1` |
|---|---|---|---|---|---|---|
| `ghg_scope1` / `ghg_scope2*` / `ghg_scope3` | 気候変動 | C2.0 相当 | GHG 排出量 Scope 1 / 2（3 値）/ 3 | t-CO2e | **auto** | **true（確定）** |
| `spatial_footprint` | 陸・淡水・海洋の利用変化 | C1.0 | 総空間フットプリント | km² | manual_number | 選定待ち |
| `land_use_change` | 陸・淡水・海洋の利用変化 | C1.1 | 利用変化した面積（生態系タイプ別） | km² | manual_number | 選定待ち |
| `pollutants_soil` | 汚染 | C3.x | 土壌に排出された汚染物質 | t | manual_number | 選定待ち（**最難**） |
| `wastewater` | 汚染 | C3.x | 排水量 | m³ | manual_number | 選定待ち |
| `waste` | 汚染 | C3.x | 廃棄物の発生量・処分量 | t | manual_number | 選定待ち |
| `plastic` | 汚染 | C3.x | プラスチックの使用量・排出量 | t | manual_number | 選定待ち |
| `air_pollutants_non_ghg` | 汚染 | C3.x | 非 GHG 大気汚染物質 | t | manual_number | 選定待ち（**最難**） |
| `water_withdrawal` | 資源利用 | C5.x→**要確認** | 取水量 | m³ | manual_number | 選定待ち |
| `water_consumption` | 資源利用 | 同上 | 水消費量 | m³ | manual_number | 選定待ち |
| `water_stress_withdrawal` | 資源利用 | 同上 | 水ストレス地域での取水・消費量 | m³ | manual_number | 選定待ち |
| `high_risk_commodities` | 資源利用 | 同上 | 高リスク天然コモディティの調達量 | t | manual_number | 選定待ち |
| `invasive_species` | 侵略的外来種 | **C4.0（確定）** | 侵略的外来種 | — | manual_text | 選定待ち |
| `ecosystem_extent` | 自然の状態 | **C5.0（確定）** | 生態系の範囲 | km² | manual_number | 選定待ち |
| `ecosystem_condition` | 自然の状態 | **C5.1（確定）** | 生態系の状態 | — | manual_text | 選定待ち |
| `species_extinction_risk` | 自然の状態 | **C5.2（確定）** | 種の絶滅リスク | — | manual_text | 選定待ち |
| `vulnerable_assets_amount` | リスク・機会 | （ISSB 草案） | 自然関連リスクに脆弱な資産・事業活動の金額 | 円 | manual_number | **true（受け皿）** |
| `vulnerable_assets_share` | リスク・機会 | （ISSB 草案） | 同・割合 | % | manual_number | **true（受け皿）** |

> 改訂版で C4.0 が侵略的外来種、C5.0〜C5.2 が自然の状態に確定したため、**2023 年版で C5.x だった資源利用（水・コモディティ）のコードは
> 番号がずれている可能性がある。** 確定版の一覧で必ず確認すること。

---

## 改版履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.2 | 2026-11-04 | リポジトリへ収録（`docs/tnfd-spec.md`）。TN-01 の型・ID 検証・要求項目マスター・指標マスター・架空データ・テストと同じ PR。人名を役割に置き換え、リポジトリ外文書への参照を外した |
| v0.1c | 2026-11-04 | `ssbj` の 10/23〜10/29 の変更を反映: Scope 2 の基準別は SSBJ の `basisTotals` を共用（自前で足さない）、U-5・旧U-10 を解消、U-6 を二層ロールの前提で書き直し、§16 の着手手順を簡素化 |
| v0.1b | 2026-11-04 | U-4 を確定（保存・版生成の関数は `tnfd_` 名で写す。共用しない）。§12・§15 に反映 |
| v0.1a | 2026-11-02 | §7.3「法人別集計との関係」を追加。手入力指標の形（組織全体・内訳なし）を確定事項に追加。`boundary` の将来拡張（自然の側・会社の側の 2 軸）と `tnfd_reports` の報告主体の受け皿（U-11）を明記 |
| v0.1 | 2026-10-30 | 起票。`ssbj-spec.md` の構成を踏襲し、TNFD 固有の差分（章 ID・指標マスター・拠点の自然関連情報・ISSB 草案の受け皿・Scope 2 の 3 値）を定義。設計段階の決定事項（到達点・準拠先・踏襲の深さ・指標の絞り込み・戦略D の粒度）を確定事項に転記。要件定義書 v0.1（2026-09-18）の内容はこの文書に統合し、同文書は役目を終える |
