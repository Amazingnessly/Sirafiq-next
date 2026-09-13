import React from 'react';

type Props = {
  children: React.ReactNode;
  area: string;
};

type State = { failed: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`Erreur React dans ${this.props.area}`, error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return <section role="alert" style={{ margin: '20px', padding: '20px', border: '1px solid currentColor', borderRadius: '14px', background: 'Canvas', color: 'CanvasText' }}>
      <strong>Sirāfiq n’a pas pu afficher {this.props.area}.</strong>
      <p>Les données locales n’ont pas été supprimées. Recharge la page pour reprendre.</p>
      <button type="button" onClick={() => window.location.reload()}>Recharger Sirāfiq</button>
    </section>;
  }
}
