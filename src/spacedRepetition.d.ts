export type ReviewTiming = { nextReviewAt?: string };
export type ReviewSchedule = { stage: number; lastReviewedAt: string; nextReviewAt: string };

export const REVIEW_INTERVAL_DAYS: readonly [0, 1, 3, 7, 14, 30];
export function isReviewDue(card: ReviewTiming, nowMs?: number): boolean;
export function scheduleReview(stage: number, success: boolean, now?: Date): ReviewSchedule;
