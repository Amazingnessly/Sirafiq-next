import { FormEvent, useMemo, useState } from 'react';

export type WatchItem = {
  id: string;
  title: string;
  url: string;
  collection: string;
  status: 'À voir' | 'En cours' | 'Terminé';
  priority?: 'Maintenant' | 'Bientôt' | 'Plus tard';
  addedAt: string;
};

type Props = {
  items: WatchItem[];
  onChange: (items: WatchItem[]) => void;
  onClose: () => void;
  storageWarning?: string;
};

const statuses: WatchItem['status'][] = ['À voir', 'En cours', 'Terminé'];
const priorities: NonNullable<WatchItem['priority']>[] = ['Maintenant', 'Bientôt', 'Plus tard'];
const statusRank: Record<WatchItem['status'], number> = { 'En cours': 0, 'À voir': 1, 'Terminé': 2 };
const priorityRank: Record<NonNullable<WatchItem['priority']>, number> = { Maintenant: 0, 'Bientôt': 1, 'Plus tard': 2 };

function priorityOf(item: WatchItem): NonNullable<WatchItem['priority']> {
  return item.priority ?? 'Bientôt';
}

export function WatchLater({ items, onChange, onClose, storageWarning = '' }: Props) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [collection, setCollection] = useState('Général');
  const [priority, setPriority] = useState<NonNullable<WatchItem['priority']>>('Bientôt');
  const [filter, setFilter] = useState<'Tous' | WatchItem['status']>('Tous');
  const [priorityFilter, setPriorityFilter] = useState<'Toutes' | NonNullable<WatchItem['priority']>>('Toutes');
  const [collectionFilter, setCollectionFilter] = useState('Toutes');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fr');
    return [...items]
      .filter(item =>
        (filter === 'Tous' || item.status === filter)
        && (priorityFilter === 'Toutes' || priorityOf(item) === priorityFilter)
        && (collectionFilter === 'Toutes' || item.collection === collectionFilter)
        && (!q || `${item.title} ${item.collection}`.toLocaleLowerCase('fr').includes(q))
      )
      .sort((a, b) => {
        const statusDifference = statusRank[a.status] - statusRank[b.status];
        if (statusDifference) return statusDifference;
        const priorityDifference = priorityRank[priorityOf(a)] - priorityRank[priorityOf(b)];
        if (priorityDifference) return priorityDifference;
        return b.addedAt.localeCompare(a.addedAt);
      });
  }, [items, filter, priorityFilter, collectionFilter, query]);

  const collections = useMemo(() => Array.from(new Set(items.map(item => item.collection).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr')), [items]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanUrl = url.trim();
    const cleanCollection = collection.trim() || 'Général';
    if (!cleanTitle || !cleanUrl) return;
    try {
      const parsed = new URL(cleanUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid');
    } catch {
      setError('Ajoute une adresse web complète commençant par http:// ou https://.');
      return;
    }
    if (items.some(item => item.url === cleanUrl)) {
      setError('Ce lien est déjà enregistré.');
      return;
    }
    onChange([{ id: crypto.randomUUID(), title: cleanTitle, url: cleanUrl, collection: cleanCollection, status: 'À voir', priority, addedAt: new Date().toISOString() }, ...items]);
    setTitle('');
    setUrl('');
    setCollection(cleanCollection);
    setError('');
  };

  const patch = (id: string, next: Partial<WatchItem>) => onChange(items.map(item => item.id === id ? { ...item, ...next } : item));
  const remove = (id: string) => {
    const item = items.find(entry => entry.id === id);
    if (!item || !window.confirm(`Supprimer définitivement « ${item.title} » de la file À voir ?`)) return;
    onChange(items.filter(entry => entry.id !== id));
  };

  return <section className="watch-overlay" role="dialog" aria-modal="true" aria-label="À voir plus tard">
    <div className="watch-shell">
      <header className="watch-header">
        <div><p className="eyebrow">SIRĀFIQ · À VOIR</p><h1>File de visionnage</h1><p>Range les vidéos et playlists que tu veux retrouver, puis fais remonter ce que tu veux réellement regarder ensuite.</p></div>
        <button className="watch-close" type="button" onClick={onClose}>Fermer</button>
      </header>
      {storageWarning && <p className="watch-error" role="alert">{storageWarning}</p>}

      <form className="watch-form" onSubmit={submit}>
        <label>Titre<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Nom de la vidéo ou playlist" /></label>
        <label>Lien<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label>
        <label>Collection<input value={collection} onChange={event => setCollection(event.target.value)} list="watch-collections" placeholder="Cours, conférence…" /><datalist id="watch-collections">{collections.map(item => <option key={item} value={item} />)}</datalist></label>
        <label>Priorité<select value={priority} onChange={event => setPriority(event.target.value as NonNullable<WatchItem['priority']>)}>{priorities.map(item => <option key={item}>{item}</option>)}</select></label>
        <button className="primary" type="submit" disabled={!title.trim() || !url.trim()}>Ajouter</button>
      </form>
      {error && <p className="watch-error" role="alert">{error}</p>}

      <div className="watch-tools">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher…" aria-label="Rechercher dans la file de visionnage" />
        <div className="watch-select-filters">
          <label>Collection<select value={collectionFilter} onChange={event => setCollectionFilter(event.target.value)}><option>Toutes</option>{collections.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Priorité<select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as typeof priorityFilter)}><option>Toutes</option>{priorities.map(item => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="watch-filters">{(['Tous', ...statuses] as const).map(item => <button type="button" key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
      </div>

      {visible.length === 0 ? <div className="watch-empty"><strong>{items.length ? 'Aucun résultat' : 'Rien à regarder plus tard'}</strong><p>{items.length ? 'Change la recherche, la collection, la priorité ou l’état.' : 'Ajoute une vidéo ou une playlist pour construire une file claire.'}</p></div> : <div className="watch-grid">{visible.map(item => <article className="watch-card" key={item.id}>
        <div className="watch-copy"><span>{item.collection} · {priorityOf(item)}</span><h2>{item.title}</h2><small>{item.status === 'En cours' ? 'Reprendre' : item.status} · ajouté le {new Date(item.addedAt).toLocaleDateString('fr-FR')}</small></div>
        <div className="watch-actions">
          <select value={priorityOf(item)} onChange={event => patch(item.id, { priority: event.target.value as NonNullable<WatchItem['priority']> })} aria-label={`Priorité de ${item.title}`}>{priorities.map(itemPriority => <option key={itemPriority}>{itemPriority}</option>)}</select>
          <select value={item.status} onChange={event => patch(item.id, { status: event.target.value as WatchItem['status'] })} aria-label={`État de ${item.title}`}>{statuses.map(status => <option key={status}>{status}</option>)}</select>
          <a href={item.url} target="_blank" rel="noreferrer" onClick={() => item.status === 'À voir' && patch(item.id, { status: 'En cours' })}>{item.status === 'En cours' ? 'Reprendre' : 'Regarder'}</a>
          <button type="button" onClick={() => remove(item.id)}>Supprimer</button>
        </div>
      </article>)}</div>}
    </div>
  </section>;
}
