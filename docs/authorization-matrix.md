# 書き込み経路とロール別の権限表（SSBJ）

SSBJ 開示レポートで、データを書き換えられる経路をすべて洗い出し、どのロールに何を許すかを決めた表。
**SSBJ の権限の正本はこの文書**とする。データ契約と保存の仕組みは [`ssbj-spec.md`](ssbj-spec.md)、画面・URL は
[`functional-spec.md`](functional-spec.md) を正とし、ここでは繰り返さない。

経路を 1 つでも見落とすと、画面でボタンを隠していても、API や PostgREST を直接呼べば操作できてしまう。
そのため、正しさは DB（RLS・トリガー・RPC）と Route Handler で担保し、画面はそれに合わせて操作を出し分けるだけにする。

> 範囲: R2 では **SSBJ の中だけでロールを効かせる**。OGT 本体の経路も §4 に載せるが、本体の権限の仕組み
> （`current_user_can_edit()` / `current_user_is_admin()`、`profiles` / `invites` の制約、招待画面、本体の API）は変えない。
> 本体のロール別の権限は、別の項目に切り出して保留している。

---

## 1. ロール

| ロール | 値 | できること |
|---|---|---|
| 管理者 | OGT の `profiles.role = 'admin'` | SSBJ のすべての操作。SSBJ のロールの割り当て |
| 入力担当 | `editor` | レポートの作成と作業中データの編集、レビュー依頼・取り下げ、保存版の作成・復元、出力 |
| 承認担当 | `approver` | 指定されたレポートの承認・差戻し、作業中データと保存版の閲覧、出力。作業中データは編集できない |
| 閲覧者 | `viewer` | 承認済みのレポートの、承認した保存版の閲覧と出力だけ |

決めたこと:

- **SSBJ のロールは SSBJ 専用のテーブル（`ssbj_member_roles`。組織×利用者で 1 行）に持つ。** 判定は DB の関数
  `ssbj_user_role`（service_role 限定）と `ssbj_current_user_role()` ほか（authenticated）で行う（[`database-design.md`](database-design.md) 3.20）。 OGT 本体の `profiles.role` のうち、SSBJ が読むのは
  `'admin'` だけにする。`logger` / `viewer` は SSBJ のロールに使わない。本体はロールで権限を分けておらず
  （`src/types/role.ts` の「ロール無効化中」）、招待で決まる値をあとから変える画面も無いため、SSBJ の権限の根拠にできない。
- **ロールを割り当てていない利用者は入力担当として扱う。** 今は同じ組織の利用者なら誰でもすべてを編集できるので、
  有効にしたときに既存の利用者を締め出さないため（§5）。
- **OGT の管理者は、SSBJ でもすべての操作ができる。** 承認ロックの解除を「管理者か承認者」に限るという要件
  （[`ssbj-spec.md`](ssbj-spec.md) §13）と同じ扱い。ただし、自己承認の禁止（§3）は管理者にも適用する。
- **承認担当は作業中データを編集できない。** 書く人と承認する人を分けるため。承認担当が直したいときは差戻し、
  入力担当が直してから依頼し直す。
- **閲覧者は、承認済みのレポートの承認した保存版だけを見られる。** 作業中データ・未承認の保存版・操作履歴は見えない。
  承認前の内容や内部の検討の経過を、確定した開示と取り違えないため。
- **権限の範囲は当面「組織」単位とする。** 法人単位に広げるときは、ロールのテーブルに法人の列（空 = 組織全体）を足す形にする
  （法人の設計で合わせる）。

## 2. SSBJ の経路とロール別の可否

○ = できる、× = できない、「表示」= 見えるものだけ。今（R1）はどの経路も「自組織の利用者なら誰でも」できる。

### 2.1 作業中データ（RLS。ブラウザの Supabase クライアントから直接書く）

| 経路 | 対象 | 入力担当 | 承認担当 | 閲覧者 | 管理者 | 適用先 |
|---|---|---|---|---|---|---|
| レポートの作成 | `ssbj_reports` insert | ○ | × | × | ○ | R2-12 |
| 基本情報の更新 | `ssbj_reports` update（基本情報の列だけ GRANT） | ○ | × | × | ○ | R2-12 |
| リスク・機会 | `ssbj_risks_opportunities` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 時間軸の定義 | `ssbj_report_time_horizons` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 根拠文書 | `ssbj_evidence` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 四本柱の文章 | `ssbj_narratives` insert / update / delete | ○ | × | × | ○ | R2-12 |
| 該当性・重要性の判断 | `ssbj_judgements` insert / update / delete | ○ | × | × | ○ | R2-12 |
| OGT の値の採用の取り消し | `ssbj_ogt_adoptions` delete | ○ | × | × | ○ | R2-12 |

- 承認済みの間は、どのロールでも作業中データを変えられない（承認ロック。[`ssbj-spec.md`](ssbj-spec.md) §13）。
- SSBJ のテーブルを足すときは、書き込みのポリシーに SSBJ のロールの判定を使い、この表に行を足す。

### 2.2 Route Handler（`service_role` を使う。RLS を越えるので Route Handler でロールを確かめる）

| 経路 | 呼ぶ RPC | 入力担当 | 承認担当 | 閲覧者 | 管理者 | 適用先 |
|---|---|---|---|---|---|---|
| `POST /api/ssbj/reports/[reportId]/ogt-adoption`（OGT の値の採用） | `adopt_ssbj_ogt_values` | ○ | × | × | ○ | R2-11 |
| `POST /api/ssbj/reports/[reportId]/versions`（保存版の作成） | `create_ssbj_report_version` | ○ | × | × | ○ | R2-11 |
| `POST .../versions/[versionId]/restore`（版の復元） | `restore_ssbj_report_version` | ○ | × | × | ○ | R2-11 |
| `GET /api/ssbj/reports/[reportId]/preview`（作業中の内容のプレビュー） | `preview_ssbj_report` | ○ | ○ | × | ○ | R2-11 |
| `POST /api/ssbj/reports/[reportId]/status` の submit（レビュー依頼）・withdraw（取り下げ） | `change_ssbj_report_status` | ○ | × | × | ○ | R2-11 |
| 同 approve（承認） | 同上 | × | ○（指定された承認者のとき） | × | ○ | R2-11・R2-12 |
| 同 reopen（差戻し） | 同上 | × | ○（指定された承認者のとき） | × | ○ | R2-11・R2-12 |

- 承認・差戻しは、ロールに加えて「指定された承認者か管理者」であることが要る（今と同じ）。承認者に指定できるのは、承認担当か管理者だけにする（R2-12）。
- 状態の変更の RPC は、ロールの確認を Route Handler に任せず、RPC の中でも確かめる（RPC は操作者を引数で受け取るため、同じ判定を 1 か所に置く）。
- Route Handler は、service_role の RPC を呼ぶ前に `guardSsbjRole`（`src/features/ssbj/services/roleServer.ts`）でロールを確かめる。
  ロールを確かめられないときは 500 にし、確かめないまま進めない。

### 2.3 閲覧と出力

| 経路 | 対象 | 入力担当 | 承認担当 | 閲覧者 | 管理者 | 適用先 |
|---|---|---|---|---|---|---|
| レポートの一覧・基本情報 | `ssbj_reports` select | ○ | ○ | 承認済みだけ | ○ | R2-12 |
| 作業中データ | 2.1 の各テーブルの select | ○ | ○ | × | ○ | R2-12 |
| 保存版 | `ssbj_report_versions` select | ○ | ○ | 承認した版だけ | ○ | R2-12 |
| 操作履歴 | `ssbj_audit_logs` select | ○ | ○ | × | ○ | R2-12 |
| 保存版の CSV・Excel の出力 | `record_ssbj_export`（記録）→ ブラウザで出力 | ○ | ○ | 承認した版だけ | ○ | R2-12 |
| 操作履歴の CSV・Excel の出力 | 同上 | ○ | ○ | × | ○ | R2-12 |
| 印刷・PDF | ブラウザの印刷（記録しない） | 表示 | 表示 | 表示 | 表示 | — |
| OGT の候補値 | `ssbj_ogt_numeric_values` ほか OGT の集計の RPC（読むだけ） | ○ | ○ | × | ○ | R2-12（画面の出し分け） |

- 出力の記録は、見えるものだけを出力させる。見えない版を指定した記録は、版が見つからないものとして拒否する。
- CSV の出力履歴は、これまでどおり OGT 本体の `system_audit_logs` にも書く（本体の扱いは変えない）。

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

## 4. OGT 本体の経路（R2 では変えない）

今はどれもロールで絞っていない（`current_user_can_edit()` / `current_user_is_admin()` はログイン済みかだけを返し、Server Action も `profiles.role` を見ない）。
SSBJ のロールは、これらには効かない。

| 種類 | 経路 |
|---|---|
| RLS で書き込みを許すテーブル | `organizations`（update）、`profiles`（自分の氏名・電話の update）、`suppliers`、`locations`、`emission_factors`、`activity_records`、`scope3_category_emissions`、`scope3_category_methods`、`supplier_emissions`、`reduction_targets`、`reduction_target_years`（以上 insert / update / delete）、`system_audit_logs`（insert）、`invites`（insert / delete） |
| `service_role` を使う Route Handler | `POST /api/calculations`（算定）、`GET・POST /api/calculations/provisional-recalculation`（仮適用の再計算）、`POST /api/dashboard-aggregates/refresh`（集計の更新）、`POST /api/idea-imports`・`/upload-url`・`DELETE /api/idea-imports/[id]`（IDEA の取込）、`POST /api/account/delete`（アカウントの削除） |
| Storage | 取込ファイルの置き場（`storage.objects` の delete。書き込みは署名付き URL 経由） |
| 利用者が呼ぶ関数 | ダッシュボード・レポートの集計（読むだけ） |
| ファイル出力 | GHG 排出量レポートの CSV・印刷（`system_audit_logs` に記録） |
| Server Action | 画面から呼ぶサーバの関数。下の表（§4.1） |

### 4.1 Server Action

画面から呼ぶサーバの関数（`'use server'`）のうち、データを書き込むもの。`service_role` を使うものは RLS を越えるので、
許可条件は関数の中の確認だけで決まる。

| Server Action（ファイル） | 対象データと操作 | 使うクライアント | 今の許可条件 |
|---|---|---|---|
| `addFiscalYear`・`deleteFiscalYear`（`src/features/settings/services/fiscalYears.ts`） | `fiscal_years` の insert / delete（参照するデータがある年度は削除しない） | `service_role` | ログイン済み。自組織の年度だけ |
| `saveMemberChanges`（`src/features/settings/services/members.ts`） | ほかのメンバーの削除（auth のユーザーを消し、`profiles` は連鎖削除） | `service_role` | ログイン済み。自組織のメンバーだけ。自分は消せない |
| `createInvite`・`revokeInvite`（`src/features/settings/services/invites.ts`） | `invites` の insert / delete（発行では、同じメール宛ての未受諾の招待を消してから作る） | 利用者（RLS。上の表の `invites`） | ログイン済み。自組織の招待だけ（RLS） |
| `changePassword`（`src/features/settings/services/password.ts`） | 自分のパスワード（auth のユーザー） | `service_role` | ログイン済み。今のパスワードが正しい |
| `completePasswordRecovery`（`src/features/auth/services/passwordRecovery.ts`） | 自分のパスワード（auth のユーザー） | `service_role` | パスワードの再設定のメールから来たセッション（再設定の目印の Cookie がある） |
| `setupOrganization`（`src/features/auth/services/setup.ts`） | auth のユーザー・`organizations`・`profiles`（`role = 'admin'`）・`locations`・`fiscal_years` の insert（初回登録） | `service_role` | ログイン不要。組織が 1 つも無い環境だけ |
| `acceptInvite`（`src/features/auth/services/invites.ts`） | `invites` の update（受諾日時）、auth のユーザー・`profiles` の insert | `service_role` | ログイン不要。期限内で未受諾の招待のトークン |

- **メンバーの削除は、同じ組織のログイン済みの利用者なら誰でもできる**（ロールを見ない。`members.ts` のコメントのとおり、今の OGT 本体の設計）。
  本体のロール別の権限を入れるときに、最初に扱う経路の 1 つになる。
- SSBJ には Server Action が無い（`service_role` を使う SSBJ の処理は、すべて §2.2 の Route Handler から呼ぶ）。

本体のロール別の権限を入れるときは、この表（§4・§4.1）を土台に、§1 と同じ形でロールごとの可否を決める。

## 5. 既存の利用者の切り替え

- **ロールを割り当てていない利用者は入力担当になる。** 編集（レポートの作成・入力・レビューの依頼と取り下げ）は今までどおりできる。
  管理者は今までどおりすべてできる。
- **承認・差戻しは変わる。** 今は承認者に指定されれば誰でも承認・差戻しができるが、SSBJ のロールを有効にした後は、
  管理者か承認担当だけになる（§2.2・§3）。承認担当を割り当てるまでは、承認者に指定でき、承認・差戻しができるのは管理者だけ。
  権限を絞りたい組織、管理者以外にも承認させたい組織は、管理者が承認担当・閲覧者を割り当てる。
- **管理者が 1 人もいない組織**（`profiles.role` の既定値は `logger`）では、SSBJ のロールを割り当てられない。全員が入力担当のままで、
  編集は今までどおりできるが、承認・差戻しのできる人がいなくなる。初回登録者は管理者として作られる（`src/features/auth/services/setup.ts`）ので、
  通常は起きない。起きたときは OGT 本体の運用（DB の管理者が `profiles.role` を設定する）に従う。
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
