# Définition de terminé

Statuts utilisés pour une fonctionnalité :

`à faire → implémentée → testée techniquement → testée de bout en bout → prête pour validation iPad → validée`.

Une fonctionnalité ne peut pas sauter directement de « implémentée » à « validée ».

## Checklist minimale

- [ ] comportement nominal défini
- [ ] états de chargement définis
- [ ] états d'erreur explicites
- [ ] retry fonctionnel lorsque pertinent
- [ ] aucune action visible sans implémentation
- [ ] persistance après rechargement testée lorsque pertinent
- [ ] anti-doublon/idempotence testés lorsque pertinent
- [ ] TypeScript passe
- [ ] tests unitaires pertinents passent
- [ ] build passe
- [ ] E2E pertinent passe
- [ ] validation iPad réelle effectuée pour toute interaction matérielle ou ergonomique dépendante d'iPadOS
