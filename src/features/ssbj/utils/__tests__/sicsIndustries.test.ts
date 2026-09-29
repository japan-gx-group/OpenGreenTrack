import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SICS_INDUSTRIES,
  SICS_SECTORS,
  findSicsIndustry,
  formatSicsIndustry,
  isSicsIndustryCode,
  sicsGuidanceUrl,
} from '../sicsIndustries';

describe('SICS の産業一覧', () => {
  it('68 産業で、コードと巻番号は重複せず、巻番号は 1〜68 の連番', () => {
    expect(SICS_INDUSTRIES).toHaveLength(68);
    expect(new Set(SICS_INDUSTRIES.map(industry => industry.code)).size).toBe(68);
    expect(SICS_INDUSTRIES.map(industry => industry.volume)).toEqual(Array.from({ length: 68 }, (_, i) => i + 1));
  });

  it('どの産業もいずれかのセクターに属する', () => {
    const prefixes = new Set<string>(SICS_SECTORS.map(sector => sector.prefix));
    for (const industry of SICS_INDUSTRIES) {
      expect(prefixes.has(industry.code.slice(0, 2))).toBe(true);
    }
  });

  it('DB の check 制約のコード一覧と一致する', () => {
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
    const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_report_parent_and_industry.sql'));
    if (!fileName) throw new Error('マイグレーションが見つかりません');
    const sql = readFileSync(path.join(migrationsDir, fileName), 'utf8');
    const constraint = sql.slice(sql.indexOf('ssbj_reports_industry_code_check'));
    const codesInSql = constraint.slice(0, constraint.indexOf(');')).match(/'[A-Z]{2}-[A-Z]{2}'/g) ?? [];
    expect(codesInSql.map(code => code.slice(1, -1)).sort()).toEqual(SICS_INDUSTRIES.map(i => i.code).sort());
  });
});

describe('参照先', () => {
  it('巻番号と公開日から解説資料の URL を作る', () => {
    const industrialMachinery = findSicsIndustry('RT-IG');
    const utilities = findSicsIndustry('IF-EU');
    if (!industrialMachinery || !utilities) throw new Error('産業が見つかりません');
    expect(sicsGuidanceUrl(industrialMachinery)).toBe(
      'https://www.ssb-j.jp/jp/wp-content/uploads/sites/6/s2-50_20231020.pdf',
    );
    expect(sicsGuidanceUrl(utilities)).toBe('https://www.ssb-j.jp/jp/wp-content/uploads/sites/6/s2-32_20231025.pdf');
  });

  it('表示とコードの判定', () => {
    expect(formatSicsIndustry('TR-RO')).toBe('TR-RO 道路輸送');
    expect(formatSicsIndustry('XX-YY')).toBe('XX-YY');
    expect(isSicsIndustryCode('TR-RO')).toBe(true);
    expect(isSicsIndustryCode('XX-YY')).toBe(false);
  });
});
