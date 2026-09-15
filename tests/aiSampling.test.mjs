import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleLongText, selectPdfSamplePages } from '../src/aiSampling.mjs';

test('selectPdfSamplePages conserve toutes les pages des petits PDF', () => {
  assert.deepEqual(selectPdfSamplePages(5), [1, 2, 3, 4, 5]);
});

test('selectPdfSamplePages répartit les pages du début à la fin', () => {
  assert.deepEqual(selectPdfSamplePages(100, 5), [1, 26, 51, 75, 100]);
});

test('sampleLongText conserve début, milieu et fin sous la limite demandée', () => {
  const source = Array.from({ length: 4000 }, (_, index) => String(index % 10)).join('');
  const sampled = sampleLongText(source, 1000);
  assert.equal(sampled.truncated, true);
  assert.ok(sampled.text.length <= 1000);
  assert.match(sampled.text, /\[Début du document\]/);
  assert.match(sampled.text, /\[Milieu du document\]/);
  assert.match(sampled.text, /\[Fin du document\]/);
  assert.ok(sampled.text.includes(source.slice(0, 80)));
  assert.ok(sampled.text.includes(source.slice(-80)));
});

test('sampleLongText laisse un texte court intact', () => {
  assert.deepEqual(sampleLongText('Texte court', 100), { text: 'Texte court', truncated: false });
});
