-- 排出係数の値の変更履歴（emission_factor_revisions）
--
-- カスタム係数の編集は emission_factors の行を上書きするため、変更前の値が残らない。算定済みの結果は
-- emission_results.appliedFactor* に算定時の値を持つが、「いつ・誰が・どの値からどの値に変えたか」は
-- 追えない。組織の係数の値・単位が変わったときに、変更前後の値と変更者をこのテーブルへ記録する。
-- 記録は DB トリガーで行う（係数管理画面の編集・CSV 取込のどの更新経路でも漏れないようにするため）。
-- 公式係数（organizationId is null）の改訂は seed の再投入で行い、ここには記録しない。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。関数本体 $$…$$ 内の DML は対象外）

-- §1 テーブル

create table emission_factor_revisions (
  id uuid primary key default gen_random_uuid(),
  -- RLS の組織判定用。係数の organizationId をそのまま写す。
  "organizationId" uuid not null references organizations(id) on delete cascade,
  -- 係数を削除しても履歴は残す（監査用）。係数名・種別・年度は変更時点のスナップショットで持つ。
  "emissionFactorId" uuid references emission_factors(id) on delete set null,
  "factorName" varchar(200) not null,
  "energyType" "EnergyType" not null,
  "applicableYear" integer not null,
  "previousFactorValue" numeric(12, 6) not null,
  "previousUnit" varchar(50) not null,
  "newFactorValue" numeric(12, 6) not null,
  "newUnit" varchar(50) not null,
  -- 変更した利用者（auth.uid()）。service_role など利用者を持たない更新では null。
  "changedByUserId" uuid,
  "changedAt" timestamptz not null default now()
);

comment on table emission_factor_revisions is
  '組織の排出係数（カスタム係数）の値・単位の変更履歴。emission_factors の更新時にトリガーで記録する。';

create index "emission_factor_revisions_emissionFactorId_idx"
  on emission_factor_revisions ("emissionFactorId", "changedAt" desc);
create index "emission_factor_revisions_organizationId_idx"
  on emission_factor_revisions ("organizationId");

-- §2 RLS・権限

alter table emission_factor_revisions enable row level security;

create policy "emission_factor_revisions_select_own_organization"
on emission_factor_revisions
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- authenticated は読み取りのみ（書き込みはトリガー関数だけ。履歴を利用者が書き換えられないようにする）。
-- 20260831000001_rls.sql §4.1 で新規テーブルの既定権限は無しのため、SELECT を明示 grant する。
grant select on emission_factor_revisions to authenticated;
grant select, insert, update, delete on emission_factor_revisions to service_role;

-- §3 記録トリガー

-- security definer: 更新した利用者（authenticated）は履歴テーブルへの insert 権限を持たないため、
-- 関数の所有者の権限で書く。search_path = '' + スキーマ修飾で、検索パス経由の関数・テーブルのすり替えを防ぐ。
create function record_emission_factor_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.emission_factor_revisions
    ("organizationId", "emissionFactorId", "factorName", "energyType", "applicableYear",
     "previousFactorValue", "previousUnit", "newFactorValue", "newUnit", "changedByUserId")
  values
    (new."organizationId", new.id, new.name, new."energyType", new."applicableYear",
     old."factorValue", old.unit, new."factorValue", new.unit, auth.uid());
  return new;
end;
$$;

-- update of は SET 句に列があれば値が同じでも発火するため、値が実際に変わったときだけ記録する
-- （編集画面は全列を送るので、名称だけ直した保存で履歴が増えないようにする）。
create trigger record_emission_factor_revision
after update of "factorValue", unit on emission_factors
for each row
when (
  new."organizationId" is not null
  and (old."factorValue" is distinct from new."factorValue" or old.unit is distinct from new.unit)
)
execute function record_emission_factor_revision();

comment on function record_emission_factor_revision() is
  '組織の排出係数の値・単位が変わったとき、変更前後の値と変更者を emission_factor_revisions に記録するトリガー関数。';

-- トリガー関数はトリガー経由でのみ実行させる（直接 /rpc/ から呼ばせない）。トリガーの発火に呼び出し元の EXECUTE 権限は不要。
revoke execute on function record_emission_factor_revision() from public, anon, authenticated;
