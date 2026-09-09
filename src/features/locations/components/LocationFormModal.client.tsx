'use client';

// 拠点の追加/編集モーダル（editingLocationId の有無で内容が切り替わる）。
// 状態と保存処理は useLocationForm が持ち、ここは入力欄を描画する。

import type { RefObject } from 'react';
import { Modal } from '@/components/ui/Modal.client';
import type { LocationFormController } from '../hooks/useLocationForm';
import { LOCATION_NAME_MAX_LENGTH, LOCATION_PERSON_MAX_LENGTH } from '../services/locationValidation';
import {
  LOCATION_STATUS_LABELS,
  LOCATION_STATUSES,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPES,
  REGION_LABELS,
  REGIONS,
  type LocationStatus,
  type LocationType,
  type Region,
} from '../types';

interface LocationFormModalProps {
  form: LocationFormController;
  /** 閉じたあとにフォーカスを戻す要素（行メニューの ⋮） */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export const LocationFormModal = ({ form, returnFocusRef }: LocationFormModalProps) => (
  <Modal isOpen={form.isModalOpen} onClose={form.close} title={form.editingLocationId ? '拠点情報の編集' : '新規拠点の追加'} size="lg" returnFocusRef={returnFocusRef}>
    <form onSubmit={form.submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-text-muted">拠点名称 <span className="text-danger">*</span></label>
        <input
          type="text"
          className="gt-field"
          placeholder="例: 横浜スマートセンター"
          required
          maxLength={LOCATION_NAME_MAX_LENGTH}
          value={form.values.name}
          onChange={e => form.setValues(prev => ({ ...prev, name: e.target.value }))}
        />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-semibold text-text-muted">地域区分</label>
          <select
            className="gt-field"
            value={form.values.region}
            onChange={e => form.setValues(prev => ({ ...prev, region: e.target.value as Region }))}
          >
            {REGIONS.map(region => (
              <option key={region} value={region}>{REGION_LABELS[region]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-semibold text-text-muted">拠点種別</label>
          <select
            className="gt-field"
            value={form.values.type}
            onChange={e => form.setValues(prev => ({ ...prev, type: e.target.value as LocationType }))}
          >
            {LOCATION_TYPES.map(type => (
              <option key={type} value={type}>{LOCATION_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-semibold text-text-muted">管理責任者名</label>
          <input
            type="text"
            className="gt-field"
            placeholder="例: 斉藤 大介"
            maxLength={LOCATION_PERSON_MAX_LENGTH}
            value={form.values.person}
            onChange={e => form.setValues(prev => ({ ...prev, person: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-semibold text-text-muted">稼働状況</label>
          <select
            className="gt-field"
            value={form.values.status}
            onChange={e => form.setValues(prev => ({ ...prev, status: e.target.value as LocationStatus }))}
          >
            {LOCATION_STATUSES.map(status => (
              <option key={status} value={status}>{LOCATION_STATUS_LABELS[status]}</option>
            ))}
          </select>
          {/* 稼働状況が効く先を添える（活動量入力の拠点選択は稼働中・一時停止のみ）。 */}
          <p className="text-xs text-text-muted">
            活動量入力で選べるのは「稼働中」「一時停止」の拠点だけです。
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button type="button" className="gt-btn" onClick={form.close}>
          キャンセル
        </button>
        <button type="submit" className="gt-btn-primary">
          {form.editingLocationId ? '変更を保存' : '保存'}
        </button>
      </div>
    </form>
  </Modal>
);
