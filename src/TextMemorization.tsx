import { FormEvent, useMemo, useRef, useState } from 'react';
import { isReviewDue, scheduleReview } from './spacedRepetition.mjs';

export type MemoryPassage = {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  attempts: number;
  successes: number;
  stage?: number;
  lastPracticedAt?: string;
  nextReviewAt?: string;
};

type Props = {
  supportName: string;
  passages: MemoryPassage[];
  onChange: (passages: MemoryPassage[]) => void;
  onBack: () => void;
};

type Phase = 'manage' | 'read' | 'recall' | 'check';

function stageOf(passage: MemoryPassage) {
  return Number.isFinite(passage.stage) ? Math.max(0, Math.trunc(passage.stage!)) : 0;
}

export function TextMemorization({ supportName, passages, onChange, onBack }: Props) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('manage');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recall, setRecall] = useState('');
  const ratingLockedRef = useRef(false);

  const active = useMemo(() => passages.find(item => item.id === activeId) ?? null, [passages, activeId]);
  const duePassages = useMemo(() => passages.filter(passage => isReviewDue(passage)), [passages]);
  const orderedPassages = useMemo(() => [...passages].sort((a, b) => {
    const dueDifference = Number(isReviewDue(b)) - Number(isReviewDue(a));
    if (dueDifference) return dueDifference;
    const aNext = a.nextReviewAt ? Date.parse(a.nextReviewAt) : 0;
    const bNext = b.nextReviewAt ? Date.parse(b.nextReviewAt) : 0;
    if (Number.isFinite(aNext) && Number.isFinite(bNext) && aNext !== bNext) return aNext - bNext;
    return b.createdAt.localeCompare(a.createdAt);
  }), [passages]);

  const addPassage = (event: FormEvent) => {
    event.preventDefault();
    const cleanText = text.trim();
    if (!cleanText) return;
    const cleanTitle = title.trim() || `Passage ${passages.length + 1}`;
    const next: MemoryPassage = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      text: cleanText,
      createdAt: new Date().toISOString(),
      attempts: 0,
      successes: 0,
      stage: 0,
    };
    onChange([next, ...passages]);
    setTitle('');
    setText('');
  };

  const start = (id: string) => {
    ratingLockedRef.current = false;
    setActiveId(id);
    setRecall('');
    setPhase('read');
  };

  const finishSession = () => {
    ratingLockedRef.current = false;
    setPhase('manage');
    setActiveId(null);
    setRecall('');
  };

  const rate = (success: boolean) => {
    if (!active || ratingLockedRef.current) return;
    ratingLockedRef.current = true;
    const schedule = scheduleReview(stageOf(active), success);
    onChange(passages.map(item => item.id === active.id ? {
      ...item,
      ...schedule,
      attempts: item.attempts + 1,
      successes: item.successes + (success ? 1 : 0),
    } : item));
    setPhase('manage');
    setActiveId(null);
    setRecall('');
  };

  const removePassage = (id: string) => {
    const passage = passages.find(item => item.id === id);
    if (!passage || !window.confirm(`Supprimer définitivement le passage « ${passage.title} » et son historique de pratique ?`)) return;
    onChange(passages.filter(item => item.id !== id));
    if (activeId === id) finishSession();
  };

  if (phase !== 'manage' && active) return <main className="shell memory-shell">
    <button className="back" type="button" onClick={finishSession}>← Mémorisation</button>
    <header className="memory-header"><p className="eyebrow">MÉMORISATION ACTIVE · {supportName}</p><h1>{active.title}</h1></header>
    {phase === 'read' && <section className="memory-stage"><span>1 · Lire attentivement</span><div className="memory-source">{active.text}</div><button className="primary" type="button" onClick={() => setPhase('recall')}>Masquer et restituer</button></section>}
    {phase === 'recall' && <section className="memory-stage"><span>2 · Restituer sans regarder</span><textarea value={recall} onChange={event => setRecall(event.target.value)} placeholder="Écris ici ce que tu restitues de mémoire…" autoFocus /><button className="primary" type="button" onClick={() => setPhase('check')}>Comparer avec l’original</button></section>}
    {phase === 'check' && <section className="memory-stage"><span>3 · Comparer après l’effort</span><div className="memory-compare"><article><small>Ta restitution</small><p>{recall.trim() || 'Aucune restitution écrite.'}</p></article><article><small>Texte original</small><p>{active.text}</p></article></div><div className="memory-rating"><button type="button" onClick={() => rate(false)}>À retravailler</button><button type="button" onClick={() => rate(true)}>Restitution satisfaisante</button></div></section>}
  </main>;

  return <main className="shell memory-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="memory-header"><p className="eyebrow">MÉMORISATION DE TEXTES</p><h1>{supportName}</h1><p>Découpe le contenu en passages, observe, masque, restitue puis compare seulement après l’effort. {duePassages.length} passage{duePassages.length > 1 ? 's sont' : ' est'} à revoir maintenant.</p></header>
    <div className="memory-layout">
      <form className="memory-form" onSubmit={addPassage}>
        <h2>Nouveau passage</h2>
        <label>Titre<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex. Définition 1" /></label>
        <label>Texte à mémoriser<textarea value={text} onChange={event => setText(event.target.value)} placeholder="Colle ou saisis exactement le passage à mémoriser." /></label>
        <button className="primary" type="submit" disabled={!text.trim()}>Ajouter le passage</button>
      </form>
      <section className="memory-list">
        <div className="memory-list-title"><span>PASSAGES · {duePassages.length} À REVOIR</span><strong>{passages.length}</strong></div>
        {passages.length === 0 ? <div className="empty"><h3>Aucun passage</h3><p>Ajoute un premier extrait précis à mémoriser.</p></div> : orderedPassages.map(item => <article key={item.id}><div><h2>{item.title}</h2><p>{item.text}</p><small>{item.attempts} tentative{item.attempts > 1 ? 's' : ''} · {item.successes} satisfaisante{item.successes > 1 ? 's' : ''} · niveau {stageOf(item)} · {isReviewDue(item) ? 'à revoir maintenant' : `prochaine révision ${new Date(item.nextReviewAt!).toLocaleDateString('fr-FR')}`}</small></div><div className="memory-actions"><button type="button" onClick={() => start(item.id)}>{isReviewDue(item) ? 'Réviser' : 'S’entraîner'}</button><button type="button" onClick={() => removePassage(item.id)}>Supprimer</button></div></article>)}
      </section>
    </div>
  </main>;
}
