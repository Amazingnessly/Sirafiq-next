import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleQuranReview } from '../src/quranScheduling.mjs';

const NOW = new Date('2026-09-15T06:00:00.000Z');

test('À reprendre remet le passage au niveau 0 et le rend dû immédiatement', () => {
  const schedule = scheduleQuranReview(4, 'nouveau', NOW);
  assert.equal(schedule.stage, 0);
  assert.equal(schedule.nextReviewAt, NOW.toISOString());
});

test('En consolidation avance d’un niveau', () => {
  const schedule = scheduleQuranReview(0, 'consolidation', NOW);
  assert.equal(schedule.stage, 1);
  assert.equal(schedule.nextReviewAt, '2026-09-16T06:00:00.000Z');
});

test('Solide démarre au minimum sur un intervalle de trois jours', () => {
  const schedule = scheduleQuranReview(0, 'solide', NOW);
  assert.equal(schedule.stage, 2);
  assert.equal(schedule.nextReviewAt, '2026-09-18T06:00:00.000Z');
});

test('Solide continue ensuite à progresser sans dépasser le plafond', () => {
  assert.equal(scheduleQuranReview(2, 'solide', NOW).stage, 3);
  assert.equal(scheduleQuranReview(99, 'solide', NOW).stage, 5);
});
