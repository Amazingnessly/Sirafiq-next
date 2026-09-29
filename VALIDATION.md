# Validation — Sirāfiq Next V0.1

Statut cible de cette branche : **implémentée et couverte par CI, pas encore validée sur iPad réel**.

| Contrôle | État | Note |
|---|---|---|
| Parcours V0.1 défini | ✅ | matière → import → extraction → persistance → sync → consultation |
| Aucun module futur affiché | ✅ | uniquement Aujourd’hui + Bibliothèque |
| Aucun bouton sans action | ✅ | audit de code + parcours E2E ; validation appareil réel encore requise |
| Hash SHA-256 anti-doublon | ✅ | test Vitest fourni |
| Extraction PDF.js réelle | ✅ | runtime contrôlé par CI/build ; validation avec support réel sur iPad encore requise |
| Persistance IndexedDB/Dexie | ✅ | scénario Playwright après rechargement |
| Synchronisation D1/R2 | ✅ implémentée | parcours de reprise couvert ; validation Cloudflare/R2 réel encore requise |
| Erreur d’extraction explicite | ✅ | aucun faux contenu produit |
| TypeScript + tests unitaires + build | ✅ CI GitHub | contrôle obligatoire avant fusion des PR ciblées |
| E2E iPad-sized | ✅ CI GitHub | Playwright WebKit au format iPad paysage |
| Déploiement Cloudflare Workers Builds | ✅ pipeline | build/deploy Cloudflare vert et version Worker créée ; validation fonctionnelle D1/R2 réelle encore requise |
| Test Apple Pencil | — | hors périmètre V0.1 |
| Validation sur iPad réel | ⏳ | import, ouverture, rechargement, reprise et multipart/R2 réel à confirmer |

## Règle de promotion

La V0.1 ne doit pas être marquée « validée » tant qu'un essai manuel sur l'iPad cible n'a pas confirmé le parcours réel d'import, ouverture, rechargement et reprise, notamment avec Cloudflare D1/R2 réel et un fichier volumineux pour le multipart. Le pipeline Cloudflare est désormais opérationnel ; il reste un prérequis technique, pas une preuve de fonctionnement du parcours réel sur l'appareil cible.

La CI reste une condition nécessaire à chaque fusion, mais elle ne remplace pas la validation sur appareil réel.
