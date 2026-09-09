'use client';

// カスタム係数の作成・編集モーダル。状態と保存処理は useFactorForm が持ち、ここは入力欄を描画する。
// Escape・dialog セマンティクス・フォーカス管理は共通シェルの FactorModal に任せる。

import { Database } from 'lucide-react';
import type { FactorFormController } from '../hooks/useFactorForm';
import { scopeLabelForEnergyLabel, type EmissionFactor } from '../services/factorService';
import { FactorModal } from './FactorModal';
import { FACTOR_GROUPS, FACTOR_GROUP_LABELS, energyLabelsInGroup } from '../utils/factorGroups';
import { energyTypeOptions } from '../utils/energyTypeOptions';
import { defaultUnitForEnergy, defaultFactorForEnergy, unitOptionsFor } from '../utils/unitOptions';

/** Scope 区分の補足（表示のみ。値そのものは種別から決まる）。 */
const SCOPE_DESCRIPTIONS: Record<EmissionFactor['scope'], string> = {
  'Scope 1': ' (直接排出)',
  'Scope 2': ' (間接排出)',
  'Scope 3': ' (その他)',
};

interface FactorFormModalProps {
  form: FactorFormController;
  /** 適用年度の候補（降順） */
  availableYears: number[];
}

export const FactorFormModal = ({ form, availableYears }: FactorFormModalProps) => {
  if (!form.isModalOpen) return null;

  return (
    <FactorModal
      title={form.editingFactorId ? '排出係数の編集' : '新規排出係数の登録'}
      icon={Database}
      onClose={form.close}
      maxWidth="550px"
    >
      <form onSubmit={form.submit} className="flex-col gap-4">
        <div className="flex-col gap-1">
          <label className="text-xs font-semibold text-text-muted">係数名称 <span className="text-danger">*</span></label>
          <input
            type="text"
            className="gt-field"
            placeholder="例: 都市ガス（自社算定値）"
            required
            value={form.values.name}
            onChange={e => form.setValues(prev => ({ ...prev, name: e.target.value }))}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-col gap-1 flex-1">
            <label className="text-xs font-semibold text-text-muted">エネルギー種別・活動カテゴリ</label>
            {/* 一覧のタブと同じ2群で optgroup にまとめる。フラットに21件並べると、
                エネルギーでないもの（水道・出張・購入した製品・サービス）が
                「エネルギー種別」の候補として混ざって見える。 */}
            <select
              className="gt-field"
              value={form.values.energyType}
              onChange={e => {
                const energyType = e.target.value as EmissionFactor['energyType'];
                // 種別に応じた既定単位と目安の係数値を自動セットする
                // （どちらも下のプルダウン/入力欄で上書き可能）。Scope だけは上書きできない。
                form.setValues(prev => ({
                  ...prev,
                  energyType,
                  scope: scopeLabelForEnergyLabel(energyType),
                  unit: defaultUnitForEnergy(energyType),
                  factorValue: defaultFactorForEnergy(energyType),
                }));
              }}
            >
              {FACTOR_GROUPS.map(group => (
                <optgroup key={group} label={FACTOR_GROUP_LABELS[group]}>
                  {energyLabelsInGroup(group, energyTypeOptions).map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="flex-col gap-1 flex-1">
            <label className="text-xs font-semibold text-text-muted" htmlFor="factor-scope">Scope区分</label>
            {/* Scope は選ばせない。種別と食い違う Scope の係数で算定すると、集計は係数の Scope で
                積むのにレポートのデータ充足状況は種別から Scope を判定するため、同じ排出量が
                どの集計にも載らないまま「算定済み」と数えられる。種別から一意に決める。
                disabled ではなく readOnly にしてタブ順に残し、なぜ入力できないのかを
                aria-describedby の補足で読み上げ利用者にも伝える。 */}
            <input
              id="factor-scope"
              type="text"
              className="gt-field"
              value={`${form.values.scope}${SCOPE_DESCRIPTIONS[form.values.scope]}`}
              readOnly
              aria-readonly
              aria-describedby="factor-scope-hint"
            />
            <span id="factor-scope-hint" className="text-xs text-text-muted">エネルギー種別・活動カテゴリから自動で決まります</span>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-col gap-1 flex-1">
            <label className="text-xs font-semibold text-text-muted">係数値 <span className="text-danger">*</span></label>
            <input
              type="number"
              step="0.000001"
              min="0"
              className="gt-field"
              required
              value={form.values.factorValue}
              onChange={e => form.setValues(prev => ({ ...prev, factorValue: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div className="flex-col gap-1 flex-1">
            <label className="text-xs font-semibold text-text-muted">単位</label>
            {/* エネルギー種別の選択で既定単位が自動セットされる。ここでは候補から変更のみ可能。 */}
            <select
              className="gt-field"
              required
              value={form.values.unit}
              onChange={e => form.setValues(prev => ({ ...prev, unit: e.target.value }))}
            >
              {unitOptionsFor(form.values.energyType, form.values.unit).map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-col gap-1 flex-1">
            <label className="text-xs font-semibold text-text-muted">適用年度</label>
            <select
              className="gt-field"
              value={form.values.applicableYear}
              onChange={e => form.setValues(prev => ({ ...prev, applicableYear: parseInt(e.target.value, 10) }))}
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}年度</option>
              ))}
            </select>
          </div>
          <div className="flex-col gap-1 flex-1">
            <label className="text-xs font-semibold text-text-muted">データソース</label>
            <input
              type="text"
              className="gt-field"
              required
              value="自社設定"
              disabled
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" className="gt-btn" onClick={form.close}>
            キャンセル
          </button>
          <button type="submit" className="gt-btn-primary">
            {form.editingFactorId ? '更新' : '保存'}
          </button>
        </div>
      </form>
    </FactorModal>
  );
};
