// logger の「出力されたJSON行」に対する検証。
// 特に error キーの Error は、素の JSON.stringify では {} になり message も stack も消える。
// このPRの目的（本番の失敗を事後に追跡する）が壊れる致命的な挙動なので、必ずここで担保する。
import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { loggerOptions } from '../logger';

/** loggerOptions と同じ設定で書き込み先だけ差し替え、出力された1行をパースして返す。 */
const captureLog = (emit: (log: pino.Logger) => void): Record<string, unknown> => {
  const lines: string[] = [];
  const log = pino(loggerOptions, {
    write: (chunk: string) => {
      lines.push(chunk);
    },
  });
  emit(log);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
};

describe('logger', () => {
  it('serializes an Error on the error key with its message and stack', () => {
    const entry = captureLog((log) =>
      log.error({ error: new Error('DB接続に失敗'), jobId: 'job-1' }, '解析に失敗しました'),
    );

    const error = entry.error as Record<string, unknown>;
    expect(error.message).toBe('DB接続に失敗');
    expect(typeof error.stack).toBe('string');
    expect(error.stack as string).toContain('DB接続に失敗');
    expect(entry.jobId).toBe('job-1');
    expect(entry.msg).toBe('解析に失敗しました');
  });

  it('keeps the fields of a plain error object (Supabase PostgrestError)', () => {
    const entry = captureLog((log) =>
      log.error(
        { error: { message: 'duplicate key', code: '23505', details: 'Key (id)=(1) exists' } },
        '保存に失敗しました',
      ),
    );

    const error = entry.error as Record<string, unknown>;
    expect(error.message).toBe('duplicate key');
    expect(error.code).toBe('23505');
    expect(error.details).toBe('Key (id)=(1) exists');
  });

  it('does not throw when error is null (Supabase は error が null のまま失敗分岐に入ることがある)', () => {
    const entry = captureLog((log) => log.error({ error: null }, '原本の取得に失敗しました'));

    expect(entry.error).toBeNull();
    expect(entry.msg).toBe('原本の取得に失敗しました');
  });

  it('serializes an Error inherited from a child logger context', () => {
    const entry = captureLog((log) =>
      log
        .child({ requestId: 'req-1', component: 'processJob' })
        .error({ error: new Error('解析に失敗') }, 'ジョブが失敗しました'),
    );

    expect(entry.requestId).toBe('req-1');
    expect(entry.component).toBe('processJob');
    expect((entry.error as Record<string, unknown>).message).toBe('解析に失敗');
  });

  it('redacts credentials at the top level and one level deep', () => {
    const entry = captureLog((log) =>
      log.error(
        { password: 'pw', apiKey: 'key', context: { token: 'tk', secret: 'sc' } },
        '認証情報のマスク確認',
      ),
    );

    expect(entry.password).toBe('[REDACTED]');
    expect(entry.apiKey).toBe('[REDACTED]');
    const context = entry.context as Record<string, unknown>;
    expect(context.token).toBe('[REDACTED]');
    expect(context.secret).toBe('[REDACTED]');
  });

  it('omits pid and hostname so the log platform can supply them', () => {
    const entry = captureLog((log) => log.info('起動しました'));

    expect(entry.pid).toBeUndefined();
    expect(entry.hostname).toBeUndefined();
  });
});
