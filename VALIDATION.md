# Validation — Sirāfiq Next V0.1

Statut cible de cette branche : **implémentée, soumise à CI, pas encore validée sur iPad réel**.

| Contrôle | État | Note |
|---|---|---|
| Parcours V0.1 défini | ✅ | matière → import → extraction → persistance → sync → consultation |
| Aucun module futur affiché | ✅ | uniquement Aujourd’hui + Bibliothèque |
| Aucun bouton sans action | ✅ audit de code | à confirmer également par E2E |
| Hash SHA-256 anti-doublon | ✅ implémenté | test Vitest fourni |
| Extraction PDF.js réelle | ✅ implémentée | runtime contrôlé par CI/build, cas PDF réel à enrichir |
| Persistance IndexedDB/Dexie | ✅ implémentée | scénario Playwright après rechargement |
| Synchronisation D1/R2 | ✅ implémentée | test local/Cloudflare à compléter avant production |
| Erreur d’extraction explicite | ✅ implémentée | aucun faux contenu produit |
| TypeScript + tests unitaires + build | ⏳ CI GitHub | workflow `.github/workflows/ci.yml` |
| E2E iPad-sized | ⏳ CI GitHub | Playwright, viewport iPad Pro 11 paysage |
| Déploiement Cloudflare production | — | volontairement non activé avant validation du socle |
| Test Apple Pencil | — | hors périmètre V0.1 |
| Validation sur iPad réel | ⏳ | après réussite CI et déploiement de test |

## Règle de promotion

La V0.1 ne doit pas être marquée « validée » tant que la CI n'est pas verte et qu'un essai manuel sur iPad n'a pas confirmé le parcours réel d'import, ouverture, rechargement et reprise.
