-- AI 連携の設定（ai_settings）: 組織で使う提供元とモデル
--
-- AI の提供元と API キーは、サーバの環境変数（AI_PROVIDER / AI_API_KEY）に置く（方式A）。鍵は DB に置かない。
-- ここに持つのは、管理者がプルダウンで選んだモデルだけ（秘密ではない）。1 組織 = 1 行。
-- provider は選んだ時点の提供元。環境変数の提供元を替えたら、選んだモデルは無効として扱う（画面で選び直す）。
--
-- 書き込みは、管理者であることをサーバ（Server Action の requireAdmin）で確かめたうえで service_role から行う。
-- そのため authenticated には自組織の select だけを許し、書き込みのポリシー・GRANT は置かない。
-- 変更は Server Action が system_audit_logs に ai.model.update として残す。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用）

-- §1 テーブル

create table ai_settings (
  "organizationId" uuid primary key references organizations(id) on delete cascade,
  provider varchar(20) not null,
  "modelId" varchar(200) not null,
  "updatedBy" uuid,
  "updatedAt" timestamptz not null default now(),
  constraint ai_settings_provider_check check (provider in ('anthropic', 'google', 'openai'))
);

comment on table ai_settings is
  '組織で使う AI の提供元とモデル（管理者が選ぶ）。API キーは環境変数に置き、ここには持たない。';
comment on column ai_settings.provider is 'モデルを選んだ時点の提供元（anthropic / google / openai）。';
comment on column ai_settings."modelId" is '提供元のモデル ID（Gemini は models/ を外したもの）。';

-- §2 RLS・権限

alter table ai_settings enable row level security;

-- 何に送られるかを誰でも確かめられるよう、自組織のメンバーは全員読める。
create policy "ai_settings_select_own_organization"
on ai_settings
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

grant select on ai_settings to authenticated;
grant select, insert, update, delete on ai_settings to service_role;
