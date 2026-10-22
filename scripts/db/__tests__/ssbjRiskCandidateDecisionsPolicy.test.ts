// 業種から出した候補への判断（ssbj_risk_candidate_decisions）の制約・RLS・権限・承認ロック・操作履歴に対する回帰テスト
// （実DBを使わない机上検証）。検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置く（AGENTS.md R13）。
//
// 固定すること:
//   - 組織分離と、つなぐリスク・機会が同じレポートのものであること
//   - 候補 ID の形式は utils/industryCandidates.ts と同じ、レポートと候補の組ごとに 1 行、除外は理由が必須
//   - 組織・レポート・候補は作成後に変えない（update の列 GRANT に含めない）
//   - 「採用して登録」はリスク・機会の登録と採用の記録を 1 つの RPC で保存し、既に採用済みなら上書きせず競合にする
//   - 登録したリスク・機会が残っている採用は取り消せず、上書きもできない（再採用で重複して登録しない）。関連付けは外部キーにしない（復元で切れない）
//   - 承認済みの間は変えられず、操作履歴に記録する。保存版には含めない（draftRevision を進めない）

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_CANDIDATE_ID_PATTERN } from '@/features/ssbj/utils/industryCandidates';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_risk_candidate_decisions.sql'));

const body = (() => {
  if (!fileName) throw new Error('ssbj_risk_candidate_decisions のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy => /\bon ssbj_risk_candidate_decisions\b/.test(policy));
const grants = body.match(/grant [^;]*;/g) ?? [];

const policyFor = (command: string): string => {
  const policy = policies.find(text => new RegExp(`\\bfor ${command}\\b`).test(text));
  if (!policy) throw new Error(`${command} のポリシーがありません`);
  return policy;
};

describe('ssbj_risk_candidate_decisions の制約', () => {
  it('候補 ID の形式は utils/industryCandidates.ts と同じ正規表現', () => {
    const match = body.match(/"candidateId" ~ '([^']+)'/);
    expect(match?.[1]).toBe(SSBJ_CANDIDATE_ID_PATTERN.source);
  });

  it('レポートと候補の組ごとに 1 行、判断は採用か除外、除外は理由が必須', () => {
    expect(body).toContain('unique ("reportId", "candidateId")');
    expect(body).toContain(`check (decision in ('adopted', 'excluded'))`);
  });

  it('除外の理由は、前後の空白（改行・タブ・全角スペース・NBSP・BOM を含む）を除いて空なら無いものとする（差戻しの理由と同じ判定）', () => {
    expect(body).toContain(
      String.raw`decision <> 'excluded' or (reason is not null and regexp_replace(reason, '^[\s\u00a0\u3000\ufeff]+|[\s\u00a0\u3000\ufeff]+$', '', 'g') <> '')`,
    );
    // btrim() は半角スペースしか除かず、改行・タブだけの理由を通してしまう。
    expect(body).not.toMatch(/btrim\(reason\)/);
  });

  it('登録したリスク・機会への関連付けは外部キーにしない（保存版の復元で全部消して入れ直しても、関連付けが切れない）', () => {
    expect(body).toContain('"riskOpportunityId" uuid,');
    expect(body).not.toMatch(/"riskOpportunityId" uuid references/);
    expect(body).not.toContain('on delete set null');
  });
});

describe('ssbj_risk_candidate_decisions の RLS と権限', () => {
  it('RLS を有効化している', () => {
    expect(body).toContain('alter table ssbj_risk_candidate_decisions enable row level security;');
  });

  it.each(['select', 'insert', 'update', 'delete'])('%s は authenticated の自組織に限定される', command => {
    const policy = policyFor(command);
    expect(policy).toContain('to authenticated');
    expect(policy).toContain('"organizationId" = (select current_user_organization_id())');
  });

  it.each(['insert', 'update'])('%s の with check でレポートの組織帰属と、リスク・機会が同じレポートのものかを検証する', command => {
    const withCheck = policyFor(command).split('with check')[1] ?? '';
    expect(withCheck).toContain('select 1 from ssbj_reports r where r.id = "reportId"');
    expect(withCheck).toContain('ro."reportId" = ssbj_risk_candidate_decisions."reportId"');
  });

  // 登録したリスク・機会が残っている採用（この条件に当たる行は、delete・update の対象にならない）。
  const ADOPTED_WITH_RISK =
    `and not ( decision = 'adopted' and exists ( select 1 from ssbj_risks_opportunities ro where ro.id = "riskOpportunityId" and ro."reportId" = ssbj_risk_candidate_decisions."reportId" ) )`;

  it('delete は、登録したリスク・機会が残っている採用を消させない（未検討に戻して再採用すると重複して登録されるため）', () => {
    const using = policyFor('delete').split('using')[1] ?? '';
    expect(using).toContain(ADOPTED_WITH_RISK);
  });

  it('update は、登録したリスク・機会が残っている採用を上書きさせない（古い画面から除外して関連付けを外し、再採用で重複して登録されるのを防ぐ）', () => {
    const [using = '', withCheck = ''] = (policyFor('update').split(/\busing\b/)[1] ?? '').split('with check');
    expect(using).toContain(ADOPTED_WITH_RISK);
    // with check は書き込んだ後の行を見るので、この条件を置くと adopt_ssbj_risk_candidate の採用し直しが通らなくなる。
    expect(withCheck).not.toContain(ADOPTED_WITH_RISK);
  });

  it('update は判断の列だけ（組織・レポート・候補は作成後に変えられない）', () => {
    const updateGrant = grants.find(grant => grant.startsWith('grant update'));
    expect(updateGrant).toBeDefined();
    for (const column of ['"reportId"', '"organizationId"', '"candidateId"']) {
      expect(updateGrant).not.toContain(column);
    }
  });

  it('anon には何も付与しない', () => {
    expect(grants.some(grant => /\banon\b/.test(grant))).toBe(false);
  });
});

describe('承認ロック・操作履歴・保存版', () => {
  it('承認済みの間は変更を拒否し、操作履歴に記録する', () => {
    expect(body).toMatch(/before insert or update or delete on ssbj_risk_candidate_decisions for each row execute function reject_ssbj_change_when_approved\(\);/);
    expect(body).toMatch(/after insert or update or delete on ssbj_risk_candidate_decisions for each row execute function ssbj_audit_row_change\('risk_candidate', 'candidateId'\);/);
  });

  it('保存版に含めない（draftRevision を進めず、保存版セクションを作らない）', () => {
    expect(body).not.toContain('bump_ssbj_draft_revision');
    expect(body).not.toContain('ssbj_snapshot_section__');
  });
});

describe('採用して登録（adopt_ssbj_risk_candidate）', () => {
  const adopt = body.match(/create function adopt_ssbj_risk_candidate\(.*?\$\$.*?\$\$;/)?.[0] ?? '';

  it('リスク・機会の登録と採用の記録を同じ関数（1 つのトランザクション）で書く', () => {
    expect(adopt).toContain('insert into ssbj_risks_opportunities');
    expect(adopt).toContain('insert into ssbj_risk_candidate_decisions');
    expect(adopt.indexOf('insert into ssbj_risks_opportunities')).toBeLessThan(adopt.indexOf('insert into ssbj_risk_candidate_decisions'));
  });

  it('利用者の権限で動き（RLS・列 GRANT・承認ロックを通す）、authenticated だけが実行できる', () => {
    expect(adopt).not.toContain('security definer');
    expect(body).toContain('revoke execute on function adopt_ssbj_risk_candidate(uuid, varchar, varchar, jsonb) from public, anon;');
    expect(body).toContain('grant execute on function adopt_ssbj_risk_candidate(uuid, varchar, varchar, jsonb) to authenticated;');
  });

  it('既に採用済み（登録したリスク・機会が残っている）なら、関連付けを上書きせずに競合にする', () => {
    // update の RLS で for update が選べない（登録したリスク・機会が残っている採用）ときも、行があれば競合にする。
    const conflict = adopt.indexOf(
      `if (v_has_decision and v_decision.decision = 'adopted' and exists ( select 1 from ssbj_risks_opportunities ro where ro.id = v_decision."riskOpportunityId" and ro."reportId" = p_report_id ))`
      + ` or (not v_has_decision and exists ( select 1 from ssbj_risk_candidate_decisions d where d."reportId" = p_report_id and d."candidateId" = p_candidate_id )) then raise exception`,
    );
    expect(conflict).toBeGreaterThan(0);
    expect(conflict).toBeLessThan(adopt.indexOf('insert into ssbj_risks_opportunities'));
    expect(adopt).toMatch(/exception when unique_violation then .*? errcode = 'P2062'/);
  });

  it('状態の列は jsonb の text から ssbj_field_state 型に変換して入れる（変換しないと insert が型の不一致で失敗する）', () => {
    for (const column of ['riskTypeState', 'descriptionState', 'timeHorizonState']) {
      expect(adopt).toContain(`(p_risk->>'${column}')::ssbj_field_state`);
    }
  });

  it('登録したリスク・機会を updatedAt 付きで返す（一覧から続けて編集するときの競合検知に使う）', () => {
    expect(adopt).toContain(`'updatedAt', v_risk."updatedAt"`);
  });

  it('業種はクライアントから受け取らず、レポートの基本情報の業種を記録する', () => {
    expect(adopt).not.toContain('p_industry_code');
    expect(adopt).toContain('v_report."industryCode"');
  });
});
