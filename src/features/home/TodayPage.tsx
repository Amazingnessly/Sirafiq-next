import { Link } from 'react-router-dom';
import { db } from '../../data/db';
import { useDexieQuery } from '../../data/useDexieQuery';

export function TodayPage() {
  const subjects = useDexieQuery(() => db.subjects.count(), [], 0);
  const resources = useDexieQuery(() => db.resources.count(), [], 0);
  const ready = useDexieQuery(() => db.resources.where('status').equals('ready').count(), [], 0);
  const failed = useDexieQuery(() => db.resources.where('status').equals('failed').count(), [], 0);

  return (
    <div className="page page--home">
      <header className="page-header home-header">
        <div>
          <p className="eyebrow">Sirāfiq Next</p>
          <h1>Que faut-il travailler aujourd’hui&nbsp;?</h1>
          <p className="lede">
            La boussole pédagogique sera activée quand les premières activités réelles existeront. Pour l’instant,
            Sirāfiq vous conduit uniquement vers les supports effectivement importés.
          </p>
        </div>
      </header>

      <section className="foundation-card">
        <div className="foundation-card__glow" aria-hidden="true" />
        <div className="foundation-card__content">
          <p className="eyebrow">Fondation V0.1</p>
          <h2>Construire une bibliothèque fiable</h2>
          <p>
            Créez une matière, importez un PDF ou un texte, vérifiez l’extraction, fermez l’application puis revenez :
            le support reste enregistré localement et se synchronise avec D1/R2 dès que le réseau est disponible.
          </p>
          <Link className="button button--primary" to="/bibliotheque">Ouvrir la bibliothèque</Link>
        </div>
        <div className="metrics" aria-label="État de la bibliothèque">
          <Metric value={subjects} label="matières" />
          <Metric value={resources} label="supports" />
          <Metric value={ready} label="extraits" />
          <Metric value={failed} label="à revoir" />
        </div>
      </section>

      <section className="principles-grid">
        <article className="principle-card">
          <span className="principle-number">01</span>
          <h3>Local d’abord</h3>
          <p>Le travail est enregistré sur l’iPad avant la synchronisation réseau.</p>
        </article>
        <article className="principle-card">
          <span className="principle-number">02</span>
          <h3>Pas de faux contenu</h3>
          <p>Si un PDF ne livre pas de texte exploitable, Sirāfiq le signale clairement.</p>
        </article>
        <article className="principle-card">
          <span className="principle-number">03</span>
          <h3>Pas de bouton mort</h3>
          <p>Les prochains modules n’apparaîtront qu’au moment où leur parcours sera fonctionnel.</p>
        </article>
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
