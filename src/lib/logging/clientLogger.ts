// ブラウザ側の構造化ログ。サーバ側の Pino logger と同じインターフェース（message + context）
// だが、console.* 経由でブラウザ DevTools へ出力する（process.stderr は使えないため）。
// Client Component から import すること（'use client' 付き）。
'use client';

type LogLevel = 'info' | 'warn' | 'error';

const emit = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn('[GreenTrack]', entry);
};

export const clientLogger = {
  info:  (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn:  (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
