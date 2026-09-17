import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkAiContext, queryTerms, selectQueryContext } from '../src/aiQueryContext.mjs';

test('queryTerms retire les mots génériques et conserve les notions précises', () => {
  assert.deepEqual(queryTerms('Explique les notions principales sur la mitochondrie et l’ATP.'), ['mitochondrie', 'atp']);
});

test('chunkAiContext découpe un long bloc sans perdre son ordre', () => {
  const text = `${'alpha '.repeat(700)}\n\n${'beta '.repeat(700)}`;
  const chunks = chunkAiContext(text, 1200);
  assert.ok(chunks.length > 2);
  assert.match(chunks[0], /^alpha/);
  assert.match(chunks[chunks.length - 1], /beta/);
});

test('selectQueryContext privilégie un passage pertinent situé loin dans le document', () => {
  const blocks = Array.from({ length: 28 }, (_, index) => `Section ${index + 1}. ${'contenu général sans rapport '.repeat(80)}`);
  blocks[24] = `Section 25. La mitochondrie produit de l’ATP par phosphorylation oxydative. ${'mitochondrie ATP respiration cellulaire '.repeat(50)}`;
  const source = blocks.join('\n\n');
  const result = selectQueryContext(source, 'Quel est le rôle de la mitochondrie dans la production d’ATP ?', 9_000);
  assert.equal(result.reduced, true);
  assert.ok(result.text.length <= 9_000);
  assert.match(result.text, /mitochondrie produit de l’ATP/);
  assert.ok(result.selectedChunks < result.totalChunks);
});

test('selectQueryContext conserve l’ordre source des extraits choisis', () => {
  const source = [
    `Début. ${'introduction générale '.repeat(100)}`,
    `Partie ciblée A sur les ribosomes. ${'ribosome traduction '.repeat(90)}`,
    `Transition. ${'autre contenu '.repeat(100)}`,
    `Partie ciblée B sur les ribosomes. ${'ribosome protéine '.repeat(90)}`,
    `Fin. ${'conclusion générale '.repeat(100)}`,
  ].join('\n\n');
  const result = selectQueryContext(source, 'Comment les ribosomes participent-ils à la synthèse des protéines ?', 7_000);
  const first = result.text.indexOf('Partie ciblée A');
  const second = result.text.indexOf('Partie ciblée B');
  assert.ok(first >= 0);
  assert.ok(second > first);
});

test('une question générale reçoit un échantillon réparti dans le contexte', () => {
  const blocks = Array.from({ length: 24 }, (_, index) => `Bloc-${index + 1} ${'texte de cours '.repeat(110)}`);
  const source = blocks.join('\n\n');
  const result = selectQueryContext(source, 'Quels sont les points essentiels à retenir de ce support ?', 8_000);
  assert.equal(result.reduced, true);
  assert.match(result.text, /Bloc-1/);
  assert.match(result.text, /Bloc-24/);
  assert.ok(result.text.length <= 8_000);
});

test('un contexte déjà court est transmis sans modification', () => {
  const source = 'Petit contexte complet.';
  assert.deepEqual(selectQueryContext(source, 'Question précise ?', 32_000), {
    text: source,
    reduced: false,
    selectedChunks: 1,
    totalChunks: 1,
  });
});
