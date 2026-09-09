// 活動量レコードの重複判定を一箇所に集約する。
// 「拠点 × エネルギー種別 × 対象月(periodStart)」が同じ行は同じ活動量として扱い、
// 新規登録・編集で同じ二重計上防止ルールを使う。
import type { SupabaseClient } from '@supabase/supabase-js';
import { IN_CHUNK_SIZE, chunk, fetchAllRows } from '@/lib/supabaseRows';
import type { EnergyType } from '@/features/calculation/types';

// 重複を「エラー」ではなく「既存レコードへ合算してください」という次の行動として伝える。
// 1拠点に複数メーターがある / 同月に複数請求書が届く、といった正当なケースでも
// 重複登録は許さない方針のため、合算導線を必ず案内する。
export const DUPLICATE_ACTIVITY_RECORD_HINT =
  '複数メーター・複数請求書の場合は、入力履歴から既存レコードを開いて活動量を合算してください。';

export const DUPLICATE_ACTIVITY_RECORD_MESSAGE =
  `同じ拠点・カテゴリ・対象年月の活動量が既に登録済みです。${DUPLICATE_ACTIVITY_RECORD_HINT}`;

// DBトリガーが detail / hint に埋める機械可読な目印。
// メッセージ文言を変えても重複エラーの判定が壊れないようにするため。
export const DUPLICATE_ACTIVITY_RECORD_ERROR_TAG = 'DUPLICATE_ACTIVITY_RECORD';

export interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** 対象レコードを画面表示用に説明するための情報。1つでも欠けると汎用メッセージへ落とす。 */
export interface DuplicateActivityRecordTarget {
  locationName?: string | null;
  categoryLabel?: string | null;
  periodLabel?: string | null;
}

/** 'YYYY-MM-DD' / 'YYYY-MM' を「YYYY年M月」へ整形する。解釈できなければ入力をそのまま返す。 */
export const formatDuplicatePeriodLabel = (periodStart: string): string => {
  const matched = /^(\d{4})-(\d{2})/.exec(periodStart);
  if (!matched) {
    return periodStart;
  }
  return `${matched[1]}年${Number(matched[2])}月`;
};

const describeDuplicateTarget = (target: DuplicateActivityRecordTarget): string | null => {
  const { locationName, categoryLabel, periodLabel } = target;
  if (!locationName || !categoryLabel || !periodLabel) {
    return null;
  }
  return `『${locationName}』の${categoryLabel}・${periodLabel}`;
};

// どのレコードが重複したのか特定できるメッセージにする。
// 拠点名・カテゴリ名・対象月が揃わない呼び出し元では汎用メッセージを返す。
export const buildDuplicateActivityRecordMessage = (
  target: DuplicateActivityRecordTarget = {},
): string => {
  const description = describeDuplicateTarget(target);
  if (!description) {
    return DUPLICATE_ACTIVITY_RECORD_MESSAGE;
  }
  return `${description} の活動量は既に登録済みです。${DUPLICATE_ACTIVITY_RECORD_HINT}`;
};

export interface ActivityRecordDuplicateKeyFields {
  locationId: string;
  energyType: EnergyType;
  periodStart: string;
}

interface ActivityRecordDuplicateKeyRow {
  id: string;
  locationId: string;
  energyType: EnergyType;
  periodStart: string;
}

// JSON.stringify に配列を渡すと、区切り文字を含むIDでもキー衝突しない安定した文字列にできる。
export const buildActivityRecordDuplicateKey = ({
  locationId,
  energyType,
  periodStart,
}: ActivityRecordDuplicateKeyFields): string =>
  JSON.stringify([locationId, energyType, periodStart]);

// PostgREST の .in(...) はURLクエリになるため、候補が増えてもURL過長にならないよう
// locationId / energyType / periodStart を分割して既存キーを取得する。
//
// NOTE: この絞り込みは候補タプルそのものではなく「拠点×種別×対象月」の直積に一致するため、
// 候補が疎な場合は候補外の行も取得する。重複判定は候補側のキーで照合するので結果は正しく、
// 取得件数が増えるだけ。タプル単位に絞るには .or() でOR条件を組む必要があり、
// URL長とクエリの読みやすさを悪化させるため、現状は直積のまま許容している。
export const fetchExistingActivityRecordDuplicateKeys = async (
  supabase: SupabaseClient,
  organizationId: string,
  candidates: readonly ActivityRecordDuplicateKeyFields[],
  options: { excludeRecordId?: string } = {},
): Promise<Set<string>> => {
  const existingKeys = new Set<string>();
  if (candidates.length === 0) {
    return existingKeys;
  }

  const locationIds = Array.from(new Set(candidates.map((candidate) => candidate.locationId)));
  const energyTypes = Array.from(new Set(candidates.map((candidate) => candidate.energyType)));
  const periodStarts = Array.from(new Set(candidates.map((candidate) => candidate.periodStart)));

  for (const locationIdChunk of chunk(locationIds, IN_CHUNK_SIZE)) {
    for (const energyTypeChunk of chunk(energyTypes, IN_CHUNK_SIZE)) {
      for (const periodStartChunk of chunk(periodStarts, IN_CHUNK_SIZE)) {
        const rows = await fetchAllRows<ActivityRecordDuplicateKeyRow>((from, to) => {
          let query = supabase
            .from('activity_records')
            .select('id, locationId, energyType, periodStart')
            .eq('organizationId', organizationId)
            .in('locationId', locationIdChunk)
            .in('energyType', energyTypeChunk)
            .in('periodStart', periodStartChunk);

          if (options.excludeRecordId) {
            query = query.neq('id', options.excludeRecordId);
          }

          // ORDER BY 無しの range() は行順が保証されず、該当行が PAGE_SIZE を超えると
          // ページ間で取りこぼしが起きる（＝既存重複を見逃す）。他のページング実装と同じく id 順で固定する。
          return query.order('id', { ascending: true }).range(from, to);
        }, '活動量レコードの重複確認に失敗しました');

        for (const row of rows) {
          existingKeys.add(buildActivityRecordDuplicateKey(row));
        }
      }
    }
  }

  return existingKeys;
};

export const hasDuplicateActivityRecord = async (
  supabase: SupabaseClient,
  organizationId: string,
  candidate: ActivityRecordDuplicateKeyFields,
  options: { excludeRecordId?: string } = {},
): Promise<boolean> => {
  const existingKeys = await fetchExistingActivityRecordDuplicateKeys(
    supabase,
    organizationId,
    [candidate],
    options,
  );
  return existingKeys.has(buildActivityRecordDuplicateKey(candidate));
};

export const isDuplicateActivityRecordError = (
  error: SupabaseLikeError | null | undefined,
): boolean => {
  if (!error) {
    return false;
  }

  if (error.code !== '23505') {
    return false;
  }

  // 判定はトリガーが detail / hint に埋めたタグを主とし、文言変更で壊れないようにする。
  // メッセージの部分一致は、タグ未投入の環境（旧トリガー）向けの保険。
  const haystack = [error.details ?? '', error.hint ?? '', error.message ?? ''].join('\n');
  return (
    haystack.includes(DUPLICATE_ACTIVITY_RECORD_ERROR_TAG) ||
    haystack.includes('同じ拠点・カテゴリ・対象年月')
  );
};
