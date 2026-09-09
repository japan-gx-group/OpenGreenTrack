// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, keyDown, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import {
  getEmissionFactors,
  updateEmissionFactor,
  type EmissionFactor,
} from '../../services/factorService';
import { fetchIdeaImportOverview } from '../../services/ideaImportClient';
import { Factors } from '../Factors.client';

// 排出係数の編集で出典情報が消える不具合の回帰テスト。
// 「出典資料名・出典URL を持つカスタム係数を画面で開き、係数値だけ変えて保存すると
//   出典情報が消える」不具合を、実際の編集導線（一覧の編集ボタン → 係数値変更 → 保存）で押さえる。
// 出典列は CSV 取込でしか入らず、モーダルに入力欄が無いため、消えると画面から復旧できない。
//
// Supabase を叩く I/O と 2 つの Context フックだけモックし、
// フォームの状態遷移（handleOpenEditModal → factorForm → updateEmissionFactor）は実物を通す。

vi.mock('../../services/factorService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/factorService')>()),
  getEmissionFactors: vi.fn(),
  updateEmissionFactor: vi.fn(),
  addEmissionFactor: vi.fn(),
  deleteEmissionFactor: vi.fn(),
}));

vi.mock('../../services/ideaImportClient', () => ({
  fetchIdeaImportOverview: vi.fn(),
  startIdeaImport: vi.fn(),
  deleteIdeaImport: vi.fn(),
}));

vi.mock('@/hooks/useFiscalYear', () => ({
  useFiscalYear: () => ({
    fiscalYearId: 'fy-2026',
    fiscalYear: '2026',
    fiscalYears: [],
    isLoading: false,
    setFiscalYearId: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: 0, requestRefresh: vi.fn() }),
}));

const SOURCE_DOCUMENT = '電力購入契約（PPA）契約書 別紙2 排出係数';
const SOURCE_URL = 'https://example.invalid/ppa-2026';

/** 出典情報を持つ自組織のカスタム係数（CSV 取込で作られる形） */
const factorWithSource: EmissionFactor = {
  id: 'factor-with-source',
  name: '電気 再エネメニュー（PPA）',
  energyType: '電気',
  scope: 'Scope 2',
  factorValue: 0.000180,
  unit: 't-CO2/kWh',
  applicableYear: 2026,
  region: '全国',
  source: '自社設定',
  status: '有効',
  isCustom: true,
  sourceDocument: SOURCE_DOCUMENT,
  sourceUrl: SOURCE_URL,
};

let view: RenderResult;

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** 制御された <select> の値を変える（React の value 追跡を迂回してネイティブ setter → change）。 */
const setSelectValue = (select: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

/** 一覧を描画し、対象係数の行の「編集」ボタンを押してモーダルを開く */
const openEditModal = async (): Promise<HTMLElement> => {
  view = render(<Factors />);
  await flush();
  await flush();

  const editButton = view.container.querySelector<HTMLButtonElement>('button[title="編集"]');
  if (!editButton) {
    throw new Error('一覧に編集ボタンが見つかりません（カスタム係数の行が描画されていない）');
  }
  click(editButton);

  // 画面には検索用の form もあるため、係数値（number 入力）を持つ編集モーダルの form を選ぶ。
  const form = Array.from(view.container.querySelectorAll<HTMLFormElement>('form')).find(
    (candidate) => candidate.querySelector('input[type="number"]') !== null,
  );
  if (!form) {
    throw new Error('編集モーダルのフォームが開きません');
  }
  return form;
};

beforeEach(() => {
  vi.mocked(getEmissionFactors).mockResolvedValue([factorWithSource]);
  vi.mocked(updateEmissionFactor).mockImplementation(async (_id, factor) => ({
    ...factor,
    id: factorWithSource.id,
  }));
  vi.mocked(fetchIdeaImportOverview).mockResolvedValue({
    activeImport: null,
    processingImport: null,
    imports: [],
  } as unknown as Awaited<ReturnType<typeof fetchIdeaImportOverview>>);
});

afterEach(() => {
  view?.unmount();
  vi.clearAllMocks();
});

describe('排出係数の編集（出典情報の保持）', () => {
  it('係数値だけ変更して保存しても、出典資料名・出典URLが保持されたまま更新される', async () => {
    const form = await openEditModal();

    // 係数値の入力欄（モーダル内で唯一の number 入力）だけを変更する
    const valueInput = form.querySelector<HTMLInputElement>('input[type="number"]');
    expect(valueInput).not.toBeNull();
    setInputValue(valueInput as HTMLInputElement, '0.000250');

    click(form.querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement);
    await flush();

    expect(updateEmissionFactor).toHaveBeenCalledTimes(1);
    const [targetId, saved] = vi.mocked(updateEmissionFactor).mock.calls[0];

    expect(targetId).toBe(factorWithSource.id);
    // 変更したのは係数値だけ
    expect(saved.factorValue).toBe(0.000250);
    // 出典情報が保存内容から欠けていると、DB では null で上書きされて消える
    expect(saved.sourceDocument).toBe(SOURCE_DOCUMENT);
    expect(saved.sourceUrl).toBe(SOURCE_URL);
  });

  it('出典以外の項目（係数名・単位・有効期間）も編集で失われない', async () => {
    const form = await openEditModal();

    const valueInput = form.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(valueInput as HTMLInputElement, '0.000300');
    click(form.querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement);
    await flush();

    const [, saved] = vi.mocked(updateEmissionFactor).mock.calls[0];
    expect(saved.name).toBe(factorWithSource.name);
    expect(saved.unit).toBe(factorWithSource.unit);
    expect(saved.applicableYear).toBe(factorWithSource.applicableYear);
    expect(saved.status).toBe(factorWithSource.status);
    expect(saved.isCustom).toBe(true);
  });
});

// 係数の性質による2分割の回帰テスト。
// 「エネルギー種別」の1軸に燃料種係数と Scope 3 活動係数が混在し、水道・出張などエネルギーでないものが
// 「エネルギー種別」として並んでいた。タブで群を分け、群ごとに軸の呼び名を切り替えることを押さえる。
describe('排出係数の一覧（エネルギー・燃料 / Scope 3 活動のタブ）', () => {
  /** 活動量ベースの Scope 3 活動係数（エネルギーではない） */
  const activityFactor: EmissionFactor = {
    id: 'factor-business-travel',
    name: '出張（支出ベース）',
    energyType: '出張',
    scope: 'Scope 3',
    factorValue: 0.000500,
    unit: 'kg-CO2/円',
    applicableYear: 2026,
    region: '全国',
    source: '環境省',
    status: '有効',
    isCustom: false,
  };

  /** 事業者別係数。providerName を持つのは燃料群（電気・ガス・熱）だけ */
  const providerFactor: EmissionFactor = {
    id: 'factor-provider-electricity',
    name: '電気 事業者別係数（基礎）',
    energyType: '電気',
    scope: 'Scope 2',
    factorValue: 0.000441,
    unit: 't-CO2/kWh',
    applicableYear: 2026,
    region: '全国',
    source: '環境省',
    status: '有効',
    isCustom: false,
    providerName: 'テスト電力',
  };

  const renderList = async (extraFactors: EmissionFactor[] = []): Promise<RenderResult> => {
    vi.mocked(getEmissionFactors).mockResolvedValue([factorWithSource, activityFactor, ...extraFactors]);
    view = render(<Factors />);
    await flush();
    await flush();
    return view;
  };

  const tabButtons = (): HTMLButtonElement[] =>
    Array.from(view.container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));

  /** 一覧テーブルの2列目（種別の列）の見出し */
  const energyColumnHeader = (): string =>
    view.container.querySelectorAll('table.gt-table thead th')[1]?.textContent ?? '';

  const rowNames = (): string[] =>
    Array.from(view.container.querySelectorAll('table.gt-table tbody tr')).map(
      row => row.querySelectorAll('td')[0]?.textContent ?? '',
    );

  it('既定の「エネルギー・燃料係数」タブには燃料種係数だけが並び、列は「エネルギー種別」と呼ぶ', async () => {
    await renderList();

    const [fuelTab, activityTab] = tabButtons();
    expect(fuelTab.getAttribute('aria-selected')).toBe('true');
    expect(fuelTab.textContent).toContain('エネルギー・燃料係数');
    expect(activityTab.textContent).toContain('Scope 3 活動係数');

    expect(energyColumnHeader()).toBe('エネルギー種別');
    expect(rowNames().join('\n')).toContain(factorWithSource.name);
    // 出張はエネルギーではないので、このタブには出さない
    expect(rowNames().join('\n')).not.toContain(activityFactor.name);
  });

  it('「Scope 3 活動係数」タブへ切り替えると活動係数だけが並び、列は「活動カテゴリ」と呼ぶ', async () => {
    await renderList();

    click(tabButtons()[1]);

    expect(energyColumnHeader()).toBe('活動カテゴリ');
    expect(rowNames().join('\n')).toContain(activityFactor.name);
    expect(rowNames().join('\n')).not.toContain(factorWithSource.name);
  });

  it('タブと一覧パネルが aria-controls / aria-labelledby で対応づく', async () => {
    await renderList();

    const [fuelTab, activityTab] = tabButtons();
    const panel = view.container.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(panel).not.toBeNull();

    // どのタブからも同じパネルを指し、パネルは選択中のタブから名前を取る
    expect(fuelTab.getAttribute('aria-controls')).toBe(panel?.id);
    expect(activityTab.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(fuelTab.id);
    // tablist 内は左右キーで移動するため、Tab キーの停止点は選択中のタブだけ
    expect(fuelTab.tabIndex).toBe(0);
    expect(activityTab.tabIndex).toBe(-1);

    click(activityTab);
    expect(panel?.getAttribute('aria-labelledby')).toBe(activityTab.id);
    expect(tabButtons()[1].tabIndex).toBe(0);
    expect(tabButtons()[0].tabIndex).toBe(-1);
  });

  it('左右キーで隣のタブへ移動して切り替わる', async () => {
    await renderList();

    keyDown(tabButtons()[0], 'ArrowRight');
    expect(tabButtons()[1].getAttribute('aria-selected')).toBe('true');
    expect(energyColumnHeader()).toBe('活動カテゴリ');

    // 端では折り返す（APG の tablist と同じ挙動）
    keyDown(tabButtons()[1], 'ArrowRight');
    expect(tabButtons()[0].getAttribute('aria-selected')).toBe('true');
    expect(energyColumnHeader()).toBe('エネルギー種別');
  });

  it('種別の絞り込み候補は開いているタブの群だけになる', async () => {
    await renderList();

    const energySelect = () =>
      Array.from(view.container.querySelectorAll<HTMLSelectElement>('.gt-filter-bar select')).find(
        select => Array.from(select.options).some(option => option.value === '電気' || option.value === '水道'),
      );

    const fuelOptions = Array.from(energySelect()?.options ?? []).map(option => option.value);
    expect(fuelOptions).toContain('電気');
    expect(fuelOptions).not.toContain('水道');

    click(tabButtons()[1]);

    const activityOptions = Array.from(energySelect()?.options ?? []).map(option => option.value);
    expect(activityOptions).toContain('水道');
    expect(activityOptions).not.toContain('電気');
  });

  it('供給事業者で絞り込んだままタブを切り替えると、絞り込みが解除されて0件にならない', async () => {
    await renderList([providerFactor]);

    // 供給事業者フィルタ（「事業者なし」の選択肢を持つ select）
    const providerSelect = (): HTMLSelectElement => {
      const select = Array.from(
        view.container.querySelectorAll<HTMLSelectElement>('.gt-filter-bar select'),
      ).find(candidate => Array.from(candidate.options).some(option => option.value === '事業者なし'));
      if (!select) throw new Error('供給事業者フィルタが見つかりません');
      return select;
    };

    setSelectValue(providerSelect(), providerFactor.providerName!);
    expect(rowNames().join('\n')).toContain(providerFactor.name);
    expect(rowNames().join('\n')).not.toContain(factorWithSource.name);

    // 事業者別係数は燃料群にしか無いため、絞り込みを持ち越すと Scope 3 タブは必ず0件になる（#278 フォロー）
    click(tabButtons()[1]);

    expect(providerSelect().value).toBe('すべて');
    expect(rowNames().join('\n')).toContain(activityFactor.name);

    // 候補も開いているタブの群から作るため、選んでも必ず0件になる事業者名は並ばない
    const activityOptions = Array.from(providerSelect().options).map(option => option.value);
    expect(activityOptions).not.toContain(providerFactor.providerName);
  });
});
