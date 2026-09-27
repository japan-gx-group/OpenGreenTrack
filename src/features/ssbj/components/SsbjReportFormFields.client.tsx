'use client';

// SSBJ レポートの基本情報の入力欄（作成ダイアログと詳細画面の編集で共用）。
// 状態と検証は useSsbjReportForm が持ち、ここは入力欄とエラーの描画だけを行う。

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SsbjReportFormController } from '../hooks/useSsbjReportForm';
import {
  SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH,
  SSBJ_REPORT_TEXT_MAX_LENGTH,
  SSBJ_REPORT_TITLE_MAX_LENGTH,
} from '../utils/reportValidation';

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
