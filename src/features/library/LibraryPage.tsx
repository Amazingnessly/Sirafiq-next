import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { StatusPill } from '../../components/StatusPill';
import { SubjectSyncFailurePanel } from '../../components/SubjectSyncFailurePanel';
import { db } from '../../data/db';
import { useDexieQuery } from '../../data/useDexieQuery';
import { apiJson } from '../../lib/api';
import { isTerminalOutboxAttempt } from '../../lib/retryableSync';
import type { BootstrapPayload } from '../../shared/contracts';
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
  const remoteBootstrap = useQuery({
    queryKey: ['library-bootstrap'],
    queryFn: () => apiJson<BootstrapPayload>('/api/bootstrap'),
    retry: 1,
  });

  useEffect(() => {
    if (!remoteBootstrap.data?.subjects.length) return;
    void db.transaction('rw', db.subjects, async () => {
      for (const remoteSubject of remoteBootstrap.data?.subjects ?? []) {
        const local = await db.subjects.get(remoteSubject.id);
        if (local) continue;
        await db.subjects.add({
          ...remoteSubject,
          syncState: 'synced',
          syncError: null,
        });
      }
    }).catch((error) => {
      console.error('Remote subject bootstrap failed', error);
    });
  }, [remoteBootstrap.data]);
  const terminalResourceIds = new Set(resourceOutbox.filter((item) => item.lastError !== null && isTerminalOutboxAttempt(item.nextAttemptAt)).map((item) => item.entityId));
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSubjectId = searchParams.get('subject');
  const searchQuery = searchParams.get('q') ?? '';
  const requestedStatus = searchParams.get('status');
  const statusFilter: StatusFilter = requestedStatus === 'ready' || requestedStatus === 'failed' || requestedStatus === 'sync-error' ? requestedStatus : 'all';
  const localSubjectIds = new Set(subjects.map((subject) => subject.id));
  const displaySubjects = [
    ...subjects,
    ...(remoteBootstrap.data?.subjects ?? [])
      .filter((subject) => !localSubjectIds.has(subject.id))
      .map((subject) => ({ ...subject, syncState: 'synced' as const, syncError: null })),
  ];
  const localResourceIds = new Set(resources.map((resource) => resource.id));
  const reconciledRemoteResourceIds = new Set(
    resources.flatMap((resource) => resource.remoteResourceId ? [resource.remoteResourceId] : []),
  );
  const remoteOnlyResources = (remoteBootstrap.data?.resources ?? []).filter(
    (resource) => !localResourceIds.has(resource.id) && !reconciledRemoteResourceIds.has(resource.id),
  );
  const totalResourceCount = resources.length + remoteOnlyResources.length;
  const subjectNames = new Map((remoteBootstrap.data?.subjects ?? []).map((subject) => [subject.id, subject.name]));
  for (const subject of subjects) subjectNames.set(subject.id, subject.name);

  const resourceCountsBySubject = new Map<string, number>();
  for (const resource of resources) {
    resourceCountsBySubject.set(resource.subjectId, (resourceCountsBySubject.get(resource.subjectId) ?? 0) + 1);
  }
  for (const resource of remoteOnlyResources) {
    resourceCountsBySubject.set(resource.subjectId, (resourceCountsBySubject.get(resource.subjectId) ?? 0) + 1);
  }

  const activeSubjectId = requestedSubjectId && displaySubjects.some((subject) => subject.id === requestedSubjectId) ? requestedSubjectId : null;
  const activeSubject = activeSubjectId ? displaySubjects.find((subject) => subject.id === activeSubjectId) ?? null : null;
  const localActiveSubject = activeSubjectId ? subjects.find((subject) => subject.id === activeSubjectId) ?? null : null;
  const activeSubjectName = activeSubject?.name ?? null;
  const importSubjects = activeSubjectId && localSubjectIds.has(activeSubjectId)
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

  const subjectRemoteResources = activeSubjectId
    ? remoteOnlyResources.filter((resource) => resource.subjectId === activeSubjectId)
    : remoteOnlyResources;
  const statusRemoteResources = statusFilter === 'all'
    ? subjectRemoteResources
    : statusFilter === 'sync-error'
      ? []
      : subjectRemoteResources.filter((resource) => resource.status === statusFilter);
  const visibleRemoteResources = normalizedSearchQuery
    ? statusRemoteResources.filter((resource) => {
        const subjectName = subjectNames.get(resource.subjectId) ?? '';
        return normalizeSearchText(`${resource.title} ${subjectName}`).includes(normalizedSearchQuery);
      })
    : statusRemoteResources;
  const visibleSubjectErrors = statusFilter === 'sync-error'
    ? subjects.filter((subject) => subject.syncState === 'error' && (!activeSubjectId || subject.id === activeSubjectId) && (!normalizedSearchQuery || normalizeSearchText(subject.name).includes(normalizedSearchQuery)))
    : [];
  const isFiltered = Boolean(activeSubjectId || normalizedSearchQuery || statusFilter !== 'all');
  const hasVisibleResults = visibleResources.length > 0 || visibleRemoteResources.length > 0 || visibleSubjectErrors.length > 0;
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
        <div className="header-count"><strong>{totalResourceCount}</strong><span>support{totalResourceCount > 1 ? 's' : ''}</span></div>
      </header>

      {remoteBootstrap.isError && (resources.length > 0 || subjects.length > 0) ? (
        <div className="error-box error-box--wide" role="status">
          <div><strong>Impossible de vérifier la bibliothèque synchronisée.</strong><span>Les données locales restent disponibles et ne sont pas remplacées par un faux état vide.</span></div>
          <button className="button button--secondary" type="button" onClick={() => void remoteBootstrap.refetch()}>Réessayer</button>
        </div>
      ) : null}

      <div className="library-layout">
        <aside className="library-sidebar">
          <section className="panel">
            <SubjectForm />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Matières</h2>
              <span>{displaySubjects.length}</span>
            </div>
            {displaySubjects.length ? (
              <ul className="subject-list">
                <li><button type="button" className={!activeSubjectId ? 'subject-filter is-active' : 'subject-filter'} aria-pressed={!activeSubjectId} onClick={() => updateFilter('subject', null)}><span className="subject-dot" aria-hidden="true" /><span>Toutes</span><small>{totalResourceCount}</small></button></li>
                {displaySubjects.map((subject) => (
                  <li key={subject.id}><button type="button" className={activeSubjectId === subject.id ? 'subject-filter is-active' : 'subject-filter'} aria-pressed={activeSubjectId === subject.id} onClick={() => updateFilter('subject', subject.id)} title={subject.syncState === 'error' ? subject.syncError ?? 'Synchronisation de la matière à vérifier.' : undefined}><span className="subject-dot" aria-hidden="true" /><span>{subject.name}{subject.syncState === 'error' ? ' · à vérifier' : ''}</span><small>{resourceCountsBySubject.get(subject.id) ?? 0}</small></button></li>
                ))}
              </ul>
            ) : <p className="muted">Aucune matière pour l’instant.</p>}
          </section>
        </aside>

        <div className="library-main">
          {localActiveSubject?.syncState === 'error' ? <SubjectSyncFailurePanel subject={localActiveSubject} /> : null}

          <section className="panel panel--import">
            <div className="panel-heading panel-heading--stack"><div><p className="eyebrow">Ajouter</p><h2>Importer un support</h2></div><span className="tiny-badge">PDF · TXT · MD</span></div>
            <ImportPanel key={activeSubjectId ?? 'all'} subjects={importSubjects} returnQuery={libraryContext} />
          </section>

          <section className="resources-section">
            <div className="section-title">
              <div><p className="eyebrow">Enregistrés</p><h2>{activeSubjectName ? `Supports · ${activeSubjectName}` : 'Supports'}</h2></div>
              {totalResourceCount ? <label className="library-search"><span className="sr-only">Rechercher un support</span><input type="search" value={searchQuery} onChange={(event) => updateFilter('q', event.target.value || null)} placeholder="Rechercher un support…" autoComplete="off" maxLength={240} /></label> : null}
            </div>
            {(totalResourceCount || subjects.some((subject) => subject.syncState === 'error')) ? (
              <div className="library-status-filters" aria-label="Filtrer les supports par état">
                <button type="button" className={statusFilter === 'all' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>Tous</button>
                <button type="button" className={statusFilter === 'ready' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'ready'} onClick={() => setStatusFilter('ready')}>Extraits</button>
                <button type="button" className={statusFilter === 'failed' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')}>À revoir</button>
                <button type="button" className={statusFilter === 'sync-error' ? 'tiny-badge is-active' : 'tiny-badge'} aria-pressed={statusFilter === 'sync-error'} onClick={() => setStatusFilter('sync-error')}>Sync en erreur</button>
              </div>
            ) : null}

            {visibleSubjectErrors.length ? (
              <div className="resource-grid">
                {visibleSubjectErrors.map((subject) => (
                  <button type="button" className="resource-card" key={subject.id} onClick={() => updateFilter('subject', subject.id)}>
                    <div className="resource-icon" aria-hidden="true">MAT</div>
                    <div className="resource-card__body"><span className="resource-subject">Matière</span><h3>{subject.name}</h3><p>{subject.syncError ?? 'Synchronisation de la matière à vérifier.'} Ouvrez la matière pour vérifier ou reprendre la synchronisation.</p></div>
                    <div className="resource-card__footer"><span className="status-pill status-pill--error">À vérifier</span><span aria-hidden="true">→</span></div>
                  </button>
                ))}
              </div>
            ) : null}

            {(visibleResources.length || visibleRemoteResources.length) ? (
              <div className="resource-grid">
                {visibleResources.map((resource) => (
                  <Link to={resourceHref(resource.id)} className="resource-card" key={resource.id}>
                    <div className={`resource-icon resource-icon--${resource.kind}`} aria-hidden="true">{resource.kind === 'pdf' ? 'PDF' : 'TXT'}</div>
                    <div className="resource-card__body"><span className="resource-subject">{subjectNames.get(resource.subjectId) ?? 'Matière'}</span><h3>{resource.title}</h3><p>{resource.syncState === 'error' ? (terminalResourceIds.has(resource.id) ? `Synchronisation bloquée · ${resource.syncError ?? 'Erreur de synchronisation.'} Ouvrez le support pour vérifier son état local.` : `Synchronisation à reprendre · ${resource.syncError ?? 'Erreur de synchronisation.'} Ouvrez le support pour réessayer.`) : resource.status === 'ready' ? 'Contenu extrait et disponible.' : resource.extractionError ?? 'Extraction impossible.'}</p></div>
                    <div className="resource-card__footer"><StatusPill status={resource.status} syncState={resource.syncState} /><span aria-hidden="true">→</span></div>
                  </Link>
                ))}
                {visibleRemoteResources.map((resource) => resource.status === 'uploading' ? (
                  <div className="resource-card" key={resource.id} aria-label={`${resource.title} · envoi serveur incomplet`}>
                    <div className={`resource-icon resource-icon--${resource.kind}`} aria-hidden="true">{resource.kind === 'pdf' ? 'PDF' : 'TXT'}</div>
                    <div className="resource-card__body"><span className="resource-subject">{subjectNames.get(resource.subjectId) ?? 'Matière'}</span><h3>{resource.title}</h3><p>Envoi serveur non finalisé. Ce support n’est pas encore consultable sur cet appareil.</p></div>
                    <div className="resource-card__footer"><span className="status status--warning">Envoi incomplet</span></div>
                  </div>
                ) : (
                  <Link to={resourceHref(resource.id)} className="resource-card" key={resource.id}>
                    <div className={`resource-icon resource-icon--${resource.kind}`} aria-hidden="true">{resource.kind === 'pdf' ? 'PDF' : 'TXT'}</div>
                    <div className="resource-card__body"><span className="resource-subject">{subjectNames.get(resource.subjectId) ?? 'Matière'}</span><h3>{resource.title}</h3><p>{resource.status === 'ready' ? 'Synchronisé sur le serveur et consultable.' : resource.status === 'failed' ? 'Fichier synchronisé · extraction à revoir.' : 'Fichier synchronisé · extraction en attente.'}</p></div>
                    <div className="resource-card__footer"><span className={resource.status === 'failed' ? 'status status--danger' : 'status status--success'}>{resource.status === 'failed' ? 'Extraction à revoir' : 'Synchronisé'}</span><span aria-hidden="true">→</span></div>
                  </Link>
                ))}
              </div>
            ) : !hasVisibleResults && isFiltered ? (
              <div className="empty-library"><div className="empty-library__symbol" aria-hidden="true">◇</div><h3>Aucun élément correspondant</h3><p>Modifiez vos filtres ou affichez à nouveau toute la bibliothèque.</p><button type="button" className="button button--secondary" onClick={resetFilters}>Afficher toute la bibliothèque</button></div>
            ) : !hasVisibleResults && remoteBootstrap.isPending ? (
              <div className="empty-library"><div className="empty-library__symbol" aria-hidden="true">◇</div><h3>Vérification des supports synchronisés…</h3><p>Les données locales sont déjà chargées. Sirāfiq vérifie maintenant D1 avant de déclarer la bibliothèque vide.</p></div>
            ) : !hasVisibleResults && remoteBootstrap.isError ? (
              <div className="empty-library"><div className="empty-library__symbol" aria-hidden="true">!</div><h3>Impossible de vérifier les supports synchronisés</h3><p>Le serveur n’a pas pu être joint. Aucun état vide distant n’est déduit de cette erreur.</p><button type="button" className="button button--secondary" onClick={() => void remoteBootstrap.refetch()}>Réessayer</button></div>
            ) : !hasVisibleResults ? (
              <div className="empty-library"><div className="empty-library__symbol" aria-hidden="true">◇</div><h3>La bibliothèque est vide</h3><p>Aucun support n’est présent localement ni dans la bibliothèque synchronisée.</p></div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
