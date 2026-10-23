-- 画面から登録した AI の API キー（ai_credentials）: 方式B（AI_ALLOW_KEY_REGISTRATION=true）のときだけ使う
--
-- 鍵は AES-256-GCM で暗号化して保存する（src/lib/ai/crypto.ts）。暗号化の鍵（AI_ENCRYPTION_KEY）は DB の外（環境変数）に置くので、
-- DB やバックアップだけが漏れても鍵は読めない。追加認証データに組織 ID と提供元を入れるので、暗号文を別の行に移しても復号できない。
-- keyId は暗号化の鍵の指紋（SHA-256 の先頭 16 文字）。暗号化の鍵を替えたら一致しなくなり、画面で登録し直してもらう。
--
-- ブラウザ側（anon・authenticated）からは一切読めないようにする: RLS を有効にしてポリシーを置かず、権限もすべて外す。
-- 読み書きは、管理者であること・本人確認（ログインパスワードの再入力）をサーバで確かめたうえで service_role から行う。
-- 変更は Server Action が system_audit_logs に ai.credential.update / ai.credential.delete として残す。
-- 組織や鍵の行を organizations に持たないのは、organizations がメンバー全員に SELECT できるテーブルで、列単位の権限は漏れやすいため。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用）

-- §1 テーブル

create table ai_credentials (
  "organizationId" uuid primary key references organizations(id) on delete cascade,
  provider varchar(20) not null,
  -- 以下 3 つは base64。iv は 12 バイト（保存のたびに作り直す）、authTag は 16 バイト
  ciphertext text not null,
  iv text not null,
  "authTag" text not null,
  "keyId" varchar(16) not null,
  -- 画面に表示する鍵の末尾 4 文字（鍵全体は表示しない）
  "keyLast4" varchar(4) not null,
  "updatedBy" uuid,
  "updatedAt" timestamptz not null default now(),
  constraint ai_credentials_provider_check check (provider in ('anthropic', 'google', 'openai'))
);

comment on table ai_credentials is
  '画面から登録した AI の API キー（方式B）。AES-256-GCM の暗号文だけを持つ。anon・authenticated からは読めない（service_role 限定）。';
comment on column ai_credentials."keyId" is '暗号化の鍵（AI_ENCRYPTION_KEY）の SHA-256 の先頭 16 文字。暗号化の鍵を替えたことを見分ける。';

-- §2 RLS・権限

alter table ai_credentials enable row level security;

-- ポリシーは置かない。authenticated・anon の権限はすべて外す（列 GRANT も含めて何も与えない）。
revoke all on ai_credentials from anon, authenticated;
grant select, insert, update, delete on ai_credentials to service_role;
