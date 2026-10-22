// 四本柱の文章の選択式テンプレート（試行版）: 要求事項ごとの選択肢・補足入力と、そこから作る下書き。
//
// 穴埋めテンプレート（requirementMaster.ts の template。本文に【 】つきの文例を入れる）とは別に、代表的な項目だけに用意する。
// 下書きは利用者が選んだ値と入力した補足だけから作り、選んでいない欄は【欄の名前】のまま残す（根拠のない内容を補わない）。
// 文型の固定の部分には、会社によって違う事実（範囲・有無・前期の有無など）を書かない。そうした事実は選択肢（否定・未特定も選べる）か【 】にする。
// 選択肢の文に {欄 ID} を含めると、その選択肢を選んだときだけその欄を使う（例: 報告している場合だけ、報告する人・頻度を入れる）。
// 【 】が残った本文は「入力済み」にできない（utils/narrative.ts の検証）ので、下書きがそのまま開示内容として確定することはない。
// 選択肢と文例はチームが作った試行版で、外部の監修は受けていない（docs/ssbj-r1-scope.md §8）。
// 項目 ID は要求項目マスター（暫定版）の ID。マスターの ID が変わったときは、ここの itemId も合わせて直す。

import type { SsbjItemId, SsbjNarrativeTemplateInput } from '../types';

/** テンプレート定義の版。選択肢の ID・文例を変えたら上げる（保存済みの古い選択を、新しい選択肢と取り違えないため）。 */
export const SSBJ_NARRATIVE_CHOICE_TEMPLATE_VERSION = 'r2-trial-3';

/** 補足入力 1 欄の最大文字数。 */
export const SSBJ_TEMPLATE_TEXT_MAX_LENGTH = 500;

/** 「その他」の選択肢 ID。選ぶと、同じ欄 ID の補足入力の文字列を使う。 */
export const SSBJ_TEMPLATE_OTHER_OPTION_ID = 'other';

/** text は下書きに入れる文。{欄 ID} を含めると、その欄の値に置き換える（1 段だけ。補足入力の文字列は置き換えない）。 */
export type SsbjTemplateChoiceOption = { id: string; label: string; text: string };

export type SsbjTemplateSlot =
  | { kind: 'choice'; id: string; label: string; options: SsbjTemplateChoiceOption[]; allowOther: boolean }
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
        kind: 'choice', id: 'reporting', label: '定期的な報告', allowOther: true,
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
        kind: 'choice', id: 'concentration', label: '影響の集中', allowOther: true,
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
        kind: 'choice', id: 'assessment', label: '評価・優先順位付け', allowOther: true,
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
        kind: 'choice', id: 'scenario', label: 'シナリオ分析', allowOther: false,
        options: [
          { id: 'used', label: '用いている', text: 'リスクの識別・評価に、シナリオ分析を用いている。' },
          { id: 'not_used', label: '用いていない', text: 'リスクの識別・評価に、シナリオ分析は用いていない。' },
        ],
      },
      {
        kind: 'choice', id: 'change', label: '前期からの変更', allowOther: true,
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

/** 選んだ選択肢（「その他」・未選択なら undefined）。 */
const chosenOption = (slot: SsbjTemplateSlot, input: SsbjNarrativeTemplateInput): SsbjTemplateChoiceOption | undefined =>
  slot.kind === 'choice' ? slot.options.find(option => option.id === input.choices[slot.id]) : undefined;

/** 1 欄の値。選んでいない・入力していない欄は【欄の名前】。選択肢の文の {欄 ID} はまだ置き換えない。 */
const slotValue = (slot: SsbjTemplateSlot, input: SsbjNarrativeTemplateInput): string => {
  const text = input.texts[slot.id]?.trim() ?? '';
  if (slot.kind === 'text') return text || placeholderOf(slot);
  const choice = input.choices[slot.id];
  if (choice === SSBJ_TEMPLATE_OTHER_OPTION_ID && slot.allowOther) return text || placeholderOf(slot);
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

/** 選択と補足入力を保存用に整える。空の補足入力・「その他」以外の選択肢の補足は落とす。何も無ければ null。 */
export const normalizeSsbjNarrativeTemplateInput = (
  input: SsbjNarrativeTemplateInput | null,
): SsbjNarrativeTemplateInput | null => {
  if (!input) return null;
  const choices = Object.fromEntries(Object.entries(input.choices).filter(([, optionId]) => optionId !== ''));
  const texts = Object.fromEntries(
    Object.entries(input.texts)
      .map(([slotId, text]) => [slotId, text.trim()] as const)
      .filter(([slotId, text]) => text !== '' && (!(slotId in choices) || choices[slotId] === SSBJ_TEMPLATE_OTHER_OPTION_ID)),
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

/** 保存済みの選択を、画面に出す「欄の名前: 選んだ値」の一覧にする（今の版でないときは空）。 */
export const describeSsbjNarrativeTemplateInput = (
  itemId: string,
  input: SsbjNarrativeTemplateInput | null | undefined,
): { label: string; value: string }[] => {
  const template = findSsbjNarrativeChoiceTemplate(itemId);
  if (!template || !input || !isCurrentSsbjNarrativeTemplateInput(input)) return [];
  // 選択肢は、選んだ選択肢の名前で出す（下書きの文は {欄 ID} や【 】を含むことがあるため）。
  return template.slots
    .map(slot => ({ label: slot.label, value: chosenOption(slot, input)?.label ?? slotValue(slot, input) }))
    .filter(entry => entry.value !== `【${entry.label}】`);
};
