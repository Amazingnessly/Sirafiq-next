import { FormEvent, useEffect, useState } from 'react';
import type { Flashcard } from './Flashcards';
import { AiMemoryPassageGenerator } from './AiMemoryPassageGenerator';
import { AiMindMapGenerator } from './AiMindMapGenerator';
import { loadAiContext, type AiContext } from './aiContext';
import { getSupportMetadata, patchSupportMetadata } from './storage';
import './study-assistant.css';

const TOKEN_STORAGE_KEY = 'sirafiq-ai-access-session-v1';

const suggestions = [
  'Quels sont les points essentiels à retenir de ce support ?',
  'Explique les notions les plus difficiles avec des mots simples, sans ajouter d’informations absentes du support.',
  'Quels liens logiques faut-il comprendre entre les notions principales de ce support ?',
];

type Props = {
  supportId: string;
  supportName: string;
  onBack: () => void;
};

type GeneratedCard = { front: string; back: string };
type StoredSupport = { id: string; flashcards?: Flashcard[]; [key: string]: unknown };
type ServiceState = 'checking' | 'ready' | 'unconfigured' | 'unavailable';

function initialAccessToken() {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function cardSignature(card: { front: string; back: string }) {
  return `${card.front.trim().toLocaleLowerCase('fr')}\u0000${card.back.trim().toLocaleLowerCase('fr')}`;
}

export function StudyAssistant({ supportId, supportName, onBack }: Props) {
  const [context, setContext] = useState<AiContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [accessToken, setAccessToken] = useState(initialAccessToken);
  const [cardCount, setCardCount] = useState<3 | 5 | 10>(5);
  const [generatingCards, setGeneratingCards] = useState(false);
  const [generatedCards, setGeneratedCards] = useState<GeneratedCard[]>([]);
  const [cardStatus, setCardStatus] = useState('');
  const [savingCards, setSavingCards] = useState(false);
  const [serviceState, setServiceState] = useState<ServiceState>('checking');
  const [serviceModel, setServiceModel] = useState('');

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6_000);
    void fetch('/api/ai/status', { headers: { accept: 'application/json' }, signal: controller.signal }).then(async response => {
      const data = await response.json().catch(() => null) as { configured?: boolean; model?: string; version?: number } | null;
      if (!response.ok || typeof data?.configured !== 'boolean') throw new Error('status unavailable');
      if (cancelled) return;
      setServiceState(data.configured ? 'ready' : 'unconfigured');
      setServiceModel(typeof data.model === 'string' ? data.model : '');
    }).catch(() => {
      if (!cancelled) setServiceState('unavailable');
    }).finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setContextError('');
    setGeneratedCards([]);
    setCardStatus('');
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

  const ensureAccessToken = () => {
    if (accessToken.trim()) return true;
    setError('Saisis d’abord le code d’accès IA configuré pour ce déploiement Sirāfiq.');
    return false;
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!context || !cleanQuestion || asking) return;
    if (!ensureAccessToken()) return;

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

  const generateFlashcards = async () => {
    if (!context || generatingCards) return;
    if (!ensureAccessToken()) return;
    setGeneratingCards(true);
    setGeneratedCards([]);
    setCardStatus('Génération des cartes…');
    setError('');
    try {
      const response = await fetch('/api/ai/flashcards', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sirafiq-ai-token': accessToken.trim(),
        },
        body: JSON.stringify({ supportName, context: context.text, count: cardCount }),
      });
      const data = await response.json().catch(() => null) as { cards?: GeneratedCard[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Impossible de générer les cartes.');
      if (!Array.isArray(data?.cards) || !data.cards.length) throw new Error('Aucune carte exploitable n’a été générée.');
      setGeneratedCards(data.cards);
      setCardStatus(`${data.cards.length} carte${data.cards.length > 1 ? 's' : ''} prête${data.cards.length > 1 ? 's' : ''} à enregistrer.`);
    } catch (reason) {
      setCardStatus('');
      setError(reason instanceof Error ? reason.message : 'Impossible de générer les cartes.');
    } finally {
      setGeneratingCards(false);
    }
  };

  const saveGeneratedCards = async () => {
    if (!generatedCards.length || savingCards) return;
    setSavingCards(true);
    setCardStatus('Enregistrement des cartes…');
    setError('');
    try {
      const support = await getSupportMetadata<StoredSupport>(supportId);
      if (!support) throw new Error('Support local introuvable.');
      const existing = support.flashcards ?? [];
      const signatures = new Set(existing.map(cardSignature));
      const now = new Date().toISOString();
      const additions: Flashcard[] = generatedCards
        .filter(card => {
          const signature = cardSignature(card);
          if (signatures.has(signature)) return false;
          signatures.add(signature);
          return true;
        })
        .map(card => ({
          id: crypto.randomUUID(),
          front: card.front.trim(),
          back: card.back.trim(),
          stage: 0,
          createdAt: now,
        }));

      if (!additions.length) {
        setGeneratedCards([]);
        setCardStatus('Ces cartes existent déjà dans ce support. Aucun doublon n’a été ajouté.');
        return;
      }

      await patchSupportMetadata<StoredSupport>(supportId, { flashcards: [...existing, ...additions] });
      setGeneratedCards([]);
      setCardStatus(`${additions.length} carte${additions.length > 1 ? 's' : ''} ajoutée${additions.length > 1 ? 's' : ''} aux cartes mémoire.`);
    } catch (reason) {
      setCardStatus('');
      setError(reason instanceof Error ? reason.message : 'Impossible d’enregistrer les cartes générées.');
    } finally {
      setSavingCards(false);
    }
  };

  const serviceMessage = serviceState === 'ready'
    ? `Worker IA déployé et secrets serveur détectés${serviceModel ? ` · ${serviceModel}` : ''}.`
    : serviceState === 'unconfigured'
      ? 'Le Worker IA répond, mais la clé OpenAI ou le code d’accès serveur manque encore dans les secrets Cloudflare.'
      : serviceState === 'unavailable'
        ? 'Le diagnostic /api/ai/status ne répond pas encore. Le Worker API n’est peut-être pas encore déployé sur cette adresse.'
        : 'Vérification du Worker IA et des secrets serveur…';

  return <main className="shell ai-shell">
    <button className="back" type="button" onClick={onBack}>← Espace d’étude</button>
    <header className="ai-header">
      <p className="eyebrow">ASSISTANT D’ÉTUDE · IA</p>
      <h1>{supportName}</h1>
      <p>L’assistant travaille à partir du contenu extrait de ce support. Le document reste local tant que tu ne l’interroges pas ou ne demandes pas de génération ; dans ces cas, le contexte préparé est envoyé au service IA.</p>
      <div className={`ai-service-status ${serviceState}`} role="status"><strong>{serviceState === 'ready' ? 'Service IA prêt' : serviceState === 'unconfigured' ? 'Configuration IA incomplète' : serviceState === 'unavailable' ? 'Déploiement IA à vérifier' : 'Vérification IA'}</strong><span>{serviceMessage}</span></div>
    </header>

    {!context && !contextError && <section className="ai-panel ai-loading" role="status"><strong>Préparation locale du support…</strong><p>Sirāfiq extrait le texte utile avant tout envoi.</p></section>}
    {contextError && <section className="ai-panel ai-error" role="alert"><strong>Assistant indisponible pour ce support</strong><p>{contextError}</p></section>}

    {context && <>
      <div className="ai-layout">
        <section className="ai-panel ai-ask-panel">
          <div className="ai-context-status">
            <strong>Contexte prêt</strong>
            <span>{Math.round(context.text.length / 1000)} k caractères{context.pagesRead ? ` · ${context.pagesRead} page${context.pagesRead > 1 ? 's' : ''} parcourue${context.pagesRead > 1 ? 's' : ''}` : ''}</span>
          </div>
          {context.truncated && <p className="ai-warning">Le support est volumineux : Sirāfiq échantillonne plusieurs zones réparties dans le document tout en respectant une limite de contexte. Une partie non échantillonnée peut donc manquer pour une question ou une génération très ciblée.</p>}

          <label className="ai-token">Code d’accès IA
            <input type="password" autoComplete="off" value={accessToken} onChange={event => saveAccessToken(event.target.value)} placeholder="Code configuré côté Cloudflare" />
            <small>Ce code n’est pas la clé OpenAI. Il reste uniquement dans cet onglet de navigation.</small>
          </label>

          <div className="ai-suggestions" aria-label="Questions suggérées">
            {suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}
          </div>

          <form onSubmit={ask}>
            <label>Ta question<textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={3000} placeholder="Interroge le support ou demande une explication précise…" /></label>
            <button className="primary" type="submit" disabled={!question.trim() || asking}>{asking ? 'Analyse du support…' : 'Interroger le support'}</button>
          </form>
          {error && <p className="ai-error-message" role="alert">{error}</p>}
        </section>

        <section className="ai-panel ai-answer-panel" aria-live="polite">
          <p className="eyebrow">RÉPONSE</p>
          {asking ? <p>Réflexion en cours…</p> : answer ? <div className="ai-answer">{answer}</div> : <div className="ai-empty-answer"><strong>Aucune question envoyée</strong><p>Choisis une suggestion ou écris une question précise sur le support.</p></div>}
        </section>
      </div>

      <section className="ai-panel ai-flashcard-panel">
        <div className="ai-flashcard-head">
          <div><p className="eyebrow">CRÉATION ASSISTÉE</p><h2>Cartes mémoire depuis le support</h2><p>Sirāfiq demande à l’IA des questions de rappel actif strictement fondées sur le contexte préparé, puis te laisse les vérifier avant de les enregistrer.</p></div>
          <label>Nombre de cartes<select value={cardCount} onChange={event => setCardCount(Number(event.target.value) as 3 | 5 | 10)}><option value={3}>3</option><option value={5}>5</option><option value={10}>10</option></select></label>
        </div>
        <button className="primary ai-generate-cards" type="button" disabled={generatingCards || savingCards} onClick={() => void generateFlashcards()}>{generatingCards ? 'Génération…' : `Générer ${cardCount} cartes`}</button>
        {cardStatus && <p className="ai-card-status" role="status">{cardStatus}</p>}
        {generatedCards.length > 0 && <div className="ai-generated-cards">{generatedCards.map((card, index) => <article key={`${card.front}-${index}`}><span>Carte {index + 1}</span><strong>{card.front}</strong><p>{card.back}</p></article>)}</div>}
        {generatedCards.length > 0 && <div className="ai-card-actions"><button type="button" disabled={savingCards} onClick={() => setGeneratedCards([])}>Annuler</button><button className="primary" type="button" disabled={savingCards} onClick={() => void saveGeneratedCards()}>{savingCards ? 'Enregistrement…' : 'Ajouter aux cartes mémoire'}</button></div>}
      </section>

      <AiMindMapGenerator supportId={supportId} supportName={supportName} context={context.text} accessToken={accessToken} />
      <AiMemoryPassageGenerator supportId={supportId} supportName={supportName} context={context.text} accessToken={accessToken} />
    </>}
  </main>;
}
