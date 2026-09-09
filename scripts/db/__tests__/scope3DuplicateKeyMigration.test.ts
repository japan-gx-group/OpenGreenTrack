// Scope3 重複キーまわりの DB 側挙動に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// ideaImportServer.test.ts の「マイグレーション SQL への回帰テスト」と同じ方針で、
// 単一トランザクションが必要な DB 側の挙動は SQL の文面レベルで担保する
// （実DBでの結合検証は supabase 環境での一括検証時に実施する）。
//
// 検証対象:
//   1. supabase/migrations/20260831000000_schema.sql の
//      prevent_duplicate_activity_record（トリガー関数）とそのトリガー定義:
//      重複キーは「組織×拠点×種別×対象月×カテゴリ×IDEA製品」の 6 列で、
//      参照を外す遷移（ideaFactorId 非null → null）は検査をスキップする。
//      スキップが無いと、IDEAインポート削除（FK on delete set null）と版更新の孤児化
//      UPDATE が同一キー群の2件目で 23505 になり、削除・版更新の
//      トランザクション全体が失敗する。
//   2. supabase/migrations/20260831000002_rpc.sql の complete_idea_import:
//      版更新の一括再マッピング（§3.6-2）のデデュープ。
//      同一キー群の複数明細が異なる版の同一 ideaCode を参照している場合に、
//      全件を新版の同一係数へ寄せて重複トリガーに当たるのではなく、
//      1件だけ付け替えて残りを「再選択が必要な明細」として孤児化する。
//      あわせて EXECUTE 権限が service_role 限定であることも確認する
//      （authenticated が /rpc/ から任意引数で完了処理を叩けてはならない）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260831000000_schema.sql'),
  'utf8',
);
const rpcSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260831000002_rpc.sql'),
  'utf8',
);

const CREATE_FUNCTION = /create (or replace )?function/;

/**
 * SQL 全文から `start` にマッチする位置以降を、次に `end` がマッチする位置の手前まで切り出す。
 * `end` が見つからなければ末尾まで。`start` が見つからない場合はテストを落とす。
 */
const sliceSql = (sql: string, start: RegExp, end: RegExp): string => {
  const startMatch = start.exec(sql);
  if (!startMatch) {
    throw new Error(`SQL に ${start} が見つかりません`);
  }
  const bodyStart = startMatch.index + startMatch[0].length;
  const endMatch = end.exec(sql.slice(bodyStart));
  const to = endMatch ? bodyStart + endMatch.index : sql.length;
  return sql.slice(startMatch.index, to);
};

/** 関数 `fnName(argTypes)` に対する grant / revoke execute のロール一覧（空白・改行に寛容） */
const executePrivileges = (sql: string, fnName: string, argTypes: string) => {
  const args = argTypes
    .split(',')
    .map(type => type.trim())
    .join('\\s*,\\s*');
  const target = `execute\\s+on\\s+function\\s+${fnName}\\s*\\(\\s*${args}\\s*\\)`;
  const roleList = (keyword: 'from' | 'to', verb: 'revoke' | 'grant') =>
    [...sql.matchAll(new RegExp(`${verb}\\s+${target}\\s+${keyword}\\s+([^;]+);`, 'g'))]
      .flatMap(match => match[1].split(','))
      .map(role => role.trim());
  return {
    revokedFrom: roleList('from', 'revoke'),
    grantedTo: roleList('to', 'grant'),
  };
};

describe('prevent_duplicate_activity_record: 重複キー拡張トリガー', () => {
  const triggerFunction = sliceSql(
    schemaSql,
    /create (or replace )?function prevent_duplicate_activity_record\b/,
    /create (or replace )?function|create trigger/,
  );
  const triggerDefinition = sliceSql(
    schemaSql,
    /create trigger prevent_duplicate_activity_record_before_write\b/,
    /;/,
  );

  it('重複判定キーに scope3CategoryId / ideaFactorId を含む（月次×製品の粒度を許容）', () => {
    expect(triggerFunction).toContain(
      'ar."scope3CategoryId" is not distinct from new."scope3CategoryId"',
    );
    expect(triggerFunction).toContain('ar."ideaFactorId" is not distinct from new."ideaFactorId"');
    // 2列の変更でも検査が走るよう、UPDATE の対象列（update of ...）にも含める
    const updateOfColumns = /update of([\s\S]*?)\son\s+activity_records\b/.exec(triggerDefinition);
    expect(updateOfColumns).not.toBeNull();
    expect(updateOfColumns?.[1]).toContain('"scope3CategoryId"');
    expect(updateOfColumns?.[1]).toContain('"ideaFactorId"');
    expect(triggerDefinition).toMatch(/execute function prevent_duplicate_activity_record\(\)/);
  });

  it('参照を外す遷移（ideaFactorId 非null → null）は検査をスキップする', () => {
    // FK の on delete set null / complete_idea_import の孤児化 UPDATE がこのトリガーを
    // 通るため、スキップが無いと IDEA インポートの削除・版更新が失敗する。
    expect(triggerFunction).toMatch(
      /if\s+old\."ideaFactorId"\s+is\s+not\s+null\s+and\s+new\."ideaFactorId"\s+is\s+null\s+then\s+return\s+new;/,
    );
  });
});

describe('complete_idea_import: 版更新再マッピングのデデュープ', () => {
  const completeIdeaImport = sliceSql(
    rpcSql,
    /create (or replace )?function complete_idea_import\b/,
    CREATE_FUNCTION,
  );

  it('EXECUTE は service_role 限定（public / anon / authenticated から剥奪）', () => {
    const { revokedFrom, grantedTo } = executePrivileges(rpcSql, 'complete_idea_import', 'uuid, uuid');
    expect(revokedFrom).toEqual(expect.arrayContaining(['public', 'anon', 'authenticated']));
    expect(grantedTo.length).toBeGreaterThan(0);
    expect([...new Set(grantedTo)]).toEqual(['service_role']);
  });

  it('isActive の切替順（旧 false 化 → 新 true 化）を維持する（§4.1-3 の回帰）', () => {
    const deactivateIndex = completeIdeaImport.indexOf('set "isActive" = false');
    const activateIndex = completeIdeaImport.indexOf('"isActive" = true');
    expect(deactivateIndex).toBeGreaterThan(-1);
    expect(activateIndex).toBeGreaterThan(-1);
    expect(deactivateIndex).toBeLessThan(activateIndex);
  });

  it('再マッピングは重複キー群 × ideaCode ごとに1件だけ行う（not exists デデュープ）', () => {
    // ideaCode 一致の再マッピング（§3.6-2）自体は維持しつつ、
    expect(completeIdeaImport).toMatch(/nf\."ideaCode" = old_f\."ideaCode"/);
    // 同一キー群で同じ ideaCode を参照する明細のうち id 最小の1件だけを付け替える
    expect(completeIdeaImport).toContain('not exists');
    expect(completeIdeaImport).toContain('ar2.id < ar.id');
    expect(completeIdeaImport).toContain(
      'ar2."scope3CategoryId" is not distinct from ar."scope3CategoryId"',
    );
    expect(completeIdeaImport).toMatch(/old_f2\."ideaCode" = old_f\."ideaCode"/);
  });

  it('付け替えできなかった明細は孤児化して unmappedRecordCount に計上する', () => {
    expect(completeIdeaImport).toContain('set "ideaFactorId" = null');
    expect(completeIdeaImport).toContain('"unmappedRecordCount" = v_unmapped');
  });
});
