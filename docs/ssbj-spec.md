# SSBJ 開示レポート（試行版 R1）仕様

SSBJ（サステナビリティ基準委員会）基準に沿った開示レポートの下書きを、OGT の組織・年度・算定値と
つないで作成・保存・確認するための機能の仕様書。**各機能が共通で守るデータ契約の正本**であり、
型は [`src/features/ssbj/types.ts`](../src/features/ssbj/types.ts)、架空の検証データは
[`src/features/ssbj/__fixtures__/fictionalReport.ts`](../src/features/ssbj/__fixtures__/fictionalReport.ts) に置く。

各章の「なぜ」は、後から加わるメンバーが同じ判断を再現できるように書いている。
変更するときは、この文書・`types.ts`・架空データ・テストを同じ PR で揃えること。

> 関連: 規約 [`AGENTS.md`](../AGENTS.md) / 画面・URL [`functional-spec.md`](functional-spec.md) /
> OGT の算定範囲と制約 [`coverage-and-limitations.md`](coverage-and-limitations.md) /
> R1 の対象範囲（T01 の合意） [`ssbj-r1-scope.md`](ssbj-r1-scope.md)

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
| `/ssbj/[reportId]/preview/print` | プレビューの印刷ビュー（PDF） | T12 |

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
- Scope 2 の係数種別内訳は小数第3位に丸め、区分ごとの丸め差を排出量が最大の区分に配分する（同額なら基礎、調整後、区分なしの順）。算定明細と年度集計そのものの差は補正しない。
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
  過去版からの新版作成（T11）は旧版のスナップショットをそのまま複製し、旧版と作業中データを変更しない（`sourceVersionId` に元の版を残す）。
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
5. 値の状態は `ssbj_field_state`（§4）、開示文と内部記録は別の列（§5）で持つ。

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
| `fictionalEvidence` | 同じ項目に複数の根拠文書、主管部署あり / なし、開示用参照文と内部保管先の分離 |
| `fictionalOgtCandidates` | OGT 候補値（Scope 1 算定済み / Scope 2 基準不明・一部未算定 / Scope 3 直接入力の回答済み 0 / 積上げの未算定 / 積上げの算定済み） |
| `fictionalOgtAdoptedValues` | Scope 1・2 を採用した採用値 |
| `fictionalSupplierReferences` | サプライヤー別実排出量（参考値） |
| `fictionalSnapshot` / `fictionalVersion` | 保存版の例（T03 時点では `sections` は空） |

- 境界ケース（回答済みの 0 / 未入力 / 未確認 / 非該当 / Scope 2 基準不明 / Scope 3 未算定 / 開示文と内部メモの併存）を
  消さないこと。`__fixtures__/__tests__/fictionalReport.test.ts` が確認している。
- 各機能は自分のデータの架空例をここに追記し、テストで使う。
- ローカル DB 用のデモデータは、テーブルができた時点で各タスクが `supabase/seeds/demo/ssbj_demo.sql` に追加する
  （T04 がファイルを作成。本番用の `seeds/production/` には入れない）。デモ組織 A・B の両方に入れ、組織分離を確認できるようにする。

## 12. 確定事項と T01 の合意

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

### T01 の合意（R1 の対象範囲）

対象利用者・利用場面・R1 の対象と対象外・初回対象の要求項目・入力例と出力例・産業別ガイダンスの参照は
[`ssbj-r1-scope.md`](ssbj-r1-scope.md) を正とする。T01 の合意前に仮置きしていた事項の確定内容も同文書を見る。

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

#### T01 の合意を受けた追加（親会社との関係・測定アプローチ・業種）

R1 のレポートは親会社の有価証券報告書に向けた子会社・関連会社の分の下地になるため（[`ssbj-r1-scope.md`](ssbj-r1-scope.md) §2）、
親会社が連結の開示に合算・統合できる情報と、産業別ガイダンスの参照先を基本情報に追加した。

| 対象 | 内容 |
|---|---|
| DB | `supabase/migrations/20260928154722_ssbj_report_parent_and_industry.sql`。`ssbj_reports` に `parentCompanyName` / `parentRelationship` / `ownershipPercentage`（numeric(5,2)）/ `measurementApproach` / `industryCode` を追加（いずれも NULL 可・check 制約）。列 GRANT に追加。`bump_ssbj_reports_own_draft_revision` と `create_ssbj_report_version` を置き換え、追加列を draftRevision の対象と保存版の `report` に含めた |
| 画面 | 作成ダイアログと詳細画面の編集に 5 項目。詳細画面の業種には産業別ガイダンスの巻へのリンク |
| コード | `types.ts` の `SsbjParentRelationship`・`SsbjMeasurementApproach`、`utils/sicsIndustries.ts`（68 産業・リンク）、`utils/reportValidation.ts`、`services/reportService.ts`、`components/SsbjReportFormFields.client.tsx` / `SsbjReportBasicInfo.tsx` |
| テスト | `scripts/db/__tests__/ssbjReportParentPolicy.test.ts`、`utils/__tests__/sicsIndustries.test.ts`（DB の業種コードの制約と一覧の一致を含む）、検証・画面の単体テスト |

決めたこと:

- **5 項目とも任意（NULL 可）で、状態＋値の対にはしない。** 既存の基本情報（作成目的など）と同じ持ち方にした。
- **持分比率は numeric(5,2) で持ち、画面・保存版では十進表記の文字列にする。** 取得時は `ownershipPercentage::text` で受け取り、保存版の `report` にも text で入れる（§6）。範囲は 0 超 100 以下。
- **測定アプローチは親会社の選択に合わせる。** 選んだ理由（気候関連開示基準 第61項(2)）は親会社が開示するため、R1 では持たない。
- **業種コードの一覧は DB の check 制約と `utils/sicsIndustries.ts` の 2 か所にある。** 一致はテストで確認している。
- **版生成 RPC の置き換えは処理を変えず、`report` の項目だけを足した。** 関数名・引数・権限は変えていない。

### 汎用の保存・版生成基盤（T06）

| 対象 | 内容 |
|---|---|
| DB | `supabase/migrations/20260927180425_ssbj_report_versions.sql`。`ssbj_field_state` enum（§4）、`ssbj_reports."draftRevision"`、各機能テーブル用の共通トリガー関数 `bump_ssbj_draft_revision()`、`ssbj_report_versions` テーブル（RLS は select のみ authenticated・書き込みは RPC 経由）、版生成 RPC `create_ssbj_report_version`（`service_role` 限定） |
| 画面 | `/ssbj/[reportId]` に「保存版の作成」欄（`components/SsbjVersionSaveCard.tsx`）。基本情報の編集中は押せない。成功時は「版 N として保存しました」、競合時は開き直しを促すメッセージを出す |
| コード | `src/features/ssbj/services/versionServer.ts`（RPC 呼び出し・SQLSTATE マッピング）、Route Handler `src/app/api/ssbj/reports/[reportId]/versions/route.ts`（`POST`）、`services/versionClient.ts`・`hooks/useSsbjVersionSave.ts`（画面から API を呼ぶ側） |
| テスト | `scripts/db/__tests__/ssbjReportVersionsPolicy.test.ts`（RLS・GRANT・不変性・RPC の権限と競合検知の机上検証）、Route Handler・サービス・画面の単体テスト |

決めたこと:

- **`ssbj_reports` 自身の基本情報の変更も `draftRevision` を進める。** BEFORE UPDATE トリガー（`bump_ssbj_reports_own_draft_revision`）が `title` / `purpose` / `reportingScope` / `standardVersion` のいずれかの変更時に `NEW."draftRevision"` を書き換える。authenticated の列 GRANT に `draftRevision` は含めていないが、`set_ssbj_reports_updated_at` が `updatedAt` を書けるのと同じ理由（BEFORE トリガーが NEW を直接書き換えるため、列 GRANT の対象外）で書き込める。
- **各機能テーブル用の `bump_ssbj_draft_revision()` は `security definer` にする。** 呼び出し元（authenticated）は自分の機能テーブルへの書き込み権限しか持たず、`ssbj_reports.draftRevision` の列 GRANT も持たないため。対象は `NEW`/`OLD."reportId"` の行に限定し、他組織の `reportId` はここに到達する前に呼び出し元テーブルの RLS が拒否する。
- **`ssbj_report_versions` の UPDATE はトリガーで全ロール拒否する（`service_role` も含む）。** RLS は select のみで insert/update/delete を authenticated に許可していない（default privileges により拒否）が、service_role は RLS を越えるため、不変性はトリガー（`reject_ssbj_report_version_update`）でも担保する。
- **版生成 RPC は Route Handler から呼ぶ（`ssbj-spec.md` §8 の「Server Action」に相当）。** このリポジトリの既存の service_role 経路（`run_calculation_commit` 等）はすべて `src/app/api/**/route.ts` の Route Handler なので、同じ構成に揃えた。認証・組織チェックは `getCurrentProfile()` で Route Handler 側が行い、RPC には検証済みの `organizationId` / `actorUserId` を渡す（RPC 側も `p_organization_id` と行の組織帰属を突き合わせ、二重に確認する）。
- **競合検知の SQLSTATE は `P2033` を新設。** 既存の `P2023`/`P2024`/`P2026`〜`P2028`/`P2031`/`P2032`（`apiRateLimit.ts` の `HEAVY_API_SQLSTATE`、`ideaImportServer.ts` の `IDEA_IMPORT_SQLSTATE`）と重複しない番号を選んだ。対応表は `src/features/ssbj/services/versionServer.ts` の `SSBJ_VERSION_SQLSTATE`。
- **画面は読込時の `draftRevision` を `SsbjReportWorkingRecord`（`SsbjReportRecord` ＋ `draftRevision`）として持つ。** 保存版の `report` は `SsbjReportRecord` のままにし、版数を含めない。基本情報を保存すると DB のトリガーが版数を進めるため、更新 API の戻り値で保持値を差し替える（差し替えないと自分の編集直後の保存が競合になる）。
- **基本情報の編集中は保存版を作れない。** 未保存のフォーム入力は作業中データに入っておらず、保存版にも入らないため、押せる状態にすると「入力したのに保存版に無い」ことが起きる。
- 保存履歴の表示と過去版からの新版作成は T11（`/ssbj/[reportId]/versions`）が行う。RPC は `p_source_version_id` を受け付け、指定版のスナップショットと `basedOnDraftRevision` を複製する。版番号・作成者・作成日時は新たに記録する。作業中データは変更しない。

### リスク・機会（T07）

| 対象 | 内容 |
|---|---|
| DB | `ssbj_risks_opportunities`（`supabase/migrations/20260928001521_ssbj_risks_opportunities.sql`）。RLS は select / insert / update / delete を自組織に限定し、レポートの組織帰属を `exists` で検証。`bump_ssbj_draft_revision` を付け、保存版には `ssbj_snapshot_section__risks_opportunities` で取り込む |
| 画面 | `/ssbj/[reportId]/risks`（登録・編集・削除）。詳細画面の「レポートの内容」欄（`components/SsbjReportContentsNav.tsx`）から入る |
| コード | `types.ts` の `SsbjRiskOpportunity`・`SsbjLinkTarget`、`utils/riskOpportunity.ts`（検証・正規化・関連先の並び）、`services/riskOpportunityService.ts`、`hooks/useSsbjRisksOpportunities.ts` / `useSsbjRiskOpportunityForm.ts` / `useSsbjRiskOpportunityDelete.ts`、`components/SsbjRisksOpportunities.client.tsx` ほか |
| テスト | `scripts/db/__tests__/ssbjRisksOpportunitiesPolicy.test.ts`（RLS・GRANT・保存版連携・関連先の形式）、検証・変換・画面の単体テスト |
| デモデータ | `supabase/seeds/demo/ssbj_demo.sql`（組織 A に 3 件、組織 B に 1 件） |

決めたこと:

- **区分（リスク / 機会）と時間軸は enum ではなく check 制約で持つ。** 時間軸は仮置き（§12）で、区分を変えるときに制約の張り替えだけで済ませるため（enum は値の削除・改名ができない）。
- **リスクの種類（物理的 / 移行）は後から追加した。** 最初の実装では方針が未確定で持たなかったが、T01 の合意で持つことになった（下の「T01 の合意を受けた追加」）。
- **章・項目への関連は 1 つの配列列 `linkTargets`（章 ID または項目 ID）で持つ。** 章と項目を別の列にすると項目 ID の接頭辞と食い違いうる（§3）。別テーブルにすると、リスク・機会本体と関連の保存が 2 回の通信に分かれ、片方だけ失敗しうるため、1 行の更新で済む配列にした。形式は check 制約（`utils/ids.ts` と同じ正規表現）で検証し、並び順（章の順、同じ章では章そのものを先に）は画面側で揃える。
- **項目への関連付けは、章を選んで項目の識別子を入力する。** 項目の一覧（T32a の要求項目マスター・T05 の文章）がまだ無いため、形式だけを検証している。一覧ができたら選択式に差し替える（保存形式は変わらない）。
- **説明は「入力済み」のときだけ本文を保存する。** 未確認・非該当・未入力に切り替えると本文は保存しない（未確認の下書きは内部メモに書く。§4）。

#### T01 の合意を受けた追加（リスクの種類・時間軸の定義）

気候関連開示基準は、リスクごとに物理的リスクか移行リスクかを（第19項(2)）、レポートとして「短期」「中期」「長期」の
定義とその定義と戦略上の計画期間との関係を（第19項(4)(5)、一般開示基準 第14項(3)(4)）開示するよう求めている。
R1 の初回対象（[`ssbj-r1-scope.md`](ssbj-r1-scope.md) §5.1）に含めるため追加した。

| 対象 | 内容 |
|---|---|
| DB | `supabase/migrations/20260928151241_ssbj_risk_type_and_time_horizons.sql`。`ssbj_risks_opportunities` に `"riskTypeState"` / `"riskType"`、レポートごとに 1 行の `ssbj_report_time_horizons`（RLS・GRANT・`bump_ssbj_draft_revision`・保存版セクション `ssbj_snapshot_section__time_horizons`）、状態＋値を jsonb にする共通関数 `ssbj_field_value_json` |
| 画面 | `/ssbj/[reportId]/risks` の登録・編集にリスクの種類（区分がリスクのときだけ）、画面上部に「時間軸の定義」欄（`components/SsbjTimeHorizonCard.client.tsx`） |
| コード | `types.ts` の `SsbjRiskType`・`SsbjTimeHorizonDefinitions`、`utils/timeHorizons.ts`、`services/timeHorizonService.ts`、`hooks/useSsbjTimeHorizons.ts` / `useSsbjTimeHorizonForm.ts` |
| テスト | `scripts/db/__tests__/ssbjTimeHorizonsPolicy.test.ts`、検証・変換・画面の単体テスト |
| デモデータ | リスクの種類を追加。時間軸の定義は組織 A だけ（組織 B は「すべて未入力」の表示の確認用） |

決めたこと:

- **既存の行を書き換えない。** リスクの種類は状態＋値の対で追加し、既定は未入力にした（マイグレーションにデータを入れないため。AGENTS.md R12）。
- **機会はリスクの種類を持たない。** DB は「区分が機会なら値は NULL」を制約で保証し、画面は保存時に機会を「非該当」にする。リスクの選択肢は物理的 / 移行 / 未入力 / 未確認で、非該当は選ばせない（リスクは必ずどちらかに当たるため）。
- **急性 / 慢性、政策・法律・技術・市場・レピュテーションの細分類は持たない。** 基準は定義しているが、リスクごとの開示は求めていないため（第4項(2)(3)）。
- **時間軸の定義は `ssbj_reports` の列にせず、別テーブルにした。** §10 の登録規約に乗せれば、版生成 RPC と T04 のテーブルを変えずに保存版へ取り込めるため。行が無いレポートの保存版には、すべて未入力の定義が入る（欠落と未入力を区別するため）。
- **時間軸の定義は upsert ではなく「更新して、無ければ作る」で保存する。** PostgREST の upsert は衝突時の更新に `reportId` / `organizationId` も含めるが、両列は作成後に変えない前提で update の列 GRANT に入れていないため。
- **状態＋値を jsonb にする処理は共通関数 `ssbj_field_value_json` にまとめた。** 後続の機能の保存版セクション関数も使える。名前を `ssbj_snapshot_section__` で始めないこと（版生成 RPC が自動収集してしまう）。
### 根拠文書・主管部署（T10）

| 対象 | 内容 |
|---|---|
| DB | `ssbj_evidence`（`supabase/migrations/20260929150000_ssbj_evidence.sql`）。項目IDごとに複数件を持つ。RLSで組織とレポートの帰属を検証し、変更時は `draftRevision` を進める。`ssbj_snapshot_section__evidence` が保存版の `sections.evidence` に取り込む |
| 画面 | `/ssbj/[reportId]/evidence` で資料名・版・内部保管先・参照位置・主管部署・開示用参照文を登録、編集、削除する |
| 出力 | 社内確認用CSVでは開示用参照文だけを開示内容欄に、資料の参照情報は項目ごとに別行の内部記録欄に入れる |
| デモ | `supabase/seeds/demo/ssbj_demo.sql`。組織Aには同じ項目の2資料、組織Bにも1資料を置く |

- 必須は項目IDと資料名。主管部署を含む残りの参照情報は任意。主管部署を将来必須にするかは別Issueで判断する。
- 項目マスターがまだ無いため、項目IDは§3の形式だけを検証する。章だけへの紐付けはしない。
- 内部保管先は開示用参照文と別列・別プロパティにする（§5）。開示用参照文には§4の4状態を使う。
- 保存版の既存形式は `sections` が任意キーを受け付けるため `schemaVersion: 1` を維持する。過去版からの復元関数は復元契約が確定したときに追加する。

### 要求項目マスター（T32a・暫定）

初回対象の要求（[`ssbj-r1-scope.md`](ssbj-r1-scope.md) §5.1）ごとに、要求 ID・要約・基準の項番号・記載ガイド・入力先を
対応させた一覧。文章（T05）・判断（T09）・プレビュー（T12）が同じ ID で要求を扱うための土台になる。

| 対象 | 内容 |
|---|---|
| コード | `utils/requirementMaster.ts`（要求 47 件: 一般 13・気候 30・適用 4。文章の項目 24 件: 要求に対応する 20 件と、章ごとの企業固有の補足 4 件）、`types.ts` の `SsbjRequirement`・`SsbjNarrativeItem`・`SsbjParagraphReference` |
| テスト | `utils/__tests__/requirementMaster.test.ts`（ID の形式と重複、要求と項目の相互参照、章ごとの補足、件数） |

決めたこと:

- **暫定版として出す。** 項目 ID・要求 ID は文章・判断の実装と突き合わせて確定する。確定までは変えうるため、
  マスターの版（`SSBJ_REQUIREMENT_MASTER_VERSION`）を上げて区別する。保存版に要求 ID を残す機能は、この版も一緒に残す。
- **DB ではなくコードの定数に置く。** 全組織で共通の固定データで、組織分離が要らない。PR でレビューでき、
  型検査が効く。マイグレーションにはデータを入れられない（AGENTS.md R12）。業種一覧（`utils/sicsIndustries.ts`）と同じ置き方。
- **要求 ID は基準ごとに分け、同じ趣旨の要求は 1 つの文章の項目に対応させる。** 一般開示基準と気候関連開示基準が
  ほぼ同じことを求める要求（監督機関、リスク管理のプロセスなど）は、利用者が 1 つの文章で両方に答える（二重入力しない）。
- **要約・記載ガイドはこの試行版の言葉で書き、基準の本文は転載しない（§1）。** 項番号は
  `SSBJ_REFERENCE_STANDARD_DOCUMENTS` の版（適用・一般・気候は 2026年3月13日改正、実務対応基準第1号は 2026年6月11日）で確認した。
- **章にまたがる全般の要求は `sectionId: null` にする。** 文章で答える比較情報・測定の不確実性は、数値にかかわる内容のため
  指標及び目標の章の項目にした。
- **温室効果ガスの説明（測定方法、活動量・係数と仮定、スコープ 3 のデータの選び方、連結の分解、算定期間の差）は文章の項目にした。**
  数値（T08b）ではなく、利用者が書く文章だから。数値はスコープ 1・2・3 の総量・単位・カテゴリ別の内訳だけを T08b で扱う。
- **OGT が対応していない要求（ロケーション基準・マーケット基準のスコープ 2、7 種類のガスの集約）と準拠の表明は、入力先を `notice` にした。**
  利用者は入力せず、プレビュー・出力の注記で扱う。
- **「〜していない場合はその旨」を求める要求は、記載ガイドで「していない」と書くよう案内する。** 非該当ではなく回答として扱う（`ssbj-r1-scope.md` §5）。

### OGT の値の採用（T08b）

「GHG排出量の候補値」画面（`/ssbj/[reportId]/ghg`。T08a）で確認した候補値を、利用者の明示の操作でレポートに採用する。
採用値は OGT の元データから複写して持ち、保存版を作成した時点のものが固定される。

| 対象 | 内容 |
|---|---|
| DB | `supabase/migrations/20260929180243_ssbj_ogt_adoptions.sql`。レポートごとに 1 行の `ssbj_ogt_adoptions`（RLS は select / delete を自組織に限定、insert / update は付与しない）、採用 RPC `adopt_ssbj_ogt_values`（service_role 限定。P2041 / P2042）、保存版セクション `ssbj_snapshot_section__ghg` |
| API | `POST /api/ssbj/reports/[reportId]/ogt-adoption`（`services/ogtAdoptionServer.ts`） |
| 画面 | `/ssbj/[reportId]/ghg` に「レポートへの採用」欄（`components/SsbjOgtAdoptionCard.client.tsx`。採用・採用し直し・取り消し、採用後に OGT の値が変わった区分の表示） |
| コード | `types.ts` の `SsbjGhgAdoption`、`utils/ogtAdoption.ts`（指紋・変化の検出）、`services/ogtAdoptionService.ts`、`hooks/useOgtAdoption.ts` / `useOgtAdoptionActions.ts`、`services/versionCsvGhg.ts`（CSV の GHG の行）。候補値の取得（`fetchOgtCandidates`）とレポートの取得（`fetchSsbjReport`）は、サーバからも呼べるようクライアントを引数で受け取る形にした。表示名（`ogtValueLabel` など）と桁区切り（`formatDecimalForDisplay`）は画面・CSV・プレビューで共通にした |
| テスト | `scripts/db/__tests__/ssbjOgtAdoptionPolicy.test.ts`（RLS・GRANT・RPC・保存版連携）、`services/__tests__/ogtAdoptionServer.test.ts`、Route Handler・指紋・CSV・画面の単体テスト |

決めたこと:

- **採用する値はクライアントから受け取らない。** 画面は表示した候補値の指紋（キーを並べ替えた JSON の FNV-1a 64 ビット）だけを送り、
  サーバがセッションのクライアント（RLS あり）で OGT から候補値を取り直す。指紋が一致したときだけ、その取り直した値を
  service_role 限定の RPC で保存する。一致しなければ 409 で拒否し、利用者に見ていない値を採用させない。
  指紋は改ざん防止のためではなく「表示と同じか」の照合用で、改ざん防止はサーバが値を取り直すことで担保する
  （Web Crypto は https / localhost 以外で使えないため、同期の単純なハッシュにした）。
- **テーブルに insert / update の権限を与えない。** RLS は行の組織を検査できても、値が OGT 由来かは検査できないため。
  取り消し（delete）は値を作らないので、画面から直接行ってよい。
- **Scope 1・2・3 合計と Scope 3 の 15 カテゴリをまとめて採用する。** 区分ごとに採用できると、合計とカテゴリ別の値が
  別の時点のものになり、食い違いうるため。採用し直すと行を置き換える。
- **採用日時・採用者は RPC が付ける。** 行の `adoptedAt` と各値の `adoptedAt` を同じ時刻にそろえるため。
- **OGT の値が変わっても採用値は自動では変えない（候補値の自動採用・自動上書きはしない）。** 画面で採用値と現在の候補値を
  比べ、値・算定状態・採用方式・件数・参考値が変わった区分を表示し、採用し直すかは利用者が決める。取得時刻の違いだけでは変化にしない。
- **採用していないレポートの保存版は `sections.ghg = null` にする。** CSV は「未採用」の 1 行を出し、欠落と区別する。
- **算定済みの値が 1 つも無いときは採用できない。** 採用しても未算定しか残らないため。
- **サプライヤー別の値は参考値として一緒に保存するが、合計には足さない（§7.2）。** CSV も参考値として別の行にする。
- デモデータ（`ssbj_demo.sql`）には採用値を入れていない。18 件の値を手で書くと候補値の組み立てと食い違いうるため、画面から採用して確認する。

### プレビュー（T12）

作業中の内容と保存版を切り替えて、レポートの形で確認する画面（`/ssbj/[reportId]/preview`）と、PDF として保存するための
印刷ビュー（`/ssbj/[reportId]/preview/print`）。

| 対象 | 内容 |
|---|---|
| DB | `supabase/migrations/20260929182558_ssbj_report_preview.sql`。スナップショットの組み立て関数 `ssbj_build_report_snapshot`、作業中の内容を返す RPC `preview_ssbj_report`（ともに service_role 限定）、版生成 RPC `create_ssbj_report_version` を組み立て関数を使う形に置き換え（引数・検証・採番・戻り値と、T11 の過去版の複製は同じ） |
| API | `GET /api/ssbj/reports/[reportId]/preview`（`services/previewServer.ts`） |
| 画面 | `components/SsbjPreview.client.tsx`（表示する内容の選択・内部メモの表示・印刷ビューへのリンク）、`SsbjPreviewDocument.tsx`（本文。画面と印刷ビューで共通）、`SsbjPreviewStrategy.tsx`・`SsbjPreviewGhg.tsx`・`SsbjPreviewEvidence.tsx`、`SsbjPreviewPrintView.client.tsx`。レポートの内容の入口に「プレビュー」 |
| コード | `services/previewService.ts`（`SsbjPreviewSource`）、`hooks/useSsbjPreviewSource.ts`・`useSsbjVersionSummaries.ts`、`utils/preview.ts` |
| テスト | `scripts/db/__tests__/ssbjReportPreviewPolicy.test.ts`（組み立て関数の一本化・置き換えた版生成 RPC の検証の残存・権限）、本文・画面・印刷ビュー・Route Handler・サーバ処理の単体テスト |

決めたこと:

- **作業中の内容も、保存版と同じ組み立て（`ssbj_build_report_snapshot`）で作る。** 画面が各テーブルを個別に読んで組み立てると、
  保存版の形と食い違いうる。版生成 RPC も同じ関数を使うように置き換え、組み立てを 1 か所にした
  （基本情報の項目を足したときに片方だけ直す事故を防ぐ）。作業中の内容は保存しない。
- **表示している内容が作業中か保存版かを、本文の先頭に必ず出す。** 保存版は版番号・保存日時・版 ID を出す。作業中の内容は
  保存版になっていない変更を含むと明示する。
- **内部メモは既定で出さない。** 「内部メモも表示する」を選んだときだけ、開示する文章とは別の行に「開示しない」と明示して出す（§5）。
  印刷ビューにも同じ選択を渡す。
- **PDF は新しいライブラリを使わず、本体のレポートと同じ印刷ビュー方式（`window.print()` と `report-print-*` のクラス）で出す。**
  `ssbj-r1-scope.md` で R1 の出力に PDF を含めたため、T12 の範囲に入れた。
- **プレビューが描けないセクションは、黙って落とさず名前を出す。** 文章（T05）・判断（T09）などが加わったとき、
  その機能の PR で描画を足すまでの間も、出力漏れに気づけるようにするため。
- **根拠文書（T10）は、開示用参照文だけを常に出す。** 資料名・版・保管先・参照位置・主管部署は内部記録として、
  「内部メモも表示する」を選んだときだけ「開示しない」と明示して出す（T10 の画面の区分と同じ）。
- **四本柱のうち、まだ入力欄の無い章（ガバナンス・リスク管理）は、その旨を表示する。** 空欄にすると「記載なし」と読めるため。
- 表示する保存版の選択は、Radix のセレクトの操作が jsdom で難しいため、画面のテストではなく印刷ビューのテスト（URL の `source`）で確かめている。

### 四本柱と企業固有の補足の文章（T05）

要求項目マスター（T32a・暫定）の文章の項目ごとに、開示する文章と内部メモを書く画面（`/ssbj/[reportId]/narratives`）。

| 対象 | 内容 |
|---|---|
| DB | `supabase/migrations/20261001003809_ssbj_narratives.sql`。レポートと項目 ID の組ごとに 1 行の `ssbj_narratives`（RLS・列 GRANT・`bump_ssbj_draft_revision`・保存版セクション `ssbj_snapshot_section__narratives`） |
| 画面 | `components/SsbjNarratives.client.tsx`（章ごとの項目と、文章以外の画面で答える要求の案内）、`SsbjNarrativeItemCard.client.tsx`（要求・項番号・記載ガイド・記載例、文章の表示と編集）。レポートの内容の入口の先頭に「四本柱の文章」 |
| コード | `types.ts` の `SsbjNarrative`、`utils/narrative.ts`（正規化・検証、マスターの項目への当てはめ）、`services/narrativeService.ts`、`hooks/useSsbjNarratives.ts` / `useSsbjNarrativeForm.ts`、プレビューの `SsbjPreviewNarratives.tsx`、CSV の `services/versionCsvNarratives.ts` |
| テスト | `scripts/db/__tests__/ssbjNarrativesPolicy.test.ts`（制約・RLS・GRANT・保存版連携）、正規化・保存・画面・CSV・プレビューの単体テスト |
| デモデータ | 組織 A に 6 件（入力済み・「していない」の回答・未確認・非該当を含む。残りの項目は未入力の表示）、組織 B に 1 件 |

決めたこと:

- **要求 ID ではなく項目 ID で持つ。** 1 つの文章で一般開示基準と気候関連開示基準の同じ趣旨の要求に答える（二重入力しない）ため。
  項目と要求の対応はマスターが持つ。
- **項目 ID がマスターにあるかはアプリで検証し、DB は形式だけを検証する。** マスターはコードの定数で、DB からは見えないため。
- **行の無い項目は保存版に含めず、画面・プレビュー・CSV がマスターの全項目を並べて「未入力」と出す（`utils/narrative.ts`）。**
  入力の無い項目が出力から消えて見落とされないようにするため。マスターに無い項目の文章（ID の見直しで消えた項目など）も、黙って落とさず最後に出す。
- **保存は項目ごとに「更新して、無ければ作る」。** PostgREST の upsert は衝突時の更新にレポート・組織・項目の列も含めるが、
  3 列は作成後に変えない前提で update の列 GRANT に入れていないため（時間軸の定義と同じ）。
- **「〜していない」は非該当ではなく入力済みとして書く。** 画面の説明と記載ガイドで案内する（`ssbj-r1-scope.md` §5）。
- **文章以外の画面で答える要求は、章ごとに案内を出す。** 利用者がこの画面だけを見て「書く欄が無い」と誤解しないため。
- OGT の削減目標を「目標」の項目に参考表示する案は、記載ガイドでの案内にとどめた（画面には出していない）。

### 該当性・重要性・記載しない理由（T09）

要求項目マスター（T32a・暫定）の要求ごとに、利用者が下した判断を記録する画面（`/ssbj/[reportId]/judgements`）。

| 対象 | 内容 |
|---|---|
| DB | `supabase/migrations/20261001005308_ssbj_judgements.sql`。レポートと要求 ID の組ごとに 1 行の `ssbj_judgements`（RLS・列 GRANT・`bump_ssbj_draft_revision`・保存版セクション `ssbj_snapshot_section__judgements`） |
| 画面 | `components/SsbjJudgements.client.tsx`（章ごと・全般の表、判断が済んでいない要求の件数と絞り込み）、`SsbjJudgementDialog.client.tsx`（1 要求の編集）。レポートの内容の入口に「該当性・重要性の判断」 |
| コード | `types.ts` の `SsbjJudgement` と区分の定数、`utils/judgement.ts`（表示名・根拠の項番号・正規化・検証、マスターの要求への当てはめ）、`services/judgementService.ts`、`hooks/useSsbjJudgements.ts` / `useSsbjJudgementForm.ts`、プレビューの `SsbjPreviewJudgements.tsx`、CSV の `services/versionCsvJudgements.ts` |
| テスト | `scripts/db/__tests__/ssbjJudgementsPolicy.test.ts`（制約・区分の値の一致・RLS・GRANT・保存版連携）、正規化・検証・保存・画面・CSV・プレビューの単体テスト |
| デモデータ | 組織 A に 5 件（経過措置で記載しない旨を説明済み・説明が未確認・非該当・重要性なし・判断だけ）、組織 B に 1 件 |

決めたこと:

- **ソフトは判断を自動で決めない。** 既定はすべて「未確認」で、利用者が選んだ値だけを保存する（`ssbj-r1-scope.md` の対象外「自動の重要性判断」）。
- **リスク・機会の識別（T07）とは別のテーブル・別の画面で持つ。** 「リスクとして識別した」ことと「この要求の情報に重要性がある」ことは別の判断のため。
- **要求 ID ごとに持つ（文章のような項目 ID ではない）。** 該当性・重要性は基準の要求ごとに異なりうるため（一般基準と気候基準で同じ文章に答えても、判断は分けて残せる）。
- **記載しない理由の区分と根拠:** 重要性がない（適用基準 第22項）/ 経過措置（適用基準 第93項・第94項、気候基準 第102項・第103項）/
  機会の情報の商業上の機密（適用基準 第13項〜第16項）/ その他。区分は enum ではなく CHECK 制約（見直しやすさのため）。
- **「重要性がない」を理由にするのは、重要性を「重要性なし」にしたときだけ（DB の CHECK とアプリの検証の両方）。**
  **「商業上の機密」「その他」は内部の検討理由を必須にする。** 前者は要件をすべて満たすかの判断（第13項）を、後者は理由そのものを残すため。
- **経過措置・商業上の機密で記載しない場合は、その旨の開示が求められる（適用基準 第14項・第93項・第94項、気候基準 第102項・第103項）。**
  開示する説明が入力済みでなければ画面とプレビューで「その旨の説明が未入力」と知らせるが、保存は止めない（作業途中で保存できるようにするため）。
- **「判断が済んでいない」は、該当性が未確認、または該当なのに重要性が未確認。** 非該当の要求に重要性の判断を求めない。
- **行の無い要求は保存版に含めず、画面・CSV はマスターの全要求を並べて「未確認」と出す（`utils/judgement.ts`）。**
  プレビューは本文が埋もれないよう、判断を記録した要求だけを表にし、判断が済んでいない要求は件数で出す。マスターに無い要求の判断も黙って落とさない。
- **保存は要求ごとに「更新して、無ければ作る」**（文章と同じ理由）。
- 区分の表示名は画面・プレビュー・CSV で同じもの（`utils/judgement.ts`）を使う。

### R1 の全体テスト（T14）

作成から CSV までの主要な使い方と、境界条件・セキュリティ条件を、実画面・実データ（ローカル Supabase のデモシード）で確かめる。

| 対象 | 内容 |
|---|---|
| 全体テスト（ローカルのみ） | `e2e/ssbj/r1-acceptance.e2e.ts`（16 手順を順に実行）、`e2e/ssbj/support.ts`・`global-setup.ts`・`global-teardown.ts`。設定は `playwright.ssbj.config.ts` |
| 単体テスト（CI で実行） | `__fixtures__/fictionalReportTexts.ts`（架空の保存版の値を「開示する内容」「内部記録」「GHG の数値」に分けた一覧）を使い、`versionCsv.test.ts`・`SsbjPreviewDocument.test.tsx` で欠落と取り違えを、`ogtCandidateService.test.ts` で二重加算を、`fictionalReport.test.ts` で架空の保存版が全セクションを含むことを確かめる |
| 修正 | レポートの新規作成ダイアログが、高さ 720px 程度の画面で「作成する」まで届かなかった（ダイアログの中をスクロールできるようにした） |

実行方法（ローカル Supabase が起動し、デモシード `supabase/seeds/demo/demo.sql` が入っていること。SSBJ のデモデータ `ssbj_demo.sql` は使わない）:

```bash
npx playwright test -c playwright.ssbj.config.ts
# 別ポートで動かしている dev サーバと、インストール済みの Edge を使う場合
E2E_BASE_URL=http://localhost:3100 E2E_BROWSER_CHANNEL=msedge npx playwright test -c playwright.ssbj.config.ts
```

T14 の確認事項と、確かめている場所:

| 確認事項 | 全体テスト（手順） | 単体テスト |
|---|---|---|
| 主要な使い方（作成 → 文章 → リスク・機会 → OGT 採用 → 判断 → 根拠 → 保存 → 履歴 → プレビュー → CSV） | 1〜10 | — |
| 再表示（開き直しても入力が残る） | 2・7 | — |
| 他組織からのアクセスの拒否（画面 8 つ・API 3 つ・テーブル 8 つ・書き込み・service_role 限定の RPC） | 15 | 各テーブルの `scripts/db/__tests__/ssbj*Policy.test.ts` |
| 欠損と 0 の区別（書いていない項目は「未入力」、判断していない要求は「未確認」、算定値の無い区分は「未算定」で値は空） | 16 | `versionCsv.test.ts` |
| 二重加算が無い（採用し直しても 1 件、Scope 3 の合計＝カテゴリ別の合計、サプライヤー別の値は合計に足さない） | 11 | `ogtCandidateService.test.ts`・`versionCsv.test.ts` |
| 同時保存（読み込んだ後に別の画面で内容が変わったら、保存版の作成を競合として止める） | 13 | 保存 API の `route.test.ts` |
| 元データ更新後も保存版が変わらない（作業中の文章・OGT の値を変えても、保存版の DB・印刷ビュー・CSV が同じ） | 12・14 | — |
| 全入力項目がプレビューと CSV に欠落なく出る（内部記録は開示内容の欄に混ざらない） | 9・10 | `versionCsv.test.ts`・`SsbjPreviewDocument.test.tsx` |

テストデータの扱い:

- テストは名前が `[e2e-ssbj]` で始まるレポートを作り、終了時と次回の開始時に削除する（保存版・文章・判断なども連鎖削除される）。
  画面で中身を見たいときは `E2E_SSBJ_KEEP=1` を付けると残す。
- 手順 12 は、OGT の Scope 3 の直接入力（2024 年度）の 1 件を一時的に 1 t-CO2e 増やし、終わったら元の値に戻す（更新日時だけが変わる）。
  変える前に元の値を一時ファイルに控え、手順の途中で失敗・中断しても、終了時か次回の開始時に元の値へ戻す。
- CSV の生成履歴（`system_audit_logs`）は監査ログのため消さない（本体のスモークと同じ扱い）。

決めたこと:

- **CI では走らせず、ローカルだけで実行する。** CI で Supabase を起動するには本体と共通の `.github/workflows/ci.yml` を変える必要があるため
  （本体の E2E と同じ方針。[`e2e-testing.md`](e2e-testing.md)）。CI では単体テストの側で欠落・取り違え・二重加算を確かめる。
- **本体のスモーク（`npm run test:e2e`）に含めない。** 設定ファイルを分け、ファイル名を `*.e2e.ts` にして本体の `testMatch`（`*.spec.ts`）に掛からないようにした。
- **service_role キーは後片付けにだけ使う。** SSBJ のレポートは利用者が削除できない作りのため（保存版を消させない）。
  画面の操作と組織分離の確認は、デモユーザーのログイン（RLS の下）で行う。
- **入力する文は実行ごとに一意にする。** 開示する内容と内部記録が出力で取り違えられていないかを、CSV の列単位で見分けるため。
- **架空の保存版の値の一覧は、保存版のセクションの型（`SsbjSnapshotSections`）を網羅しないと型エラーになるようにした。**
  セクションを足したときに、プレビュー・CSV の欠落確認を足し忘れないため。

### 試行手順・制限事項（T15）

チームがローカル環境とデモデータで R1 を試すための準備・手順・制限事項・反映と切り戻し・情報の区分は、
[`ssbj-r1-trial.md`](ssbj-r1-trial.md) を正とする。

決めたこと:

- **試行はローカル環境とデモデータだけで行う。** 外部の環境への公開と、実データでの試行は対象外。
- **試行の前に全体テスト（T14）を流し、通らなければ試行しない。**
- **試行で得たフィードバックなど公開しない情報は、公開リポジトリに置かず、GitHub Project の非公開の項目で扱う。**
- **切り戻しは、`git revert` の PR と、ローカル DB の作り直しで行う。** マイグレーションを戻すためのマイグレーションは作らない。
