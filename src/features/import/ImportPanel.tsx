import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SubjectRecord } from '../../data/db';
import { DuplicateSupportError, importFile, importPastedText } from '../../data/repository';
import { requestSync, type TransferProgress } from '../../lib/sync';
import {
  LOCAL_PDF_EXTRACTION_MAX_BYTES,
  MAX_RESOURCE_FILE_BYTES,
  MEBIBYTE,
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
} from '../../shared/importPolicy';
import { SubjectForm } from './SubjectForm';

type Mode = 'file' | 'text';

export function ImportPanel({ subjects }: { subjects: SubjectRecord[] }) {
  const [mode, setMode] = useState<Mode>('file');
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const firstSubjectId = subjects[0]?.id ?? '';
  const effectiveSubjectId = subjects.some((subject) => subject.id === subjectId) ? subjectId : firstSubjectId;

  useEffect(() => {
    if (subjectId !== effectiveSubjectId) setSubjectId(effectiveSubjectId);
  }, [effectiveSubjectId, subjectId]);

  if (!subjects.length) {
    return (
      <div className="empty-panel empty-panel--onboarding">
        <h3>Commencez par une matière</h3>
        <p>Créez-la ici, puis l’import sera disponible immédiatement sans quitter cette zone.</p>
        <SubjectForm inputId="import-subject-name" submitLabel="Créer et continuer" onCreated={(subject) => setSubjectId(subject.id)} />
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDuplicateId(null);
    setProgress(null);
    setBusy(true);
    try {
      if (!effectiveSubjectId) throw new Error('Choisissez une matière avant l’import.');

      if (mode === 'file') {
        if (!file) throw new Error('Choisissez un fichier PDF, TXT ou Markdown.');
        if (file.size > MAX_RESOURCE_FILE_BYTES) throw new Error('Ce fichier dépasse la taille maximale acceptée par le stockage R2.');
        await importFile(effectiveSubjectId, file, title, setProgress);
        setFile(null);
        setTitle('');
        if (inputRef.current) inputRef.current.value = '';
      } else {
        await importPastedText(effectiveSubjectId, title, text);
        setTitle('');
        setText('');
      }
      void requestSync();
    } catch (err) {
      if (err instanceof DuplicateSupportError) {
        setDuplicateId(err.existingResourceId);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'L’import a échoué.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="import-panel" onSubmit={submit}>
      <div className="segmented" aria-label="Type d’import">
        <button type="button" className={mode === 'file' ? 'is-active' : ''} onClick={() => setMode('file')}>Fichier</button>
        <button type="button" className={mode === 'text' ? 'is-active' : ''} onClick={() => setMode('text')}>Texte</button>
      </div>

      <div className="form-grid">
        <label>
          <span>Matière</span>
          <select aria-label="Matière du support" value={effectiveSubjectId} onChange={(event) => setSubjectId(event.target.value)}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>
        <label>
          <span>Titre {mode === 'file' ? '(facultatif)' : ''}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mode === 'file' ? 'Nom du fichier par défaut' : 'Titre du texte'} maxLength={240} />
        </label>
      </div>

      {mode === 'file' ? (
        <div className="file-drop">
          <input
            ref={inputRef}
            aria-label="Fichier du support"
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            onChange={(event) => {
              setError(null);
              setProgress(null);
              setFile(event.target.files?.[0] ?? null);
            }}
          />
          <span className="file-drop__icon" aria-hidden="true">＋</span>
          <strong>{file ? file.name : 'Choisir un PDF ou un texte'}</strong>
          <small>
            {file
              ? `${formatBytes(file.size)} · ${file.size > MULTIPART_UPLOAD_THRESHOLD_BYTES ? 'envoi R2 par morceaux, sans copie locale intégrale' : 'conservé localement avant synchronisation'}`
              : `PDF, TXT ou Markdown · gros fichiers envoyés automatiquement par morceaux · extraction PDF locale jusqu’à ${formatMiB(LOCAL_PDF_EXTRACTION_MAX_BYTES)} Mo`}
          </small>
          {progress && <UploadProgress progress={progress} />}
          <button type="button" className="button button--secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {file ? 'Changer de fichier' : 'Parcourir les fichiers'}
          </button>
        </div>
      ) : (
        <label className="text-import">
          <span>Contenu</span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Collez ou écrivez le texte à mémoriser plus tard…" rows={9} />
        </label>
      )}

      {error && (
        <div className="error-box" role="alert">
          <strong>Import non terminé</strong>
          <span>{error}</span>
          {file && file.size > MULTIPART_UPLOAD_THRESHOLD_BYTES && !duplicateId && (
            <small>Les morceaux déjà reçus restent enregistrés. Gardez ou resélectionnez le même fichier puis relancez l’import pour reprendre.</small>
          )}
          {duplicateId && <Link to={`/bibliotheque/${duplicateId}`}>Ouvrir le support existant</Link>}
        </div>
      )}

      <div className="import-actions">
        <p>Le support n’est déclaré synchronisé qu’après confirmation du stockage R2.</p>
        <button className="button button--primary" type="submit" disabled={busy || !effectiveSubjectId || (mode === 'file' ? !file : !text.trim())}>
          {busy ? busyLabel(progress) : 'Importer le support'}
        </button>
      </div>
    </form>
  );
}

function UploadProgress({ progress }: { progress: TransferProgress }) {
  const percent = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.processedBytes / progress.totalBytes) * 100)) : 0;
  const label = progress.phase === 'hashing'
    ? `Vérification du fichier · ${percent} %`
    : progress.phase === 'finalizing'
      ? 'Assemblage final dans R2…'
      : `Envoi · morceau ${progress.partNumber ?? 0}/${progress.partCount ?? 0} · ${percent} %`;
  return <div className="upload-progress" role="status" aria-live="polite"><strong>{label}</strong></div>;
}

function busyLabel(progress: TransferProgress | null): string {
  if (!progress) return 'Préparation…';
  if (progress.phase === 'hashing') return 'Vérification…';
  if (progress.phase === 'finalizing') return 'Finalisation…';
  return `Envoi ${progress.partNumber ?? 0}/${progress.partCount ?? 0}…`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < MEBIBYTE) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / MEBIBYTE).toFixed(1)} Mo`;
}

function formatMiB(bytes: number): number {
  return Math.round(bytes / MEBIBYTE);
}
