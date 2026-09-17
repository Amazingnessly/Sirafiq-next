import { describe, expect, it } from 'vitest';
import { isRetryableOutboxAttempt, NEVER_RETRY_AT } from '../../src/lib/retryableSync';

describe('reconnect sync retry classification', () => {
  it('allows transient failures scheduled with exponential backoff', () => {
    expect(isRetryableOutboxAttempt(Date.now() + 5 * 60_000)).toBe(true);
  });

  it('preserves permanently blocked failures', () => {
    expect(isRetryableOutboxAttempt(NEVER_RETRY_AT)).toBe(false);
  });

  it('rejects invalid retry timestamps', () => {
    expect(isRetryableOutboxAttempt(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
