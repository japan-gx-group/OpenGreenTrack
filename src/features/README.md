# src/features/ — 機能（ドメイン）別ディレクトリ

機能ごとにコードを凝集させる場所です。現在は次の 11 ドメインがあります。

| ディレクトリ | 機能 |
|---|---|
| `auth/` | ログイン・初期セットアップ・招待・パスワード再設定 |
| `calculation/` | 排出量の算定エンジン（`engine/`）と算定バッチ（`services/`） |
| `dashboard/` | ダッシュボード |
| `data-input/` | 活動量のデータ入力 |
| `factors/` | 排出係数管理・IDEA データベース取込 |
| `locations/` | 拠点管理・拠点詳細 |
| `notifications/` | ヘッダーのベルに出すお知らせ |
| `reports/` | レポート出力・印刷 |
| `scope-analysis/` | Scope 分析 |
| `settings/` | アカウント設定・企業情報設定・メンバー管理 |
| `targets/` | 削減目標 |

```
src/features/<domain>/
├── components/   # その機能専用のUI（Client Component は <Name>.client.tsx、Server Component は <Name>.tsx）
│   └── __tests__/
├── hooks/        # その機能専用のhook
│   └── __tests__/
├── services/     # データ取得・保存（Supabaseアクセス）
│   └── __tests__/
├── utils/        # （任意）Supabase に触れない純粋なヘルパー
├── engine/       # （calculation のみ）純粋な算定エンジン
└── types.ts      # その機能専用の型
```

サブディレクトリは必要なものだけ持ちます（例: `notifications/` は `services/` のみ）。
単体テストは対象ファイルと同じディレクトリの `__tests__/` に、同じファイル名 + `.test.ts(x)` で置きます（`AGENTS.md` R13）。

詳細は [`AGENTS.md`](../../AGENTS.md) R2/R3 と [`docs/directory-structure.md`](../../docs/directory-structure.md) を参照。
