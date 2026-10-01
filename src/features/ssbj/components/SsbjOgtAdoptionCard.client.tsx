'use client';

// OGT の候補値の採用欄（T08b）。状態と送信は useOgtAdoption / useOgtAdoptionActions が持ち、ここは表示と確認だけ。
// 採用した値は OGT で算定し直しても自動では変わらない（docs/ssbj-spec.md §7）。変わったときは利用者に知らせ、
// 採用し直すかどうかは利用者が決める。

import { useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/datetime';
import type { SsbjGhgAdoption } from '../types';

export interface SsbjOgtAdoptionCardProps {
  adoption: SsbjGhgAdoption | null;
  /** 採用後に OGT の値が変わった区分の名前（変化が無ければ空）。 */
  changedLabels: string[];
  /** 算定済みの候補値が 1 つも無いときは false（採用しても未算定しか残らないため）。 */
  canAdopt: boolean;
  /** 承認済みなど、採用・取り消しをさせないとき true。 */
  locked?: boolean;
  isSubmitting: boolean;
  errorMessage: string;
  onAdopt: () => Promise<boolean>;
  onClear: () => Promise<boolean>;
}

export const SsbjOgtAdoptionCard = ({
  adoption,
  changedLabels,
  canAdopt,
  locked = false,
  isSubmitting,
  errorMessage,
  onAdopt,
  onClear,
}: SsbjOgtAdoptionCardProps) => {
  const [confirming, setConfirming] = useState<'adopt' | 'clear' | null>(null);

  const confirm = async () => {
    const done = confirming === 'adopt' ? await onAdopt() : await onClear();
    if (done) setConfirming(null);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-bold">レポートへの採用</h2>
          {adoption ? (
            <>
              <p className="m-0 mt-2 flex items-center gap-2 text-sm">
                <CheckCircle2 aria-hidden="true" size={16} className="text-primary" />
                採用済み（{formatDateTime(adoption.adoptedAt)}）
              </p>
              {changedLabels.length > 0 ? (
                <p role="alert" className="m-0 mt-2 text-sm text-danger">
                  採用した後で OGT の値が変わりました（{changedLabels.join('、')}）。採用した値は自動では更新されません。
                  内容を確認し、必要なら採用し直してください。
                </p>
              ) : (
                <p className="m-0 mt-2 text-sm text-text-muted">採用した値は、表示中の候補値と同じです。</p>
              )}
            </>
          ) : (
            <p className="m-0 mt-2 text-sm text-text-muted">
              まだ採用していません。候補値を確認して採用すると、レポートの GHG 排出量として使われます。
            </p>
          )}
          <p className="m-0 mt-2 text-xs text-text-muted">
            保存版には、保存版を作成した時点の採用値が固定されます。
          </p>
          {!canAdopt && (
            <p className="m-0 mt-2 text-xs text-text-muted">算定済みの値が無いため、まだ採用できません。</p>
          )}
          {errorMessage && confirming === null && (
            <p role="alert" className="m-0 mt-2 text-sm text-danger">{errorMessage}</p>
          )}
        </div>
        {!locked && <div className="flex flex-wrap gap-2">
          {adoption && (
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setConfirming('clear')}>
              <RotateCcw size={14} /> 採用を取り消す
            </Button>
          )}
          <Button type="button" disabled={!canAdopt || isSubmitting} onClick={() => setConfirming('adopt')}>
            <CheckCircle2 size={14} /> {adoption ? '表示中の候補値で採用し直す' : '表示中の候補値を採用する'}
          </Button>
        </div>}
      </div>

      <Dialog open={confirming !== null} onOpenChange={next => { if (!next && !isSubmitting) setConfirming(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirming === 'adopt' ? '表示中の候補値を採用しますか？' : '採用を取り消しますか？'}</DialogTitle>
            <DialogDescription>
              {confirming === 'adopt'
                ? 'Scope 1・2・3 の合計と Scope 3 の 15 カテゴリをまとめて採用します。採用済みの値があれば置き換えます。' +
                  'OGT の公式係数は実質 CO2 のみで、Scope 2 のロケーション基準・マーケット基準は区別されていません。'
                : '作業中の採用値を消します。作成済みの保存版は変わりません。'}
            </DialogDescription>
          </DialogHeader>
          {errorMessage && (
            <p role="alert" className="m-0 text-sm text-danger">{errorMessage}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setConfirming(null)}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant={confirming === 'clear' ? 'destructive' : 'default'}
              disabled={isSubmitting}
              onClick={() => void confirm()}
            >
              {isSubmitting ? '処理中...' : confirming === 'adopt' ? '採用する' : '取り消す'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
