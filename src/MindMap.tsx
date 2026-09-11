import { FormEvent, useEffect, useMemo, useState } from 'react';

export type MindNode = { id: string; parentId: string | null; text: string; createdAt: string };

type Props = {
  supportName: string;
  nodes: MindNode[];
  onChange: (nodes: MindNode[]) => void;
  onBack: () => void;
};

function descendants(nodes: MindNode[], parentId: string): string[] {
  const children = nodes.filter(node => node.parentId === parentId);
  return children.flatMap(child => [child.id, ...descendants(nodes, child.id)]);
}

function depthOf(nodes: MindNode[], node: MindNode): number {
  if (!node.parentId) return 0;
  const parent = nodes.find(candidate => candidate.id === node.parentId);
  return parent ? depthOf(nodes, parent) + 1 : 0;
}

function VisualBranch({ node, nodes, selectedId, onSelect }: { node: MindNode; nodes: MindNode[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const children = nodes.filter(child => child.parentId === node.id);
  const depth = depthOf(nodes, node);
  return <div className="mind-branch" data-depth={Math.min(depth, 4)}>
    <button className={`mind-node${selectedId === node.id ? ' selected' : ''}`} type="button" onClick={() => onSelect(node.id)} aria-pressed={selectedId === node.id}>
      <span className="mind-node-level">{depth === 0 ? 'Sujet' : `Niveau ${depth}`}</span>
      <strong>{node.text}</strong>
      {children.length > 0 && <small>{children.length} idée{children.length > 1 ? 's' : ''} liée{children.length > 1 ? 's' : ''}</small>}
    </button>
    {children.length > 0 && <div className="mind-children" aria-label={`Idées liées à ${node.text}`}>
      {children.map(child => <VisualBranch key={child.id} node={child} nodes={nodes} selectedId={selectedId} onSelect={onSelect} />)}
    </div>}
  </div>;
}

export function MindMap({ supportName, nodes, onChange, onBack }: Props) {
  const rootNodes = useMemo(() => nodes.filter(node => node.parentId === null), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(rootNodes[0]?.id ?? null);
  const [text, setText] = useState('');
  const selected = nodes.find(node => node.id === selectedId) ?? null;

  useEffect(() => {
    if (!nodes.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !nodes.some(node => node.id === selectedId)) setSelectedId(rootNodes[0]?.id ?? nodes[0].id);
  }, [nodes, rootNodes, selectedId]);

  const ensureRoot = () => {
    if (rootNodes.length > 0) return rootNodes[0];
    const root: MindNode = { id: crypto.randomUUID(), parentId: null, text: supportName, createdAt: new Date().toISOString() };
    onChange([root, ...nodes]);
    setSelectedId(root.id);
    return root;
  };

  const addNode = (event: FormEvent) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    const parent = selected ?? ensureRoot();
    const next: MindNode = { id: crypto.randomUUID(), parentId: parent.id, text: clean, createdAt: new Date().toISOString() };
    onChange([...nodes, next]);
    setSelectedId(next.id);
    setText('');
  };

  const removeSelected = () => {
    if (!selected || selected.parentId === null) return;
    const removedIds = new Set([selected.id, ...descendants(nodes, selected.id)]);
    onChange(nodes.filter(node => !removedIds.has(node.id)));
    setSelectedId(selected.parentId);
  };

  const roots = rootNodes.length ? rootNodes : [{ id: '__preview__', parentId: null, text: supportName, createdAt: '' } as MindNode];
  const maxDepth = nodes.length ? Math.max(...nodes.map(node => depthOf(nodes, node))) : 0;

  return <main className="shell mind-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="mind-header"><p className="eyebrow">CARTE MENTALE</p><h1>{supportName}</h1><p>Construis progressivement les idées principales et leurs liens. Tout reste enregistré localement.</p></header>
    <div className="mind-layout">
      <section className="mind-canvas" aria-label="Carte mentale">
        <div className="mind-canvas-title"><div><p className="eyebrow">CARTE VISUELLE</p><strong>{nodes.length || 1} nœud{(nodes.length || 1) > 1 ? 's' : ''}</strong></div><small>{maxDepth + 1} niveau{maxDepth > 0 ? 'x' : ''} · touche un nœud pour le sélectionner</small></div>
        <div className="mind-board">
          {roots.map(root => root.id === '__preview__'
            ? <div className="mind-branch" key={root.id}><button className="mind-node" type="button" onClick={() => { const made = ensureRoot(); setSelectedId(made.id); }}><span className="mind-node-level">Sujet</span><strong>{root.text}</strong><small>Touche pour commencer</small></button></div>
            : <VisualBranch key={root.id} node={root} nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />)}
        </div>
      </section>
      <aside className="mind-editor">
        <p className="eyebrow">NŒUD SÉLECTIONNÉ</p>
        <h2>{selected?.text ?? supportName}</h2>
        <form onSubmit={addNode}><label>Ajouter une idée enfant<input value={text} onChange={event => setText(event.target.value)} placeholder="Nouvelle notion…" /></label><button className="primary" type="submit" disabled={!text.trim()}>Ajouter</button></form>
        <button className="mind-delete" type="button" disabled={!selected || selected.parentId === null} onClick={removeSelected}>Supprimer cette branche</button>
        <small>{nodes.length || 1} nœud{(nodes.length || 1) > 1 ? 's' : ''} enregistré{(nodes.length || 1) > 1 ? 's' : ''}</small>
      </aside>
    </div>
  </main>;
}
