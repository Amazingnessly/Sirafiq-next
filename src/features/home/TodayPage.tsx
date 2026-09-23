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

  const resources = localResources.length + remoteOnlyResources.length;
  const ready = localResources.filter((resource) => resource.status === 'ready').length
    + remoteOnlyResources.filter((resource) => resource.status === 'ready').length;
  const failed = localResources.filter((resource) => resource.status === 'failed').length
    + remoteOnlyResources.filter((resource) => resource.status === 'failed').length;
  const noLocalLibrary = localSubjects.length === 0 && localResources.length === 0;
  const checkingRemoteLibrary = noLocalLibrary && remoteBootstrap.isPending;
  const remoteLibraryUnavailable = noLocalLibrary && remoteBootstrap.isError;
  const hasRemoteOnlyResources = remoteOnlyResources.length > 0;

  const nextAction = failed > 0
    ? { label: `Revoir ${failed} support${failed > 1 ? 's' : ''}`, to: '/bibliotheque?status=failed' }
    : syncErrors > 0
      ? { label: `Corriger ${syncErrors} erreur${syncErrors > 1 ? 's' : ''} de synchronisation`, to: '/bibliotheque?status=sync-error' }
      : resources > 0
        ? { label: 'Reprendre mes supports', to: '/bibliotheque' }
        : checkingRemoteLibrary || remoteLibraryUnavailable
          ? { label: 'Vérifier ma bibliothèque', to: '/bibliotheque' }
          : subjects > 0
            ? { label: 'Importer un support', to: '/bibliotheque' }
            : { label: 'Créer ma première matière', to: '/bibliotheque' };

  const cardTitle = resources > 0
    ? hasRemoteOnlyResources && localResources.length === 0
      ? 'Retrouver mes supports synchronisés'
      : 'Continuer à partir de mes supports'
    : checkingRemoteLibrary
      ? 'Vérification de ma bibliothèque'
      : remoteLibraryUnavailable
        ? 'Retrouver ma bibliothèque'
        : 'Préparer mon espace d’apprentissage';

  const cardDescription = resources > 0
    ? hasRemoteOnlyResources && localResources.length === 0
      ? 'Sirāfiq a retrouvé vos supports synchronisés. Ouvrez la bibliothèque pour les consulter ; leur disponibilité hors ligne dépend d’une copie locale sur cet appareil.'
      : 'Vos supports locaux restent disponibles sur cet appareil et se synchronisent lorsque le réseau est disponible.'
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
        <article className="principle-card"><span className="principle-number">01</span><h3>Disponible hors ligne</h3><p>Vos supports importés sur cet appareil sont enregistrés localement avant la synchronisation réseau.</p></article>
        <article className="principle-card"><span className="principle-number">02</span><h3>Contenu vérifiable</h3><p>Si un PDF ne livre pas de texte exploitable, Sirāfiq vous le signale clairement.</p></article>
        <article className="principle-card"><span className="principle-number">03</span><h3>Parcours fonctionnels</h3><p>Une fonction apparaît seulement lorsque son parcours est prêt à être utilisé.</p></article>
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}
