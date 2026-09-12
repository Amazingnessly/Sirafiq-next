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

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.25;
const ZOOM_STEP = 0.1;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function descendants(nodes: MindNode[], parentId: string, visited = new Set<string>()): string[] {
  if (visited.has(parentId)) return [];
  visited.add(parentId);
  const children = nodes.filter(node => node.parentId === parentId && !visited.has(node.id));
  return children.flatMap(child => [child.id, ...descendants(nodes, child.id, visited)]);
}

function buildLayout(nodes: MindNode[], root: MindNode) {
  const ids = new Set(nodes.map(node => node.id));
  const effectiveParent = new Map<string, string>();

  nodes.forEach(node => {
    if (node.id === root.id) return;
    const parentId = node.parentId;
    const validParent = parentId && parentId !== node.id && ids.has(parentId);
    effectiveParent.set(node.id, validParent ? parentId : root.id);
  });

  nodes.forEach(node => {
    if (node.id === root.id) return;
    const seen = new Set<string>([node.id]);
    let cursor = node.id;
    while (true) {
      const parentId = effectiveParent.get(cursor);
      if (!parentId || parentId === root.id) break;
      if (seen.has(parentId)) {
        effectiveParent.set(node.id, root.id);
        break;
      }
      seen.add(parentId);
      cursor = parentId;
    }
  });

  const childrenOf = (id: string) => nodes.filter(node => node.id !== root.id && effectiveParent.get(node.id) === id);
  const firstLevel = childrenOf(root.id);
  const leftRoots = firstLevel.filter((_, index) => index % 2 === 1);
  const rightRoots = firstLevel.filter((_, index) => index % 2 === 0);
  const positioned: PositionedNode[] = [];
  const edges: Edge[] = [];
  const horizontalStep = 220;
  const verticalStep = 112;
  let leftCursor = 82;
  let rightCursor = 82;

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
    positioned.push({ node, x: side * horizontalStep * depth, y, side, depth });
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

  const branchBottom = Math.max(leftCursor, rightCursor);
  const rawRootY = Math.max(150, (branchBottom - verticalStep + 82) / 2);
  positioned.push({ node: root, x: 0, y: rawRootY, side: 0, depth: 0 });

  const horizontalPadding = 54;
  const verticalPadding = 48;
  const minX = Math.min(...positioned.map(item => item.x - (item.depth === 0 ? 108 : 92))) - horizontalPadding;
  const maxX = Math.max(...positioned.map(item => item.x + (item.depth === 0 ? 108 : 92))) + horizontalPadding;
  const minY = Math.min(...positioned.map(item => item.y - (item.depth === 0 ? 50 : 40))) - verticalPadding;
  const maxY = Math.max(...positioned.map(item => item.y + (item.depth === 0 ? 50 : 40))) + verticalPadding;
  const shiftX = -minX;
  const shiftY = -minY;
  const compactPositioned = positioned.map(item => ({ ...item, x: item.x + shiftX, y: item.y + shiftY }));

  return {
    positioned: compactPositioned,
    edges,
    width: Math.max(360, maxX - minX),
    height: Math.max(260, maxY - minY),
    centerX: shiftX,
    rootY: rawRootY + shiftY,
    effectiveParent,
  };
}

export function MindMap({ supportName, nodes, onChange, onBack }: Props) {
  const rootNodes = useMemo(() => nodes.filter(node => node.parentId === null), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(rootNodes[0]?.id ?? null);
  const [text, setText] = useState('');
  const [editText, setEditText] = useState(rootNodes[0]?.text ?? supportName);
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const selected = nodes.find(node => node.id === selectedId) ?? null;
  const root = rootNodes[0] ?? null;
  const layout = useMemo(() => root ? buildLayout(nodes, root) : null, [nodes, root]);
  const byId = useMemo(() => new Map(layout?.positioned.map(item => [item.node.id, item]) ?? []), [layout]);
  const maxDepth = layout?.positioned.length ? Math.max(...layout.positioned.map(item => item.depth)) : 0;

  useEffect(() => {
    if (!nodes.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !nodes.some(node => node.id === selectedId)) setSelectedId(rootNodes[0]?.id ?? nodes[0].id);
  }, [nodes, rootNodes, selectedId]);

  useEffect(() => {
    setEditText(selected?.text ?? '');
  }, [selectedId, selected?.text]);

  const ensureRoot = () => {
    if (rootNodes.length > 0) return rootNodes[0];
    const madeRoot: MindNode = { id: crypto.randomUUID(), parentId: null, text: supportName, createdAt: new Date().toISOString() };
    onChange([madeRoot, ...nodes]);
    setSelectedId(madeRoot.id);
    return madeRoot;
  };

  const renameSelected = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const clean = editText.trim();
    if (!clean || clean === selected.text) return;
    onChange(nodes.map(node => node.id === selected.id ? { ...node, text: clean } : node));
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
    if (!selected || selected.id === root?.id) return;
    const removedIds = new Set([selected.id, ...descendants(nodes, selected.id)]);
    const visualParent = layout?.effectiveParent.get(selected.id) ?? selected.parentId ?? root?.id ?? null;
    onChange(nodes.filter(node => !removedIds.has(node.id)));
    setSelectedId(visualParent);
  };

  const recenter = (behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    viewport.scrollTo({
      left: Math.max(0, layout.centerX * zoom - viewport.clientWidth / 2),
      top: Math.max(0, layout.rootY * zoom - viewport.clientHeight / 2),
      behavior,
    });
  };

  const showOverview = (behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    const horizontalFit = (viewport.clientWidth - 18) / layout.width;
    const verticalFit = (viewport.clientHeight - 18) / layout.height;
    const next = clampZoom(Math.min(horizontalFit, verticalFit, 0.9));
    setZoom(next);
    window.setTimeout(() => recenter(behavior), 30);
  };

  const showComfortableView = (behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    const preferred = viewport.clientWidth <= 430 ? 0.58 : viewport.clientWidth <= 820 ? 0.72 : 0.9;
    setZoom(clampZoom(preferred));
    window.setTimeout(() => recenter(behavior), 30);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => showComfortableView('auto'), 90);
    return () => window.clearTimeout(timer);
  }, [layout?.width, layout?.height]);

  useEffect(() => {
    const timer = window.setTimeout(() => recenter('auto'), 40);
    return () => window.clearTimeout(timer);
  }, [zoom]);

  return <main className="shell mind-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="mind-header"><p className="eyebrow">CARTE MENTALE</p><h1>{supportName}</h1><p>Le sujet reste au centre. Les idées principales se déploient autour de lui, puis leurs sous-idées prolongent chaque branche.</p></header>
    <div className="mind-layout">
      <section className="mind-canvas" aria-label="Carte mentale">
        <div className="mind-canvas-title">
          <div><p className="eyebrow">CARTE MENTALE</p><strong>{nodes.length || 1} nœud{(nodes.length || 1) > 1 ? 's' : ''}</strong></div>
          <div className="mind-actions">
            <small>{maxDepth + 1} niveau{maxDepth > 0 ? 'x' : ''} · {layout?.positioned.length ?? 1}/{nodes.length || 1} affichés</small>
            <div className="mind-zoom" aria-label="Zoom de la carte mentale">
              <button type="button" onClick={() => setZoom(clampZoom(zoom - ZOOM_STEP))} aria-label="Dézoomer">−</button>
              <output>{Math.round(zoom * 100)}%</output>
              <button type="button" onClick={() => setZoom(clampZoom(zoom + ZOOM_STEP))} aria-label="Zoomer">+</button>
            </div>
            <button type="button" onClick={() => showOverview()}>Vue entière</button>
            <button type="button" onClick={() => recenter()}>Recentrer</button>
          </div>
        </div>
        {!root ? <div className="mind-empty"><button className="mind-root-preview" type="button" onClick={() => { const made = ensureRoot(); setSelectedId(made.id); }}>{supportName}</button><p>Touche le sujet pour commencer la carte.</p></div> : <div className="mind-viewport" ref={viewportRef}>
          <div className="mind-scaled-stage" style={{ width: (layout?.width ?? 720) * zoom, height: (layout?.height ?? 320) * zoom }}>
            <div className="mind-map-stage" style={{ width: layout?.width, height: layout?.height, transform: `scale(${zoom})` }}>
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
          </div>
        </div>}
      </section>
      <aside className="mind-editor">
        <p className="eyebrow">NŒUD SÉLECTIONNÉ</p>
        <h2>{selected?.text ?? supportName}</h2>
        {selected && <form onSubmit={renameSelected}><label>Nom du nœud<input value={editText} onChange={event => setEditText(event.target.value)} placeholder="Nom du nœud" /></label><button className="primary" type="submit" disabled={!editText.trim() || editText.trim() === selected.text}>Enregistrer le nom</button></form>}
        <form onSubmit={addNode}><label>Ajouter une idée reliée<input value={text} onChange={event => setText(event.target.value)} placeholder="Nouvelle notion…" /></label><button className="primary" type="submit" disabled={!text.trim()}>Ajouter</button></form>
        <button className="mind-delete" type="button" disabled={!selected || selected.id === root?.id} onClick={removeSelected}>Supprimer cette branche</button>
        <small>{selected?.id === root?.id ? 'Le sujet central peut être renommé. Il reste le point d’ancrage de la carte.' : 'Sélectionne un nœud pour le renommer ou lui ajouter une idée.'}</small>
      </aside>
    </div>
  </main>;
}
