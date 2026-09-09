import type { EmissionFactor } from '../services/factorService';

// カスタム係数として登録・絞り込みできるエネルギー種別・活動カテゴリの候補。
// Scope3積上げ（scope3_activity）はここに追加しないこと。IDEA 係数は idea_factors で
// 管理し、係数作成UI・CSVの候補から除外する（docs/idea-scope3-spec.md §3.5）。
export const energyTypeOptions: EmissionFactor['energyType'][] = [
  '電気', 'ガス', '熱', 'A重油', '軽油', '水道', '輸送', '出張',
  'ガソリン', '灯油', '原油', 'ナフサ', 'ジェット燃料油', 'LPG', 'LNG', '天然ガス', '石炭',
  '燃料（その他）', '廃棄物', '通勤', '購入した製品・サービス',
];
