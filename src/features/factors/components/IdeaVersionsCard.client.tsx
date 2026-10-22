'use client';

// 「IDEAの版と算定年度」カード（docs/idea-scope3-spec.md §3.6-5・§5.2）。
// 会計年度ごとに使う IDEA の版を選び、取込履歴（版・取込日・割り当て年度・算定での使用件数）を表示する。
// 状態と操作は useIdeaVersionHistory が持ち、ここは表示と入力だけを担う。

import { AlertCircle, History, Loader2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/Modal.client';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import type { IdeaVersionHistoryController } from '../hooks/useIdeaVersionHistory';
import { deleteBlockedReason } from '../utils/ideaFiscalYearAssignment';
import { formatDate } from '../utils/formatDate';

// 年度の選択肢で「割り当てない（有効な版を使う）」を表す値
const USE_ACTIVE_VALUE = '';

interface IdeaVersionsCardProps {
  versions: IdeaVersionHistoryController;
  /** 会計年度（開始日の昇順で並べ替えて表示する） */
  fiscalYears: FiscalYearOption[];
}

export const IdeaVersionsCard = ({ versions, fiscalYears }: IdeaVersionsCardProps) => {
  const { history } = versions;
  const imports = history?.imports ?? [];
  const activeImport = imports.find((record) => record.isActive) ?? null;
  const assignedImportIdByFiscalYear = new Map(
    (history?.assignments ?? []).map((assignment) => [assignment.fiscalYearId, assignment.importId] as const),
  );
  const sortedFiscalYears = [...fiscalYears].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const fiscalYearLabelsByImportId = (importId: string): string[] =>
    sortedFiscalYears
      .filter((fiscalYear) => assignedImportIdByFiscalYear.get(fiscalYear.id) === importId)
      .map((fiscalYear) => fiscalYear.label);

  return (
    <Card className="flex-col gap-4">
      <div className="flex items-center gap-2">
        <History size={20} className="text-primary" />
        <h3 className="text-base font-serif font-semibold" style={{ margin: 0 }}>IDEAの版と算定年度</h3>
      </div>
      <p className="text-sm text-text-muted">
        会計年度ごとに、Scope3 積上げ算定に使う IDEA の版を選べます。割り当てていない年度は有効な版を使います。
        版を割り当てると、その年度の未算定のデータが割り当てた版の製品に付け替わります（算定済みのデータは変わりません）。
      </p>

      {versions.loadError ? (
        <p className="text-sm text-danger">{versions.loadError}</p>
      ) : history === null ? (
        <p className="text-sm text-text-muted">取込履歴を読み込んでいます...</p>
      ) : imports.length === 0 ? (
        <p className="text-sm text-text-muted">
          IDEAデータベースが未取込です。上の「IDEAデータベース」カードから取り込むと、ここで年度ごとの版を選べます。
        </p>
      ) : (
        <>
          <section className="flex-col gap-2" aria-labelledby="idea-versions-fiscal-years">
            <h4 id="idea-versions-fiscal-years" className="text-sm font-semibold text-text-main" style={{ margin: 0 }}>
              年度ごとの版
            </h4>
            {sortedFiscalYears.length === 0 ? (
              <p className="text-sm text-text-muted">
                算定年度が未登録です。企業・メンバー設定の「算定年度の管理」で登録してください。
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="gt-table min-w-[480px]">
                  <thead>
                    <tr>
                      <th scope="col">算定年度</th>
                      <th scope="col">使う版</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFiscalYears.map((fiscalYear) => {
                      const selectId = `idea-version-${fiscalYear.id}`;
                      const isPending = versions.pendingFiscalYearId === fiscalYear.id;
                      return (
                        <tr key={fiscalYear.id}>
                          <td>
                            <label htmlFor={selectId}>{fiscalYear.label}</label>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <select
                                id={selectId}
                                className="gt-field gt-field-select"
                                value={assignedImportIdByFiscalYear.get(fiscalYear.id) ?? USE_ACTIVE_VALUE}
                                disabled={versions.pendingFiscalYearId !== null}
                                onChange={(event) =>
                                  void versions.assign(
                                    fiscalYear,
                                    event.target.value === USE_ACTIVE_VALUE ? null : event.target.value,
                                  )
                                }
                              >
                                <option value={USE_ACTIVE_VALUE}>
                                  {activeImport ? `有効な版を使う（${activeImport.version}）` : '有効な版を使う（有効な版なし）'}
                                </option>
                                {imports.map((record) => (
                                  <option key={record.id} value={record.id}>
                                    {record.version}（{formatDate(record.createdAt)} 取込）
                                  </option>
                                ))}
                              </select>
                              {isPending && <Loader2 size={16} className="animate-spin text-primary" aria-label="変更中" />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex-col gap-2" aria-labelledby="idea-versions-history">
            <h4 id="idea-versions-history" className="text-sm font-semibold text-text-main" style={{ margin: 0 }}>
              取込履歴
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="gt-table min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col">版</th>
                    <th scope="col">GWPモデル</th>
                    <th scope="col">取込日</th>
                    <th scope="col">製品数</th>
                    <th scope="col">割り当て年度</th>
                    <th scope="col">算定での使用</th>
                    <th scope="col">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((record) => {
                    const blockedReason = deleteBlockedReason(record, history);
                    const assignedLabels = fiscalYearLabelsByImportId(record.id);
                    return (
                      <tr key={record.id}>
                        <td>
                          <span className="font-medium">{record.version || '-'}</span>{' '}
                          {record.isActive && <Badge variant="success">有効な版</Badge>}
                        </td>
                        <td className="text-sm">{record.gwpModel}</td>
                        <td>{formatDate(record.createdAt)}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{record.rowCount.toLocaleString('ja-JP')}件</td>
                        <td>{assignedLabels.length > 0 ? assignedLabels.join('・') : <span className="text-text-muted">—</span>}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {(history.referenceCountByImportId[record.id] ?? 0).toLocaleString('ja-JP')}件
                        </td>
                        <td>
                          <button
                            type="button"
                            className="gt-btn flex items-center gap-1"
                            onClick={() => versions.requestDelete(record)}
                            disabled={blockedReason !== null}
                            title={blockedReason ?? `${record.version} を削除する`}
                            aria-label={`${record.version || record.fileName} を削除`}
                          >
                            <Trash2 size={14} />
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-text-muted">
              削除できるのは、有効な版でなく、算定年度に割り当てておらず、算定結果でも使われていない版だけです。
            </p>
          </section>
        </>
      )}

      <Modal
        isOpen={versions.importToDelete !== null}
        onClose={versions.cancelDelete}
        title="IDEAデータベースの版の削除確認"
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
            <div className="text-sm text-text-main">
              <p>
                IDEAデータベース {versions.importToDelete?.version || '-'}（{versions.importToDelete?.fileName}）を削除してもよろしいですか？
              </p>
              <p className="mt-2 text-text-muted">この版の製品を選んでいる未算定の明細は、製品の選び直しが必要になります。</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="gt-btn" onClick={versions.cancelDelete} disabled={versions.isDeleting}>
              キャンセル
            </button>
            <button
              type="button"
              className="gt-btn-primary bg-danger hover:bg-danger/90 flex items-center gap-2"
              onClick={() => void versions.confirmDelete()}
              disabled={versions.isDeleting}
            >
              {versions.isDeleting && <Loader2 size={16} className="animate-spin" />}
              削除する
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
