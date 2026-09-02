type Props = {
  name: string;
  category: string;
  canRead: boolean;
  flashcards: number;
  recallAttempts: number;
  pdfBookmarks?: number;
  pdfNotes?: number;
  onRead: () => void;
  onFlashcards: () => void;
  onRecall: () => void;
  onBack: () => void;
};

export function SupportHub({ name, category, canRead, flashcards, recallAttempts, pdfBookmarks = 0, pdfNotes = 0, onRead, onFlashcards, onRecall, onBack }: Props) {
  return <main className="shell hub-shell">
    <button className="back" type="button" onClick={onBack}>← Bibliothèque</button>
    <header className="hub-header">
      <p className="eyebrow">ESPACE D’ÉTUDE · {category}</p>
      <h1>{name}</h1>
      <p>Choisis un mode de travail. Chaque outil garde ses données localement avec ce support.</p>
    </header>
    <section className="hub-grid">
      <button className="hub-card" type="button" onClick={onRead} disabled={!canRead}>
        <span className="hub-index">01</span>
        <div><strong>Lire le support</strong><p>{canRead ? 'Reprendre la lecture ou consulter le document.' : 'Ce format utilise uniquement son ouverture externe pour le moment.'}</p>{pdfBookmarks + pdfNotes > 0 && <small>{pdfBookmarks} repère{pdfBookmarks > 1 ? 's' : ''} · {pdfNotes} note{pdfNotes > 1 ? 's' : ''}</small>}</div>
      </button>
      <button className="hub-card" type="button" onClick={onFlashcards}>
        <span className="hub-index">02</span>
        <div><strong>Cartes mémoire</strong><p>Transformer ce que tu apprends en questions de rappel actif.</p><small>{flashcards} carte{flashcards > 1 ? 's' : ''}</small></div>
      </button>
      <button className="hub-card" type="button" onClick={onRecall}>
        <span className="hub-index">03</span>
        <div><strong>Restitution</strong><p>Écrire de mémoire avant de retourner au support.</p><small>{recallAttempts} tentative{recallAttempts > 1 ? 's' : ''}</small></div>
      </button>
    </section>
  </main>;
}
