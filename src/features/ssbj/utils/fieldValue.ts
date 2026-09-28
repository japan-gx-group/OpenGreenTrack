// 状態つきの値（SsbjFieldValue）を扱う純関数。
// 未入力・未確認・非該当・回答済み（0 を含む）を取り違えないよう、DB 行との変換と表示ラベルを
// ここに一本化する。未入力を 0・空文字・「なし」に置き換える処理をここ以外に書かないこと。

import { SSBJ_FIELD_STATES, type SsbjFieldState, type SsbjFieldValue } from '../types';

/** 状態の表示ラベル。未入力を「0」「なし」「-」などにしない（誤読を防ぐ）。 */
export const SSBJ_FIELD_STATE_LABELS: Record<SsbjFieldState, string> = {
  unanswered: '未入力',
  unconfirmed: '未確認',
  not_applicable: '非該当',
  answered: '入力済み',
};

export const isSsbjFieldState = (value: unknown): value is SsbjFieldState =>
  typeof value === 'string' && (SSBJ_FIELD_STATES as readonly string[]).includes(value);

export const isAnswered = <T>(
  field: SsbjFieldValue<T>,
): field is { state: 'answered'; value: T } => field.state === 'answered';

export const fieldStateLabel = (state: SsbjFieldState): string => SSBJ_FIELD_STATE_LABELS[state];

/**
 * 画面・プレビュー・CSV 向けの表示文字列。回答済みなら値（format で整形）、それ以外は状態ラベル。
 * 回答済みの "0" は "0" のまま表示される（未入力とは別物として見える）。
 */
export const formatFieldValue = <T>(
  field: SsbjFieldValue<T>,
  format: (value: T) => string = value => String(value),
): string => (isAnswered(field) ? format(field.value) : fieldStateLabel(field.state));

/**
 * DB の「状態列 + 値列」から SsbjFieldValue を組み立てる。
 * 状態と値が食い違う行（回答済みなのに値が無い / 未入力なのに値がある / 空白だけの文字列）は
 * 黙って補正せず例外にする。補正すると「未入力が 0 や空文字として保存版に残る」経路になるため。
 */
export const toFieldValue = <T>(state: unknown, value: T | null | undefined): SsbjFieldValue<T> => {
  if (!isSsbjFieldState(state)) {
    throw new Error(`不明な入力状態です: ${String(state)}`);
  }
  const hasValue = value !== null && value !== undefined;
  if (state === 'answered') {
    if (!hasValue) {
      throw new Error('入力済みの項目に値がありません');
    }
    if (typeof value === 'string' && value.trim() === '') {
      throw new Error('入力済みの項目の値が空です');
    }
    return { state, value };
  }
  if (hasValue) {
    throw new Error(`${SSBJ_FIELD_STATE_LABELS[state]}の項目に値が入っています`);
  }
  return { state };
};

/** SsbjFieldValue を DB の「状態列 + 値列」へ分解する（toFieldValue の逆）。 */
export const fromFieldValue = <T>(field: SsbjFieldValue<T>): { state: SsbjFieldState; value: T | null } =>
  isAnswered(field) ? { state: 'answered', value: field.value } : { state: field.state, value: null };
