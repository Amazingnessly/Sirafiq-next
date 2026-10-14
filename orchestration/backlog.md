# File de travail Sirāfiq — du plus prioritaire au moins prioritaire

État initial observé : 15 octobre 2026. Actualiser depuis GitHub avant chaque mission ; ne jamais déduire l'état actuel de ce seul fichier.

| Priorité | Travail | Preuve de fin / frein |
| --- | --- | --- |
| P0 | Maintenir PR #1 en DRAFT tant que l'iPad 6 / iPadOS 17.7.11 n'a pas validé import PDF réel, Range/206 multipage, multipart R2, persistance après reload et erreurs. | Tests matériels réels documentés ; **intervention humaine indispensable**. |
| P0 | Auditer les risques de données : lecture D1/R2 sans authentification, intégrité IndexedDB/outbox, conflits et véracité des états. | Correctifs isolés + tests reproductibles ; pas de déploiement sans autorisation. |
| P1 | Valider la nouvelle garde d'orchestration via PR puis push sur intégration, jobs verts sur chaque SHA exact. | Rapports Artifacts et CI green après intégration. |
| P1 | Fiabiliser les installations CI (absence de lockfile sur fondation observée) sans casser Cloudflare/Vite. | Lockfile reproductible + `npm ci` + CI complète sur PR ciblée. |
| P1 | Établir agent Codex à écriture limitée : jetons, budget, création sécurisée de branches/PR, contrôle des checks SHA, retries bornés. | Essai contrôlé complet avec logs ; opt-in secret/API et validation du coût. |
| P1 | Activer une cadence persistante réellement vérifiée, sans toucher `main` ni production sans accord. | Premier run externe planifié réellement observé ; verrou de concurrence. |
| P2 | Finaliser ergonomie iPad, états de synchronisation et extraction PDF lors du parcours réel. | E2E + test matériel. |
| P3 | Introduire modules de révision, mémorisation, Qour'ān, français, cartes mentales un par un après validation du socle. | Parcours vertical complet, provenance réelle, persistance, tests. |

Règles : jamais de suppression/écrasement silencieux ; ne pas fusionner PR #1. Les scouts peuvent travailler en parallèle ; un seul agent mutateur sur une branche à la fois.
