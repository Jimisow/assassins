# Assassins

## À LIRE AVANT DE COMMENCER

Jeu social nocturne (type Loup-Garou / Mafia) joué en temps réel entre amis
depuis un navigateur. PWA installable, aucune installation requise. Un Hôte
crée un salon, des Joueurs rejoignent avec un code, la partie se déroule via
Firebase Firestore.

Depuis le 2026-08-29, il est aussi branché sur le **compte joueur KUMP**,
partagé avec les autres jeux du studio.

| Dépôt | Rôle |
|---|---|
| **Assassins** (ici) | le jeu |
| **kump-account** (`E:\Projet\kump-account`, [GitHub](https://github.com/Jimisow/kump-account)) | le compte joueur partagé |
| **kump.fr** (`E:\Projet\Kump.fr`) | serveur de validation, profil joueur, panel admin |
| **Androgame**, **D-Track** | les autres jeux branchés sur le même compte |

La documentation historique du projet reste dans
[`DECISIONS.md`](DECISIONS.md) (choix techniques, sessions 1 à 16),
[`PROGRESS.md`](PROGRESS.md) (état d'avancement, comment tester) et
[`TODO_SECURITE.md`](TODO_SECURITE.md) (modèle de sécurité). **Ce fichier ne
les remplace pas** — il porte ce qu'une session doit savoir avant de toucher
au code, eux gardent le détail et l'historique.

### ⚠️ DEUX projets Firebase dans la même page

| Projet | Contient | Configuré dans |
|---|---|---|
| `loup-garou-e5fd5` | les **salons de jeu** (`lobbies/{code}`) | `js/firebase-config.js`, en dur |
| `kump-812dd` | le **compte joueur** (identité, stats, trophées) | `js/kump.js`, en dur |

Ils cohabitent : `initKump()` crée une app Firebase **nommée « kump »** à côté
de l'app par défaut du jeu. **Le `uid` d'un joueur dans un salon n'a AUCUN
rapport avec son uid KUMP** — ne jamais utiliser l'un à la place de l'autre.
Les règles de sécurité du jeu (`firestore.rules`) reposent sur le premier ;
celles du compte, dans le dépôt `kump-account`, sur le second.

### Les règles de travail sur ce projet

1. **Tenir ce fichier à jour, systématiquement.** Une décision structurante ou
   un piège rencontré se documente **dans le même passage** que le code. Un
   `CLAUDE.md` périmé fait partir la session suivante sur des informations
   fausses.
2. **Documenter le POURQUOI.** Le code dit déjà ce qu'il fait.
3. **Vérifier en conditions réelles.** Ce projet a une longue histoire de bugs
   qui ne se voyaient qu'en jouant vraiment — dont un, en session 14, qui n'est
   apparu qu'après le déploiement des VRAIES règles Firestore.
4. **Actions sensibles : demander avant.** Déploiement, écriture en base de
   production, suppression de données.
5. **Rapporter fidèlement.** Si quelque chose n'a pas été testé, le dire.

## Conventions du projet

- **Aucun bundler, aucune étape de build.** `public/` est servi tel quel : par
  Express en local, par GitHub Actions en production (le workflow publie le
  dossier sans rien construire). C'est une propriété **assumée**, pas un
  manque. Ne pas introduire Vite sans une raison forte et explicite.
- **Texte d'interface SANS ACCENTS** (« Regles du jeu », « Creer une partie »).
  Convention du projet, à ne pas casser sur un seul écran.
  - *Exception assumée* : les libellés de trophées viennent du catalogue
    Firestore partagé avec kump.fr, où les accents sont corrects (« Première
    nuit »). Les désaccentuer dégraderait l'affichage du site pour un gain
    cosmétique dans le jeu.
- **Chemins RELATIFS partout** (`./index.html`, `./js/...`) dans le manifest,
  le service worker et l'import map. GitHub Pages sert ce projet sous
  `/assassins/`, pas à la racine du domaine — un chemin absolu pointerait hors
  du projet (bug corrigé en session 16, voir `DECISIONS.md`).

## Compte KUMP

### Comment le module est installé, sans bundler

Un navigateur ne sait pas résoudre `import ... from 'kump-account'` : il lui
faut une URL. Deux façons de la lui donner — introduire un build (ce qui
casserait le « zéro build », le workflow GitHub Actions, le service worker et
les trois pages d'entrée), ou **copier le module dans `public/` et le désigner
par une import map**. C'est la seconde qui est retenue.

```bash
npm install          # installe kump-account dans node_modules
npm run sync:kump    # le copie dans public/js/vendor/kump-account/
```

- **`public/js/vendor/kump-account/` EST commité** : c'est ce qui est servi en
  production, et le workflow de déploiement ne lance aucune installation npm.
- ⚠️ **NE JAMAIS ÉDITER CE DOSSIER À LA MAIN.** C'est une copie : la prochaine
  synchronisation l'écrasera sans prévenir. Une correction se fait dans le
  dépôt `kump-account`, se pousse, puis `npm install && npm run sync:kump`.
- ⚠️ **npm réutilise son cache tant que la version du module ne change pas** :
  une fonction ajoutée à `kump-account` restera introuvable après
  réinstallation jusqu'à ce que sa version soit incrémentée, ou que
  `node_modules/kump-account` soit supprimé à la main.

### ⚠️ L'import map doit précéder tout module

Déclarée dans les **trois** pages (`index.html`, `host.html`, `player.html`),
**avant** le premier `<script type="module">`. Une import map arrivant après
est ignorée en silence, et les imports échouent avec « Failed to resolve
module specifier ».

**Firebase y est épinglé sur 10.12.2 — exactement la version que
`js/firebase-config.js` charge par URL complète.** Même URL = un seul
téléchargement, une seule instance du SDK. Faire diverger les deux chargerait
Firebase **deux fois** (~150 Ko de plus) avec deux instances d'Auth qui
s'ignorent. Si l'une change de version, changer l'autre dans le même passage.

`kump-account` déclare `firebase >= 10.12` précisément pour rendre ce choix
possible : le module n'utilise rien de postérieur à la 9.11.

### ⚠️ Le service worker masque vos modifications en développement

Sa stratégie est *stale-while-revalidate* : il renvoie **immédiatement** la
version en cache, puis met le cache à jour en arrière-plan. Conséquence en
développement : **un fichier JS modifié n'apparaît qu'au DEUXIÈME
rechargement**. On croit que le changement n'a pas pris, on le refait, on
s'égare.

Deux façons de s'en sortir : cocher « Update on reload » dans l'onglet
Application des DevTools, ou recharger deux fois. Pour un test automatisé,
ouvrir le contexte avec `serviceWorkers: 'block'` — sans quoi le service
worker sert ses propres fichiers et une interception de requête ne voit jamais
rien passer (une demi-heure perdue une fois à croire qu'un stub ne marchait
pas, alors qu'il n'était jamais atteint).

### ⚠️ Service worker : la liste est tout-ou-rien

`cache.addAll()` échoue **en bloc** si une seule requête échoue — l'installation
du service worker échoue alors entièrement, en silence (piège déjà payé en
session 16). Tous les fichiers du module vendorisé sont donc listés dans
`SHELL_ASSETS`. **Un fichier ajouté à `kump-account` doit être ajouté ici, et
`CACHE_NAME` incrémenté.**

### Ce qui est branché

- **`js/kump.js`** — l'adaptateur : configuration, identité, enregistrement des
  parties. Contient la config Firebase KUMP **en dur** (identifiants publics,
  comme ceux du salon juste à côté) : sans build, il n'y a pas de variables
  d'environnement.
- **`js/account.js`** — l'écran connexion / profil. Réutilise `.modal-overlay`,
  `.modal` et `.modal-close`, déjà définis dans le jeu.
- **`index.html`** — bouton « Compte » dans les actions secondaires, chargé
  **paresseusement** : un joueur qui vient juste rejoindre une partie ne
  télécharge jamais le SDK du projet KUMP.
- **`js/player.js`** — envoie la partie terminée (`envoyerPartieAuCompteKump`).

### ⚠️ Les statistiques d'Assassins sont DÉCLARÉES

À dire tel quel, sans l'enjoliver. Le résultat d'une nuit est calculé par le
**navigateur de l'Hôte**, dans `loup-garou-e5fd5`, un projet auquel le serveur
de kump.fr n'a aucun accès. Il ne peut donc pas rejouer la partie.

Ce que le serveur vérifie (`Kump.fr/src/lib/game/games/assassins.ts`) :
que les valeurs **existent** dans le jeu (rôle, camp, nombre de joueurs entre
4 et 30, nombre de nuits), et qu'une partie n'ajoute **qu'un** à chaque
compteur. Rien de plus.

Ce qu'il ne peut pas vérifier : que le joueur a réellement gagné, ou réellement
joué Détective. C'est la limite déjà documentée dans `TODO_SECURITE.md`
(« Limite assumée ») — elle n'a pas changé.

**Conséquence : jamais de récompense réelle, ni de classement arbitré, adossé
à ces chiffres.** Pour aller plus loin, il faudrait déplacer le calcul des
nuits vers des Cloud Functions (plan Blaze).

C'est la différence avec D-Track, dont les parties sont **rejouées** par le
serveur.

### Boutique et economie (2026-08-30)

Assassins gagne des **pieces** a chaque partie terminee. Le bareme et les prix
vivent dans kump.fr (`src/lib/game/shops/assassins.ts`), pas ici.

⚠️ **ON PAIE LA PARTIE JOUEE, PAS LA VICTOIRE**, et c'est un choix de securite
plutot que d'equilibrage. Le serveur ne peut pas verifier qui a gagne : le
resultat d'une nuit est calcule par le navigateur de l'Hote, dans un projet
Firebase auquel il n'a aucun acces. Faire dependre l'essentiel du gain de la
victoire reviendrait a laisser le joueur fixer son propre salaire — en
s'annoncant vainqueur a chaque partie, il gagnerait le double d'un joueur
honnete. **Ne jamais inverser ce rapport** sans avoir d'abord rendu le resultat
verifiable cote serveur.

La reserve de temps reel borne deja le RYTHME : chaque partie coute 8 minutes
de reserve, donc on ne peut pas frapper monnaie plus vite qu'en jouant.

**L'ecran de boutique existe dans le module** (`kump-account/ui`,
`openKumpShop()`) et n'est PAS encore branche dans Assassins — il ne manque
qu'un bouton et l'appel, sur le modele de `D-Track/src/ui/accountButton.js`
(`openShopScreen`, qui lit les tokens du jeu pour habiller l'ecran).

### Pièges à ne pas défaire

- **Seuls les JOUEURS enregistrent une partie, pas l'Hôte.** L'Hôte est maître
  du jeu, pas participant (`MIN_PLAYERS = 4` s'entend hors Hôte) : il n'a ni
  rôle ni camp, et le module serveur les exige. Si l'on veut un jour créditer
  l'Hôte de ses parties animées, il faudra un `kind` distinct côté serveur —
  pas bricoler un faux rôle.
- **La durée part du premier statut de JEU, pas de l'entrée dans le salon.**
  Sinon l'attente des autres joueurs serait comptée comme du temps de jeu.
- **Le verrou anti-doublon se relâche au retour au salon.** L'écran de fin se
  redessine à chaque snapshot Firestore, d'où le verrou ; mais « Rejouer »
  repasse par le salon, et sans remise à zéro la partie suivante ne serait
  **jamais** enregistrée (et sa durée serait comptée depuis la précédente).
- **Ouvrir l'écran de compte ne doit créer AUCUN compte.** `watchAccount()`
  observe l'identité ; `ensureSignedIn()` en CRÉE une. Un compte KUMP n'est
  créé qu'à la première partie terminée, ou quand le joueur le crée vraiment.
- **`onAuthStateChanged` ne se déclenche PAS lors d'un `link*`.** Rattacher un
  email à un compte anonyme n'en change pas l'identifiant : pour Firebase,
  c'est le même utilisateur. `js/account.js` bascule donc explicitement vers le
  profil (`allerAuProfil`) après une identification réussie.
- **Ne pas reconstruire l'écran de compte à chaque événement d'identité.**
  « Créer mon compte » appelle d'abord `ensureSignedIn()` : l'utilisateur passe
  de `null` à anonyme *au milieu de la saisie*. Redessiner à ce moment-là
  viderait le formulaire et effacerait le message d'erreur.
- **« Ce compte Google est déjà pris » n'est pas une impasse.** C'est même le
  cas le PLUS FRÉQUENT : le joueur a déjà un profil KUMP créé depuis un autre
  jeu, Firebase refuse donc de rattacher une identité déjà prise
  (`credential-in-use`). L'écran propose alors « Me connecter avec ce compte
  Google » (`loginWithGoogle`), en disant franchement ce que ça coûte — la
  session anonyme en cours est abandonnée. Ne jamais revenir à un simple
  message d'erreur sans issue.
  - Le bandeau prend un **ton neutre** (`.account-error.info`) dans ce cas :
    le rouge sang est réservé à ce qui a vraiment échoué.
  - Le bloc de reprise fait `scrollIntoView()` : il est plus bas que le pli de
    la carte, et sans ça le joueur voit un bandeau et rien d'autre.
- **`cancelled` n'est PAS une erreur.** Le joueur a fermé la fenêtre Google.
  Sans traitement explicite, l'écran affiche « une erreur est survenue ».
- **Les avertissements `Cross-Origin-Opener-Policy` en console sont du bruit
  connu** du SDK Firebase, qui sonde `window.closed` sur sa popup. Ils
  apparaissent même quand la connexion réussit — ne pas partir en chasse.
- **`link*` et jamais `signIn*` pour créer un compte** — `signIn*` abandonne la
  progression du compte anonyme en cours.
- **Ne jamais écrire dans Firestore KUMP depuis le jeu.** Les règles refusent
  au client d'écrire temps de jeu, statistiques et trophées, **et le refus est
  SILENCIEUX**. La seule voie est `submitSession()`.

### URL du serveur de validation

Sans build, pas de variable d'environnement : `js/kump.js` choisit l'URL à
l'exécution d'après le nom d'hôte (localhost → `http://localhost:3000`,
sinon `API_PRODUCTION`).

⚠️ **`API_PRODUCTION` pointe sur `https://kump-studio.vercel.app`** — à mettre
à jour le jour où le domaine `kump.fr` sera branché sur le projet Vercel (voir
`kump.fr > CLAUDE.md > Déploiement`).

### Libellés des trophées : en base, pas dans le code

Les noms lisibles vivent dans le document Firestore `games/assassins`, lu par
`getGameCatalog()`. Le jeu et kump.fr lisent la MÊME source — un libellé
réécrit n'a besoin d'aucun déploiement. Le catalogue s'écrit depuis kump.fr :
`node scripts/seed-game-catalog.mjs --write`.

⚠️ Les **identifiants** de trophée sont définitifs et doivent correspondre à
ceux attribués par le serveur. Les **libellés** sont libres. Un catalogue
absent ne casse rien : l'écran retombe sur les identifiants bruts.

## Développement local

```bash
npm install
npm run sync:kump
PORT=3002 npm start     # 3000 est souvent pris par le serveur de kump.fr
```

Le compte KUMP a besoin du serveur de kump.fr sur `http://localhost:3000` pour
enregistrer les parties. Sans lui, elles partent en file d'attente locale et
seront envoyées plus tard — rien n'est perdu.

## État de vérification (2026-08-29)

**Vérifié en conditions réelles** (navigateur) : résolution de l'import map,
une seule version du SDK chargée, ouverture de l'écran de compte, message
d'erreur sur mot de passe trop court, création de compte, affichage du profil
avec les trophées du catalogue, persistance du pseudo après rechargement.

**Non vérifié** : l'enregistrement d'une partie réelle (il faut un Hôte et
quatre joueurs dans quatre navigateurs), la connexion **Google** (popup), et
le comportement du service worker mis à jour en production. Le code de
`player.js` suit le même chemin que celui de D-Track, vérifié lui, mais il n'a
pas été vu tourner.
