'use client';

// TNFD レポートの基本情報の入力欄（作成ダイアログと詳細画面の編集で共用）。
// 状態と検証は useTnfdReportForm が持ち、ここは入力欄とエラーの描画だけを行う。

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { TnfdReportFormController } from '../hooks/useTnfdReportForm';
import {
  TNFD_REPORT_STANDARD_VERSION_MAX_LENGTH,
  TNFD_REPORT_TEXT_MAX_LENGTH,
  TNFD_REPORT_TITLE_MAX_LENGTH,
} from '../utils/reportValidation';

export const TnfdReportFormFields = ({ form }: { form: TnfdReportFormController }) => {
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
          maxLength={TNFD_REPORT_TITLE_MAX_LENGTH}
          placeholder="例: 自然関連財務情報開示（試行）2024年度"
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
          maxLength={TNFD_REPORT_TEXT_MAX_LENGTH}
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
          maxLength={TNFD_REPORT_TEXT_MAX_LENGTH}
          placeholder="例: 当社単体 / 主要な事業所"
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
          maxLength={TNFD_REPORT_STANDARD_VERSION_MAX_LENGTH}
          placeholder="例: Recommendations of the TNFD, October 2026"
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
