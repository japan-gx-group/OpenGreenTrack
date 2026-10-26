// AI を使う用途の一覧（サーバ専用）。
//
// AI を使う機能は、ここに用途を登録してから共通の入口（generateStructured）を呼ぶ。登録していない用途からは呼べない
// （AiPurposeId が登録済みの id だけになるので、型でも止まる）。登録はコードの変更なので PR のレビューを通る。
// 用途ごとに、送ってよい入力の種類・量、回数の上限、出力の上限を決める。監査ログ（ai.request）には用途の id が残る。

import 'server-only';

export type AiInputKind = 'text' | 'pdf' | 'image';

export interface AiPurpose {
  /** 送信の確認と監査ログの表示に使う名前 */
  label: string;
  /** 送ってよい入力の種類 */
  inputs: readonly AiInputKind[];
  /** 1 回に送れる量の上限（バイト。文字は UTF-8 で数える） */
  maxInputBytes: number;
  /** 組織あたりの回数の上限 */
  limits: { perMinute: number; perDay: number };
  /** 出力の上限（トークン。課金の上限にもなる） */
  maxOutputTokens: number;
}

/** 1 回に送れる量の既定の上限。Vercel の関数の本文の上限（4.5MB）に収めるため 4MB にする */
export const DEFAULT_MAX_INPUT_BYTES = 4 * 1024 * 1024;

/** 用途にかかわらない、組織全体の 24 時間あたりの回数の上限 */
export const AI_ORGANIZATION_DAILY_LIMIT = 500;

// 用途を足すときは、ここに 1 行足す。
export const AI_PURPOSES = {
  // 請求書（電気・都市ガス・燃料）の PDF・画像から、使用量・使用月・事業者などを読み取る（データ入力）。
  invoice_reading: {
    label: '請求書の読取り',
    inputs: ['pdf', 'image'],
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    limits: { perMinute: 5, perDay: 100 },
    maxOutputTokens: 2_000,
  },
  // 読み取った事業者名・料金メニュー・燃料の名称に当てはまる排出係数を、候補の一覧（公表値）から選ぶ。
  // 請求書の読取り 1 回につき 1 回呼ぶ。事業者を絞れないときは電気の全事業者（約 560 社）が候補になる。
  invoice_factor_matching: {
    label: '請求書の排出係数の判定',
    inputs: ['text'],
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    limits: { perMinute: 10, perDay: 200 },
    maxOutputTokens: 1_000,
  },
} satisfies Record<string, AiPurpose>;

export type AiPurposeId = keyof typeof AI_PURPOSES;

/** 登録済みの用途を返す。登録していなければ undefined */
export const findAiPurpose = (id: string): AiPurpose | undefined =>
  Object.prototype.hasOwnProperty.call(AI_PURPOSES, id)
    ? (AI_PURPOSES as Record<string, AiPurpose>)[id]
    : undefined;
