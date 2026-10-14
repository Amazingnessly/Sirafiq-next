# Orchestration autonome — Sirāfiq Next

## Autorité et état réel

**Source de vérité :** GitHub, jamais un souvenir de conversation. Ce document complète `AGENTS.md` et `docs/agent-orchestration.md`. Le produit V0.1 reste porté par `feat/v0.1-foundation`, PR #1 vers `main`. **La PR #1 reste DRAFT et ne doit jamais être fusionnée avant la validation physique sur iPad 6e génération / iPadOS 17.7.11.**

La branche `integration/sirafiq-autonomous` est un bac à sable dérivé de la fondation. Les branches `agents/*` ciblent l'intégration par petites PR. **Aucun changement de cette intégration n'est déployé en production, promu vers `main` ou fusionné dans PR #1 automatiquement.** Après validation et revue, le portage vers `feat/v0.1-foundation` exige une PR distincte et un nouveau contrôle de la CI.

## État de mise en service (15 octobre 2026)

- La CI existante a deux jobs : TypeScript/tests/build et Playwright WebKit iPad paysage.
- Le dernier commit vérifié vert sur la fondation au démarrage est `2d87115bf7f907e7ad10c4348389bdc3fc75e086`, workflow run `37357352186`. Ce SHA est **un checkpoint historique**, pas la promesse que les commits futurs seront verts.
- La PR #1 est encore DRAFT et non fusionnée lors de cette observation ; le vrai test iPad et le test Cloudflare D1/R2 restent à réaliser.
- La branche d'intégration et la protection en lecture seule sont préparées. **Aucun développement Codex planifié, aucune fusion automatique et aucune supervision 24h/24 ne sont annoncés comme actifs.**

## Garde automatisée (lecture seule)

Le workflow `.github/workflows/autonomous-guard.yml` lance le script `scripts/check-orchestration-state.mjs` (Node 22) et ses tests unitaires. Il exige que la PR #1 reste ouverte, en brouillon, non fusionnée, dirigée de la fondation vers `main`. Il lit les SHAs réels et distingue strictement la CI verte sur le SHA exact des états `pending`, `failed` ou `unknown`. Le rapport d'exécution est téléversé comme artifact `sirafiq-guard-report`, sans écriture dans le dépôt.

Le workflow est déclenchable automatiquement par chaque PR vers l'intégration, et par les pushes sur l'intégration **une fois le workflow effectivement présent sur cette branche**. Le cron `17 */4 * * *` (UTC) est intentionnellement préparé, MAIS **GitHub n'exécute les workflows `schedule` que lorsqu'ils existent sur la branche par défaut `main`**. Comme `main` ne doit pas être modifiée ici (et peut déployer en production), ce cron **n'est PAS activé** et ne doit pas être présenté comme tel. Pas de modification directe de `main`.

Un éventuel usage de `openai/codex-action@v1` est limité à un **scout en lecture seule**, déclenchable uniquement sur push d'intégration avec la variable de dépôt `SIRAFIQ_CODEX_SCOUT_ENABLED=true` ET un secret `OPENAI_API_KEY` fourni explicitement. Il ne crée ni code ni PR, n'a pas de droits d'écriture GitHub et ne s'exécute pas par défaut. L'absence de l'un de ces paramètres maintient le scout inactif. Ne jamais ajouter une clé en clair ni activer la dépense implicitement.

## Protocole pour « Continue Sirāfiq »

1. Lire les SHAs actuels de `feat/v0.1-foundation`, `integration/sirafiq-autonomous`, `main`, PR #1 et toutes PR ouvertes ; lire le présent document, `orchestration/state.json`, la CI et les derniers runs.
2. Vérifier le dernier checkpoint vert **sur SHA exact** (jobs requis conclus `success`) ; un statut absent/pending n'est pas vert.
3. Lire `orchestration/backlog.md`, examiner le code réel, choisir un seul parcours prioritaire (scouting parallélisable, mutations sérialisées).
4. Créer `agents/<sujet>` depuis le SHA réel de l'intégration ; limiter les modifications, tests et effets de bord.
5. Créer une PR `agents/* → integration/sirafiq-autonomous`. Exiger checks de qualité + E2E WebKit verts sur le head exact et réévaluer la base ; corriger au maximum trois fois puis documenter le blocage.
6. Recontrôler base/head/absence de régressions et d'opérations sensibles avant toute fusion. Ne jamais fusionner PR #1. Après fusion d'une PR ordinaire sur intégration, confirmer CI de la nouvelle tête ; enregistrer le SHA vert dans le prochain compte rendu.
7. Aucune promotion vers `main`, déploiement, migration destructive, suppression réelle ou édition de secrets sans accord humain requis.

## Sécurité, coûts et concurrence

- Branches isolées et une seule écriture produit en cours ; audits en lecture seule parallélisables.
- Workflow `contents: read`, `pull-requests: read`, `actions: read` ; temps maximum 8 min de garde, 15 min pour scout éventuel.
- Le mécanisme de génération Codex autonome des branches/PR, un ordonnanceur actif hors ChatGPT, le contrôle d'un budget API et les autorisations associées restent **à implémenter et à valider**, pas à simuler. Ne pas leur donner automatiquement des permissions d'écriture.
- Journaux et rapports par run ; aucun retry infini ; trois tentatives au maximum avant signalement.
- Avant toute activation persistante de Codex, tester une exécution réelle et confirmer les garde-fous, les droits, le budget, et l'absence de déclencheurs vers la production.

## Arrêts bloquants et validation

Le chemin critique produit reste la validation physique de la V0.1 sur iPad 6e génération / iPadOS 17.7.11 avec PDF réel, gros fichier multipart R2, D1/R2 réels, rechargement, erreurs et reprises ; **aucun succès matériel n'est revendiqué**. L'authentification/contrôle d'accès doit précéder l'usage de données privées réelles.

Le déploiement du cron sur `main` ou sur une infrastructure externe nécessite une conception et une autorisation explicite compatibles avec les règles de production. Le statut « autonomie permanente active » n'est autorisé qu'après une exécution planifiée observée avec succès.
