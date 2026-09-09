'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { getOrganization, updateOrganization } from '../services/organizationService';
import type { OrganizationInfo } from '../types';

interface CompanyInfoFormData {
  name: string;
  corporateNumber: string;
  industrySector: string;
  address: string;
  envManagerName: string;
  // select 用に文字列で保持（''=未設定、'1'〜'12'）。
  fiscalYearStartMonth: string;
}

const toFormData = (org: OrganizationInfo): CompanyInfoFormData => ({
  name: org.name,
  corporateNumber: org.corporateNumber,
  industrySector: org.industrySector,
  address: org.address,
  envManagerName: org.envManagerName,
  fiscalYearStartMonth: org.fiscalYearStartMonth ? String(org.fiscalYearStartMonth) : '',
});

const monthLabel = (month: number | null): string => (month ? `${month}月` : '—');

export const CompanyInfo = ({
  showToast,
  onSaved,
}: {
  showToast: (message: string, type: 'success' | 'error') => void;
  onSaved?: () => void;
}) => {
  const [organization, setOrganization] = useState<OrganizationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<CompanyInfoFormData | null>(null);
  const [errors, setErrors] = useState<{ corporateNumber?: string }>({});

  useEffect(() => {
    let active = true;
    getOrganization()
      .then((org) => {
        if (!active) return;
        setOrganization(org);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : '企業情報の取得に失敗しました');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const startEditing = () => {
    if (!organization) return;
    setFormData(toFormData(organization));
    setErrors({});
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setErrors({});
    setIsEditing(false);
    setFormData(null);
  };

  const validate = (data: CompanyInfoFormData): boolean => {
    const newErrors: { corporateNumber?: string } = {};
    // 法人番号は任意。入力する場合のみ13桁の数字であることを要求する。
    if (data.corporateNumber && !/^\d{13}$/.test(data.corporateNumber)) {
      newErrors.corporateNumber = '法人番号は13桁の数字である必要があります。';
    }
    // 企業名エラーで early return せず、法人番号エラーも同時に表示する。
    setErrors(newErrors);
    const nameMissing = !data.name.trim();
    if (nameMissing) {
      showToast('企業名は必須です', 'error');
    }
    return !nameMissing && Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!formData || !organization) return;
    if (!validate(formData)) return;

    setSaving(true);
    try {
      const updated = await updateOrganization(organization.id, {
        name: formData.name,
        corporateNumber: formData.corporateNumber,
        industrySector: formData.industrySector,
        address: formData.address,
        envManagerName: formData.envManagerName,
        fiscalYearStartMonth: formData.fiscalYearStartMonth
          ? Number(formData.fiscalYearStartMonth)
          : null,
      });
      setOrganization(updated);
      setIsEditing(false);
      setFormData(null);
      showToast('企業情報を保存しました', 'success');
      onSaved?.();
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : '企業情報の保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => (prev ? { ...prev, [name]: value } : prev));
  };

  if (loading) {
    return (
      <Card className="flex flex-col gap-4">
        <h2 className="font-serif font-semibold text-lg text-text-heading">企業情報</h2>
        <p className="text-sm text-text-muted py-4">読み込み中...</p>
      </Card>
    );
  }

  if (loadError || !organization) {
    return (
      <Card className="flex flex-col gap-4">
        <h2 className="font-serif font-semibold text-lg text-text-heading">企業情報</h2>
        <p className="text-sm text-danger py-4">{loadError ?? '企業情報を取得できませんでした'}</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h2 className="font-serif font-semibold text-lg text-text-heading flex items-center gap-2">企業情報</h2>
        {!isEditing ? (
          <button type="button" onClick={startEditing} className="gt-btn text-xs">
            編集
          </button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={cancelEditing} className="gt-btn text-xs" disabled={saving}>
              キャンセル
            </button>
            <button type="button" onClick={handleSave} className="gt-btn-primary text-xs" disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        )}
      </div>
      <hr className="border-border" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="companyName" className="text-sm font-semibold text-text-muted">
            企業名
          </label>
          {isEditing && formData ? (
            <input
              id="companyName"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="gt-field"
            />
          ) : (
            <p className="font-medium text-text-main py-2">{organization.name}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="corporateNumber" className="text-sm font-semibold text-text-muted">
            法人番号
          </label>
          {isEditing && formData ? (
            <div>
              <input
                id="corporateNumber"
                name="corporateNumber"
                value={formData.corporateNumber}
                onChange={handleChange}
                className={`gt-field ${errors.corporateNumber ? 'border-danger' : ''}`}
                maxLength={13}
              />
              {errors.corporateNumber && (
                <p className="text-danger text-xs mt-1.5">{errors.corporateNumber}</p>
              )}
            </div>
          ) : (
            <p className="font-medium text-text-main py-2">{organization.corporateNumber || '—'}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="industrySector" className="text-sm font-semibold text-text-muted">
            業種
          </label>
          {isEditing && formData ? (
            <input
              id="industrySector"
              name="industrySector"
              value={formData.industrySector}
              onChange={handleChange}
              className="gt-field"
            />
          ) : (
            <p className="font-medium text-text-main py-2">{organization.industrySector || '—'}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="address" className="text-sm font-semibold text-text-muted">
            本社所在地
          </label>
          {isEditing && formData ? (
            <input
              id="address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              className="gt-field"
            />
          ) : (
            <p className="font-medium text-text-main py-2">{organization.address || '—'}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="envManagerName" className="text-sm font-semibold text-text-muted">
            環境管理者
          </label>
          {isEditing && formData ? (
            <input
              id="envManagerName"
              name="envManagerName"
              value={formData.envManagerName}
              onChange={handleChange}
              className="gt-field"
            />
          ) : (
            <p className="font-medium text-text-main py-2">{organization.envManagerName || '—'}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="fiscalYearStartMonth" className="text-sm font-semibold text-text-muted">
            算定年度の開始月
          </label>
          {isEditing && formData ? (
            <div>
              <select
                id="fiscalYearStartMonth"
                name="fiscalYearStartMonth"
                value={formData.fiscalYearStartMonth}
                onChange={handleChange}
                className="gt-field"
              >
                <option value="">未設定</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={String(month)}>
                    {month}月
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted mt-1.5">
                算定年度を追加するときの開始月として使います。未設定の場合は4月開始です。
              </p>
            </div>
          ) : (
            <p className="font-medium text-text-main py-2">
              {monthLabel(organization.fiscalYearStartMonth)}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
