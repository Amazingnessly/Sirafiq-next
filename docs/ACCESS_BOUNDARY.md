# Protection des routes API (préparation hors production)

**Statut : implémentation candidate sur branche d'intégration, pas une activation production ni une isolation multi-utilisateur.**

Toutes les routes privées sont vérifiées **au niveau de `worker/entry.ts`, avant tout accès D1 ou R2**. Cela inclut les lectures PDF HTTP Range, le bootstrap, les mutations, les extractions et les uploads multipart. `GET /api/build` et `GET /api/health` ne fournissent pas de données privées et restent accessibles.

## Condition de mise en service

Sur toute origine distante, si `SIRAFIQ_ACCESS_TEAM_DOMAIN` ou `SIRAFIQ_ACCESS_AUD` manque ou est invalide, l'API refuse l'accès avec HTTP 503 `ACCESS_NOT_CONFIGURED`. Avec configuration valide, elle exige un JWT signé `Cf-Access-Jwt-Assertion`, vérifié via les clés publiques officielles de l'équipe Cloudflare Access, avec `RS256`, `kid`, `iss`, `aud`, `sub`, `exp` et `nbf`. Les requêtes sans session valide reçoivent HTTP 401.

Configuration nécessaire (seulement après validation humaine) :
1. Créer une application **Cloudflare Access** protégeant le domaine exact du Worker et ses routes `/api/*` ; limiter l'accès aux identités explicitement autorisées.
2. Configurer côté Worker, sans les exposer dans le frontend, `SIRAFIQ_ACCESS_TEAM_DOMAIN` (exemple `your-team.cloudflareaccess.com`) et `SIRAFIQ_ACCESS_AUD` (Audience Tag fourni par l'application Access).
3. Vérifier l'injection automatique de l'en-tête `Cf-Access-Jwt-Assertion` par Access, les expirations de session, la lecture Range et l'import/rechargement sur iPad réel, ainsi que le bon comportement après révocation.
4. Confirmer que l'application est **mono-utilisateur** : cette frontière authentifie l'accès à une base D1/R2 commune mais **ne sépare pas les données des différents utilisateurs autorisés**. Pour un usage multi-utilisateur, ajouter une vraie isolation par identifiant + requêtes/objets/migrations appropriés et tests anti-accès croisés **avant** ouverture à plusieurs comptes.

Le trafic HTTP strictement local vers `localhost`, `127.0.0.1` ou `[::1]` est laissé libre pour le développement et les tests WebKit locaux. Ne jamais exposer un tel proxy de développement à un réseau non fiable, et ne jamais le faire passer pour une protection production.

**Sécurité de déploiement :** la modification ne doit pas être transférée sur `main`, activée ou déployée sans autorisation et revue explicite. L'absence de configuration bloque volontairement les flux de données sur une origine distante. Les tests simulés ne remplacent pas la validation réelle Cloudflare et iPad.
