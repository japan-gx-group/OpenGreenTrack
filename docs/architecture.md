# アーキテクチャ概要（Next.js + Supabase）

GreenTrack は **Next.js（App Router）+ Supabase** で構成します。
自前のAPIサーバやORMは持たず、バックエンド機能はすべて Supabase に寄せます。

```
┌─────────────────────────── ブラウザ ───────────────────────────┐
│  Client Components（'use client'）                              │
│  ・フォーム入力、グラフ描画(recharts)、モーダル等の対話UI       │
│  ・supabase-js（anon key）で自分の組織のデータのみ読み書き      │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌─────────────────────── Next.js サーバ ─────────────────────────┐
│  Server Components / Server Actions / Route Handlers            │
│  ・初期データの取得・集計、PDF/CSV生成などの重い処理            │
│  ・原則 anon key + ユーザーのセッションで実行（RLSが効く）      │
│  ・service_role key は「RLSを意図的に越える必要がある処理」のみ │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌────────────────────────── Supabase ────────────────────────────┐
│  Postgres   … 全データ（組織・拠点・活動量・係数・算定結果…）  │
│  Auth       … ログイン認証・セッション管理                      │
│  RLS        … 「自分の組織のデータしか見えない」をDB層で強制    │
│  Edge Functions / RPC … 排出量算定バッチ等（必要になったら）    │
└────────────────────────────────────────────────────────────────┘
```

## どこがサーバで、どこがクライアントか

| 処理 | 置き場所 | 理由 |
|---|---|---|
| ページの初期表示・一覧データ取得 | Server Component | 高速な初期表示。キーがブラウザに漏れない |
| フォーム・モーダル・並べ替えなどの対話 | Client Component（`'use client'`） | `useState` / イベントハンドラが必要 |
| グラフ描画（recharts） | Client Component | rechartsはブラウザ描画前提のライブラリ |
| データの書き込み（登録・更新） | Server Action もしくは Client からsupabase-js | どちらでもRLSで保護される |
| IDEA データベース取込・PDF生成 | Route Handler / Server Action | 重い処理・Node APIが必要 |

**原則: デフォルトはServer Component。ブラウザ機能が必要な部分だけ `'use client'` の子コンポーネントに切り出す。**

## Supabase の責務

- **Database（Postgres）**: スキーマは `supabase/migrations/*.sql` で管理する（**DDL のみ**。v1.0 初期スキーマは `schema` / `rls` / `rpc` / `storage` の 4 ファイルで、データは一切置かない — `AGENTS.md` R12。唯一の例外が `storage` の `storage.buckets` への `insert`（バケットはインフラ設定のため））。データは `supabase/seeds/` で管理する（`production/` = 本番でも投入する公式排出係数マスタ、`demo/` = デモ・テスト用データ）。テーブル設計の説明は `docs/database-design.md` を参照
- **Auth**: メール+パスワード等でログイン。ユーザーは必ずいずれかの組織（organization）に属する
- **RLS（Row Level Security）**: すべてのテーブルで有効化する
- **Storage**: 現在アプリからの読み書き経路は無い（ファイル取込機能は削除済み。IDEA データベースの Excel はサーバ側で解析するだけで保存しない）。取込を再導入するときの受け皿として、バケット 2 つ（`import-files` / `upload-quarantine`）と `storage.objects` の組織分離ポリシーの定義だけを `20260831000003_storage.sql` に残している

## RLS の考え方（マルチテナントの肝）

GreenTrack は複数企業（organization）が同居するマルチテナント型です。
「A社のユーザーにはA社のデータしか見えない」を、アプリのコードではなく **DBのRLSポリシーで強制** します。

- ほぼ全テーブルが `organization_id` 列を持つ
- ポリシー例（イメージ）: `organization_id = (ログイン中ユーザーの所属組織id)` の行のみ SELECT/INSERT/UPDATE/DELETE を許可
- こうしておくと、フロントのコードにバグがあっても他社のデータは**DBが返さない**

## 環境変数

| 変数 | 公開範囲 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ブラウザに公開される | SupabaseプロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ブラウザに公開される | 匿名キー。**RLS前提で公開してよい**キー |
| `SUPABASE_SERVICE_ROLE_KEY` | **サーバのみ。絶対に公開しない** | RLSをバイパスする管理者キー。バッチ等の限定用途 |
| `LOG_LEVEL` | サーバのみ | Pino ロガーの最小ログレベル (`info`, `debug`, `error` など。デフォルト: `info`) |

`.env.example` をコピーして `.env.local` を作成する（`.env.local` はコミット禁止）。

## ロギングと監視（Pino + Request Tracing）

GreenTrack ではセルフホスト・単一テナント運用を前提とし、外部 SaaS に依存しない運用ログ出力基盤を備えています。

1. **サーバ側ログ (`src/lib/logging/logger.ts`)**:
   - Pino を採用し、本番環境 (`NODE_ENV=production`) では `stdout` へ標準的な NDJSON（1行1 JSON）を出力します。
   - ホスト側のログ収集基盤（Datadog Agent, CloudWatch, Loki 等）でそのまま収集・パース可能です。
   - `password`, `token`, `authorization`, `apiKey`, `secret`, `cookie` は自動的に `[REDACTED]` にマスクされます（トップレベルと1階層下）。
   - 例外は `error` キーに渡します（`logger.error({ error }, 'メッセージ')`）。pino 標準の err シリアライザを `error` キーに適用しているため、`message` と `stack` がそのまま JSON に載ります。**素の `JSON.stringify` では Error は `{}` になり中身が消えるため、この設定は外さないこと**（`src/lib/logging/__tests__/logger.test.ts` で担保）。
   - 開発環境では `pino-pretty` を使用し、色付きで人間が読みやすい形式に自動変換します。

2. **リクエストコンテキスト追跡 (`src/lib/logging/requestLogger.ts`)**:
   - `src/proxy.ts` (ミドルウェア) が全リクエストに対し `x-request-id` ヘッダーを自動付与・保持します。
   - API Route や Server Action で `await getRequestLogger()` を呼び出すことで、`requestId`, `organizationId`, `userId` が全ログ行に共通バインドされます。

3. **ブラウザ側ログ (`src/lib/logging/clientLogger.ts`)**:
   - Client Component 用の構造化ログ出力。`[GreenTrack]` プレフィックス付きでブラウザ DevTools コンソールへ出力されます。

4. **ヘルスチェックエンドポイント (`/api/health`)**:
   - `GET /api/health` で Supabase データベース接続とアプリケーションの正常性を返します (`200 OK` / `503 Service Unavailable`)。デプロイ時の readiness probe や死活監視に利用できます。
   - 未認証で叩ける唯一の API です（`src/proxy.ts` の matcher から除外）。監視ツールはログイン不要でアクセスできます。
   - 接続確認は `service_role` クライアントで行います。RLS ポリシーがすべて `to authenticated` のため、anon では DB が正常でも `permission denied` になり疎通を判定できないためです。レスポンスは `ok` / `error` の2値のみで、DB のエラー詳細やデータは一切返さずサーバーログにのみ残します。


## Supabaseクライアントの使い分け（`src/lib/supabase/`）

| ファイル | 使う場所 |
|---|---|
| `client.ts` | Client Component（ブラウザ） |
| `server.ts` | Server Component / Server Action / Route Handler |
| `admin.ts` | サーバ専用。`SUPABASE_SERVICE_ROLE_KEY` を使う RLS バイパスクライアント（招待発行などの限定用途のみ） |

`client.ts` / `server.ts` は anon key を使い、ユーザーのセッション（Cookie）を通じてRLSが適用されます。
`admin.ts` は RLS を通らないため、呼び出し前に必ず権限チェックを行うこと（クライアントからは絶対に import しない）。
