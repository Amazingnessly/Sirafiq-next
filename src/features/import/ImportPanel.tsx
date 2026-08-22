import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SubjectRecord } from '../../data/db';
import { DuplicateSupportError, importFile, importPastedText } from '../../data/repository';
import { requestSync } from '../../lib/sync';
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
  const inputRef = useRef<HTMLInputElement>(null);

  const firstSubjectId = subjects[0]?.id ?? '';
  const effectiveSubjectId = subjects.some((subject) => subject.id === subjectId)
    ? subjectId
    : firstSubjectId;

  useEffect(() => {
    if (subjectId !== effectiveSubjectId) {
      setSubjectId(effectiveSubjectId);
    }
  }, [effectiveSubjectId, subjectId]);

  if (!subjects.length) {
    return (
      <div className="empty-panel empty-panel--onboarding">
        <h3>Commencez par une matière</h3>
        <p>Créez-la ici, puis l’import sera disponible immédiatement sans quitter cette zone.</p>
        <SubjectForm
          inputId="import-subject-name"
          submitLabel="Créer et continuer"
          onCreated={(subject) => setSubjectId(subject.id)}
        />
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDuplicateId(null);
    setBusy(true);
    try {
      if (!effectiveSubjectId) throw new Error('Choisissez une matière avant l’import.');

      if (mode === 'file') {
        if (!file) throw new Error('Choisissez un fichier PDF, TXT ou Markdown.');
        await importFile(effectiveSubjectId, file, title);
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
              setFile(event.target.files?.[0] ?? null);
            }}
          />
          <span className="file-drop__icon" aria-hidden="true">＋</span>
          <strong>{file ? file.name : 'Choisir un PDF ou un texte'}</strong>
          <small>{file ? `${formatBytes(file.size)} · sera conservé localement avant synchronisation` : 'PDF, TXT ou Markdown · 25 Mo maximum'}</small>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => inputRef.current?.click()}
          >
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
          {duplicateId && <Link to={`/bibliotheque/${duplicateId}`}>Ouvrir le support existant</Link>}
        </div>
      )}

      <div className="import-actions">
        <p>Le support n’est déclaré prêt qu’après lecture et enregistrement local réels.</p>
        <button className="button button--primary" type="submit" disabled={busy || !effectiveSubjectId || (mode === 'file' ? !file : !text.trim())}>
          {busy ? 'Analyse et enregistrement…' : 'Importer le support'}
        </button>
      </div>
    </form>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
