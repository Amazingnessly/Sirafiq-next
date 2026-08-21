import { Link } from 'react-router-dom';
import { StatusPill } from '../../components/StatusPill';
import { db } from '../../data/db';
import { useDexieQuery } from '../../data/useDexieQuery';
import { ImportPanel } from '../import/ImportPanel';
import { SubjectForm } from '../import/SubjectForm';

export function LibraryPage() {
  const subjects = useDexieQuery(() => db.subjects.orderBy('name').toArray(), [], []);
  const resources = useDexieQuery(() => db.resources.orderBy('updatedAt').reverse().toArray(), [], []);
  const subjectNames = new Map(subjects.map((subject) => [subject.id, subject.name]));

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
                {subjects.map((subject) => (
                  <li key={subject.id}>
                    <span className="subject-dot" aria-hidden="true" />
                    <span>{subject.name}</span>
                    <small>{resources.filter((resource) => resource.subjectId === subject.id).length}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Aucune matière pour l’instant.</p>}
          </section>
        </aside>

        <div className="library-main">
          <section className="panel panel--import">
            <div className="panel-heading panel-heading--stack">
              <div>
                <p className="eyebrow">Ajouter</p>
                <h2>Importer un support</h2>
              </div>
              <span className="tiny-badge">PDF · TXT · MD</span>
            </div>
            <ImportPanel subjects={subjects} />
          </section>

          <section className="resources-section">
            <div className="section-title">
              <div>
                <p className="eyebrow">Enregistrés</p>
                <h2>Supports</h2>
              </div>
            </div>

            {resources.length ? (
              <div className="resource-grid">
                {resources.map((resource) => (
                  <Link to={`/bibliotheque/${resource.id}`} className="resource-card" key={resource.id}>
                    <div className={`resource-icon resource-icon--${resource.kind}`} aria-hidden="true">
                      {resource.kind === 'pdf' ? 'PDF' : 'TXT'}
                    </div>
                    <div className="resource-card__body">
                      <span className="resource-subject">{subjectNames.get(resource.subjectId) ?? 'Matière'}</span>
                      <h3>{resource.title}</h3>
                      <p>{resource.status === 'ready' ? 'Contenu extrait et disponible.' : resource.extractionError ?? 'Extraction impossible.'}</p>
                    </div>
                    <div className="resource-card__footer">
                      <StatusPill status={resource.status} syncState={resource.syncState} />
                      <span aria-hidden="true">→</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-library">
                <div className="empty-library__symbol" aria-hidden="true">◇</div>
                <h3>La bibliothèque est vide</h3>
                <p>Le premier support importé apparaîtra ici une fois réellement conservé dans IndexedDB.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
