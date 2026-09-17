import { useEffect, useState } from 'react';
import { MindMap, MindNode, type MindMapView } from './MindMap';
import { MemoryPassage, TextMemorization } from './TextMemorization';
import { QuranMemorization, QuranTarget } from './QuranMemorization';
import { StudyAssistant } from './StudyAssistant';
import { getSupportMetadata, loadSupportBlob, patchSupportMetadata, SUPPORT_METADATA_CHANGED_EVENT, type SupportMetadataChange } from './storage';

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
  onOpenReference: () => void;
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
  mindMapView?: MindMapView;
  memoryPassages?: MemoryPassage[];
  quranTargets?: QuranTarget[];
  importedAt?: string;
  [key: string]: unknown;
};

type StoredSupportPatch = Partial<Omit<StoredSupport, 'id'>>;

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function SupportHub({ id, name, category, canRead, flashcards, recallAttempts, pdfBookmarks = 0, pdfNotes = 0, onRead, onFlashcards, onRecall, onBack }: Props) {
  const [mindMode, setMindMode] = useState(false);
  const [mindFocusMode, setMindFocusMode] = useState(false);
  const [memoryMode, setMemoryMode] = useState(false);
  const [quranMode, setQuranMode] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [mindNodes, setMindNodes] = useState<MindNode[]>([]);
  const [mindMapView, setMindMapView] = useState<MindMapView | undefined>();
  const [memoryPassages, setMemoryPassages] = useState<MemoryPassage[]>([]);
  const [quranTargets, setQuranTargets] = useState<QuranTarget[]>([]);
  const [storedSupport, setStoredSupport] = useState<StoredSupport | null>(null);
  const [saveStatus, setSaveStatus] = useState('');

  const applyStoredSupport = (support: StoredSupport | null) => {
    setStoredSupport(support);
    setMindNodes(support?.mindMap ?? []);
    setMindMapView(support?.mindMapView);
    setMemoryPassages(support?.memoryPassages ?? []);
    setQuranTargets(support?.quranTargets ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    void getSupportMetadata<StoredSupport>(id).then(support => {
      if (cancelled) return;
      applyStoredSupport(support);
    }).catch(() => !cancelled && setSaveStatus('Impossible de charger les données d’étude locales.'));
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const onMetadataChanged = (event: Event) => {
      const detail = (event as CustomEvent<SupportMetadataChange>).detail;
      if (!detail?.id || detail.id !== id) return;
      if (detail.deleted) {
        applyStoredSupport(null);
        setSaveStatus('Ce support vient d’être supprimé sur cet appareil.');
        return;
      }
      if (!detail.metadata) return;
      applyStoredSupport(detail.metadata as StoredSupport);
    };

    window.addEventListener(SUPPORT_METADATA_CHANGED_EVENT, onMetadataChanged);
    return () => window.removeEventListener(SUPPORT_METADATA_CHANGED_EVENT, onMetadataChanged);
  }, [id]);

  useEffect(() => {
    if (!mindFocusMode) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMindFocusMode(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mindFocusMode]);

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

  const changeMindMapView = (view: MindMapView) => {
    setMindMapView(view);
    persist({ mindMapView: view }, 'Cadrage de la carte enregistré.');
  };

  const changeMemoryPassages = (passages: MemoryPassage[]) => {
    setMemoryPassages(passages);
    persist({ memoryPassages: passages }, 'Mémorisation enregistrée.');
  };

  const changeQuranTargets = (targets: QuranTarget[]) => {
    setQuranTargets(targets);
    persist({ quranTargets: targets }, 'Parcours Qour’ān enregistré.');
  };

  const openQuranReference = (page?: number) => {
    const extension = extensionOf(name);
    const safePage = page && Number.isFinite(page) && page >= 1 ? Math.floor(page) : null;

    if (extension === 'pdf') {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('source', id);
      if (safePage) url.searchParams.set('page', String(safePage));
      const opened = window.open(url.toString(), '_blank');
      if (opened) opened.opener = null;
      else setSaveStatus('Impossible d’ouvrir le support de référence dans un nouvel onglet. Autorise les fenêtres contextuelles puis réessaie.');
      return;
    }

    const opened = window.open('', '_blank');
    if (!opened) {
      setSaveStatus('Impossible d’ouvrir le support de référence dans un nouvel onglet. Autorise les fenêtres contextuelles puis réessaie.');
      return;
    }
    opened.opener = null;
    setSaveStatus('Ouverture du support de référence…');
    void loadSupportBlob(id).then(blob => {
      const objectUrl = URL.createObjectURL(blob);
      if (opened.closed) {
        URL.revokeObjectURL(objectUrl);
        setSaveStatus('L’onglet de référence a été fermé avant l’ouverture du support.');
        return;
      }
      opened.location.href = objectUrl;
      setSaveStatus('');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }).catch(error => {
      opened.close();
      console.error(error);
      setSaveStatus(error instanceof Error ? `Impossible d’ouvrir le support de référence : ${error.message}` : 'Impossible d’ouvrir le support de référence.');
    });
  };

  if (aiMode) return <StudyAssistant supportId={id} supportName={name} onBack={() => setAiMode(false)} />;
  if (quranMode) return <><QuranMemorization supportName={name} targets={quranTargets} onChange={changeQuranTargets} onOpenSource={openQuranReference} onBack={() => setQuranMode(false)} />{saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}</>;
  if (memoryMode) return <><TextMemorization supportName={name} passages={memoryPassages} onChange={changeMemoryPassages} onBack={() => setMemoryMode(false)} />{saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}</>;
  if (mindMode) return <div className={`mind-focus-frame${mindFocusMode ? ' active' : ''}`}>
    <button className="mind-focus-toggle" type="button" onClick={() => setMindFocusMode(current => !current)} aria-pressed={mindFocusMode}>
      {mindFocusMode ? 'Quitter le mode concentration' : 'Agrandir la carte'}
    </button>
    <MindMap supportName={name} nodes={mindNodes} initialView={mindMapView} onChange={changeMindMap} onViewChange={changeMindMapView} onBack={() => { setMindFocusMode(false); setMindMode(false); }} />
    {saveStatus && <div className="mind-save-status" role="status">{saveStatus}</div>}
  </div>;

  const isQuranSupport = category === 'Qour’ān';
  const canUseAi = ['pdf', 'docx', 'txt', 'md'].includes(extensionOf(name));

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
      {canUseAi && <button className="hub-card" type="button" onClick={() => setAiMode(true)}>
        <span className="hub-index">IA</span><div><strong>Assistant d’étude</strong><p>Interroger le support, demander une explication ou générer des questions de rappel à partir de son contenu.</p><small>PDF · DOCX · TXT · Markdown</small></div>
      </button>}
    </section>
  </main>;
}
