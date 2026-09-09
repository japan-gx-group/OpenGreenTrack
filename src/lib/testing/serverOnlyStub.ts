// `import 'server-only'`（src/lib/supabase/admin.ts）をテストで無害化するための空モジュール。
//
// server-only は「Client Component から import されたらビルドを失敗させる」ためだけの目印で、
// 実体の解決は Next のバンドラが行う（npm パッケージとしては入っていない）。vitest は Next の
// 解決を通らないため、そのままだとサーバ専用モジュールを読み込むテストが
// 「Cannot find package 'server-only'」で丸ごと落ちる。
//
// Next 同梱の空実装（next/dist/compiled/server-only/empty.js）に向けることもできるが、
// 公開 API ではない dist の内部パスに依存すると Next の更新で黙って壊れるため、
// リポジトリ内のこのファイルへ向ける（vitest.config.ts の resolve.alias）。
export {};
