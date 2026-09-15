import { scheduleReview } from './spacedRepetition.mjs';

export function scheduleQuranReview(stage, status, now = new Date()) {
  if (status === 'nouveau') return scheduleReview(stage, false, now);
  if (status === 'consolidation') return scheduleReview(stage, true, now);
  const numericStage = Number.isFinite(stage) ? Math.max(0, Math.trunc(stage)) : 0;
  return scheduleReview(Math.max(1, numericStage), true, now);
}
