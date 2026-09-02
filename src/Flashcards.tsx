import { FormEvent, useMemo, useState } from 'react';

export type Flashcard = {
  id: string;
  front: string;
  back: string;
  stage: number;
  createdAt: string;
  lastReviewedAt?: string;
  nextReviewAt?: string;
};

type Props = {
  supportName: string;
  cards: Flashcard[];
  onChange: (cards: Flashcard[]) => void;
  onBack: () => void;
};

const DAY = 24 * 60 * 60 * 1000;
const intervals = [0, 1, 3, 7, 14, 30];

function due(card: Flashcard) {
  return !card.nextReviewAt || new Date(card.nextReviewAt).getTime() <= Date.now();
}

export function Flashcards({ supportName, cards, onChange, onBack }: Props) {
  const [mode, setMode] = useState<'manage' | 'review'>('manage');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);

  const dueCards = useMemo(() => cards.filter(due), [cards]);
  const reviewCards = dueCards.length ? dueCards : cards;
  const current = reviewCards[reviewIndex] ?? null;

  const addCard = (event: FormEvent) => {
    event.preventDefault();
    const cleanFront = front.trim();
    const cleanBack = back.trim();
    if (!cleanFront || !cleanBack) return;
    onChange([...cards, { id: crypto.randomUUID(), front: cleanFront, back: cleanBack, stage: 0, createdAt: new Date().toISOString() }]);
    setFront('');
    setBack('');
  };

  const removeCard = (id: string) => onChange(cards.filter(card => card.id !== id));

  const rate = (success: boolean) => {
    if (!current) return;
    const now = new Date();
    const nextStage = success ? Math.min(intervals.length - 1, current.stage + 1) : 0;
    const next = new Date(now.getTime() + intervals[nextStage] * DAY);
    const updated = cards.map(card => card.id === current.id ? { ...card, stage: nextStage, lastReviewedAt: now.toISOString(), nextReviewAt: next.toISOString() } : card);
    onChange(updated);
    setRevealed(false);
    if (reviewIndex >= reviewCards.length - 1) {
      setReviewIndex(0);
      setMode('manage');
    } else {
      setReviewIndex(index => index + 1);
    }
  };

  const startReview = () => {
    setReviewIndex(0);
    setRevealed(false);
    setMode('review');
  };

  if (mode === 'review') return <main className="shell flash-shell">
    <button className="back" type="button" onClick={() => setMode('manage')}>← Cartes</button>
    <section className="flash-review">
      <p className="eyebrow">RÉVISION ACTIVE · {supportName}</p>
      {current ? <>
        <div className="flash-progress">Carte {reviewIndex + 1} / {reviewCards.length}</div>
        <article className="flash-card-review" onClick={() => setRevealed(true)}>
          <span>Question</span>
          <h1>{current.front}</h1>
          {revealed ? <div className="flash-answer"><span>Réponse</span><p>{current.back}</p></div> : <button type="button" onClick={() => setRevealed(true)}>Afficher la réponse</button>}
        </article>
        {revealed && <div className="flash-rating"><button type="button" onClick={() => rate(false)}>À revoir</button><button type="button" onClick={() => rate(true)}>Acquis</button></div>}
      </> : <div className="empty"><h3>Aucune carte</h3><p>Crée d’abord une carte pour commencer une révision.</p></div>}
    </section>
  </main>;

  return <main className="shell flash-shell">
    <button className="back" type="button" onClick={onBack}>← Bibliothèque</button>
    <header className="flash-header"><p className="eyebrow">CARTES MÉMOIRE</p><h1>{supportName}</h1><p>{cards.length} carte{cards.length > 1 ? 's' : ''} · {dueCards.length} à revoir maintenant</p></header>
    <div className="flash-layout">
      <form className="flash-form" onSubmit={addCard}>
        <h2>Nouvelle carte</h2>
        <label>Question<textarea value={front} onChange={event => setFront(event.target.value)} placeholder="Ce que tu veux rappeler sans regarder le support" /></label>
        <label>Réponse<textarea value={back} onChange={event => setBack(event.target.value)} placeholder="La réponse exacte à restituer" /></label>
        <button className="primary" type="submit" disabled={!front.trim() || !back.trim()}>Ajouter la carte</button>
      </form>
      <section className="flash-list-panel">
        <div className="flash-list-title"><div><span>Révision espacée</span><h2>Mes cartes</h2></div><button type="button" onClick={startReview} disabled={!cards.length}>Réviser</button></div>
        {cards.length === 0 ? <div className="empty"><h3>Aucune carte créée</h3><p>Commence par une question courte et une réponse précise.</p></div> : <div className="flash-list">{cards.map(card => <article key={card.id}><div><strong>{card.front}</strong><p>{card.back}</p><small>Niveau {card.stage} · {due(card) ? 'à revoir' : `prochaine révision ${new Date(card.nextReviewAt!).toLocaleDateString('fr-FR')}`}</small></div><button type="button" onClick={() => removeCard(card.id)}>Supprimer</button></article>)}</div>}
      </section>
    </div>
  </main>;
}
