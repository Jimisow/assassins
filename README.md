# 🗡️ Assassins

Un jeu social nocturne inspire du Loup-Garou/Mafia, joue en temps reel entre
amis depuis un navigateur — aucune installation necessaire (PWA installable
en un clic). Un Hote cree un salon, des Joueurs rejoignent avec un code a 4-5
caracteres, et la partie se deroule en temps reel (nuit, vote, election,
victoire) via Firebase Firestore.

**Jouer : https://jimisow.github.io/assassins/**

## Le jeu

- Roles : Citoyen, Detective, Chimiste, Sherif, Le Destin, Assassin, Tueur en
  Serie, Corrupteur, Le Martyr, Le Psychopathe.
- Camps : Citoyens, Assassins, Martyr, Psychopathe, Ames Soeurs.
- Election d'un Gouverneur qui departage les egalites de vote.
- Chat en partie (vivants/morts), theme visuel sombre "Tenebres et Mort".
- PWA installable sur Android et iOS, jouable en 4G/5G/wifi.

## Stack technique

- Frontend : JavaScript vanilla (modules ES), aucun framework.
- Backend de jeu : Firebase Firestore (temps reel, `onSnapshot`/`runTransaction`),
  authentification anonyme.
- Serveur local de developpement : Express (fichiers statiques uniquement).
- Deploiement : GitHub Pages (via GitHub Actions), le jeu fonctionne
  entierement cote client — aucun serveur applicatif requis en production.

## Lancer en local

```
npm install
npm start
```
Puis ouvrez http://localhost:3000

## Compte KUMP

Assassins est branche sur le **compte joueur KUMP**, partage avec les autres
jeux du studio : une seule identite, un temps de jeu cumule, des statistiques
(parties, victoires, camps joues) et des trophees, visibles aussi sur
kump.fr/profil. Bouton « Compte » sur l'ecran d'accueil.

**Jouer ne demande jamais de compte** : le jeu fonctionne exactement comme
avant sans lui.

```bash
npm install
npm run sync:kump   # copie kump-account dans public/js/vendor/ (voir CLAUDE.md)
```

Le module est **vendorise** et resolu par une import map, parce que ce projet
n'a volontairement aucun bundler. Le dossier `public/js/vendor/` est commite.

⚠️ Les statistiques d'Assassins sont **declarees** : le resultat d'une nuit est
calcule par le navigateur de l'Hote, le serveur ne peut pas le verifier. Jamais
de recompense reelle adossee a ces chiffres. Detail dans `CLAUDE.md`.

## Documentation du projet

- [`PROGRESS.md`](PROGRESS.md) — etat d'avancement, comment tester chaque fonctionnalite.
- [`DECISIONS.md`](DECISIONS.md) — choix techniques et regles de jeu non ecrites dans le cahier des charges.
- [`CLAUDE.md`](CLAUDE.md) — ce qu'il faut savoir avant de toucher au code : conventions, pieges, integration du compte KUMP.
- [`TODO_SECURITE.md`](TODO_SECURITE.md) — modele de securite (authentification, regles Firestore, confidentialite des roles).

## Licence

MIT
