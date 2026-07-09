# Securite — etat actuel et 2 actions manuelles avant mise en ligne

Ce document a longtemps liste des failles de securite majeures ("mode test").
**Elles sont maintenant corrigees cote code** (session 13, voir `DECISIONS.md`).
Il reste **deux actions que vous devez faire vous-meme dans la console
Firebase** (des clics, pas du code) avant que ces corrections soient
realmente actives — sans elles, le projet tourne encore avec les anciennes
regles permissives.

## ⚠️ A faire par vous, maintenant (5 minutes)

### 1. Activer l'authentification anonyme

L'application authentifie desormais chaque appareil de facon anonyme et
invisible (aucun mot de passe, aucun email demande a vos joueurs) : c'est ce
qui permet aux regles Firestore de verifier "qui a le droit d'ecrire quoi".
Cette methode doit etre activee manuellement une fois dans la console :

1. Allez sur https://console.firebase.google.com/ → projet **loup-garou-e5fd5**.
2. Menu de gauche → **Authentication** → onglet **Sign-in method**.
3. Cliquez sur **Anonymous** dans la liste des fournisseurs → **Activer** → **Enregistrer**.

### 2. Deployer les nouvelles regles Firestore

Le fichier `firestore.rules` a la racine du projet contient les nouvelles
regles (deja ecrites et testees). Il faut les publier :

**Option simple (copier-coller, sans rien installer) :**
1. Console Firebase → **Firestore Database** → onglet **Regles**.
2. Ouvrez le fichier `firestore.rules` de ce projet, copiez tout son contenu.
3. Collez-le dans l'editeur de la console (remplacez tout le contenu existant).
4. Cliquez **Publier**.

**Option CLI (si vous etes a l'aise avec un terminal)** — `firebase.json` et
`.firebaserc` sont deja fournis a la racine du projet, il suffit de :
```
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

**Apres avoir fait les deux etapes ci-dessus**, testez immediatement une
partie complete (creer un salon, rejoindre avec 2-3 fenetres, jouer une nuit
et un vote). Si quelque chose semble bloque, revenez temporairement aux
anciennes regles permissives (`allow read, write: if true;` partout) le temps
qu'on regarde ensemble, plutot que de rester bloque en plein match avec des
amis.

*(Mise a jour session 14 : un bug de ce type a effectivement ete trouve et
corrige juste apres le premier deploiement reel des regles - "plus personne
n'avait de role" - voir `DECISIONS.md`. Retestee a fond contre les regles
reellement en ligne depuis, tout fonctionne. C'est precisement le genre de
probleme qui ne peut se reveler qu'en testant contre les VRAIES regles, pas
contre le mode permissif utilise pendant le developpement.)*

## Ce qui a ete corrige (session 13)

- **Authentification** : chaque appareil a desormais un identifiant
  (`uid`) verifie par Firebase, au lieu d'un simple UUID stocke dans
  `localStorage` que n'importe qui pouvait modifier depuis la console du
  navigateur pour usurper un autre joueur ou l'Hote.
- **Verification de l'auteur d'une action** : les regles Firestore
  n'autorisent plus un joueur a ecrire dans le document d'un AUTRE joueur, ni
  a modifier le salon comme s'il etait l'Hote. Chacun ne peut agir qu'en son
  propre nom.
- **Confidentialite reelle des roles** (le point le plus important cote
  gameplay) : le role/camp de chaque joueur vit desormais dans un document
  **prive**, lisible uniquement par le joueur concerne et par l'Hote (le
  "maitre du jeu" de la partie, comme dans un vrai jeu de societe). Ouvrir les
  DevTools ne permet plus de lire le role des autres joueurs — avant, c'etait
  trivial.
- **Validation des messages de chat** : longueur, auteur verifie (impossible
  d'envoyer un message au nom de quelqu'un d'autre).
- **Nettoyage du salon a la fermeture** : les sous-collections (joueurs,
  votes, actions de nuit, chat...) sont maintenant bien supprimees, elles ne
  restaient avant orphelines dans la base indefiniment.

Detail technique complet dans `DECISIONS.md`, section "session 13".

## Limite assumee (a lire avant de considerer le sujet "clos")

Ce n'est **pas** une architecture "zero trust" avec toute la logique de jeu
calculee sur un serveur de confiance. C'est toujours l'Hote (un navigateur
comme les autres, pas un serveur a vous) qui calcule les resultats de nuit,
attribue les roles, tranche les egalites, etc. Les regles empechent
desormais un joueur normal de tricher facilement (lire un role, agir a la
place de quelqu'un d'autre), mais un attaquant qui reverse-ingenierierait
entierement le protocole ET reussirait a se faire passer pour l'Hote
pourrait encore theoriquement influencer une partie. Etant donne l'enjeu
reel d'un jeu social entre amis (pas d'argent, pas de donnees sensibles), ce
niveau de protection est un compromis raisonnable entre securite et
complexite/cout.

**Si vous voulez aller plus loin plus tard** (protection quasi-parfaite,
utile si le jeu devient tres populaire) : deplacer le calcul des resultats de
nuit, l'attribution des roles et le tirage au sort des egalites vers des
**Cloud Functions** (code execute sur les serveurs de Google, jamais visible
ni modifiable par un client). Cela necessite le plan payant Firebase
"Blaze" (l'usage reel resterait quasi gratuit pour un jeu entre amis, mais
une carte bancaire doit etre enregistree) et une reecriture plus consequente.
Dites-le moi si vous voulez qu'on s'y attaque.

## Avant le Play Store (rappel pour plus tard, pas urgent maintenant)

- **Firebase App Check** : ajoute une couche qui verifie que les requetes
  viennent bien de votre app officielle (pas d'un script/bot), via Play
  Integrity une fois l'app publiee sur Android. A configurer au moment de
  l'empaquetage (Capacitor/Cordova/TWA), pas avant.
- Verifiez les quotas/tarification Firestore avant un lancement public a
  grande echelle (le plan gratuit "Spark" a des limites de lectures/
  ecritures quotidiennes).
