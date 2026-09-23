import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { db } from '../../data/db';
import { useDexieQuery } from '../../data/useDexieQuery';
import { apiJson } from '../../lib/api';
import type { BootstrapPayload } from '../../shared/contracts';

export function TodayPage() {
  const localSubjects = useDexieQuery(() => db.subjects.toArray(), [], []);
  const localResources = useDexieQuery(() => db.resources.toArray(), [], []);
  const syncErrors = useDexieQuery(async () => {
    const [resourceErrors, subjectErrors] = await Promise.all([
      db.resources.where('syncState').equals('error').count(),
      db.subjects.where('syncState').equals('error').count(),
    ]);
    return resourceErrors + subjectErrors;
  }, [], 0);
  const remoteBootstrap = useQuery({
    queryKey: ['library-bootstrap'],
    queryFn: () => apiJson<BootstrapPayload>('/api/bootstrap'),
    retry: 1,
  });

  const localSubjectIds = new Set(localSubjects.map((subject) => subject.id));
  const subjects = localSubjects.length + (remoteBootstrap.data?.subjects ?? []).filter((subject) => !localSubjectIds.has(subject.id)).length;

  const localResourceIds = new Set(localResources.map((resource) => resource.id));
  const reconciledRemoteResourceIds = new Set(
    localResources.flatMap((resource) => resource.remoteResourceId ? [resource.remoteResourceId] : []),
  );
  const remoteOnlyResources = (remoteBootstrap.data?.resources ?? []).filter(
    (resource) => !localResourceIds.has(resource.id) && !reconciledRemoteResourceIds.has(resource.id),
  );

  const remoteUploadingResources = remoteOnlyResources.filter((resource) => resource.status === 'uploading');
  const remoteFinalizedResources = remoteOnlyResources.filter((resource) => resource.status !== 'uploading');
  const remoteTextsNeedingExtraction = remoteFinalizedResources.filter(
    (resource) => resource.kind === 'text' && resource.status !== 'ready',
  );
  const remoteReadableResources = remoteFinalizedResources.filter(
    (resource) => resource.kind === 'pdf' || resource.status === 'ready',
  );
  const resources = localResources.length + remoteOnlyResources.length;
  const ready = localResources.filter((resource) => resource.status === 'ready').length
    + remoteOnlyResources.filter((resource) => resource.status === 'ready').length;
  const failed = localResources.filter((resource) => resource.status === 'failed').length
    + remoteOnlyResources.filter((resource) => resource.status === 'failed').length;
  const noLocalLibrary = localSubjects.length === 0 && localResources.length === 0;
  const checkingRemoteLibrary = noLocalLibrary && remoteBootstrap.isPending;
  const remoteLibraryUnavailable = noLocalLibrary && remoteBootstrap.isError;
  const hasOnlyRemoteUploading = localResources.length === 0
    && remoteFinalizedResources.length === 0
    && remoteUploadingResources.length > 0;
  const hasOnlyRemoteTextsNeedingExtraction = localResources.length === 0
    && remoteUploadingResources.length === 0
    && remoteReadableResources.length === 0
    && remoteTextsNeedingExtraction.length > 0;
  const hasRemoteFinalizedResources = remoteFinalizedResources.length > 0;

  const nextAction = failed > 0
    ? { label: `Revoir ${failed} support${failed > 1 ? 's' : ''}`, to: '/bibliotheque?status=failed' }
    : syncErrors > 0
      ? { label: `Corriger ${syncErrors} erreur${syncErrors > 1 ? 's' : ''} de synchronisation`, to: '/bibliotheque?status=sync-error' }
      : hasOnlyRemoteUploading
        ? { label: remoteUploadingResources.length > 1 ? 'Vérifier mes envois' : 'Vérifier mon envoi', to: '/bibliotheque' }
        : hasOnlyRemoteTextsNeedingExtraction
          ? { label: remoteTextsNeedingExtraction.length > 1 ? 'Vérifier mes textes' : 'Vérifier mon texte', to: '/bibliotheque' }
          : resources > 0
          ? { label: 'Reprendre mes supports', to: '/bibliotheque' }
          : checkingRemoteLibrary || remoteLibraryUnavailable
          ? { label: 'Vérifier ma bibliothèque', to: '/bibliotheque' }
          : subjects > 0
            ? { label: 'Importer un support', to: '/bibliotheque' }
            : { label: 'Créer ma première matière', to: '/bibliotheque' };

  const cardTitle = hasOnlyRemoteUploading
    ? 'Retrouver mes envois incomplets'
    : hasOnlyRemoteTextsNeedingExtraction
      ? 'Retrouver mes textes à récupérer'
      : resources > 0
      ? hasRemoteFinalizedResources && localResources.length === 0
        ? 'Retrouver mes supports synchronisés'
        : 'Continuer à partir de mes supports'
      : checkingRemoteLibrary
      ? 'Vérification de ma bibliothèque'
      : remoteLibraryUnavailable
        ? 'Retrouver ma bibliothèque'
        : 'Préparer mon espace d’apprentissage';

  const incompleteUploadNotice = remoteUploadingResources.length > 0
    ? ` ${remoteUploadingResources.length} envoi${remoteUploadingResources.length > 1 ? 's restent incomplets et ne sont' : ' reste incomplet et n’est'} pas encore consultable${remoteUploadingResources.length > 1 ? 's' : ''}.`
    : '';
  const textRecoveryNotice = remoteTextsNeedingExtraction.length > 0
    ? ` ${remoteTextsNeedingExtraction.length} texte${remoteTextsNeedingExtraction.length > 1 ? 's synchronisés doivent' : ' synchronisé doit'} encore récupérer ${remoteTextsNeedingExtraction.length > 1 ? 'leur' : 'son'} extraction avant d’être déclaré${remoteTextsNeedingExtraction.length > 1 ? 's' : ''} lisible${remoteTextsNeedingExtraction.length > 1 ? 's' : ''}.`
    : '';

  const cardDescription = hasOnlyRemoteUploading
    ? `Sirāfiq a retrouvé ${remoteUploadingResources.length > 1 ? 'des envois serveur incomplets' : 'un envoi serveur incomplet'}. ${remoteUploadingResources.length > 1 ? 'Ils ne sont' : 'Il n’est'} pas encore déclaré${remoteUploadingResources.length > 1 ? 's' : ''} consultable${remoteUploadingResources.length > 1 ? 's' : ''} ; ouvrez la bibliothèque pour vérifier ${remoteUploadingResources.length > 1 ? 'leur' : 'son'} état.`
    : hasOnlyRemoteTextsNeedingExtraction
      ? `Sirāfiq a retrouvé ${remoteTextsNeedingExtraction.length > 1 ? 'des fichiers texte synchronisés' : 'un fichier texte synchronisé'}, mais ${remoteTextsNeedingExtraction.length > 1 ? 'leurs contenus ne sont' : 'son contenu n’est'} pas encore déclaré${remoteTextsNeedingExtraction.length > 1 ? 's' : ''} lisible${remoteTextsNeedingExtraction.length > 1 ? 's' : ''}. Ouvrez la bibliothèque pour reprendre l’extraction.`
      : resources > 0
        ? hasRemoteFinalizedResources && localResources.length === 0
          ? `Sirāfiq a retrouvé vos supports synchronisés. Ouvrez la bibliothèque pour voir leur état et consulter ceux dont le contenu est disponible ; leur disponibilité hors ligne dépend d’une copie locale sur cet appareil.${textRecoveryNotice}${incompleteUploadNotice}`
          : `Sirāfiq conserve l’état local de vos supports sur cet appareil et synchronise le reste lorsque le réseau est disponible. La lecture hors ligne dépend des données effectivement conservées en local.${textRecoveryNotice}${incompleteUploadNotice}`
      : checkingRemoteLibrary
      ? 'Sirāfiq vérifie les données synchronisées avant de conclure que cet appareil ne contient encore aucun support.'
      : remoteLibraryUnavailable
        ? 'Le serveur n’a pas pu être vérifié. Sirāfiq ne considère pas cette erreur réseau comme une bibliothèque vide.'
        : 'Créez une matière puis ajoutez un PDF ou un texte pour commencer à construire votre espace de travail.';

  return (
    <div className="page page--home">
      <header className="page-header home-header"><div><p className="eyebrow">Sirāfiq</p><h1>Que faut-il travailler aujourd’hui&nbsp;?</h1><p className="lede">Retrouvez vos supports et reprenez là où vous vous êtes arrêté. Les activités guidées apparaîtront ici lorsqu’elles seront réellement disponibles.</p></div></header>
      <section className="foundation-card">
        <div className="foundation-card__glow" aria-hidden="true" />
        <div className="foundation-card__content"><p className="eyebrow">Ma bibliothèque</p><h2>{cardTitle}</h2><p>{cardDescription}</p><Link className="button button--primary" to={nextAction.to}>{nextAction.label}</Link></div>
        <div className="metrics" aria-label="État de la bibliothèque">
          <Metric value={subjects} label="matières" />
          <Metric value={resources} label="supports" />
          <Metric value={ready} label="extraits" />
          <Link className="metric metric--link" to="/bibliotheque?status=failed" aria-label={`${failed} support${failed > 1 ? 's' : ''} à revoir — afficher`}><strong>{failed}</strong><span>à revoir</span></Link>
          <Link className="metric metric--link" to="/bibliotheque?status=sync-error" aria-label={`${syncErrors} élément${syncErrors > 1 ? 's' : ''} avec une erreur de synchronisation — afficher`}><strong>{syncErrors}</strong><span>sync en erreur</span></Link>
        </div>
      </section>
      <section className="principles-grid">
        <article className="principle-card"><span className="principle-number">01</span><h3>Local d’abord</h3><p>Les contenus conservés localement restent utilisables hors ligne. Pour protéger la mémoire des anciens iPad, les gros PDF envoyés par morceaux ne sont pas recopiés intégralement sur l’appareil.</p></article>
        <article className="principle-card"><span className="principle-number">02</span><h3>Contenu vérifiable</h3><p>Si un PDF ne livre pas de texte exploitable, Sirāfiq vous le signale clairement.</p></article>
        <article className="principle-card"><span className="principle-number">03</span><h3>Parcours fonctionnels</h3><p>Une fonction apparaît seulement lorsque son parcours est prêt à être utilisé.</p></article>
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}
