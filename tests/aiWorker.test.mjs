import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOutputText, validateAiPayload } from '../worker/index.js';

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
