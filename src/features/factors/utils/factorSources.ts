import { Leaf, Activity, Scale, Zap, Settings, type LucideIcon } from 'lucide-react';
import type { EmissionFactor } from '../services/factorService';

// 標準係数ソースのメタ情報。画面の「標準係数ソース」カードと
// 「ソース詳細を確認」モーダルの両方で参照する単一の正本。
// name は emission_factors.source（factorService の日本語ラベル）と一致させること。
//
// 参照元URLはここにハードコードしない。1ソースが複数の公表資料にまたがる
// （例: 環境省 = SHK制度の代替値 と Scope3排出原単位データベース）ため、
// 実データ（emission_factors.sourceDocumentName / sourceUrl）から導出する。
export type FactorSourceMeta = {
  name: string;
  icon: LucideIcon;
  /** ソースの説明（どんな係数か・監査上の位置づけ） */
  description: string;
  /**
   * 外部の公的出典を持たない社内ソースか（自社設定）。
   * アイコンの淡色表示に使う。「公的ソースか社内ソースか」はソースの性質であり
   * 登録データの有無で変わらないため、係数側からは導出せずメタとして持つ。
   */
  isInternal?: boolean;
};

export const STANDARD_SOURCES: FactorSourceMeta[] = [
  {
    name: '環境省',
    icon: Leaf,
    description:
      '算定・報告・公表制度（SHK制度）の算定方法・排出係数一覧や、サプライチェーン排出量算定の基本ガイドラインなど、環境省が公表する公的係数の出典。',
  },
  {
    name: '経済産業省',
    icon: Activity,
    description:
      '資源エネルギー庁による事業者別排出係数の算出・公表。電気・ガス事業者別排出係数の一次情報を提供する。',
  },
  {
    name: '温対法',
    icon: Scale,
    description:
      '地球温暖化対策推進法に基づく算定・報告・公表制度。燃料（ガソリン・軽油・都市ガス等）の単位発熱量ベースの排出係数の根拠。',
  },
  {
    name: '事業者別排出係数',
    icon: Zap,
    description:
      '特定排出者の温室効果ガス排出量算定用に毎年度公表される、電気・ガス・熱供給事業者ごとの基礎排出係数・調整後排出係数の一覧。',
  },
  {
    name: '自社設定',
    icon: Settings,
    description:
      '自社またはサプライヤー実測値に基づき登録したカスタム係数。公的な外部出典は持たず、社内の算定根拠に基づく。',
    isInternal: true,
  },
];

/** ソース配下で実際に使われている出典（資料名 + URL）1件分。 */
export type FactorSourceDocument = {
  /** 出典資料名。未設定の係数（自社設定など）は undefined。 */
  documentName?: string;
  /** 出典資料の公開URL。未設定ならリンクにしない。 */
  url?: string;
  /** この出典を持つ係数の件数。 */
  count: number;
};

/** ソースのメタ情報に、登録係数から導出した出典一覧・件数を足したもの。 */
export type FactorSourceSummary = FactorSourceMeta & {
  /** ソース配下の登録係数の総件数。必ず1件以上（0件のソースは返さない）。 */
  totalCount: number;
  /** distinct な（資料名, URL）の組。件数の多い順、同数なら資料名順。1件以上。 */
  documents: FactorSourceDocument[];
};

/** 空文字・空白のみは「未設定」として扱う。 */
const normalize = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * 新しいタブで開いてよい絶対URLか。
 * 出典URLはCSVインポート（factorCsvImport.ts）経由の自由入力を含み、
 * スキーム無しの値（例: www.env.go.jp/...）をそのまま href にすると
 * アプリのオリジンからの相対リンクになって壊れるため、http(s) のみリンク化する。
 */
export const isExternalHttpUrl = (url: string | undefined): boolean =>
  /^https?:\/\//i.test(url ?? '');

/**
 * 標準係数ソースごとに、登録済み係数から出典を集計する。
 *
 * distinct な（sourceDocumentName, sourceUrl）の組を件数付きで返す。
 * 参照元リンクをソース定義にハードコードせず実データから導出するため、
 * 同一URLの重複表示や、複数資料にまたがるソース（環境省など）の取りこぼしが構造的に起きない。
 *
 * 登録0件のソースは返さない。参照元を開いても該当係数が無く出典を誤認させるため、
 * 「標準係数ソース」カードと「標準係数ソースの詳細」モーダルの双方で非表示にする。
 * 戻り値が空になるのは「本当に0件」だけでなく読込中・取得失敗のときも同じなので、
 * 呼び出し側が状況に応じた案内文を出し分けること。
 */
export const summarizeFactorSources = (
  factors: Pick<EmissionFactor, 'source' | 'sourceDocument' | 'sourceUrl'>[],
  sources: FactorSourceMeta[] = STANDARD_SOURCES,
): FactorSourceSummary[] => {
  return sources.flatMap((source) => {
    const relatedFactors = factors.filter((factor) => factor.source === source.name);
    if (relatedFactors.length === 0) {
      return [];
    }

    const documentsByKey = new Map<string, FactorSourceDocument>();

    for (const factor of relatedFactors) {
      const documentName = normalize(factor.sourceDocument);
      const url = normalize(factor.sourceUrl);
      // 資料名とURLの組でグルーピングする。どちらも未設定の係数は「出典なし」の1グループにまとまる。
      const key = JSON.stringify([documentName ?? null, url ?? null]);
      const existing = documentsByKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        documentsByKey.set(key, { documentName, url, count: 1 });
      }
    }

    const documents = Array.from(documentsByKey.values()).sort((a, b) => {
      // 出典未設定（資料名もURLも無い）は末尾に回す
      const aUnsourced = !a.documentName && !a.url;
      const bUnsourced = !b.documentName && !b.url;
      if (aUnsourced !== bUnsourced) {
        return aUnsourced ? 1 : -1;
      }
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return (a.documentName ?? a.url ?? '').localeCompare(b.documentName ?? b.url ?? '', 'ja');
    });

    return [{ ...source, totalCount: relatedFactors.length, documents }];
  });
};
