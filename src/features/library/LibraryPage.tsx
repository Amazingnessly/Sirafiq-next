import { Link, useSearchParams } from 'react-router-dom';
import { StatusPill } from '../../components/StatusPill';
import { SubjectSyncFailurePanel } from '../../components/SubjectSyncFailurePanel';
import { db } from '../../data/db';
import { useDexieQuery } from '../../data/useDexieQuery';
import { isTerminalOutboxAttempt } from '../../lib/retryableSync';
import { ImportPanel } from '../import/ImportPanel';
import { SubjectForm } from '../import/SubjectForm';

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\p{M}\u0640]/gu, '').toLocaleLowerCase('fr').trim();
}

type StatusFilter = 'all' | 'ready' | 'failed' | 'sync-error';

export function LibraryPage() {
  const subjects = useDexieQuery(() => db.subjects.orderBy('name').toArray(), [], []);
  const resources = useDexieQuery(() => db.resources.orderBy('updatedAt').reverse().toArray(), [], []);
  const resourceOutbox = useDexieQuery(() => db.outbox.where('type').equals('resource.sync').toArray(), [], []);
  const terminalResourceIds = new Set(resourceOutbox.filter((item) => isTerminalOutboxAttempt(item.nextAttemptAt)).map((item) => item.entityId));
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSubjectId = searchParams.get('subject');
  const searchQuery = searchParams.get('q') ?? '';
  const requestedStatus = searchParams.get('status');
  const statusFilter: StatusFilter = requestedStatus === 'ready' || requestedStatus === 'failed' || requestedStatus === 'sync-error' ? requestedStatus : 'all';
  const subjectNames = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const resourceCountsBySubject = new Map<string, number>();
  for (const resource of resources) {
    resourceCountsBySubject.set(resource.subjectId, (resourceCountsBySubject.get(resource.subjectId) ?? 0) + 1);
  }
  const activeSubjectId = requestedSubjectId && subjects.some((subject) => subject.id === requestedSubjectId) ? requestedSubjectId : null;
  const activeSubject = activeSubjectId ? subjects.find((subject) => subject.id === activeSubjectId) ?? null : null;
  const activeSubjectName = activeSubject?.name ?? null;
  const importSubjects = activeSubjectId
    ? [...subjects.filter((subject) => subject.id === activeSubjectId), ...subjects.filter((subject) => subject.id !== activeSubjectId)]
    : subjects;
  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  const subjectResources = activeSubjectId ? resources.filter((resource) => resource.subjectId === activeSubjectId) : resources;
  const statusResources = statusFilter === 'all'
    ? subjectResources
    : statusFilter === 'sync-error'
      ? subjectResources.filter((resource) => resource.syncState === 'error')
      : subjectResources.filter((resource) => resource.status === statusFilter);
  const visibleResources = normalizedSearchQuery
    ? statusResources.filter((resource) => {
        const subjectName = subjectNames.get(resource.subjectId) ?? '';
        return normalizeSearchText(`${resource.title} ${subjectName}`).includes(normalizedSearchQuery);
      })
    : statusResources;
  const isFiltered = Boolean(activeSubjectId || normalizedSearchQuery || statusFilter !== 'all');
  const libraryContext = searchParams.toString();
  const updateFilter = (key: 'status' | 'subject' | 'q', value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const setStatusFilter = (status: StatusFilter) => updateFilter('status', status === 'all' ? null : status);
  const resourceHref = (resourceId: string) => libraryContext
    ? `/bibliotheque/${resourceId}?library=${encodeURIComponent(libraryContext)}`
    : `/bibliotheque/${resourceId}`;
  const resetFilters = () => setSearchParams({}, { replace: true });

  return (
    <div className="page">
      <header className="page-header library-header">
        <div>
          <p className="eyebrow">Bibliothèque de travail</p>
          <h1>Vos supports, sans ambiguïté.</h1>
          <p className="lede">Chaque support possède un fichier réel, une empreinte anti-doublon et un état d’extraction vérifiable.</p>
        </div>
        <div className="header-count"><strong>{resources.length}</strong><span>support{resources.length > 1 ? 's' : ''}</span></div>
      </header>

      <div className="library-layout">
        <aside className="library-sidebar">
          <section className="panel">
            <SubjectForm />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Matières</h2>
              <span>{subjects.length}</span>
            </div>
            {subjects.length ? (
              <ul className="subject-list">
                <li><button type="button" className={!activeSubjectId ? 'subject-filter is-active' : 'subject-filter'} aria-pressed={!activeSubjectId} onClick={() => updateFilter('subject', null)}><span className="subject-dot" aria-hidden="true" /><span>Toutes</span><small>{resources.length}</small></button></li>
                {subjects.map((subject) => (
                  <li key={subject.id}><button type="button" className={activeSubjectId === subject.id ? 'subject-filter is-active' : 'subject-filter'} aria-pressed={activeSubjectId === subject.id} onClick={() => updateFilter('subject', subject.id)} title={subject.syncState === 'error' ? subject.syncError ?? 'Synchronisation de la matière à vérifier.' : undefined}><span className="subject-dot" aria-hidden="true" /><span>{subject.name}{subject.syncState === 'error' ? ' · à vérifier' : ''}</span><small>{resourceCountsBySubject.get(subject.id) ?? 0}</small></button></li>
                ))}
              </ul>
            ) : <p className="muted">Aucune matière pour l’instant.</p>}
          </section>
        </aside>

        <div className="library-main">
          {activeSubject?.syncState === 'error' ? <SubjectSyncFailurePanel subject={activeSubject} /> : null}

          <section className="panel panel--import">
            <div className="panel-heading panel-heading--stack"><div><p className="eyebrow">Ajouter</p><h2>Importer un support</h2></div><span className="tiny-badge">PDF · TXT · MD</span></div>
            <ImportPanel key={activeSubjectId ?? 'all'} subjects={importSubjects} returnQuery={libraryContext} />
          </section>

          <section className="resources-section">
            <div className="section-title">
              <div><p className="eyebrow">Enregistrés</p><h2>{activeSubjectName ? `Supports · ${activeSubjectName}` : 'Supports'}</h2></div>
              {resources.length ? <label className="library-search"><span className="sr-only">Rechercher un support</span><input type="search" value={searchQuery} onChange={(event) => updateFilter('q', event.target.value || null)} placeholder="Rechercher un support…" autoComplete="off" maxLength={240} /></label> : null}
            </div>
            {resources.length ? (
              <div className="library-status-filters" aria-label="Filtrer les supports par état">
                <button type="button" className={statusFilter === 'all' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>Tous</button>
                <button type="button" className={statusFilter === 'ready' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'ready'} onClick={() => setStatusFilter('ready')}>Extraits</button>
                <button type="button" className={statusFilter === 'failed' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')}>À revoir</button>
                <button type="button" className={statusFilter === 'sync-error' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'sync-error'} onClick={() => setStatusFilter('sync-error')}>Sync en erreur</button>
              </div>
            ) : null}

            {visibleResources.length ? (
              <div className="resource-grid">
                {visibleResources.map((resource) => (
                  <Link to={resourceHref(resource.id)} className="resource-card" key={resource.id}>
                    <div className={`resource-icon resource-icon--${resource.kind}`} aria-hidden="true">{resource.kind === 'pdf' ? 'PDF' : 'TXT'}</div>
                    <div className="resource-card__body"><span className="resource-subject">{subjectNames.get(resource.subjectId) ?? 'Matière'}</span><h3>{resource.title}</h3><p>{resource.syncState === 'error' ? (terminalResourceIds.has(resource.id) ? `Synchronisation bloquée · ${resource.syncError ?? 'Erreur de synchronisation.'} Ouvrez le support pour vérifier son état local.` : `Synchronisation à reprendre · ${resource.syncError ?? 'Erreur de synchronisation.'} Ouvrez le support pour réessayer.`) : resource.status === 'ready' ? 'Contenu extrait et disponible.' : resource.extractionError ?? 'Extraction impossible.'}</p></div>
                    <div className="resource-card__footer"><StatusPill status={resource.status} syncState={resource.syncState} /><span aria-hidden="true">→</span></div>
                  </Link>
                ))}
              </div>
            ) : isFiltered ? (
              <div className="empty-library"><div className="empty-library__symbol" aria-hidden="true">◇</div><h3>Aucun support correspondant</h3><p>Modifiez vos filtres ou affichez à nouveau toute la bibliothèque.</p><button type="button" className="button button--secondary" onClick={resetFilters}>Afficher tous les supports</button></div>
            ) : (
              <div className="empty-library"><div className="empty-library__symbol" aria-hidden="true">◇</div><h3>La bibliothèque est vide</h3><p>Le premier support importé apparaîtra ici une fois réellement conservé dans IndexedDB.</p></div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
