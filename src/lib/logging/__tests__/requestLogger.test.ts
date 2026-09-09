import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRequestLogger } from '../requestLogger';
import * as currentProfileModule from '@/lib/currentProfile';

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

import { headers } from 'next/headers';

describe('requestLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts custom x-request-id header when provided', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({ 'x-request-id': 'req-12345' }),
    );
    vi.spyOn(currentProfileModule, 'getCurrentProfile').mockResolvedValue(null);

    const reqLogger = await getRequestLogger();
    expect(reqLogger.bindings().requestId).toBe('req-12345');
  });

  it('generates a random UUID if x-request-id header is absent', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({}));
    vi.spyOn(currentProfileModule, 'getCurrentProfile').mockResolvedValue(null);

    const reqLogger = await getRequestLogger();
    expect(reqLogger.bindings().requestId).toBeDefined();
    expect(typeof reqLogger.bindings().requestId).toBe('string');
  });

  it('attaches organizationId and userId when profile is authenticated', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({ 'x-request-id': 'req-999' }),
    );
    vi.spyOn(currentProfileModule, 'getCurrentProfile').mockResolvedValue({
      id: 'user-abc',
      organizationId: 'org-xyz',
      email: 'test@example.com',
      fullName: 'Test User',
      role: 'admin',
    });

    const reqLogger = await getRequestLogger();
    const bindings = reqLogger.bindings();
    expect(bindings.requestId).toBe('req-999');
    expect(bindings.organizationId).toBe('org-xyz');
    expect(bindings.userId).toBe('user-abc');
  });

  it('handles profile resolution errors gracefully without throwing', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({}));
    vi.spyOn(currentProfileModule, 'getCurrentProfile').mockRejectedValue(
      new Error('Auth failed'),
    );

    const reqLogger = await getRequestLogger();
    expect(reqLogger.bindings().requestId).toBeDefined();
    expect(reqLogger.bindings().organizationId).toBeUndefined();
  });
});
