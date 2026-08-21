import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SubjectRecord } from '../../data/db';
import { DuplicateSupportError, importFile, importPastedText } from '../../data/repository';
import { requestSync } from '../../lib/sync';

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

  useEffect(() => {
    if (!subjects.length) {
      if (subjectId) setSubjectId('');
      return;
    }
    if (!subjects.some((subject) => subject.id === subjectId)) {
      setSubjectId(subjects[0].id);
    }
  }, [subjects, subjectId]);

  if (!subjects.length) {
    return (
      <div className="empty-panel">
        <h3>Commencez par une matière</h3>
        <p>Un support doit toujours appartenir à une matière afin que les futures révisions restent organisées.</p>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDuplicateId(null);
    setBusy(true);
    try {
      if (mode === 'file') {
        if (!file) throw new Error('Choisissez un fichier PDF, TXT ou Markdown.');
        await importFile(subjectId, file, title);
        setFile(null);
        setTitle('');
        if (inputRef.current) inputRef.current.value = '';
      } else {
        await importPastedText(subjectId, title, text);
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
          <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>
        <label>
          <span>Titre {mode === 'file' ? '(facultatif)' : ''}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mode === 'file' ? 'Nom du fichier par défaut' : 'Titre du texte'} maxLength={240} />
        </label>
      </div>

      {mode === 'file' ? (
        <label className="file-drop">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <span className="file-drop__icon" aria-hidden="true">＋</span>
          <strong>{file ? file.name : 'Choisir un PDF ou un texte'}</strong>
          <small>{file ? `${formatBytes(file.size)} · sera conservé localement avant synchronisation` : 'PDF, TXT ou Markdown · 25 Mo maximum'}</small>
        </label>
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
        <p>Le contenu est extrait réellement avant d’être déclaré prêt.</p>
        <button className="button button--primary" type="submit" disabled={busy || !subjectId || (mode === 'file' ? !file : !text.trim())}>
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
