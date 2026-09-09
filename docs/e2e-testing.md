# E2E スモークテスト（Playwright）

基幹導線が壊れたことを検知するための最小限のブラウザテストです。
ビルドが通っても画面が動かない種類の不具合を、リリース前に自分で気づけるようにするのが目的です。

- テストコード: `e2e/`
- 設定: `playwright.config.ts`
- 対象ブラウザ: Chromium のみ（実行時間を抑えるため）

---

## 何を検証しているか

基幹の4つの導線をそのまま4本のテストにしています。

| # | シナリオ | ファイル |
|---|---|---|
| 1 | ログイン → ダッシュボードが表示される | `e2e/auth.setup.ts` |
| 2 | データ入力 → データ入力タブで活動量を保存できる | `e2e/smoke.spec.ts` |
| 3 | 算定が走り、ダッシュボードの数値に反映される | `e2e/smoke.spec.ts` |
| 4 | レポート出力 → CSV がダウンロードできる | `e2e/smoke.spec.ts` |

シナリオ1が `auth.setup.ts` にあるのは、ログイン結果（セッション）を `e2e/.auth/user.json` に保存して
残り3本で使い回すためです。ログイン導線が壊れれば、この setup が落ちて全体が止まります。

---

## 前提

**ローカル Supabase が起動していて、デモシード（`supabase/seeds/demo/demo.sql`）が投入済みであること。**
テストはデモシードのデータ（`org-a@example.com` / 拠点「大阪支社」/ 2024年度の排出係数）を前提に書いています。

```bash
npx supabase start
npm run db:reset:demo   # マイグレーション適用 + 公式排出係数 + デモシード投入
```

`supabase db reset` だけではデモシードは入りません（公式排出係数マスタのみ）。すでに `db reset` 済みの DB には
`npm run db:seed:demo` でデモシードだけを追加できます。

> `npm run db:reset:demo`（中身は `supabase db reset`）はローカルDBを作り直します。手元で作った確認用データは消えるので注意してください。

`.env.local` に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` が必要です
（`playwright.config.ts` が読み込みます）。

> E2E は活動量の登録・削除や算定バッチの実行で DB を書き換えます。誤って本番の Supabase に向けて
> 実行しないよう、`NEXT_PUBLIC_SUPABASE_URL` のホストが `localhost` / `127.0.0.1` / `host.docker.internal`
> 以外の場合は起動時にエラーで止まります。検証用の別環境に対して意図的に実行する場合のみ
> `E2E_ALLOW_REMOTE_SUPABASE=1` を付けてください。

初回のみ、ブラウザ本体をダウンロードします。

```bash
npm run test:e2e:install
```

---

## 実行

```bash
npm run test:e2e          # ヘッドレス実行
npm run test:e2e:ui       # Playwright UI モード（1本ずつ流して途中経過を見る）
npx playwright show-report  # 失敗時のトレース・スクリーンショット・動画を見る
```

開発サーバは Playwright が自動で起動します（`npm run dev` = http://localhost:3000）。
ローカル実行時は、すでに 3000 で dev サーバが動いていればそれを再利用します
（`CI` 環境変数がある場合は再利用せず必ず起動します）。

> **注意**: 再利用するため、別ブランチの dev サーバが 3000 で動いていると、そのブランチのコードを
> テストしてしまいます。検証したいブランチのサーバが動いているか確認してください。
> 一時的に別ポートを見たい場合は `E2E_BASE_URL=http://localhost:3100 npx playwright test` のように
> 指定します（この場合サーバの起動は自分で行います）。

---

## テストデータの扱い

- テストが作る活動量レコードには備考に目印（`[e2e-smoke] ...`）を入れています。
  実行前（`e2e/global-setup.ts`）と実行後（`e2e/global-teardown.ts`）に、この目印で検索して削除します。
  削除は anon キー + seed ユーザーのログインで行うため、RLS の範囲（自組織）を超えて消すことはありません。
- **`dashboard_aggregates` は元に戻りません。** 算定は年度の集計を絶対値で再計算する仕組み
  （`refresh_dashboard_aggregates`）のため、テストで算定が走った年度の集計行は seed の値ではなく
  実データから計算し直した値になります。seed の状態に戻したいときは `npm run db:reset:demo` を実行してください。
- レポート生成履歴（`system_audit_logs`）はテスト実行のたびに1件増えます。監査ログの性質上、削除はしません。
- 算定API（`/api/calculations`）には「組織あたり1分に10件」のレート制限があります。スモークは1回の実行で
  3件の算定を走らせるため、**短時間に何度も続けて流すと開始時に最大1分ほど待ちます**（`e2e/global-setup.ts` が
  枠が空くまで待機し、待っている旨をログに出します）。失敗ではありません。
- 算定APIにはもう1つ「組織あたり稼働中1件まで」の制限があり、`status='pending'` のバッチが残っていると
  **最大10分**すべての算定が弾かれます。テストを Ctrl+C で中断したり dev サーバが落ちたりすると起こり得ます。
  こちらも `e2e/global-setup.ts` が開始前に検知して解消を待ち、理由をログに出します。

---

## CI で走らせるか

**現時点では走らせません（ローカル実行のみ）。**
`@playwright/test` を追加した際に合意した方針です（AGENTS.md の「ライブラリ追加は要提案」に対応）。

理由:

- CI で回すには GitHub Actions 上で Supabase（Docker）を起動して `npm run db:reset:demo` まで行う必要があり、
  1 PR あたりの実行時間とコストが lint / test / build の3段に対して大きく増える
- まずはスモークが「手元で確実に回る」状態を作り、不安定さが無いことを確認してから CI 化を判断したい

将来 CI に載せる場合は、`.github/workflows/ci.yml` に `supabase/setup-cli` でローカル Supabase を
起動するジョブを足し、`npm run test:e2e` を実行する形になります。`playwright.config.ts` は
`CI` 環境変数を見て `forbidOnly` の有効化と dev サーバ再利用の無効化まで済ませてあるため、
設定側の追加対応は不要な想定です。

---

## テストが落ちたときの見方

1. `npx playwright show-report` でレポートを開く
2. 失敗したテストの trace / スクリーンショット / 動画を確認する
3. 「アプリの不具合」か「seed / 前提の変化」かを切り分ける
   - デモシード（`supabase/seeds/demo/demo.sql`）を変更した場合は `e2e/support/testData.ts` の前提コメントを読み直す
     （どの拠点・年月・係数に依存しているかを書いてあります）
