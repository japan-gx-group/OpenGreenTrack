// SSBJ レポートの基本情報の版数（ssbj_reports."basicInfoRevision"。supabase/migrations/*_ssbj_basic_info_revision.sql）に対する
// 回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 画面は読込時の basicInfoRevision を基本情報の更新の条件に含め、0 件更新なら競合として保存を拒否する
// （src/features/ssbj/services/reportService.ts の updateSsbjReportBasicInfo）。
//
// 固定すること（後のマイグレーションで関数を定義し直したときも、最後の定義で確かめる）:
//   - 基本情報の列が変わったときに、draftRevision と一緒に basicInfoRevision も進める
//     （進めないと、古い画面からの保存が条件に一致して、先に保存された変更を上書きする）
//   - 基本情報の対象の列は draftRevision と basicInfoRevision で同じ（片方だけに列を足すと検知漏れになる）
//   - クライアントは basicInfoRevision を書けない（更新の列 GRANT に含めない）
//   - 操作履歴は basicInfoRevision を内容の変更として記録しない

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const normalize = (sql: string): string =>
  sql.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');

const all = normalize(readdirSync(migrationsDir).sort().map(name => readFileSync(path.join(migrationsDir, name), 'utf8')).join('\n'));

/** 関数ごとの最後の定義（create [or replace] function … as $$ … $$;）。マイグレーションの適用順に後勝ち。 */
const latestFunctions = new Map<string, string>(
  [...all.matchAll(/create (?:or replace )?function (\w+)\(.*?\$\$.*?\$\$;/g)].map(match => [match[1], match[0]]),
);
const latest = (name: string): string => {
  const definition = latestFunctions.get(name);
  if (!definition) throw new Error(`${name} の定義が見つかりません`);
  return definition;
};

describe('基本情報の版数', () => {
  it('列を既定値 0 の必須列として足している（既存の行を update で埋めない）', () => {
    expect(all).toContain('alter table ssbj_reports add column "basicInfoRevision" integer not null default 0;');
  });

  it('基本情報の列が変わったときに、draftRevision と同じ条件で basicInfoRevision も進める', () => {
    const bump = latest('bump_ssbj_reports_own_draft_revision');
    const thenBlock = bump.slice(bump.indexOf(' then '), bump.indexOf('end if;'));
    expect(thenBlock).toContain('new."draftRevision" := old."draftRevision" + 1;');
    expect(thenBlock).toContain('new."basicInfoRevision" := old."basicInfoRevision" + 1;');
  });

  it('クライアントに basicInfoRevision の更新を許可していない', () => {
    const updateGrants = [...all.matchAll(/grant update \(([^)]*)\) on ssbj_reports to authenticated;/g)].map(match => match[1]);
    expect(updateGrants.length).toBeGreaterThan(0);
    for (const columns of updateGrants) {
      expect(columns).not.toContain('basicInfoRevision');
    }
  });

  it('操作履歴は basicInfoRevision を内容の変更として記録しない', () => {
    expect(latest('ssbj_audit_row_change')).toMatch(/v_ignored text\[\] := array\[[^\]]*'basicInfoRevision'/);
  });
});
