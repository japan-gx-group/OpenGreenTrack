# SSBJ 開示レポート（試行版 R1）仕様

SSBJ（サステナビリティ基準委員会）基準に沿った開示レポートの下書きを、OGT の組織・年度・算定値と
つないで作成・保存・確認するための機能の仕様書。**各機能が共通で守るデータ契約の正本**であり、
型は [`src/features/ssbj/types.ts`](../src/features/ssbj/types.ts)、架空の検証データは
[`src/features/ssbj/__fixtures__/fictionalReport.ts`](../src/features/ssbj/__fixtures__/fictionalReport.ts) に置く。

各章の「なぜ」は、後から加わるメンバーが同じ判断を再現できるように書いている。
変更するときは、この文書・`types.ts`・架空データ・テストを同じ PR で揃えること。

> 関連: 規約 [`AGENTS.md`](../AGENTS.md) / 画面・URL [`functional-spec.md`](functional-spec.md) /
> OGT の算定範囲と制約 [`coverage-and-limitations.md`](coverage-and-limitations.md)

---

## 1. 位置付け

- R1 は**社内確認用の試行版**である。SSBJ 基準への準拠の認定、第三者保証、対外提出の完了を意味しない。
- 画面・プレビュー・CSV・文書のいずれでも、準拠や提出完了を保証すると読める表現をしない。
- 基準の項番号・条文番号は、確認していないものを確定情報として書かない。基準本文も転載しない
  （要求項目は ID と記載ガイドで扱う。§3）。

**なぜ:** OGT 本体と同じく、制度適合の判断は利用者・監査人・保証機関が行う（`coverage-and-limitations.md` 冒頭）。
試行版の出力が正式な開示と取り違えられるのを防ぐ。

## 2. ルート計画

後続タスクが URL を揃えるための表。実装は各タスクが行い、実装したら `functional-spec.md` §4 と
`directory-structure.md` のルート一覧にも反映する。

| URL | 画面 | 担当タスク |
|---|---|---|
| `/ssbj` | レポート一覧・新規作成 | T04 |
| `/ssbj/[reportId]` | 基本情報の表示・編集、手動保存 | T04 / T06 |
| `/ssbj/[reportId]/narratives` | 四本柱・補足文章 | T05 |
| `/ssbj/[reportId]/risks` | リスク・機会 | T07 |
| `/ssbj/[reportId]/ghg` | OGT 候補値の表示・採用 | T08a / T08b |
| `/ssbj/[reportId]/judgements` | 該当性・重要性・非記載理由 | T09 |
| `/ssbj/[reportId]/evidence` | 根拠文書・主管部署 | T10 |
| `/ssbj/[reportId]/versions` | 保存履歴・過去版からの新版作成・CSV 出力 | T11 / T13 |
| `/ssbj/[reportId]/preview` | 簡易プレビュー | T12 |

機能コードはすべて `src/features/ssbj/` に置く（1 ドメイン。関心ごとはファイル名で分ける）。

**なぜ:** 既存の `/reports`（GHG 排出量レポート）と混同しないよう `/ssbj` に分ける。
レポート配下にサブ画面を並べることで、どの画面も `reportId` から組織・年度を辿れる。

## 3. 識別子

| 対象 | 形式 | 例 | 型 |
|---|---|---|---|
| レポート | UUID（`ssbj_reports.id`。DB が生成） | `5b1f…0003` | `SsbjReportId` |
| 章（四本柱） | 固定 4 値 | `governance` / `strategy` / `risk_management` / `metrics_targets` | `SsbjSectionId` |
| 項目 | `<章ID>.<slug>`（slug は `[a-z0-9_]+`） | `governance.oversight_body` | `SsbjItemId` |
| 要求項目 | `REQ-<基準コード>-<3桁連番>` | `REQ-CLM-001` | `SsbjRequirementId` |
| 保存版 | UUID（`ssbj_report_versions.id`）＋ レポート内連番 `versionNumber`（1 始まり） | 版 1, 版 2 … | `SsbjVersionId` |

- 基準コード: `APP` = 適用基準 / `GEN` = 一般開示基準 / `CLM` = 気候関連開示基準。
- 形式の正規表現は [`utils/ids.ts`](../src/features/ssbj/utils/ids.ts) を正本とする。DB の check 制約を書くときも同じ式にする。
  - 項目: `^(governance|strategy|risk_management|metrics_targets)\.[a-z0-9_]+$`
  - 要求: `^REQ-(APP|GEN|CLM)-\d{3}$`
- レポートは必ず 1 つの組織・1 つの算定年度（`fiscal_years`）に結び付く。
- 章の表示ラベルは `SSBJ_SECTION_LABELS`（ガバナンス / 戦略 / リスク管理 / 指標及び目標）。

**なぜ:**
- 項目 ID・要求 ID は**アプリ内の安定キー**であり、基準の項番号ではない。項番号は改訂で変わりうるため、
  ID に埋め込むと改訂のたびに保存版・関連付けの ID が変わってしまう。項番号との対応は要求項目マスター（T32a）の別の列で持つ。
- 項目 ID の先頭に章 ID を含めるのは、章を別の列で持って項目と食い違う事態を防ぐため（`sectionOfItem` で導出する）。
- 1 つの文章が複数の要求項目を説明できるよう、文章（項目）と要求項目の関連は多対多で持つ（T32a・T05）。

## 4. 値の状態（未入力・未確認・非該当・0 の区別）

| 状態 | 意味 | 値 | 表示 |
|---|---|---|---|
| `unanswered` | まだ入力されていない | 持たない | 未入力 |
| `unconfirmed` | 入力・下書きはあるが確定していない | 持たない | 未確認 |
| `not_applicable` | この会社には当てはまらない | 持たない | 非該当 |
| `answered` | 回答済み | 必ず持つ（空白だけの文字列は不可） | 値そのもの |

- 数値 0 は `answered` かつ値 `"0"`。**未入力を 0・空文字・「なし」「-」に置き換えない。**
- 型は判別共用体 `SsbjFieldValue<T>`。表示・DB 変換は [`utils/fieldValue.ts`](../src/features/ssbj/utils/fieldValue.ts)
  （`formatFieldValue` / `toFieldValue` / `fromFieldValue`）に一本化する。
- **DB 表現の規約**（後続タスクがテーブルを作るときに従う）
  - 状態列: enum `ssbj_field_state`（`'unanswered', 'unconfirmed', 'not_applicable', 'answered'`）。**T06 のマイグレーションで作成する。**
  - 値列: NULL 可。
  - check 制約: 「`state = 'answered'` のときだけ値が非 NULL」（文字列は空白のみも不可）。
  - 列名は `"<名前>State"` + `"<名前>"`（例 `"descriptionState"` + `"descriptionText"`）の対で揃える。
- 「未確認」の下書きを残したい場合は、値ではなく内部記録（§5）側に書く（未確認の値が開示欄へ出ないようにするため）。

**なぜ:** 未入力を 0 や空欄で表すと、プレビュー・CSV で「排出ゼロ」「該当なし」と誤読される。
状態を値と別に持てば、出力側は状態を見て必ず区別して表示できる。

## 5. 開示する文章と内部記録の区分

- 開示に載せる文（`disclosure…`）と、内部の検討メモ・確認先・保管場所など（`internal…`）は
  **別の列・別のプロパティ**に分ける。1 列＋「公開/内部」フラグにはしない。
- 型の例: `SsbjDisclosableText = { disclosure: SsbjFieldValue<string>; internalNote: string | null }`。
- プレビュー・CSV の「開示内容」欄には `internal…` を出さない。内部記録を出す場合は別の列・欄に「内部」と明示する。
- 根拠文書の内部保管先（T10）も内部記録として扱う。

**なぜ:** フラグ方式だと出力処理のフィルタ漏れ 1 つで内部情報が開示欄に混ざる。列を分けておけば、
開示欄は `disclosure…` だけを読む実装になり、混入が構造的に起きない。

## 6. 数値と単位

- 排出量などの数値は**十進表記の文字列**（`SsbjDecimalString`。例 `"1234.567"`、`"0"`）で受け渡す。
  `number` に変換して計算・丸めしない。形式は [`utils/decimal.ts`](../src/features/ssbj/utils/decimal.ts) の
  `isDecimalString`（`^-?\d+(\.\d+)?$`。指数表記・カンマ・全角・前後の空白は不可）。
- 単位は OGT に合わせて `t-CO2e` 固定（`OGT_EMISSION_UNIT`）。

**なぜ:** DB の `numeric` を JS の `number` にすると桁落ち・丸めが起き、保存版と OGT の値が一致しなくなる。
CSV に出すときも、文字列のまま出せば表記が揺れない。

## 7. OGT 採用値の形式（確定）

T08a が OGT から**候補値**（`OgtCandidateValue`）を取得・表示し、T08b が利用者の明示操作で**採用値**
（`OgtAdoptedValue` = 候補値 ＋ `adoptedAt` / `adoptedBy`）として保存版へ固定する。T08a・T08b はこの節に合わせる。

### 7.1 項目

| 項目 | 内容 |
|---|---|
| `scope` | 1 / 2 / 3 |
| `scope3CategoryId` | Scope 3 のカテゴリ（1〜15）。Scope 3 合計と Scope 1・2 は `null` |
| `value` | `SsbjFieldValue<SsbjDecimalString>`。**`dataQuality = not_calculated` のときは必ず `unanswered`**（0 を入れない） |
| `unit` | `t-CO2e` |
| `fiscalYearId` / `period` | 算定年度とその期間（`startDate` / `endDate`、YYYY-MM-DD） |
| `boundary` | 集計範囲。R1 は `{ kind: 'organization' }`（組織全体）。拠点別は `{ kind: 'location', … }` |
| `method` | 採用方式（§7.2） |
| `dataQuality` | 算定の充足状態（§7.4） |
| `coverage` | 判定に使った算定済み / 未算定の件数。件数で判定しない値（直接入力）は `null` |
| `source` | OGT 由来の根拠: 参照した集計（`aggregate`）、集計行の更新日時、取得時点の最新算定バッチ（ID・状態・完了日時） |
| `adoptedAt` / `adoptedBy` | 採用日時・採用者（採用値のみ） |

### 7.2 採用方式（OGT に実在する区分だけで表す）

| Scope | `method` | 補足 |
|---|---|---|
| 1 | `{ kind: 'activity_based' }` | 活動量 × 係数 |
| 2 | `{ kind: 'activity_based', scope2Basis, factorTypeBreakdown }` | `scope2Basis` は OGT 由来では常に `unknown`（下記） |
| 3 カテゴリ | `{ kind: 'direct' }` / `{ kind: 'calculated' }` | `scope3_category_methods` の方式（行が無いカテゴリは `direct`） |
| 3 合計 | `{ kind: 'per_category' }` | カテゴリごとに方式が異なるため |

- **Scope 2 の基準:** OGT はマーケット基準／ロケーション基準の区別を実装していない
  （`coverage-and-limitations.md` §4、`functional-spec.md` §1.1）。OGT にあるのは係数ごとの温対法の区分
  （`factorType` = `basic` 基礎排出係数 / `adjusted` 調整後排出係数 / `null` 区分なし）で、1 年度の中で混在しうる。
  そのため OGT 由来の値は `scope2Basis: 'unknown'` とし、**SSBJ が求める基準別の値は OGT からは得られない**ことを画面にも示す。
  補足として、適用した係数種別ごとの排出量の内訳（`factorTypeBreakdown`: `basic` / `adjusted` / `unclassified`）を添える。
  `location_based` / `market_based` は型にだけ用意しており、OGT の値から自動で設定してはならない。
- **Scope 3 とサプライヤー値（二重加算の防止）:** Scope 3 の採用値は、カテゴリごとに選ばれた方式
  （直接入力 **または** 積上げ）の値だけを使う。`supplier_emissions`（サプライヤー別実排出量）は OGT でも表示専用で
  `scope3Total` に算入していない（`functional-spec.md` §4.3）ため、採用値とは別の型 `OgtSupplierReference`
  （参考値）で持ち、合計に足さない。
- **対象ガス:** OGT の公式係数は実質 CO2 のみ（CH4 / N2O / フロン類は未対応）。単位を `t-CO2e` と表示しても
  他ガスは含まれない。この制約はプレビュー・CSV の注記にも載せる（T12 / T13）。

### 7.3 取得元

| 値 | 取得元 |
|---|---|
| Scope 1 / 2 / 3 の年度合計 | `dashboard_aggregates`（算定確定時に書かれる権威値） |
| Scope 3 カテゴリ別（方式適用後の採用値） | RPC `dashboard_scope3_category_emissions(fiscalYearId)`（合計は `scope3Total` と一致） |
| 直接入力カテゴリの入力有無 | `scope3_category_emissions` の行の有無 |
| Scope 2 の係数種別の内訳 | `emission_results` → 適用係数の `factorType` で集計（係数が削除され参照が切れた結果は `unclassified` に含める） |
| 算定の充足状況 | RPC `report_activity_calculation_coverage` / `report_scope3_activity_calculation_coverage` |
| 最新の算定バッチ | RPC `report_latest_calculation_batches` |
| サプライヤー別実排出量（参考値のみ） | `supplier_emissions` |

- 活動量レコードから独自に再集計しない（ダッシュボード・既存レポートと値がずれないようにするため）。
- `dashboard_scope3_category_emissions` は**採用値が 0 のカテゴリを返さない**。「行が無い」を 0 とも未入力とも
  決めつけず、直接入力カテゴリは `scope3_category_emissions` の行の有無、積上げカテゴリは充足状況の件数で判定する。
- 最新の算定バッチの状態が `completed` 以外（`pending` / `failed`）なら、その状態を `source.latestBatch` に残し、画面で注意を出す。

### 7.4 `dataQuality`（算定の充足状態）の判定規則

判定は [`utils/ogtValue.ts`](../src/features/ssbj/utils/ogtValue.ts) の `deriveOgtDataQuality` /
`deriveDirectInputDataQuality` に一本化する。

| 値 | 条件（活動量ベース: Scope 1・2・Scope 3 積上げ） | 値の扱い | 表示 |
|---|---|---|---|
| `not_calculated` | 集計行が無い、または算定済みレコードが 0 件 | `unanswered`（0 を入れない） | 未算定 |
| `partially_calculated` | 未算定レコードが 1 件以上ある | 値は出すが「一部未算定」と明示 | 一部未算定 |
| `all_calculated` | 登録済みレコードがすべて算定済み | 値を出す | 算定済み |

- 直接入力のカテゴリは、`scope3_category_emissions` の行があれば `all_calculated`、無ければ `not_calculated`。
- `all_calculated` は**網羅的であることを意味しない**。システムに入力されていないデータは検知できないため
  （`functional-spec.md` §4.6 のデータ充足状況と同じ考え方）。この注記を画面・出力に添える。
- 件数の数え方（年度帰属は `periodStart` 基準、直接入力カテゴリの積上げ明細は採用対象外として除く等）は
  既存レポートの充足状況（`functional-spec.md` §4.6）に合わせる。

**なぜ:** 「未算定」「一部未算定」を 0 と区別しないと、算定漏れがそのまま「排出ゼロ」として開示下書きに載る。
判定規則を 1 か所に置くことで、候補値の表示（T08a）と採用・固定（T08b）で判定がずれない。

## 8. 保存境界

```
┌ 作業中データ（編集可・authenticated + RLS） ─────────────┐
│ ssbj_reports（基本情報, T04）                              │
│ 各機能のテーブル（文章 T05 / リスク・機会 T07 /            │
│   OGT 採用値 T08b / 判断 T09 / 根拠 T10 …）               │
│   └ 変更のたびに ssbj_reports.draftRevision を +1         │
└───────────────┬─────────────────────────────────────────┘
                │ 利用者の「保存」操作だけ（自動保存では版を作らない）
                ▼ Server Action → service_role 限定 RPC（1 トランザクション）
┌ 固定版（書き換え不可） ──────────────────────────────────┐
│ ssbj_report_versions.snapshot（jsonb, SsbjReportSnapshotV1）│
│   = { schemaVersion, report, sections: { <key>: … } }       │
│ 保存版のプレビュー・履歴・CSV は必ずここから読む            │
└───────────────────────────────────────────────────────────┘
```

- **2 層:** 作業中データ（編集可）と固定版（書き換え不可）。固定版は利用者の明示的な「保存」操作でのみ作る。
- **作業中データのテーブル**は `"organizationId"` と `"reportId"` を持ち、変更（insert / update / delete）のたびに
  `ssbj_reports."draftRevision"` を +1 する。トリガー関数は T06 が提供し、各機能は自分のテーブルに付けるだけにする。
- **固定版**は `ssbj_report_versions.snapshot` にレポート一式を複写する。保存版のプレビュー（T12 の保存版表示）・
  履歴（T11）・CSV（T13）は必ず固定版から読み、**OGT の最新値を再取得しない**。
- **競合防止:** 画面は読込時の `draftRevision` を保持し、保存時にそれを渡す。DB 側でレポート行をロックして比較し、
  一致しなければ保存を拒否する（同時保存・古い画面からの保存の両方を防ぐ）。
- **部分保存の防止:** 版番号の採番・スナップショット生成・版の insert は 1 つの DB 関数（1 トランザクション）で行う。
- **書き込み経路:** 作業中データは `authenticated` + RLS（組織分離）。固定版は `service_role` 限定の RPC を
  Server Action から呼ぶ。呼び出し前に `getCurrentProfile()` で呼び出し元の組織をサーバ側で確定する。
- **不変性:** `ssbj_report_versions` は `authenticated` に SELECT のみ。UPDATE はトリガーで全ロール拒否。
  過去版からの復元（T11）も、旧版を書き換えず新しい版として作る（`sourceVersionId` に元の版を残す）。
- 保存版の形式を変えるときは `schemaVersion` を上げ、読み込み側で旧形式も読めるようにする。

**なぜ:** 作業中データを直接出力に使うと、OGT の値や他の人の編集で出力が後から変わり、
「社内で確認したのはどの内容か」を再現できない。固定版を分ければ、元データが更新されても旧版を再現できる。
固定版の書き込みを service_role 限定にするのは、クライアントが版の中身（特に OGT 由来の値）を偽造できないようにするため。

## 9. 責務の方向

```
T04（レポートの作成・識別） ─▶ T06（汎用の保存・版生成） ─▶ 各機能（T05 / T07 / T08b / T09 / T10）
                                                          └▶ 読む側（T11 履歴 / T12 プレビュー / T13 CSV）
```

- T04 は `ssbj_reports` の作成・一覧・基本情報だけを持つ。版管理の列（`draftRevision`）や関数は T06 が追加する。
- T06 は各機能のテーブルを知らない（§10 の規約で各機能のデータを集める）。
- 各機能は T06 の保存契約に乗るだけで、T06 の関数を書き換えない。
- 逆向きの依存（T04 が T06 を、T06 が各機能を前提にする）を作らない。

**なぜ:** 依存が一方向なら、各機能を並行して開発・レビューでき、後から機能を足しても T04・T06 を直さずに済む。

## 10. 固定版セクションの登録規約

各機能は、自分のデータを保存版に含めるために次を行う（T06 の実装時に詳細を追記する）。

1. テーブルに `"organizationId"` と `"reportId"` を持たせ、RLS で両方を自組織に限定する
   （他テーブルを指す列は `exists` で自組織の行であることを検証する。既存の `activity_records` と同じ理由）。
2. T06 が提供するトリガー関数を AFTER INSERT / UPDATE / DELETE で付け、`draftRevision` を進める。
3. マイグレーションで `ssbj_snapshot_section__<key>(p_report_id uuid) returns jsonb` を定義する。
   EXECUTE は `service_role` のみ（`public` / `anon` / `authenticated` から revoke）。
4. `types.ts` の `SsbjSnapshotSections` に `<key>` とその型を追記する（`<key>` と関数名の `<key>` を一致させる）。
5. 復元（T11）用に `ssbj_restore_section__<key>(p_report_id uuid, p_payload jsonb)` を対で定義する（詳細は T11 で確定）。
6. 値の状態は `ssbj_field_state`（§4）、開示文と内部記録は別の列（§5）で持つ。

T06 の版生成関数は、`public` スキーマの `ssbj_snapshot_section__` で始まる関数を名前順に集め、
結果を `snapshot.sections.<key>` に入れる。

**なぜ:** 各機能が版生成関数そのものを書き換える方式だと、並行して開発した PR が互いのセクションを
上書きして消してしまう。命名規約で自動収集すれば、各機能は自分の関数を足すだけで済む。

## 11. 架空データ

[`src/features/ssbj/__fixtures__/fictionalReport.ts`](../src/features/ssbj/__fixtures__/fictionalReport.ts)
に、架空の 1 社・1 年度（架空サンプル株式会社・2024年度）の検証データを置く。会社名・数値・文章・ID は
実在の企業・開示・基準の項番号と無関係。

| データ | 内容 |
|---|---|
| `fictionalReportBasicInfo` | 基本情報 |
| `fictionalDisclosableTexts` | 四本柱の各章に 1 項目ずつの文章（開示文＋内部メモ / 未確認 / 非該当 / 未入力） |
| `fictionalRequirementLinks` | 文章と要求項目の対応（1 つの文章が 2 つの要求に対応する例を含む） |
| `fictionalOgtCandidates` | OGT 候補値（Scope 1 算定済み / Scope 2 基準不明・一部未算定 / Scope 3 直接入力の回答済み 0 / 積上げの未算定 / 積上げの算定済み） |
| `fictionalOgtAdoptedValues` | Scope 1・2 を採用した採用値 |
| `fictionalSupplierReferences` | サプライヤー別実排出量（参考値） |
| `fictionalSnapshot` / `fictionalVersion` | 保存版の例（T03 時点では `sections` は空） |

- 境界ケース（回答済みの 0 / 未入力 / 未確認 / 非該当 / Scope 2 基準不明 / Scope 3 未算定 / 開示文と内部メモの併存）を
  消さないこと。`__fixtures__/__tests__/fictionalReport.test.ts` が確認している。
- 各機能は自分のデータの架空例をここに追記し、テストで使う。
- ローカル DB 用のデモデータは、テーブルができた時点で各タスクが `supabase/seeds/demo/ssbj_demo.sql` に追加する
  （T04 がファイルを作成。本番用の `seeds/production/` には入れない）。デモ組織 A・B の両方に入れ、組織分離を確認できるようにする。

## 12. 確定事項と T01 合意待ち（仮置き）

### 確定事項

後続タスク（T04〜T13）はこれに合わせて実装する。

| 事項 | 節 |
|---|---|
| 識別子（章・項目・要求 ID の形式、レポート・保存版の ID） | §3 |
| 値の状態（4 状態と DB 表現の規約） | §4 |
| 開示する文章と内部記録を別の列で持つ | §5 |
| 数値は十進文字列・単位は t-CO2e | §6 |
| OGT 採用値の形式・取得元・`dataQuality` の判定規則 | §7 |
| 作業中データと固定版の 2 層、競合防止、書き込み経路 | §8 |
| 責務の方向（T04 → T06 → 各機能） | §9 |
| 固定版セクションの登録規約 | §10 |

### T01 合意待ち（仮置き）

T01（初回のレポート例・対象範囲の合意）が未完了のため、次は仮の内容で進めている。合意後にこの一覧を見直し、
差分を `types.ts`・架空データ・各機能に反映する。

| 事項 | 仮の内容 | 反映先 |
|---|---|---|
| 基本情報の項目名と必須性 | タイトル（必須）・作成目的・報告範囲・参照する基準の版（いずれも任意） | `types.ts` の `SsbjReportBasicInfo`、T04 |
| R1 で扱う章・項目の範囲 | 四本柱の 4 章すべて。項目は架空データで使う数項目のみ | 架空データ、T05・T32a |
| 架空の入力例・出力例 | §11 の架空サンプル株式会社・2024年度 | 架空データ |
| リスク・機会の時間軸の区分 | 短期 / 中期 / 長期の 3 区分（各区分の期間の定義は持たない） | T07 |
| 集計範囲 | 組織全体のみ（拠点別は扱わない） | §7、T08a |

## 13. 実装状況

各タスクで実装した内容と、その中で決めたことを記録する（詳細な表定義は `database-design.md`、画面仕様は `functional-spec.md` §4.9）。

### レポートの作成・一覧・基本情報（T04）

| 対象 | 内容 |
|---|---|
| DB | `ssbj_reports`（`supabase/migrations/20260927170328_ssbj_reports.sql`）。RLS は select / insert / update を自組織に限定し、年度の組織帰属を `exists` で検証。delete は持たない |
| 画面 | `/ssbj`（一覧・新規作成）、`/ssbj/[reportId]`（基本情報の表示・編集）。サイドバー「出力」グループに「SSBJレポート」 |
| コード | `src/features/ssbj/services/reportService.ts`（読み書き）、`hooks/useSsbjReports.ts` / `useSsbjReport.ts` / `useSsbjReportForm.ts`、`utils/reportValidation.ts`（検証）、`components/` |
| デモデータ | `supabase/seeds/demo/ssbj_demo.sql`（デモ組織 A の 2024年度・組織 B の 2025年度に 1 件ずつ） |

決めたこと:

- **年度は作成後に変更できない。** 列指定の GRANT で update を基本情報の列に限る。後続機能が採用するその年度の OGT 値・保存版と食い違わないようにするため。
- **レポートは画面で選択中の年度に作る。** 作成ダイアログで年度を選ばせず、対象年度を明示する（別の年度に作るときはヘッダーで切り替える）。
- **年度の FK は `on delete` を指定しない（NO ACTION）。** `restrict` は即時検査のため、組織削除（デモ seed の再投入を含む）で年度とレポートが同じ文の中で連鎖削除されるときに失敗しうる。アプリからの年度削除は `fiscalYears.ts` の参照チェックで止める。
- **一覧・詳細の年度表示は `fiscal_years` を埋め込んで取得する。** 画面の型 `SsbjReportRecord`（基本情報＋年度のラベル・期間）は保存版の `report` と同じ形にしている。
- 版管理の列（`draftRevision`）と保存版は T06 が追加する（T04 には入れていない）。
