import { FormEvent, useMemo, useState } from 'react';

export type MemoryPassage = {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  attempts: number;
  successes: number;
  lastPracticedAt?: string;
};

type Props = {
  supportName: string;
  passages: MemoryPassage[];
  onChange: (passages: MemoryPassage[]) => void;
  onBack: () => void;
};

type Phase = 'manage' | 'read' | 'recall' | 'check';

export function TextMemorization({ supportName, passages, onChange, onBack }: Props) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('manage');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recall, setRecall] = useState('');

  const active = useMemo(() => passages.find(item => item.id === activeId) ?? null, [passages, activeId]);

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
    };
    onChange([next, ...passages]);
    setTitle('');
    setText('');
  };

  const start = (id: string) => {
    setActiveId(id);
    setRecall('');
    setPhase('read');
  };

  const rate = (success: boolean) => {
    if (!active) return;
    const now = new Date().toISOString();
    onChange(passages.map(item => item.id === active.id ? {
      ...item,
      attempts: item.attempts + 1,
      successes: item.successes + (success ? 1 : 0),
      lastPracticedAt: now,
    } : item));
    setPhase('manage');
    setActiveId(null);
    setRecall('');
  };

  if (phase !== 'manage' && active) return <main className="shell memory-shell">
    <button className="back" type="button" onClick={() => { setPhase('manage'); setActiveId(null); }}>← Mémorisation</button>
    <header className="memory-header"><p className="eyebrow">MÉMORISATION ACTIVE · {supportName}</p><h1>{active.title}</h1></header>
    {phase === 'read' && <section className="memory-stage"><span>1 · Lire attentivement</span><div className="memory-source">{active.text}</div><button className="primary" type="button" onClick={() => setPhase('recall')}>Masquer et restituer</button></section>}
    {phase === 'recall' && <section className="memory-stage"><span>2 · Restituer sans regarder</span><textarea value={recall} onChange={event => setRecall(event.target.value)} placeholder="Écris ici ce que tu restitues de mémoire…" autoFocus /><button className="primary" type="button" onClick={() => setPhase('check')}>Comparer avec l’original</button></section>}
    {phase === 'check' && <section className="memory-stage"><span>3 · Comparer après l’effort</span><div className="memory-compare"><article><small>Ta restitution</small><p>{recall.trim() || 'Aucune restitution écrite.'}</p></article><article><small>Texte original</small><p>{active.text}</p></article></div><div className="memory-rating"><button type="button" onClick={() => rate(false)}>À retravailler</button><button type="button" onClick={() => rate(true)}>Restitution satisfaisante</button></div></section>}
  </main>;

  return <main className="shell memory-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="memory-header"><p className="eyebrow">MÉMORISATION DE TEXTES</p><h1>{supportName}</h1><p>Découpe le contenu en passages, observe, masque, restitue puis compare seulement après l’effort.</p></header>
    <div className="memory-layout">
      <form className="memory-form" onSubmit={addPassage}>
        <h2>Nouveau passage</h2>
        <label>Titre<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex. Définition 1" /></label>
        <label>Texte à mémoriser<textarea value={text} onChange={event => setText(event.target.value)} placeholder="Colle ou saisis exactement le passage à mémoriser." /></label>
        <button className="primary" type="submit" disabled={!text.trim()}>Ajouter le passage</button>
      </form>
      <section className="memory-list">
        <div className="memory-list-title"><span>PASSAGES</span><strong>{passages.length}</strong></div>
        {passages.length === 0 ? <div className="empty"><h3>Aucun passage</h3><p>Ajoute un premier extrait précis à mémoriser.</p></div> : passages.map(item => <article key={item.id}><div><h2>{item.title}</h2><p>{item.text}</p><small>{item.attempts} tentative{item.attempts > 1 ? 's' : ''} · {item.successes} satisfaisante{item.successes > 1 ? 's' : ''}</small></div><div className="memory-actions"><button type="button" onClick={() => start(item.id)}>Mémoriser</button><button type="button" onClick={() => onChange(passages.filter(passage => passage.id !== item.id))}>Supprimer</button></div></article>)}
      </section>
    </div>
  </main>;
}
