import type { QuranTarget } from './QuranMemorization';

export type QuranReviewStatus = QuranTarget['status'];
export type QuranReviewSchedule = {
  stage: number;
  lastReviewedAt: string;
  nextReviewAt: string;
};

export function scheduleQuranReview(stage: number | undefined, status: QuranReviewStatus, now?: Date): QuranReviewSchedule;
