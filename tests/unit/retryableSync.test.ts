import { describe, expect, it } from 'vitest';
import { isRetryableOutboxAttempt, isTerminalOutboxAttempt, NEVER_RETRY_AT } from '../../src/lib/retryableSync';

describe('reconnect sync retry classification', () => {
  it('allows transient failures scheduled with exponential backoff', () => {
    const retryAt = Date.now() + 5 * 60_000;
    expect(isRetryableOutboxAttempt(retryAt)).toBe(true);
    expect(isTerminalOutboxAttempt(retryAt)).toBe(false);
  });

  it('preserves permanently blocked failures', () => {
    expect(isRetryableOutboxAttempt(NEVER_RETRY_AT)).toBe(false);
    expect(isTerminalOutboxAttempt(NEVER_RETRY_AT)).toBe(true);
  });

  it('rejects invalid retry timestamps as terminal', () => {
    expect(isRetryableOutboxAttempt(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isTerminalOutboxAttempt(Number.POSITIVE_INFINITY)).toBe(true);
  });
});
