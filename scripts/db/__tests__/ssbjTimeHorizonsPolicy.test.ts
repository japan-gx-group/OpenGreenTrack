// SSBJ リスクの種類（ssbj_risks_opportunities の追加列）と時間軸の定義（ssbj_report_time_horizons）の
// 制約・RLS・権限・保存版連携に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - リスクの種類は物理的 / 移行の 2 値で、機会は持たない（気候関連開示基準 第19項(2)）
//   - 既存行を書き換えない（R12）: 追加列は状態＋値の対で、既定は未入力
//   - 時間軸の定義は組織分離され（§10 の手順1）、作業中データの変更で draftRevision を進める（手順2）
//   - 保存版セクション関数は service_role 限定で、共通関数は版生成 RPC に自動収集されない名前である

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_risk_type_and_time_horizons.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_risk_type_and_time_horizons のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy =>
  /\bon ssbj_report_time_horizons\b/.test(policy),
);
const grants = body.match(/grant [^;]*;/g) ?? [];

const policyFor = (command: string): string => {
  const policy = policies.find(text => new RegExp(`\\bfor ${command}\\b`).test(text));
  if (!policy) throw new Error(`${command} のポリシーがありません`);
  return policy;
};

describe('リスクの種類', () => {
  it('状態＋値の対で追加し、既定は未入力（既存行を書き換えない）', () => {
    expect(body).toContain(`add column "riskTypeState" ssbj_field_state not null default 'unanswered'`);
    expect(body).toContain('add column "riskType" varchar(20)');
  });

  it('値は物理的 / 移行の 2 値、機会は持たない', () => {
    expect(body).toContain(`check ("riskType" in ('physical', 'transition'))`);
    expect(body).toContain(`check (kind = 'risk' or "riskType" is null)`);
  });

  it('保存版のリスク・機会セクションにリスクの種類を含める', () => {
    expect(body).toMatch(
      /create or replace function ssbj_snapshot_section__risks_opportunities\(p_report_id uuid\)[\s\S]*'riskType', ssbj_field_value_json\(ro\."riskTypeState", ro\."riskType"\)/,
    );
  });
});

describe('ssbj_report_time_horizons の RLS と権限', () => {
  it('RLS を有効化している', () => {
    expect(body).toContain('alter table ssbj_report_time_horizons enable row level security;');
  });

  it.each(['select', 'insert', 'update', 'delete'])('%s は authenticated の自組織に限定される', command => {
    const policy = policyFor(command);
    expect(policy).toContain('to authenticated');
    expect(policy).toContain('"organizationId" = (select current_user_organization_id())');
  });

  it.each(['insert', 'update'])('%s の with check でレポートの組織帰属を検証する', command => {
    const withCheck = policyFor(command).split('with check')[1] ?? '';
    expect(withCheck).toContain('select 1 from ssbj_reports r where r.id = "reportId"');
  });

  it('update は定義の列だけ（レポート・組織は作成後に変えられない）', () => {
    const updateGrant = grants.find(
      grant => grant.startsWith('grant update') && /\bon ssbj_report_time_horizons\b/.test(grant),
    );
    expect(updateGrant).toBeDefined();
    expect(updateGrant).not.toContain('"reportId"');
    expect(updateGrant).not.toContain('"organizationId"');
  });

  it('anon には何も付与しない', () => {
    expect(grants.some(grant => /\bssbj_report_time_horizons\b/.test(grant) && /\banon\b/.test(grant))).toBe(false);
  });

  it('作業中データの変更で draftRevision を進める', () => {
    expect(body).toMatch(
      /create trigger \w+ after insert or update or delete on ssbj_report_time_horizons for each row execute function bump_ssbj_draft_revision\(\);/,
    );
  });
});

describe('保存版との連携', () => {
  it.each(['ssbj_snapshot_section__time_horizons(uuid)', 'ssbj_field_value_json(ssbj_field_state, text)'])(
    '%s は service_role 限定',
    signature => {
      const escaped = signature.replace(/[()]/g, '\\$&');
      expect(body).toMatch(new RegExp(`revoke execute on function ${escaped} from public, anon, authenticated;`));
      expect(body).toMatch(new RegExp(`grant execute on function ${escaped} to service_role;`));
    },
  );

  it('共通関数は保存版セクションとして自動収集される名前にしない', () => {
    expect(body).toContain('create function ssbj_field_value_json(');
  });
});
