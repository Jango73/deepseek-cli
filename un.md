# Plan de mise à jour du parsing

## Objectif
Mettre à jour le CLI DeepSeek pour que seules les séquences encadrées par `>>>` et `<<<` soient interprétées comme des commandes, tout le reste devant rester du chat libre. Adapter à la fois le code côté parsing et les prompts envoyés aux agents.

## Suivi des étapes
- [x] **Étape 1 — Analyse & cadrage** : confirmer l’impact sur le parseur (`CommandExecutor.parseAIResponse`), sur les résumés système envoyés aux agents, et sur les fichiers de prompts.
- [x] **Étape 2 — Implémentation du nouveau parsing** : modifier `CommandExecutor.mjs` pour détecter les blocs `>>> … <<<`, préserver les messages d’agent et transformer le reste en commentaires.
- [x] **Étape 3 — Mise à jour des prompts** : réécrire les instructions dans `prompts/*.txt` pour clarifier les nouvelles règles d’émission de commandes.
- [x] **Étape 4 — Vérifications finales** : relire les changements, ajuster la doc/plan et prévoir les tests ou validations nécessaires (`node src/Test-Commands.mjs` exécuté pour valider le parsing).

Chaque étape sera cochée une fois terminée, avec mise à jour du fichier si des ajustements supplémentaires sont requis.
