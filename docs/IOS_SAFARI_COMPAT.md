# Compatibilité iOS Safari

Le moteur de lecture PDF utilise le build legacy de PDF.js chargé dynamiquement afin d’éviter de bloquer l’application sur des API JavaScript absentes de certaines versions de Safari iOS.

Mesures de compatibilité :
- polyfill local de `Promise.withResolvers` avant le chargement de PDF.js ;
- build `pdfjs-dist/legacy` ;
- repli `FileReader.readAsArrayBuffer` si `Blob.arrayBuffer()` n’est pas disponible ;
- stockage des nouveaux imports comme `Blob` explicites dans IndexedDB ;
- version du cache d’extraction incrémentée pour forcer une nouvelle extraction après ce correctif.

La validation finale doit être faite sur Safari iOS réel avec un PDF nouvellement importé.