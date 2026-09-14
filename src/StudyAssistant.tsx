import { FormEvent, useEffect, useState } from 'react';
import { loadAiContext, type AiContext } from './aiContext';
import './study-assistant.css';

const TOKEN_STORAGE_KEY = 'sirafiq-ai-access-session-v1';

const suggestions = [
  'Quels sont les points essentiels à retenir de ce support ?',
  'Fais-moi 5 questions de rappel actif à partir de ce support.',
  'Explique les notions les plus difficiles avec des mots simples, sans ajouter d’informations absentes du support.',
];

type Props = {
  supportId: string;
  supportName: string;
  onBack: () => void;
};

function initialAccessToken() {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function StudyAssistant({ supportId, supportName, onBack }: Props) {
  const [context, setContext] = useState<AiContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [accessToken, setAccessToken] = useState(initialAccessToken);

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setContextError('');
    void loadAiContext(supportId, supportName).then(next => {
      if (!cancelled) setContext(next);
    }).catch(reason => {
      if (!cancelled) setContextError(reason instanceof Error ? reason.message : 'Impossible de préparer ce support pour l’assistant IA.');
    });
    return () => { cancelled = true; };
  }, [supportId, supportName]);

  const saveAccessToken = (value: string) => {
    setAccessToken(value);
    try {
      if (value) sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
      else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Le code reste utilisable pour la session React même si sessionStorage est indisponible.
    }
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!context || !cleanQuestion || asking) return;
    if (!accessToken.trim()) {
      setError('Saisis d’abord le code d’accès IA configuré pour ce déploiement Sirāfiq.');
      return;
    }

    setAsking(true);
    setError('');
    setAnswer('');
    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sirafiq-ai-token': accessToken.trim(),
        },
        body: JSON.stringify({ supportName, context: context.text, question: cleanQuestion }),
      });
      const data = await response.json().catch(() => null) as { answer?: string; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'L’assistant IA n’a pas pu répondre.');
      if (!data?.answer) throw new Error('Réponse IA vide.');
      setAnswer(data.answer);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de contacter l’assistant IA.');
    } finally {
      setAsking(false);
    }
  };

  return <main className="shell ai-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="ai-header">
      <p className="eyebrow">ASSISTANT D’ÉTUDE · IA</p>
      <h1>{supportName}</h1>
      <p>L’assistant répond à partir du contenu extrait de ce support. Le document reste local tant que tu ne poses pas de question ; lors d’une question, le contexte préparé et ta question sont envoyés au service IA.</p>
    </header>

    {!context && !contextError && <section className="ai-panel ai-loading" role="status"><strong>Préparation locale du support…</strong><p>Sirāfiq extrait le texte utile avant tout envoi.</p></section>}
    {contextError && <section className="ai-panel ai-error" role="alert"><strong>Assistant indisponible pour ce support</strong><p>{contextError}</p></section>}

    {context && <div className="ai-layout">
      <section className="ai-panel ai-ask-panel">
        <div className="ai-context-status">
          <strong>Contexte prêt</strong>
          <span>{Math.round(context.text.length / 1000)} k caractères{context.pagesRead ? ` · ${context.pagesRead} page${context.pagesRead > 1 ? 's' : ''} parcourue${context.pagesRead > 1 ? 's' : ''}` : ''}</span>
        </div>
        {context.truncated && <p className="ai-warning">Le support est volumineux : cette première version envoie une portion limitée du texte. Une question portant sur une partie non incluse peut donc manquer de contexte.</p>}

        <label className="ai-token">Code d’accès IA
          <input type="password" autoComplete="off" value={accessToken} onChange={event => saveAccessToken(event.target.value)} placeholder="Code configuré côté Cloudflare" />
          <small>Ce code n’est pas la clé OpenAI. Il reste uniquement dans cet onglet de navigation.</small>
        </label>

        <div className="ai-suggestions" aria-label="Questions suggérées">
          {suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}
        </div>

        <form onSubmit={ask}>
          <label>Ta question<textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={3000} placeholder="Interroge le support, demande une explication, des questions de rappel actif…" /></label>
          <button className="primary" type="submit" disabled={!question.trim() || asking}>{asking ? 'Analyse du support…' : 'Interroger le support'}</button>
        </form>
        {error && <p className="ai-error-message" role="alert">{error}</p>}
      </section>

      <section className="ai-panel ai-answer-panel" aria-live="polite">
        <p className="eyebrow">RÉPONSE</p>
        {asking ? <p>Réflexion en cours…</p> : answer ? <div className="ai-answer">{answer}</div> : <div className="ai-empty-answer"><strong>Aucune question envoyée</strong><p>Choisis une suggestion ou écris une question précise sur le support.</p></div>}
      </section>
    </div>}
  </main>;
}
