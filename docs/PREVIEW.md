# Environnement de prévisualisation

La branche `feat/v0.1-foundation` est déployée vers le Worker Cloudflare isolé `sirafiq-next-preview`.

Cet environnement ne doit jamais utiliser les stockages de production. Il cible :

- D1 : `sirafiq-next-preview-db` ;
- R2 : `sirafiq-next-preview-files` ;
- Workers AI via le binding `AI`.

Le déploiement attendu utilise `npm run deploy:preview`. Le script de préparation résout ou crée les ressources de prévisualisation nécessaires avant le build, puis injecte leurs bindings dans l'environnement `preview`.

L'intégration Workers Builds de `sirafiq-next` traite aussi les branches hors `main` comme des builds de prévisualisation. Le script `ensure-production-d1.mjs` détecte ce contexte via `WORKERS_CI_BRANCH` et remplace, uniquement dans le fichier de configuration de travail du build, les bindings D1/R2 top-level par les stockages de prévisualisation ci-dessus. Une branche de PR ne doit donc jamais recevoir les bindings D1/R2 de production.

Un build ou une URL de prévisualisation n'est pas une validation fonctionnelle de la V0.1 : le parcours réel D1/R2 et l'iPad cible restent à vérifier séparément.
