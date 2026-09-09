import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clientLogger } from '../clientLogger';

describe('clientLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits info log with prefix and context', () => {
    clientLogger.info('test message', { userId: '123' });
    expect(console.info).toHaveBeenCalledWith(
      '[OpenGreenTrack]',
      expect.objectContaining({
        level: 'info',
        message: 'test message',
        userId: '123',
      }),
    );
  });

  it('emits warn log to console.warn', () => {
    clientLogger.warn('warning test', { detail: 'abc' });
    expect(console.warn).toHaveBeenCalledWith(
      '[OpenGreenTrack]',
      expect.objectContaining({
        level: 'warn',
        message: 'warning test',
        detail: 'abc',
      }),
    );
  });

  it('emits error log to console.error', () => {
    clientLogger.error('error occurred', { errorCode: 500 });
    expect(console.error).toHaveBeenCalledWith(
      '[OpenGreenTrack]',
      expect.objectContaining({
        level: 'error',
        message: 'error occurred',
        errorCode: 500,
      }),
    );
  });
});
