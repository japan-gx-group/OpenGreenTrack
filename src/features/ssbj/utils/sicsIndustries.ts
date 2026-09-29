// SICS（SASB の産業分類）の 68 産業と、産業別ガイダンスの参照先（docs/ssbj-r1-scope.md §6）。
// レポートの基本情報の「業種」の選択肢と、該当する巻へのリンクに使う。コードの一覧は DB の check 制約
// （supabase/migrations/20260928154722_ssbj_report_parent_and_industry.sql）と一致させること。
// 巻番号と PDF は SSBJ 事務局による解説資料（2023年10月）。本文は転記せず、リンクで参照する。

export const SICS_SECTORS = [
  { prefix: 'CG', label: '消費財' },
  { prefix: 'EM', label: '採掘及び鉱物加工' },
  { prefix: 'FN', label: '金融' },
  { prefix: 'FB', label: '食品及び飲料' },
  { prefix: 'HC', label: '医療' },
  { prefix: 'IF', label: 'インフラ' },
  { prefix: 'RR', label: '再生可能資源及び代替エネルギー' },
  { prefix: 'RT', label: '資源加工' },
  { prefix: 'SV', label: 'サービス' },
  { prefix: 'TC', label: '技術及び通信' },
  { prefix: 'TR', label: '輸送' },
] as const;

export type SicsIndustry = {
  /** SICS の産業コード（例 RT-IG）。 */
  code: string;
  /** 産業別ガイダンスの巻番号（SSBJ の解説資料の番号）。 */
  volume: number;
  name: string;
};

export const SICS_INDUSTRIES: readonly SicsIndustry[] = [
  { code: 'CG-AA', volume: 1, name: '衣服、装飾品及び履物' },
  { code: 'CG-AM', volume: 2, name: '家電製造' },
  { code: 'CG-BF', volume: 3, name: '建築用製品及び家具' },
  { code: 'CG-EC', volume: 4, name: '電子商取引' },
  { code: 'CG-HP', volume: 5, name: '家庭用及び個人用製品' },
  { code: 'CG-MR', volume: 6, name: '複合型及び専門型小売及び流通' },
  { code: 'EM-CO', volume: 7, name: '石炭事業' },
  { code: 'EM-CM', volume: 8, name: '工事用資材' },
  { code: 'EM-IS', volume: 9, name: '鉄鋼製造業者' },
  { code: 'EM-MM', volume: 10, name: '金属及び鉱業' },
  { code: 'EM-EP', volume: 11, name: '石油及びガス－探査及び生産' },
  { code: 'EM-MD', volume: 12, name: '石油及びガス－中流' },
  { code: 'EM-RM', volume: 13, name: '石油及びガス－精製及びマーケティング' },
  { code: 'EM-SV', volume: 14, name: '石油及びガス－サービス' },
  { code: 'FN-AC', volume: 15, name: '資産運用及び管理業務' },
  { code: 'FN-CB', volume: 16, name: '商業銀行' },
  { code: 'FN-IN', volume: 17, name: '保険' },
  { code: 'FN-IB', volume: 18, name: '投資銀行及び仲介' },
  { code: 'FN-MF', volume: 19, name: '不動産金融' },
  { code: 'FB-AG', volume: 20, name: '農産物' },
  { code: 'FB-AB', volume: 21, name: '酒類' },
  { code: 'FB-FR', volume: 22, name: '食品小売及び流通' },
  { code: 'FB-MP', volume: 23, name: '食肉、家禽及び乳製品' },
  { code: 'FB-NB', volume: 24, name: '清涼飲料' },
  { code: 'FB-PF', volume: 25, name: '加工食品' },
  { code: 'FB-RN', volume: 26, name: '飲食店' },
  { code: 'HC-DR', volume: 27, name: '医薬品小売' },
  { code: 'HC-DY', volume: 28, name: '医療提供' },
  { code: 'HC-DI', volume: 29, name: '医療品流通' },
  { code: 'HC-MC', volume: 30, name: '管理型医療' },
  { code: 'HC-MS', volume: 31, name: '医療機器及び消耗品' },
  { code: 'IF-EU', volume: 32, name: '電力事業者及び発電事業者' },
  { code: 'IF-EN', volume: 33, name: 'エンジニアリング及び工事サービス' },
  { code: 'IF-GU', volume: 34, name: 'ガス事業者及び流通業者' },
  { code: 'IF-HB', volume: 35, name: '住宅建築業' },
  { code: 'IF-RE', volume: 36, name: '不動産' },
  { code: 'IF-RS', volume: 37, name: '不動産サービス' },
  { code: 'IF-WM', volume: 38, name: '廃棄物処理' },
  { code: 'IF-WU', volume: 39, name: '水道事業及びサービス' },
  { code: 'RR-BI', volume: 40, name: 'バイオ燃料' },
  { code: 'RR-FM', volume: 41, name: '森林管理' },
  { code: 'RR-FC', volume: 42, name: '燃料電池及び産業用電池' },
  { code: 'RR-PP', volume: 43, name: 'パルプ及び紙製品' },
  { code: 'RR-ST', volume: 44, name: '太陽光技術及びプロジェクト開発業者' },
  { code: 'RR-WT', volume: 45, name: '風力技術及びプロジェクト開発業者' },
  { code: 'RT-AE', volume: 46, name: '航空宇宙及び防衛' },
  { code: 'RT-CH', volume: 47, name: '化学製品' },
  { code: 'RT-CP', volume: 48, name: '容器及び包装' },
  { code: 'RT-EE', volume: 49, name: '電気及び電子機器' },
  { code: 'RT-IG', volume: 50, name: '工業用機械及び製品' },
  { code: 'SV-CA', volume: 51, name: 'カジノ及びゲーム' },
  { code: 'SV-HL', volume: 52, name: 'ホテル及び宿泊施設' },
  { code: 'SV-LF', volume: 53, name: 'レジャー施設' },
  { code: 'TC-ES', volume: 54, name: 'EMS 及び ODM' },
  { code: 'TC-HW', volume: 55, name: 'ハードウェア' },
  { code: 'TC-IM', volume: 56, name: 'インターネットメディア及びサービス' },
  { code: 'TC-SC', volume: 57, name: '半導体' },
  { code: 'TC-SI', volume: 58, name: 'ソフトウェア及び IT サービス' },
  { code: 'TC-TL', volume: 59, name: '通信サービス' },
  { code: 'TR-AF', volume: 60, name: '航空貨物及びロジスティクス' },
  { code: 'TR-AL', volume: 61, name: '航空会社' },
  { code: 'TR-AP', volume: 62, name: '自動車部品' },
  { code: 'TR-AU', volume: 63, name: '自動車' },
  { code: 'TR-CR', volume: 64, name: 'レンタカー及びカーリース' },
  { code: 'TR-CL', volume: 65, name: 'クルーズ会社' },
  { code: 'TR-MT', volume: 66, name: '海上輸送' },
  { code: 'TR-RA', volume: 67, name: '鉄道輸送' },
  { code: 'TR-RO', volume: 68, name: '道路輸送' },
];

/** 産業別ガイダンス（SSBJ の日本語ページ）。巻の一覧はここから辿れる。 */
export const SSBJ_INDUSTRY_GUIDANCE_INDEX_URL =
  'https://www.ssb-j.jp/jp/activity/standard/y2023/2023-0626/s2.html';

// 解説資料の公開日は巻によって 2 通り（食品及び飲料・インフラ・再生可能資源の巻は 10月25日）。
const PUBLISHED_ON_OCTOBER_25 = new Set(['FB', 'IF', 'RR']);

export const findSicsIndustry = (code: string): SicsIndustry | undefined =>
  SICS_INDUSTRIES.find(industry => industry.code === code);

export const isSicsIndustryCode = (value: unknown): value is string =>
  typeof value === 'string' && findSicsIndustry(value) !== undefined;

/** 該当する巻の解説資料（PDF）の URL。 */
export const sicsGuidanceUrl = (industry: SicsIndustry): string => {
  const volume = String(industry.volume).padStart(2, '0');
  const date = PUBLISHED_ON_OCTOBER_25.has(industry.code.slice(0, 2)) ? '20231025' : '20231020';
  return `https://www.ssb-j.jp/jp/wp-content/uploads/sites/6/s2-${volume}_${date}.pdf`;
};

/** 表示用（例「RT-IG 工業用機械及び製品」）。一覧に無いコードはそのまま返す。 */
export const formatSicsIndustry = (code: string): string => {
  const industry = findSicsIndustry(code);
  return industry ? `${industry.code} ${industry.name}` : code;
};
