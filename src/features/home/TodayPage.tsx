import { Link } from 'react-router-dom';
import { db } from '../../data/db';
import { useDexieQuery } from '../../data/useDexieQuery';

export function TodayPage() {
  const subjects = useDexieQuery(() => db.subjects.count(), [], 0);
  const resources = useDexieQuery(() => db.resources.count(), [], 0);
  const ready = useDexieQuery(() => db.resources.where('status').equals('ready').count(), [], 0);
  const failed = useDexieQuery(() => db.resources.where('status').equals('failed').count(), [], 0);
  const syncErrors = useDexieQuery(async () => {
    const [resourceErrors, subjectErrors] = await Promise.all([
      db.resources.where('syncState').equals('error').count(),
      db.subjects.where('syncState').equals('error').count(),
    ]);
    return resourceErrors + subjectErrors;
  }, [], 0);
  const nextAction = failed > 0
    ? { label: `Revoir ${failed} support${failed > 1 ? 's' : ''}`, to: '/bibliotheque?status=failed' }
    : syncErrors > 0
      ? { label: `Corriger ${syncErrors} erreur${syncErrors > 1 ? 's' : ''} de synchronisation`, to: '/bibliotheque?status=sync-error' }
      : resources > 0
        ? { label: 'Reprendre mes supports', to: '/bibliotheque' }
        : subjects > 0
          ? { label: 'Importer un support', to: '/bibliotheque' }
          : { label: 'Créer ma première matière', to: '/bibliotheque' };

  return (
    <div className="page page--home">
      <header className="page-header home-header"><div><p className="eyebrow">Sirāfiq</p><h1>Que faut-il travailler aujourd’hui&nbsp;?</h1><p className="lede">Retrouvez vos supports et reprenez là où vous vous êtes arrêté. Les activités guidées apparaîtront ici lorsqu’elles seront réellement disponibles.</p></div></header>
      <section className="foundation-card">
        <div className="foundation-card__glow" aria-hidden="true" />
        <div className="foundation-card__content"><p className="eyebrow">Ma bibliothèque</p><h2>{resources > 0 ? 'Continuer à partir de mes supports' : 'Préparer mon espace d’apprentissage'}</h2><p>{resources > 0 ? 'Vos supports restent disponibles sur cet appareil et se synchronisent lorsque le réseau est disponible.' : 'Créez une matière puis ajoutez un PDF ou un texte pour commencer à construire votre espace de travail.'}</p><Link className="button button--primary" to={nextAction.to}>{nextAction.label}</Link></div>
        <div className="metrics" aria-label="État de la bibliothèque">
          <Metric value={subjects} label="matières" />
          <Metric value={resources} label="supports" />
          <Metric value={ready} label="extraits" />
          <Link className="metric metric--link" to="/bibliotheque?status=failed" aria-label={`${failed} support${failed > 1 ? 's' : ''} à revoir — afficher`}><strong>{failed}</strong><span>à revoir</span></Link>
          <Link className="metric metric--link" to="/bibliotheque?status=sync-error" aria-label={`${syncErrors} élément${syncErrors > 1 ? 's' : ''} avec une erreur de synchronisation — afficher`}><strong>{syncErrors}</strong><span>sync en erreur</span></Link>
        </div>
      </section>
      <section className="principles-grid">
        <article className="principle-card"><span className="principle-number">01</span><h3>Disponible hors ligne</h3><p>Vos supports sont enregistrés sur l’iPad avant la synchronisation réseau.</p></article>
        <article className="principle-card"><span className="principle-number">02</span><h3>Contenu vérifiable</h3><p>Si un PDF ne livre pas de texte exploitable, Sirāfiq vous le signale clairement.</p></article>
        <article className="principle-card"><span className="principle-number">03</span><h3>Parcours fonctionnels</h3><p>Une fonction apparaît seulement lorsque son parcours est prêt à être utilisé.</p></article>
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}
