'use client';

// 「標準係数ソース」カード。登録係数から出典を導出して並べ、「ソース詳細を確認」で全件モーダルを開く。

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import type { EmissionFactor } from '../services/factorService';
import { summarizeFactorSources } from '../utils/factorSources';
import { formatDate } from '../utils/formatDate';
import { FactorSourceDetailModal } from './FactorSourceDetailModal';

interface FactorSourcesCardProps {
  database: EmissionFactor[];
  /** 取得・保存・取込のいずれかが進行中 */
  isBusy: boolean;
  loadFailed: boolean;
}

export const FactorSourcesCard = ({ database, isBusy, loadFailed }: FactorSourcesCardProps) => {
  const [isSourceModalOpen, setIsSourceModalOpen] = useState<boolean>(false);

  // 登録0件のソースは、参照元を開いても該当係数が無く出典を誤認させるため表示しない。
  // モーダルと同じ集計（登録係数からの出典導出）を共有する。
  const sourceCards = useMemo(() => {
    return summarizeFactorSources(database).map(source => {
      const latestUpdatedAt = database
        .filter(item => item.source === source.name)
        .map(item => item.updatedAt)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      return {
        ...source,
        date: `${source.totalCount}件 / ${formatDate(latestUpdatedAt)}`,
      };
    });
  }, [database]);

  // 読込中・取得失敗でも sourceCards は空になるため、「本当に未登録」と混同しないよう
  // 状況ごとに文言を出し分ける。null のときだけソースのカード／一覧を描画する。
  const sourcesEmptyMessage = useMemo(() => {
    if (isBusy) return '排出係数を読み込んでいます...';
    if (loadFailed) return '排出係数を取得できなかったため、標準係数ソースを表示できません。';
    if (sourceCards.length === 0) return '登録済みの標準係数がないため、表示できるソースはありません。';
    return null;
  }, [isBusy, loadFailed, sourceCards.length]);

  return (
    <>
      <Card className="gt-col-8">
         <h3 className="gt-card-title mb-4">標準係数ソース</h3>
         {sourcesEmptyMessage ? (
           <p className="text-sm text-text-muted">{sourcesEmptyMessage}</p>
         ) : (
           <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sourceCards.length}, minmax(0, 1fr))`, gap: '1rem' }}>
             {sourceCards.map((s) => (
               <div key={s.name} className="flex flex-col items-center justify-center text-center" style={{ backgroundColor: 'var(--color-bg-main)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: '0.5rem 0.5rem' }}>
                 <div style={{ color: s.isInternal ? 'var(--color-text-muted)' : 'var(--color-primary)' }} className="mb-2">
                   <s.icon size={24} />
                 </div>
                 <div className="text-sm font-bold mb-2 h-10 flex items-center justify-center">{s.name}</div>
                 <div className="text-xs font-medium mb-1 text-success">登録済み</div>
                 <div className="text-xs text-text-muted">{s.date}</div>
               </div>
             ))}
           </div>
         )}
         <div className="text-right text-xs text-text-muted flex justify-between items-center" style={{ marginTop: '0.5rem' }}>
           <span>※ 標準係数は各省庁・団体の公開データを基に定期的に更新しています。</span>
           <button type="button" onClick={() => setIsSourceModalOpen(true)} className="text-info hover:underline flex items-center gap-1">
             ソース詳細を確認 <span style={{fontSize: '0.75rem'}}>↗</span>
           </button>
         </div>
      </Card>

      {isSourceModalOpen && (
        <FactorSourceDetailModal
          factors={database}
          emptyMessage={sourcesEmptyMessage ?? undefined}
          onClose={() => setIsSourceModalOpen(false)}
        />
      )}
    </>
  );
};
