import { FormEvent, useMemo, useState } from 'react';

export type QuranTarget = {
  id: string;
  label: string;
  page: number | null;
  note: string;
  status: 'nouveau' | 'consolidation' | 'solide';
  reviews: number;
  createdAt: string;
  lastReviewedAt?: string;
};

type Props = {
  supportName: string;
  targets: QuranTarget[];
  onChange: (targets: QuranTarget[]) => void;
  onOpenSource: () => void;
  onBack: () => void;
};

const statusLabel: Record<QuranTarget['status'], string> = {
  nouveau: 'À apprendre',
  consolidation: 'En consolidation',
  solide: 'Solide',
};

export function QuranMemorization({ supportName, targets, onChange, onOpenSource, onBack }: Props) {
  const [label, setLabel] = useState('');
  const [page, setPage] = useState('');
  const [note, setNote] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = targets.find(target => target.id === activeId) ?? null;

  const totals = useMemo(() => ({
    all: targets.length,
    consolidation: targets.filter(target => target.status === 'consolidation').length,
    solide: targets.filter(target => target.status === 'solide').length,
  }), [targets]);

  const addTarget = (event: FormEvent) => {
    event.preventDefault();
    const clean = label.trim();
    if (!clean) return;
    const parsed = page.trim() ? Number(page) : null;
    const target: QuranTarget = {
      id: crypto.randomUUID(),
      label: clean,
      page: parsed && parsed > 0 ? Math.floor(parsed) : null,
      note: note.trim(),
      status: 'nouveau',
      reviews: 0,
      createdAt: new Date().toISOString(),
    };
    onChange([target, ...targets]);
    setLabel('');
    setPage('');
    setNote('');
    setActiveId(target.id);
  };

  const assess = (status: QuranTarget['status']) => {
    if (!active) return;
    const now = new Date().toISOString();
    onChange(targets.map(target => target.id === active.id ? {
      ...target,
      status,
      reviews: target.reviews + 1,
      lastReviewedAt: now,
    } : target));
  };

  const remove = (id: string) => {
    onChange(targets.filter(target => target.id !== id));
    if (activeId === id) setActiveId(null);
  };

  if (active) return <main className="shell quran-shell">
    <button className="back" type="button" onClick={() => setActiveId(null)}>← Parcours Qour’ān</button>
    <header className="quran-header">
      <p className="eyebrow">MÉMORISATION · SOURCE VISUELLE FIDÈLE</p>
      <h1>{active.label}</h1>
      <p>{active.page ? `Repère : page ${active.page} du support.` : 'Aucun numéro de page indiqué.'} Le texte arabe n’est pas reconstruit : le document importé reste la référence.</p>
    </header>
    <section className="quran-session">
      <div className="quran-step"><span>01</span><div><strong>Observer</strong><p>Ouvre la source et lis attentivement le passage dans son rendu original.</p><button type="button" onClick={onOpenSource}>Ouvrir le support de référence</button></div></div>
      <div className="quran-step"><span>02</span><div><strong>Réciter sans regarder</strong><p>Ferme ou détourne la source, puis restitue le passage de mémoire.</p></div></div>
      <div className="quran-step"><span>03</span><div><strong>Comparer</strong><p>Retourne au document original et vérifie mot à mot avant de t’évaluer.</p><button type="button" onClick={onOpenSource}>Comparer avec la source</button></div></div>
      {active.note && <div className="quran-note"><strong>Repère personnel</strong><p>{active.note}</p></div>}
      <div className="quran-assessment">
        <p className="eyebrow">APRÈS COMPARAISON</p>
        <div><button type="button" onClick={() => assess('nouveau')}>À reprendre</button><button type="button" onClick={() => assess('consolidation')}>En consolidation</button><button type="button" onClick={() => assess('solide')}>Solide</button></div>
        <small>{active.reviews} révision{active.reviews > 1 ? 's' : ''} enregistrée{active.reviews > 1 ? 's' : ''}</small>
      </div>
    </section>
  </main>;

  return <main className="shell quran-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="quran-header">
      <p className="eyebrow">ESPACE QOUR’ĀN</p>
      <h1>{supportName}</h1>
      <p>Prépare des passages à mémoriser en gardant le document importé comme source visuelle de référence. Sirāfiq suit l’effort et les révisions sans reconstruire le texte arabe.</p>
      <div className="quran-stats"><span><strong>{totals.all}</strong> passages</span><span><strong>{totals.consolidation}</strong> en consolidation</span><span><strong>{totals.solide}</strong> solides</span></div>
    </header>
    <section className="quran-create">
      <h2>Nouveau passage</h2>
      <form onSubmit={addTarget}>
        <label>Repère du passage<input value={label} onChange={event => setLabel(event.target.value)} placeholder="Ex. Sourate / versets / passage" /></label>
        <label>Page du support <small>facultatif</small><input inputMode="numeric" value={page} onChange={event => setPage(event.target.value.replace(/[^0-9]/g, ''))} placeholder="Ex. 12" /></label>
        <label>Note personnelle <small>facultatif</small><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Point de vigilance, début du passage, objectif…" /></label>
        <button className="primary" type="submit" disabled={!label.trim()}>Ajouter au parcours</button>
      </form>
    </section>
    <section className="quran-list">
      <div className="quran-list-head"><div><p className="eyebrow">PARCOURS</p><h2>Mes passages</h2></div><strong>{targets.length}</strong></div>
      {targets.length === 0 ? <div className="quran-empty"><strong>Aucun passage préparé</strong><p>Ajoute un premier repère puis travaille toujours à partir du support original.</p></div> : <div className="quran-grid">{targets.map(target => <article key={target.id} className="quran-card">
        <div><span>{statusLabel[target.status]}</span><h3>{target.label}</h3><p>{target.page ? `Page ${target.page}` : 'Page non précisée'} · {target.reviews} révision{target.reviews > 1 ? 's' : ''}</p></div>
        <div className="quran-actions"><button type="button" onClick={() => setActiveId(target.id)}>Travailler</button><button type="button" onClick={() => remove(target.id)}>Supprimer</button></div>
      </article>)}</div>}
    </section>
  </main>;
}
