import { type ReactNode, useMemo, useState } from 'react';
import type { MindNode } from './MindMap';
import { getSupportMetadata, patchSupportMetadata } from './storage';

type GeneratedMindNode = {
  key: string;
  parentKey: string;
  text: string;
};

type StoredSupport = {
  id: string;
  mindMap?: MindNode[];
  [key: string]: unknown;
};

type Props = {
  supportId: string;
  supportName: string;
  context: string;
  accessToken: string;
};

function toMindNodes(nodes: GeneratedMindNode[]): MindNode[] {
  const ids = new Map(nodes.map(node => [node.key, crypto.randomUUID()]));
  const createdAt = new Date().toISOString();
  return nodes.map(node => ({
    id: ids.get(node.key)!,
    parentId: node.parentKey ? ids.get(node.parentKey) ?? null : null,
    text: node.text,
    createdAt,
  }));
}

export function AiMindMapGenerator({ supportId, supportName, context, accessToken }: Props) {
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generated, setGenerated] = useState<GeneratedMindNode[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const childrenByParent = useMemo(() => {
    const grouped = new Map<string, GeneratedMindNode[]>();
    for (const node of generated) {
      const children = grouped.get(node.parentKey) ?? [];
      children.push(node);
      grouped.set(node.parentKey, children);
    }
    return grouped;
  }, [generated]);

  const generate = async () => {
    if (generating) return;
    if (!accessToken.trim()) {
      setError('Saisis d’abord le code d’accès IA dans le panneau principal.');
      return;
    }
    setGenerating(true);
    setGenerated([]);
    setSaved(false);
    setStatus('Construction de la carte mentale…');
    setError('');
    try {
      const response = await fetch('/api/ai/mindmap', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sirafiq-ai-token': accessToken.trim(),
        },
        body: JSON.stringify({ supportName, context }),
      });
      const data = await response.json().catch(() => null) as { nodes?: GeneratedMindNode[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Impossible de générer la carte mentale.');
      if (!Array.isArray(data?.nodes) || data.nodes.length < 2) throw new Error('La carte générée est inutilisable.');
      setGenerated(data.nodes);
      setStatus(`${data.nodes.length} nœuds générés. Vérifie la structure avant de l’enregistrer.`);
    } catch (reason) {
      setStatus('');
      setError(reason instanceof Error ? reason.message : 'Impossible de générer la carte mentale.');
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
      const existingCount = support.mindMap?.length ?? 0;
      if (existingCount > 0 && !window.confirm(`Remplacer la carte mentale actuelle (${existingCount} nœud${existingCount > 1 ? 's' : ''}) par celle générée par l’IA ?`)) {
        setStatus('Carte actuelle conservée. La proposition IA n’a pas été enregistrée.');
        return;
      }

      const mindMap = toMindNodes(generated);
      await patchSupportMetadata<StoredSupport>(supportId, { mindMap });
      setSaved(true);
      setStatus(`Carte mentale enregistrée avec ${mindMap.length} nœuds. Reviens à l’espace d’étude pour l’ouvrir.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible d’enregistrer la carte mentale.');
    } finally {
      setSaving(false);
    }
  };

  const renderBranch = (parentKey: string, depth = 0): ReactNode => {
    const children = childrenByParent.get(parentKey) ?? [];
    if (!children.length || depth > 4) return null;
    return <ul>{children.map(node => <li key={node.key}><strong>{node.text}</strong>{renderBranch(node.key, depth + 1)}</li>)}</ul>;
  };

  const root = generated.find(node => !node.parentKey);

  return <section className="ai-panel ai-mindmap-panel">
    <div className="ai-mindmap-head">
      <div>
        <p className="eyebrow">STRUCTURATION ASSISTÉE</p>
        <h2>Carte mentale depuis le support</h2>
        <p>L’IA propose une hiérarchie de notions uniquement à partir du contexte extrait. Rien n’est enregistré avant ta validation.</p>
      </div>
      <button className="primary" type="button" disabled={generating || saving} onClick={() => void generate()}>{generating ? 'Construction…' : 'Générer une carte mentale'}</button>
    </div>

    {status && <p className="ai-card-status" role="status">{status}</p>}
    {error && <p className="ai-error-message" role="alert">{error}</p>}

    {root && <div className="ai-mindmap-preview">
      <div className="ai-mindmap-root"><span>Sujet central</span><strong>{root.text}</strong></div>
      {renderBranch(root.key)}
    </div>}

    {generated.length > 0 && <div className="ai-card-actions">
      <button type="button" disabled={saving} onClick={() => { setGenerated([]); setSaved(false); setStatus('Proposition écartée.'); }}>Écarter</button>
      {!saved && <button className="primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Enregistrement…' : 'Enregistrer comme carte mentale'}</button>}
    </div>}
  </section>;
}
