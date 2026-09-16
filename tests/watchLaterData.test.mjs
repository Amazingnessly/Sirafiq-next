import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWatchUrl, validateWatchItems } from '../src/watchLaterData.mjs';

test('normalizeWatchUrl accepte seulement HTTP(S) et canonicalise l’adresse', () => {
  assert.equal(normalizeWatchUrl('  https://EXAMPLE.com:443/cours  '), 'https://example.com/cours');
  assert.equal(normalizeWatchUrl('http://example.com'), 'http://example.com/');
  assert.equal(normalizeWatchUrl('javascript:alert(1)'), null);
  assert.equal(normalizeWatchUrl('data:text/html,test'), null);
  assert.equal(normalizeWatchUrl('pas une url'), null);
});

test('validateWatchItems normalise une file valide tout en gardant les anciens éléments sans priorité', () => {
  const result = validateWatchItems([
    {
      id: ' item-1 ',
      title: ' Cours ',
      url: 'https://EXAMPLE.com:443/video',
      collection: ' Formation ',
      status: 'À voir',
      resumeNote: '  18:40  ',
      addedAt: '2026-09-15T08:00:00.000Z',
    },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, [{
    id: 'item-1',
    title: 'Cours',
    url: 'https://example.com/video',
    collection: 'Formation',
    status: 'À voir',
    resumeNote: '18:40',
    addedAt: '2026-09-15T08:00:00.000Z',
  }]);
});

test('validateWatchItems rejette protocole dangereux, état invalide et identifiants dupliqués', () => {
  const base = {
    id: 'a', title: 'Vidéo', url: 'https://example.com/video', collection: 'Général', status: 'À voir', addedAt: '2026-09-15T08:00:00.000Z',
  };
  assert.equal(validateWatchItems([{ ...base, url: 'javascript:alert(1)' }]).ok, false);
  assert.equal(validateWatchItems([{ ...base, status: 'Inconnu' }]).ok, false);
  assert.equal(validateWatchItems([base, { ...base, title: 'Autre' }]).ok, false);
});

test('validateWatchItems rejette les dates et champs structurels incohérents', () => {
  const base = {
    id: 'a', title: 'Vidéo', url: 'https://example.com/video', collection: 'Général', status: 'En cours', priority: 'Maintenant', addedAt: '2026-09-15T08:00:00.000Z',
  };
  assert.equal(validateWatchItems([{ ...base, addedAt: 'pas une date' }]).ok, false);
  assert.equal(validateWatchItems([{ ...base, lastOpenedAt: 'pas une date' }]).ok, false);
  assert.equal(validateWatchItems([{ ...base, priority: 'Urgent' }]).ok, false);
  assert.equal(validateWatchItems([{ ...base, title: '' }]).ok, false);
});
