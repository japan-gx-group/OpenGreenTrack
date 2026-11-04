// 四本柱の文章の選択式テンプレート（試行版）: 要求事項ごとの選択肢・補足入力と、そこから作る下書き。
//
// 文章の全項目（要求の項目と企業固有の補足）に 1 つずつ用意する。選べる事実は選択肢にし、文章で書くしかない部分は【 】つきの文例にする。
// 何も選ばずに入れた下書きが、【 】を書き換えて使う穴埋めの文例になる（穴埋めの文例を別に持たない）。
// 企業固有の補足は、書くことの型（親会社の方針との関係など）を選び、【 】を書き換える。
// 下書きは利用者が選んだ値と入力した補足だけから作り、選んでいない欄は【欄の名前】のまま残す（根拠のない内容を補わない）。
// 文型の固定の部分には、会社によって違う事実（範囲・有無・前期の有無など）を書かない。そうした事実は選択肢（否定・未特定も選べる）か【 】にする。
// 選択肢の文に {欄 ID} を含めると、その選択肢を選んだときだけその欄を使う（例: 報告している場合だけ、報告する人・頻度を入れる）。
// 置き換えは 1 段だけなので、{欄 ID} を含む選択肢は文型にある欄に置き、そこから使う欄の選択肢の文には {欄 ID} を書かない。
// 選択肢の文が「。」で終わる欄（文の欄）には sentence を付ける。「その他」で入力した文が「。」で終わっていなければ足し、次の文とつながらないようにする。
// 【 】が残った本文は「入力済み」にできない（utils/narrative.ts の検証）ので、下書きがそのまま開示内容として確定することはない。
// 選択肢と文例はチームが作った試行版で、外部の監修は受けていない（docs/ssbj-r1-scope.md §8）。
// 項目 ID は要求項目マスター（暫定版）の ID。マスターの ID が変わったときは、ここの itemId も合わせて直す。

import type { SsbjItemId, SsbjNarrativeTemplateInput } from '../types';

/**
 * テンプレート定義の版。選択肢の ID・文例を変えたら上げる（保存済みの古い選択を、新しい選択肢と取り違えないため）。
 * テンプレートの無かった項目に足すだけなら上げない（その項目の保存済みの選択は無く、ほかの項目の選択はそのまま読める）。
 */
export const SSBJ_NARRATIVE_CHOICE_TEMPLATE_VERSION = 'r2-trial-3';

/** 補足入力 1 欄の最大文字数。 */
export const SSBJ_TEMPLATE_TEXT_MAX_LENGTH = 500;

/** 「その他」の選択肢 ID。選ぶと、同じ欄 ID の補足入力の文字列を使う。 */
export const SSBJ_TEMPLATE_OTHER_OPTION_ID = 'other';

/** text は下書きに入れる文。{欄 ID} を含めると、その欄の値に置き換える（1 段だけ。補足入力の文字列は置き換えない）。 */
export type SsbjTemplateChoiceOption = { id: string; label: string; text: string };

export type SsbjTemplateSlot =
  | {
    kind: 'choice'; id: string; label: string; options: SsbjTemplateChoiceOption[]; allowOther: boolean;
    /** 選択肢の文が 1 つ以上の文（「。」で終わる）の欄。「その他」で入力した文が「。」で終わっていなければ足す。 */
    sentence?: boolean;
  }
  | { kind: 'text'; id: string; label: string; hint: string };

export type SsbjNarrativeChoiceTemplate = {
  itemId: SsbjItemId;
  slots: SsbjTemplateSlot[];
  /** 下書きの文型。{欄 ID} を、選んだ値・入力した補足（無ければ【欄の名前】）に置き換える。固定の部分に会社ごとの事実を書かない。 */
  pattern: string;
};

const FREQUENCY_OPTIONS: SsbjTemplateChoiceOption[] = [
  { id: 'yearly', label: '年 1 回', text: '年 1 回' },
  { id: 'half_yearly', label: '年 2 回', text: '年 2 回' },
  { id: 'quarterly', label: '四半期ごと', text: '四半期ごとに' },
  { id: 'monthly', label: '毎月', text: '毎月' },
];

export const SSBJ_NARRATIVE_CHOICE_TEMPLATES: readonly SsbjNarrativeChoiceTemplate[] = [
  {
    itemId: 'governance.oversight_body',
    slots: [
      {
        kind: 'choice', id: 'scope', label: '監督の範囲', allowOther: true,
        options: [
          {
            id: 'sustainability', label: 'サステナビリティ関連（気候関連を含む）',
            text: 'サステナビリティ関連（気候関連を含む）のリスク及び機会',
          },
          { id: 'climate', label: '気候関連のみ', text: '気候関連のリスク及び機会' },
        ],
      },
      {
        kind: 'choice', id: 'body', label: '監督する機関・責任者', allowOther: true,
        options: [
          { id: 'board', label: '取締役会', text: '取締役会' },
          { id: 'board_committee', label: '取締役会の下に設けた委員会', text: '取締役会の下に設けた【委員会の名称】' },
          { id: 'president', label: '代表取締役（社長）', text: '代表取締役' },
        ],
      },
    ],
    pattern: '{scope}は、{body}が監督している。',
  },
  {
    itemId: 'governance.oversight_information',
    slots: [
      {
        kind: 'choice', id: 'reporting', label: '定期的な報告', allowOther: true, sentence: true,
        options: [
          { id: 'reported', label: '報告している', text: '{reporter}が{frequency}、{body}に{content}を報告している。' },
          {
            id: 'not_reported', label: '定期的な報告はしていない',
            text: '監督する機関・責任者への定期的な報告は行っていない。【監督する機関・責任者が気候関連の事項を把握する方法】',
          },
        ],
      },
      { kind: 'text', id: 'reporter', label: '報告する人の役職', hint: '例: 管理本部長' },
      { kind: 'choice', id: 'frequency', label: '報告の頻度', allowOther: true, options: FREQUENCY_OPTIONS },
      {
        kind: 'choice', id: 'body', label: '報告を受ける機関', allowOther: true,
        options: [
          { id: 'board', label: '取締役会', text: '取締役会' },
          { id: 'board_committee', label: '取締役会の下に設けた委員会', text: '【委員会の名称】' },
        ],
      },
      {
        kind: 'choice', id: 'content', label: '報告する内容', allowOther: true,
        options: [
          { id: 'ghg_and_risks', label: '排出量と主要なリスクの状況', text: '温室効果ガス排出量と主要なリスクの状況' },
          { id: 'risk_assessment', label: 'リスク及び機会の評価結果', text: 'リスク及び機会の評価結果' },
          { id: 'target_progress', label: '目標の進捗', text: '目標の進捗' },
        ],
      },
    ],
    pattern: '{reporting}',
  },
  {
    itemId: 'strategy.business_model_impact',
    slots: [
      { kind: 'text', id: 'driver', label: 'リスク・機会の内容', hint: '例: 電力価格の上昇' },
      { kind: 'text', id: 'business', label: '影響を受ける事業・製品', hint: '例: 主力の金属加工品' },
      {
        kind: 'choice', id: 'impact', label: '影響の内容', allowOther: true,
        options: [
          { id: 'cost_increase', label: '製造原価の上昇', text: '製造原価の上昇' },
          { id: 'revenue_decrease', label: '売上の減少', text: '売上の減少' },
          { id: 'revenue_increase', label: '売上の増加', text: '売上の増加' },
          { id: 'asset_damage', label: '設備・資産の損傷', text: '設備・資産の損傷' },
        ],
      },
      {
        kind: 'choice', id: 'timing', label: '影響の時期', allowOther: false,
        options: [
          { id: 'occurring', label: '既に生じている', text: '生じている' },
          { id: 'expected', label: '今後見込まれる', text: '生じることが見込まれる' },
        ],
      },
      {
        kind: 'choice', id: 'concentration', label: '影響の集中', allowOther: true, sentence: true,
        options: [
          {
            id: 'concentrated', label: '特定の事業所・地域・工程に集中している',
            text: '影響は【影響が集中している事業所・地域・工程】に集中している。',
          },
          { id: 'spread', label: '集中していない', text: '影響は特定の事業所・地域・工程に集中していない。' },
          {
            id: 'unidentified', label: 'まだ特定できていない',
            text: '影響が特定の事業所・地域・工程に集中しているかは、まだ特定できていない。',
          },
        ],
      },
    ],
    pattern: '{driver}により、{business}において{impact}が{timing}。{concentration}',
  },
  {
    itemId: 'risk_management.risk_process',
    slots: [
      { kind: 'choice', id: 'frequency', label: '識別の頻度', allowOther: true, options: FREQUENCY_OPTIONS },
      {
        kind: 'choice', id: 'method', label: '識別の方法', allowOther: true,
        options: [
          { id: 'hearing', label: '各部門へのヒアリング', text: '各部門へのヒアリング' },
          { id: 'survey', label: '各部門へのアンケート', text: '各部門へのアンケート' },
          { id: 'meeting', label: '部門横断の会議', text: '部門横断の会議' },
        ],
      },
      {
        kind: 'choice', id: 'assessment', label: '評価・優先順位付け', allowOther: true, sentence: true,
        options: [
          {
            id: 'likelihood_and_impact', label: '発生可能性と影響の大きさで評価している',
            text: '識別したリスクは、発生可能性と影響の大きさで評価し、優先順位を付けている。',
          },
          {
            id: 'impact_only', label: '影響の大きさで評価している',
            text: '識別したリスクは、影響の大きさで評価し、優先順位を付けている。',
          },
          {
            id: 'not_prioritized', label: '評価・優先順位付けはしていない',
            text: '識別したリスクの評価・優先順位付けは、まだ行っていない。',
          },
        ],
      },
      {
        kind: 'choice', id: 'scenario', label: 'シナリオ分析', allowOther: false, sentence: true,
        options: [
          { id: 'used', label: '用いている', text: 'リスクの識別・評価に、シナリオ分析を用いている。' },
          { id: 'not_used', label: '用いていない', text: 'リスクの識別・評価に、シナリオ分析は用いていない。' },
        ],
      },
      {
        kind: 'choice', id: 'change', label: '前期からの変更', allowOther: true, sentence: true,
        options: [
          { id: 'unchanged', label: '変更していない', text: '前期からプロセスを変更していない。' },
          { id: 'changed', label: '変更した', text: '前期からプロセスを【変更した点】のとおり変更した。' },
          { id: 'first_year', label: '初めての開示（前期が無い）', text: '当期が初めての開示のため、前期からの変更は記載していない。' },
        ],
      },
    ],
    pattern: '{frequency}、{method}でリスクを識別している。{assessment}{scenario}{change}',
  },
  {
    itemId: 'metrics_targets.ghg_measurement_method',
    slots: [
      // どのスコープをその方法で測定しているかも選ぶ（SHK 制度にスコープ 3 の方法は無いので、すべての排出を 1 つの方法で測ったと言い切らない）。
      {
        kind: 'choice', id: 'scope', label: '対象のスコープ', allowOther: true,
        options: [
          { id: 'scope_1_2', label: 'スコープ 1・2', text: 'スコープ 1・2 の温室効果ガス排出' },
          { id: 'scope_1_2_3', label: 'スコープ 1・2・3', text: 'スコープ 1・2・3 の温室効果ガス排出' },
        ],
      },
      {
        kind: 'choice', id: 'method', label: '測定方法', allowOther: true,
        options: [
          { id: 'ghg_protocol', label: 'GHG プロトコル', text: 'GHG プロトコルの方法' },
          { id: 'shk', label: '温対法の SHK 制度の方法', text: '温対法の算定・報告・公表制度（SHK 制度）の方法' },
        ],
      },
      {
        kind: 'choice', id: 'reason', label: 'この方法を選んだ理由', allowOther: true,
        options: [
          { id: 'parent', label: '親会社の指定', text: '親会社の指定に従ったため' },
          // どの方法を選んでも使える言い方にし、揃える先の報告は【 】で書かせる（法令の報告に限ると GHG プロトコルと食い違うため）。
          {
            id: 'existing_reporting', label: '既に行っている報告と揃えるため',
            text: '既に行っている【報告の名称】と測定方法を揃えるため',
          },
          { id: 'customer', label: '取引先の要請', text: '取引先の要請に応えるため' },
        ],
      },
    ],
    pattern: '{scope}は、{method}で測定している。この方法を選んだ理由は、{reason}である。',
  },

  // ---- ガバナンス ----
  {
    itemId: 'governance.management_role',
    slots: [
      {
        kind: 'choice', id: 'delegation', label: '管理を任せている先', allowOther: true, sentence: true,
        options: [
          {
            id: 'delegated', label: '特定の役員・会議体に任せている',
            text: 'リスク及び機会の管理は{delegate}に任せており、{overseer}は{method}を通じて監督している。',
          },
          {
            id: 'not_delegated', label: '任せていない',
            text: 'リスク及び機会の管理を、特定の役員・会議体には任せていない。【管理を担っている体制】。',
          },
        ],
      },
      {
        kind: 'choice', id: 'delegate', label: '任せている役員・会議体', allowOther: true,
        options: [
          { id: 'officer', label: '担当の役員', text: '担当役員の【役職名】' },
          { id: 'management_meeting', label: '経営会議', text: '経営会議' },
          { id: 'committee', label: 'サステナビリティ委員会などの会議体', text: '【会議体の名称】' },
        ],
      },
      {
        kind: 'choice', id: 'overseer', label: '監督する機関・責任者', allowOther: true,
        options: [
          { id: 'board', label: '取締役会', text: '取締役会' },
          { id: 'president', label: '代表取締役（社長）', text: '代表取締役' },
        ],
      },
      {
        kind: 'choice', id: 'method', label: '監督の方法', allowOther: true,
        options: [
          { id: 'regular_report', label: '定期的な報告を受ける', text: '定期的な報告' },
          { id: 'approval', label: '重要な事項を承認する', text: '重要な事項の承認' },
          { id: 'report_and_approval', label: '報告を受け、重要な事項を承認する', text: '定期的な報告と重要な事項の承認' },
        ],
      },
      {
        kind: 'choice', id: 'controls', label: '管理のための統制・手続', allowOther: true, sentence: true,
        options: [
          {
            id: 'existing', label: '既存の統制・手続に組み込んでいる',
            text: '管理のための統制・手続は、【既存の統制・手続の名称（例: 内部統制の手続）】に組み込んでいる。',
          },
          { id: 'dedicated', label: '専用の統制・手続を設けている', text: '管理のための統制・手続として、【統制・手続の内容】を設けている。' },
          { id: 'none', label: '設けていない', text: '管理のための所定の統制・手続は、設けていない。' },
        ],
      },
    ],
    pattern: '{delegation}{controls}',
  },

  // ---- 戦略 ----
  {
    itemId: 'strategy.response_plans',
    slots: [
      { kind: 'text', id: 'target', label: '対応するリスク・機会', hint: '例: 電力価格の上昇' },
      {
        kind: 'choice', id: 'action', label: 'これまでの対応', allowOther: true, sentence: true,
        options: [
          { id: 'taken', label: '対応している', text: 'これまでに{measure}を行っている。' },
          { id: 'not_yet', label: 'まだ対応していない', text: 'まだ具体的な対応は行っていない。' },
        ],
      },
      {
        kind: 'choice', id: 'measure', label: '対応の内容', allowOther: true,
        options: [
          { id: 'efficiency', label: '省エネ設備への更新', text: '省エネ設備への更新' },
          { id: 'renewable', label: '再生可能エネルギーの調達', text: '再生可能エネルギー由来の電力の調達' },
          { id: 'product', label: '製品・サービスの見直し', text: '製品・サービスの見直し' },
          { id: 'adaptation', label: '自然災害への備え（適応）', text: '自然災害への備え（浸水対策・設備の移転など）' },
        ],
      },
      {
        kind: 'choice', id: 'plan', label: '今後の計画', allowOther: true, sentence: true,
        options: [
          { id: 'planned', label: '計画がある', text: '今後は【今後の計画と期間（例: 3 年間で主要な設備を更新する）】を計画している。' },
          { id: 'not_planned', label: 'まだ定めていない', text: '今後の対応の計画は、まだ定めていない。' },
        ],
      },
      {
        kind: 'choice', id: 'progress', label: '前期までの計画の進捗', allowOther: true, sentence: true,
        options: [
          { id: 'reported', label: '前期までに計画を示している', text: '前期までに示した計画の進捗は、【進捗の内容】である。' },
          { id: 'no_prior_plan', label: '前期までに計画を示していない', text: '前期までに計画を示していないため、進捗は記載していない。' },
          { id: 'first_year', label: '初めての開示（前期が無い）', text: '当期が初めての開示のため、前期までの計画の進捗は記載していない。' },
        ],
      },
      {
        kind: 'choice', id: 'resources', label: '取組みに充てる資源', allowOther: true, sentence: true,
        options: [
          { id: 'secured', label: '予算・人員を確保している', text: '取組みに充てる資源として、【予算・人員の内容】を確保している。' },
          { id: 'not_secured', label: '特に確保していない', text: '取組みに充てる予算・人員は、特に確保していない。' },
        ],
      },
      {
        kind: 'choice', id: 'tradeoff', label: '考慮したトレードオフ', allowOther: true, sentence: true,
        options: [
          {
            id: 'considered', label: '考慮したものがある',
            text: '対応にあたっては、【考慮したトレードオフ（例: 投資の回収期間と削減の効果）】を考慮した。',
          },
          { id: 'none', label: '特に無い', text: '対応にあたって考慮した重要なトレードオフは無い。' },
        ],
      },
    ],
    pattern: '{target}について、{action}{plan}{progress}{resources}{tradeoff}',
  },

  // ---- リスク管理 ----
  {
    itemId: 'risk_management.opportunity_process',
    slots: [
      {
        kind: 'choice', id: 'process', label: '機会のプロセス', allowOther: true, sentence: true,
        options: [
          { id: 'same_as_risks', label: 'リスクと同じプロセス', text: '機会は、リスクと同じプロセスで識別・評価している。' },
          {
            id: 'separate', label: 'リスクとは別のプロセス',
            text: '機会は、{frequency}、{method}で識別し、{assessor}が{criteria}で評価している。',
          },
          { id: 'not_established', label: 'まだ定めていない', text: '機会を識別・評価するプロセスは、まだ定めていない。' },
        ],
      },
      { kind: 'choice', id: 'frequency', label: '識別の頻度', allowOther: true, options: FREQUENCY_OPTIONS },
      {
        kind: 'choice', id: 'method', label: '識別の方法', allowOther: true,
        options: [
          { id: 'hearing', label: '各部門へのヒアリング', text: '各部門へのヒアリング' },
          { id: 'market_research', label: '取引先・市場の動向の調査', text: '取引先・市場の動向の調査' },
          { id: 'meeting', label: '部門横断の会議', text: '部門横断の会議' },
        ],
      },
      {
        kind: 'choice', id: 'assessor', label: '評価する部門・会議体', allowOther: true,
        options: [
          { id: 'sales', label: '営業部門', text: '営業部門' },
          { id: 'planning', label: '経営企画部門', text: '経営企画部門' },
          { id: 'meeting_body', label: '会議体', text: '【会議体の名称】' },
        ],
      },
      {
        kind: 'choice', id: 'criteria', label: '評価の基準', allowOther: true,
        options: [
          { id: 'revenue_impact', label: '売上への影響の大きさ', text: '売上への影響の大きさ' },
          { id: 'likelihood_and_impact', label: '実現の可能性と影響の大きさ', text: '実現の可能性と影響の大きさ' },
        ],
      },
    ],
    pattern: '{process}',
  },
  {
    itemId: 'risk_management.integration',
    slots: [
      {
        kind: 'choice', id: 'integration', label: '全社のリスク管理との関係', allowOther: true, sentence: true,
        options: [
          {
            id: 'integrated', label: '全社のリスク管理に組み込んでいる',
            text: '識別したリスク及び機会は{mechanism}に登録し、{body}で{treatment}管理している。',
          },
          {
            id: 'not_integrated', label: '組み込んでいない',
            text: '識別したリスク及び機会は、全社のリスク管理には組み込んでいない。【今の扱い（例: 環境の担当部門が別に管理している）】。',
          },
        ],
      },
      {
        kind: 'choice', id: 'mechanism', label: '全社のリスク管理の仕組み', allowOther: true,
        options: [
          { id: 'risk_register', label: '全社のリスク一覧', text: '全社のリスク一覧' },
          { id: 'risk_rules', label: 'リスク管理規程に基づく仕組み', text: 'リスク管理規程に基づく全社の仕組み' },
        ],
      },
      {
        kind: 'choice', id: 'body', label: '管理する会議体', allowOther: true,
        options: [
          { id: 'risk_committee', label: 'リスク管理委員会', text: 'リスク管理委員会' },
          { id: 'management_meeting', label: '経営会議', text: '経営会議' },
          { id: 'board', label: '取締役会', text: '取締役会' },
        ],
      },
      {
        kind: 'choice', id: 'treatment', label: '他のリスクとの扱い', allowOther: true,
        options: [
          { id: 'same', label: '他のリスクと同じ基準', text: '他のリスクと同じ基準で' },
          { id: 'different', label: '別の基準', text: '【気候関連に使う基準】で' },
        ],
      },
    ],
    pattern: '{integration}',
  },

  // ---- 指標及び目標 ----
  {
    itemId: 'metrics_targets.ghg_consolidation_split',
    slots: [
      {
        kind: 'choice', id: 'relation', label: '親会社との関係', allowOther: true, sentence: true,
        options: [
          {
            id: 'consolidated_subsidiary', label: '連結子会社',
            text: '当社は親会社の連結子会社であり、当社のスコープ 1・2 の排出は、すべて連結会計グループの分に含まれる。',
          },
          {
            id: 'unconsolidated_subsidiary', label: '非連結子会社',
            text: '当社は親会社の非連結子会社であり、当社のスコープ 1・2 の排出は、その他の投資先の分に含まれる。',
          },
          {
            id: 'equity_method_affiliate', label: '持分法適用関連会社',
            text: '当社は親会社の持分法適用関連会社であり、当社のスコープ 1・2 の排出は、その他の投資先の分に含まれる。',
          },
          {
            id: 'parent', label: '親会社（グループで開示する）',
            text: 'スコープ 1・2 の排出は、連結会計グループの分が【連結会計グループの排出量】、その他の投資先の分が【その他の投資先の排出量】である。',
          },
        ],
      },
    ],
    pattern: '{relation}',
  },
  {
    itemId: 'metrics_targets.ghg_measurement_inputs',
    slots: [
      {
        kind: 'choice', id: 'activity', label: '活動量の出所', allowOther: true,
        options: [
          { id: 'invoices', label: '電力・燃料の請求書', text: '電力・燃料の請求書の値' },
          { id: 'meters', label: 'メーターの検針値', text: 'メーターの検針値' },
          { id: 'invoices_and_meters', label: '請求書とメーターの検針値', text: '請求書とメーターの検針値' },
        ],
      },
      {
        kind: 'choice', id: 'factor', label: '排出係数の出所', allowOther: true,
        options: [
          { id: 'official', label: '国が公表する係数', text: '国が公表する排出係数' },
          { id: 'official_and_supplier', label: '国の係数と電気事業者別の係数', text: '国が公表する排出係数と、電気事業者別の排出係数' },
          { id: 'custom', label: '自社で設定した係数を含む', text: '国が公表する排出係数と、自社で設定した【係数の内容】' },
        ],
      },
      {
        kind: 'choice', id: 'estimation', label: '推計した部分', allowOther: true, sentence: true,
        options: [
          {
            id: 'estimated', label: '一部を推計した',
            text: '【推計した部分と方法（例: 一部の拠点の欠けている月は、前年同月の値で推計した）】。',
          },
          { id: 'none', label: '推計していない', text: '推計した部分は無い。' },
        ],
      },
      {
        kind: 'choice', id: 'change', label: '前期からの変更', allowOther: true, sentence: true,
        options: [
          { id: 'unchanged', label: '変更していない', text: '前期から測定方法を変更していない。' },
          { id: 'changed', label: '変更した', text: '前期から測定方法を【変更した点と理由】のとおり変更した。' },
          { id: 'first_year', label: '初めての開示（前期が無い）', text: '当期が初めての開示のため、前期からの変更は記載していない。' },
        ],
      },
    ],
    pattern: '活動量は{activity}を用い、排出係数は{factor}を用いた。{estimation}{change}',
  },
  {
    itemId: 'metrics_targets.value_chain_period',
    slots: [
      {
        kind: 'choice', id: 'usage', label: '算定期間が異なる情報', allowOther: true, sentence: true,
        options: [
          {
            id: 'used', label: '使っている',
            text: '{source}の排出量は{period}の値を用いており、当社の報告期間との差の間に{change}。',
          },
          {
            id: 'not_used', label: '使っていない',
            text: '算定期間が当社の報告期間と異なる、バリュー・チェーン上の企業の情報は用いていない。',
          },
        ],
      },
      { kind: 'text', id: 'source', label: 'バリュー・チェーン上の企業', hint: '例: 主要な仕入先 2 社' },
      {
        kind: 'choice', id: 'period', label: 'その企業の算定期間', allowOther: true,
        options: [
          { id: 'calendar_year', label: '暦年（1〜12 月）', text: '暦年（1〜12 月）' },
          { id: 'previous_fiscal_year', label: 'その企業の前の事業年度', text: 'その企業の前の事業年度' },
        ],
      },
      {
        kind: 'choice', id: 'change', label: '期間の差の間の重大な変化', allowOther: true,
        options: [
          { id: 'none', label: '生じていない', text: '重大な変化は生じていない' },
          { id: 'occurred', label: '生じた', text: '【生じた重大な変化と、その影響】が生じた' },
        ],
      },
    ],
    pattern: '{usage}',
  },
  {
    itemId: 'metrics_targets.scope3_data',
    slots: [
      { kind: 'text', id: 'category', label: 'カテゴリ', hint: '例: カテゴリ 1（購入した製品・サービス）' },
      {
        kind: 'choice', id: 'data', label: 'データの選び方', allowOther: true,
        options: [
          { id: 'spend_based', label: '購入金額 × 排出原単位（2 次データ）', text: '購入金額に排出原単位を乗じた 2 次データ' },
          { id: 'activity_based', label: '物量 × 排出原単位（2 次データ）', text: '物量に排出原単位を乗じた 2 次データ' },
          { id: 'supplier_specific', label: '取引先から受け取った値（1 次データ）', text: '取引先から受け取った 1 次データ' },
        ],
      },
      {
        kind: 'choice', id: 'primary_data', label: '1 次データを使った範囲', allowOther: true, sentence: true,
        options: [
          { id: 'partly', label: '一部で使った', text: '1 次データを使った範囲は、【範囲（例: 主要な仕入先 2 社分）】である。' },
          { id: 'none', label: '使っていない', text: '1 次データは用いていない。' },
        ],
      },
      {
        kind: 'choice', id: 'verified_data', label: '第三者が検証したデータ', allowOther: true, sentence: true,
        options: [
          { id: 'partly', label: '一部で使った', text: '第三者が検証したデータを使った範囲は、【範囲】である。' },
          { id: 'none', label: '使っていない', text: '第三者が検証したデータは用いていない。' },
        ],
      },
    ],
    pattern: '{category}は、{data}を用いた。{primary_data}{verified_data}',
  },
  {
    itemId: 'metrics_targets.internal_carbon_price',
    slots: [
      {
        kind: 'choice', id: 'usage', label: '内部炭素価格', allowOther: true, sentence: true,
        options: [
          { id: 'not_used', label: '用いていない', text: '当社は内部炭素価格を用いていない。' },
          {
            id: 'used', label: '用いている',
            text: '当社は内部炭素価格を{application}に用いており、価格は排出 1 トンあたり【価格（円/t-CO2e）】である。',
          },
        ],
      },
      {
        kind: 'choice', id: 'application', label: '使い方', allowOther: true,
        options: [
          { id: 'investment', label: '設備投資の判断', text: '設備投資の判断' },
          { id: 'business_planning', label: '事業計画の評価', text: '事業計画の評価' },
        ],
      },
    ],
    pattern: '{usage}',
  },
  {
    itemId: 'metrics_targets.remuneration',
    slots: [
      {
        kind: 'choice', id: 'linkage', label: '役員報酬との関係', allowOther: true, sentence: true,
        options: [
          { id: 'not_linked', label: '組み込んでいない', text: '当社は役員報酬に気候関連の評価項目を組み込んでいない。' },
          {
            id: 'linked', label: '組み込んでいる',
            text: '当社は役員の{component}に、気候関連の評価項目として【評価項目（例: 温室効果ガス排出量の削減率）】を組み込んでいる。' +
              '当期の役員報酬のうち、気候関連の評価項目と結び付いている割合は【割合】である。',
          },
        ],
      },
      {
        kind: 'choice', id: 'component', label: '組み込んでいる報酬', allowOther: true,
        options: [
          { id: 'bonus', label: '賞与（短期の業績連動報酬）', text: '賞与' },
          { id: 'stock', label: '株式報酬（中長期の業績連動報酬）', text: '株式報酬' },
        ],
      },
    ],
    pattern: '{linkage}',
  },
  {
    itemId: 'metrics_targets.other_metrics',
    slots: [
      {
        kind: 'choice', id: 'usage', label: 'ほかに管理している指標', allowOther: true, sentence: true,
        options: [
          {
            id: 'managed', label: 'ある',
            text: '{metric}を、{definition}で算定し、{frequency}確認している。第三者の認証は{certification}。',
          },
          { id: 'none', label: '無い', text: '温室効果ガス排出量のほかに、リスク及び機会の管理に用いている指標は無い。' },
        ],
      },
      {
        kind: 'choice', id: 'metric', label: '指標', allowOther: true,
        options: [
          { id: 'energy_intensity', label: '売上高あたりの電力使用量', text: '売上高あたりの電力使用量' },
          { id: 'energy_use', label: 'エネルギー使用量', text: 'エネルギー使用量' },
          { id: 'renewable_ratio', label: '再生可能エネルギー由来の電力の比率', text: '再生可能エネルギー由来の電力の比率' },
        ],
      },
      { kind: 'text', id: 'definition', label: '定義と算定方法', hint: '例: 電力使用量（kWh）を売上高（百万円）で割る方法' },
      { kind: 'choice', id: 'frequency', label: '確認の頻度', allowOther: true, options: FREQUENCY_OPTIONS },
      {
        kind: 'choice', id: 'certification', label: '第三者の認証', allowOther: true,
        options: [
          { id: 'none', label: '受けていない', text: '受けていない' },
          { id: 'certified', label: '受けている', text: '【認証した者と認証の内容】のとおり受けている' },
        ],
      },
    ],
    pattern: '{usage}',
  },
  {
    itemId: 'metrics_targets.targets',
    slots: [
      {
        kind: 'choice', id: 'target_status', label: '目標', allowOther: true, sentence: true,
        options: [
          {
            id: 'set', label: '設定している',
            text: '{subject}を{target_year}までに{base_year}比で{value}とする目標を、{coverage}を対象に設定している。当期の実績は{progress}。',
          },
          { id: 'not_set', label: 'まだ設定していない', text: 'リスク及び機会に関する目標は、まだ設定していない。' },
        ],
      },
      {
        kind: 'choice', id: 'subject', label: '目標の対象', allowOther: true,
        options: [
          { id: 'scope_1_2', label: 'スコープ 1・2 の排出量', text: 'スコープ 1・2 の温室効果ガス排出量' },
          { id: 'scope_1_2_3', label: 'スコープ 1・2・3 の排出量', text: 'スコープ 1・2・3 の温室効果ガス排出量' },
          { id: 'energy_use', label: 'エネルギー使用量', text: 'エネルギー使用量' },
        ],
      },
      { kind: 'text', id: 'target_year', label: '目標年度', hint: '例: 2030年度' },
      { kind: 'text', id: 'base_year', label: '基準年度', hint: '例: 2022年度' },
      { kind: 'text', id: 'value', label: '目標の数値', hint: '例: 30% 削減' },
      {
        kind: 'choice', id: 'coverage', label: '対象の範囲', allowOther: true,
        options: [
          { id: 'company', label: '会社全体', text: '会社全体' },
          { id: 'group', label: 'グループ全体', text: 'グループ全体' },
          { id: 'part', label: '一部の事業・拠点', text: '【対象の事業・拠点】' },
        ],
      },
      {
        kind: 'choice', id: 'progress', label: '当期の実績', allowOther: true,
        options: [
          { id: 'measured', label: '実績がある', text: '【当期の実績と推移（例: 基準年度比 8% 削減）】である' },
          { id: 'first_year', label: '目標を設定した初年度', text: '目標を設定した初年度のため、まだ示していない' },
        ],
      },
    ],
    pattern: '{target_status}',
  },
  {
    itemId: 'metrics_targets.ghg_targets',
    slots: [
      {
        kind: 'choice', id: 'target_status', label: '温室効果ガス排出目標', allowOther: true, sentence: true,
        options: [
          {
            id: 'set', label: '設定している',
            text: '温室効果ガス排出目標は、{gases}を対象とした{gross_net}の目標である。' +
              '目標の設定に、セクター別脱炭素アプローチを{sector_approach}。カーボン・クレジットは、{credits}。',
          },
          { id: 'not_set', label: '設定していない', text: '温室効果ガス排出目標は、設定していない。' },
        ],
      },
      {
        kind: 'choice', id: 'gases', label: '対象のガス', allowOther: true,
        options: [
          { id: 'co2', label: 'CO2 のみ', text: 'CO2 のみ' },
          { id: 'seven_gases', label: '7 種類の温室効果ガス', text: '7 種類の温室効果ガス' },
        ],
      },
      {
        kind: 'choice', id: 'gross_net', label: '総量か純量か', allowOther: false,
        options: [
          { id: 'gross', label: '総量（グロス）', text: '総量（グロス）' },
          { id: 'net', label: '純量（ネット）', text: '純量（ネット）' },
        ],
      },
      {
        kind: 'choice', id: 'sector_approach', label: 'セクター別脱炭素アプローチ', allowOther: false,
        options: [
          { id: 'not_used', label: '用いていない', text: '用いていない' },
          { id: 'used', label: '用いている', text: '用いている' },
        ],
      },
      {
        kind: 'choice', id: 'credits', label: 'カーボン・クレジット', allowOther: true,
        options: [
          { id: 'not_planned', label: '使用を計画していない', text: '使用を計画していない' },
          { id: 'planned', label: '使用を計画している', text: '【使用の計画（量・種類・認証の仕組み）】のとおり使用を計画している' },
        ],
      },
    ],
    pattern: '{target_status}',
  },
  {
    itemId: 'metrics_targets.comparative_information',
    slots: [
      {
        kind: 'choice', id: 'comparison', label: '比較情報', allowOther: true, sentence: true,
        options: [
          { id: 'first_year', label: '初めての開示のため示さない', text: '当期が初めての開示であるため、比較情報は示していない。' },
          { id: 'shown', label: '前期の数値を示す', text: '前期の数値を比較情報として示している。' },
          {
            id: 'restated', label: '前期の数値を見直して示す',
            text: '前期の数値を比較情報として示している。前期の数値は、【見直した内容と理由】のため見直した。',
          },
          { id: 'voluntary_omitted', label: '任意の開示のため示さない', text: '任意の開示であるため、比較情報は示していない。' },
        ],
      },
    ],
    pattern: '{comparison}',
  },
  {
    itemId: 'metrics_targets.measurement_uncertainty',
    slots: [
      {
        kind: 'choice', id: 'uncertainty', label: '不確実性の高い数値', allowOther: true, sentence: true,
        options: [
          {
            id: 'exists', label: 'ある',
            text: '{subject}は{source}であり、実際の値と差がありうる。置いた仮定は、【置いた仮定】である。',
          },
          { id: 'none', label: '無い', text: '開示した数値に、測定の不確実性が高いものは無い。' },
        ],
      },
      {
        kind: 'choice', id: 'subject', label: '数値', allowOther: true,
        options: [
          { id: 'scope3_category1', label: 'スコープ 3 のカテゴリ 1', text: 'スコープ 3 のカテゴリ 1（購入した製品・サービス）の排出量' },
          { id: 'estimated_scope_1_2', label: '推計を含むスコープ 1・2', text: '推計した活動量を含むスコープ 1・2 の排出量' },
        ],
      },
      {
        kind: 'choice', id: 'source', label: '不確実性の源泉', allowOther: true,
        options: [
          { id: 'spend_based', label: '購入金額に基づく推計', text: '購入金額に基づく推計' },
          { id: 'filled_gaps', label: '欠けている期間を補った推計', text: '欠けている期間を前年同月の値などで補った推計' },
          { id: 'industry_average', label: '業界平均の原単位を使った推計', text: '業界平均の排出原単位を使った推計' },
        ],
      },
    ],
    pattern: '{uncertainty}',
  },

  // ---- 企業固有の補足（書くことの型を選び、【 】を書き換える。型を変えて入れ直すと、本文の後ろに足す） ----
  {
    itemId: 'governance.company_supplement',
    slots: [
      {
        kind: 'choice', id: 'content', label: '補足する内容', allowOther: true, sentence: true,
        options: [
          {
            id: 'parent_body', label: '親会社の会議体との関係',
            text: '当社の【役職】は、親会社の【会議体の名称（例: サステナビリティ委員会）】に【関わり方（例: 委員として参加している）】。',
          },
          {
            id: 'parent_policy', label: '親会社の方針・規程との関係',
            text: '当社は、親会社の【方針・規程の名称】に従って、リスク及び機会を管理している。',
          },
          { id: 'own_structure', label: '自社独自の体制・手続', text: '当社独自の体制・手続として、【体制・手続の内容】を設けている。' },
        ],
      },
    ],
    pattern: '{content}',
  },
  {
    itemId: 'strategy.company_supplement',
    slots: [
      {
        kind: 'choice', id: 'content', label: '補足する内容', allowOther: true, sentence: true,
        options: [
          {
            id: 'customer_requests', label: '取引先からの要請',
            text: '主要な取引先から、【要請の内容（例: 製品単位の排出量の開示）】を求められている。',
          },
          { id: 'parent_strategy', label: '親会社の戦略・計画との関係', text: '当社の取組みは、親会社の【戦略・計画の名称】に沿って進めている。' },
          {
            id: 'regulation', label: '規制・制度の動向',
            text: '【規制・制度の名称】の動向により、当社の事業に【影響の内容】が生じる可能性がある。',
          },
        ],
      },
    ],
    pattern: '{content}',
  },
  {
    itemId: 'risk_management.company_supplement',
    slots: [
      {
        kind: 'choice', id: 'content', label: '補足する内容', allowOther: true, sentence: true,
        options: [
          {
            id: 'business_continuity', label: '事業継続計画との関係',
            text: '【リスクの内容（例: 豪雨による操業停止）】については、事業継続計画の中で【対応の内容（例: 代替の生産拠点を定めている）】。',
          },
          {
            id: 'parent_process', label: '親会社のプロセスとの関係',
            text: 'リスク及び機会の識別・評価の結果は、【共有の方法（例: 年 1 回の報告）】により、親会社の【プロセス・会議体の名称】と共有している。',
          },
          { id: 'own_measures', label: '自社独自の取組み', text: '当社独自の取組みとして、【取組みの内容】を行っている。' },
        ],
      },
    ],
    pattern: '{content}',
  },
  {
    itemId: 'metrics_targets.company_supplement',
    slots: [
      {
        kind: 'choice', id: 'content', label: '補足する内容', allowOther: true, sentence: true,
        options: [
          {
            id: 'future_plan', label: '今後の予定',
            text: '【時期】から、【予定している取組み（例: 主要な拠点での再生可能エネルギー由来の電力の購入）】を始める予定である。',
          },
          { id: 'parent_targets', label: '親会社の目標との関係', text: '当社の目標は、親会社の【目標の名称】に合わせて設定している。' },
          { id: 'data_improvement', label: 'データの精度の改善', text: '【指標・データの名称】の精度を高めるため、【改善の取組み】を進めている。' },
        ],
      },
    ],
    pattern: '{content}',
  },
];

export const findSsbjNarrativeChoiceTemplate = (itemId: string): SsbjNarrativeChoiceTemplate | undefined =>
  SSBJ_NARRATIVE_CHOICE_TEMPLATES.find(template => template.itemId === itemId);

/** 何も選んでいない選択式テンプレートの入力。 */
export const emptySsbjNarrativeTemplateInput = (): SsbjNarrativeTemplateInput => ({
  version: SSBJ_NARRATIVE_CHOICE_TEMPLATE_VERSION,
  choices: {},
  texts: {},
});

/** 保存済みの選択が、今のテンプレート定義の版で作られたものか（違えば選択肢に戻さない）。 */
export const isCurrentSsbjNarrativeTemplateInput = (input: SsbjNarrativeTemplateInput | null | undefined): boolean =>
  input?.version === SSBJ_NARRATIVE_CHOICE_TEMPLATE_VERSION;

const placeholderOf = (slot: SsbjTemplateSlot) => `【${slot.label}】`;
const SLOT_REFERENCE = /\{([a-z_]+)\}/g;
const SENTENCE_END = /[。．！？!?]$/;

/** 文の終わりに「。」が無ければ足す（例: 「重要度で評価している」の後ろに次の文が続いて、意味が変わらないように）。 */
const asSentence = (text: string): string => (SENTENCE_END.test(text) ? text : `${text}。`);

/** 選んだ選択肢（「その他」・未選択なら undefined）。 */
const chosenOption = (slot: SsbjTemplateSlot, input: SsbjNarrativeTemplateInput): SsbjTemplateChoiceOption | undefined =>
  slot.kind === 'choice' ? slot.options.find(option => option.id === input.choices[slot.id]) : undefined;

/** 1 欄の値。選んでいない・入力していない欄は【欄の名前】。選択肢の文の {欄 ID} はまだ置き換えない。 */
const slotValue = (slot: SsbjTemplateSlot, input: SsbjNarrativeTemplateInput): string => {
  const text = input.texts[slot.id]?.trim() ?? '';
  if (slot.kind === 'text') return text || placeholderOf(slot);
  const choice = input.choices[slot.id];
  if (choice === SSBJ_TEMPLATE_OTHER_OPTION_ID && slot.allowOther) {
    if (!text) return placeholderOf(slot);
    return slot.sentence ? asSentence(text) : text;
  }
  return chosenOption(slot, input)?.text ?? placeholderOf(slot);
};

/** 選択と補足入力から、編集できる下書きを作る。選んでいない欄は【欄の名前】のまま残す。 */
export const buildSsbjNarrativeDraft = (
  template: SsbjNarrativeChoiceTemplate,
  input: SsbjNarrativeTemplateInput,
): string => {
  const raw = new Map(template.slots.map(slot => [slot.id, slotValue(slot, input)]));
  const fill = (text: string) => text.replace(SLOT_REFERENCE, (whole, slotId: string) => raw.get(slotId) ?? whole);
  // 選択肢の文の中の {欄 ID} を先に置き換える（1 段だけ。利用者が入力した補足の文字列は置き換えない）。
  const values = new Map(template.slots.map(slot => [slot.id, chosenOption(slot, input) ? fill(raw.get(slot.id)!) : raw.get(slot.id)!]));
  return template.pattern.replace(SLOT_REFERENCE, (whole, slotId: string) => values.get(slotId) ?? whole);
};

/**
 * まだ選んでいない・入力していない欄の名前（画面で「残り」を出すため）。
 * 選んだ選択肢では使わない欄（例: 報告していないときの報告する人）は、下書きに出ないので数えない。
 */
export const unfilledSsbjTemplateSlots = (
  template: SsbjNarrativeChoiceTemplate,
  input: SsbjNarrativeTemplateInput,
): string[] => {
  const draft = buildSsbjNarrativeDraft(template, input);
  return template.slots.filter(slot => draft.includes(placeholderOf(slot))).map(slot => slot.label);
};

const slotReferences = (text: string): string[] => [...text.matchAll(SLOT_REFERENCE)].map(match => match[1]);

/**
 * 今の選択で下書きに使う欄の ID（文型にある欄と、選んだ選択肢の文にある欄）。
 * 選んだ選択肢では使わない欄（例: 報告していないときの報告する人）は含めない。画面に出さず、保存も表示もしない。
 */
export const activeSsbjTemplateSlotIds = (
  template: SsbjNarrativeChoiceTemplate,
  input: SsbjNarrativeTemplateInput,
): Set<string> => {
  const inPattern = slotReferences(template.pattern);
  // 選択肢の文の {欄 ID} は 1 段だけ置き換えるので、文型にある欄の選択肢だけを見る（buildSsbjNarrativeDraft と同じ）。
  const inChosenOptions = template.slots
    .filter(slot => inPattern.includes(slot.id))
    .flatMap(slot => slotReferences(chosenOption(slot, input)?.text ?? ''));
  return new Set([...inPattern, ...inChosenOptions]);
};

/**
 * 選択と補足入力を保存用に整える。空の補足入力・「その他」以外の選択肢の補足・今の選択で使わない欄の値は落とす。何も無ければ null。
 * 定義に無い欄は落とさずに残す（検証で知らせるため）。以前の版の選択は、今の定義で使う欄を判断できないので、空の値を落とすだけにする。
 */
export const normalizeSsbjNarrativeTemplateInput = (
  itemId: string,
  input: SsbjNarrativeTemplateInput | null,
): SsbjNarrativeTemplateInput | null => {
  if (!input) return null;
  const template = findSsbjNarrativeChoiceTemplate(itemId);
  const unused = new Set<string>();
  if (template && isCurrentSsbjNarrativeTemplateInput(input)) {
    const active = activeSsbjTemplateSlotIds(template, input);
    for (const slot of template.slots) if (!active.has(slot.id)) unused.add(slot.id);
  }
  const choices = Object.fromEntries(
    Object.entries(input.choices).filter(([slotId, optionId]) => optionId !== '' && !unused.has(slotId)),
  );
  const texts = Object.fromEntries(
    Object.entries(input.texts)
      .map(([slotId, text]) => [slotId, text.trim()] as const)
      .filter(([slotId, text]) => text !== '' && !unused.has(slotId)
        && (!(slotId in choices) || choices[slotId] === SSBJ_TEMPLATE_OTHER_OPTION_ID)),
  );
  if (Object.keys(choices).length === 0 && Object.keys(texts).length === 0) return null;
  return { version: input.version, choices, texts };
};

/** 正規化済みの選択を、項目のテンプレート定義と照らして検証する。問題が無ければ空配列。 */
export const validateSsbjNarrativeTemplateInput = (
  itemId: string,
  input: SsbjNarrativeTemplateInput | null,
): string[] => {
  if (input === null) return [];
  const template = findSsbjNarrativeChoiceTemplate(itemId);
  if (!template) return ['この項目には選択式のテンプレートがありません'];
  // 以前の版の選択は、画面で選び直すまでそのまま残す（勝手に消さない・今の選択肢として解釈しない）。
  if (!isCurrentSsbjNarrativeTemplateInput(input)) return [];
  const errors: string[] = [];
  for (const [slotId, optionId] of Object.entries(input.choices)) {
    const slot = template.slots.find(candidate => candidate.id === slotId);
    const isKnown = slot?.kind === 'choice' && (
      slot.options.some(option => option.id === optionId) || (slot.allowOther && optionId === SSBJ_TEMPLATE_OTHER_OPTION_ID)
    );
    if (!isKnown) errors.push('テンプレートに無い選択肢が含まれています。選び直してください');
  }
  for (const [slotId, text] of Object.entries(input.texts)) {
    const slot = template.slots.find(candidate => candidate.id === slotId);
    if (!slot) errors.push('テンプレートに無い入力欄が含まれています。選び直してください');
    else if (text.length > SSBJ_TEMPLATE_TEXT_MAX_LENGTH) {
      errors.push(`「${slot.label}」は${SSBJ_TEMPLATE_TEXT_MAX_LENGTH}文字以内で入力してください`);
    }
  }
  return [...new Set(errors)];
};

/** 保存済みの値（DB の jsonb）を選択式テンプレートの入力として読む。形が違えば null（黙って補正せず、使わない）。 */
export const parseSsbjNarrativeTemplateInput = (value: unknown): SsbjNarrativeTemplateInput | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { version, choices, texts } = value as Record<string, unknown>;
  const isStringRecord = (record: unknown): record is Record<string, string> =>
    typeof record === 'object' && record !== null && !Array.isArray(record)
    && Object.values(record).every(entry => typeof entry === 'string');
  if (typeof version !== 'string' || !isStringRecord(choices) || !isStringRecord(texts)) return null;
  return { version, choices, texts };
};

/** 保存済みの選択を、画面に出す「欄の名前: 選んだ値」の一覧にする（今の版でないときは空。今の選択で使わない欄は出さない）。 */
export const describeSsbjNarrativeTemplateInput = (
  itemId: string,
  input: SsbjNarrativeTemplateInput | null | undefined,
): { label: string; value: string }[] => {
  const template = findSsbjNarrativeChoiceTemplate(itemId);
  if (!template || !input || !isCurrentSsbjNarrativeTemplateInput(input)) return [];
  const active = activeSsbjTemplateSlotIds(template, input);
  // 選択肢は、選んだ選択肢の名前で出す（下書きの文は {欄 ID} や【 】を含むことがあるため）。
  return template.slots
    .filter(slot => active.has(slot.id))
    .map(slot => ({ label: slot.label, value: chosenOption(slot, input)?.label ?? slotValue(slot, input) }))
    .filter(entry => entry.value !== `【${entry.label}】`);
};
