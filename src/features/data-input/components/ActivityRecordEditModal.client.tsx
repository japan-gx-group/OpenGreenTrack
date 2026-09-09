'use client';

// 入力履歴の行クリックで開く編集モーダル。統合フォームを edit モードで流用し、初期値を差し込む。
// 状態と更新・削除処理は useActivityRecordEditor が持つ。

import type { ActivityRecordEditor } from '../hooks/useActivityRecordEditor';
import type { ManualEntryLocationOption } from '../types';
import { ActivityEntryForm } from './ActivityEntryForm.client';

interface ActivityRecordEditModalProps {
  editor: ActivityRecordEditor;
  locations: ManualEntryLocationOption[];
}

export const ActivityRecordEditModal = ({ editor, locations }: ActivityRecordEditModalProps) => {
  if (!editor.editingRecord || !editor.initialValues) return null;

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!editor.isDeleting) editor.close();
      }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Scope3積上げ行も同じフォームで編集する（カテゴリ・製品・自動単位を保つ。
            Scope 1・2 との保存経路またぎは不可）。key でレコードごとにフォームの state を作り直す。 */}
        <ActivityEntryForm
          key={editor.editingRecord.id}
          mode="edit"
          locations={locations}
          initialValues={editor.initialValues}
          onSave={editor.save}
          onCancel={editor.close}
          onDelete={editor.deleteRecord}
          isDeleting={editor.isDeleting}
        />
      </div>
    </div>
  );
};
