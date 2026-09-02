import { FormEvent, useMemo, useState } from 'react';

export type WatchItem = {
  id: string;
  title: string;
  url: string;
  collection: string;
  status: 'À voir' | 'En cours' | 'Terminé';
  addedAt: string;
};

type Props = {
  items: WatchItem[];
  onChange: (items: WatchItem[]) => void;
  onClose: () => void;
};

const statuses: WatchItem['status'][] = ['À voir', 'En cours', 'Terminé'];

export function WatchLater({ items, onChange, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [collection, setCollection] = useState('Général');
  const [filter, setFilter] = useState<'Tous' | WatchItem['status']>('Tous');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fr');
    return items.filter(item => (filter === 'Tous' || item.status === filter) && (!q || `${item.title} ${item.collection}`.toLocaleLowerCase('fr').includes(q)));
  }, [items, filter, query]);

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
    onChange([{ id: crypto.randomUUID(), title: cleanTitle, url: cleanUrl, collection: cleanCollection, status: 'À voir', addedAt: new Date().toISOString() }, ...items]);
    setTitle('');
    setUrl('');
    setCollection(cleanCollection);
    setError('');
  };

  const patch = (id: string, next: Partial<WatchItem>) => onChange(items.map(item => item.id === id ? { ...item, ...next } : item));
  const remove = (id: string) => onChange(items.filter(item => item.id !== id));

  return <section className="watch-overlay" role="dialog" aria-modal="true" aria-label="À voir plus tard">
    <div className="watch-shell">
      <header className="watch-header">
        <div><p className="eyebrow">SIRĀFIQ · À VOIR</p><h1>File de visionnage</h1><p>Range les vidéos et playlists que tu veux retrouver sans les laisser se perdre.</p></div>
        <button className="watch-close" type="button" onClick={onClose}>Fermer</button>
      </header>

      <form className="watch-form" onSubmit={submit}>
        <label>Titre<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Nom de la vidéo ou playlist" /></label>
        <label>Lien<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label>
        <label>Collection<input value={collection} onChange={event => setCollection(event.target.value)} list="watch-collections" placeholder="Cours, conférence…" /><datalist id="watch-collections">{collections.map(item => <option key={item} value={item} />)}</datalist></label>
        <button className="primary" type="submit" disabled={!title.trim() || !url.trim()}>Ajouter</button>
      </form>
      {error && <p className="watch-error" role="alert">{error}</p>}

      <div className="watch-tools">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher…" aria-label="Rechercher dans la file de visionnage" />
        <div className="watch-filters">{(['Tous', ...statuses] as const).map(item => <button type="button" key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
      </div>

      {visible.length === 0 ? <div className="watch-empty"><strong>{items.length ? 'Aucun résultat' : 'Rien à regarder plus tard'}</strong><p>{items.length ? 'Change le filtre ou la recherche.' : 'Ajoute une vidéo ou une playlist pour construire une file claire.'}</p></div> : <div className="watch-grid">{visible.map(item => <article className="watch-card" key={item.id}>
        <div className="watch-copy"><span>{item.collection}</span><h2>{item.title}</h2><small>Ajouté le {new Date(item.addedAt).toLocaleDateString('fr-FR')}</small></div>
        <div className="watch-actions">
          <select value={item.status} onChange={event => patch(item.id, { status: event.target.value as WatchItem['status'] })} aria-label={`État de ${item.title}`}>{statuses.map(status => <option key={status}>{status}</option>)}</select>
          <a href={item.url} target="_blank" rel="noreferrer" onClick={() => item.status === 'À voir' && patch(item.id, { status: 'En cours' })}>Regarder</a>
          <button type="button" onClick={() => remove(item.id)}>Supprimer</button>
        </div>
      </article>)}</div>}
    </div>
  </section>;
}
