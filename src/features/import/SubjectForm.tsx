import { FormEvent, useState } from 'react';
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

  async function submit(event: FormEvent) {
    event.preventDefault();
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
      setSaving(false);
    }
  }

  return (
    <form className="subject-form" onSubmit={submit}>
      <label htmlFor={inputId}>Nouvelle matière</label>
      <div className="field-row">
        <input
          id={inputId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex. Arabe, Français, Religion…"
          maxLength={120}
          autoComplete="off"
        />
        <button className="button button--secondary" type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Ajout…' : submitLabel}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
