'use client';

// 係数管理画面の「IDEAデータベース」カード（docs/idea-scope3-spec.md §5.2）。
// - 取込済み: バージョン・取込日・製品数・引用表記の表示、版更新（再取込）、削除
// - 取込中: idea_imports 行のポーリング
// - 未取込: SuMPO 契約の案内文とリンクを表示
// IDEA はライセンスデータのため、係数一覧テーブル・CSVエクスポートには載せない（§0.2）。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/Modal.client';
import {
  AlertCircle,
  CheckCircle,
  Database,
  ExternalLink,
  Info,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_IDEA_GWP_MODEL,
  IDEA_GWP_MODEL_OPTIONS,
} from '../services/ideaImport';
import {
  deleteIdeaImport,
  fetchIdeaImportOverview,
  startIdeaImport,
  type IdeaImportOverview,
} from '../services/ideaImportClient';

// 取込中の idea_imports 行のポーリング間隔
const POLL_INTERVAL_MS = 2500;

const SUMPO_IDEA_URL = 'https://sumpo.or.jp/consulting/lca/idea/';

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
};

export const IdeaDatabaseCard = () => {
  const [overview, setOverview] = useState<IdeaImportOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 取込フォーム
  const [gwpModel, setGwpModel] = useState<string>(DEFAULT_IDEA_GWP_MODEL);
  const [licenseConfirmed, setLicenseConfirmed] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 削除確認
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchIdeaImportOverview();
      setOverview(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'IDEAデータベースの取込状況の取得に失敗しました');
    }
  }, []);

  // 初回ロード。アンマウント後の setState を避けるため isMounted で握りつぶす
  // （Factors.tsx の初回ロードと同じパターン）。
  useEffect(() => {
    let isMounted = true;
    const initialLoad = async () => {
      try {
        const next = await fetchIdeaImportOverview();
        if (isMounted) {
          setOverview(next);
          setLoadError(null);
        }
      } catch (error) {
        if (isMounted) {
          setLoadError(
            error instanceof Error ? error.message : 'IDEAデータベースの取込状況の取得に失敗しました',
          );
        }
      }
    };
    void initialLoad();
    return () => {
      isMounted = false;
    };
  }, []);

  const isProcessing = overview?.latest?.status === 'processing';

  // 取込中はポーリングで進捗（processing → completed / failed）を追う
  useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isProcessing, refresh]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFile || !licenseConfirmed || isSubmitting || isProcessing) return;

    setIsSubmitting(true);
    setMessage(null);
    try {
      await startIdeaImport(selectedFile, gwpModel, licenseConfirmed);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage({ text: '取込を開始しました。完了までこのカードで進捗を表示します', type: 'success' });
      await refresh();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'IDEAデータベースの取込開始に失敗しました',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    const active = overview?.active;
    if (!active || isDeleting) return;
    setIsDeleting(true);
    setMessage(null);
    try {
      await deleteIdeaImport(active.id);
      setIsDeleteModalOpen(false);
      setMessage({ text: `「${active.fileName}」の取込データを削除しました`, type: 'success' });
      await refresh();
    } catch (error) {
      // 算定結果から参照されている場合の 409（§3.6-4）はモーダルを閉じて理由を表示する
      setIsDeleteModalOpen(false);
      setMessage({
        text: error instanceof Error ? error.message : 'IDEAデータベースの削除に失敗しました',
        type: 'error',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const active = overview?.active ?? null;
  const latest = overview?.latest ?? null;

  return (
    <Card className="flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Database size={20} className="text-primary" />
          <h3 className="text-base font-serif font-semibold" style={{ margin: 0 }}>IDEAデータベース</h3>
          {active && <Badge variant="success">取込済み</Badge>}
          {isProcessing && <Badge variant="warning">取込中</Badge>}
        </div>
        <p className="text-xs text-text-muted">
          AIST-IDEA（BYOライセンス）。Scope3積上げ算定の原単位として使用します
        </p>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'bg-primary-light border-success text-text-main'
              : 'bg-danger-light border-danger text-danger'
          }`}
        >
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span style={{ whiteSpace: 'pre-wrap' }}>{message.text}</span>
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 rounded-md border border-danger bg-danger-light px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} />
          <span>{loadError}</span>
        </div>
      )}

      {/* 取込中の進捗（ポーリング表示） */}
      {isProcessing && latest && (
        <div
          className="flex items-center gap-3 text-sm"
          style={{ padding: '0.75rem 1rem', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}
        >
          <Loader2 size={18} className="animate-spin text-primary" style={{ flexShrink: 0 }} />
          <div>
            <div className="font-medium">「{latest.fileName}」を取込中です…</div>
            <div className="text-xs text-text-muted mt-1">
              数十MBのファイルでは数分かかることがあります。取込中も他の画面へ移動できます。
            </div>
          </div>
        </div>
      )}

      {/* 直近の取込が失敗した場合の理由表示 */}
      {!isProcessing && latest?.status === 'failed' && latest.errorMessage && (
        <div className="rounded-md border border-danger bg-danger-light px-4 py-3">
          <div className="flex items-center gap-2 text-danger text-sm font-semibold mb-1">
            <AlertCircle size={16} />
            取込に失敗しました（{latest.fileName}）
          </div>
          <pre className="text-xs text-text-main" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: '8rem', overflowY: 'auto' }}>
            {latest.errorMessage}
          </pre>
        </div>
      )}

      {/* 版更新で製品コードが消滅し、再選択が必要な明細の警告（§3.6-2） */}
      {!isProcessing && active && active.unmappedRecordCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-warning bg-warning/10 px-4 py-3 text-sm text-text-main">
          <AlertCircle size={16} className="text-warning" style={{ flexShrink: 0 }} />
          <span>
            新しい版に存在しない製品コードがあったため、
            <strong>再選択が必要な明細が {active.unmappedRecordCount} 件</strong>
            あります。データ入力画面で該当明細の製品を選び直してください。
          </span>
        </div>
      )}

      {/* GWP値が空欄で取込対象外になった製品の件数（§4.1-4）。エラーではないため情報表示にとどめる */}
      {!isProcessing && active && active.skippedRowCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-info bg-info/10 px-4 py-3 text-sm text-text-main">
          <Info size={16} className="text-info mt-0.5" style={{ flexShrink: 0 }} />
          <span>
            このファイルには LCIA 結果（GWP値）が空欄の製品が
            <strong> {active.skippedRowCount.toLocaleString('ja-JP')} 件</strong>
            含まれていたため、取込対象外にしました。 これらは水資源のバランス調整用プロセス等、
            IDEA 側で GHG 排出量が設定されていない製品で、Scope3 の原単位としては使用できません。
          </span>
        </div>
      )}

      {active ? (
        <div
          className="text-sm"
          style={{
            backgroundColor: 'var(--color-bg-main)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem 1.5rem',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div>
              <div className="text-xs font-semibold text-text-muted mb-1">バージョン</div>
              <div className="font-medium">{active.version || '-'}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-text-muted mb-1">取込日</div>
              <div className="font-medium">{formatDate(active.createdAt)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-text-muted mb-1">製品数</div>
              <div className="font-medium">{active.rowCount.toLocaleString('ja-JP')}件</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-text-muted mb-1">GWPモデル</div>
              <div className="font-medium" style={{ wordBreak: 'break-all' }}>{active.gwpModel}</div>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xs font-semibold text-text-muted mb-1">引用表記（レポート出典欄に自動記載）</div>
            <div className="text-xs" style={{ wordBreak: 'break-all' }}>{active.citationText}</div>
          </div>
        </div>
      ) : (
        !isProcessing && (
          <div
            className="text-sm"
            style={{
              backgroundColor: 'var(--color-bg-main)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: '1rem 1.5rem',
            }}
          >
            <p className="font-medium mb-1">IDEAデータベースは未取込です</p>
            <p className="text-xs text-text-muted">
              IDEA は有償の商用データベースです。ご利用には一般社団法人サステナブル経営推進機構（SuMPO）との
              ライセンス契約が必要です。契約後に提供される IPCC 版の Excel ファイル
              （LCIA結果に GWP 列を含む版）をこの画面から取り込んでください。
            </p>
            <a
              href={SUMPO_IDEA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-info hover:underline text-xs mt-2 inline-flex items-center gap-1"
            >
              SuMPO IDEA のご案内 <ExternalLink size={12} />
            </a>
          </div>
        )
      )}

      {/* 取込フォーム（初回取込・版更新の再取込で共通） */}
      <form onSubmit={handleSubmit} className="flex-col gap-3" style={{ display: 'flex' }}>
        <div className="flex gap-4 items-end">
          <div className="flex-col gap-1 flex-1" style={{ display: 'flex' }}>
            <label className="text-xs font-semibold text-text-muted" htmlFor="idea-import-file">
              IDEA Excelファイル（.xlsx）
            </label>
            <input
              id="idea-import-file"
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="gt-field"
              style={{ padding: '0.4rem 0.75rem' }}
              disabled={isProcessing || isSubmitting}
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex-col gap-1 flex-1" style={{ display: 'flex' }}>
            <label className="text-xs font-semibold text-text-muted" htmlFor="idea-import-gwp-model">
              GWPモデル
            </label>
            <select
              id="idea-import-gwp-model"
              className="gt-field"
              style={{ height: '40px', padding: '0.5rem 0.75rem' }}
              value={gwpModel}
              disabled={isProcessing || isSubmitting}
              onChange={(event) => setGwpModel(event.target.value)}
            >
              {IDEA_GWP_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="gt-btn-primary"
              disabled={!selectedFile || !licenseConfirmed || isSubmitting || isProcessing}
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {active ? '版を更新（再取込）' : '取り込む'}
            </button>
            {active && (
              <button
                type="button"
                className="gt-btn text-danger"
                disabled={isProcessing || isSubmitting}
                onClick={() => setIsDeleteModalOpen(true)}
              >
                <Trash2 size={16} /> 削除
              </button>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-main" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={licenseConfirmed}
            disabled={isProcessing || isSubmitting}
            onChange={(event) => setLicenseConfirmed(event.target.checked)}
          />
          当組織は SuMPO と IDEA の使用許諾契約を締結しており、このファイルを自組織のために取り込む権利があることを確認しました
        </label>
        <p className="text-xs text-text-muted">
          版更新（再取込）では、未算定の明細は同一製品コードで新しい版へ自動で付け替えられます。
          算定済みの結果は取込時点の係数のまま変わりません。
        </p>
      </form>

      {/* 削除確認 */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          if (!isDeleting) setIsDeleteModalOpen(false);
        }}
        title="IDEAデータベースの削除確認"
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
            <div className="text-sm text-text-main">
              <p>
                取込済みのIDEAデータベース「<strong>{active?.fileName}</strong>」
                （{active?.version || '-'} / {active?.rowCount.toLocaleString('ja-JP')}件）を削除してもよろしいですか？
              </p>
              <p className="mt-2 text-text-muted">
                未算定の明細は製品の参照が外れ、再選択が必要になります。
                算定結果から参照されている場合は削除できません。
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="gt-btn"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="gt-btn-primary bg-danger hover:bg-danger/90 flex items-center gap-2"
              onClick={() => void confirmDelete()}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 size={16} className="animate-spin" />}
              削除する
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
