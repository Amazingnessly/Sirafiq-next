import { Component, type ErrorInfo, type ReactNode } from 'react';
import { LocalDataReadError } from '../data/useDexieQuery';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sirāfiq render failed', error, info);
  }

  private reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    const localDataFailure = this.state.error instanceof LocalDataReadError;

    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error__card">
          <p className="eyebrow">Sirāfiq</p>
          <h1>{localDataFailure ? 'Impossible d’afficher vos données.' : 'Impossible d’afficher cette vue.'}</h1>
          <p>
            {localDataFailure
              ? 'Une lecture locale a échoué. Sirāfiq ne présentera pas une bibliothèque vide à la place de vos données.'
              : 'Une erreur inattendue a interrompu l’affichage. Vos données locales ne sont pas supprimées.'}
          </p>
          <button className="button button--primary" type="button" onClick={this.reload}>Réessayer</button>
        </div>
      </main>
    );
  }
}
