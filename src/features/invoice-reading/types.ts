// 請求書の AI 読取り（データ入力）で、ブラウザとサーバが共有する型と値。
// 読取り（AI）→ 候補の絞り込み（コード）→ 係数の判定（AI）→ 拠点の候補（コード）の結果を、明細ごとに画面へ返す。
// AI の出力はそのまま確定データにせず、フォームに入れる候補（prefill）として返す。保存は人が行う。

import type { AiProviderId } from '@/types/ai';
import type { ActivityEntryPrefill, EntryFactorPrefill } from '@/features/data-input/types';
import type { EvidenceFile } from '@/features/activity-evidence/types';

/** 読み取る請求書の種類。other は対象外（熱・水道・電話など） */
export const INVOICE_KINDS = ['electricity', 'city_gas', 'fuel', 'other'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** 請求書から入れられる燃料のカテゴリ（手入力の主要燃料と同じ 5 種） */
export const INVOICE_FUEL_ENERGY_TYPES = [
  'fuel_gasoline',
  'fuel_diesel',
  'fuel_kerosene',
  'fuel_heavy_oil',
  'fuel_lpg',
] as const;
export type InvoiceFuelEnergyType = (typeof INVOICE_FUEL_ENERGY_TYPES)[number];

/** 請求書から入れられるカテゴリ。電気・都市ガスは事業者別係数、燃料は標準係数で判定する */
export type InvoiceEnergyType = 'electricity' | 'city_gas' | InvoiceFuelEnergyType;

/** 1 回に読み取る明細の上限（燃料の種類が複数ある請求書など） */
export const MAX_INVOICE_ITEMS = 10;

/** AI で読める帳票の大きさの上限（共通の入口の既定の上限と同じ 4MB）。これを超える帳票は保存だけする */
export const MAX_INVOICE_FILE_BYTES = 4 * 1024 * 1024;

/** 1 回にまとめて読める請求書のファイルの数 */
export const MAX_INVOICE_FILES = 10;

/** 読み取った明細（AI の出力を検証したもの。読めない値は null） */
export interface InvoiceExtractedItem {
  kind: InvoiceKind;
  /** 料金メニュー・契約種別（例: 従量電灯B） */
  planName: string | null;
  /** 燃料の名称（請求書の表記のまま。例: レギュラーガソリン） */
  fuelName: string | null;
  /** 使用月（'YYYY-MM'。請求書の「◯月分」） */
  usageMonth: string | null;
  /** 使用期間（'YYYY-MM-DD'） */
  periodStart: string | null;
  periodEnd: string | null;
  /** 使用量（料金ではない） */
  amount: number | null;
  /** 使用量の単位（請求書の表記のまま） */
  unit: string | null;
}

/** 請求書 1 枚から読み取った内容 */
export interface InvoiceExtraction {
  kind: InvoiceKind;
  supplierName: string | null;
  /** 小売電気事業者・ガス小売事業者の登録番号（'A0002' の形に揃えたもの） */
  supplierRegistrationNumber: string | null;
  /** 需要場所・供給場所・納品先の住所 */
  supplyAddress: string | null;
  items: InvoiceExtractedItem[];
  /** 読取りで注意すべきこと（一部が読めない、など） */
  warnings: string[];
}

/**
 * 係数の判定。
 *   matched:       候補から選んだ（事業者とメニュー・燃料）
 *   provider_only: 事業者は分かったが、メニューは人が選ぶ（公表メニューが複数あり、料金メニューから決められない）
 *   not_found:     候補に当てはまるものが無い（電気・ガスは代替値、燃料は人が選ぶ）
 *   unavailable:   判定できなかった（候補が無い・判定の AI が失敗した）
 */
export type InvoiceFactorJudgement =
  | { status: 'matched'; label: string; reason: string }
  | { status: 'provider_only'; label: string; reason: string }
  | { status: 'not_found'; reason: string }
  | { status: 'unavailable'; reason: string };

/** 画面に出す明細 */
export interface InvoiceReadingItem {
  /** 明細の番号（1 から） */
  index: number;
  /** フォームに入れるカテゴリ。対象外・判定できない燃料は null */
  energyType: InvoiceEnergyType | null;
  /** 画面の見出し（例: 電気 2026年4月分） */
  title: string;
  /** 対象年月（'YYYY-MM'）。読めなければ null */
  targetMonth: string | null;
  /** フォームの単位に換算した活動量。読めない・換算できなければ null */
  amount: { value: number; unit: string } | null;
  /** 請求書に書かれた使用量（例: 1,234 kWh） */
  printedAmount: string | null;
  /** 料金メニュー・燃料の名称（請求書の表記） */
  planOrFuelName: string | null;
  factor: InvoiceFactorJudgement;
  /** 需要場所の住所から選んだ拠点の候補。決まらなければ null */
  location: { id: string; name: string } | null;
  /** フォームに入れるときに確かめてほしいこと（拠点が決まらない、単位を換算できない、など） */
  notices: string[];
  /** 「フォームで開く」で入れる値。対象外の明細は null */
  prefill: ActivityEntryPrefill | null;
}

/** POST /api/ai/invoice-reading の応答 */
export interface InvoiceReadingResult {
  /** 読み取った帳票（保存済み。フォームや登録した記録に紐づける） */
  evidence: EvidenceFile;
  supplierName: string | null;
  supplyAddress: string | null;
  warnings: string[];
  items: InvoiceReadingItem[];
  /** 読取りに使った提供元とモデル（画面に出す） */
  provider: AiProviderId;
  modelId: string;
}

export type { EntryFactorPrefill };
