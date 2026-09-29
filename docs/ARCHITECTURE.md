# Architecture — Sirāfiq Next

## Principe

Sirāfiq Next est construit comme une application local-first synchronisée. L'interface doit rester utile et conserver le travail lorsque le réseau disparaît, puis synchroniser les opérations de façon explicite.

## Couches

```text
React / TypeScript
├─ UI et navigation
├─ TanStack Query : état réseau/serveur
├─ Dexie : persistance locale
└─ Sync engine : outbox → API
          ↓
Cloudflare Worker
├─ validation des contrats
├─ services métier
├─ D1 : données structurées
└─ R2 : fichiers
```

## Parcours vertical V0.1

```text
créer une matière
→ importer un texte ou un PDF
→ calculer le SHA-256
→ conserver localement
→ extraire le vrai contenu lorsque possible
→ ajouter les opérations à l'outbox
→ synchroniser matière + métadonnées + fichier + extraction
→ consulter le support
→ recharger l'application
→ retrouver le support et son contenu
```

## Provenance

Aucune future activité pédagogique ne doit prétendre provenir d'un support sans conserver un lien vérifiable vers la version et, lorsque possible, l'ancrage ou le segment source.

## Données et synchronisation

Les identifiants sont créés côté client. Les mutations distantes sont conçues pour être répétables sans créer de doublons. Les erreurs de synchronisation restent visibles et réessayables.

L'écrasement silencieux de données concurrentes est interdit. L'introduction de l'édition multi-appareils devra ajouter une stratégie explicite de version/conflit avant d'être annoncée comme supportée.

## Stockage

- Dexie/IndexedDB : copie locale persistante et outbox.
- D1 : métadonnées structurées synchronisées.
- R2 : binaires importés.

Les fichiers importés ne sont pas stockés en base64 dans D1.

## IA

L'IA n'est pas une source de vérité. Toute fonction IA doit :

- travailler à partir de données réellement disponibles ;
- conserver la provenance pertinente ;
- signaler les échecs ;
- permettre la correction humaine lorsque le résultat devient un objet d'apprentissage.

La V0.1 n'expose aucune activité IA tant que le parcours documentaire n'est pas validé.
