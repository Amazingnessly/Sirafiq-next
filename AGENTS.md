# AGENTS.md — Sirāfiq Next

Ce dépôt reconstruit Sirāfiq entièrement de zéro. Les anciennes versions V12–V26 ne sont jamais une base technique à recopier.

## Priorité absolue

La fiabilité passe avant la quantité d'écrans et avant la décoration.

Une fonctionnalité n'est pas terminée tant que son parcours complet n'est pas démontré :

`action → résultat → sauvegarde → fermeture/rechargement → données toujours présentes`.

## Règles non négociables

- Ne jamais ajouter un bouton, une action ou un contrôle visible sans implémentation réelle.
- Ne jamais simuler une réussite d'import, d'extraction, de synchronisation, d'IA, d'audio ou de sauvegarde.
- Ne jamais présenter un contenu générique comme provenant d'un support utilisateur.
- Toute activité dérivée d'un support doit conserver sa provenance vérifiable.
- Si l'extraction d'un document échoue, conserver le support lorsque possible et afficher un état d'échec explicite et réessayable.
- Aucun exercice de texte à trous.
- Ne jamais inventer de contenu coranique. Le module Qour’ān doit travailler à partir des ressources fournies par l'utilisateur.
- Ne jamais inventer les règles pédagogiques du Naskh ni utiliser une simple police arabe comme modèle calligraphique.
- Ne pas mélanger le cursus français et le cursus Naskh.
- Ne jamais écraser silencieusement un conflit de données.
- Les traitements longs doivent avoir des états explicites, un timeout approprié et une stratégie de reprise.
- Zustand, s'il est utilisé, reste réservé à l'état UI éphémère. Les données métier persistantes ne doivent pas y vivre.
- IndexedDB/Dexie est une couche de persistance locale réelle, pas un simple cache jetable.
- Toute mutation synchronisable doit être idempotente ou protégée contre les doublons.
- Ne pas ajouter une dépendance majeure sans besoin concret et documenté.

## Architecture cible

- React + TypeScript strict + Vite.
- Plugin Vite officiel Cloudflare.
- React Router.
- TanStack Query pour l'état serveur/réseau.
- Dexie/IndexedDB pour la persistance locale/offline.
- Cloudflare Worker API.
- D1 pour les données structurées synchronisées.
- R2 pour les fichiers.
- Workers AI uniquement derrière des contrats remplaçables.
- PDF.js pour les PDF.
- Pointer Events/Canvas pour les futures fonctions Apple Pencil.
- SVG vectoriel pour les futurs modèles pédagogiques Naskh.

## Méthode de développement

Construire verticalement, un parcours complet à la fois. Ne pas créer simultanément plusieurs modules incomplets.

Pour chaque changement :

1. Lire les contrats et le flux existants avant de modifier le code.
2. Définir le comportement nominal et les états d'erreur.
3. Implémenter le plus petit parcours complet.
4. Ajouter ou mettre à jour les tests.
5. Exécuter les vérifications du dépôt.
6. Ne déclarer « prêt pour validation » que si les vérifications passent.

## Commandes de vérification

```bash
npm install
npm run check
npx playwright install webkit
npm run test:e2e
```

Pour les parcours utilisant D1 local, Playwright applique la migration locale avant de démarrer l'application.

## Définition de terminé

Avant de présenter une fonctionnalité comme terminée :

- le TypeScript doit passer ;
- les tests unitaires pertinents doivent passer ;
- le build doit passer ;
- le parcours E2E pertinent doit passer ;
- la persistance après rechargement doit être couverte lorsque pertinent ;
- l'erreur et le retry doivent être couverts lorsque pertinent ;
- les fonctions matérielles (Pencil, micro, audio, clavier iPad) restent explicitement « à valider sur iPad réel » tant qu'elles n'ont pas été testées sur l'appareil.

« Le code compile » ne signifie jamais « la fonctionnalité fonctionne ».
