import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

export type MindNode = { id: string; parentId: string | null; text: string; createdAt: string };

type Props = {
  supportName: string;
  nodes: MindNode[];
  onChange: (nodes: MindNode[]) => void;
  onBack: () => void;
};

type PositionedNode = { node: MindNode; x: number; y: number; side: -1 | 0 | 1; depth: number };
type Edge = { from: string; to: string; side: -1 | 1 };

function descendants(nodes: MindNode[], parentId: string): string[] {
  const children = nodes.filter(node => node.parentId === parentId);
  return children.flatMap(child => [child.id, ...descendants(nodes, child.id)]);
}

function depthOf(nodes: MindNode[], node: MindNode): number {
  if (!node.parentId) return 0;
  const parent = nodes.find(candidate => candidate.id === node.parentId);
  return parent ? depthOf(nodes, parent) + 1 : 0;
}

function buildLayout(nodes: MindNode[], root: MindNode) {
  const childrenOf = (id: string) => nodes.filter(node => node.parentId === id);
  const firstLevel = childrenOf(root.id);
  const leftRoots = firstLevel.filter((_, index) => index % 2 === 1);
  const rightRoots = firstLevel.filter((_, index) => index % 2 === 0);
  const positioned: PositionedNode[] = [];
  const edges: Edge[] = [];
  const centerX = 700;
  const horizontalStep = 235;
  const verticalStep = 106;
  let leftCursor = 90;
  let rightCursor = 90;

  const placeBranch = (node: MindNode, side: -1 | 1, depth: number): number => {
    const children = childrenOf(node.id);
    let y: number;
    if (!children.length) {
      y = side === -1 ? leftCursor : rightCursor;
      if (side === -1) leftCursor += verticalStep;
      else rightCursor += verticalStep;
    } else {
      const ys = children.map(child => {
        edges.push({ from: node.id, to: child.id, side });
        return placeBranch(child, side, depth + 1);
      });
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    positioned.push({ node, x: centerX + side * horizontalStep * depth, y, side, depth });
    return y;
  };

  rightRoots.forEach(node => {
    edges.push({ from: root.id, to: node.id, side: 1 });
    placeBranch(node, 1, 1);
  });
  leftRoots.forEach(node => {
    edges.push({ from: root.id, to: node.id, side: -1 });
    placeBranch(node, -1, 1);
  });

  const contentHeight = Math.max(leftCursor, rightCursor, 520);
  const rootY = contentHeight / 2;
  positioned.push({ node: root, x: centerX, y: rootY, side: 0, depth: 0 });
  return { positioned, edges, width: 1400, height: contentHeight };
}

export function MindMap({ supportName, nodes, onChange, onBack }: Props) {
  const rootNodes = useMemo(() => nodes.filter(node => node.parentId === null), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(rootNodes[0]?.id ?? null);
  const [text, setText] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);
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

  const root = rootNodes[0] ?? null;
  const layout = useMemo(() => root ? buildLayout(nodes, root) : null, [nodes, root]);
  const byId = useMemo(() => new Map(layout?.positioned.map(item => [item.node.id, item]) ?? []), [layout]);
  const maxDepth = nodes.length ? Math.max(...nodes.map(node => depthOf(nodes, node))) : 0;

  const recenter = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ left: Math.max(0, 700 - viewport.clientWidth / 2), top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const timer = window.setTimeout(recenter, 80);
    return () => window.clearTimeout(timer);
  }, []);

  return <main className="shell mind-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="mind-header"><p className="eyebrow">CARTE MENTALE</p><h1>{supportName}</h1><p>Le sujet reste au centre. Les idées principales se déploient autour de lui, puis leurs sous-idées prolongent chaque branche.</p></header>
    <div className="mind-layout">
      <section className="mind-canvas" aria-label="Carte mentale">
        <div className="mind-canvas-title"><div><p className="eyebrow">CARTE MENTALE</p><strong>{nodes.length || 1} nœud{(nodes.length || 1) > 1 ? 's' : ''}</strong></div><div className="mind-actions"><small>{maxDepth + 1} niveau{maxDepth > 0 ? 'x' : ''}</small><button type="button" onClick={recenter}>Recentrer</button></div></div>
        {!root ? <div className="mind-empty"><button className="mind-root-preview" type="button" onClick={() => { const made = ensureRoot(); setSelectedId(made.id); }}>{supportName}</button><p>Touche le sujet pour commencer la carte.</p></div> : <div className="mind-viewport" ref={viewportRef}>
          <div className="mind-map-stage" style={{ width: layout?.width, height: layout?.height }}>
            <svg className="mind-links" width={layout?.width} height={layout?.height} aria-hidden="true">
              {layout?.edges.map(edge => {
                const from = byId.get(edge.from);
                const to = byId.get(edge.to);
                if (!from || !to) return null;
                const startX = from.x + edge.side * (from.depth === 0 ? 108 : 92);
                const endX = to.x - edge.side * 92;
                const control = (startX + endX) / 2;
                return <path key={`${edge.from}-${edge.to}`} d={`M ${startX} ${from.y} C ${control} ${from.y}, ${control} ${to.y}, ${endX} ${to.y}`} />;
              })}
            </svg>
            {layout?.positioned.map(item => <button
              key={item.node.id}
              type="button"
              className={`mind-map-node depth-${Math.min(item.depth, 4)}${item.node.id === selectedId ? ' selected' : ''}${item.depth === 0 ? ' root' : ''}`}
              style={{ left: item.x, top: item.y }}
              onClick={() => setSelectedId(item.node.id)}
              aria-pressed={item.node.id === selectedId}
            >
              {item.depth === 0 ? <span>Sujet</span> : <span>Niveau {item.depth}</span>}
              <strong>{item.node.text}</strong>
            </button>)}
          </div>
        </div>}
      </section>
      <aside className="mind-editor">
        <p className="eyebrow">NŒUD SÉLECTIONNÉ</p>
        <h2>{selected?.text ?? supportName}</h2>
        <form onSubmit={addNode}><label>Ajouter une idée reliée<input value={text} onChange={event => setText(event.target.value)} placeholder="Nouvelle notion…" /></label><button className="primary" type="submit" disabled={!text.trim()}>Ajouter</button></form>
        <button className="mind-delete" type="button" disabled={!selected || selected.parentId === null} onClick={removeSelected}>Supprimer cette branche</button>
        <small>{nodes.length || 1} nœud{(nodes.length || 1) > 1 ? 's' : ''} enregistré{(nodes.length || 1) > 1 ? 's' : ''}</small>
      </aside>
    </div>
  </main>;
}
