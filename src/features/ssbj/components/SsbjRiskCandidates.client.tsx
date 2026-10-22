'use client';

// 業種から出したリスク・機会の候補の欄（リスク・機会画面）。業種はレポートの基本情報の業種（SICS）を起点にする。
// 候補ごとに「採用して登録」（登録フォームを候補の内容で開く。利用者が修正して登録する）と「除外」（理由が必須）ができる。
// 候補を採用・除外しても、該当性・重要性は確定しないことを欄の先頭に出す（判断は該当性・重要性の画面で行う）。
// 判断の保存は呼び出し側（SsbjRisksOpportunities）が持ち、ここは表示と入力だけ。

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  SSBJ_RISK_OPPORTUNITY_KIND_LABELS,
  SSBJ_RISK_TYPE_LABELS,
  type SsbjRiskCandidateDecision,
  type SsbjRiskOpportunity,
} from '../types';
import {
  SSBJ_CANDIDATE_REASON_MAX_LENGTH,
  ssbjCandidateStatus,
  ssbjIndustryCandidatesFor,
  type SsbjIndustryCandidate,
} from '../utils/industryCandidates';
import { formatLinkTargetWithLabel } from '../utils/riskOpportunity';
import { findSicsIndustry, formatSicsIndustry, sicsGuidanceUrl } from '../utils/sicsIndustries';

interface SsbjRiskCandidatesProps {
  reportId: string;
  /** レポートの基本情報の業種（SICS の産業コード）。 */
  industryCode: string | null;
  decisions: SsbjRiskCandidateDecision[];
  items: SsbjRiskOpportunity[];
  readOnly: boolean;
  onAdopt: (candidate: SsbjIndustryCandidate) => void;
  onExclude: (candidate: SsbjIndustryCandidate, reason: string) => Promise<void>;
  onUndo: (candidate: SsbjIndustryCandidate) => Promise<void>;
}

const CandidateRow = ({
  candidate,
  decision,
  items,
  readOnly,
  onAdopt,
  onExclude,
  onUndo,
}: {
  candidate: SsbjIndustryCandidate;
  decision: SsbjRiskCandidateDecision | undefined;
  items: SsbjRiskOpportunity[];
} & Pick<SsbjRiskCandidatesProps, 'readOnly' | 'onAdopt' | 'onExclude' | 'onUndo'>) => {
  const [isExcluding, setIsExcluding] = useState(false);
  const [reason, setReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const status = ssbjCandidateStatus(decision, new Set(items.map(item => item.id)));
  const adopted = status === 'adopted' ? items.find(item => item.id === decision?.riskOpportunityId) : undefined;

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError('');
    try {
      await action();
      setIsExcluding(false);
      setReason('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存に失敗しました');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <li data-testid="ssbj-risk-candidate" data-candidate-id={candidate.id} className="flex flex-col gap-2 rounded-md border border-border px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={candidate.kind === 'risk' ? 'warning' : 'success'}>
          {SSBJ_RISK_OPPORTUNITY_KIND_LABELS[candidate.kind]}
          {candidate.riskType && `（${SSBJ_RISK_TYPE_LABELS[candidate.riskType]}）`}
        </Badge>
        <span className="text-sm font-semibold">{candidate.title}</span>
        {status === 'adopted' && <Badge variant="accent">採用済み</Badge>}
        {status === 'adopted_removed' && <Badge variant="neutral">採用済み（登録したリスク・機会は削除済み）</Badge>}
        {status === 'excluded' && <Badge variant="neutral">除外</Badge>}
      </div>
      <p className="m-0 text-xs text-text-muted">候補にした理由（試行版）: {candidate.basis}</p>
      <p className="m-0 text-xs text-text-muted">
        関連する項目: {candidate.linkTargets.map(formatLinkTargetWithLabel).join('、')}
      </p>
      {adopted && <p className="m-0 text-xs">登録したリスク・機会: {adopted.title}</p>}
      {status === 'excluded' && decision?.reason && (
        <p className="m-0 text-xs">除外した理由（開示しない）: {decision.reason}</p>
      )}
      {!readOnly && (
        isExcluding ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`${candidate.title} を除外する理由`}
              className="min-w-64 flex-1"
              maxLength={SSBJ_CANDIDATE_REASON_MAX_LENGTH}
              placeholder="例: 当社は該当する設備を持たないため"
              value={reason}
              disabled={isBusy}
              onChange={event => setReason(event.target.value)}
            />
            <Button type="button" size="sm" disabled={isBusy} onClick={() => void run(() => onExclude(candidate, reason))}>
              除外を保存
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => setIsExcluding(false)}>
              やめる
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {status !== 'adopted' && (
              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => onAdopt(candidate)}>
                採用して登録
              </Button>
            )}
            {status === 'undecided' && (
              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => setIsExcluding(true)}>
                除外
              </Button>
            )}
            {(status === 'excluded' || status === 'adopted_removed') && (
              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void run(() => onUndo(candidate))}>
                未検討に戻す
              </Button>
            )}
            {status === 'adopted' && (
              // 登録したリスク・機会が残ったまま取り消して再採用すると、同じものが重複して登録される（DB の RLS も止める）。
              <p className="m-0 self-center text-xs text-text-muted">
                未検討に戻すには、先に登録したリスク・機会を一覧から削除してください。
              </p>
            )}
          </div>
        )
      )}
      {error && <p role="alert" className="m-0 text-xs text-danger">{error}</p>}
    </li>
  );
};

export const SsbjRiskCandidates = ({ reportId, industryCode, decisions, ...rest }: SsbjRiskCandidatesProps) => {
  const groups = ssbjIndustryCandidatesFor(industryCode);
  const industry = groups.industryCode ? findSicsIndustry(groups.industryCode) : undefined;
  const decisionOf = (candidateId: string) => decisions.find(decision => decision.candidateId === candidateId);
  const renderList = (candidates: SsbjIndustryCandidate[]) => (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {candidates.map(candidate => (
        <CandidateRow key={candidate.id} candidate={candidate} decision={decisionOf(candidate.id)} {...rest} />
      ))}
    </ul>
  );

  return (
    <Card data-testid="ssbj-risk-candidates">
      <h2 className="m-0 mb-2 text-base font-bold">業種から出したリスク・機会の候補（試行版）</h2>
      <p role="note" className="m-0 mb-3 text-xs text-text-muted">
        候補は検討の出発点です。採用・除外しても、リスク・機会の内容や該当性・重要性は確定しません
        （採用すると、名称・区分・関連する項目だけを入れた登録フォームが開きます。説明・時間軸は自社の事実で入力し、
        該当性・重要性は「該当性・重要性」の画面で判断してください）。候補はチームが作った試行版で、外部の監修は受けていません。
      </p>
      {industry ? (
        <p className="m-0 mb-3 text-sm">
          業種: {formatSicsIndustry(industry.code)}（基本情報の業種）{' '}
          <a href={sicsGuidanceUrl(industry)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">
            産業別ガイダンス（第 {industry.volume} 巻）で確かめる
          </a>
        </p>
      ) : (
        <p className="m-0 mb-3 text-sm text-text-muted">
          業種が選ばれていないため、業種の候補は出していません。{' '}
          <Link href={`/ssbj/${encodeURIComponent(reportId)}`} className="font-semibold text-primary hover:underline">
            レポート詳細の基本情報
          </Link>
          で業種（SICS）を選ぶと出ます。全業種に共通の候補は下に出します。
        </p>
      )}
      {industry && (
        <section className="mb-4">
          <h3 className="m-0 mb-2 text-sm font-bold">この業種の候補（{groups.industry.length}件）</h3>
          {groups.industry.length > 0 ? renderList(groups.industry) : (
            <p className="m-0 text-xs text-text-muted">この業種向けの候補はまだ用意していません。全業種に共通の候補を参考にしてください。</p>
          )}
        </section>
      )}
      <section>
        <h3 className="m-0 mb-2 text-sm font-bold">全業種に共通の候補（{groups.common.length}件）</h3>
        {renderList(groups.common)}
      </section>
    </Card>
  );
};
