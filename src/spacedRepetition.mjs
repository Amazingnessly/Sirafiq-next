const DAY = 24 * 60 * 60 * 1000;

export const REVIEW_INTERVAL_DAYS = Object.freeze([0, 1, 3, 7, 14, 30]);

export function isReviewDue(card, nowMs = Date.now()) {
  if (!card.nextReviewAt) return true;
  const nextReviewMs = Date.parse(card.nextReviewAt);
  return !Number.isFinite(nextReviewMs) || nextReviewMs <= nowMs;
}

export function scheduleReview(stage, success, now = new Date()) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('Invalid review date.');

  const maximumStage = REVIEW_INTERVAL_DAYS.length - 1;
  const numericStage = Number.isFinite(stage) ? Math.trunc(stage) : 0;
  const currentStage = Math.min(maximumStage, Math.max(0, numericStage));
  const nextStage = success ? Math.min(maximumStage, currentStage + 1) : 0;
  const lastReviewedAt = now.toISOString();
  const nextReviewAt = new Date(nowMs + REVIEW_INTERVAL_DAYS[nextStage] * DAY).toISOString();

  return { stage: nextStage, lastReviewedAt, nextReviewAt };
}
