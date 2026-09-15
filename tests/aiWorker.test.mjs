import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOutputText, parseFlashcardsOutput, validateAiPayload, validateFlashcardPayload } from '../worker/index.mjs';

test('validateAiPayload accepte un contexte et une question valides', () => {
  const result = validateAiPayload({ supportName: 'Cours.pdf', context: 'Un contenu utile.', question: 'Que faut-il retenir ?' });
  assert.equal(result.ok, true);
  assert.equal(result.value.supportName, 'Cours.pdf');
});

test('validateAiPayload refuse une question vide', () => {
  const result = validateAiPayload({ supportName: 'Cours.pdf', context: 'Contenu', question: '   ' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Question/);
});

test('validateAiPayload refuse un contexte trop volumineux', () => {
  const result = validateAiPayload({ supportName: 'Cours.pdf', context: 'a'.repeat(100_001), question: 'Question' });
  assert.equal(result.ok, false);
  assert.match(result.error, /volumineux/);
});

test('validateFlashcardPayload accepte 3 à 10 cartes', () => {
  assert.equal(validateFlashcardPayload({ supportName: 'Cours.pdf', context: 'Contenu', count: 3 }).ok, true);
  assert.equal(validateFlashcardPayload({ supportName: 'Cours.pdf', context: 'Contenu', count: 10 }).ok, true);
});

test('validateFlashcardPayload refuse un nombre de cartes hors limites', () => {
  const tooFew = validateFlashcardPayload({ supportName: 'Cours.pdf', context: 'Contenu', count: 2 });
  const tooMany = validateFlashcardPayload({ supportName: 'Cours.pdf', context: 'Contenu', count: 11 });
  assert.equal(tooFew.ok, false);
  assert.equal(tooMany.ok, false);
});

test('extractOutputText utilise output_text quand il existe', () => {
  assert.equal(extractOutputText({ output_text: '  Réponse directe.  ' }), 'Réponse directe.');
});

test('extractOutputText reconstruit le texte depuis output', () => {
  const response = {
    output: [
      { content: [{ type: 'output_text', text: 'Première partie.' }] },
      { content: [{ type: 'output_text', text: 'Deuxième partie.' }] },
    ],
  };
  assert.equal(extractOutputText(response), 'Première partie.\n\nDeuxième partie.');
});

test('parseFlashcardsOutput normalise les cartes structurées', () => {
  const cards = parseFlashcardsOutput({
    output_text: JSON.stringify({
      cards: [
        { front: '  Question 1 ? ', back: ' Réponse 1. ' },
        { front: 'Question 2 ?', back: 'Réponse 2.' },
      ],
    }),
  });
  assert.deepEqual(cards, [
    { front: 'Question 1 ?', back: 'Réponse 1.' },
    { front: 'Question 2 ?', back: 'Réponse 2.' },
  ]);
});

test('parseFlashcardsOutput refuse un JSON inutilisable', () => {
  assert.deepEqual(parseFlashcardsOutput({ output_text: 'pas du json' }), []);
  assert.deepEqual(parseFlashcardsOutput({ output_text: '{"cards":[{"front":"","back":"x"}]}' }), []);
});
