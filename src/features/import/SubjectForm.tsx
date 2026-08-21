import { FormEvent, useState } from 'react';
import { createSubject } from '../../data/repository';
import { requestSync } from '../../lib/sync';

export function SubjectForm() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createSubject(name);
      setName('');
      void requestSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer la matière.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="subject-form" onSubmit={submit}>
      <label htmlFor="subject-name">Nouvelle matière</label>
      <div className="field-row">
        <input
          id="subject-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex. Arabe, Français, Religion…"
          maxLength={120}
          autoComplete="off"
        />
        <button className="button button--secondary" type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Ajout…' : 'Ajouter'}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
