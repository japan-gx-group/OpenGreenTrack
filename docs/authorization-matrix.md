# 書き込み経路とロール別の権限表（SSBJ）

SSBJ 開示レポートで、データを書き換えられる経路をすべて洗い出し、どのロールに何を許すかを決めた表。
**SSBJ の権限の正本はこの文書**とする。データ契約と保存の仕組みは [`ssbj-spec.md`](ssbj-spec.md)、画面・URL は
[`functional-spec.md`](functional-spec.md) を正とし、ここでは繰り返さない。

経路を 1 つでも見落とすと、画面でボタンを隠していても、API や PostgREST を直接呼べば操作できてしまう。
そのため、正しさは DB（RLS・トリガー・RPC）と Route Handler で担保し、画面はそれに合わせて操作を出し分けるだけにする。

> 範囲: SSBJ のロールは **SSBJ の中だけで効く**。OGT 本体のロール（管理者・メンバー）と本体の経路の権限は、
> 本体の決め方（Issue #2 の方針。[`functional-spec.md`](functional-spec.md) §4.8.1）を正とし、SSBJ からは変えない。本体の経路は §4 に載せる。
> 本体が SSBJ のロールについて明示しているのは、「本体には閲覧専用のロールを作らない。SSBJ の閲覧者は SSBJ のロールで扱う」（#2）と、
> 「SSBJ の管理者の判定（`profiles.role = 'admin'`）はそのまま使える」（#179）の 2 点。入力担当・承認担当は SSBJ で決めた（R2-09 #68・R2-10 #69）。
> 本体のロールとの関係と、本体と揃える残りは §1.1。

---

## 1. ロール

| ロール | 値 | できること |
|---|---|---|
| 管理者 | OGT の `profiles.role = 'admin'` | SSBJ のすべての操作。SSBJ のロールの割り当て |
| 入力担当 | `editor` | レポートの作成と作業中データの編集、レビュー依頼・取り下げ、保存版の作成・復元、出力 |
| 承認担当 | `approver` | 指定されたレポートの承認・差戻し、作業中データと保存版の閲覧、出力。作業中データは編集できない |
| 閲覧者 | `viewer` | 承認済みのレポートの、承認した保存版の開示する内容の閲覧と出力だけ（内部メモ・内部記録は見えない） |

決めたこと:

- **SSBJ のロールは SSBJ 専用のテーブル（`ssbj_member_roles`。組織×利用者で 1 行）に持つ。** 判定は DB の関数
  `ssbj_user_role`（service_role 限定）と `ssbj_current_user_role()` ほか（authenticated）で行う（[`database-design.md`](database-design.md) 3.29）。
- **SSBJ の管理者は、OGT 本体の管理者と同じ条件（`profiles.role = 'admin'`）で決める。** 本体の判定（DB の `current_user_is_admin()`、
  画面とサーバの `isAdmin()`。[`database-design.md`](database-design.md) 3.14）と同じ条件で、本体のメンバー管理で管理者を付け外しすると、
  SSBJ の管理者もそれに連れて変わる（管理者でなくなった人は、SSBJ では割り当てたロール、割り当てが無ければ入力担当になる）。
  本体の判定が変わったときに気づけるよう、`scripts/db/__tests__/ssbjMemberRolesPolicy.test.ts` が両方の条件を照らし合わせる。
- **本体のメンバー（`logger`・`viewer`）は、SSBJ では割り当てたロールになる。** 本体の値の `viewer` は本体ではメンバー（データの入力もできる）で、
  SSBJ の閲覧者とは別物。SSBJ の承認担当・閲覧者も、本体の画面ではメンバーとして入力できる（本体の決め方のまま）。
- **ロールを割り当てていない利用者は入力担当として扱う。** 今は同じ組織の利用者なら誰でもすべてを編集できるので、
  有効にしたときに既存の利用者を締め出さないため（§5）。
- **OGT の管理者は、SSBJ でもすべての操作ができる。** 承認ロックの解除を「管理者か承認者」に限るという要件
  （[`ssbj-spec.md`](ssbj-spec.md) §13）と同じ扱い。ただし、自己承認の禁止（§3）は管理者にも適用する。
- **承認担当は作業中データを編集できない。** 書く人と承認する人を分けるため。承認担当が直したいときは差戻し、
  入力担当が直してから依頼し直す。
- **閲覧者は、承認済みのレポートの承認した保存版だけを見られる。** 作業中データ・未承認の保存版・操作履歴は見えない。
  承認前の内容や内部の検討の経過を、確定した開示と取り違えないため。
- **閲覧者には、承認した保存版でも内部メモ・内部記録（[`ssbj-spec.md`](ssbj-spec.md) §5）を返さない。** 開示する内容だけを見せて出力させる。
  内部の検討の経過・資料の保管先・ファイルの照合用の記録は開示しない内容で、閲覧者に渡すと出力から社外に出うるため（§2.3）。
- **権限の範囲は当面「組織」単位とする。** 法人単位に広げるときは、§1.1 の機能ごとの役割の仕組みに任意の法人（空 = 組織全体）を
  持たせる形にする（#219 と法人の設計で合わせる）。

### 1.1 本体のロールとの関係（二層）

本体のロール（管理者・メンバー）とは数を揃えず、**本体の 2 つを土台に、SSBJ の業務の役割（入力担当・承認担当・閲覧者）を重ねる**。
本体の 2 つに揃えると、書く人と承認する人を分けることと、承認した版だけを見る人を置くこと（SSBJ の要件。§1 の決めたこと）が成り立たないため。
一方で、管理する場所・変更の記録・呼び名・判定のしかたは、本体に揃える。

| 項目 | 今 | 本体と揃える方針 |
|---|---|---|
| 管理者の判定 | 本体と同じ条件（揃っている） | このまま |
| ロールを変える場所 | 本体のメンバー管理と「SSBJ の権限」（`/ssbj/roles`）の 2 か所 | 本体のメンバー管理の 1 か所で、本体のロールと SSBJ の役割を設定する |
| 変更の記録 | 本体は `system_audit_logs`、SSBJ は `ssbj_audit_logs` | SSBJ の役割の変更も `system_audit_logs` に残す |
| 呼び名 | 本体の値の `viewer`（＝メンバー）と、SSBJ の閲覧者がかぶる | 本体の画面に出すときは「SSBJ の閲覧者」のように、SSBJ の役割と分かる名前にする |
| 持ち方 | SSBJ 専用の表（`ssbj_member_roles`） | 本体に機能ごとの役割の仕組み（組織 × 利用者 × 機能 × 役割、必要なら法人）を置き、SSBJ を最初の利用者にする |

管理する場所・記録・持ち方は本体の変更なので、本体のメンテナーと #219 で決める。決まるまでは今の形のまま使い、SSBJ 側の作業は #220 で行う。

## 2. SSBJ の経路とロール別の可否

○ = できる、× = できない、「表示」= 見えるものだけ。今（R1）はどの経路も「自組織の利用者なら誰でも」できる。

### 2.1 作業中データ（RLS。ブラウザの Supabase クライアントから直接書く）

| 経路 | 対象 | 入力担当 | 承認担当 | 閲覧者 | 管理者 | 適用先 |
|---|---|---|---|---|---|---|
| レポートの作成 | `ssbj_reports` insert | ○ | × | × | ○ | R2-12 |
| 基本情報の更新 | `ssbj_reports` update（基本情報の列だけ GRANT） | ○ | × | × | ○ | R2-12 |
| リスク・機会 | `ssbj_risks_opportunities` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 業種から出した候補への判断 | `ssbj_risk_candidate_decisions` insert / update / delete、RPC `adopt_ssbj_risk_candidate`（利用者の権限で、リスク・機会の登録と採用の記録を一緒に保存） | ○ | × | × | ○ | R2-12 |
| 時間軸の定義 | `ssbj_report_time_horizons` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 根拠文書 | `ssbj_evidence` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 四本柱の文章 | `ssbj_narratives` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 該当性・重要性の判断 | `ssbj_judgements` insert / update / delete | ○ | × | × | ○ | R2-12 |
| OGT の値の採用の取り消し | `ssbj_ogt_adoptions` delete | ○ | × | × | ○ | R2-12 |
| 外部算定値 | `ssbj_external_emissions` insert / update / delete | ○ | × | × | ○ | R2-13 |

- 承認済みの間は、どのロールでも作業中データを変えられない（承認ロック。[`ssbj-spec.md`](ssbj-spec.md) §13）。
- ロールの条件は、各テーブルの既存のポリシー（自組織であること）に、`AS RESTRICTIVE` のポリシーを重ねて効かせる
  （`20261023100000_ssbj_role_policies.sql`）。書き込みは `ssbj_current_user_can_edit()`、閲覧は `ssbj_current_user_can_view_working()`。
- **SSBJ のテーブルを足すときは**、承認ロックのトリガーと一緒に、同じ形の RESTRICTIVE のポリシー（利用者が書ける操作ごとと select）を足し、
  この表に行を足す。付け忘れは `scripts/db/__tests__/ssbjRolePoliciesPolicy.test.ts` が検出する（マイグレーションの `ssbj_` のテーブルをすべて調べる。
  ポリシーを重ねないテーブルは、理由と一緒にテストに書く）。

### 2.2 Route Handler（`service_role` を使う。RLS を越えるので Route Handler でロールを確かめる）

| 経路 | 呼ぶ RPC | 入力担当 | 承認担当 | 閲覧者 | 管理者 | 適用先 |
|---|---|---|---|---|---|---|
| `POST /api/ssbj/reports/[reportId]/ogt-adoption`（OGT の値の採用） | `adopt_ssbj_ogt_values` | ○ | × | × | ○ | R2-11 |
| `POST /api/ssbj/reports/[reportId]/versions`（保存版の作成） | `create_ssbj_report_version` | ○ | × | × | ○ | R2-11 |
| `POST .../versions/[versionId]/restore`（版の復元） | `restore_ssbj_report_version` | ○ | × | × | ○ | R2-11 |
| `GET /api/ssbj/reports/[reportId]/preview`（作業中の内容のプレビュー） | `preview_ssbj_report` | ○ | ○ | × | ○ | R2-11 |
| `GET /api/ssbj/reports/[reportId]/approved-version`（承認した保存版の開示する内容） | —（`ssbj_reports`・`ssbj_report_versions` を読む） | ○ | ○ | ○ | ○ | R2-12 |
| `POST /api/ssbj/reports/[reportId]/status` の submit（レビュー依頼）・withdraw（取り下げ） | `change_ssbj_report_status` | ○ | × | × | ○ | R2-11 |
| 同 approve（承認） | 同上 | × | ○（指定された承認者のとき） | × | ○ | R2-11・R2-12 |
| 同 reopen（差戻し） | 同上 | × | ○（指定された承認者のとき） | × | ○ | R2-11・R2-12 |

- 承認・差戻しは、ロールに加えて「指定された承認者か管理者」であることが要る。承認者に指定できるのは、承認担当か管理者だけ（状態の変更の RPC が `P2052` で拒否する）。
- 状態の変更の RPC は、ロールの確認を Route Handler に任せず、RPC の中でも確かめる（RPC は操作者を引数で受け取るため、同じ判定を 1 か所に置く）。
- Route Handler は、service_role の RPC を呼ぶ前に `guardSsbjRole`（`src/features/ssbj/services/roleServer.ts`）でロールを確かめる。
  ロールを確かめられないときは 500 にし、確かめないまま進めない。

### 2.3 閲覧と出力

| 経路 | 対象 | 入力担当 | 承認担当 | 閲覧者 | 管理者 | 適用先 |
|---|---|---|---|---|---|---|
| レポートの一覧・基本情報 | `ssbj_reports` select | ○ | ○ | 承認済みだけ | ○ | R2-12 |
| 作業中データ | 2.1 の各テーブルの select | ○ | ○ | × | ○ | R2-12 |
| 保存版 | `ssbj_report_versions` select | ○ | ○ | × | ○ | R2-12 |
| 承認した保存版の開示する内容 | `GET .../approved-version`（2.2） | ○ | ○ | ○ | ○ | R2-12 |
| 操作履歴 | `ssbj_audit_logs` select | ○ | ○ | × | ○ | R2-12 |
| 保存版の CSV・Excel の出力 | `record_ssbj_export`（記録）→ ブラウザで出力 | ○ | ○ | 承認した版の開示する内容だけ | ○ | R2-12 |
| 操作履歴の CSV・Excel の出力 | 同上 | ○ | ○ | × | ○ | R2-12 |
| 印刷・PDF | ブラウザの印刷（記録しない） | 表示 | 表示 | 表示 | 表示 | — |
| OGT の候補値 | `ssbj_ogt_numeric_values` ほか OGT の集計の RPC（読むだけ） | ○ | ○ | × | ○ | R2-12（画面の出し分け） |

- 出力の記録は、見えるものだけを出力させる。見えない版を指定した記録は、版が見つからないものとして拒否する。
  閲覧者が出力できるのは承認した版の CSV・Excel だけで、内部記録の列を入れない。
- **閲覧者に内部メモ・内部記録を返さないことは、DB と Route Handler で担保する。** 保存版の snapshot は 1 つの列に内部記録を含み、
  RLS では一部だけを隠せない。そこで `ssbj_report_versions` の行は閲覧者に 1 行も見せず（RESTRICTIVE の select）、
  承認した版は `approved-version` が service_role で読み、内部記録を除いてから返す（除く項目の分類は
  `src/features/ssbj/utils/disclosedSnapshot.ts`。分類に無い項目も返さない）。画面で隠すだけでは、PostgREST を直接呼べば読めてしまうため。
- CSV の出力履歴は、これまでどおり OGT 本体の `system_audit_logs` にも書く（本体の扱いは変えない）。保存履歴の画面の出力履歴の一覧は
  閲覧者に出さないが、`system_audit_logs` の RLS は組織単位のまま（本体は変えない）なので、閲覧者も PostgREST から組織の出力の記録
  （どの版をいつ出力したか）は読める。内部メモ・内部記録は含まない。

### 2.4 SSBJ のロールの割り当て（R2-10 で追加する）

| 経路 | 入力担当 | 承認担当 | 閲覧者 | 管理者 | 適用先 |
|---|---|---|---|---|---|
| ロールの一覧（誰がどのロールか） | ○ | ○ | ○ | ○ | R2-10 |
| ロールの割り当て・変更・解除 | × | × | × | ○ | R2-10 |

- 一覧を全員に見せるのは、承認者の候補（承認担当か管理者）を画面に出すため。
- 割り当て・変更・解除は SSBJ の操作履歴に残す。

## 3. 承認の規則（ロールと別に、全員に適用する）

[`ssbj-spec.md`](ssbj-spec.md) §13「状態管理と承認ロック」の自己承認の禁止を、この表の前提とする。

- 承認者に、レビューを依頼した本人を指定できない。
- レビューを依頼した本人は承認できない（管理者でも）。
- レビューの依頼の後に作業中データを変更した人は承認できない（管理者でも）。
- 差戻しには理由が必須。

承認担当のロールを入れた後は、承認者の条件にロールを加える（承認担当か管理者だけを承認者に指定でき、承認できる）。

## 4. OGT 本体の経路（SSBJ のロールは効かない）

本体の経路の権限は、本体の決め方を正とする（管理者だけに限る操作と全員ができる操作は [`functional-spec.md`](functional-spec.md) §4.8.1）。
判定は、DB の `current_user_is_admin()`（`role` が `admin` か）と、サーバの `requireAdmin()`（`src/lib/authz.ts`）。
`current_user_can_edit()` は「ログインしているか」を返す（データの入力・算定・マスタの編集は全員が行うため）。SSBJ のロールは、これらには効かない。

| 種類 | 経路 |
|---|---|
| RLS で書き込みを許すテーブル | `organizations`（update。管理者だけ）、`invites`（insert / delete。管理者だけ）、`profiles`（自分の氏名・電話の update）、`suppliers`、`locations`、`emission_factors`、`activity_records`、`scope3_category_emissions`、`scope3_category_methods`、`supplier_emissions`、`reduction_targets`、`reduction_target_years`（以上 insert / update / delete）、`activity_record_evidence`（insert / delete）、`system_audit_logs`（insert） |
| サーバで書く Route Handler | `POST /api/calculations`（算定）、`GET・POST /api/calculations/provisional-recalculation`（仮適用の再計算）、`POST /api/dashboard-aggregates/refresh`（集計の更新）、`POST /api/idea-imports`・`/upload-url`・`DELETE /api/idea-imports/[id]`（IDEA の取込）、`POST /api/activity-evidence`・`/upload-url`・`DELETE /api/activity-evidence/[id]`（活動量の記録の帳票）、`POST /api/ai/invoice-reading`（請求書の AI 読取り。提供元への送信と `system_audit_logs` の `ai.request`）、`GET /api/ai/models`（モデルの一覧。管理者だけ）、`POST /api/account/delete`（アカウントの削除。最後の管理者は退会できない） |
| 利用者が呼ぶ RPC | `change_member_role`（ロールの変更。service_role 限定で、Server Action の `saveMemberChanges` から呼ぶ。操作する人が管理者かを中でも確かめる） |
| トリガー | `ensure_organization_keeps_admin`（組織の管理者が 0 人になるロールの変更・削除・退会を拒否する。組織ごとの削除は止めない） |
| Storage | 取込ファイル・帳票の置き場（`import-files`。ブラウザからの delete は IDEA 取込のファイルだけで、帳票は `DELETE /api/activity-evidence/[id]` だけが消す。書き込みは署名付き URL 経由） |
| 利用者が呼ぶ関数 | ダッシュボード・レポートの集計（読むだけ） |
| ファイル出力 | GHG 排出量レポートの CSV・印刷（`system_audit_logs` に記録） |
| Server Action | 画面から呼ぶサーバの関数。下の表（§4.1） |

### 4.1 Server Action

画面から呼ぶサーバの関数（`'use server'`）のうち、データを書き込むもの。`service_role` を使うものは RLS を越えるので、
許可条件は関数の中の確認だけで決まる。

| Server Action（ファイル） | 対象データと操作 | 使うクライアント | 今の許可条件 |
|---|---|---|---|
| `addFiscalYear`・`deleteFiscalYear`（`src/features/settings/services/fiscalYears.ts`） | `fiscal_years` の insert / delete（参照するデータがある年度は削除しない。SSBJ のレポートがある年度も消さない） | `service_role` | 管理者（`requireAdmin`）。自組織の年度だけ |
| `saveMemberChanges`（`src/features/settings/services/members.ts`） | ほかのメンバーのロールの変更（RPC `change_member_role`）と削除（auth のユーザーを消し、`profiles` は連鎖削除） | `service_role` | 管理者（`requireAdmin`）。自組織のメンバーだけ。自分は消せない。管理者が 0 人になる変更は拒否する |
| `createInvite`・`revokeInvite`（`src/features/settings/services/invites.ts`） | `invites` の insert / delete（発行では、同じメール宛ての未受諾の招待を消してから作る。ロールは管理者かメンバー） | 利用者（RLS。上の表の `invites`） | 管理者（`requireAdmin` と RLS）。自組織の招待だけ |
| `saveAiModel`（`src/features/ai/services/aiSettingsActions.ts`） | `ai_settings` の upsert（組織で使う AI のモデル） | `service_role` | 管理者（`requireAdmin`） |
| `saveAiCredential`・`deleteAiCredential`（`src/features/ai/services/aiCredentialActions.ts`） | `ai_credentials` の upsert / delete（画面から登録する AI の API キー。暗号化して保存） | `service_role` | 管理者（`requireAdmin`）と、ログインのパスワードの再入力。画面からの登録を許す設定のときだけ |
| `changePassword`（`src/features/settings/services/password.ts`） | 自分のパスワード（auth のユーザー） | `service_role` | ログイン済み。今のパスワードが正しい |
| `completePasswordRecovery`（`src/features/auth/services/passwordRecovery.ts`） | 自分のパスワード（auth のユーザー） | `service_role` | パスワードの再設定のメールから来たセッション（再設定の目印の Cookie がある） |
| `setupOrganization`（`src/features/auth/services/setup.ts`） | auth のユーザー・`organizations`・`profiles`（`role = 'admin'`）・`locations`・`fiscal_years` の insert（初回登録） | `service_role` | ログイン不要。組織が 1 つも無い環境だけ |
| `acceptInvite`（`src/features/auth/services/invites.ts`） | `invites` の update（受諾日時）、auth のユーザー・`profiles` の insert | `service_role` | ログイン不要。期限内で未受諾の招待のトークン |

- SSBJ には Server Action が無い（`service_role` を使う SSBJ の処理は、すべて §2.2 の Route Handler から呼ぶ）。
- 本体の経路を足す・変えるときは、本体の決め方に合わせてこの表を直す（SSBJ のロールの可否は §2 だけで決める）。

## 5. 既存の利用者の切り替え

- **ロールを割り当てていない利用者は入力担当になる。** 編集（レポートの作成・入力・レビューの依頼と取り下げ）は今までどおりできる。
  管理者は今までどおりすべてできる。
- **承認・差戻しは変わる。** 今は承認者に指定されれば誰でも承認・差戻しができるが、SSBJ のロールを有効にした後は、
  管理者か承認担当だけになる（§2.2・§3）。承認担当を割り当てるまでは、承認者に指定でき、承認・差戻しができるのは管理者だけ。
  権限を絞りたい組織、管理者以外にも承認させたい組織は、管理者が承認担当・閲覧者を割り当てる。
- **管理者が 1 人もいない組織**では、SSBJ のロールを割り当てられず、承認・差戻しのできる人もいない。本体は、管理者が 0 人になる
  ロールの変更・削除・退会を拒否する（`ensure_organization_keeps_admin`）ので、新しくは起きない。本体のロールを入れる前に組織を作った人の
  アカウントを消していた組織だけで起きうる。その場合は本体の復旧の手順（[`setup-guide.md`](setup-guide.md) 2-H）に従う。
- **本体のメンバー管理で管理者でなくなった人**は、SSBJ でも管理者でなくなる（§1）。レビュー中のレポートの承認者だった場合は、
  承認担当を割り当てない限り承認できなくなる。管理者が承認担当を割り当てるか、差戻して依頼し直す。
- **切り替えはマイグレーションで行い、データは入れない**（AGENTS.md R12）。テーブルと判定の関数を足すだけで、割り当ては
  管理者が画面で行う。デモデータでは seed で各ロールの利用者を用意する。
- **承認担当を入れた時点でレビュー中のレポート**の承認者が承認担当でも管理者でもないときは、その承認者は承認できなくなる。
  管理者が承認担当を割り当てるか、差戻して依頼し直す。

## 6. 適用の順番

| Issue | 内容 |
|---|---|
| R2-08 | 自己承認の禁止と差戻しの理由の必須化（§3） |
| R2-09 | この文書 |
| R2-10 | SSBJ のロールのテーブル・判定の関数・割り当ての画面（§1・§2.4） |
| R2-11 | SSBJ の Route Handler でのロールの確認（§2.2） |
| R2-12 | SSBJ のテーブル・状態の変更・閲覧への適用（§2.1・§2.3、§3 の承認者の条件） |
