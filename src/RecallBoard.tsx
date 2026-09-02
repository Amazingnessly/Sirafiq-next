import { useMemo, useState } from 'react';

export type RecallAttempt = { id: string; text: string; createdAt: string };

type Props = {
  supportName: string;
  draft?: string;
  attempts?: RecallAttempt[];
  onDraftChange: (draft: string) => void;
  onAttemptsChange: (attempts: RecallAttempt[]) => void;
  onBack: () => void;
};

function wordCount(text: string) {
  const clean = text.trim();
  return clean ? clean.split(/\s+/).length : 0;
}

export function RecallBoard({ supportName, draft = '', attempts = [], onDraftChange, onAttemptsChange, onBack }: Props) {
  const [text, setText] = useState(draft);
  const sortedAttempts = useMemo(() => [...attempts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [attempts]);

  const change = (value: string) => {
    setText(value);
    onDraftChange(value);
  };

  const saveAttempt = () => {
    const clean = text.trim();
    if (!clean) return;
    onAttemptsChange([...attempts, { id: crypto.randomUUID(), text: clean, createdAt: new Date().toISOString() }]);
    change('');
  };

  const removeAttempt = (id: string) => onAttemptsChange(attempts.filter(attempt => attempt.id !== id));

  return <main className="shell recall-shell">
    <button className="back" type="button" onClick={onBack}>← Bibliothèque</button>
    <header className="recall-header">
      <p className="eyebrow">RESTITUTION ACTIVE</p>
      <h1>{supportName}</h1>
      <p>Écris ce que tu peux restituer sans regarder le support. Le brouillon est mémorisé localement.</p>
    </header>
    <section className="recall-board">
      <div className="recall-meta"><strong>{wordCount(text)} mot{wordCount(text) > 1 ? 's' : ''}</strong><span>Ne consulte le support qu’après avoir terminé ton effort de rappel.</span></div>
      <textarea value={text} onChange={event => change(event.target.value)} placeholder="Commence ta restitution ici…" autoFocus />
      <div className="recall-actions"><button type="button" onClick={() => change('')} disabled={!text}>Effacer le brouillon</button><button className="primary" type="button" onClick={saveAttempt} disabled={!text.trim()}>Enregistrer cette tentative</button></div>
    </section>
    <section className="recall-history">
      <div className="recall-history-title"><span>Historique</span><h2>Tentatives enregistrées</h2></div>
      {sortedAttempts.length === 0 ? <div className="empty"><h3>Aucune tentative</h3><p>Les restitutions sauvegardées apparaîtront ici pour suivre ton travail dans le temps.</p></div> : <div className="recall-attempts">{sortedAttempts.map(attempt => <article key={attempt.id}><div className="recall-attempt-meta"><strong>{new Date(attempt.createdAt).toLocaleString('fr-FR')}</strong><span>{wordCount(attempt.text)} mots</span></div><p>{attempt.text}</p><button type="button" onClick={() => removeAttempt(attempt.id)}>Supprimer</button></article>)}</div>}
    </section>
  </main>;
}
