import { FormEvent, useRef, useState } from 'react';
import type { SubjectRecord } from '../../data/db';
import { createSubject } from '../../data/repository';
import { requestSync } from '../../lib/sync';

type SubjectFormProps = {
  inputId?: string;
  submitLabel?: string;
  onCreated?: (subject: SubjectRecord) => void;
};

export function SubjectForm({
  inputId = 'subject-name',
  submitLabel = 'Ajouter',
  onCreated,
}: SubjectFormProps = {}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitLockRef = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setError(null);
    setSaving(true);
    try {
      const subject = await createSubject(name);
      setName('');
      onCreated?.(subject);
      void requestSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer la matière.');
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="subject-form" onSubmit={submit} aria-busy={saving}>
      <label htmlFor={inputId}>Nouvelle matière</label>
      <div className="field-row">
        <input
          id={inputId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex. Arabe, Français, Religion…"
          maxLength={120}
          autoComplete="off"
          disabled={saving}
        />
        <button className="button button--secondary" type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Ajout…' : submitLabel}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
