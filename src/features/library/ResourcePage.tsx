import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { StatusPill } from '../../components/StatusPill';
import { db } from '../../data/db';
import { retrySyncForResource } from '../../data/repository';
import { useDexieQuery } from '../../data/useDexieQuery';
import { apiJson } from '../../lib/api';
import { sha256Hex } from '../../lib/hash';
import {
  requestSync,
  retryServerExtractionForResource,
  uploadMultipartResource,
  type TransferProgress,
} from '../../lib/sync';
import { shouldTryServerPdfExtraction } from '../../shared/importPolicy';
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
  const multipartSession = useDexieQuery(
    () => localResource ? db.multipartUploads.get(localResource.currentVersionId) : Promise.resolve(undefined),
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
  const [extracting, setExtracting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resuming, setResuming] = useState(false);
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);

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
  const remoteBlobAvailable = !localResource || localResource.syncState === 'synced';
  const pdfUrl = blobUrl ?? (versionId && remoteBlobAvailable ? `/api/resource-versions/${encodeURIComponent(versionId)}/blob` : null);
  const canRetryServerExtraction = Boolean(
    localResource
    && localVersion
    && localExtraction
    && localResource.syncState === 'synced'
    && shouldTryServerPdfExtraction(localResource.kind, localVersion.size, localExtraction.status),
  );

  async function retrySync() {
    if (!localResource) return;
    setRetryError(null);
    try {
      await retrySyncForResource(localResource.id);
      await requestSync();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'La synchronisation a échoué.');
    }
  }

  async function resumeMultipart() {
    if (!localResource || !localVersion || !multipartSession || !resumeFile || resuming) return;
    setResuming(true);
    setRetryError(null);
    setTransferProgress(null);
    try {
      if (resumeFile.size !== multipartSession.size) throw new Error('Ce n’est pas le même fichier : la taille ne correspond pas.');
      const sha256 = await sha256Hex(resumeFile, (processedBytes, totalBytes) => {
        setTransferProgress({ phase: 'hashing', processedBytes, totalBytes });
      });
      if (sha256 !== multipartSession.sha256) throw new Error('Ce n’est pas le même fichier : son empreinte SHA-256 ne correspond pas.');
      await requestSync();
      await uploadMultipartResource(localResource.id, resumeFile, setTransferProgress);
      setResumeFile(null);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'La reprise de l’envoi a échoué.');
    } finally {
      setResuming(false);
    }
  }

  async function retryExtraction() {
    if (!localResource || extracting) return;
    setExtracting(true);
    setRetryError(null);
    try {
      await retryServerExtractionForResource(localResource.id);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'L’extraction serveur a échoué.');
    } finally {
      setExtracting(false);
    }
  }

  if (!localResource && remote.isPending) return <div className="page"><div className="loading-card">Ouverture du support…</div></div>;

  if (!title || (!localResource && remote.isError)) {
    return (
      <div className="page">
        <Link className="back-link" to="/bibliotheque">← Bibliothèque</Link>
        <div className="error-page"><h1>Support introuvable</h1><p>Ce support n’est disponible ni dans le stockage local ni sur le serveur.</p></div>
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
            <strong>{multipartSession ? 'L’envoi du gros fichier est interrompu.' : 'Le support est enregistré localement, mais la synchronisation a échoué.'}</strong>
            <span>{localResource.syncError}</span>
            {multipartSession && <small>Les morceaux déjà confirmés sont conservés. Resélectionnez le même fichier pour reprendre sans repartir de zéro.</small>}
          </div>
          {multipartSession ? (
            <div className="multipart-resume">
              <input
                aria-label="Fichier à reprendre"
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                disabled={resuming}
                onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)}
              />
              {transferProgress && <span>{progressLabel(transferProgress)}</span>}
              <button className="button button--secondary" type="button" disabled={!resumeFile || resuming} onClick={resumeMultipart}>
                {resuming ? 'Reprise en cours…' : 'Reprendre l’envoi'}
              </button>
            </div>
          ) : (
            <button className="button button--secondary" type="button" onClick={retrySync}>Retenter la synchronisation</button>
          )}
          {retryError && <span className="field-error">{retryError}</span>}
        </div>
      )}

      {extractionFailed && (
        <div className="extraction-warning" role="alert">
          <div className="extraction-warning__icon" aria-hidden="true">!</div>
          <div>
            <strong>Contenu non exploitable automatiquement</strong>
            <p>{extractionError || 'Le texte n’a pas pu être extrait.'}</p>
            <small>
              {multipartSession
                ? 'Le fichier n’est pas encore déclaré entièrement stocké. Sirāfiq n’utilisera pas ce contenu pour des activités.'
                : 'Le fichier reste conservé et consultable. Sirāfiq ne prétendra pas créer des activités à partir de ce contenu.'}
            </small>
            {canRetryServerExtraction && (
              <button className="button button--secondary" type="button" onClick={retryExtraction} disabled={extracting}>
                {extracting ? 'Extraction en cours…' : 'Retenter l’extraction avec le serveur'}
              </button>
            )}
            {!multipartSession && retryError && <span className="field-error">{retryError}</span>}
          </div>
        </div>
      )}

      <div className={`viewer-layout${kind === 'pdf' ? ' viewer-layout--pdf' : ''}`}>
        {kind === 'pdf' ? (
          pdfUrl ? <section className="document-viewer"><iframe src={pdfUrl} title={`PDF — ${title}`} /></section>
            : <div className="loading-card">{multipartSession ? 'Le PDF sera consultable après la finalisation de l’envoi.' : 'Le fichier PDF n’est pas disponible.'}</div>
        ) : (
          <section className="text-viewer">
            {pages.length ? pages.map((page) => (
              <article key={page.pageNumber}>
                {pages.length > 1 && <span className="page-number">Bloc {page.pageNumber}</span>}
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
              <p>{pages.length} bloc{pages.length > 1 ? 's' : ''} de texte disponible{pages.length > 1 ? 's' : ''} pour les prochaines activités.</p>
            </>
          ) : <p>Aucune donnée textuelle n’est déclarée utilisable.</p>}
          <div className="source-note">Les activités pédagogiques ne sont pas encore activées dans cette version.</div>
        </aside>
      </div>
    </div>
  );
}

function progressLabel(progress: TransferProgress): string {
  const percent = progress.totalBytes ? Math.round((progress.processedBytes / progress.totalBytes) * 100) : 0;
  if (progress.phase === 'hashing') return `Vérification · ${percent} %`;
  if (progress.phase === 'finalizing') return 'Assemblage final…';
  return `Morceau ${progress.partNumber ?? 0}/${progress.partCount ?? 0} · ${percent} %`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
