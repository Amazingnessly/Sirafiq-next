import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Criterion = 'articulation' | 'rythme' | 'souffle' | 'intonation' | 'presence';
type Scores = Record<Criterion, number>;
type PracticeAttempt = {
  id: string;
  promptId: string;
  createdAt: string;
  durationSeconds: number;
  scores: Scores;
  note?: string;
};

type Prompt = {
  id: string;
  level: string;
  title: string;
  focus: string;
  targetSeconds: number;
  text: string;
};

type Props = { onBack: () => void };
type LoadAttemptsResult = { attempts: PracticeAttempt[]; warning: string; writable: boolean };

const STORAGE_KEY = 'sirafiq-pronunciation-practice-v1';
const STORAGE_WARNING = 'Impossible d’enregistrer cette séance sur cet appareil. Elle reste visible pour cette session et Sirāfiq réessaiera au retour sur la page.';
const STORAGE_CORRUPT_WARNING = 'L’historique local des entraînements est illisible. Il n’a pas été écrasé automatiquement ; les nouvelles séances restent visibles uniquement pour cette session tant que les données locales ne redeviennent pas lisibles.';
const STORAGE_READ_WARNING = 'Impossible de lire l’historique local des entraînements. Les données existantes n’ont pas été écrasées et les nouvelles séances restent visibles pour cette session.';

const criteria: Array<{ id: Criterion; label: string; hint: string }> = [
  { id: 'articulation', label: 'Articulation', hint: 'Voyelles stables, consonnes nettes, finales maîtrisées.' },
  { id: 'rythme', label: 'Rythme', hint: 'Groupes réguliers, débit non haché, pauses utiles.' },
  { id: 'souffle', label: 'Souffle', hint: 'Phrases soutenues sans tension ni fins à bout de souffle.' },
  { id: 'intonation', label: 'Intonation', hint: 'Mélodie qui signale continuité, conclusion et mise en relief.' },
  { id: 'presence', label: 'Présence', hint: 'Voix dirigée, intention claire, énergie adaptée au public.' },
];

const prompts: Prompt[] = [
  {
    id: 'voyelles-contrastes',
    level: 'Précision',
    title: 'Contrastes vocaliques',
    focus: 'Distinguer /i y u/, voyelles ouvertes/fermées et voyelles nasales sans ralentir mot par mot.',
    targetSeconds: 45,
    text: 'Lucie lui demande où sont les outils utiles pour finir le cours. Paul répond qu’ils sont près du mur, sous une petite étagère. Un instant plus tard, chacun reprend son travail en gardant un débit calme. L’objectif n’est pas de forcer chaque son, mais de conserver des voyelles distinctes tout au long de la phrase.',
  },
  {
    id: 'chaine-parlee',
    level: 'Fluidité',
    title: 'Enchaînements et liaisons',
    focus: 'Lier les groupes sans ajouter de pauses artificielles et sans produire de liaisons partout.',
    targetSeconds: 50,
    text: 'Les élèves arrivent à l’heure et ils installent leurs affaires en silence. Vous avez ensuite quelques instants pour expliquer les objectifs du jour. Avec eux, avancez étape par étape : donnez un exemple, vérifiez la compréhension, puis laissez un temps court pour essayer. Une parole liée reste plus facile à suivre qu’une succession de mots isolés.',
  },
  {
    id: 'prosodie-explication',
    level: 'Prosodie',
    title: 'Expliquer une idée clairement',
    focus: 'Découper en groupes rythmiques et mettre en relief uniquement l’information essentielle.',
    targetSeconds: 60,
    text: 'Pour mémoriser durablement une notion, il ne suffit pas de la relire. Il faut tenter de la retrouver sans regarder le support, constater ce qui manque, puis recommencer après un délai. Ce qui demande un effort de rappel devient progressivement plus accessible. La difficulté utile n’est donc pas un obstacle : elle fait partie du mécanisme d’apprentissage.',
  },
  {
    id: 'recit-expressif',
    level: 'Expression',
    title: 'Récit court',
    focus: 'Faire entendre les changements d’intention sans théâtraliser chaque phrase.',
    targetSeconds: 70,
    text: 'Au début, la salle était presque vide. Quelques personnes parlaient encore près de la porte, tandis que les autres cherchaient leur place. Puis le silence s’est installé. L’orateur a regardé le public, attendu une seconde, et commencé très simplement. Sa voix n’était ni forte ni spectaculaire. Pourtant, chacun a levé les yeux : le rythme, les pauses et la précision donnaient du poids à chaque idée.',
  },
  {
    id: 'consigne-pedagogique',
    level: 'Transmission',
    title: 'Donner une consigne',
    focus: 'Être bref, structuré et audible ; utiliser les pauses pour séparer les étapes.',
    targetSeconds: 45,
    text: 'Prenez deux minutes pour relire le passage. Ensuite, fermez le document et écrivez tout ce dont vous vous souvenez. Ne cherchez pas à produire un texte parfait : notez d’abord les idées essentielles. Quand vous aurez terminé, rouvrez le support, comparez votre restitution et marquez seulement les éléments réellement oubliés.',
  },
  {
    id: 'maitrise',
    level: 'Maîtrise',
    title: 'Lecture de synthèse',
    focus: 'Combiner articulation, chaîne parlée, respiration, prosodie et présence sans préparation excessive.',
    targetSeconds: 90,
    text: 'Une lecture efficace ne consiste pas à prononcer chaque lettre avec la même force. Elle consiste à guider l’attention. Le lecteur prépare ses groupes de sens, choisit les mots qui doivent ressortir, garde assez de souffle pour finir ses phrases et laisse les silences travailler avec lui. Lorsqu’il explique, il ralentit sur une notion nouvelle, accélère légèrement sur ce qui est déjà connu et conclut avec une intonation qui ferme réellement l’idée. La maîtrise apparaît quand ces choix deviennent souples : ils restent précis sans donner l’impression d’une technique appliquée mécaniquement.',
  },
];

function emptyScores(): Scores {
  return { articulation: 0, rythme: 0, souffle: 0, intonation: 0, presence: 0 };
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function isScores(value: unknown): value is Scores {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<Record<Criterion, unknown>>;
  return criteria.every(item => Number.isInteger(record[item.id]) && Number(record[item.id]) >= 1 && Number(record[item.id]) <= 5);
}

function isPracticeAttempt(value: unknown): value is PracticeAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<PracticeAttempt>;
  return typeof attempt.id === 'string' && Boolean(attempt.id)
    && typeof attempt.promptId === 'string' && Boolean(attempt.promptId)
    && typeof attempt.createdAt === 'string' && Number.isFinite(Date.parse(attempt.createdAt))
    && typeof attempt.durationSeconds === 'number' && Number.isFinite(attempt.durationSeconds) && attempt.durationSeconds > 0
    && isScores(attempt.scores)
    && (attempt.note === undefined || typeof attempt.note === 'string');
}

function loadAttempts(): LoadAttemptsResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { attempts: [], warning: '', writable: true };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { attempts: [], warning: STORAGE_CORRUPT_WARNING, writable: false };
    }
    if (!Array.isArray(parsed) || !parsed.every(isPracticeAttempt)) {
      return { attempts: [], warning: STORAGE_CORRUPT_WARNING, writable: false };
    }
    const ids = new Set(parsed.map(item => item.id));
    if (ids.size !== parsed.length) return { attempts: [], warning: STORAGE_CORRUPT_WARNING, writable: false };
    return { attempts: parsed.slice(0, 50), warning: '', writable: true };
  } catch {
    return { attempts: [], warning: STORAGE_READ_WARNING, writable: false };
  }
}

export function PronunciationPractice({ onBack }: Props) {
  const initialRef = useRef<LoadAttemptsResult | null>(null);
  if (!initialRef.current) initialRef.current = loadAttempts();
  const [promptId, setPromptId] = useState(prompts[0].id);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [scores, setScores] = useState<Scores>(emptyScores);
  const [note, setNote] = useState('');
  const [attempts, setAttempts] = useState<PracticeAttempt[]>(initialRef.current.attempts);
  const [warning, setWarning] = useState(initialRef.current.warning);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [recordingError, setRecordingError] = useState('');
  const [recordingActive, setRecordingActive] = useState(false);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const dirtyRef = useRef(false);
  const storageWritableRef = useRef(initialRef.current.writable);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingUrlRef = useRef('');
  const discardRecordingRef = useRef(false);
  const mountedRef = useRef(true);
  const prompt = prompts.find(item => item.id === promptId) ?? prompts[0];
  const canSave = !running && elapsed > 0 && criteria.every(item => scores[item.id] > 0);
  const canUseMicrophone = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const clearRecordingUrl = useCallback(() => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = '';
    if (mountedRef.current) setRecordingUrl('');
  }, []);

  const discardRecording = useCallback(() => {
    discardRecordingRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { releaseStream(); }
    } else {
      recorderRef.current = null;
      releaseStream();
    }
    audioChunksRef.current = [];
    clearRecordingUrl();
    if (mountedRef.current) {
      setRecordingActive(false);
      setRecordingError('');
    }
  }, [clearRecordingUrl, releaseStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRecordingRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* rien à faire */ }
      }
      releaseStream();
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = '';
    };
  }, [releaseStream]);

  useEffect(() => {
    if (!running || startedAt === null) return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const persistAttempts = useCallback((next: PracticeAttempt[]) => {
    if (!storageWritableRef.current) {
      dirtyRef.current = true;
      setWarning(current => current || STORAGE_READ_WARNING);
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      dirtyRef.current = false;
      setWarning('');
      return true;
    } catch {
      dirtyRef.current = true;
      setWarning(STORAGE_WARNING);
      return false;
    }
  }, []);

  const refreshStorage = useCallback(() => {
    const loaded = loadAttempts();
    if (!loaded.writable) {
      storageWritableRef.current = false;
      setWarning(loaded.warning);
      return;
    }
    storageWritableRef.current = true;
    if (dirtyRef.current) {
      persistAttempts(attempts);
      return;
    }
    setAttempts(loaded.attempts);
    setWarning('');
  }, [attempts, persistAttempts]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) refreshStorage(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refreshStorage(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refreshStorage);
    window.addEventListener('pageshow', refreshStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refreshStorage);
      window.removeEventListener('pageshow', refreshStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshStorage]);

  const resetPracticeFields = () => {
    setElapsed(0);
    setScores(emptyScores());
    setNote('');
  };

  const resetSession = (nextPromptId = promptId) => {
    discardRecording();
    setPromptId(nextPromptId);
    setRunning(false);
    setStartedAt(null);
    resetPracticeFields();
  };

  const startWithoutMicrophone = () => {
    discardRecording();
    resetPracticeFields();
    setStartedAt(Date.now());
    setRunning(true);
  };

  const startWithMicrophone = async () => {
    if (running || requestingMicrophone) return;
    if (!canUseMicrophone) {
      setRecordingError('L’enregistrement micro n’est pas disponible dans ce navigateur. Le chronomètre reste utilisable sans micro.');
      return;
    }

    discardRecording();
    setRequestingMicrophone(true);
    setRecordingError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      discardRecordingRef.current = false;

      recorder.addEventListener('dataavailable', event => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        if (!mountedRef.current) return;
        setRecordingActive(false);
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          return;
        }
        if (!chunks.length) {
          setRecordingError('Aucun son exploitable n’a été produit par le navigateur. Tu peux recommencer sans perdre ton évaluation.');
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        clearRecordingUrl();
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        setRecordingUrl(url);
      });
      recorder.addEventListener('error', () => {
        if (!mountedRef.current) return;
        setRecordingError('L’enregistrement audio a été interrompu par le navigateur.');
      });

      recorder.start();
      resetPracticeFields();
      setStartedAt(Date.now());
      setRunning(true);
      setRecordingActive(true);
    } catch (error) {
      recorderRef.current = null;
      audioChunksRef.current = [];
      releaseStream();
      if (!mountedRef.current) return;
      setRunning(false);
      setStartedAt(null);
      setRecordingActive(false);
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setRecordingError(denied
        ? 'Le navigateur n’a pas autorisé le micro. Tu peux continuer avec le chronomètre sans enregistrement.'
        : 'Impossible de démarrer le micro sur cet appareil. Tu peux continuer avec le chronomètre sans enregistrement.');
    } finally {
      if (mountedRef.current) setRequestingMicrophone(false);
    }
  };

  const stop = () => {
    if (startedAt !== null) setElapsed(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    setRunning(false);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      discardRecordingRef.current = false;
      try { recorder.stop(); } catch { releaseStream(); }
    } else {
      releaseStream();
      setRecordingActive(false);
    }
  };

  const save = () => {
    if (!canSave) return;
    const nextAttempt: PracticeAttempt = {
      id: crypto.randomUUID(),
      promptId: prompt.id,
      createdAt: new Date().toISOString(),
      durationSeconds: elapsed,
      scores,
      note: note.trim() || undefined,
    };
    const next = [nextAttempt, ...attempts].slice(0, 50);
    dirtyRef.current = true;
    setAttempts(next);
    persistAttempts(next);
    resetSession(prompt.id);
  };

  const averageFor = (attempt: PracticeAttempt) => {
    const values = criteria.map(item => attempt.scores[item.id]);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const promptAttempts = useMemo(() => attempts.filter(attempt => attempt.promptId === prompt.id), [attempts, prompt.id]);

  return <section className="pronunciation-practice" aria-label="Mode d’entraînement Lecture et voix">
    <header className="pronunciation-practice-header">
      <div><p className="eyebrow">ENTRAÎNEMENT</p><h2>Pratiquer à voix haute</h2><p>Le chronomètre reste local. Si tu choisis d’utiliser le micro, l’enregistrement reste uniquement en mémoire dans cet onglet : il n’est ni envoyé, ni ajouté à l’historique, et il est supprimé dès que tu recommences, changes de texte, enregistres la séance ou quittes cet écran.</p></div>
      <button type="button" onClick={onBack}>← Retour au cursus</button>
    </header>

    {warning && <p className="pronunciation-warning" role="alert">{warning}</p>}

    <div className="pronunciation-practice-grid">
      <aside className="pronunciation-prompt-list">
        {prompts.map(item => <button key={item.id} type="button" className={prompt.id === item.id ? 'active' : ''} disabled={running || requestingMicrophone} onClick={() => resetSession(item.id)}><small>{item.level}</small><strong>{item.title}</strong><span>{item.focus}</span></button>)}
      </aside>

      <div className="pronunciation-practice-main">
        <article className="pronunciation-prompt">
          <div className="pronunciation-prompt-meta"><span>{prompt.level}</span><strong>Cible ≈ {formatDuration(prompt.targetSeconds)}</strong></div>
          <h3>{prompt.title}</h3>
          <p className="pronunciation-focus">{prompt.focus}</p>
          <blockquote>{prompt.text}</blockquote>
          <div className="pronunciation-timer" aria-live="polite">
            <strong>{formatDuration(elapsed)}</strong>
            {running
              ? <button type="button" onClick={stop}>{recordingActive ? 'Arrêter et réécouter' : 'Arrêter'}</button>
              : <div className="pronunciation-start-actions">
                  <button type="button" className="primary" disabled={requestingMicrophone} onClick={startWithoutMicrophone}>{elapsed ? 'Recommencer sans micro' : 'Démarrer sans micro'}</button>
                  <button type="button" disabled={!canUseMicrophone || requestingMicrophone} onClick={() => void startWithMicrophone()}>{requestingMicrophone ? 'Autorisation du micro…' : 'Démarrer avec le micro'}</button>
                </div>}
          </div>
          {recordingError && <p className="pronunciation-recording-error" role="alert">{recordingError}</p>}
          {recordingUrl && !running && <div className="pronunciation-recording-playback"><div><strong>Réécouter cette tentative</strong><span>Audio temporaire · non enregistré</span></div><audio controls preload="metadata" src={recordingUrl}>Ton navigateur ne peut pas lire cet enregistrement.</audio></div>}
        </article>

        {elapsed > 0 && !running && <section className="pronunciation-self-review">
          <div><p className="eyebrow">AUTO-ÉVALUATION</p><h3>Note chaque axe séparément</h3><p>1 = fragile · 3 = stable · 5 = maîtrisé dans ce passage.</p></div>
          <div className="pronunciation-score-grid">{criteria.map(item => <div key={item.id} className="pronunciation-score-row"><div><strong>{item.label}</strong><small>{item.hint}</small></div><div>{[1,2,3,4,5].map(value => <button key={value} type="button" className={scores[item.id] === value ? 'active' : ''} onClick={() => setScores(current => ({ ...current, [item.id]: value }))} aria-label={`${item.label} : ${value} sur 5`}>{value}</button>)}</div></div>)}</div>
          <label className="pronunciation-practice-note">Observation pour la prochaine tentative<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Ex. : je perds le souffle sur la dernière phrase ; ralentir avant l’idée centrale." /></label>
          <button className="primary" type="button" disabled={!canSave} onClick={save}>Enregistrer cette séance</button>
        </section>}

        <section className="pronunciation-practice-history">
          <div><p className="eyebrow">HISTORIQUE</p><h3>{promptAttempts.length ? `${promptAttempts.length} séance${promptAttempts.length > 1 ? 's' : ''} sur ce texte` : 'Aucune séance enregistrée sur ce texte'}</h3></div>
          {promptAttempts.length > 0 && <div>{promptAttempts.slice(0, 6).map(attempt => <article key={attempt.id}><div><strong>{new Date(attempt.createdAt).toLocaleString('fr-FR')}</strong><span>{formatDuration(attempt.durationSeconds)} · moyenne {averageFor(attempt).toFixed(1)}/5</span></div><p>{criteria.map(item => `${item.label} ${attempt.scores[item.id]}/5`).join(' · ')}</p>{attempt.note && <blockquote>{attempt.note}</blockquote>}</article>)}</div>}
        </section>
      </div>
    </div>
  </section>;
}
