import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_ACTIVITY_RECORD_ERROR_TAG,
  DUPLICATE_ACTIVITY_RECORD_HINT,
  DUPLICATE_ACTIVITY_RECORD_MESSAGE,
  buildActivityRecordDuplicateKey,
  buildDuplicateActivityRecordMessage,
  findDuplicateActivityRecord,
  formatDuplicatePeriodLabel,
  isDuplicateActivityRecordError,
  type ActivityRecordDuplicateKeyFields,
  type DuplicateWarningRecord,
} from '../activityRecordDuplicates';

const record = (
  overrides: Partial<ActivityRecordDuplicateKeyFields> = {},
): ActivityRecordDuplicateKeyFields => ({
  locationId: 'loc-1',
  energyType: 'electricity',
  periodStart: '2026-04-01',
  ...overrides,
});

describe('activityRecordDuplicates', () => {
  it('拠点・カテゴリ・対象月が同じなら同じ重複キーになる', () => {
    const key = buildActivityRecordDuplicateKey(record());

    expect(buildActivityRecordDuplicateKey(record())).toBe(key);
    expect(buildActivityRecordDuplicateKey(record({ locationId: 'loc-2' }))).not.toBe(key);
    expect(buildActivityRecordDuplicateKey(record({ energyType: 'city_gas' }))).not.toBe(key);
    expect(buildActivityRecordDuplicateKey(record({ periodStart: '2026-05-01' }))).not.toBe(key);
  });

  it('IDに区切り文字のような文字が含まれても重複キーが衝突しない', () => {
    const keyA = buildActivityRecordDuplicateKey(
      record({ locationId: 'loc|1', energyType: 'electricity' }),
    );
    const keyB = buildActivityRecordDuplicateKey(
      record({ locationId: 'loc', energyType: 'fuel_diesel' }),
    );

    expect(keyA).not.toBe(keyB);
  });

  it('DBトリガー由来の重複エラーだけをユーザー向けエラーとして扱う', () => {
    // 本命の判定経路: メッセージ文言に依存しない detail のタグ。
    expect(
      isDuplicateActivityRecordError({
        code: '23505',
        message: '文言を変えても判定できること',
        details: DUPLICATE_ACTIVITY_RECORD_ERROR_TAG,
      }),
    ).toBe(true);

    // タグ未投入の旧トリガー向けフォールバック。
    expect(
      isDuplicateActivityRecordError({
        code: '23505',
        message: DUPLICATE_ACTIVITY_RECORD_MESSAGE,
      }),
    ).toBe(true);

    expect(
      isDuplicateActivityRecordError({
        code: '23505',
        message: '別テーブルの一意制約違反',
      }),
    ).toBe(false);
    // タグがあってもコードが違えば重複エラーとは扱わない。
    expect(
      isDuplicateActivityRecordError({
        code: '23503',
        details: DUPLICATE_ACTIVITY_RECORD_ERROR_TAG,
      }),
    ).toBe(false);
    expect(isDuplicateActivityRecordError(null)).toBe(false);
  });

  it('対象月ラベルを「YYYY年M月」へ整形する', () => {
    expect(formatDuplicatePeriodLabel('2024-11-01')).toBe('2024年11月');
    expect(formatDuplicatePeriodLabel('2024-04')).toBe('2024年4月');
    // 解釈できない値はそのまま返し、メッセージ生成で例外を出さない。
    expect(formatDuplicatePeriodLabel('unknown')).toBe('unknown');
  });

  it('拠点名・カテゴリ・対象月が揃えば、どのレコードが重複したか分かるメッセージにする', () => {
    const message = buildDuplicateActivityRecordMessage({
      locationName: '東京本社',
      categoryLabel: '電気',
      periodLabel: '2024年11月',
    });

    expect(message).toBe(
      `『東京本社』の電気・2024年11月 の活動量は既に登録済みです。${DUPLICATE_ACTIVITY_RECORD_HINT}`,
    );
  });

  it('説明に必要な情報が欠けていれば汎用メッセージへ落とす', () => {
    expect(buildDuplicateActivityRecordMessage()).toBe(DUPLICATE_ACTIVITY_RECORD_MESSAGE);
    expect(
      buildDuplicateActivityRecordMessage({ locationName: '東京本社', categoryLabel: '電気' }),
    ).toBe(DUPLICATE_ACTIVITY_RECORD_MESSAGE);
  });

  it('重複メッセージは既存レコードへの合算導線を必ず案内する', () => {
    expect(DUPLICATE_ACTIVITY_RECORD_MESSAGE).toContain(
      '入力履歴から既存レコードを開いて活動量を合算してください。',
    );
    // DBトリガーのメッセージ・フォールバック判定と共有している語句。
    expect(DUPLICATE_ACTIVITY_RECORD_MESSAGE).toContain('同じ拠点・カテゴリ・対象年月');
  });
});

// 事前警告用の履歴照合（findDuplicateActivityRecord）。保存時と同じ重複キーで判定する。
describe('findDuplicateActivityRecord', () => {
  const warningRecord = (overrides: Partial<DuplicateWarningRecord> = {}): DuplicateWarningRecord => ({
    id: 'rec-1',
    locationId: 'loc-1',
    energyType: 'electricity',
    periodStart: '2026-04-01',
    scope3CategoryId: null,
    ideaFactorId: null,
    ...overrides,
  });

  it('Scope1/2: 拠点×カテゴリ×対象月が一致する既存レコードを返す', () => {
    const existing = warningRecord();
    const candidate = {
      kind: 'scope12',
      locationId: 'loc-1',
      energyType: 'electricity',
      periodStart: '2026-04-01',
    } as const;

    expect(findDuplicateActivityRecord([existing], candidate)).toBe(existing);
    expect(
      findDuplicateActivityRecord([warningRecord({ locationId: 'loc-2' })], candidate),
    ).toBeNull();
    expect(
      findDuplicateActivityRecord([warningRecord({ energyType: 'city_gas' })], candidate),
    ).toBeNull();
    expect(
      findDuplicateActivityRecord([warningRecord({ periodStart: '2026-05-01' })], candidate),
    ).toBeNull();
  });

  it('Scope3積上げ: カテゴリ×IDEA製品まで一致したときだけ重複とする', () => {
    const existing = warningRecord({
      energyType: 'scope3_activity',
      scope3CategoryId: 1,
      ideaFactorId: 'idea-1',
    });
    const candidate = {
      kind: 'scope3',
      locationId: 'loc-1',
      periodStart: '2026-04-01',
      scope3CategoryId: 1,
      ideaFactorId: 'idea-1',
    } as const;

    expect(findDuplicateActivityRecord([existing], candidate)).toBe(existing);
    // 同月・同拠点でも別製品・別カテゴリは推奨粒度（月次×製品）どおり重複にしない。
    expect(
      findDuplicateActivityRecord(
        [warningRecord({ energyType: 'scope3_activity', scope3CategoryId: 1, ideaFactorId: 'idea-2' })],
        candidate,
      ),
    ).toBeNull();
    expect(
      findDuplicateActivityRecord(
        [warningRecord({ energyType: 'scope3_activity', scope3CategoryId: 2, ideaFactorId: 'idea-1' })],
        candidate,
      ),
    ).toBeNull();
    // Scope1/2 のレコード（energyType が scope3_activity 以外）は Scope3 の重複に数えない。
    expect(findDuplicateActivityRecord([warningRecord()], candidate)).toBeNull();
  });

  it('編集中のレコード自身は excludeRecordId で重複に数えない', () => {
    const self = warningRecord({ id: 'rec-self' });
    const other = warningRecord({ id: 'rec-other' });
    const candidate = {
      kind: 'scope12',
      locationId: 'loc-1',
      energyType: 'electricity',
      periodStart: '2026-04-01',
    } as const;

    expect(findDuplicateActivityRecord([self], candidate, { excludeRecordId: 'rec-self' })).toBeNull();
    expect(
      findDuplicateActivityRecord([self, other], candidate, { excludeRecordId: 'rec-self' }),
    ).toBe(other);
  });
});
