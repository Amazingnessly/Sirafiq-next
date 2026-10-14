# File de travail Sirāfiq — du plus prioritaire au moins prioritaire

État mis à jour : 15 octobre 2026. Checkpoint confirmé vert de l'intégration : `f2f2fe01` (CI `38651866108`, garde `38651866104`). Actualiser depuis GitHub avant chaque mission ; ne jamais déduire l'état actuel de ce seul fichier.

| Priorité | Travail | Preuve de fin / frein |
| --- | --- | --- |
| P0 | Maintenir PR #1 en DRAFT tant que l'iPad 6 / iPadOS 17.7.11 n'a pas validé import PDF réel, Range/206 multipage, multipart R2, persistance après reload et erreurs. | Tests matériels réels documentés ; **intervention humaine indispensable**. |
| P0 | Protection D1/R2 : issue #288, PR #289 DRAFT (Cloudflare Access JWT) ; vérifier CI sur SHA exact puis demander revue de sécurité avant fusion. Prévoir isolation par utilisateur si besoin. | Aucun déploiement, secret ou changement production ; tests Cloudflare Access et validation iPad réels encore à faire. |
| P1 | Garde d'orchestration initiale validée (PR #287 fusionnée, CI et garde après fusion vertes sur `f2f2fe01`). | Continuité GitHub Actions sur push vérifiée ; cron sur `main` inactif, Codex toujours désactivé. |
| P1 | Investiguer 5 alertes `npm audit` de gravité élevée observées en CI (issue #290) et fiabiliser les installations sans lockfile. | Audit détaillé + mises à jour ciblées, lockfile reproductible et `npm ci` sans régression Cloudflare/Vite. |
| P1 | Établir agent Codex à écriture limitée : jetons, budget, création sécurisée de branches/PR, contrôle des checks SHA, retries bornés. | Essai contrôlé complet avec logs ; opt-in secret/API et validation du coût. |
| P1 | Activer une cadence persistante réellement vérifiée, sans toucher `main` ni production sans accord. | Premier run externe planifié réellement observé ; verrou de concurrence. |
| P2 | Finaliser ergonomie iPad, états de synchronisation et extraction PDF lors du parcours réel. | E2E + test matériel. |
| P3 | Introduire modules de révision, mémorisation, Qour'ān, français, cartes mentales un par un après validation du socle. | Parcours vertical complet, provenance réelle, persistance, tests. |

Règles : jamais de suppression/écrasement silencieux ; ne pas fusionner PR #1. Les scouts peuvent travailler en parallèle ; un seul agent mutateur sur une branche à la fois.
