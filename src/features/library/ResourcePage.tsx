import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { StatusPill } from '../../components/StatusPill';
import { db } from '../../data/db';
import { retrySyncForResource } from '../../data/repository';
import { useDexieQuery } from '../../data/useDexieQuery';
import { apiJson } from '../../lib/api';
import { requestSync } from '../../lib/sync';
import type { ExtractedPage, ResourceDetailPayload } from '../../shared/contracts';

export function ResourcePage() {
  const { resourceId = '' } = useParams();
  const localResource = useDexieQuery(() => db.resources.get(resourceId), [resourceId], undefined);
  const localVersion = useDexieQuery(
    () => localResource ? db.resourceVersions.get(localResource.currentVersionId) : Promise.resolve(undefined),
    [localResource?.currentVersionId],
    undefined,
  );
  const localExtraction = useDexieQuery(
    () => localResource ? db.extractions.get(localResource.currentVersionId) : Promise.resolve(undefined),
    [localResource?.currentVersionId],
    undefined,
  );
  const subject = useDexieQuery(
    () => localResource ? db.subjects.get(localResource.subjectId) : Promise.resolve(undefined),
    [localResource?.subjectId],
    undefined,
  );

  const remote = useQuery({
    queryKey: ['resource', resourceId],
    queryFn: () => apiJson<ResourceDetailPayload>(`/api/resources/${encodeURIComponent(resourceId)}`),
    enabled: Boolean(resourceId && !localResource),
    retry: 1,
  });

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!localVersion?.bytes) {
      setBlobUrl(null);
      return;
    }
    const blob = new Blob([localVersion.bytes], { type: localVersion.mimeType });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [localVersion?.bytes, localVersion?.mimeType]);

  const title = localResource?.title ?? remote.data?.resource.title;
  const kind = localResource?.kind ?? remote.data?.resource.kind;
  const versionId = localResource?.currentVersionId ?? remote.data?.version.id;
  const pages: ExtractedPage[] = useMemo(
    () => localExtraction?.pages ?? remote.data?.extraction?.pages ?? [],
    [localExtraction?.pages, remote.data?.extraction?.pages],
  );
  const extractionFailed = localExtraction?.status === 'failed' || remote.data?.version.extractionStatus === 'failed';
  const extractionError = localExtraction?.errorMessage ?? remote.data?.version.extractionError;
  const pdfUrl = blobUrl ?? (versionId ? `/api/resource-versions/${encodeURIComponent(versionId)}/blob` : null);

  async function retrySync() {
    if (!localResource) return;
    await retrySyncForResource(localResource.id);
    await requestSync();
  }

  if (!localResource && remote.isPending) {
    return <div className="page"><div className="loading-card">Ouverture du support…</div></div>;
  }

  if (!title || (!localResource && remote.isError)) {
    return (
      <div className="page">
        <Link className="back-link" to="/bibliotheque">← Bibliothèque</Link>
        <div className="error-page">
          <h1>Support introuvable</h1>
          <p>Ce support n’est disponible ni dans le stockage local ni sur le serveur.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page resource-page">
      <Link className="back-link" to="/bibliotheque">← Bibliothèque</Link>
      <header className="resource-header">
        <div>
          <p className="eyebrow">{subject?.name ?? 'Support'}</p>
          <h1>{title}</h1>
          <p className="resource-meta">
            {kind === 'pdf' ? 'Document PDF' : 'Texte'}
            {localVersion ? ` · ${formatBytes(localVersion.size)}` : remote.data ? ` · ${formatBytes(remote.data.version.size)}` : ''}
          </p>
        </div>
        {localResource && <StatusPill status={localResource.status} syncState={localResource.syncState} />}
      </header>

      {localResource?.syncState === 'error' && (
        <div className="error-box error-box--wide" role="alert">
          <div>
            <strong>Le support est enregistré localement, mais la synchronisation a échoué.</strong>
            <span>{localResource.syncError}</span>
          </div>
          <button className="button button--secondary" onClick={retrySync}>Retenter la synchronisation</button>
        </div>
      )}

      {extractionFailed && (
        <div className="extraction-warning" role="alert">
          <div className="extraction-warning__icon" aria-hidden="true">!</div>
          <div>
            <strong>Contenu non exploitable automatiquement</strong>
            <p>{extractionError || 'Le texte n’a pas pu être extrait.'}</p>
            <small>Le fichier reste conservé et consultable. Sirāfiq ne prétendra pas créer des activités à partir de ce contenu.</small>
          </div>
        </div>
      )}

      <div className={`viewer-layout${kind === 'pdf' ? ' viewer-layout--pdf' : ''}`}>
        {kind === 'pdf' ? (
          pdfUrl ? (
            <section className="document-viewer">
              <iframe src={pdfUrl} title={`PDF — ${title}`} />
            </section>
          ) : <div className="loading-card">Le fichier PDF n’est pas disponible.</div>
        ) : (
          <section className="text-viewer">
            {pages.length ? pages.map((page) => (
              <article key={page.pageNumber}>
                {pages.length > 1 && <span className="page-number">Page {page.pageNumber}</span>}
                <p>{page.text}</p>
              </article>
            )) : <p className="muted">Aucun texte extrait n’est disponible.</p>}
          </section>
        )}

        <aside className="source-panel">
          <p className="eyebrow">État réel</p>
          <h2>Extraction</h2>
          {pages.length ? (
            <>
              <strong className="large-stat">{pages.reduce((sum, page) => sum + page.text.length, 0).toLocaleString('fr-FR')}</strong>
              <span>caractères extraits</span>
              <div className="source-rule" />
              <p>{pages.length} page{pages.length > 1 ? 's' : ''} de texte disponible{pages.length > 1 ? 's' : ''} pour les prochaines activités.</p>
            </>
          ) : (
            <p>Aucune donnée textuelle n’est déclarée utilisable.</p>
          )}
          <div className="source-note">Les activités pédagogiques ne sont pas encore activées dans cette version.</div>
        </aside>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
