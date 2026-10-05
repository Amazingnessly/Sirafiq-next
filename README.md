# Sirāfiq Next — V0.1 Fondation

Sirāfiq Next reconstruit l'application de zéro. Les anciennes versions V12–V26 ne servent pas de base technique.

La priorité absolue est la fiabilité : aucun contrôle visible ne doit promettre une fonction absente et aucune réussite ne doit être simulée.

## Parcours réellement implémenté dans la V0.1

`matière → import texte/PDF → extraction réelle lorsque possible → persistance locale → synchronisation → consultation → rechargement → données conservées`

La V0.1 comprend :

- React + TypeScript + Vite ;
- plugin Vite officiel Cloudflare ;
- Worker API et Static Assets ;
- D1 pour les métadonnées structurées ;
- R2 pour les fichiers ;
- IndexedDB + Dexie pour la persistance locale ;
- outbox de synchronisation avec retry/backoff ;
- création de matières ;
- import PDF, TXT, Markdown et texte saisi ;
- hash SHA-256 anti-doublon ;
- extraction du texte PDF avec PDF.js ;
- échec explicite pour PDF non extractible ;
- consultation du contenu réel ;
- persistance après rechargement ;
- tests unitaires et E2E.

## Ce qui n'apparaît volontairement pas encore

Qour’ān, mémorisation, flashcards, cahier Pencil, français, prononciation, Naskh, cartes mentales, médiathèque, transcription et mode enseignant. Un module devient visible uniquement lorsque son premier parcours complet est opérationnel.

## Développement

Prérequis : Node.js 22+.

```bash
npm install
npm run prepare:local
npm run dev
```

## Vérifications

```bash
npm run check
npx playwright install webkit
npm run test:e2e
```

La CI GitHub exécute les contrôles de qualité et le scénario E2E WebKit au format iPad paysage à chaque pull request et à chaque push sur `main`.

## Cloudflare

Le dépôt est préparé pour Cloudflare Workers + Static Assets, D1 et R2. D1 et R2 portent des noms explicites dans la configuration, mais leurs identifiants de compte ne sont pas codés en dur : le pipeline résout le binding D1 avant le build/deploy.

L’intégration Git Cloudflare Workers Builds est active et le pipeline build/deploy produit désormais des versions Worker avec succès. Ce signal confirme la chaîne de déploiement, mais ne remplace pas la validation fonctionnelle réelle : D1/R2, import/rechargement, reprise multipart et comportement sur l’iPad cible restent à vérifier avec des supports réels avant de considérer la V0.1 validée.

Avant tout usage avec des données personnelles réelles, l'application devra être protégée par une couche d'authentification/contrôle d'accès adaptée.

## Règles du dépôt

Lire `AGENTS.md` avant toute tâche Codex ou tout changement substantiel. La définition de terminé est détaillée dans `docs/DEFINITION_OF_DONE.md`.
