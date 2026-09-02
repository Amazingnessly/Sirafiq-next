import { FormEvent, useMemo, useState } from 'react';

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

function Branch({ node, nodes, selectedId, onSelect }: { node: MindNode; nodes: MindNode[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const children = nodes.filter(child => child.parentId === node.id);
  return <li>
    <button className={selectedId === node.id ? 'selected' : ''} type="button" onClick={() => onSelect(node.id)}>{node.text}</button>
    {children.length > 0 && <ul>{children.map(child => <Branch key={child.id} node={child} nodes={nodes} selectedId={selectedId} onSelect={onSelect} />)}</ul>}
  </li>;
}

export function MindMap({ supportName, nodes, onChange, onBack }: Props) {
  const rootNodes = useMemo(() => nodes.filter(node => node.parentId === null), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(rootNodes[0]?.id ?? null);
  const [text, setText] = useState('');
  const selected = nodes.find(node => node.id === selectedId) ?? null;

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

  return <main className="shell mind-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="mind-header"><p className="eyebrow">CARTE MENTALE</p><h1>{supportName}</h1><p>Construis progressivement les idées principales et leurs liens. Tout reste enregistré localement.</p></header>
    <div className="mind-layout">
      <section className="mind-canvas" aria-label="Carte mentale">
        <ul className="mind-tree">{roots.map(root => root.id === '__preview__' ? <li key={root.id}><button type="button" onClick={() => { const made = ensureRoot(); setSelectedId(made.id); }}>{root.text}</button></li> : <Branch key={root.id} node={root} nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />)}</ul>
      </section>
      <aside className="mind-editor">
        <p className="eyebrow">NŒUD SÉLECTIONNÉ</p>
        <h2>{selected?.text ?? supportName}</h2>
        <form onSubmit={addNode}><label>Ajouter une idée enfant<input value={text} onChange={event => setText(event.target.value)} placeholder="Nouvelle notion…" /></label><button className="primary" type="submit" disabled={!text.trim()}>Ajouter</button></form>
        <button className="mind-delete" type="button" disabled={!selected || selected.parentId === null} onClick={removeSelected}>Supprimer cette branche</button>
        <small>{nodes.length || 1} nœud{(nodes.length || 1) > 1 ? 's' : ''}</small>
      </aside>
    </div>
  </main>;
}
