// レポート出力画面「出力内容のプレビュー」の表示ロジック（純関数）。
// 算定バッチの状態を「レポートに何が載るか」の言葉へ翻訳し、正常時は控えめに・
// 未完了や失敗のときだけ警告として目立たせる判断を一箇所に集める。

/** 算定バッチの状態から導いた、レポート集計値の鮮度の見せ方 */
export type CalculationFreshness = {
  /** ok = 通常表示（完了）。warning = 警告スタイルで注意を促す */
  level: 'ok' | 'warning';
  /** 状態の短い名前（例: 算定完了 / 算定実行中） */
  statusLabel: string;
  /** 警告時のみ: 未完了・失敗だとレポートに何が起きるかの説明 */
  message?: string;
};

// 「集計が古い」は判定しない。dashboard_aggregates の再計算はバッチ確定と同一トランザクション
// （run_calculation_commit）で行われるため、集計更新がバッチ完了より古くなることは通常なく、
// 時刻の前後比較で作った警告は誤検知にしかならない。

/**
 * 算定バッチの状態（BatchStatus = pending / completed / failed。機能仕様 §3.3）を鮮度表示へ変換する。
 * `undefined` はその年度に算定実行の記録が無いこと。集計行だけがある（レコード削除時の再集計や
 * seed 投入）場合に起きるため、エラーではなく「最新でない可能性」として注意を促す。
 */
export const describeCalculationFreshness = (batchStatus: string | undefined): CalculationFreshness => {
  switch (batchStatus) {
    case 'completed':
      return { level: 'ok', statusLabel: '算定完了' };
    case 'pending':
      return {
        level: 'warning',
        statusLabel: '算定実行中',
        message: '完了前に出力すると、実行中の算定の結果はレポートに反映されません。完了してから出力してください。',
      };
    case 'failed':
      return {
        level: 'warning',
        statusLabel: '算定失敗',
        message: '直近の算定が失敗しています。レポートには最後に集計できた内容が載ります。データ入力の内容を確認して算定をやり直してください。',
      };
    case undefined:
      return {
        level: 'warning',
        statusLabel: '算定記録なし',
        message: 'この年度の算定実行の記録がありません。集計値が最新でない可能性があります。',
      };
    default:
      // 未知の状態は隠さず、そのまま表示して注意を促す。
      return {
        level: 'warning',
        statusLabel: `算定状態: ${batchStatus}`,
        message: '算定の状態を判定できません。集計値が最新か確認してから出力してください。',
      };
  }
};
