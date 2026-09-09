// scripts/db/check-migrations.ts の単体テスト（AGENTS.md R12「マイグレーションにデータを入れない」の機械チェック）。
//
// 純粋関数 findViolations だけを対象にし、DB や Supabase CLI には触れない。
// 末尾の統合テストは、migration に現れうるパターンを 1 ファイルずつ小さく再現した合成フィクスチャ
// （__fixtures__/migrations/）に対して、検出／非検出の境界が崩れていないことを確認する。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TABLE_KEYWORDS,
  DEFAULT_ALLOWED_TABLES,
  findViolations,
  formatViolation,
} from '../check-migrations.ts';

const reasonsOf = (sql: string): string[] => findViolations(sql).map((v) => v.reason);

describe('findViolations: トップレベルの DML', () => {
  it('素の insert 文を違反にする', () => {
    const violations = findViolations("insert into emission_factors (id) values ('x');");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 1, reason: 'insert 文（DML）' });
    expect(violations[0].statement).toBe("insert into emission_factors (id) values ('x')");
  });

  it('大文字の INSERT と、改行をはさんだ insert / into も違反にする', () => {
    expect(reasonsOf("INSERT INTO t (id) VALUES ('x');")).toEqual(['insert 文（DML）']);
    expect(reasonsOf("insert\ninto t (id)\nvalues ('x');")).toEqual(['insert 文（DML）']);
  });

  it('update / delete / truncate / copy / merge を違反にする', () => {
    expect(reasonsOf('update t set a = 1 where b = 2;')).toEqual(['update 文（DML）']);
    expect(reasonsOf('delete from t where b = 2;')).toEqual(['delete 文（DML）']);
    expect(reasonsOf('truncate table t;')).toEqual(['truncate 文（DML）']);
    expect(reasonsOf('copy t (a, b) from stdin;')).toEqual(['copy 文（DML）']);
    expect(
      reasonsOf('merge into t using s on t.id = s.id when matched then update set a = s.a;'),
    ).toEqual(['merge 文（DML）']);
  });

  it('on conflict … do update（upsert）も insert 文として違反にする', () => {
    const sql = `
insert into emission_factors (id, name)
values ('fa000000-0000-0000-0000-000000000010', '物流委託')
on conflict (id) do update set name = excluded.name;
`;
    expect(reasonsOf(sql)).toEqual(['insert 文（DML）']);
  });

  it('create temporary table … as select を違反にし、通常の create table は許容する', () => {
    expect(
      reasonsOf('create temporary table _tmp on commit drop as select * from t;'),
    ).toEqual(['create temporary table（一時テーブルへのデータ退避）']);
    expect(reasonsOf('create temp table _tmp as select 1;')).toEqual([
      'create temporary table（一時テーブルへのデータ退避）',
    ]);
    expect(reasonsOf('create table t (id uuid primary key);')).toEqual([]);
  });

  it('with … as (…) insert / update（CTE 経由の DML）を違反にし、with … select は許容する', () => {
    expect(
      reasonsOf('with src as (select id from a) insert into t (id) select id from src;'),
    ).toEqual(['with … insert 文（CTE 経由の DML）']);
    expect(
      reasonsOf('with src as (select id from a) update t set x = 1 from src where t.id = src.id;'),
    ).toEqual(['with … update 文（CTE 経由の DML）']);
    expect(reasonsOf('with src as (select id from a) select count(*) from src;')).toEqual([]);
    // CTE 本体が DML（データ変更 CTE）の場合も主文が select であっても違反
    expect(
      reasonsOf('with moved as (delete from a returning *) select count(*) from moved;'),
    ).toEqual(['with 句（CTE 本体）の delete 文（DML）']);
  });

  it('DDL だけのファイルは違反なし', () => {
    const ddl = `
create extension if not exists "pgcrypto";
create type energy_type as enum ('electricity', 'gas');
create table t (
  id uuid primary key default gen_random_uuid(),
  "createdAt" timestamptz not null default now()
);
alter table t enable row level security;
create policy "t_insert_own" on t for insert to authenticated with check (true);
create policy "t_update_own" on t for update to authenticated using (true);
create policy "t_delete_own" on t for delete to authenticated using (true);
grant select, insert, update, delete on t to authenticated;
revoke insert (name) on t from authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
create index t_created_idx on t ("createdAt");
alter table t alter column id set default gen_random_uuid();
alter table t add constraint t_fk foreign key (id) references u (id) on delete cascade on update cascade;
comment on table t is 'テーブル';
create trigger set_t_updated_at before update on t for each row execute function set_updated_at();
`;
    expect(findViolations(ddl)).toEqual([]);
  });
});

describe('findViolations: 関数本体と do ブロック', () => {
  const functionWithDml = `
create or replace function run_commit(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into emission_results (id) values (p_id);
  update calculation_batches set status = 'done' where id = p_id;
  delete from tmp where id = p_id;
end;
$$;
`;

  it('create function の $$ 本体内の DML は対象外（RPC・トリガー関数は正当に DML を含む）', () => {
    expect(findViolations(functionWithDml)).toEqual([]);
  });

  it('$body$ のようなタグ付きドル引用の関数本体も対象外', () => {
    const sql = `
create function set_updated_at() returns trigger as $body$
begin
  update t set x = 1;
  new."updatedAt" = now();
  return new;
end;
$body$ language plpgsql;
`;
    expect(findViolations(sql)).toEqual([]);
  });

  it('create procedure の本体も対象外', () => {
    expect(
      findViolations('create procedure p() language sql as $$ insert into t values (1); $$;'),
    ).toEqual([]);
  });

  it('do $$ … insert … $$ は違反（行番号は do ではなく insert の行）', () => {
    const sql = `
do $$
begin
  insert into profiles (id, role) values (gen_random_uuid(), 'admin');
end $$;
`;
    const violations = findViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 4, reason: 'do ブロック内の insert 文（DML）' });
    expect(violations[0].statement).toBe(
      "insert into profiles (id, role) values (gen_random_uuid(), 'admin')",
    );
  });

  it('do language plpgsql $$ … $$ の形でも違反', () => {
    const sql =
      "do language plpgsql $$\nbegin\n  update profiles set role = 'logger' where role = 'member';\nend;\n$$;";
    expect(reasonsOf(sql)).toEqual(['do ブロック内の update 文（DML）']);
  });

  it('if … then / else / loop の分岐内の DML も違反', () => {
    const sql = `
do $$
declare
  r record;
begin
  if exists (select 1 from t) then
    delete from t where x = 1;
  else
    insert into t (x) values (1);
  end if;
  for r in select id from t loop
    update t set y = 2 where id = r.id;
  end loop;
end $$;
`;
    expect(reasonsOf(sql)).toEqual([
      'do ブロック内の delete 文（DML）',
      'do ブロック内の insert 文（DML）',
      'do ブロック内の update 文（DML）',
    ]);
  });

  it('DML を含まない do ブロック（存在チェック・動的 DDL）は違反なし', () => {
    const sql = `
do $$
declare
  tbl text;
  remaining int;
begin
  select count(*) into remaining from pg_policies where schemaname = 'public';
  if remaining > 0 then
    raise exception 'ロール限定ポリシーが % 件残っています', remaining;
  end if;
  foreach tbl in array array['a', 'b'] loop
    execute format('drop policy if exists %I on %I', tbl || '_select', tbl);
    execute format(
      'create policy %I on %I for insert to authenticated with check (true)',
      tbl || '_insert', tbl
    );
  end loop;
end $$;
`;
    expect(findViolations(sql)).toEqual([]);
  });

  it('文字列で組み立てる動的 SQL（execute format(…)）は検出しない（既知の限界）', () => {
    const sql = "do $$\nbegin\n  execute format('update public.%I set x = 1', 't');\nend $$;";
    expect(findViolations(sql)).toEqual([]);
  });

  it('関数本体の後ろに続くトップレベルの DML は検出する', () => {
    const sql = `${functionWithDml}\nupdate emission_factors set source = 'moe' where id = 'x';\n`;
    const violations = findViolations(sql);
    expect(violations.map((v) => v.reason)).toEqual(['update 文（DML）']);
    expect(violations[0].line).toBe(functionWithDml.split('\n').length + 1);
  });

  it('do ブロック内のドル引用文字列は（最初の文に現れても）本体ではなく文字列として扱う', () => {
    expect(
      findViolations('do $$ begin raise notice $q$insert into t values (1)$q$; end $$;'),
    ).toEqual([]);
    expect(
      reasonsOf('do $$ begin raise notice $q$x$q$; insert into t values (1); end $$;'),
    ).toEqual(['do ブロック内の insert 文（DML）']);
  });
});

describe('findViolations: explain / prepare / execute とデータを伴うテーブル作成', () => {
  it('explain analyze <DML> は文を実際に実行するので違反（explain <select> は許容）', () => {
    expect(reasonsOf('explain analyze insert into t values (1);')).toEqual([
      'explain 経由の insert 文（DML）',
    ]);
    expect(reasonsOf('EXPLAIN (ANALYZE, COSTS OFF) insert into t values (1);')).toEqual([
      'explain 経由の insert 文（DML）',
    ]);
    expect(reasonsOf('explain analyze verbose update t set a = 1;')).toEqual([
      'explain 経由の update 文（DML）',
    ]);
    expect(findViolations('explain analyze select * from t;')).toEqual([]);
    // storage.buckets の例外は explain 経由でも同じ
    expect(
      findViolations("explain analyze insert into storage.buckets (id, name) values ('a', 'a');"),
    ).toEqual([]);
  });

  it('prepare … as <DML> と、それを実行するトップレベルの execute は違反', () => {
    expect(reasonsOf('prepare p as insert into t values (1);\nexecute p;')).toEqual([
      'prepare 経由の insert 文（DML）',
      'execute 文（プリペアド文の実行）',
    ]);
    expect(reasonsOf('prepare q (int) as update t set a = $1;')).toEqual([
      'prepare 経由の update 文（DML）',
    ]);
    expect(findViolations('prepare r as select 1;')).toEqual([]);
  });

  it('create table … as <query> / select … into 新テーブル（データを伴うテーブル作成）は違反', () => {
    const ctas = 'create table … as（データを伴うテーブル作成）';
    expect(reasonsOf('create table t2 as select * from t;')).toEqual([ctas]);
    expect(reasonsOf('create table foo_backup as\nselect * from foo;')).toEqual([ctas]);
    expect(reasonsOf('create unlogged table t2 as select * from t with data;')).toEqual([ctas]);
    expect(
      reasonsOf(
        'create table if not exists public.t_backup (a, b) with (fillfactor = 70) as select a, b from t;',
      ),
    ).toEqual([ctas]);
    expect(reasonsOf('select * into t2 from t;')).toEqual([
      'select … into（データを伴うテーブル作成）',
    ]);
  });

  it('通常の create table（generated always as (…) stored や with (…) 付きを含む）は許容する', () => {
    expect(findViolations('create table t (c int generated always as (1) stored);')).toEqual([]);
    expect(
      findViolations('create table t (id uuid primary key) with (autovacuum_enabled = false);'),
    ).toEqual([]);
    expect(findViolations('create table t (id int) tablespace assets;')).toEqual([]);
  });

  it('do ブロック内の select … into 変数 と execute（動的 SQL）は plpgsql の構文なので対象外', () => {
    const sql = "do $$\ndeclare n int;\nbegin\n  select count(*) into n from t;\n  execute 'select 1';\nend $$;";
    expect(findViolations(sql)).toEqual([]);
  });
});

describe('findViolations: storage.buckets の例外（定義 = insert と設定変更 = update だけ）', () => {
  it('storage.buckets への insert / update は許容する', () => {
    const sql = `
insert into storage.buckets (id, name, public, file_size_limit)
values ('import-files', 'import-files', false, 52428800)
on conflict (id) do nothing;

update storage.buckets
set allowed_mime_types = array['text/csv', 'application/pdf', 'image/png', 'image/jpeg']
where id = 'import-files';
`;
    expect(findViolations(sql)).toEqual([]);
  });

  it('大文字・引用符付きの storage.buckets も同じテーブルとして許容する', () => {
    expect(findViolations("INSERT INTO STORAGE.BUCKETS (id, name) VALUES ('a', 'a');")).toEqual([]);
    expect(findViolations(`insert into "storage"."buckets" (id, name) values ('a', 'a');`)).toEqual(
      [],
    );
  });

  it('storage.objects への update は違反', () => {
    expect(
      reasonsOf("update storage.objects set name = 'x' where bucket_id = 'import-files';"),
    ).toEqual(['update 文（DML）']);
  });

  it('storage.buckets でも delete / truncate / merge / copy は違反（例外は insert / update のみ）', () => {
    expect(reasonsOf("delete from storage.buckets where id = 'import-files';")).toEqual([
      'delete 文（DML）',
    ]);
    expect(reasonsOf('truncate storage.buckets;')).toEqual(['truncate 文（DML）']);
    expect(reasonsOf('truncate table storage.buckets;')).toEqual(['truncate 文（DML）']);
    expect(
      reasonsOf(
        'merge into storage.buckets b using (select 1) s on b.id = s.id when matched then update set name = b.id;',
      ),
    ).toEqual(['merge 文（DML）']);
    expect(reasonsOf('copy storage.buckets (id, name) from stdin;')).toEqual(['copy 文（DML）']);
    // do ブロック・CTE 経由でも同じ
    expect(reasonsOf("do $$ begin delete from storage.buckets where id = 'x'; end $$;")).toEqual([
      'do ブロック内の delete 文（DML）',
    ]);
    expect(
      reasonsOf("with gone as (delete from storage.buckets where id = 'x' returning id) select 1 from gone;"),
    ).toEqual(['with 句（CTE 本体）の delete 文（DML）']);
    // 一方、CTE 経由・do ブロック内の insert / update は許容される
    expect(
      findViolations(
        "with cfg as (select 'import-files'::text as id) update storage.buckets set public = false from cfg where storage.buckets.id = cfg.id;",
      ),
    ).toEqual([]);
    expect(
      findViolations("do $$ begin update storage.buckets set public = false where id = 'x'; end $$;"),
    ).toEqual([]);
    expect([...ALLOWED_TABLE_KEYWORDS].sort()).toEqual(['insert', 'update']);
  });

  it('allowedTables で許容テーブルを差し替えられる', () => {
    const sql = "insert into public.feature_flags (key) values ('x');";
    expect(findViolations(sql)).toHaveLength(1);
    expect(findViolations(sql, { allowedTables: ['public.feature_flags'] })).toEqual([]);
    // 既定の例外を外せば storage.buckets も違反になる
    expect(
      findViolations("insert into storage.buckets (id) values ('a');", { allowedTables: [] }),
    ).toHaveLength(1);
    expect(DEFAULT_ALLOWED_TABLES).toEqual(['storage.buckets']);
  });
});

describe('findViolations: コメントと文字列リテラル', () => {
  it('行コメント・ブロックコメント（入れ子含む）内の insert into は無視する', () => {
    const sql = `
-- insert into t values (1);
/* update t set x = 1;
   /* 入れ子コメント delete from t; */
*/
create table t (id int); -- truncate t;
`;
    expect(findViolations(sql)).toEqual([]);
  });

  it('文字列リテラル内の insert into や ; は無視する', () => {
    const sql = `
comment on table t is 'insert into は禁止; update も禁止';
create policy p on t for select using (name <> 'it''s; delete from t');
select E'insert into\\'; truncate t';
`;
    expect(findViolations(sql)).toEqual([]);
  });

  it('ダブルクォート識別子はキーワード扱いしない', () => {
    expect(findViolations('alter table t add column "insert" boolean;')).toEqual([]);
    expect(reasonsOf('update "T" set "insert" = true;')).toEqual(['update 文（DML）']);
  });

  it('ダブルクォート識別子内の ; は文の区切りにしない', () => {
    expect(findViolations('create table "a;insert into t" (id int);')).toEqual([]);
  });
});

describe('findViolations: 行番号と複数文', () => {
  it('複数行にまたがる文は、直前のコメントを除いた文の先頭行を返す', () => {
    const sql = [
      '-- 1 行目: ヘッダコメント',
      '-- 2 行目',
      'create table t (id int);',
      '',
      '-- 5 行目: 移行コメント',
      'insert into t (id)',
      'select id',
      'from legacy',
      'where id is not null;',
    ].join('\n');
    const violations = findViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(6);
    expect(violations[0].statement).toBe(
      'insert into t (id)\nselect id\nfrom legacy\nwhere id is not null',
    );
  });

  it('1 ファイル内の複数の違反を出現順に返す', () => {
    const sql = [
      'alter table reduction_targets drop column "yearMonth";',
      'create temporary table _tmp on commit drop as',
      'select * from reduction_targets;',
      'delete from reduction_targets;',
      'do $$ begin update t set a = 1; end $$;',
      'insert into reduction_targets select * from _tmp;',
    ].join('\n');
    expect(findViolations(sql).map((v) => [v.line, v.reason])).toEqual([
      [2, 'create temporary table（一時テーブルへのデータ退避）'],
      [4, 'delete 文（DML）'],
      [5, 'do ブロック内の update 文（DML）'],
      [6, 'insert 文（DML）'],
    ]);
  });

  it('空文字や空白・空文だけなら違反なし', () => {
    expect(findViolations('')).toEqual([]);
    expect(findViolations('\n\n  ;; \n')).toEqual([]);
  });
});

describe('formatViolation', () => {
  it('「ファイル:行: 先頭 80 文字  (理由)」の 1 行にまとめる（改行は空白に潰す）', () => {
    const [violation] = findViolations('insert into t (id)\nvalues (1);');
    expect(formatViolation('supabase/migrations/x.sql', violation)).toBe(
      'supabase/migrations/x.sql:1: insert into t (id) values (1)  (insert 文（DML）)',
    );
  });

  it('長い文は先頭 80 文字で切る', () => {
    const [violation] = findViolations(`insert into t (id) values ('${'x'.repeat(200)}');`);
    expect(formatViolation('f.sql', violation)).toBe(
      `f.sql:1: ${violation.statement.slice(0, 80)}  (insert 文（DML）)`,
    );
  });
});

// ---------------------------------------------------------------------------
// 統合テスト: migration に現れうるパターンを 1 ファイルずつ小さく再現した合成フィクスチャ
// （__fixtures__/migrations/。汎用のテーブル名で書いた検査専用の SQL。各ファイル先頭のコメントに
// 何を再現しているかと期待する検出を書いてある）に対する検出結果。
// 単文のテストでは見えない「1 ファイルの中で関数本体・do ブロック・コメント・文字列・DDL が
// 入り混じったときの境界」が崩れていないことを確認する。
// ---------------------------------------------------------------------------
const FIXTURE_DIR = fileURLToPath(new URL('../__fixtures__/migrations/', import.meta.url));

// データを含む（R12 違反として seeds/ へ移すべき）フィクスチャと、期待する検出理由（出現順）
const MUST_FLAG: Record<string, string[]> = {
  // マスタデータの insert … on conflict do update（本番でも投入するマスタは seeds/production/ へ）
  'dml_master_seed_insert.sql': ['insert 文（DML）'],
  // seed 行の update（データ訂正は seed を直して再投入する。migration で update しない）
  'dml_seed_row_update.sql': ['update 文（DML）'],
  // 列構造の変更に伴うデータ移行: create temporary table … as select + delete + insert … select
  'dml_temp_table_backfill.sql': [
    'create temporary table（一時テーブルへのデータ退避）',
    'delete 文（DML）',
    'insert 文（DML）',
  ],
  // check 制約の差し替えに伴う既存行の update ×2。do ブロックは execute format(… create policy …) だけなので検出されない
  'dml_update_and_do_block.sql': ['update 文（DML）', 'update 文（DML）'],
  // 共通行から所有者別コピーを作る移行: create temporary table … as select ×2 + insert … select。
  // do ブロック内の execute format('update …') は既知の限界（動的 SQL）で検出されない
  'dml_temp_table_copy.sql': [
    'create temporary table（一時テーブルへのデータ退避）',
    'create temporary table（一時テーブルへのデータ退避）',
    'insert 文（DML）',
  ],
};

// DDL のみ、または許容される例外だけのフィクスチャ
const MUST_NOT_FLAG = [
  'ddl_function_body_dml.sql', // 関数本体内の insert / update / upsert（対象外）+ alter table / grant
  'ddl_function_body_cte_update.sql', // 関数本体内の with … update / perform（対象外）
  'ddl_storage_buckets_insert.sql', // storage.buckets の insert（バケット定義。許容例外）+ storage.objects のポリシー
  'ddl_storage_buckets_insert_update.sql', // storage.buckets の insert + update（定義と設定変更。許容例外）+ create table / drop policy
  'ddl_do_block_check_only.sql', // DML を含まない do ブロック（存在チェック + raise exception のみ）+ create unique index
];

describe('合成フィクスチャ（__fixtures__/migrations）に対する統合チェック', () => {
  const files = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const reasonsIn = (name: string): string[] =>
    reasonsOf(readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));

  it('フィクスチャはすべて MUST_FLAG / MUST_NOT_FLAG のどちらかに登録されている', () => {
    expect(files).toEqual([...Object.keys(MUST_FLAG), ...MUST_NOT_FLAG].sort());
  });

  it.each(Object.entries(MUST_FLAG))('%s: データを含む文だけを検出する', (name, expected) => {
    expect(reasonsIn(name)).toEqual(expected);
  });

  it.each(MUST_NOT_FLAG)('%s: DDL のみ（または許容される例外だけ）なので検出しない', (name) => {
    expect(reasonsIn(name)).toEqual([]);
  });
});
