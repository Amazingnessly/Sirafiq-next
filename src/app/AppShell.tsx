import { NavLink, Outlet } from 'react-router-dom';
import { buildIdentity } from '../buildIdentity';
import { SyncIndicator } from '../components/SyncIndicator';

export function AppShell() {
  return (
    <div className="app-shell" data-build-sha={buildIdentity.sha}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">س</div>
          <div>
            <strong>Sirāfiq</strong>
            <span>Next · fondation</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Navigation principale">
          <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}>
            <span aria-hidden="true">◌</span>
            Aujourd’hui
          </NavLink>
          <NavLink to="/bibliotheque" className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}>
            <span aria-hidden="true">▤</span>
            Bibliothèque
          </NavLink>
        </nav>

        <div className="sidebar-spacer" />
        <SyncIndicator />
        <p className="sidebar-note">Seules les fonctions réellement actives sont affichées.</p>
        <div
          className="build-identity"
          aria-label={`Version ${buildIdentity.version}, build ${buildIdentity.shortSha}`}
          title={`${buildIdentity.branch} · ${buildIdentity.sha}`}
        >
          <span>V{buildIdentity.version}</span>
          <strong>Build {buildIdentity.shortSha}</strong>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
