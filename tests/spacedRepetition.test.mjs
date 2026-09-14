import assert from 'node:assert/strict';
import test from 'node:test';
import { isReviewDue, REVIEW_INTERVAL_DAYS, scheduleReview } from '../src/spacedRepetition.mjs';

const NOW = new Date('2026-09-14T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

test('a new card without a review date is due', () => {
  assert.equal(isReviewDue({}, NOW.getTime()), true);
});

test('due detection handles past, exact, future and invalid dates safely', () => {
  assert.equal(isReviewDue({ nextReviewAt: new Date(NOW.getTime() - 1).toISOString() }, NOW.getTime()), true);
  assert.equal(isReviewDue({ nextReviewAt: NOW.toISOString() }, NOW.getTime()), true);
  assert.equal(isReviewDue({ nextReviewAt: new Date(NOW.getTime() + 1).toISOString() }, NOW.getTime()), false);
  assert.equal(isReviewDue({ nextReviewAt: 'date-invalide' }, NOW.getTime()), true);
});

test('a successful first review advances to stage 1 and schedules one day later', () => {
  const result = scheduleReview(0, true, NOW);
  assert.deepEqual(result, {
    stage: 1,
    lastReviewedAt: NOW.toISOString(),
    nextReviewAt: new Date(NOW.getTime() + DAY).toISOString(),
  });
});

test('a failed review resets to stage 0 and remains due immediately', () => {
  const result = scheduleReview(4, false, NOW);
  assert.equal(result.stage, 0);
  assert.equal(result.lastReviewedAt, NOW.toISOString());
  assert.equal(result.nextReviewAt, NOW.toISOString());
  assert.equal(isReviewDue({ nextReviewAt: result.nextReviewAt }, NOW.getTime()), true);
});

test('the final stage is capped and keeps the 30-day interval', () => {
  const result = scheduleReview(REVIEW_INTERVAL_DAYS.length - 1, true, NOW);
  assert.equal(result.stage, REVIEW_INTERVAL_DAYS.length - 1);
  assert.equal(result.nextReviewAt, new Date(NOW.getTime() + 30 * DAY).toISOString());
});

test('corrupt stage values are clamped before scheduling', () => {
  assert.equal(scheduleReview(-12, true, NOW).stage, 1);
  assert.equal(scheduleReview(999, true, NOW).stage, REVIEW_INTERVAL_DAYS.length - 1);
  assert.equal(scheduleReview(Number.NaN, false, NOW).stage, 0);
});

test('an invalid reference date is rejected', () => {
  assert.throws(() => scheduleReview(0, true, new Date(Number.NaN)), RangeError);
});
