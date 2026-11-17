// TNFD 開示レポート R1 の要求項目マスター: 要求 ID・記載ガイド・提言のラベル・入力先の対応（docs/tnfd-spec.md §3・別表A）。
//
// ⚠️ 暫定版。提言のラベル（Governance A など）と要約は PL の整理で、一次情報（Recommendations of the TNFD,
// October 2026）との突き合わせは専門家（生物多様性）の画面レビューで行う。確定までは ID を変えうるため、保存版に残すときは
// TNFD_REQUIREMENT_MASTER_VERSION も一緒に残すこと。
//
// - 要約・記載ガイドはこの試行版の言葉で書いたもので、提言の本文ではない（本文は転載しない。docs/tnfd-spec.md §1）。
// - 一般要件（章にまたがる要求）は sectionId を null にし、答える場所（文章の項目・基本情報・拠点）を inputTarget で示す。
// - ISSB 公開草案（ISSB/ED/2026/1）の要求（REQ-ISSB-*）は、草案の本文（第 1〜38 項）を読んで項番号を付けた。
//   TNFD の提言と同じ趣旨の要求は TNFD の項目で一緒に答え、TNFD に対応物が無い要求だけを別の見出しの受け皿（issb_placeholder）で出す
//   （docs/tnfd-spec.md §10）。草案の本文は転載しない。最終化で項番号が変わりうるので、変わったら参照だけを直す（ID は変えない）。
// - 記載例は架空の会社の文例で、実在の企業・開示とは無関係。

import type {
  TnfdItemId,
  TnfdNarrativeItem,
  TnfdParagraphReference,
  TnfdRequirement,
  TnfdRequirementId,
  TnfdSectionId,
  TnfdStandardCode,
} from '../types';
import { sectionOfItem } from './ids';

/** マスターの版。ID や入力先を変えたら上げる（保存版にどの版のマスターで作ったかを残すため）。 */
export const TNFD_REQUIREMENT_MASTER_VERSION = 'r1-provisional-2';

/** 提言・段落を確認した文書の版。 */
export const TNFD_REFERENCE_STANDARD_DOCUMENTS: Record<
  TnfdStandardCode,
  { name: string; shortLabel: string; version: string }
> = {
  TNFD: {
    name: 'Recommendations of the Taskforce on Nature-related Financial Disclosures',
    shortLabel: 'TNFD 提言',
    version: 'October 2026（2023年9月 v1.0 の改訂版。14 提言の数と構成は不変、コア指標の確定と環境犯罪の一般要件を追加）',
  },
  ISSB: {
    name: 'IFRS Sustainability Disclosure Practice Statement 1 Nature-related Disclosures（公開草案）',
    shortLabel: 'ISSB 草案',
    version: 'ISSB/ED/2026/1（2026年10月公表。コメント期限 2027年2月19日。最終化未定・準拠は任意。SSBJ が日本語仮訳を掲載）',
  },
};

// 試行版に共通の注意。
const TRIAL_NOTE =
  '社内確認用の試行版なので、「準拠している」「提出済み」と読める表現は書かない。未着手の内容は未入力のままにし、「なし」「該当しない」と書かない。';

export const TNFD_REQUIREMENTS: readonly TnfdRequirement[] = [
  // ---- ガバナンス ----
  {
    id: 'REQ-TNFD-001',
    sectionId: 'governance',
    summary: '自然関連の依存・インパクト・リスク・機会を取締役会がどう監督しているか',
    references: [{ standard: 'TNFD', paragraphs: 'Governance A' }],
    inputTarget: { kind: 'narrative', itemId: 'governance.board_oversight' },
    guide: `監督する機関の名称（取締役会・委員会）、報告を受ける頻度、監督の対象（方針・目標・リスク管理）を書く。氏名ではなく役職・機関名で書く。気候関連の監督と同じ機関なら、その旨を書いてよい。${TRIAL_NOTE}`,
  },
  {
    id: 'REQ-TNFD-002',
    sectionId: 'governance',
    summary: '自然関連の課題を評価・管理する経営者の役割',
    references: [{ standard: 'TNFD', paragraphs: 'Governance B' }],
    inputTarget: { kind: 'narrative', itemId: 'governance.management_role' },
    guide: '担当する役員・部署、取締役会への報告の経路、担当部署と事業部門の関係を書く。',
  },
  {
    id: 'REQ-TNFD-003',
    sectionId: 'governance',
    summary: '人権方針と、先住民族・地域社会・影響を受けるステークホルダーとの関わり',
    references: [{ standard: 'TNFD', paragraphs: 'Governance C' }],
    inputTarget: { kind: 'narrative', itemId: 'governance.human_rights_engagement' },
    guide: '人権方針の有無と内容、対話の相手と方法、取締役会・経営者がその結果をどう監督しているかを書く。対話をしていない場合は「していない」と書く（非該当ではなく回答として扱う）。',
  },
  // ---- 戦略 ----
  {
    id: 'REQ-TNFD-004',
    sectionId: 'strategy',
    summary: '短期・中期・長期で特定した自然関連の依存・インパクト・リスク・機会',
    references: [{ standard: 'TNFD', paragraphs: 'Strategy A' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.dependencies_impacts_risks_opportunities' },
    guide: '依存（事業が自然から受けている便益）、インパクト（事業が自然に与える影響）、そこから生じるリスクと機会を、時間軸（短期・中期・長期の定義も）とともに書く。R1 では文章で受け、種類・時間軸・財務影響の構造化はしない。',
  },
  {
    id: 'REQ-TNFD-005',
    sectionId: 'strategy',
    summary: '自然関連の課題が事業モデル・バリューチェーン・戦略・財務計画に与えた影響と、移行計画・分析',
    references: [{ standard: 'TNFD', paragraphs: 'Strategy B' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.business_model_effects' },
    guide: '現在の影響と見込まれる影響を分けて書く。財務への影響は金額で書けるものだけ書き、推計の前提を添える。',
  },
  {
    id: 'REQ-TNFD-006',
    sectionId: 'strategy',
    summary: '自然関連のリスク・機会に対する戦略のレジリエンス（シナリオ分析を含む）',
    references: [{ standard: 'TNFD', paragraphs: 'Strategy C' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.resilience' },
    guide: '戦略がどの程度持ちこたえられるかの評価と、使ったシナリオの概要を書く。シナリオ分析をしていない場合は「していない」と書く。',
  },
  {
    id: 'REQ-TNFD-007',
    sectionId: 'strategy',
    summary: '直接操業と、可能なら上流・下流のバリューチェーンで、センシティブロケーションにある拠点',
    references: [{ standard: 'TNFD', paragraphs: 'Strategy D' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.priority_locations' },
    guide: '該当する拠点の一覧は「拠点の自然関連情報」の画面で記録し、ここにはその判定の考え方（どの基準でセンシティブと判断したか）と、一覧の読み方を書く。該当拠点が無い場合は、判定の根拠を書いたうえで「該当なし」と書く。',
  },
  // ---- リスクとインパクトの管理 ----
  {
    id: 'REQ-TNFD-008',
    sectionId: 'risk_impact_management',
    summary: '直接操業における自然関連の依存・インパクト・リスク・機会の特定・評価・優先順位付けのプロセス',
    references: [{ standard: 'TNFD', paragraphs: 'Risk & Impact Management A(i)' }],
    inputTarget: { kind: 'narrative', itemId: 'risk_impact_management.direct_operations_process' },
    guide: '使った手法（LEAP か同等の社内プロセスか）、評価の範囲、優先順位の付け方を書く。LEAP は任意の評価手法なので、使っていなくてもよい。',
  },
  {
    id: 'REQ-TNFD-009',
    sectionId: 'risk_impact_management',
    summary: '上流・下流のバリューチェーンにおける同プロセス',
    references: [{ standard: 'TNFD', paragraphs: 'Risk & Impact Management A(ii)' }],
    inputTarget: { kind: 'narrative', itemId: 'risk_impact_management.value_chain_process' },
    guide: '調達先・販売先のどこまでを対象にしたか、データの入手方法、対象にしていない範囲とその理由を書く。',
  },
  {
    id: 'REQ-TNFD-010',
    sectionId: 'risk_impact_management',
    summary: '自然関連の依存・インパクト・リスク・機会を管理するプロセス',
    references: [{ standard: 'TNFD', paragraphs: 'Risk & Impact Management B' }],
    inputTarget: { kind: 'narrative', itemId: 'risk_impact_management.management_process' },
    guide: '特定したリスクへの対応（回避・低減・移転・受容）と、機会を事業に取り込む仕組みを書く。',
  },
  {
    id: 'REQ-TNFD-011',
    sectionId: 'risk_impact_management',
    summary: '上記のプロセスが全社的なリスク管理にどう組み込まれているか',
    references: [{ standard: 'TNFD', paragraphs: 'Risk & Impact Management C' }],
    inputTarget: { kind: 'narrative', itemId: 'risk_impact_management.integration' },
    guide: '全社のリスク管理の枠組み（委員会・規程）の中で自然関連がどう扱われるかを書く。独立して扱っている場合はその旨を書く。',
  },
  // ---- 指標と目標 ----
  {
    id: 'REQ-TNFD-012',
    sectionId: 'metrics_targets',
    summary: '自然関連のリスク・機会を評価・管理するために使う指標',
    references: [{ standard: 'TNFD', paragraphs: 'Metrics & Targets A' }],
    inputTarget: { kind: 'narrative', itemId: 'metrics_targets.risk_opportunity_metrics' },
    guide: 'リスク・機会の大きさを測るのに使っている指標（脆弱な資産の割合など）を書く。数値はコア指標の画面で入力し、ここには選んだ理由と算定の考え方を書く。',
  },
  {
    id: 'REQ-TNFD-013',
    sectionId: 'metrics_targets',
    summary: '自然への依存・インパクトを評価・管理するために使う指標（GHG 排出量を含む）',
    references: [{ standard: 'TNFD', paragraphs: 'Metrics & Targets B' }],
    inputTarget: { kind: 'narrative', itemId: 'metrics_targets.dependency_impact_metrics' },
    guide: 'GHG 排出量は OGT の算定結果を「コア指標」の画面で採用する（手で書き写さない）。GHG 以外の指標（水・廃棄物・土地利用など）は、数値を持っているものだけコア指標の画面で入力し、持っていない指標はその旨を書く。',
  },
  {
    id: 'REQ-TNFD-014',
    sectionId: 'metrics_targets',
    summary: '自然関連の依存・インパクト・リスク・機会を管理するための目標と、その実績',
    references: [{ standard: 'TNFD', paragraphs: 'Metrics & Targets C' }],
    inputTarget: { kind: 'narrative', itemId: 'metrics_targets.targets' },
    guide: '目標の内容、基準年、達成状況を書く。GHG の削減目標は OGT の削減目標の設定を参照してよい。目標を設定していない場合は「設定していない」と書く。',
  },
  // ---- 一般要件（章にまたがる） ----
  {
    id: 'REQ-TNFD-015',
    sectionId: null,
    summary: '重要性の判断をどの考え方で行ったか',
    references: [{ standard: 'TNFD', paragraphs: 'General requirement: application of materiality' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.materiality_approach' },
    guide: '財務的な重要性だけで判断したか、自然へのインパクトの重要性も含めたか（ダブルマテリアリティ）を書く。',
  },
  {
    id: 'REQ-TNFD-016',
    sectionId: null,
    summary: '開示の対象範囲（組織・事業・バリューチェーンのどこまでか）',
    references: [{ standard: 'TNFD', paragraphs: 'General requirement: scope of disclosures' }],
    inputTarget: { kind: 'basic_info' },
    guide: 'レポートの基本情報の「対象範囲」に書く。財務報告の範囲と違う場合は、その理由も書く。',
  },
  {
    id: 'REQ-TNFD-017',
    sectionId: null,
    summary: '自然関連の課題が生じている場所（ロケーション）',
    references: [{ standard: 'TNFD', paragraphs: 'General requirement: location' }],
    inputTarget: { kind: 'location' },
    guide: '拠点の自然関連情報の画面で、拠点ごとに住所・緯度経度・センシティブロケーション該当有無を記録する。緯度経度は任意。',
  },
  {
    id: 'REQ-TNFD-018',
    sectionId: null,
    summary: '気候関連など他のサステナビリティ開示との統合',
    references: [{ standard: 'TNFD', paragraphs: 'General requirement: integration with other sustainability-related disclosures' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.integration_with_other_disclosures' },
    guide: 'SSBJ の気候関連開示と共通する記載（ガバナンス・リスク管理）がある場合は、どこが共通でどこが自然固有かを書く。',
  },
  {
    id: 'REQ-TNFD-019',
    sectionId: null,
    summary: '短期・中期・長期の時間軸の定義',
    references: [{ standard: 'TNFD', paragraphs: 'General requirement: time horizons' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.time_horizons' },
    guide: '各時間軸が何年までかを書く。気候関連開示と同じ定義なら、その旨を書く。',
  },
  {
    id: 'REQ-TNFD-020',
    sectionId: null,
    summary: '先住民族・地域社会・影響を受けるステークホルダーとの関わり',
    references: [{ standard: 'TNFD', paragraphs: 'General requirement: engagement with Indigenous Peoples, Local Communities and affected stakeholders' }],
    inputTarget: { kind: 'narrative', itemId: 'governance.human_rights_engagement' },
    guide: 'ガバナンス C の項目と同じ文章で答える（二重に書かない）。',
  },
  {
    id: 'REQ-TNFD-021',
    sectionId: null,
    summary: '環境犯罪に関する課題の検討（October 2026 版で追加された実施ガイダンス）',
    references: [{ standard: 'TNFD', paragraphs: 'General requirements: environmental crime (October 2026)' }],
    inputTarget: { kind: 'notice' },
    guide: 'R1 では専用の項目を設けず、各章の「企業固有の補足」で触れる。専用項目を置くかは専門家の判断待ち（docs/tnfd-spec.md U-3）。',
  },
  // ---- ISSB 公開草案（ISSB/ED/2026/1）の要求（任意。項番号は草案の本文で確認） ----
  {
    id: 'REQ-ISSB-001',
    sectionId: null,
    summary: '資産・活動の所在地と、センシティブな場所にあたるかの識別（拠点ごとの記録）',
    references: [{ standard: 'ISSB', paragraphs: '第10項(a)・第26項(b)(ii)' }],
    inputTarget: { kind: 'location' },
    guide: '拠点の自然関連情報の画面で受ける（TNFD の一般要件「ロケーション」と同じ記録を使う）。草案は開示する地理的な粒度（拠点・流域・行政区域など）を定めておらず、緯度経度は任意。草案はバリューチェーン全体の所在地を対象にするが、R1 で記録できるのは OGT に登録した拠点だけなので、調達先などの所在地は「所在地の考慮」の文章で書く。',
  },
  {
    id: 'REQ-ISSB-002',
    sectionId: 'strategy',
    summary: '自然関連のシナリオ分析を用いたレジリエンスの評価と、リスク・機会の識別への利用',
    references: [{ standard: 'ISSB', paragraphs: '第20〜24項・第27〜28項' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.scenario_analysis' },
    guide: '使ったシナリオとその出所、対象期間、対象にした所在地・事業の範囲、主な前提、結果の概要を書く。草案はレジリエンスの評価にシナリオ分析を使うことを求めるが、企業の状況に見合った方法でよく、定性的な簡易シナリオも認めている。R1 では文章で受け、計算はしない。TNFD の「戦略のレジリエンス」に書いた内容は繰り返さず、その旨を書いてよい。実施していない場合は「していない」と書く（その場合、草案に沿った開示とは言えない）。',
  },
  {
    id: 'REQ-ISSB-003',
    sectionId: 'metrics_targets',
    summary: '自然関連リスクに脆弱な資産・事業活動と、自然関連の機会と整合する資産・事業活動の、金額と割合',
    references: [{ standard: 'ISSB', paragraphs: '第30項(a)・第31〜33項' }],
    inputTarget: {
      kind: 'metric',
      metricIds: [
        'vulnerable_assets_amount',
        'vulnerable_assets_share',
        'opportunity_aligned_assets_amount',
        'opportunity_aligned_assets_share',
      ],
    },
    guide: 'OGT は財務データを持たないため、金額と割合を手入力する。「脆弱」「整合」の判定基準は草案に定義が無いので、どの資産・事業活動を対象にしたかと判定の考え方を補足文に書く。所在地別などの内訳は R1 では持たず、補足文で受ける。',
  },
  {
    id: 'REQ-ISSB-004',
    sectionId: null,
    summary: '所在地をガバナンス・戦略・リスク管理でどう考慮したか、センシティブな場所の識別基準、使った情報の地理的・生態学的な規模',
    references: [{ standard: 'ISSB', paragraphs: '第15項(a)・第17項(a)・第18項(a)・第26項(b)' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.location_considerations' },
    guide: '監督・管理の場で所在地をどう考慮しているか、リスク・機会がどの所在地に集中しているか、センシティブな場所をどの基準で識別したか、評価に使った情報の規模（拠点単位か流域単位かなど）を書く。草案はセンシティブな場所の種類として、水の状況が厳しい地域、生物多様性の観点で重要な地域、生態系の健全性が高い地域、健全性が急速に低下している地域、生態系サービスの提供の観点で重要な地域を挙げている。識別基準を TNFD の「センシティブロケーションにある拠点」に書いた場合は、繰り返さずその旨を書いてよい。',
  },
  {
    id: 'REQ-ISSB-005',
    sectionId: null,
    summary: '自然関連と気候関連のリスク・機会のつながり（相殺・増幅、トレードオフとシナジー）',
    references: [{ standard: 'ISSB', paragraphs: '第17項(c)・第18項(b)・第19項(c)・第24項(c)・第26項(a)・第33項(b)' }],
    inputTarget: { kind: 'narrative', itemId: 'strategy.nature_climate_connections' },
    guide: '自然と気候の両方の影響を受ける資産・事業、気候対策が自然に与える影響（例: 再生可能エネルギー設備の用地）、両方に効く取り組みを書く。GHG 排出量は同じ組織の気候関連開示と同じ算定結果を使っている旨を書いてよい。TNFD の「他のサステナビリティ開示との統合」に書いた内容は繰り返さなくてよい。',
  },
  {
    id: 'REQ-ISSB-006',
    sectionId: 'metrics_targets',
    summary: '目標ごとの、対象の所在地・自社単独か共同の取り組みか・法令との関係',
    references: [{ standard: 'ISSB', paragraphs: '第34項' }],
    inputTarget: { kind: 'narrative', itemId: 'metrics_targets.targets' },
    guide: 'TNFD の「目標と実績」と同じ文章で答える（二重に書かない）。目標ごとに、何についての目標か、対象にした資産・活動の所在地、自社単独の目標か地域で共同の取り組みの一部か、法令・規制に基づく目標かを書き添える。',
  },
  {
    id: 'REQ-ISSB-007',
    sectionId: null,
    summary: '先住民族・地域社会・影響を受けるステークホルダーとの対話を、監督・戦略・リスクの識別でどう考慮したか',
    references: [{ standard: 'ISSB', paragraphs: '第15項(b)・第17項(b)・第18項(c)・第19項(d)・第26項(c)' }],
    inputTarget: { kind: 'narrative', itemId: 'governance.human_rights_engagement' },
    guide: 'TNFD のガバナンス C の項目と同じ文章で答える（二重に書かない）。対話の対象にした人々と、対話の結果がリスク・機会の認識と対応にどう反映されたかを書き添える。',
  },
];

const supplementaryItem = (sectionId: TnfdSectionId, label: string): TnfdNarrativeItem => ({
  id: `${sectionId}.supplementary`,
  kind: 'company_supplement',
  label,
  requirementIds: [],
  example: '（この章について、提言の項目に収まらない自社固有の取り組みや補足があれば書く。無ければ未入力のままでよい。）',
});

export const TNFD_NARRATIVE_ITEMS: readonly TnfdNarrativeItem[] = [
  // ---- ガバナンス ----
  {
    id: 'governance.board_oversight',
    kind: 'requirement',
    label: '取締役会の監督',
    requirementIds: ['REQ-TNFD-001'],
    example: '取締役会は、サステナビリティ委員会からの半期ごとの報告を通じて、自然関連の依存・インパクト・リスク・機会の評価と対応方針を監督している。',
  },
  {
    id: 'governance.management_role',
    kind: 'requirement',
    label: '経営者の役割',
    requirementIds: ['REQ-TNFD-002'],
    example: '環境管理責任者（取締役）がサステナビリティ推進部を所管し、拠点の環境担当者からの報告を集約して取締役会へ報告している。',
  },
  {
    id: 'governance.human_rights_engagement',
    kind: 'requirement',
    label: '人権方針とステークホルダーとの関わり',
    requirementIds: ['REQ-TNFD-003', 'REQ-TNFD-020', 'REQ-ISSB-007'],
    example: '人権方針を定め、工場の立地する地域の自治会と年 1 回の意見交換を行っている。先住民族の居住地域に拠点は無い。',
  },
  supplementaryItem('governance', 'ガバナンスの補足'),
  // ---- 戦略 ----
  {
    id: 'strategy.dependencies_impacts_risks_opportunities',
    kind: 'requirement',
    label: '依存・インパクト・リスク・機会',
    requirementIds: ['REQ-TNFD-004'],
    example: '主力工場は地下水に依存しており、渇水時の取水制限が短期の物理リスクとなる。排水の水質規制の強化を中期の移行リスクとして認識している。',
  },
  {
    id: 'strategy.business_model_effects',
    kind: 'requirement',
    label: '事業モデル・戦略・財務計画への影響',
    requirementIds: ['REQ-TNFD-005'],
    example: '取水制限に備えて節水設備への投資を 3 か年計画に組み込んだ。財務への影響は設備投資額として把握しているが、リスクの金額換算はしていない。',
  },
  {
    id: 'strategy.resilience',
    kind: 'requirement',
    label: '戦略のレジリエンス',
    requirementIds: ['REQ-TNFD-006'],
    example: 'シナリオ分析はしていない。',
  },
  {
    id: 'strategy.priority_locations',
    kind: 'requirement',
    label: 'センシティブロケーションにある拠点',
    requirementIds: ['REQ-TNFD-007'],
    example: '環境省の自然環境調査の重要地域と重なる拠点を「該当あり」と判定した。該当拠点は拠点一覧のとおり。',
  },
  {
    id: 'strategy.materiality_approach',
    kind: 'requirement',
    label: '重要性の判断の考え方',
    requirementIds: ['REQ-TNFD-015'],
    example: '財務的な重要性を基本とし、自然へのインパクトが大きい課題は財務影響が不明でも記載している。',
  },
  {
    id: 'strategy.integration_with_other_disclosures',
    kind: 'requirement',
    label: '他のサステナビリティ開示との統合',
    requirementIds: ['REQ-TNFD-018'],
    example: 'ガバナンスとリスク管理の記載は気候関連開示と共通。GHG 排出量は気候関連開示と同じ算定結果を用いている。',
  },
  {
    id: 'strategy.time_horizons',
    kind: 'requirement',
    label: '時間軸の定義',
    requirementIds: ['REQ-TNFD-019'],
    example: '短期は 1 年以内、中期は 1〜3 年、長期は 3 年超とし、気候関連開示と同じ定義を用いている。',
  },
  {
    id: 'strategy.scenario_analysis',
    kind: 'issb_placeholder',
    label: '自然関連のシナリオ分析（ISSB 草案）',
    requirementIds: ['REQ-ISSB-002'],
    example: '（ISSB 公開草案への対応は任意。草案に沿う場合はシナリオ分析が必要だが、定性的な簡易シナリオでもよい。実施していなければ「していない」と書く。）',
  },
  {
    id: 'strategy.location_considerations',
    kind: 'issb_placeholder',
    label: '所在地の考慮（ISSB 草案）',
    requirementIds: ['REQ-ISSB-004'],
    example: '水の状況が厳しい流域にある 1 工場を、取水制限のリスクが集中する拠点として経営会議に個別に報告している。センシティブな場所の識別基準は「センシティブロケーションにある拠点」のとおり。評価は拠点単位で行った。',
  },
  {
    id: 'strategy.nature_climate_connections',
    kind: 'issb_placeholder',
    label: '自然と気候のつながり（ISSB 草案）',
    requirementIds: ['REQ-ISSB-005'],
    example: '渇水は気候変動の物理リスクと水への依存の両方に関わるため、同じ対策（節水設備）で対応している。太陽光発電設備の新設は、土地利用を変えない屋根置きに限っている。',
  },
  supplementaryItem('strategy', '戦略の補足'),
  // ---- リスクとインパクトの管理 ----
  {
    id: 'risk_impact_management.direct_operations_process',
    kind: 'requirement',
    label: '直接操業での特定・評価・優先順位付け',
    requirementIds: ['REQ-TNFD-008'],
    example: '全拠点を対象に、水・土地・汚染の 3 項目について依存とインパクトを定性的に評価し、取水量の多い拠点を優先した。LEAP は参考にしたが、全段階は実施していない。',
  },
  {
    id: 'risk_impact_management.value_chain_process',
    kind: 'requirement',
    label: 'バリューチェーンでの特定・評価・優先順位付け',
    requirementIds: ['REQ-TNFD-009'],
    example: '上流は主要原材料の調達先 10 社を対象に質問票で確認した。下流は対象にしていない。',
  },
  {
    id: 'risk_impact_management.management_process',
    kind: 'requirement',
    label: '管理プロセス',
    requirementIds: ['REQ-TNFD-010'],
    example: '特定したリスクは拠点ごとの環境管理計画に落とし、年 1 回見直している。',
  },
  {
    id: 'risk_impact_management.integration',
    kind: 'requirement',
    label: '全社リスク管理への統合',
    requirementIds: ['REQ-TNFD-011'],
    example: 'リスク管理委員会の全社リスク一覧に自然関連の項目を追加し、他のリスクと同じ基準で評価している。',
  },
  supplementaryItem('risk_impact_management', 'リスクとインパクトの管理の補足'),
  // ---- 指標と目標 ----
  {
    id: 'metrics_targets.risk_opportunity_metrics',
    kind: 'requirement',
    label: 'リスク・機会の指標',
    requirementIds: ['REQ-TNFD-012'],
    example: '水ストレス地域に立地する拠点の生産額の割合を指標としている。',
  },
  {
    id: 'metrics_targets.dependency_impact_metrics',
    kind: 'requirement',
    label: '依存・インパクトの指標（GHG を含む）',
    requirementIds: ['REQ-TNFD-013'],
    example: 'GHG 排出量は OGT の算定結果を採用した。取水量・廃棄物量は各拠点の実績を集計した。土地利用の変化は把握していない。',
  },
  {
    id: 'metrics_targets.targets',
    kind: 'requirement',
    label: '目標と実績',
    requirementIds: ['REQ-TNFD-014', 'REQ-ISSB-006'],
    example: '2030 年度までに取水量を 2024 年度比 10% 削減する目標を設定している。2024 年度の実績は基準年のため削減率は 0%。',
  },
  supplementaryItem('metrics_targets', '指標と目標の補足'),
];

/** 要求 ID から要求を引く。無ければ undefined。 */
export const findTnfdRequirement = (id: TnfdRequirementId): TnfdRequirement | undefined =>
  TNFD_REQUIREMENTS.find(requirement => requirement.id === id);

/** 文章の項目が答える要求の一覧（項目に挙げた順）。 */
export const tnfdRequirementsOfItem = (itemId: TnfdItemId): TnfdRequirement[] => {
  const item = TNFD_NARRATIVE_ITEMS.find(candidate => candidate.id === itemId);
  if (!item) return [];
  return item.requirementIds.flatMap(id => {
    const requirement = findTnfdRequirement(id);
    return requirement ? [requirement] : [];
  });
};

/** 章に属する文章の項目（マスターの順）。 */
export const tnfdNarrativeItemsOfSection = (sectionId: TnfdSectionId): TnfdNarrativeItem[] =>
  TNFD_NARRATIVE_ITEMS.filter(item => sectionOfItem(item.id) === sectionId);

/** 参照の表示（例「TNFD 提言 Governance A」）。 */
export const formatParagraphReference = (reference: TnfdParagraphReference): string =>
  `${TNFD_REFERENCE_STANDARD_DOCUMENTS[reference.standard].shortLabel} ${reference.paragraphs}`;
