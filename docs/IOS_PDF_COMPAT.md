# Compatibilité PDF sur Safari iOS

La lecture PDF utilise `pdfjs-dist` 3.11.174 volontairement figé.

Motif : les versions 5.x de PDF.js utilisent des API JavaScript récentes qui provoquent des erreurs d’exécution sur certains Safari iOS plus anciens, y compris des erreurs `undefined is not a function` lors de `getDocument`.

Règles :
- ne pas remettre `pdfjs-dist` sur `latest` sans validation réelle sur iPhone Safari ;
- tester import, première lecture, seconde lecture depuis le cache, rechargement et suppression ;
- incrémenter `EXTRACTION_VERSION` lorsqu’un changement invalide les caches précédents.
