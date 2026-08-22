# Environnement de prévisualisation

La branche `feat/v0.1-foundation` est déployée vers le Worker Cloudflare isolé `sirafiq-next-preview`.

Cet environnement possède ses propres ressources D1 et R2 et ne doit jamais être considéré comme la production.

Le déploiement attendu utilise `npm run deploy:preview`.

Dernier déclenchement contrôlé après activation de R2 et correction de la commande Cloudflare Builds.

Nouveau déclenchement demandé après configuration des builds non-production.
