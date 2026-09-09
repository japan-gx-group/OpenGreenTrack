import React from 'react';
import { Database, ExternalLink } from 'lucide-react';
import type { EmissionFactor } from '../services/factorService';
import { FactorModal } from './FactorModal';
import { deriveFormula } from '../utils/factorFormat';

type FactorDetailModalProps = {
  factor: EmissionFactor;
  onClose: () => void;
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs font-semibold text-text-muted">{label}</span>
    <div className="text-sm text-text-main">{children}</div>
  </div>
);

// 係数1件の出典（発行元・年度・資料名・URL）と算定式を確認するモーダル。
export const FactorDetailModal = ({ factor, onClose }: FactorDetailModalProps) => {
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
      </div>
    </FactorModal>
  );
};
