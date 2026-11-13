# La Vallée des Morts — Version 20 / Coopération

## Nouveautés
- Création de compte et connexion avec identifiant + mot de passe.
- Mots de passe hachés avec scrypt et sel aléatoire.
- Comptes et sauvegardes persistés dans `vallee_data.json` côté serveur.
- Sauvegarde de progression périodique lorsque le joueur est connecté.
- Monstres et boss qui poursuivent les joueurs et attaquent à proximité.
- PV des ennemis gérés côté serveur et synchronisés dans la région.
- Récompense personnelle envoyée à chaque joueur présent dans la région lors d'une élimination.
- Pseudo, région et compagnon sélectionné transmis aux autres clients.

## Démarrage
1. Installer Node.js 18+ sur un ordinateur ou un hébergeur.
2. Décompresser cette archive.
3. Dans le dossier, exécuter `npm install`.
4. Exécuter `npm start` (port 8080 par défaut).
5. Ouvrir le jeu, entrer `ws://IP_DU_SERVEUR:8080` sur le même réseau, puis créer un compte ou se connecter.
6. Pour Internet, utiliser un hébergement Node.js avec WebSocket sécurisé (`wss://`).

## Limites et sécurité
Prototype de jeu, pas encore prêt pour une mise en production. Les comptes sont stockés en clair comme identifiants mais les mots de passe sont hachés ; prévoir HTTPS/WSS, limitation des tentatives, récupération de compte, validation plus stricte et sauvegardes régulières de la base. Le serveur persiste la progression du joueur, mais il reste des données de progression locale/serveur à harmoniser. Les modèles de compagnons distants restent des représentations simplifiées.
