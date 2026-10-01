// SSBJ 該当性・重要性・記載しない理由（ssbj_judgements）の制約・RLS・権限・保存版連携に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - 組織分離（§10 の手順1）と、作業中データの変更で draftRevision を進めること（手順2）
//   - 要求 ID の形式・区分の値（types.ts と同じ）・「重要性がない」理由の整合・説明の状態と本文の対、レポートと要求の組ごとに 1 行
//   - 既定は「未確認」（ソフトは判断を自動で決めない）
//   - レポート・組織・要求は作成後に変えない（update の列 GRANT に含めない）
//   - 保存版セクション関数は service_role 限定（手順3）

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_APPLICABILITIES, SSBJ_MATERIALITIES, SSBJ_OMISSION_REASONS } from '@/features/ssbj/types';
import { SSBJ_REQUIREMENT_ID_PATTERN } from '@/features/ssbj/utils/ids';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_judgements.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_judgements のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy => /\bon ssbj_judgements\b/.test(policy));
const grants = body.match(/grant [^;]*;/g) ?? [];

const policyFor = (command: string): string => {
  const policy = policies.find(text => new RegExp(`\\bfor ${command}\\b`).test(text));
  if (!policy) throw new Error(`${command} のポリシーがありません`);
  return policy;
};

/** check (<column> in ('a', 'b')) の値の並び */
const checkValues = (column: string): string[] => {
  const match = body.match(new RegExp(`check \\(\\s*${column} in \\(([^)]*)\\)`));
  if (!match) throw new Error(`${column} の check 制約がありません`);
  return match[1].split(',').map(value => value.trim().replace(/^'|'$/g, ''));
};

describe('ssbj_judgements の制約', () => {
  it('要求 ID の形式は utils/ids.ts と同じ正規表現', () => {
    const match = body.match(/"requirementId" ~ '([^']+)'/);
    expect(match?.[1]).toBe(SSBJ_REQUIREMENT_ID_PATTERN.source);
  });

  it('区分の値は types.ts と同じ', () => {
    expect(checkValues('applicability')).toEqual([...SSBJ_APPLICABILITIES]);
    expect(checkValues('materiality')).toEqual([...SSBJ_MATERIALITIES]);
    expect(checkValues('"omissionReason"')).toEqual([...SSBJ_OMISSION_REASONS]);
  });

  it('既定は未確認・記載する・説明は未入力（ソフトは判断を自動で決めない）', () => {
    expect(body).toContain(`applicability varchar(20) not null default 'unconfirmed'`);
    expect(body).toContain(`materiality varchar(20) not null default 'unconfirmed'`);
    expect(body).toContain(`"omissionReason" varchar(30) not null default 'none'`);
    expect(body).toContain(`"explanationState" ssbj_field_state not null default 'unanswered'`);
  });

  it('「重要性がない」を理由にするのは、重要性を「なし」と判断したときだけ', () => {
    expect(body).toContain(`check ( "omissionReason" <> 'not_material' or materiality = 'not_material' )`);
  });

  it('説明は入力済みのときだけ本文を持ち、空白だけの本文は拒否する', () => {
    expect(body).toContain(`("explanationState" = 'answered' and "explanationText" is not null and btrim("explanationText") <> '')`);
    expect(body).toContain(`("explanationState" <> 'answered' and "explanationText" is null)`);
  });

  it('レポートと要求の組ごとに 1 行', () => {
    expect(body).toContain('constraint ssbj_judgements_report_requirement_key unique ("reportId", "requirementId")');
  });
});

describe('ssbj_judgements の RLS と権限', () => {
  it('RLS を有効化している', () => {
    expect(body).toContain('alter table ssbj_judgements enable row level security;');
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

  it('update は判断の列だけ（レポート・組織・要求は作成後に変えられない）', () => {
    const updateGrant = grants.find(grant => grant.startsWith('grant update') && /\bon ssbj_judgements\b/.test(grant));
    expect(updateGrant).toBeDefined();
    for (const column of ['"reportId"', '"organizationId"', '"requirementId"']) {
      expect(updateGrant).not.toContain(column);
    }
  });

  it('anon には何も付与しない', () => {
    expect(grants.some(grant => /\bssbj_judgements\b/.test(grant) && /\banon\b/.test(grant))).toBe(false);
  });

  it('作業中データの変更で draftRevision を進める', () => {
    expect(body).toMatch(
      /create trigger \w+ after insert or update or delete on ssbj_judgements for each row execute function bump_ssbj_draft_revision\(\);/,
    );
  });
});

describe('保存版との連携', () => {
  it('ssbj_snapshot_section__judgements は service_role 限定', () => {
    expect(body).toContain('create function ssbj_snapshot_section__judgements(p_report_id uuid)');
    expect(body).toContain('revoke execute on function ssbj_snapshot_section__judgements(uuid) from public, anon, authenticated;');
    expect(body).toContain('grant execute on function ssbj_snapshot_section__judgements(uuid) to service_role;');
  });

  it('開示する説明と内部の検討理由を別のプロパティにする（§5）', () => {
    expect(body).toContain(`'disclosure', ssbj_field_value_json(j."explanationState", j."explanationText")`);
    expect(body).toContain(`'internalNote', j."internalReason"`);
  });
});
