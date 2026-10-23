// AI を呼んだ記録（サーバ専用）。提供元へ送った呼び出しのたびに、成功・失敗とも system_audit_logs に 1 行残す。
//
// 残すのは「誰が・いつ・どの用途で・どの提供元とモデルを・どの方式の鍵で・何を（種類・量・ファイルの SHA-256）送り・
// 結果はどうだったか・どれだけかかったか」だけ。鍵・送った内容・AI の出力は残さない（監査ログはメンバー全員が読めるため）。
// 用途は entityName に入れる（回数の上限は、この列で用途ごとに数える: rateLimit.ts）。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiGenerateErrorCode, AiProviderId } from '@/types/ai';
import type { AiInputSummary } from './inputCheck';
import { AI_REQUEST_ACTION } from './rateLimit';

export interface AiRequestRecord {
  organizationId: string;
  userId: string;
  purposeId: string;
  provider: AiProviderId;
  modelId: string;
  keySource: 'server' | 'app';
  inputs: AiInputSummary[];
  result: 'success' | AiGenerateErrorCode;
  durationMs: number;
}

/** 記録する。失敗しても呼び出しの結果は変えないので、成否だけを返す（呼び出し側がログに残す） */
export const recordAiRequest = async (admin: SupabaseClient, record: AiRequestRecord): Promise<boolean> => {
  const { error } = await admin.from('system_audit_logs').insert({
    organizationId: record.organizationId,
    userId: record.userId,
    action: AI_REQUEST_ACTION,
    entityName: record.purposeId,
    detail: JSON.stringify({
      provider: record.provider,
      modelId: record.modelId,
      keySource: record.keySource,
      inputs: record.inputs,
      result: record.result,
      durationMs: record.durationMs,
    }),
  });
  return !error;
};
