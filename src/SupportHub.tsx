import { useEffect, useMemo, useState } from 'react';
import { MindMap, MindNode } from './MindMap';
import { MemoryPassage, TextMemorization } from './TextMemorization';

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
  importedAt?: string;
  [key: string]: unknown;
};

const DB_NAME = 'sirafiq-next';
const STORE = 'supports';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function findSupport(props: Pick<Props, 'name' | 'category' | 'flashcards' | 'recallAttempts' | 'pdfBookmarks' | 'pdfNotes'>): Promise<StoredSupport | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const matches = (request.result as StoredSupport[]).filter(item =>
        item.name === props.name &&
        (item.category || 'Non classé') === props.category &&
        (item.flashcards?.length ?? 0) === props.flashcards &&
        (item.recallAttempts?.length ?? 0) === props.recallAttempts &&
        (item.pdfBookmarks?.length ?? 0) === (props.pdfBookmarks ?? 0) &&
        (item.pdfNotes?.length ?? 0) === (props.pdfNotes ?? 0)
      );
      if (matches.length === 1) resolve(matches[0]);
      else if (matches.length > 1) resolve([...matches].sort((a, b) => String(b.importedAt ?? '').localeCompare(String(a.importedAt ?? '')))[0]);
      else resolve(null);
    };
  });
}

async function savePatch(support: StoredSupport, patch: Partial<StoredSupport>) {
  const db = await openDb();
  return new Promise<StoredSupport>((resolve, reject) => {
    const next = { ...support, ...patch };
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(next);
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error);
  });
}

export function SupportHub({ name, category, canRead, flashcards, recallAttempts, pdfBookmarks = 0, pdfNotes = 0, onRead, onFlashcards, onRecall, onBack }: Props) {
  const [mindMode, setMindMode] = useState(false);
  const [memoryMode, setMemoryMode] = useState(false);
  const [mindNodes, setMindNodes] = useState<MindNode[]>([]);
  const [memoryPassages, setMemoryPassages] = useState<MemoryPassage[]>([]);
  const [storedSupport, setStoredSupport] = useState<StoredSupport | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const identity = useMemo(() => ({ name, category, flashcards, recallAttempts, pdfBookmarks, pdfNotes }), [name, category, flashcards, recallAttempts, pdfBookmarks, pdfNotes]);

  useEffect(() => {
    let cancelled = false;
    void findSupport(identity).then(support => {
      if (cancelled) return;
      setStoredSupport(support);
      setMindNodes(support?.mindMap ?? []);
      setMemoryPassages(support?.memoryPassages ?? []);
    }).catch(() => !cancelled && setSaveStatus('Impossible de charger les données d’étude locales.'));
    return () => { cancelled = true; };
  }, [identity]);

  const persist = (patch: Partial<StoredSupport>, successMessage: string) => {
    if (!storedSupport) {
      setSaveStatus('Support local introuvable : impossible d’enregistrer.');
      return;
    }
    setSaveStatus('Enregistrement…');
    void savePatch(storedSupport, patch).then(next => {
      setStoredSupport(next);
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

  if (memoryMode) return <><TextMemorization supportName={name} passages={memoryPassages} onChange={changeMemoryPassages} onBack={() => setMemoryMode(false)} />{saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}</>;
  if (mindMode) return <><MindMap supportName={name} nodes={mindNodes} onChange={changeMindMap} onBack={() => setMindMode(false)} />{saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}</>;

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
      <button className="hub-card" type="button" onClick={onFlashcards}>
        <span className="hub-index">02</span><div><strong>Cartes mémoire</strong><p>Transformer ce que tu apprends en questions de rappel actif.</p><small>{flashcards} carte{flashcards > 1 ? 's' : ''}</small></div>
      </button>
      <button className="hub-card" type="button" onClick={onRecall}>
        <span className="hub-index">03</span><div><strong>Restitution</strong><p>Écrire de mémoire avant de retourner au support.</p><small>{recallAttempts} tentative{recallAttempts > 1 ? 's' : ''}</small></div>
      </button>
      <button className="hub-card" type="button" onClick={() => setMindMode(true)}>
        <span className="hub-index">04</span><div><strong>Carte mentale</strong><p>Organiser les notions en branches hiérarchiques pour visualiser les liens.</p><small>{mindNodes.length} notion{mindNodes.length > 1 ? 's' : ''}</small></div>
      </button>
      <button className="hub-card" type="button" onClick={() => setMemoryMode(true)}>
        <span className="hub-index">05</span><div><strong>Mémorisation de textes</strong><p>Découper un texte en passages puis pratiquer lecture, masquage, restitution et comparaison.</p><small>{memoryPassages.length} passage{memoryPassages.length > 1 ? 's' : ''}</small></div>
      </button>
    </section>
  </main>;
}
