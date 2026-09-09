<!-- PR タイトルは Conventional Commits 形式で（例: feat: 排出係数マスタ連携を追加） -->

## 概要 / Summary

<!-- 何を・なぜ変更したかを簡潔に -->

## 関連 Issue / Related Issue

<!-- 例: Closes #34 -->
Closes #

## 変更内容 / Changes

-
-

## 動作確認 / How to test

<!-- レビュアーが再現できる手順。スクリーンショットがあれば添付 -->

-

## チェックリスト / Checklist

- [ ] 担当 Issue の範囲だけを変更した（「ついで」の変更を含めていない）
- [ ] `npm run lint` が通る
- [ ] `npm run build` が通る
- [ ] `npm run test` が通る
- [ ] 新しいライブラリを勝手に追加していない（追加が必要な場合は Issue/コメントで提案済み）
- [ ] `SUPABASE_SERVICE_ROLE_KEY` をクライアント側に露出させていない
- [ ] `.env.local` などの秘密情報をコミットしていない
- [ ] 既存の SQL マイグレーションを直接編集・削除していない（新規ファイルで対応した）
- [ ] マイグレーションにデータ（insert / update / delete 等）を入れていない（データは `supabase/seeds/production` または `supabase/seeds/demo` に置き、`npm run check:migrations` が通る）
- [ ] [`AGENTS.md`](../AGENTS.md) のルールに従っている
