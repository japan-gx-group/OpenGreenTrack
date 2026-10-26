'use client';

// 入力履歴の行クリックで開く編集モーダル。統合フォームを edit モードで流用し、初期値を差し込む。
// 状態と更新・削除処理は useActivityRecordEditor が持つ。

import type { ActivityRecordEditor } from '../hooks/useActivityRecordEditor';
import type { ManualEntryLocationOption, SavedManualActivityRecord } from '../types';
import { ActivityEntryForm } from './ActivityEntryForm.client';

interface ActivityRecordEditModalProps {
  editor: ActivityRecordEditor;
  locations: ManualEntryLocationOption[];
  /** 対象年月などの変更が別レコードと重複するときの事前警告に使う入力履歴。 */
  historyRecords: SavedManualActivityRecord[];
  /** 帳票を足す・外したあとに呼ぶ（入力履歴の帳票の数を取り直す）。 */
  onEvidenceChange?: () => void;
}

export const ActivityRecordEditModal = ({
  editor,
  locations,
  historyRecords,
  onEvidenceChange,
}: ActivityRecordEditModalProps) => {
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
          historyRecords={historyRecords}
          // 編集中のレコード自身は重複に数えない。モーダル内から別レコードへ乗り換えると
          // 編集中の内容が黙って消えるため「既存のレコードを開く」導線は出さない。
          excludeRecordId={editor.editingRecord.id}
          // 帳票の欄は、この記録に紐づいている帳票を読み、足す・外すをその場で反映する。
          recordId={editor.editingRecord.id}
          onEvidenceChange={onEvidenceChange}
        />
      </div>
    </div>
  );
};
