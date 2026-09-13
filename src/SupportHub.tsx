import { useEffect, useState } from 'react';
import { MindMap, MindNode } from './MindMap';
import { MemoryPassage, TextMemorization } from './TextMemorization';
import { QuranMemorization, QuranTarget } from './QuranMemorization';
import { getSupportMetadata, patchSupportMetadata } from './storage';

type Props = {
  id: string;
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

type StoredSupport = {
  id: string;
  name: string;
  category?: string;
  flashcards?: unknown[];
  recallAttempts?: unknown[];
  pdfBookmarks?: number[];
  pdfNotes?: unknown[];
  mindMap?: MindNode[];
  memoryPassages?: MemoryPassage[];
  quranTargets?: QuranTarget[];
  importedAt?: string;
  [key: string]: unknown;
};

type StoredSupportPatch = Partial<Omit<StoredSupport, 'id'>>;

export function SupportHub({ id, name, category, canRead, flashcards, recallAttempts, pdfBookmarks = 0, pdfNotes = 0, onRead, onFlashcards, onRecall, onBack }: Props) {
  const [mindMode, setMindMode] = useState(false);
  const [memoryMode, setMemoryMode] = useState(false);
  const [quranMode, setQuranMode] = useState(false);
  const [mindNodes, setMindNodes] = useState<MindNode[]>([]);
  const [memoryPassages, setMemoryPassages] = useState<MemoryPassage[]>([]);
  const [quranTargets, setQuranTargets] = useState<QuranTarget[]>([]);
  const [storedSupport, setStoredSupport] = useState<StoredSupport | null>(null);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getSupportMetadata<StoredSupport>(id).then(support => {
      if (cancelled) return;
      setStoredSupport(support);
      setMindNodes(support?.mindMap ?? []);
      setMemoryPassages(support?.memoryPassages ?? []);
      setQuranTargets(support?.quranTargets ?? []);
    }).catch(() => !cancelled && setSaveStatus('Impossible de charger les données d’étude locales.'));
    return () => { cancelled = true; };
  }, [id]);

  const persist = (patch: StoredSupportPatch, successMessage: string) => {
    if (!storedSupport) {
      setSaveStatus('Support local introuvable : impossible d’enregistrer.');
      return;
    }
    setStoredSupport(current => current ? { ...current, ...patch } : current);
    setSaveStatus('Enregistrement…');
    void patchSupportMetadata<StoredSupport>(id, patch).then(saved => {
      setStoredSupport(saved);
      setSaveStatus(successMessage);
    }).catch(() => setSaveStatus('Impossible d’enregistrer les données locales.'));
  };

  const changeMindMap = (nodes: MindNode[]) => {
    setMindNodes(nodes);
    persist({ mindMap: nodes }, 'Carte mentale enregistrée.');
  };

  const changeMemoryPassages = (passages: MemoryPassage[]) => {
    setMemoryPassages(passages);
    persist({ memoryPassages: passages }, 'Mémorisation enregistrée.');
  };

  const changeQuranTargets = (targets: QuranTarget[]) => {
    setQuranTargets(targets);
    persist({ quranTargets: targets }, 'Parcours Qour’ān enregistré.');
  };

  if (quranMode) return <><QuranMemorization supportName={name} targets={quranTargets} onChange={changeQuranTargets} onOpenSource={onRead} onBack={() => setQuranMode(false)} />{saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}</>;
  if (memoryMode) return <><TextMemorization supportName={name} passages={memoryPassages} onChange={changeMemoryPassages} onBack={() => setMemoryMode(false)} />{saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}</>;
  if (mindMode) return <><MindMap supportName={name} nodes={mindNodes} onChange={changeMindMap} onBack={() => setMindMode(false)} />{saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}</>;

  const isQuranSupport = category === 'Qour’ān';

  return <main className="shell hub-shell">
    <button className="back" type="button" onClick={onBack}>← Bibliothèque</button>
    <header className="hub-header">
      <p className="eyebrow">ESPACE D’ÉTUDE · {category}</p>
      <h1>{name}</h1>
      <p>Choisis un mode de travail. Chaque outil garde ses données localement avec ce support.</p>
    </header>
    <section className="hub-grid">
      <button className="hub-card" type="button" onClick={onRead}>
        <span className="hub-index">01</span><div><strong>{canRead ? 'Lire le support' : 'Ouvrir le support'}</strong><p>{canRead ? 'Reprendre la lecture ou consulter le document.' : 'Ce format s’ouvre avec le lecteur disponible sur cet appareil.'}</p>{pdfBookmarks + pdfNotes > 0 && <small>{pdfBookmarks} repère{pdfBookmarks > 1 ? 's' : ''} · {pdfNotes} note{pdfNotes > 1 ? 's' : ''}</small>}</div>
      </button>
      {isQuranSupport && <button className="hub-card" type="button" onClick={() => setQuranMode(true)}>
        <span className="hub-index">02</span><div><strong>Mémorisation du Qour’ān</strong><p>Préparer des passages, travailler depuis le rendu original et suivre leur consolidation.</p><small>{quranTargets.length} passage{quranTargets.length > 1 ? 's' : ''}</small></div>
      </button>}
      <button className="hub-card" type="button" onClick={onFlashcards}>
        <span className="hub-index">{isQuranSupport ? '03' : '02'}</span><div><strong>Cartes mémoire</strong><p>Transformer ce que tu apprends en questions de rappel actif.</p><small>{flashcards} carte{flashcards > 1 ? 's' : ''}</small></div>
      </button>
      <button className="hub-card" type="button" onClick={onRecall}>
        <span className="hub-index">{isQuranSupport ? '04' : '03'}</span><div><strong>Restitution</strong><p>Écrire de mémoire avant de retourner au support.</p><small>{recallAttempts} tentative{recallAttempts > 1 ? 's' : ''}</small></div>
      </button>
      <button className="hub-card" type="button" onClick={() => setMindMode(true)}>
        <span className="hub-index">{isQuranSupport ? '05' : '04'}</span><div><strong>Carte mentale</strong><p>Organiser les notions en branches hiérarchiques pour visualiser les liens.</p><small>{mindNodes.length} notion{mindNodes.length > 1 ? 's' : ''}</small></div>
      </button>
      <button className="hub-card" type="button" onClick={() => setMemoryMode(true)}>
        <span className="hub-index">{isQuranSupport ? '06' : '05'}</span><div><strong>Mémorisation de textes</strong><p>Découper un texte en passages puis pratiquer lecture, masquage, restitution et comparaison.</p><small>{memoryPassages.length} passage{memoryPassages.length > 1 ? 's' : ''}</small></div>
      </button>
    </section>
  </main>;
}
