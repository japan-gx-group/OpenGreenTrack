// 構造化ログユーティリティ（Pino）。サーバ側の全 console.* を置き換える。
// JSON 行を stdout/stderr へ出力し、ホスト側のログ基盤がそのまま取り込める形式。
// 開発環境では pino-pretty で人間可読な出力にする。
//
// ⚠️ サーバ専用: pino は Node ランタイム前提のため Client Component から import しないこと
// （ブラウザ側は src/lib/logging/clientLogger.ts を使う）。
//
// 使い方:
//   import { logger } from '@/lib/logging/logger';
//   logger.error({ jobId, error }, '解析に失敗しました');
//
// リクエストコンテキスト付きの子ロガーが必要な場合:
//   import { getRequestLogger } from '@/lib/logging/requestLogger';
//   const log = await getRequestLogger();
//   log.error({ batchId, error }, '算定バッチの取得に失敗');

import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

// logger 本体と同じ設定でテスト用インスタンスを組み立てられるよう外出ししている
// （logger.test.ts が出力を捕捉して検証するため）。アプリ側は logger を使うこと。
export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',

  // pid / hostname は出さず、ログ集約ツール側の付与に任せる（null が pino 公式の指定方法）
  base: null,

  // Error インスタンスは JSON.stringify すると {} になり message も stack も消えるため、
  // pino 標準の err シリアライザを error キーにも適用する。
  // （pino がデフォルトで面倒を見るのは err キーだけ。本アプリの呼び出しは error キーに統一している）
  // Error 以外（Supabase の PostgrestError など素のオブジェクト）はそのまま通る。
  serializers: {
    error: pino.stdSerializers.err,
  },

  // 万一パスワードやトークンがコンテキストに紛れ込んだ場合に備える
  redact: {
    paths: [
      'password',
      'token',
      'authorization',
      'apiKey',
      'secret',
      'cookie',
      '*.password',
      '*.token',
      '*.authorization',
      '*.apiKey',
      '*.secret',
      '*.cookie',
    ],
    censor: '[REDACTED]',
  },

  // 開発環境のみ人間可読な出力（本番は JSON 行）
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  }),
};

export const logger = pino(loggerOptions);
