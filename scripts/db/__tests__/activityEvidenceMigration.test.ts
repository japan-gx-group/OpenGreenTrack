// 活動量の帳票（20261026120000_activity_evidence.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// - 帳票の行はサーバだけが作る・消す（authenticated には select だけ）
// - 紐づけは、記録と帳票の両方が自組織のときだけ作れる
// - 記録を消すと紐づけだけが消え、紐づいている帳票は消せない
// - バケットの設定変更は update だけ（R12 の例外）

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findViolations } from '../check-migrations';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261026120000_activity_evidence.sql'),
  'utf8',
);

const body = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

const policiesOn = (table: string) =>
  (body.match(/create policy[^;]*;/g) ?? []).filter((policy) => new RegExp(`on ${table} `).test(policy));

describe('activity_evidence_files（帳票）', () => {
  it('形式は PDF・PNG・JPEG・WebP、大きさは 10MB まで', () => {
    expect(body).toContain(
      "check (\"mimeType\" in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'))",
    );
    expect(body).toContain('check ("sizeBytes" > 0 and "sizeBytes" <= 10485760)');
  });

  it('authenticated は自組織の select だけ（行を作る・消すのはサーバ）', () => {
    const policies = policiesOn('activity_evidence_files');
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select to authenticated using \("organizationId" = \(select current_user_organization_id\(\)\)\)/);
    expect(body).toContain('grant select on activity_evidence_files to authenticated;');
    expect(body).not.toMatch(/grant [^;]*(insert|update|delete)[^;]* on activity_evidence_files to authenticated/);
  });
});

describe('activity_record_evidence（紐づけ）', () => {
  it('記録を消すと紐づけだけが消え、紐づいている帳票は消せない', () => {
    expect(body).toContain('"activityRecordId" uuid not null references activity_records(id) on delete cascade');
    expect(body).toContain('"evidenceFileId" uuid not null references activity_evidence_files(id) on delete restrict');
  });

  it('紐づけは、記録と帳票の両方が自組織のときだけ作れる', () => {
    const insert = policiesOn('activity_record_evidence').find((policy) => /for insert/.test(policy));
    expect(insert).toBeDefined();
    expect(insert).toMatch(/select 1 from activity_records r where r\.id = "activityRecordId" and r\."organizationId" = \(select current_user_organization_id\(\)\)/);
    expect(insert).toMatch(/select 1 from activity_evidence_files f where f\.id = "evidenceFileId" and f\."organizationId" = \(select current_user_organization_id\(\)\)/);
  });

  it('authenticated は select・insert・delete だけ（update は無い）', () => {
    expect(body).toContain('grant select, insert, delete on activity_record_evidence to authenticated;');
    expect(policiesOn('activity_record_evidence').some((policy) => /for update/.test(policy))).toBe(false);
  });
});

describe('Storage', () => {
  it('import-files に WebP を足す設定変更は、DML の確認（R12）を通る', () => {
    expect(body).toContain("update storage.buckets set allowed_mime_types = array['text/csv', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'] where id = 'import-files';");
    expect(findViolations(migrationSql)).toEqual([]);
  });
});
