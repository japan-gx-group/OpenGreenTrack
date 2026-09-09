import React, { useMemo, useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { EmissionFactor } from '../services/factorService';
import { FactorModal } from './FactorModal';
import {
  isExternalHttpUrl,
  summarizeFactorSources,
  type FactorSourceDocument,
  type FactorSourceSummary,
} from '../utils/factorSources';

type FactorSourceDetailModalProps = {
  factors: EmissionFactor[];
  /**
   * 表示できるソースが無いときの案内文。
   * 読込中・取得失敗でも factors は空になるため、呼び出し側が状況に応じた文言を渡す。
   */
  emptyMessage?: string;
  onClose: () => void;
};

/**
 * 1ソースあたり最初に表示する出典資料の件数。
 * 公式シードのソースは最大7資料のため通常は全件が収まる。自社設定は出典が自由入力
 * （CSVインポート）で件数が読めないため、残りは「他 N 件を表示」で開く。
 */
const INITIAL_DOCUMENT_LIMIT = 10;

const documentKey = (document: FactorSourceDocument): string =>
  `${document.documentName ?? ''}|${document.url ?? ''}`;

const SourceDocumentList = ({ documents }: { documents: FactorSourceDocument[] }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hiddenCount = documents.length - INITIAL_DOCUMENT_LIMIT;
  const visibleDocuments = isExpanded ? documents : documents.slice(0, INITIAL_DOCUMENT_LIMIT);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {visibleDocuments.map((document) => (
          <li key={documentKey(document)} className="text-xs">
            {isExternalHttpUrl(document.url) ? (
              <a
                href={document.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline inline-flex items-start gap-1 break-all"
              >
                <span>{document.documentName ?? document.url}</span>
                <ExternalLink size={13} className="flex-shrink-0" style={{ marginTop: '0.15rem' }} />
              </a>
            ) : (
              // スキーム無し・非http(s) の出典URLはリンクにしない（相対リンク化して壊れるため）
              <span className="break-all">
                {document.documentName ?? document.url ?? '出典なし（社内算定根拠）'}
              </span>
            )}
            <span className="text-text-muted"> / {document.count} 件</span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && !isExpanded && (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="text-info hover:underline text-xs"
          style={{ marginTop: '0.5rem' }}
        >
          他 {hiddenCount} 件を表示
        </button>
      )}
    </>
  );
};

const SourceCard = ({ source }: { source: FactorSourceSummary }) => {
  const Icon = source.icon;

  return (
    <div
      data-source-name={source.name}
      style={{
        backgroundColor: 'var(--color-bg-main)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '1rem 1.25rem',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color: source.isInternal ? 'var(--color-text-muted)' : 'var(--color-primary)' }}>
          <Icon size={18} />
        </span>
        <span className="text-sm font-bold">{source.name}</span>
        <span className="text-xs text-text-muted ml-auto">登録 {source.totalCount} 件</span>
      </div>
      <p className="text-xs text-text-muted mb-2" style={{ lineHeight: 1.6 }}>{source.description}</p>
      <SourceDocumentList documents={source.documents} />
    </div>
  );
};

// 「ソース詳細を確認」から開く。各標準係数ソースの説明・登録件数・公式参照元を提示する。
// 登録0件のソースは、参照元を開いても該当係数が無く出典を誤認させるため表示しない。
// 参照元は定義側にハードコードせず、登録係数の出典（sourceDocumentName / sourceUrl）から
// 資料単位で集計して列挙する。1ソースが複数資料にまたがる場合も画面から辿れる。
export const FactorSourceDetailModal = ({
  factors,
  emptyMessage = '登録済みの標準係数がないため、表示できるソースはありません。',
  onClose,
}: FactorSourceDetailModalProps) => {
  const sourceSummaries = useMemo(() => summarizeFactorSources(factors), [factors]);

  return (
    <FactorModal title="標準係数ソースの詳細" icon={BookOpen} onClose={onClose} maxWidth="640px">
      <p className="text-sm text-text-muted mb-4">
        参照元は登録済み係数の出典（係数詳細の「出典資料」「出典URL」）から集計しています。
        数値は該当資料の値を登録しており、公表の更新に合わせて見直します。
      </p>
      {sourceSummaries.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sourceSummaries.map((source) => (
            <SourceCard key={source.name} source={source} />
          ))}
        </div>
      )}
    </FactorModal>
  );
};
