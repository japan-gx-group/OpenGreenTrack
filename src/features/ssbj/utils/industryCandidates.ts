// 業種を起点にしたリスク・機会の候補（試行版）と、候補への判断の正規化・検証（純関数）。
//
// 業種は、SSBJ レポートの基本情報の業種（SICS の産業コード。ssbj_reports."industryCode"）を起点にする。
// OGT の組織設定の業種（organizations."industrySector"。自由入力）は使わない（どちらを正本にするかは未決。docs/ssbj-spec.md §13）。
// 候補は SICS のセクター（コードの先頭 2 文字）ごとと、全業種に共通のものを用意する。産業ごとの候補はまだ無い。
//
// 候補は検討の出発点で、リスク・機会・該当性・重要性を確定しない。採用すると、名称・区分・リスクの種類・関連する項目だけを
// 入れた登録フォームを開き、説明・時間軸は未入力のままにする（利用者が自社の事実で埋める）。
// 候補と関連する項目は、チームが作った試行版で、外部の監修は受けていない（docs/ssbj-r1-scope.md §8）。
// 産業別ガイダンス（sicsIndustries.ts の sicsGuidanceUrl）で、自社の業種に当てはまるかを利用者が確かめる。
// 関連する項目は要求項目マスター（暫定版）の項目 ID。マスターの ID が変わったときは、ここも合わせて直す。

import type {
  SsbjLinkTarget,
  SsbjRiskCandidateDecision,
  SsbjRiskCandidateDecisionKind,
  SsbjRiskOpportunityKind,
  SsbjRiskType,
} from '../types';
import { SSBJ_RISK_CANDIDATE_DECISIONS } from '../types';
import { EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES, type SsbjRiskOpportunityFormValues } from './riskOpportunity';
import { SICS_SECTORS, findSicsIndustry } from './sicsIndustries';

/** 候補の定義の版。候補の ID・内容を変えたら上げる。 */
export const SSBJ_INDUSTRY_CANDIDATE_VERSION = 'r2-trial-1';

/** 判断の理由の最大文字数。 */
export const SSBJ_CANDIDATE_REASON_MAX_LENGTH = 1000;

type SicsSectorPrefix = (typeof SICS_SECTORS)[number]['prefix'];

export type SsbjIndustryCandidate = {
  /** 候補 ID（`<common か セクター>.<英小文字・数字・_>`）。判断の保存に使う。 */
  id: string;
  /** 'common' は全業種に共通。それ以外は SICS のセクター（コードの先頭 2 文字）。 */
  scope: 'common' | SicsSectorPrefix;
  kind: SsbjRiskOpportunityKind;
  /** リスクの種類（機会は null）。 */
  riskType: SsbjRiskType | null;
  title: string;
  /** 候補にした理由（試行版の考え方。開示文ではない）。 */
  basis: string;
  /** 関連する要求項目マスターの項目。 */
  linkTargets: SsbjLinkTarget[];
};

export const SSBJ_CANDIDATE_ID_PATTERN = /^(common|[a-z]{2})\.[a-z0-9_]+$/;

export const SSBJ_INDUSTRY_CANDIDATES: readonly SsbjIndustryCandidate[] = [
  // 全業種に共通
  {
    id: 'common.carbon_pricing', scope: 'common', kind: 'risk', riskType: 'transition',
    title: '炭素価格・排出規制の導入による操業コストの上昇',
    basis: 'スコープ 1・2 の排出がある企業では、炭素税・排出量取引などの導入が費用に影響しうるため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.internal_carbon_price'],
  },
  {
    id: 'common.energy_price', scope: 'common', kind: 'risk', riskType: 'transition',
    title: '電力・燃料価格の上昇',
    basis: 'エネルギーを使うすべての企業で、調達価格の変動が費用に影響しうるため。',
    linkTargets: ['strategy.business_model_impact', 'strategy.response_plans'],
  },
  {
    id: 'common.customer_requests', scope: 'common', kind: 'risk', riskType: 'transition',
    title: '取引先からの排出量の開示・削減の要請',
    basis: 'サプライチェーンの排出（取引先から見たスコープ 3）の把握・削減を求められる場面が増えているため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.ghg_targets'],
  },
  {
    id: 'common.acute_physical', scope: 'common', kind: 'risk', riskType: 'physical',
    title: '豪雨・洪水・台風による拠点の被災と操業停止',
    basis: '拠点を持つすべての企業で、急性の物理的リスクが操業・資産に影響しうるため。',
    linkTargets: ['strategy.business_model_impact', 'risk_management.risk_process'],
  },
  {
    id: 'common.chronic_heat', scope: 'common', kind: 'risk', riskType: 'physical',
    title: '気温の上昇による空調費の増加・作業環境の悪化',
    basis: '慢性の物理的リスクとして、拠点の運営費と従業員の安全に影響しうるため。',
    linkTargets: ['strategy.business_model_impact'],
  },
  {
    id: 'common.efficiency', scope: 'common', kind: 'opportunity', riskType: null,
    title: '省エネルギー・再生可能エネルギーの導入による費用の削減',
    basis: 'エネルギー効率の改善は、排出の削減と費用の削減を同時にもたらしうるため。',
    linkTargets: ['strategy.response_plans', 'metrics_targets.targets'],
  },
  // セクター別
  {
    id: 'cg.low_carbon_products', scope: 'CG', kind: 'opportunity', riskType: null,
    title: '環境負荷の低い製品への需要の拡大',
    basis: '消費財では、消費者・小売の購買基準の変化が売上に影響しうるため。',
    linkTargets: ['strategy.business_model_impact', 'strategy.response_plans'],
  },
  {
    id: 'cg.supply_disruption', scope: 'CG', kind: 'risk', riskType: 'physical',
    title: '原材料の産地の気候変化による調達の不安定化',
    basis: '消費財では、農産物・繊維などの原材料の産地が気候の影響を受けうるため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.scope3_data'],
  },
  {
    id: 'em.process_emissions', scope: 'EM', kind: 'risk', riskType: 'transition',
    title: '排出の多い工程への規制の強化',
    basis: '採掘・鉱物加工では、燃焼・工程からの排出が多く、規制の影響を受けやすいため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.ghg_targets'],
  },
  {
    id: 'em.stranded_assets', scope: 'EM', kind: 'risk', riskType: 'transition',
    title: '需要の減少による設備・埋蔵資源の価値の低下',
    basis: '採掘・鉱物加工では、脱炭素への移行で既存の設備・資源の使用期間が短くなりうるため。',
    linkTargets: ['strategy.business_model_impact'],
  },
  {
    id: 'fn.financed_emissions', scope: 'FN', kind: 'risk', riskType: 'transition',
    title: '投融資先の移行リスクによる信用・投資の損失',
    basis: '金融では、投融資先の排出・移行の状況が自社の資産の価値に影響しうるため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.other_metrics'],
  },
  {
    id: 'fn.green_finance', scope: 'FN', kind: 'opportunity', riskType: null,
    title: '脱炭素に向けた資金需要への商品・サービスの提供',
    basis: '金融では、移行に必要な投資への資金の提供が事業の機会になりうるため。',
    linkTargets: ['strategy.response_plans'],
  },
  {
    id: 'fb.crop_yield', scope: 'FB', kind: 'risk', riskType: 'physical',
    title: '気候の変化による原材料（農産物）の収量・品質の低下',
    basis: '食品及び飲料では、原材料の多くが農産物で、気温・降水の変化の影響を受けるため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.scope3_data'],
  },
  {
    id: 'fb.cold_chain_energy', scope: 'FB', kind: 'risk', riskType: 'transition',
    title: '冷蔵・冷凍の物流と保管にかかるエネルギー費用の上昇',
    basis: '食品及び飲料では、温度管理にエネルギーを多く使うため。',
    linkTargets: ['strategy.business_model_impact'],
  },
  {
    id: 'hc.facility_continuity', scope: 'HC', kind: 'risk', riskType: 'physical',
    title: '災害時の医療・供給の継続への影響',
    basis: '医療では、拠点の被災・停電が供給の継続に直結するため。',
    linkTargets: ['strategy.business_model_impact', 'risk_management.risk_process'],
  },
  {
    id: 'if.climate_resilient_infrastructure', scope: 'IF', kind: 'opportunity', riskType: null,
    title: '気候変化に備えたインフラ・建物への需要',
    basis: 'インフラでは、防災・省エネルギーの性能を高めた設備・建物の需要が増えうるため。',
    linkTargets: ['strategy.response_plans'],
  },
  {
    id: 'if.asset_damage', scope: 'IF', kind: 'risk', riskType: 'physical',
    title: '異常気象による設備・建物の損傷と修繕費の増加',
    basis: 'インフラでは、屋外の設備・長く使う資産が多く、物理的リスクの影響が大きいため。',
    linkTargets: ['strategy.business_model_impact'],
  },
  {
    id: 'rr.policy_support', scope: 'RR', kind: 'opportunity', riskType: null,
    title: '再生可能エネルギー・代替素材への政策支援と需要の拡大',
    basis: '再生可能資源及び代替エネルギーでは、移行の政策が事業の追い風になりうるため。',
    linkTargets: ['strategy.business_model_impact', 'strategy.response_plans'],
  },
  {
    id: 'rr.resource_availability', scope: 'RR', kind: 'risk', riskType: 'physical',
    title: '気候の変化による原料（森林・作物）の供給量の変動',
    basis: '再生可能資源では、原料の生育が気候の影響を受けるため。',
    linkTargets: ['strategy.business_model_impact'],
  },
  {
    id: 'rt.energy_intensive_process', scope: 'RT', kind: 'risk', riskType: 'transition',
    title: 'エネルギーを多く使う製造工程の費用の上昇',
    basis: '資源加工では、製造工程の電力・燃料の使用が多く、エネルギー価格・炭素価格の影響を受けやすいため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.internal_carbon_price'],
  },
  {
    id: 'rt.efficient_products', scope: 'RT', kind: 'opportunity', riskType: null,
    title: '使用時の排出が少ない製品・部材への需要の拡大',
    basis: '資源加工では、顧客の排出削減に役立つ製品・部材の需要が増えうるため。',
    linkTargets: ['strategy.response_plans'],
  },
  {
    id: 'sv.visitor_demand', scope: 'SV', kind: 'risk', riskType: 'physical',
    title: '気象の変化による来訪者の減少',
    basis: 'サービスでは、宿泊・レジャーの需要が天候・季節の変化の影響を受けるため。',
    linkTargets: ['strategy.business_model_impact'],
  },
  {
    id: 'tc.data_center_energy', scope: 'TC', kind: 'risk', riskType: 'transition',
    title: 'データセンター・設備の電力費用の上昇',
    basis: '技術及び通信では、設備の稼働に多くの電力を使うため。',
    linkTargets: ['strategy.business_model_impact', 'strategy.response_plans'],
  },
  {
    id: 'tc.decarbonization_solutions', scope: 'TC', kind: 'opportunity', riskType: null,
    title: '排出の見える化・削減を支える製品・サービスへの需要',
    basis: '技術及び通信では、顧客の排出管理・省エネルギーを支える製品・サービスが機会になりうるため。',
    linkTargets: ['strategy.response_plans'],
  },
  {
    id: 'tr.fuel_regulation', scope: 'TR', kind: 'risk', riskType: 'transition',
    title: '燃費・排出の規制の強化と燃料費の上昇',
    basis: '輸送では、燃料の燃焼による排出が多く、規制・燃料価格の影響を受けやすいため。',
    linkTargets: ['strategy.business_model_impact', 'metrics_targets.ghg_targets'],
  },
  {
    id: 'tr.electrification', scope: 'TR', kind: 'opportunity', riskType: null,
    title: '電動化・低炭素燃料への移行による新たな需要',
    basis: '輸送では、車両・輸送手段の転換が新たな製品・サービスの需要を生みうるため。',
    linkTargets: ['strategy.response_plans'],
  },
];

export const findSsbjIndustryCandidate = (candidateId: string): SsbjIndustryCandidate | undefined =>
  SSBJ_INDUSTRY_CANDIDATES.find(candidate => candidate.id === candidateId);

export type SsbjIndustryCandidateGroups = {
  /** 業種（SICS の産業コード）。未選択・一覧に無いコードなら null。 */
  industryCode: string | null;
  /** 業種のセクターの候補（業種が無ければ空）。 */
  industry: SsbjIndustryCandidate[];
  /** 全業種に共通の候補。 */
  common: SsbjIndustryCandidate[];
};

/** 業種の候補と、全業種に共通の候補。業種が未選択・一覧に無いコードなら、業種の候補は出さない。 */
export const ssbjIndustryCandidatesFor = (industryCode: string | null): SsbjIndustryCandidateGroups => {
  const industry = industryCode ? findSicsIndustry(industryCode) : undefined;
  const sector = industry?.code.slice(0, 2);
  return {
    industryCode: industry?.code ?? null,
    industry: sector ? SSBJ_INDUSTRY_CANDIDATES.filter(candidate => candidate.scope === sector) : [],
    common: SSBJ_INDUSTRY_CANDIDATES.filter(candidate => candidate.scope === 'common'),
  };
};

/**
 * 候補を採用するときの登録フォームの初期値。名称・区分・リスクの種類・関連する項目だけを入れ、
 * 説明・時間軸・内部メモは未入力のままにする（候補から自社の事実を決めない）。利用者はこの後に修正して登録する。
 */
export const ssbjRiskFormValuesFromCandidate = (candidate: SsbjIndustryCandidate): SsbjRiskOpportunityFormValues => ({
  ...EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES,
  kind: candidate.kind,
  title: candidate.title,
  riskType: candidate.riskType ?? 'unanswered',
  linkTargets: [...candidate.linkTargets],
});

/** 判断の保存内容（更新日時は DB が決める）。 */
export type SsbjRiskCandidateDecisionInput = Omit<SsbjRiskCandidateDecision, 'updatedAt'>;

const isDecisionKind = (value: string): value is SsbjRiskCandidateDecisionKind =>
  (SSBJ_RISK_CANDIDATE_DECISIONS as readonly string[]).includes(value);

/** 判断を保存用に整える（理由の前後の空白を落とし、空なら null）。 */
export const normalizeSsbjRiskCandidateDecision = (
  input: SsbjRiskCandidateDecisionInput,
): SsbjRiskCandidateDecisionInput => {
  const reason = input.reason?.trim() ?? '';
  return { ...input, reason: reason === '' ? null : reason };
};

/** 正規化済みの判断を検証する。問題が無ければ空配列。 */
export const validateSsbjRiskCandidateDecision = (input: SsbjRiskCandidateDecisionInput): string[] => {
  const errors: string[] = [];
  if (!SSBJ_CANDIDATE_ID_PATTERN.test(input.candidateId) || !findSsbjIndustryCandidate(input.candidateId)) {
    errors.push('候補の一覧に無い候補です');
  }
  if (!isDecisionKind(input.decision)) errors.push('判断の種類が正しくありません');
  if (input.decision === 'excluded' && input.reason === null) {
    errors.push('除外する理由を入力してください（後から判断の根拠を確かめるため）');
  }
  if (input.decision === 'adopted' && input.riskOpportunityId === null) {
    errors.push('採用した候補は、登録したリスク・機会とつなげてください');
  }
  if ((input.reason?.length ?? 0) > SSBJ_CANDIDATE_REASON_MAX_LENGTH) {
    errors.push(`理由は${SSBJ_CANDIDATE_REASON_MAX_LENGTH}文字以内で入力してください`);
  }
  return errors;
};

/** 候補の状態（画面の表示用）。採用したリスク・機会が削除されていれば adopted_removed。 */
export type SsbjCandidateStatus = 'undecided' | 'adopted' | 'adopted_removed' | 'excluded';

export const ssbjCandidateStatus = (
  decision: SsbjRiskCandidateDecision | undefined,
  existingRiskIds: ReadonlySet<string>,
): SsbjCandidateStatus => {
  if (!decision) return 'undecided';
  if (decision.decision === 'excluded') return 'excluded';
  return decision.riskOpportunityId && existingRiskIds.has(decision.riskOpportunityId) ? 'adopted' : 'adopted_removed';
};
