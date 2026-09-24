# Environnement de prévisualisation

La branche `feat/v0.1-foundation` est déployée vers le Worker Cloudflare isolé `sirafiq-next-preview`.

Cet environnement ne doit jamais utiliser les stockages de production. Il cible :

- D1 : `sirafiq-next-preview-db` ;
- R2 : `sirafiq-next-preview-files` ;
- Workers AI via le binding `AI`.

Le déploiement attendu utilise `npm run deploy:preview`. Le script de préparation résout ou crée les ressources de prévisualisation nécessaires avant le build, puis injecte leurs bindings dans l'environnement `preview`.

Un build ou une URL de prévisualisation n'est pas une validation fonctionnelle de la V0.1 : le parcours réel D1/R2 et l'iPad cible restent à vérifier séparément.
