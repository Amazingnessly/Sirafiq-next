import { useState } from 'react';
import type { Flashcard } from './Flashcards';
import { mutateSupportMetadata } from './storage';
import './ai-practice-quiz.css';

type QuizCard = { front: string; back: string };
type StoredSupport = { id: string; flashcards?: Flashcard[]; [key: string]: unknown };

type Props = {
  supportId: string;
  supportName: string;
  context: string;
  accessToken: string;
};

function cardSignature(card: { front: string; back: string }) {
  return `${card.front.trim().toLocaleLowerCase('fr')}\u0000${card.back.trim().toLocaleLowerCase('fr')}`;
}

export function AiPracticeQuiz({ supportId, supportName, context, accessToken }: Props) {
  const [cards, setCards] = useState<QuizCard[]>([]);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [missed, setMissed] = useState<QuizCard[]>([]);
  const [missedSaved, setMissedSaved] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const resetSession = () => {
    setCards([]);
    setIndex(0);
    setDraft('');
    setRevealed(false);
    setMissed([]);
    setMissedSaved(false);
    setCorrectCount(0);
    setCompleted(false);
  };

  const generate = async () => {
    if (generating) return;
    if (!accessToken.trim()) {
      setError('Saisis d’abord le code d’accès IA dans le panneau principal.');
      return;
    }
    setGenerating(true);
    resetSession();
    setStatus('Préparation de 5 questions de rappel actif…');
    setError('');
    try {
      const response = await fetch('/api/ai/flashcards', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sirafiq-ai-token': accessToken.trim(),
        },
        body: JSON.stringify({ supportName, context, count: 5 }),
      });
      const data = await response.json().catch(() => null) as { cards?: QuizCard[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Impossible de préparer le quiz.');
      if (!Array.isArray(data?.cards) || data.cards.length !== 5) throw new Error('Le quiz reçu est incomplet.');
      setCards(data.cards);
      setStatus('Quiz prêt. Réponds sans regarder le support, puis compare.');
    } catch (reason) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : 'Impossible de préparer le quiz.');
    } finally {
      setGenerating(false);
    }
  };

  const evaluate = (success: boolean) => {
    const card = cards[index];
    if (!card || !revealed) return;
    if (success) setCorrectCount(value => value + 1);
    else setMissed(current => [...current, card]);

    if (index >= cards.length - 1) {
      setCompleted(true);
      setStatus('Séance terminée.');
      return;
    }
    setIndex(value => value + 1);
    setDraft('');
    setRevealed(false);
  };

  const saveMissed = async () => {
    if (!missed.length || saving || missedSaved) return;
    setSaving(true);
    setError('');
    setStatus('Ajout des questions à reprendre…');
    try {
      const now = new Date().toISOString();
      let addedCount = 0;
      await mutateSupportMetadata<StoredSupport>(supportId, current => {
        const existing = current.flashcards ?? [];
        const signatures = new Set(existing.map(cardSignature));
        const additions: Flashcard[] = missed
          .filter(card => {
            const signature = cardSignature(card);
            if (signatures.has(signature)) return false;
            signatures.add(signature);
            return true;
          })
          .map(card => ({
            id: crypto.randomUUID(),
            front: card.front.trim(),
            back: card.back.trim(),
            stage: 0,
            createdAt: now,
          }));
        addedCount = additions.length;
        return additions.length ? { ...current, flashcards: [...existing, ...additions] } : current;
      });
      setMissedSaved(true);
      setStatus(addedCount
        ? `${addedCount} question${addedCount > 1 ? 's' : ''} à reprendre ajoutée${addedCount > 1 ? 's' : ''} aux cartes mémoire.`
        : 'Ces questions existent déjà dans les cartes mémoire. Aucun doublon n’a été ajouté.');
    } catch (reason) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : 'Impossible d’enregistrer les questions à reprendre.');
    } finally {
      setSaving(false);
    }
  };

  const current = cards[index];

  return <section className="ai-panel ai-quiz-panel">
    <div className="ai-quiz-head">
      <div>
        <p className="eyebrow">RAPPEL ACTIF · QUIZ</p>
        <h2>Teste-toi sans enregistrer d’abord</h2>
        <p>Sirāfiq génère cinq questions depuis le support. Écris ta réponse avant de voir la correction ; à la fin, tu peux transformer uniquement tes erreurs en cartes mémoire.</p>
      </div>
      {!cards.length && <button className="primary" type="button" disabled={generating} onClick={() => void generate()}>{generating ? 'Préparation…' : 'Démarrer un quiz de 5 questions'}</button>}
    </div>

    {status && <p className="ai-card-status" role="status">{status}</p>}
    {error && <p className="ai-error-message" role="alert">{error}</p>}

    {cards.length > 0 && !completed && current && <div className="ai-quiz-session">
      <div className="ai-quiz-progress"><strong>Question {index + 1} / {cards.length}</strong><span>{correctCount} maîtrisée{correctCount > 1 ? 's' : ''} · {missed.length} à reprendre</span></div>
      <article className="ai-quiz-question"><span>Question</span><h3>{current.front}</h3></article>
      <label className="ai-quiz-draft">Ta restitution
        <textarea value={draft} disabled={revealed} onChange={event => setDraft(event.target.value)} placeholder="Réponds de mémoire avant de comparer…" />
      </label>
      {!revealed ? <button className="primary" type="button" disabled={!draft.trim()} onClick={() => setRevealed(true)}>Comparer avec la réponse</button> : <>
        <div className="ai-quiz-compare">
          <article><span>Ta réponse</span><p>{draft.trim()}</p></article>
          <article><span>Réponse attendue</span><p>{current.back}</p></article>
        </div>
        <div className="ai-quiz-evaluation" aria-label="Auto-évaluation"><button type="button" onClick={() => evaluate(false)}>À reprendre</button><button className="primary" type="button" onClick={() => evaluate(true)}>Je l’avais</button></div>
      </>}
    </div>}

    {cards.length > 0 && completed && <div className="ai-quiz-summary">
      <strong>{correctCount} / {cards.length} maîtrisée{correctCount > 1 ? 's' : ''}</strong>
      <p>{missed.length ? `${missed.length} question${missed.length > 1 ? 's' : ''} mérite${missed.length > 1 ? 'nt' : ''} une nouvelle révision.` : 'Toutes les questions ont été maîtrisées pendant cette séance.'}</p>
      <div className="ai-card-actions">
        <button type="button" disabled={saving || generating} onClick={() => void generate()}>Nouveau quiz</button>
        {missed.length > 0 && !missedSaved && <button className="primary" type="button" disabled={saving} onClick={() => void saveMissed()}>{saving ? 'Enregistrement…' : 'Ajouter les erreurs aux cartes mémoire'}</button>}
      </div>
    </div>}
  </section>;
}
