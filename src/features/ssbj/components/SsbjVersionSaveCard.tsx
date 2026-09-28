// SSBJ レポートの手動保存（保存版の作成）欄（表示のみ。状態と送信は useSsbjVersionSave が持つ）。
// 保存版はあとから書き換えられず、OGT の算定値などの元データが更新されても保存した時点の内容を再現できる
// （docs/ssbj-spec.md §8）。

import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export interface SsbjVersionSaveCardProps {
  isSaving: boolean;
  errorMessage: string;
  /** 基本情報の編集中など、未保存の入力があって保存版に含められないとき true。 */
  disabled: boolean;
  onSave: () => void;
}

export const SsbjVersionSaveCard = ({
  isSaving,
  errorMessage,
  disabled,
  onSave,
}: SsbjVersionSaveCardProps) => (
  <Card>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-base font-bold">保存版の作成</h2>
        <p className="m-0 mt-2 text-sm text-text-muted">
          {'現在の内容を、あとから書き換えられない保存版として残します。' +
            '保存版は、元データ（OGTの算定値など）が更新されても保存した時点の内容のままです。'}
        </p>
        {disabled && (
          <p className="m-0 mt-2 text-xs text-text-muted">
            基本情報の編集中は保存版を作成できません。先に変更を保存するか、キャンセルしてください。
          </p>
        )}
      </div>
      <Button type="button" disabled={disabled || isSaving} onClick={onSave}>
        <Save size={14} />
        {isSaving ? '保存中...' : '保存版を作成'}
      </Button>
    </div>
    {errorMessage && (
      <div role="alert" className="mt-4 rounded-md bg-danger-light px-4 py-3 text-sm text-danger">
        {errorMessage}
      </div>
    )}
  </Card>
);
