# Déploiement de l’assistant IA

L’assistant d’étude utilise le Worker Cloudflare de Sirāfiq comme passerelle vers l’API OpenAI. La clé OpenAI ne doit jamais être placée dans le code client, dans `vars`, dans le dépôt Git ou dans le stockage du navigateur.

## Secrets requis

Le Worker attend deux secrets Cloudflare :

- `OPENAI_API_KEY` : clé API OpenAI utilisée uniquement côté Worker.
- `SIRAFIQ_AI_ACCESS_TOKEN` : code d’accès propre à Sirāfiq. C’est ce code que l’utilisateur saisit dans l’interface ; ce n’est pas la clé OpenAI.

`wrangler.jsonc` déclare ces deux noms comme secrets requis. Un déploiement doit donc échouer avec un message explicite si l’un d’eux manque.

## Configuration avec Wrangler

Depuis la racine du dépôt, après authentification Wrangler :

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SIRAFIQ_AI_ACCESS_TOKEN
```

Saisir chaque valeur au prompt. Ne pas passer les secrets en clair dans une commande conservée dans l’historique du terminal.

Le code d’accès Sirāfiq doit être une valeur longue et aléatoire. Toute personne qui le connaît peut utiliser les routes IA ; il doit donc être traité comme un secret et renouvelé s’il est exposé.

Le modèle par défaut du Worker est `gpt-5.6-terra`. Le Worker accepte également une variable serveur `OPENAI_MODEL` si un autre modèle compatible est explicitement configuré.

## Développement local

Pour `wrangler dev`, utiliser un fichier local `.dev.vars` ou `.env` non versionné avec les mêmes noms de secrets. Ne jamais ajouter ce fichier au dépôt.

Exemple de noms uniquement :

```text
OPENAI_API_KEY=...
SIRAFIQ_AI_ACCESS_TOKEN=...
```

## Déploiement

Après configuration des secrets :

```bash
npm run deploy
```

Le build exécute d’abord le typecheck, puis Wrangler déploie le Worker et les assets de l’application.

## Vérification après déploiement

Sur l’origine publique de Sirāfiq, ouvrir :

```text
/api/ai/status
```

La réponse attendue doit contenir :

```json
{
  "configured": true
}
```

Le endpoint peut aussi indiquer le modèle actif. Il ne renvoie jamais les valeurs des secrets.

Dans l’application :

1. ouvrir un support ;
2. ouvrir l’assistant IA ;
3. vérifier que l’état indique « Service IA prêt » ;
4. saisir le même `SIRAFIQ_AI_ACCESS_TOKEN` ;
5. envoyer une question simple fondée sur le support ;
6. vérifier ensuite la génération de cartes, de carte mentale et de passages de mémorisation.

Le document importé reste local jusqu’à une action IA explicite. Lors d’une question ou d’une génération, seul le contexte préparé par Sirāfiq est envoyé au Worker, qui le transmet ensuite à l’API OpenAI avec `store: false`.
