'use client';

// SSBJ レポートの基本情報の入力欄（作成ダイアログと詳細画面の編集で共用）。
// 状態と検証は useSsbjReportForm が持ち、ここは入力欄とエラーの描画だけを行う。

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SsbjReportFormController } from '../hooks/useSsbjReportForm';
import {
  SSBJ_MEASUREMENT_APPROACHES,
  SSBJ_MEASUREMENT_APPROACH_LABELS,
  SSBJ_PARENT_RELATIONSHIPS,
  SSBJ_PARENT_RELATIONSHIP_LABELS,
} from '../types';
import {
  SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH,
  SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH,
  SSBJ_REPORT_TEXT_MAX_LENGTH,
  SSBJ_REPORT_TITLE_MAX_LENGTH,
} from '../utils/reportValidation';
import { SICS_INDUSTRIES, SICS_SECTORS } from '../utils/sicsIndustries';

export const SsbjReportFormFields = ({ form }: { form: SsbjReportFormController }) => {
  const id = useId();
  const errorId = `${id}-errors`;
  const hasErrors = form.errors.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-title`}>
          レポート名 <span className="text-danger">*</span>
        </Label>
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={SSBJ_REPORT_TITLE_MAX_LENGTH}
          placeholder="例: サステナビリティ関連財務開示（試行）2024年度"
          value={form.values.title}
          disabled={form.isSaving}
          aria-describedby={hasErrors ? errorId : undefined}
          onChange={event => form.setField('title', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-purpose`}>作成目的</Label>
        <Textarea
          id={`${id}-purpose`}
          name="purpose"
          maxLength={SSBJ_REPORT_TEXT_MAX_LENGTH}
          placeholder="例: 社内での記載内容の確認"
          value={form.values.purpose}
          disabled={form.isSaving}
          onChange={event => form.setField('purpose', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-reporting-scope`}>報告範囲</Label>
        <Textarea
          id={`${id}-reporting-scope`}
          name="reportingScope"
          maxLength={SSBJ_REPORT_TEXT_MAX_LENGTH}
          placeholder="例: 当社単体 / 連結子会社を含む"
          value={form.values.reportingScope}
          disabled={form.isSaving}
          onChange={event => form.setField('reportingScope', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-standard-version`}>参照する基準の版</Label>
        <Input
          id={`${id}-standard-version`}
          name="standardVersion"
          maxLength={SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH}
          value={form.values.standardVersion}
          disabled={form.isSaving}
          onChange={event => form.setField('standardVersion', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-parent-company-name`}>親会社名</Label>
        <Input
          id={`${id}-parent-company-name`}
          name="parentCompanyName"
          maxLength={SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH}
          placeholder="例: 架空ホールディングス株式会社"
          value={form.values.parentCompanyName}
          disabled={form.isSaving}
          onChange={event => form.setField('parentCompanyName', event.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={`${id}-parent-relationship`}>親会社との関係</Label>
          <select
            id={`${id}-parent-relationship`}
            name="parentRelationship"
            className="gt-field gt-field-select"
            value={form.values.parentRelationship}
            disabled={form.isSaving}
            onChange={event => form.setField('parentRelationship', event.target.value)}
          >
            <option value="">未選択</option>
            {SSBJ_PARENT_RELATIONSHIPS.map(relationship => (
              <option key={relationship} value={relationship}>
                {SSBJ_PARENT_RELATIONSHIP_LABELS[relationship]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-40 flex-col gap-1.5">
          <Label htmlFor={`${id}-ownership-percentage`}>親会社の持分比率（%）</Label>
          <Input
            id={`${id}-ownership-percentage`}
            name="ownershipPercentage"
            inputMode="decimal"
            placeholder="例: 80"
            value={form.values.ownershipPercentage}
            disabled={form.isSaving}
            onChange={event => form.setField('ownershipPercentage', event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-measurement-approach`}>測定アプローチ</Label>
        <select
          id={`${id}-measurement-approach`}
          name="measurementApproach"
          className="gt-field gt-field-select"
          value={form.values.measurementApproach}
          disabled={form.isSaving}
          onChange={event => form.setField('measurementApproach', event.target.value)}
        >
          <option value="">未選択</option>
          {SSBJ_MEASUREMENT_APPROACHES.map(approach => (
            <option key={approach} value={approach}>
              {SSBJ_MEASUREMENT_APPROACH_LABELS[approach]}
            </option>
          ))}
        </select>
        <p className="m-0 text-xs text-text-muted">
          温室効果ガス排出を集計する範囲の決め方です。親会社が選んだアプローチに合わせてください。
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-industry-code`}>業種（SICS）</Label>
        <select
          id={`${id}-industry-code`}
          name="industryCode"
          className="gt-field gt-field-select"
          value={form.values.industryCode}
          disabled={form.isSaving}
          onChange={event => form.setField('industryCode', event.target.value)}
        >
          <option value="">未選択</option>
          {SICS_SECTORS.map(sector => (
            <optgroup key={sector.prefix} label={sector.label}>
              {SICS_INDUSTRIES.filter(industry => industry.code.startsWith(`${sector.prefix}-`)).map(industry => (
                <option key={industry.code} value={industry.code}>
                  {industry.code} {industry.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="m-0 text-xs text-text-muted">
          産業別ガイダンスで参照する産業です。複数の事業がある場合は主な事業の産業を選んでください。
        </p>
      </div>

      {hasErrors && (
        <ul id={errorId} role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-danger">
          {form.errors.map(error => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
