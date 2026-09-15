import { useState } from 'react';
import type { MemoryPassage } from './TextMemorization';
import { getSupportMetadata, patchSupportMetadata } from './storage';

type GeneratedPassage = {
  title: string;
  text: string;
};

type StoredSupport = {
  id: string;
  memoryPassages?: MemoryPassage[];
  [key: string]: unknown;
};

type Props = {
  supportId: string;
  supportName: string;
  context: string;
  accessToken: string;
};

function passageSignature(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');
}

export function AiMemoryPassageGenerator({ supportId, supportName, context, accessToken }: Props) {
  const [count, setCount] = useState<3 | 5>(3);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generated, setGenerated] = useState<GeneratedPassage[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const generate = async () => {
    if (generating) return;
    if (!accessToken.trim()) {
      setError('Saisis d’abord le code d’accès IA dans le panneau principal.');
      return;
    }
    setGenerating(true);
    setGenerated([]);
    setStatus('Sélection des passages fidèles au support…');
    setError('');
    try {
      const response = await fetch('/api/ai/passages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sirafiq-ai-token': accessToken.trim(),
        },
        body: JSON.stringify({ supportName, context, count }),
      });
      const data = await response.json().catch(() => null) as { passages?: GeneratedPassage[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Impossible de sélectionner les passages.');
      if (!Array.isArray(data?.passages) || data.passages.length !== count) throw new Error('Le nombre de passages reçus est incorrect.');
      setGenerated(data.passages);
      setStatus(`${data.passages.length} passages vérifiés par rapport au texte du support.`);
    } catch (reason) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : 'Impossible de sélectionner les passages.');
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!generated.length || saving) return;
    setSaving(true);
    setError('');
    try {
      const support = await getSupportMetadata<StoredSupport>(supportId);
      if (!support) throw new Error('Support local introuvable.');
      const existing = support.memoryPassages ?? [];
      const signatures = new Set(existing.map(item => passageSignature(item.text)));
      const createdAt = new Date().toISOString();
      const additions: MemoryPassage[] = generated
        .filter(item => {
          const signature = passageSignature(item.text);
          if (signatures.has(signature)) return false;
          signatures.add(signature);
          return true;
        })
        .map(item => ({
          id: crypto.randomUUID(),
          title: item.title.trim(),
          text: item.text.trim(),
          createdAt,
          attempts: 0,
          successes: 0,
          stage: 0,
        }));

      if (!additions.length) {
        setGenerated([]);
        setStatus('Ces passages sont déjà présents dans la mémorisation. Aucun doublon n’a été ajouté.');
        return;
      }

      await patchSupportMetadata<StoredSupport>(supportId, { memoryPassages: [...additions, ...existing] });
      setGenerated([]);
      setStatus(`${additions.length} passage${additions.length > 1 ? 's' : ''} ajouté${additions.length > 1 ? 's' : ''} à la mémorisation et dû${additions.length > 1 ? 's' : ''} dès maintenant.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible d’enregistrer les passages.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="ai-panel ai-passage-panel">
    <div className="ai-passage-head">
      <div>
        <p className="eyebrow">MÉMORISATION ASSISTÉE</p>
        <h2>Passages fidèles depuis le support</h2>
        <p>Sirāfiq ne conserve que les extraits dont le texte est réellement retrouvé dans le contexte du support. Les paraphrases sont rejetées côté serveur.</p>
      </div>
      <label>Nombre de passages<select value={count} onChange={event => setCount(Number(event.target.value) as 3 | 5)}><option value={3}>3</option><option value={5}>5</option></select></label>
    </div>

    <button className="primary ai-generate-cards" type="button" disabled={generating || saving} onClick={() => void generate()}>{generating ? 'Sélection…' : `Sélectionner ${count} passages`}</button>
    {status && <p className="ai-card-status" role="status">{status}</p>}
    {error && <p className="ai-error-message" role="alert">{error}</p>}

    {generated.length > 0 && <div className="ai-generated-passages">{generated.map((passage, index) => <article key={`${passage.title}-${index}`}><span>Passage {index + 1}</span><strong>{passage.title}</strong><p>{passage.text}</p></article>)}</div>}
    {generated.length > 0 && <div className="ai-card-actions"><button type="button" disabled={saving} onClick={() => { setGenerated([]); setStatus('Proposition écartée.'); }}>Écarter</button><button className="primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Enregistrement…' : 'Ajouter à la mémorisation'}</button></div>}
  </section>;
}
