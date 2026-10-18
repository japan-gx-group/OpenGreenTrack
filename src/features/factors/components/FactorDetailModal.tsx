import React from 'react';
import { Database, ExternalLink } from 'lucide-react';
import type { EmissionFactor, FactorRevision } from '../services/factorService';
import { FactorModal } from './FactorModal';
import { deriveFormula } from '../utils/factorFormat';
import { formatDate } from '../utils/formatDate';

type FactorDetailModalProps = {
  factor: EmissionFactor;
  onClose: () => void;
  /** カスタム係数の値・単位の変更履歴（新しい順）。取得中は null */
  revisions?: FactorRevision[] | null;
  revisionsLoadFailed?: boolean;
};

const formatFactorValue = (value: number, unit: string): string => `${value.toFixed(6)} ${unit}`;

// カスタム係数の値・単位の変更履歴。公式係数は組織の履歴を持たないため出さない。
const RevisionList = ({
  revisions,
  loadFailed,
}: {
  revisions: FactorRevision[] | null;
  loadFailed: boolean;
}) => {
  if (loadFailed) {
    return <span className="text-danger">変更履歴の取得に失敗しました</span>;
  }
  if (revisions === null) {
    return <span className="text-text-muted">読み込み中…</span>;
  }
  if (revisions.length === 0) {
    return <span className="text-text-muted">値の変更はありません</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {revisions.map((revision) => (
        <li key={revision.id}>
          <span className="text-text-muted">{formatDate(revision.changedAt)}</span>{' '}
          {formatFactorValue(revision.previousFactorValue, revision.previousUnit)} →{' '}
          {formatFactorValue(revision.newFactorValue, revision.newUnit)}
        </li>
      ))}
    </ul>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs font-semibold text-text-muted">{label}</span>
    <div className="text-sm text-text-main">{children}</div>
  </div>
);

// 係数1件の出典（発行元・年度・資料名・URL）と算定式を確認するモーダル。
export const FactorDetailModal = ({
  factor,
  onClose,
  revisions = null,
  revisionsLoadFailed = false,
}: FactorDetailModalProps) => {
  return (
    <FactorModal title="係数の出典・算定式" icon={Database} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Row label="係数名">
          <span className="font-bold">{factor.name}</span>
        </Row>
        <div className="flex gap-4">
          <div className="flex-1"><Row label="発行元">{factor.source}</Row></div>
          <div className="flex-1"><Row label="適用年度">{factor.applicableYear}年度</Row></div>
        </div>
        <Row label="係数値">{factor.factorValue.toFixed(6)} {factor.unit}</Row>

        {/* 地域概念は廃止済み（regionName は常に「全国」）。事業者別係数の区別は
            供給事業者・メニュー・係数種別（基礎/調整後）が担うため、一覧行と同じ情報を出す。
            事業者に紐づかない係数（標準の全国係数・カスタム係数）では「—」になる。 */}
        <div className="flex gap-4">
          <div className="flex-1"><Row label="供給事業者">{factor.providerName ?? <span className="text-text-muted">—</span>}</Row></div>
          <div className="flex-1"><Row label="メニュー">{factor.menuName ?? <span className="text-text-muted">—</span>}</Row></div>
          <div className="flex-1"><Row label="係数種別">{factor.factorType ?? <span className="text-text-muted">—</span>}</Row></div>
        </div>

        <Row label="出典資料">
          {factor.sourceDocument ? factor.sourceDocument : '（自社設定のため外部出典なし）'}
        </Row>

        <Row label="出典URL">
          {factor.sourceUrl ? (
            <a
              href={factor.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-info hover:underline inline-flex items-center gap-1 break-all"
            >
              {factor.sourceUrl}
              <ExternalLink size={14} />
            </a>
          ) : (
            <span className="text-text-muted">-</span>
          )}
        </Row>

        <Row label="算定式">
          <code
            className="text-sm"
            style={{
              display: 'block',
              backgroundColor: 'var(--color-bg-main)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: '0.75rem 1rem',
            }}
          >
            {deriveFormula(factor)}
          </code>
        </Row>

        {factor.isCustom && (
          <Row label="値の変更履歴">
            <RevisionList revisions={revisions} loadFailed={revisionsLoadFailed} />
          </Row>
        )}
      </div>
    </FactorModal>
  );
};
