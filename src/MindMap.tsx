import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';

export type MindNode = {
  id: string;
  parentId: string | null;
  text: string;
  createdAt: string;
  offsetX?: number;
  offsetY?: number;
};

export type MindMapView = {
  zoom: number;
  panX: number;
  panY: number;
};

type Props = {
  supportName: string;
  nodes: MindNode[];
  initialView?: MindMapView;
  onChange: (nodes: MindNode[]) => void;
  onViewChange?: (view: MindMapView) => void;
  onBack: () => void;
};

type PositionedNode = { node: MindNode; x: number; y: number; side: -1 | 0 | 1; depth: number };
type Edge = { from: string; to: string; side: -1 | 1 };
type Pan = { x: number; y: number };
type PanDrag = { pointerId: number; startX: number; startY: number; originX: number; originY: number };
type NodeDrag = {
  pointerId: number;
  nodeId: string;
  startX: number;
  startY: number;
  originOffsetX: number;
  originOffsetY: number;
  dx: number;
  dy: number;
};

type NodePreview = { nodeId: string; dx: number; dy: number };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.25;
const ZOOM_STEP = 0.1;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function isValidView(view?: MindMapView): view is MindMapView {
  return Boolean(view && Number.isFinite(view.zoom) && Number.isFinite(view.panX) && Number.isFinite(view.panY));
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
    positioned.push({ node, x: side * horizontalStep * depth + (node.offsetX ?? 0), y: y + (node.offsetY ?? 0), side, depth });
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
  positioned.push({
    node: root,
    x: root.offsetX ?? 0,
    y: rawRootY + (root.offsetY ?? 0),
    side: 0,
    depth: 0,
  });

  const horizontalPadding = 70;
  const verticalPadding = 64;
  const minX = Math.min(...positioned.map(item => item.x - (item.depth === 0 ? 108 : 92))) - horizontalPadding;
  const maxX = Math.max(...positioned.map(item => item.x + (item.depth === 0 ? 108 : 92))) + horizontalPadding;
  const minY = Math.min(...positioned.map(item => item.y - (item.depth === 0 ? 50 : 40))) - verticalPadding;
  const maxY = Math.max(...positioned.map(item => item.y + (item.depth === 0 ? 50 : 40))) + verticalPadding;
  const shiftX = -minX;
  const shiftY = -minY;
  const compactPositioned = positioned.map(item => ({ ...item, x: item.x + shiftX, y: item.y + shiftY }));
  const compactRoot = compactPositioned.find(item => item.node.id === root.id);

  return {
    positioned: compactPositioned,
    edges,
    width: Math.max(360, maxX - minX),
    height: Math.max(260, maxY - minY),
    centerX: compactRoot?.x ?? shiftX,
    rootY: compactRoot?.y ?? rawRootY + shiftY,
    effectiveParent,
  };
}

export function MindMap({ supportName, nodes, initialView, onChange, onViewChange, onBack }: Props) {
  const rootNodes = useMemo(() => nodes.filter(node => node.parentId === null), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(rootNodes[0]?.id ?? null);
  const [text, setText] = useState('');
  const [editText, setEditText] = useState(rootNodes[0]?.text ?? supportName);
  const [zoom, setZoom] = useState(() => isValidView(initialView) ? clampZoom(initialView.zoom) : 1);
  const [pan, setPan] = useState<Pan>(() => isValidView(initialView) ? { x: initialView.panX, y: initialView.panY } : { x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [nodePreview, setNodePreview] = useState<NodePreview | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  const nodeDragRef = useRef<NodeDrag | null>(null);
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

  useEffect(() => {
    if (!isValidView(initialView) || isPanning || nodeDragRef.current) return;
    setZoom(clampZoom(initialView.zoom));
    setPan({ x: initialView.panX, y: initialView.panY });
  }, [initialView?.zoom, initialView?.panX, initialView?.panY, isPanning]);

  const persistView = (nextZoom: number, nextPan: Pan) => {
    onViewChange?.({ zoom: clampZoom(nextZoom), panX: nextPan.x, panY: nextPan.y });
  };

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
    const descendantsToRemove = descendants(nodes, selected.id);
    const removedIds = new Set([selected.id, ...descendantsToRemove]);
    const branchDetail = descendantsToRemove.length
      ? ` Cette action supprimera aussi ${descendantsToRemove.length} sous-nœud${descendantsToRemove.length > 1 ? 's' : ''}.`
      : '';
    if (!window.confirm(`Supprimer définitivement la branche « ${selected.text} » ?${branchDetail}`)) return;
    const visualParent = layout?.effectiveParent.get(selected.id) ?? selected.parentId ?? root?.id ?? null;
    onChange(nodes.filter(node => !removedIds.has(node.id)));
    setSelectedId(visualParent);
  };

  const resetSelectedPosition = () => {
    if (!selected) return;
    onChange(nodes.map(node => node.id === selected.id ? { ...node, offsetX: 0, offsetY: 0 } : node));
  };

  const centeredPan = (targetZoom: number): Pan | null => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return null;
    return {
      x: viewport.clientWidth / 2 - layout.centerX * targetZoom,
      y: viewport.clientHeight / 2 - layout.rootY * targetZoom,
    };
  };

  const recenter = (targetZoom = zoom, save = true) => {
    const nextPan = centeredPan(targetZoom);
    if (!nextPan) return;
    setPan(nextPan);
    if (save) persistView(targetZoom, nextPan);
  };

  const showOverview = () => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    const horizontalFit = (viewport.clientWidth - 30) / layout.width;
    const verticalFit = (viewport.clientHeight - 30) / layout.height;
    const nextZoom = clampZoom(Math.min(horizontalFit, verticalFit, 0.9));
    const nextPan = centeredPan(nextZoom);
    if (!nextPan) return;
    setZoom(nextZoom);
    setPan(nextPan);
    persistView(nextZoom, nextPan);
  };

  const showComfortableView = () => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    const preferred = viewport.clientWidth <= 430 ? 0.58 : viewport.clientWidth <= 820 ? 0.72 : 0.9;
    const nextZoom = clampZoom(preferred);
    setZoom(nextZoom);
    recenter(nextZoom, false);
  };

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextPan = {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    };
    panDragRef.current = null;
    setPan(nextPan);
    setIsPanning(false);
    persistView(zoom, nextPan);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: MindNode) => {
    event.stopPropagation();
    setSelectedId(node.id);
    nodeDragRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: node.offsetX ?? 0,
      originOffsetY: node.offsetY ?? 0,
      dx: 0,
      dy: 0,
    };
    setNodePreview({ nodeId: node.id, dx: 0, dy: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveNodeDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    drag.dx = dx;
    drag.dy = dy;
    setNodePreview({ nodeId: drag.nodeId, dx, dy });
  };

  const stopNodeDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    nodeDragRef.current = null;
    setNodePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.hypot(drag.dx, drag.dy) < 3) return;
    onChange(nodes.map(node => node.id === drag.nodeId ? {
      ...node,
      offsetX: drag.originOffsetX + drag.dx,
      offsetY: drag.originOffsetY + drag.dy,
    } : node));
  };

  const visualPosition = (item: PositionedNode) => {
    if (nodePreview?.nodeId !== item.node.id) return { x: item.x, y: item.y };
    return { x: item.x + nodePreview.dx, y: item.y + nodePreview.dy };
  };

  const positionById = (id: string) => {
    const item = byId.get(id);
    return item ? { ...item, ...visualPosition(item) } : null;
  };

  useEffect(() => {
    if (isValidView(initialView)) return;
    const timer = window.setTimeout(showComfortableView, 90);
    return () => window.clearTimeout(timer);
  }, [root?.id, initialView?.zoom, initialView?.panX, initialView?.panY]);

  const changeZoom = (nextZoom: number) => {
    const next = clampZoom(nextZoom);
    const nextPan = centeredPan(next);
    setZoom(next);
    if (!nextPan) return;
    setPan(nextPan);
    persistView(next, nextPan);
  };

  const selectedHasManualPosition = Boolean(selected && ((selected.offsetX ?? 0) !== 0 || (selected.offsetY ?? 0) !== 0));

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
              <button type="button" onClick={() => changeZoom(zoom - ZOOM_STEP)} aria-label="Dézoomer">−</button>
              <output>{Math.round(zoom * 100)}%</output>
              <button type="button" onClick={() => changeZoom(zoom + ZOOM_STEP)} aria-label="Zoomer">+</button>
            </div>
            <button type="button" onClick={showOverview}>Vue entière</button>
            <button type="button" onClick={() => recenter()}>Recentrer</button>
          </div>
        </div>
        {!root ? <div className="mind-empty"><button className="mind-root-preview" type="button" onClick={() => { const made = ensureRoot(); setSelectedId(made.id); }}>{supportName}</button><p>Touche le sujet pour commencer la carte.</p></div> : <>
          <p className="mind-pan-hint">Glisse le fond pour déplacer la carte. Glisse directement un nœud pour le repositionner.</p>
          <div
            className={`mind-viewport${isPanning ? ' panning' : ''}`}
            ref={viewportRef}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
          >
            <div
              className="mind-scaled-stage"
              style={{
                width: (layout?.width ?? 720) * zoom,
                height: (layout?.height ?? 320) * zoom,
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
              }}
            >
              <div className="mind-map-stage" style={{ width: layout?.width, height: layout?.height, transform: `scale(${zoom})` }}>
                <svg className="mind-links" width={layout?.width} height={layout?.height} aria-hidden="true">
                  {layout?.edges.map(edge => {
                    const from = positionById(edge.from);
                    const to = positionById(edge.to);
                    if (!from || !to) return null;
                    const startX = from.x + edge.side * (from.depth === 0 ? 108 : 92);
                    const endX = to.x - edge.side * 92;
                    const control = (startX + endX) / 2;
                    return <path key={`${edge.from}-${edge.to}`} d={`M ${startX} ${from.y} C ${control} ${from.y}, ${control} ${to.y}, ${endX} ${to.y}`} />;
                  })}
                </svg>
                {layout?.positioned.map(item => {
                  const position = visualPosition(item);
                  const dragging = nodePreview?.nodeId === item.node.id;
                  return <button
                    key={item.node.id}
                    type="button"
                    className={`mind-map-node depth-${Math.min(item.depth, 4)}${item.node.id === selectedId ? ' selected' : ''}${item.depth === 0 ? ' root' : ''}${dragging ? ' dragging' : ''}`}
                    style={{ left: position.x, top: position.y }}
                    onPointerDown={event => startNodeDrag(event, item.node)}
                    onPointerMove={moveNodeDrag}
                    onPointerUp={stopNodeDrag}
                    onPointerCancel={stopNodeDrag}
                    onClick={() => setSelectedId(item.node.id)}
                    aria-pressed={item.node.id === selectedId}
                  >
                    {item.depth === 0 ? <span>Sujet</span> : <span>Niveau {item.depth}</span>}
                    <strong>{item.node.text}</strong>
                  </button>;
                })}
              </div>
            </div>
          </div>
        </>}
      </section>
      <aside className="mind-editor">
        <p className="eyebrow">NŒUD SÉLECTIONNÉ</p>
        <h2>{selected?.text ?? supportName}</h2>
        {selected && <form onSubmit={renameSelected}><label>Nom du nœud<input value={editText} onChange={event => setEditText(event.target.value)} placeholder="Nom du nœud" /></label><button className="primary" type="submit" disabled={!editText.trim() || editText.trim() === selected.text}>Enregistrer le nom</button></form>}
        <form onSubmit={addNode}><label>Ajouter une idée reliée<input value={text} onChange={event => setText(event.target.value)} placeholder="Nouvelle notion…" /></label><button className="primary" type="submit" disabled={!text.trim()}>Ajouter</button></form>
        {selectedHasManualPosition && <button className="mind-reset-position" type="button" onClick={resetSelectedPosition}>Réinitialiser la position</button>}
        <button className="mind-delete" type="button" disabled={!selected || selected.id === root?.id} onClick={removeSelected}>Supprimer cette branche</button>
        <small>{selected?.id === root?.id ? 'Le sujet central peut être renommé et déplacé. Il reste le point d’ancrage de la carte.' : 'Sélectionne ou fais glisser un nœud pour l’organiser, le renommer ou lui ajouter une idée.'}</small>
      </aside>
    </div>
  </main>;
}
