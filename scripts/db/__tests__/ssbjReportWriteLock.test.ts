// SSBJ レポートの承認と保存の排他（supabase/migrations/*_ssbj_report_write_lock.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 承認と保存を実際に重ねたときの動き（承認が先なら保存は P2051、保存が先なら承認は P2033、デッドロックしないこと）は
// ローカル DB で 2 つの接続を使って確かめ、ここでは取り違えると穴になる文面を固定する。
//
// 固定すること（後のマイグレーションで関数を定義し直したときも、最後の定義で確かめる）:
//   - 承認ロックのトリガーは、レポートの行をロックしてから状態を読む（ロックせずに読むと、承認の処理中に始まった保存が通る）
//   - 作業中データの行を書き換える RPC は、最初に lock_ssbj_report_working_rows を呼ぶ
//     （利用者の保存と同じ「作業中データの行 → レポートの行」の順にそろえ、デッドロックを避ける）

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

/** 承認ロックのトリガーを付けた（= SSBJ の作業中データの）テーブル。 */
const workingTables = [...all.matchAll(
  /create trigger \w+ before insert or update or delete on (ssbj_\w+) for each row execute function reject_ssbj_change_when_approved\(\);/g,
)].map(match => match[1]);

const LOCK_CALL = 'perform lock_ssbj_report_working_rows(p_report_id);';

describe('承認と保存の排他', () => {
  it('承認ロックのトリガーは、レポートの行をロックしてから状態を読む', () => {
    // for no key update は、版数の繰り上げ（bump_ssbj_draft_revision）の update と同じ強さ。
    // for share にすると、同じレポートを同時に保存した 2 人がデッドロックになる。
    expect(latest('reject_ssbj_change_when_approved')).toContain(
      'select r.status into v_status from public.ssbj_reports r where r.id = v_report_id for no key update;',
    );
  });

  it('状態の変更は、レポートの行をロックしてから版数を比べる（保存が先なら競合で止まる）', () => {
    const status = latest('change_ssbj_report_status');
    const lock = status.indexOf('select * into v_report from ssbj_reports where id = p_report_id for update;');
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(status.indexOf('if v_report."draftRevision" <> p_expected_draft_revision then'));
  });
});

describe('ロックを取る順番（作業中データの行 → レポートの行）', () => {
  it('作業中データのテーブルを見つけられている（前提の確認）', () => {
    expect(workingTables).toEqual(expect.arrayContaining([
      'ssbj_risks_opportunities', 'ssbj_report_time_horizons', 'ssbj_evidence', 'ssbj_ogt_adoptions',
      'ssbj_narratives', 'ssbj_judgements',
    ]));
  });

  it('lock_ssbj_report_working_rows は、承認ロックのトリガーを付けたテーブルの行を名前順・主キー順にロックしてから、レポートの行をロックする', () => {
    const lock = latest('lock_ssbj_report_working_rows');
    expect(lock).toContain("t.tgfoid = 'public.reject_ssbj_change_when_approved()'::regprocedure");
    expect(lock).toContain('order by c.relname');
    expect(lock).toContain('where "reportId" = $1 order by %s for update');
    expect(lock.indexOf('where "reportId" = $1 order by %s for update'))
      .toBeLessThan(lock.indexOf('perform 1 from ssbj_reports where id = p_report_id for update;'));
  });

  it('lock_ssbj_report_working_rows は service_role 限定', () => {
    expect(all).toContain('revoke execute on function lock_ssbj_report_working_rows(uuid) from public, anon, authenticated;');
    expect(all).toContain('grant execute on function lock_ssbj_report_working_rows(uuid) to service_role;');
  });

  it('版の復元は、レポートの行をロックする前に作業中データの行をロックする', () => {
    const restore = latest('restore_ssbj_report_version');
    expect(restore.indexOf(LOCK_CALL)).toBeGreaterThan(0);
    expect(restore.indexOf(LOCK_CALL))
      .toBeLessThan(restore.indexOf('select * into v_report from ssbj_reports where id = p_report_id for update;'));
  });

  it('作業中データのテーブルに書き込む RPC は、書き込む前に作業中データの行をロックする', () => {
    // 復元のセクションごとの関数（ssbj_restore_section__*）は restore_ssbj_report_version の中からだけ呼ばれる（service_role 限定）。
    const writers = [...latestFunctions.entries()].filter(([name, body]) =>
      !name.startsWith('ssbj_restore_section__')
      && workingTables.some(table => new RegExp(`(insert into|delete from|update) ${table}\\b`).test(body)));
    expect(writers.map(([name]) => name)).toContain('adopt_ssbj_ogt_values');
    for (const [name, body] of writers) {
      const write = body.search(new RegExp(`(insert into|delete from|update) (${workingTables.join('|')})\\b`));
      expect(body.indexOf(LOCK_CALL), name).toBeGreaterThan(0);
      expect(body.indexOf(LOCK_CALL), name).toBeLessThan(write);
    }
  });
});
