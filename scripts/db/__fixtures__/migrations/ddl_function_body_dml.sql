-- 検査フィクスチャ（検出されない）: 関数本体（$$ … $$）内の insert / update / upsert は関数の
-- 呼び出し時に実行されるもので、migration 適用時には実行されないため対象外。前後の alter table /
-- revoke / grant は DDL。
-- 期待する検出: なし
alter table results
  add constraint results_record_unique unique ("recordId");

create or replace function commit_results(p_batch_id uuid, p_owner_id uuid, p_results jsonb)
returns void
language plpgsql
as $$
declare
  v_total numeric(15, 3);
begin
  insert into results ("recordId", "batchId", amount)
  select (r->>'recordId')::uuid, p_batch_id, (r->>'amount')::numeric
  from jsonb_array_elements(p_results) as r;

  update records set "isDone" = true
  where id in (select (r->>'recordId')::uuid from jsonb_array_elements(p_results) as r);

  select coalesce(sum(amount), 0) into v_total
  from results where "batchId" = p_batch_id;

  insert into totals ("ownerId", total)
  values (p_owner_id, v_total)
  on conflict ("ownerId") do update set total = excluded.total, "updatedAt" = now();

  update batches set status = 'completed', "completedAt" = now() where id = p_batch_id;
end;
$$;

revoke all on function commit_results(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function commit_results(uuid, uuid, jsonb) to service_role;
