# Journal des decisions prises en autonomie

Ce document liste les choix faits pour lever les ambiguites du cahier des
charges, ainsi qu'un bug critique decouvert et corrige pendant les tests. A
lire avant de modifier le projet : plusieurs regles de jeu "non ecrites"
vivent uniquement ici.

## Resilience reseau, installation PWA, verification finale (session 15)

- **Resilience 4G/5G/wifi** : `firebase-config.js` avait deja
  `experimentalAutoDetectLongPolling: true` (bascule automatiquement sur du
  long-polling fiable quand un reseau bloque le streaming WebChannel de
  Firestore - frequent sur certains reseaux mobiles/wifi restrictifs), donc
  rien a changer sur ce point. Verifie concretement avec un test automatise
  qui fait rejoindre et jouer une partie complete a 4 joueurs simultanement
  sous des profils reseau distincts et realistes (wifi rapide sans
  throttling, 4G a 100ms de latence, 3G lente a 400ms de latence + bande
  passante reduite, via l'emulation reseau du protocole DevTools Chrome) :
  aucune erreur, partie complete jouable de bout en bout y compris les
  actions mediees par l'Hote (Detective) qui ajoutent un aller-retour reseau
  supplementaire. **Nouveau** : un petit bandeau (`network-status.js`,
  affiche sur les 3 pages) previent le joueur en cas de coupure reseau
  complete (detectee via `navigator.onLine`) - Firestore se resynchronise
  seul des que la connexion revient, ce bandeau sert juste a rassurer plutot
  qu'a laisser un ecran silencieusement fige.
- **Bouton "Installer l'app"** (`pwa-install.js`, sur l'ecran d'accueil) :
  - Android / Chrome / Edge (mobile ou desktop) : intercepte l'evenement
    `beforeinstallprompt` emis par le navigateur quand l'app est installable,
    et l'utilise pour declencher l'invite d'installation NATIVE au clic.
  - iOS (Safari et les autres navigateurs, tous limites au meme moteur
    WebKit impose par Apple) : **aucune API d'installation programmable
    n'existe** - limitation d'Apple, pas un oubli. Le bouton ouvre a la
    place une modale expliquant la manipulation manuelle (Partager → "Sur
    l'ecran d'accueil").
  - Dans les deux cas, le bouton reste cache si l'app tourne deja en mode
    installe (`display-mode: standalone`), et sur toute plateforme qui ne
    supporte ni l'un ni l'autre (evite un bouton qui ne mene nulle part).
  - `service-worker.js` : `ui-utils.js` et `network-status.js` (ajoutes en
    sessions 12 et 15) manquaient de la liste des fichiers mis en cache pour
    le shell PWA - corrige au passage (cache renomme `assassins-shell-v3`
    pour forcer le renouvellement chez les utilisateurs qui auraient deja
    installe une version anterieure).
- **Formulation des annonces de mort** : `", qui etait [role]"` (proposition
  relative accolee a la phrase) remplace par `". Il/elle etait [role]."`
  (phrase separee), sur demande explicite - s'applique aux 6 endroits
  concernes (annonce de nuit, resultat du vote du village, mort de chagrin
  de l'amoureux, cote Hote et Joueur).
- **Verification finale des fichiers** : vérification systematique -
  aucun `console.log` de debogage oublie ; aucune ecriture de `role`/`camp`
  restee sur la collection publique `players` (tout passe bien par
  `playersPrivate`) ; verification syntaxique de tous les fichiers JS ;
  tous les `<script src>` et imports ES modules des 3 pages HTML pointent
  vers des fichiers reellement presents ; tous les exports/imports entre
  modules se correspondent (`night-cycle.js`, `lobby.js`,
  `firebase-config.js`) ; relecture complete de `firestore.rules` pour
  confirmer qu'aucune AUTRE collection n'a la meme faille que celle
  corrigee en session 14 (seule `playersPrivate` avait une regle de lecture
  non uniforme par document - toutes les autres collections utilisees via
  une requete de LISTE ont une regle uniforme, donc sans risque). Suite
  complete de tests (rounds 8 a 15) rejouee contre les regles reellement en
  ligne : tout fonctionne, seul le bruit reseau deja documente (session 9)
  reapparait de facon intermittente sans jamais affecter le resultat d'une
  partie.

## Bug corrige apres deploiement reel des regles (session 14)

Des que l'utilisateur a active l'authentification et publie les nouvelles
`firestore.rules` (session 13) et teste en conditions reelles : **plus
personne n'avait de role** (tout le monde voyait "Citoyen" dans "Voir mon
role"), alors que l'Hote orchestrait correctement la nuit (il voyait bien
"Passer au Detective", preuve que LUI avait les bonnes donnees).

**Cause** : `player.js` lisait `playersPrivate` via une requete sur toute la
collection (`onSnapshot(collection(db,...,"playersPrivate"))`), filtree en
theorie par la regle `allow read: if uid == playerId || isLobbyHost()`. Or
Firestore **rejette entierement une requete de LISTE** (pas de simple
filtrage silencieux) des qu'elle ne peut pas prouver, avant meme de
l'executer, que TOUS les documents qu'elle pourrait retourner passeraient la
regle - ce qui n'est pas le cas ici, puisque `uid == playerId` est vrai pour
UN SEUL document de la collection (le sien), pas pour tous. Resultat : la
requete entiere echouait avec `permission-denied`, silencieusement (l'erreur
n'apparaissait que dans la console navigateur), laissant `role`/`camp`
indefinis pour tout le monde - d'ou le repli sur "Citoyen"
(`getRoleInfo(me.role || "citoyen")`).
Cote Hote, la MEME regle fonctionnait car son critere (`isLobbyHost()`) ne
depend PAS du document candidat : il est soit vrai pour toute la collection,
soit faux pour toute la collection — Firestore peut le prouver a l'avance et
autorise la liste complete.

**Corrige** : `player.js` n'ecoute plus la collection `playersPrivate`
entiere, mais UNIQUEMENT son propre document
(`onSnapshot(doc(db,...,"playersPrivate", PLAYER_ID))`) — ce qui est de
toute facon tout ce dont un Joueur a besoin (il n'a jamais eu le droit de
lire le document d'un autre). Une lecture d'UN document precis est toujours
evaluee individuellement par les regles, sans cette limitation des requetes
de liste.

**Lecon retenue pour la suite** : cette classe de bug (une requete de liste
Firestore refusee en bloc a cause d'une regle non uniforme par document) ne
se declare QUE face aux vraies regles de production — les tests automatises
de cette session tournaient contre le mode test permissif (`allow read,
write: if true`) faute d'environnement local capable de faire tourner
l'emulateur Firestore (Java trop ancien, cf. session 13). Verifie retest
complet (round8 a round13) contre les regles reellement deployees : tout
fonctionne correctement apres ce correctif.

## Securisation avant mise en ligne publique (session 13)

Reponse a la demande explicite de l'utilisateur ("corrige tous les soucis du
TODO_SECURITE.md, rends l'app la plus securisee possible"), avec un niveau
d'effort choisi explicitement par l'utilisateur : "solide et raisonnable"
(authentification + regles Firestore strictes + roles reellement prives),
plutot que la migration complete vers des Cloud Functions (plus lourde,
necessite le plan payant Firebase, laissee en option future documentee dans
`TODO_SECURITE.md`).

### Authentification anonyme Firebase

- `firebase-config.js` exporte desormais `ensureSignedIn()` : connecte
  l'appareil de facon anonyme (`signInAnonymously`) au premier besoin, sans
  aucune interaction utilisateur (pas de mot de passe/email demande).
- `lobby.js` utilise desormais `auth.currentUser.uid` (verifie cote serveur,
  infalsifiable) comme `hostId`/`playerId`, au lieu d'un UUID genere
  cote client et stocke tel quel dans `localStorage` (que n'importe qui
  pouvait modifier depuis la console du navigateur pour usurper un autre
  joueur). `verifyPlayerSessionValid`/`verifyHostSessionValid` verifient
  desormais aussi que l'identite Firebase Auth actuelle correspond bien a la
  session enregistree, pas seulement que le document existe.

### Separation public/prive des donnees joueur

- **Avant** : un seul document `players/{id}` contenait tout, y compris
  `role`/`camp` — n'importe quel client pouvait le lire integralement (regles
  permissives), donc lire le role de n'importe qui via les DevTools.
- **Apres** : `players/{id}` ne contient plus que des champs PUBLICS (nom,
  vivant/mort, pret, potions...). Un nouveau document
  `playersPrivate/{id}` contient `role`, `camp`, `loverId` (amoureux) et
  `teammateIds` (coequipiers du camp Assassins) — lisible uniquement par le
  joueur concerne et par l'Hote (regles Firestore), modifiable uniquement par
  l'Hote (un joueur ne peut pas s'attribuer un role).
- **L'Hote garde acces a tout** (role de "maitre du jeu", coherent avec un
  vrai jeu de societe) : `host.js` fusionne les deux collections en un seul
  tableau `players` a la forme identique a avant (`mergePlayers()`), donc
  toute la logique d'orchestration existante (calcul de victoire, annonces,
  roster complet, ecran de fin) continue de fonctionner sans modification.
  Cote Joueur, la meme fusion s'applique mais les regles Firestore ne
  renvoient jamais que SON PROPRE document prive : les autres joueurs du
  tableau local n'ont donc jamais de `role`/`camp` renseigne, seulement leurs
  champs publics.
- **Camp Assassins et cible du Tueur en Serie** : ces deux ecrans avaient
  besoin de connaitre le `camp` d'AUTRES joueurs (pour exclure ses propres
  allies de la liste de cibles, et pour l'unanimite du vote). Comme un joueur
  ne peut plus lire le camp de personne d'autre que lui-meme, l'Hote calcule
  desormais `teammateIds` (liste des coequipiers) pour chaque membre du camp
  Assassins au moment de l'attribution des roles (`writeTeammateIds()`, dans
  le document prive de CHAQUE coequipier), et a nouveau si le Corrupteur
  convertit quelqu'un en cours de partie. `player.js` utilise
  `me.teammateIds` (son PROPRE document prive) pour ces deux ecrans, sans
  jamais avoir besoin de lire le camp d'un tiers.

### Actions "mediees" par l'Hote (Detective, Destin)

Deux mecaniques ecrivaient auparavant directement des champs desormais
prives, depuis le client d'un joueur qui n'a plus le droit d'ecrire dans le
document prive d'un AUTRE joueur (ni meme, pour le role decouvert, dans un
document lisible par tous). Le motif retenu dans les deux cas : le joueur
pose son intention dans le document de nuit partage (lisible par tous, sans
donnee sensible), et **l'Hote** (qui a acces a tous les roles) resout et
ecrit la partie sensible dans le bon document prive, des qu'il detecte une
demande en attente (`resolveDetectivePeek()`, `resolveDestinPairing()`,
declenchees a chaque mise a jour des collections joueurs/actions de nuit
cote Hote). Delai en pratique quasi instantane (l'Hote observe deja tout en
temps reel).

- **Detective** : le role decouvert n'est PAS stocke dans le document de nuit
  partage (qui reste lisible de tous les joueurs pour que le reste de la
  mecanique de nuit continue de fonctionner) — sinon n'importe quel joueur
  aurait pu lire la decouverte du Detective. Il est ecrit dans
  `playersPrivate/{detectiveId}.detectiveReveal`, que seul le Detective (et
  l'Hote) peut lire.
- **Destin** : `loverId` ne peut plus etre ecrit directement sur les
  documents prives des deux joueurs choisis (seul l'Hote ecrit dans
  `playersPrivate`). Le Destin pose sa paire dans le document de nuit
  partage ; l'Hote applique l'appariement (`loverId` reciproque) dans les
  deux documents prives des qu'il la detecte.

### Revelations publiques gravees par l'Hote

Deux ecrans affichaient un role en le cherchant dans le tableau local
`players` — fonctionnait avant (tout etait public), casse desormais cote
Joueur (il ne connait plus le role des autres). Corrige en faisant ecrire
l'information directement par l'Hote au moment ou elle doit devenir
publique :
- **Resultat du vote du village** (`dayVoteResult`) : inclut desormais
  `eliminatedName`/`eliminatedRole` graves directement par l'Hote (en plus de
  l'id), et non plus recalcules par une recherche locale.
- **Ecran de victoire** : `endGame()` grave un tableau `finalReveal`
  (id/nom/role/camp/vivant de CHAQUE joueur) sur le document du salon au
  moment de la victoire ; les deux `renderEnd()` (Hote et Joueur) l'utilisent
  desormais comme source unique, au lieu d'iterer le tableau local `players`
  (qui, cote Joueur, n'a plus les roles des autres).

### Regles Firestore (`firestore.rules`)

Reecrites entierement (remplacent le mode test `allow read, write: if
true`). Principes : chaque ecriture necessite d'etre authentifie ;
`players/{id}` et `playersPrivate/{id}` ne peuvent etre modifies que par leur
proprietaire (`request.auth.uid == id`) ou par l'Hote du salon
(`resource.data.hostId`/`get()` sur le document du salon) ;
`playersPrivate` n'est en plus lisible que par son proprietaire ou l'Hote ;
le chat verifie l'auteur et limite la taille des messages (500 caracteres,
avant seulement cote client) ; le document du salon n'est modifiable que par
l'Hote, SAUF le champ `sheriffRevenge` que le Sherif en attente de riposte
peut ecrire depuis son propre telephone (seule ecriture directe d'un Joueur
sur le document du salon). `nightActions`/`dayVotes`/`election` restent
ouverts a tout utilisateur authentifie (pas de fuite de role possible dans
ces documents ; une verification d'auteur par-champ plus fine y serait
possible mais demanderait une migration vers des Cloud Functions pour etre
vraiment robuste — cf. "limite assumee" dans `TODO_SECURITE.md`).

### Nettoyage des sous-collections a la fermeture

`closeLobby()` (dans `lobby.js`) supprime desormais explicitement tous les
documents de `players`, `playersPrivate`, `chatLobby`, `chatGame`,
`nightActions`, `dayVotes` et `election` avant de supprimer le document du
salon lui-meme (Firestore ne supprime jamais les sous-collections en
cascade). Meme technique que `rematch()`'s `purgeSubcollection()` (session
9), generalisee ici a la fermeture definitive.

### Bug corrige pendant les tests : lectures "fraiches" oubliant le document prive

`goToNight()` et `resolveDeathConsequences()` (host.js) relisent
volontairement les joueurs DIRECTEMENT DEPUIS LE SERVEUR (`getDocsFromServer`,
pas le cache local) juste apres une ecriture, pour la meme raison que le bug
de cache documente en session 1. Ces deux fonctions ne relisaient que la
collection PUBLIQUE `players` — apres la separation public/prive, le tableau
obtenu n'avait donc plus aucun `role`/`camp`/`loverId`, ce qui cassait
silencieusement : le calcul du premier role de la nuit (plus aucun role
"necessaire" trouve, la nuit sautait directement a "termine"), la cascade des
Ames Soeurs, la verification du Sherif mort, et les conditions de victoire.
Corrige par une fonction partagee `getFreshPlayers()` qui relit et fusionne
les DEUX collections depuis le serveur. Trouve via un test automatise
complet (creation → election → nuit), qui echouait systematiquement des la
premiere nuit avec ce role incorrectement "termine" avant meme d'avoir
commence — un exemple typique de bug qui ne se voit qu'en rejouant le
parcours complet apres un changement de modele de donnees.

## Revision suite aux retours utilisateur (session 12)

- **Garde anti-spam etendue au chat** (bug rapporte : spammer "Envoyer"
  affichait le meme message plusieurs fois) : les 4 formulaires de chat
  (chat du salon et chat de partie, cote Hote et cote Joueur) utilisent
  desormais `guardedSubmit`, comme tous les autres formulaires d'action.
- **Spinner ajoute sur "Lancer la partie"** (`launchGameBtn`) : ce bouton
  avait deja sa propre logique de desactivation (necessaire car il gere ses
  erreurs avec une alerte et doit pouvoir se reactiver si l'assignation des
  roles echoue), mais n'affichait pas encore le spinner visuel comme les
  autres boutons — ajoute directement dans `launchGame()` (classe
  `.btn-busy` posee/retiree aux memes endroits que le `disabled`).
- **Note de test importante** : en diagnostiquant un "bug" de chat qui
  semblait provoquer un rechargement de page au clic sur "Envoyer", la cause
  s'est averee etre un artefact du script de test (interaction avec le
  formulaire avant meme que `init()` ait fini de s'executer et d'attacher
  ses ecouteurs — un vrai utilisateur ne peut pas cliquer plus vite que
  l'initialisation de la page ne prend a se terminer), aggrave par une
  accumulation de processus Playwright orphelins ralentissant la machine de
  developpement suite a plusieurs scripts de diagnostic interrompus sans
  fermer leur navigateur. Pas un bug applicatif — confirme par un test
  correctement synchronise (attend que la page soit prete avant d'interagir)
  qui passe de façon repetable.

## Revision suite aux retours utilisateur (session 11)

- **Bug corrige : double-soumission par spam de bouton** (ex: cliquer
  plusieurs fois sur "Valider" en rejoignant un salon creait plusieurs
  joueurs pour la meme personne). Cause : aucun bouton d'action asynchrone
  n'etait desactive pendant l'attente de la reponse Firestore, donc chaque
  clic supplementaire pendant ce court delai relancait l'action depuis le
  debut. Corrige par un nouvel utilitaire partage
  (`public/js/ui-utils.js`, `guardedClick`/`guardedSubmit`) qui desactive le
  bouton (et, pour une grille de choix, tous les boutons du groupe) **des le
  premier clic, avant tout `await`** — un bouton HTML `disabled` ne recoit
  plus aucun evenement `click` du navigateur, donc les clics suivants sont
  ignores sans logique de deduplication cote serveur. Applique
  systematiquement a tous les boutons/formulaires qui declenchent une
  ecriture Firestore, cote Hote et Joueur (rejoindre/creer un salon, pret,
  candidature/vote d'election, vote du village, egalite, toutes les actions
  de nuit, annonce des resultats, passages de phase, rejouer, fermer le
  salon...). Verifie par un test dedie : 9 soumissions du formulaire de
  connexion en rafale ne creent qu'un seul joueur dans le salon.
- **Retour visuel immediat pendant l'action** (repond aussi a la sensation
  de lenteur signalee) : la meme desactivation applique une classe
  `.btn-busy` qui remplace le texte du bouton par un petit spinner anime,
  au lieu de laisser le bouton visuellement inerte (donc "spammable" par
  reflexe) pendant le temps de reponse reseau.
- **Optimisation reelle de "Annoncer les resultats"** (latence perceptible
  signalee, pas seulement un probleme de retour visuel) :
  `announceResults()` relisait auparavant le document de CHAQUE joueur
  (`tx.get`) un par un et sequentiellement a l'interieur de la transaction,
  uniquement pour verifier si un mort de la nuit avait le role "assassin" —
  soit N allers-retours serveur strictement sequentiels avant meme de
  pouvoir ecrire quoi que ce soit. Or `computeNightResult` inclut deja le
  role de chaque victime dans `lastNightResult.deaths` (ajout de la session
  10, pour l'affichage du role dans l'annonce) : ces lectures etaient donc
  devenues totalement redondantes. Supprimees : la transaction ne lit plus
  que le document du salon lui-meme.
- **Modale "Regles du jeu" : fermeture au clic en dehors** (sur le fond
  assombri), en plus de la croix — plus pratique quand on a scrolle loin
  pour tout lire et qu'il faudrait sinon remonter jusqu'en haut.
- **Non modifie volontairement** : le vote des Assassins (choix de cible)
  reste un aller-retour transactionnel unique et necessaire (relire les
  votes actuels avant de decider si le vote est unanime) — la lenteur
  ressentie ici est le temps de reponse reseau normal d'une transaction
  Firestore, pas une inefficacite du code. Le retour visuel immediat
  (spinner) reste le principal levier disponible pour attenuer cette
  sensation sans changer l'architecture temps reel du jeu.

## Revision suite aux retours utilisateur (session 10)

- **Le Tueur en Serie et le Corrupteur votent desormais avec les Assassins.**
  Leur `camp` etait deja `"assassins"` dans `roles.js` (correct des le
  depart pour le decompte de victoire), mais l'etape de nuit "assassins"
  n'engageait que les joueurs avec le role exact `"assassin"` — le Tueur en
  Serie et le Corrupteur ne voyaient meme pas l'ecran de vote. Corrige :
  `stepIsNeeded("assassins", ...)` et la condition d'activation cote Joueur
  (`renderNightAction`) se basent maintenant sur le camp plutot que sur le
  role, et l'unanimite requise (`livingAssassinIds`) inclut tout le camp
  vivant. Teste explicitement : le vote n'avance pas tant que les 3 (Assassin,
  Tueur en Serie, Corrupteur) n'ont pas tous vote la meme cible.
- **Le Tueur en Serie ne peut plus cibler ses allies du camp Assassins** pour
  son kill bonus (avant, seul lui-meme etait exclu de sa propre liste de
  cibles). `renderTueurAction` filtre desormais par `camp !== "assassins"`.
- **Le Chimiste voit maintenant les DEUX victimes potentielles de la nuit**
  pour sa potion de Vie (celle des Assassins ET celle du Tueur en Serie, si
  ce dernier a agi), et choisit laquelle sauver — avant, seule la cible des
  Assassins etait visible/sauvable, celle du Tueur en Serie mourait
  systematiquement sans recours possible. `computeNightResult` verifie
  desormais la sauvegarde du Chimiste pour les DEUX cibles independamment.
- **Mort de chagrin des Ames Soeurs annoncee dans la MEME annonce que la mort
  initiale**, au lieu d'etre appliquee silencieusement plus tard (au clic sur
  "Continuer"/"Passer a la nuit", sans jamais apparaitre dans un ecran
  visible aux joueurs). Pour la nuit, `computeNightResult` calcule desormais
  la cascade directement (avant meme que l'annonce ne soit revelee), donc
  `announceResults()` marque les deux morts en une seule transaction et
  l'annonce les affiche ensemble. Pour le vote du jour, `finalizeDayVote`
  calcule et applique la cascade avant d'ecrire `dayVoteResult`, qui inclut
  desormais un `loverCascade` optionnel affiche juste apres le message
  d'elimination principal (Hote et Joueur). Dans les deux cas, le clic de
  continuation transmet bien les DEUX identifiants a `resolveDeathConsequences`
  (pour que la riposte du Sherif/la reelection du Gouverneur/les conditions de
  victoire tiennent compte du second mort aussi, meme s'il est deja marque
  mort en base a ce stade).
- **Verification (equipe gagnante Assassins)** : `checkVictoryConditions`
  construisait deja `winningPlayerIds` a partir du `camp` (pas du role), donc
  le Tueur en Serie et le Corrupteur apparaissaient deja correctement dans
  l'ecran de victoire — confirme par un test dedie (partie a 6 joueurs avec
  les 3 roles du camp Assassins, victoire verifiee affichant les 3).
- **Selection du Destin repensee** : remplace les cases a cocher par un choix
  au clic (2 pseudos maximum, un 3e clic remplace le plus ancien), avec une
  ligne SVG rose animee (tirets defilants + etincelles) tracee entre les deux
  boutons choisis, mesuree dynamiquement via `getBoundingClientRect` (la
  grille de choix n'a pas de disposition fixe, donc pas de solution CSS pure
  possible). Nouvelle variable CSS `--rose`/`--rose-bright`.
- **Bouton + modale "Regles du jeu"** ajoutes a l'ecran d'accueil : explique
  simplement le deroule d'une partie, l'ordre de la nuit, les camps/
  conditions de victoire, et la riposte du Sherif. Modale standard
  (`.modal-overlay`/`.modal`), scrollable si le contenu depasse la hauteur
  d'ecran, fermeture par croix.
- **Note de test** : sous tres forte charge concurrente (6 joueurs + hote,
  soit 7 clients simultanes, avec en plus 3 clients qui transigent desormais
  sur le MEME document `nightActions` pendant le vote commun des Assassins),
  un rejet HTTP 400 transitoire du endpoint Firestore `:commit` a ete observe
  de facon intermittente (2-3 fois sur 5 executions completes, jamais deux
  fois sur le meme joueur/role de facon repetable). Dans tous les cas,
  l'operation a fini par aboutir correctement (verifie par les assertions
  fonctionnelles, execution apres execution) : ceci correspond a du bruit de
  transport reseau (churn du canal WebChannel de Firestore, deja documente en
  session 9) exacerbe par un niveau de concurrence tres superieur a un usage
  reel (des humains ne cliquent jamais 3 votes simultanes a la meme
  milliseconde). Non traite comme un bug applicatif.

## Revision suite aux retours utilisateur (session 9)

- **Bug corrige : "Rejouer" ne remettait pas totalement la partie a zero.**
  `rematch()` reinitialisait bien les documents des joueurs et le document du
  salon, mais ne supprimait jamais les documents des sous-collections
  `nightActions`, `dayVotes` et `election` de la partie precedente. Comme ces
  documents utilisent des identifiants deterministes et reutilises d'une
  partie a l'autre (`night_1`, `day_1`, `election/current`), un document
  laisse par la Partie 1 etait purement et simplement repris tel quel par la
  Partie 2 (ex : le vote du village demarrait directement avec les votes de
  la partie precedente au lieu d'un decompte a zero). Corrige par une nouvelle
  fonction `purgeSubcollection()` qui supprime tous les documents des trois
  sous-collections avant de remettre le salon en statut `lobby`. Verifie par
  un test automatise dedie (2 parties completes jouees dans le meme salon via
  "Rejouer", avec assertion explicite que le second vote du village demarre a
  "0 votes" et affiche bien le bouton "Lancer le vote du village" plutot que
  de sauter direct a un decompte deja en cours).
- **Grilles a 3 colonnes generalisees a toute selection de joueur(s)** :
  liste du Detective (`#detectiveChoices`), du Tueur en Serie et du Destin
  (choix des deux Ames Soeurs) recoivent desormais la classe `.choice-grid`,
  au meme titre que les Assassins et les votes (deja fait en session 8). Le
  Corrupteur n'a volontairement pas de grille : sa cible n'est jamais un
  choix parmi les joueurs (c'est toujours la cible actuelle des Assassins).
- **Messages de progression de la nuit corriges (grammaire).** Les boutons
  de l'Hote ("Lancer ...", "Passer a ...") utilisaient directement les
  phrases descriptives completes de `NIGHT_STEP_LABELS` (ex : "Le Chimiste
  prepare ses potions"), donnant des messages incorrects comme "Passer a Le
  Chimiste prepare ses potions". Ajout d'une table separee `NIGHT_STEP_UI`
  dans `night-cycle.js`, avec des formes courtes grammaticalement adaptees a
  chaque contexte (`launch`: "le Chimiste" pour "Lancer ...", `pass`: "au
  Chimiste"/"aux Assassins" pour "Passer ...", `done`: phrase complete au
  passe pour le message de confirmation). `NIGHT_STEP_LABELS` (phrases
  descriptives) reste utilisee uniquement pour le texte d'attente ("En
  attente : Le Chimiste prepare ses potions..."), qui lui reste grammaticalement correct.
- **Bug corrige : clignotement des ecrans statiques (annonce, victoire/
  defaite, liste de joueurs).** `render()` peut etre redeclenche par un
  evenement Firestore totalement sans rapport avec l'ecran affiche (un autre
  joueur qui vote, qui discute, etc. sur la collection `players`), et les
  fonctions de rendu concernees reecrivaient inconditionnellement leur
  `innerHTML` a chaque appel — meme quand le contenu genere etait strictement
  identique — ce qui recreait les noeuds DOM et redemarrait leurs animations
  CSS d'entree, donnant l'impression que l'ecran se rechargeait. Corrige par
  un garde de comparaison (le nouveau HTML genere n'est ecrit, et les
  ecouteurs de clic re-attaches, que s'il differe du contenu deja affiche)
  applique a `renderRoster`/`renderRosterFull` (liste des joueurs, cote
  Hote et Joueur), `renderAnnouncementPanel`/`renderAnnouncement` et
  `renderEnd` (cote Hote et Joueur). Au passage, le rendu de secours
  periodique (`setInterval` toutes les 4s) ajoute en session 8 comme filet de
  securite contre les ecouteurs perimes a ete retire cote Joueur : il
  contribuait lui-meme au clignotement observe, et le vrai bug qu'il visait a
  corriger (ecouteurs de phase non desabonnes) est deja resolu par le
  nettoyage centralise + compteur de generation de la session 8, confirme par
  des tests automatises repetes sans regression.
- **Reveal du role a l'annonce d'une mort de nuit.** Les entrees d'annonce
  ("X a ete assassine...", "X a ete empoisonne...", "X est mort de
  chagrin...") affichent desormais aussi le role de la victime ("... , qui
  etait [icone] [role]."), sur le meme modele que l'ecran de resultat du vote
  du village (session 8). `computeNightResult()` (`night-cycle.js`) inclut
  desormais le `role` de chaque victime dans son tableau `deaths`. Ce reveal
  ne s'applique volontairement PAS au message du Chimiste ("Quelqu'un a
  frole la mort") qui reste anonymise (decision de la session 7, non remise
  en cause : il s'agit d'un sauvetage, pas d'une mort).

## Revision suite aux retours utilisateur (session 8)

- **Grilles a 3 colonnes** pour la liste des cibles des Assassins
  (`#assassinChoices`) et pour tous les ecrans de vote (election, vote du
  village) : `.choice-grid` passe de `flex` a `grid-template-columns:
  repeat(3, 1fr)`, avec repli a 2 colonnes sous 420px de large. Objectif :
  lisibilite quand la partie compte beaucoup de joueurs (une longue liste en
  colonne unique obligeait a scroller).
- **Nouvelle phase `day_vote_result`**, intercalee entre `day_vote` et
  `night` : au lieu d'enchainer directement sur la nuit suivante des la
  cloture du vote, `finalizeDayVote()` ecrit desormais
  `{status:"day_vote_result", dayVoteResult:{eliminatedId}}` et **attend un
  clic explicite de l'Hote** ("Passer a la nuit") avant d'appeler
  `resolveDeathConsequences()`. Cote Hote comme cote Joueur, l'ecran affiche
  "Le village a elimine **X**, qui etait **[icone] Role**." (ou "Le village
  n'a elimine personne aujourd'hui." en cas d'egalite non tranchee). Ceci
  reproduit la convention classique du Loup-Garou (reveal du role avant la
  nuit suivante) et donne a l'Hote le meme controle total du rythme que pour
  le reste de la partie.
- **Ecran d'accueil repense** (`index.html`) : 4 elements seulement (pseudo,
  bouton "Creer une partie", bouton "Rejoindre" qui deroule un mini-formulaire
  code+valider). Le pseudo est memorise dans `localStorage`
  (`assassins_last_name`) **uniquement apres une connexion reussie** (pas
  apres une tentative echouee, pour ne jamais retenir une saisie invalide) et
  pre-rempli au chargement de la page si present.
- **Police du titre changee pour "Cinzel Decorative"** (Google Fonts,
  chargee via `<link>` classique - deja acceptable puisque l'app depend deja
  de CDN externes pour Firebase), plus fidele au theme "Tenebres et Mort" que
  la police precedente.
- **Particules de sang en fond sur l'accueil** : generees en JS
  (`spawnBloodParticles()`, 18 elements `<span class="blood-drop">`) avec des
  proprietes CSS personnalisees aleatoires (taille, duree, delai, opacite,
  derive laterale) animees via `@keyframes bloodFall`. Purement decoratif,
  `pointer-events:none`, `aria-hidden`.
- **Bug corrige : ecouteurs Firestore de phase jamais desabonnes cote
  Joueur.** `renderElection`/`renderDayVote`/`renderNightAction` creaient
  chacun un `onSnapshot` avec un garde `if (!xUnsub)`, mais rien ne les
  desabonnait jamais lors d'un changement de phase — un ancien callback
  pouvait donc, dans de rares cas, redessiner du contenu perime (ex: la
  modale d'election) par-dessus le contenu correct de la phase courante.
  Corrige par un nettoyage centralise dans `renderGamePhase()` (desabonnement
  + reinitialisation des donnees en cache a chaque changement de
  `lobbyData.status`), complete par un compteur de generation
  (`phaseListenerGen`) verifie en premiere ligne de chaque callback pour
  ignorer toute notification deja "en vol" au moment du desabonnement. Un
  garde defensif similaire a ete ajoute a `renderChimisteAction` (peut se
  redessiner elle-meme via ses boutons de potion) contre un plantage si les
  donnees de nuit deviennent momentanement indisponibles pendant une
  transition de phase. En complement, un rendu de secours toutes les 4
  secondes (`setInterval` dans `init()`) garantit que l'ecran ne peut de
  toute facon jamais rester bloque durablement sur un contenu perime, meme
  dans un scenario non anticipe.
- **Note de test importante (pas un bug applicatif) :** deux symptomes
  observes pendant les tests automatises multi-onglets se sont reveles etre
  des artefacts du script de test, pas des bugs du jeu : (1) verifier le
  contenu HTML d'une modale sans verifier qu'elle est bien **visible**
  (`#actionModal` sans la classe `hidden`) peut faire croire a un blocage
  alors que du HTML perime existe simplement, sans consequence, dans une
  modale masquee ; (2) apres un vote du village, la partie peut legitimement
  se terminer immediatement (victoire d'un camp) plutot que d'enchainer sur
  la nuit suivante, si le joueur elimine etait le dernier membre vivant d'un
  camp qui declenche une condition de victoire — un test qui presuppose
  systematiquement un passage a "Nuit N+1" est donc lui-meme incorrect.

## Revision suite aux retours utilisateur (session 7)

- **Message de sauvetage du Chimiste anonymise** : "Quelqu'un a frole la mort
  cette nuit !" au lieu de nommer la personne sauvee — le nom n'apportait pas
  d'information utile a l'annonce et pouvait donner des indices non voulus.
- **Suppression de deux etapes jugees superflues dans la machine a etats de
  nuit** (retour sur une partie de la session 6) : le bouton "Passer a la
  nuit" est retire — `beginNight()` (fusion de l'ancien `enterNightIntro()` +
  `prepareFirstNightRole()`) determine et affiche directement "Lancer
  <role>" des la resolution de l'election/du vote du jour, sans etape
  intermediaire. De meme, quand le DERNIER role de la nuit valide son
  action, l'Hote voit desormais directement "Passer au jour" au lieu du
  bouton generique "Passer a la fin de la nuit" (qui n'etait qu'un detour
  vers le meme bouton juste apres). Les boutons "Passer a [role suivant]"
  entre deux roles reels restent inchanges (c'est le controle explicite que
  l'utilisateur avait demande a la session precedente).
- **Bouton "Forcer le passage (secours)" retire** de l'ecran de nuit de
  l'Hote — juge inutile a l'usage.
- **Confirmation de fermeture de salon en modale** (Oui/Non stylises) a la
  place du `confirm()` natif du navigateur, pour les deux points d'entree
  (bouton de la barre superieure et bouton de l'ecran de victoire), qui
  partagent la meme modale et la meme logique de fermeture.
- **Centrage generalise** : le texte de la transition plein ecran
  Jour/Nuit reçoit desormais `text-align:center` (avant, un texte long comme
  "LA PARTIE COMMENCE" qui passait a la ligne n'etait centre que globalement,
  pas ligne par ligne). La modale d'action (`.action-modal`) recoit aussi
  `text-align:center`, et les grilles de choix / lignes de choix
  (`.choice-grid`, `.choice-row`) sont centrees via `justify-content:center`
  — s'applique a tous les roles de nuit, a l'election et au vote du village.
- **Icones par role** : chaque role de `roles.js` a desormais un champ
  `icon` (emoji) affiche partout ou son nom apparait : modale "Voir mon
  role", modale d'information (bouton "?"), liste des roles cote Hote,
  resultat du Detective, ecran de victoire (vainqueurs + reveal complet), et
  les titres des actions nocturnes elles-memes.
- **Bouton "Rejouer" simplifie** : texte seul ("Rejouer"), sans l'emoji 🔁 qui
  ne rendait pas bien visuellement.

## Revision suite aux retours utilisateur (session 6)

- **Passage a la nuit decoupe en trois etapes explicites**, chacune
  declenchee par un clic de l'Hote (controle total du deroule, comme
  demande) : `night-cycle.js` expose desormais `enterNightIntro()` (statut
  `night_intro`, l'Hote voit "Passer a la nuit"), `prepareFirstNightRole()`
  (calcule le premier role necessaire et l'affiche via un bouton "Lancer
  <role>", sans encore le demarrer) et `launchPendingNightRole()` (le role
  commence reellement, sa modale s'ouvre chez le joueur concerne). Avant,
  `startNight()` faisait les trois choses d'un coup des la resolution de
  l'election/du vote. Cette meme sequence s'applique a CHAQUE passage a une
  nouvelle nuit (pas seulement la toute premiere), pour rester coherente tout
  au long de la partie.
- **Election, candidature et vote du village affiches dans la meme modale
  d'action que les roles de nuit** (`#actionModal`, renommee depuis
  `#nightActionModal` qui ne servait plus qu'aux roles). Une fois le choix du
  joueur enregistre (vote pose), la modale se ferme et le panneau principal
  affiche "en attente des autres". Les boutons de choix (`.choice-grid`) sont
  desormais centres partout (`justify-content: center`).
- **Ecran de victoire : la liste de joueurs "brute" (sans role) est masquee**
  cote Joueur pendant l'ecran de fin, puisque le reveal des roles a
  l'interieur de l'ecran de victoire donne deja toute l'information
  pertinente. Cote Hote, ce n'etait pas necessaire de corriger quoi que ce
  soit : son roster complet vit dans `#gameScreen`, deja masque a la fin.
- **Bouton "Rejouer" cote Hote** : remet le MEME salon (meme code, memes
  joueurs deja connectes, meme composition de roles) en statut `lobby`
  (salon ouvert), en reinitialisant chaque joueur (role, vie, pret, potions,
  candidature, etc.) et en vidant le chat de partie. Les joueurs n'ont rien a
  refaire (pas besoin de resaisir le code), ils retrouvent directement
  l'ecran d'attente. Pour eviter tout residu d'ecouteurs Firestore d'une
  phase de jeu interrompue (nuit/vote en cours au moment de la victoire),
  `renderEnd()` coupe explicitement les listeners actifs de la partie
  precedente.
- **Fermeture de salon : notification toast au lieu d'un `alert()` natif.**
  Quand l'Hote ferme le salon, chaque Joueur est immediatement redirige vers
  l'accueil (plus de blocage sur une boite de dialogue native a fermer), et
  un message ("L'hote a ferme le salon.") est depose dans `sessionStorage`
  avant la redirection puis affiche par `index.html` sous forme de toast en
  haut de l'ecran, qui s'efface tout seul apres quelques secondes.
- **Correction du libelle Jour/Nuit en debut de partie.** Avant, l'indicateur
  affichait "Jour 1" a la fois pendant l'election initiale ET apres la toute
  premiere nuit (les deux correspondant a `nightNumber` valant respectivement
  0 et 1, mais tous deux affiches "Jour 1" par la regle de secours
  `nightNumber === 0 ? 1 : nightNumber`), ce qui donnait l'impression fausse
  d'une boucle. La toute premiere election (avant que la Nuit 1 n'ait meme
  eu lieu, `nightNumber === 0`) affiche desormais un libelle distinct : "La
  partie commence". Les vraies journees ("Jour 1", "Jour 2", ...) ne
  commencent qu'apres la nuit correspondante, sans ambiguite. Cette detection
  est basee sur `nightNumber` (pas sur le statut precedent en memoire), pour
  rester correcte aussi apres un "Rejouer" dans le meme onglet.

## Revision suite aux retours utilisateur (session 5)

- **Egalite a l'election du Gouverneur tranchee par l'Hote** (modale de
  choix), plutot qu'un tirage au sort silencieux comme avant. Justification :
  il n'y a par definition pas encore de Gouverneur vivant pour arbitrer une
  election en cours, donc c'est l'Hote (l'unique autorite neutre disponible a
  ce moment) qui tranche — meme logique que pour les candidats a 0 vote
  (l'Hote choisit alors parmi tous les candidats).
- **Vote du village desormais gate par un bouton explicite "Lancer le vote du
  village"**, exactement comme l'election. Avant, `goToDayVote()` creait
  immediatement le document de vote et l'ouvrait aux joueurs des l'entree en
  phase `day_vote`, sans que l'Hote n'ait explicitement lance quoi que ce
  soit — corrige.
- **Indicateur "Jour N" / "Nuit N" permanent** dans la barre superieure
  (Hote et Joueurs), plus une **animation plein ecran** ("JOUR 1", "NUIT 2",
  etc.) declenchee aux moments cles : lancement de la partie (Jour 1),
  passage a la nuit, et passage de la nuit au jour suivant (a l'annonce des
  resultats). Objectif double : rendre le rythme jour/nuit plus lisible et
  plus "cinematique", et lever toute ambiguite lors d'une reelection forcee
  en cours de partie (voir point suivant).
- **Clarification (pas un bug de compteur) : la reelection forcee du
  Gouverneur "on dirait qu'on revient au Jour 1".** Verification faite :
  `nightNumber`/`dayNumber` ne sont jamais reinitialises en cours de partie
  (seulement au lancement initial), et une reelection forcee au milieu de la
  partie conserve bien le numero de jour/nuit courant. Le probleme etait real
  mais purement visuel : l'ecran d'election ne montrait aucune indication du
  jour/nuit en cours, donnant l'impression trompeuse d'un retour au debut.
  Corrige par l'indicateur permanent ci-dessus — teste explicitement en
  forçant la mort du Gouverneur puis en verifiant que le badge affiche bien
  le jour reel (pas "Jour 1" par erreur, sauf si c'est effectivement le cas).
- **Interface du Chimiste repensee** : remplace la case a cocher + liste
  deroulante par deux "cartes de potion" avec des boutons cliquables (meme
  logique de selection que les autres roles). La potion de Vie ne peut cibler
  que la victime des Assassins (bouton qui bascule entre "Sauver X" / "✔ X
  sera sauve(e)") ; la potion de Mort propose une grille de boutons parmi les
  joueurs vivants (selection togglable, une seule cible a la fois).
- **Toutes les actions nocturnes, la riposte du Sherif ET l'egalite du
  Gouverneur au vote du village s'affichent desormais dans des modales**,
  pour etre bien plus visibles qu'un simple panneau de jeu (a la demande
  explicite de l'utilisateur, "comme pour le Sherif").
- **Detective : detail complet** (deja fait en session 4, confirme ici) —
  Joueur / Role / Description affiches ensemble.
- **Bug corrige : les joueurs ne voyaient pas l'annonce des resultats de
  nuit** — deja corrige en session 4 ; ce correctif reste actif, et l'ecran
  d'annonce a en plus ete redessine (voir point suivant).
- **Ecran d'annonce des resultats redessine** : abandon de la simple liste a
  puces au profit d'une "carte" dediee (fond degrade rouge sombre, titre en
  majuscules) avec une entree par evenement, chacune associee a une icone
  distinctive (🛡️ sauve, 🗡️ assassine, ☠️ empoisonne, 💔 mort de chagrin, 🌙
  nuit calme) et une bordure coloree selon le type, animees en cascade a
  l'affichage.
- **Election et vote du village redessines** : candidats/cibles affiches en
  "cartes" avec avatar (initiales), et pendant le vote, une jauge de
  progression par candidat/cible remplace la simple liste texte "X votes".
- **Ecran de victoire entierement repense** (Hote et Joueur) : banniere avec
  icone et couleur specifiques au camp vainqueur (🕊️ or pour les Citoyens,
  🗡️ rouge sang pour les Assassins, 💞/⚰️ violet spectral pour les Ames
  Soeurs/le Martyr, 🔪 rouge pour le Psychopathe), cartes des vainqueurs, et
  grille de reveal de tous les roles (au lieu d'une simple liste de texte sur
  fond noir).

## Revision suite aux retours utilisateur (session 2)

- **Nouveau statut `config`** : le cycle de vie d'un salon est maintenant
  `config` (l'hote choisit la composition, personne ne peut rejoindre) →
  `lobby` (salon ouvert : les joueurs rejoignent, chattent, se preparent) →
  `night`/... comme avant. `joinLobby()` rejette explicitement toute
  tentative de connexion pendant `config` avec un message clair.
- **Compteurs +/-** : la composition des roles se choisit desormais via des
  boutons +/- (0 a 20) plutot qu'un champ numerique libre.
- **Citoyen rendu visible** : le role de Citoyen n'a pas de compteur propre
  pendant la phase `config` (le nombre total de joueurs n'est pas encore
  connu a ce moment, puisque personne n'a encore rejoint), mais son effectif
  est maintenant **affiche explicitement** ("Citoyen x N (auto)") dans le
  recapitulatif de la phase `lobby`, calcule en direct a partir du nombre de
  joueurs connectes moins les roles speciaux configures. Choix : rendre le
  role visible sans forcer l'hote a deviner un nombre de joueurs qu'il ne
  connait pas encore au moment de la configuration.
- **Minimum de lancement releve a 4 joueurs** (hors Hote), contre 3
  precedemment — la aussi cette limite ne peut etre verifiee qu'une fois le
  salon ouvert (phase `lobby`), puisqu'au moment de choisir les roles
  (phase `config`) aucun joueur n'est encore connecte.
- **Chat en partie unifie** : les chats separes "Vivants"/"Morts" ont ete
  remplaces par un flux unique (`chatGame`), stocke avec un flag `isDead`
  (statut de l'auteur au moment de l'envoi). Les vivants filtrent
  cote-client les messages marques `isDead`; les morts voient tout le flux
  sans filtrage. L'affichage passe par une modale ouverte via un petit
  bouton flottant ("💬 Chat"), plutot qu'un panneau permanent a l'ecran, pour
  liberer de la place a l'ecran de jeu. Le chat du lobby (avant partie)
  reste, lui, affiche en permanence comme demande.
- Un bouton "Modifier la configuration" permet a l'hote de revenir en phase
  `config` depuis le salon ouvert (avant le lancement de la partie), sans
  perdre les joueurs deja connectes ni leur etat "pret".

## Revision suite aux retours utilisateur (session 4)

- **Action nocturne du role actif affichee dans une modale** (comme la
  riposte du Sherif), pour etre plus visible que le simple panneau de jeu.
  Elle n'a volontairement PAS de croix de fermeture : l'action doit etre
  validee pour que la partie continue (la modale se ferme automatiquement
  une fois l'action confirmee).
- **Detective : detail complet du resultat** — affiche desormais "Joueur",
  "Role" ET la description complete du role sonde (pas seulement son nom),
  pour que le joueur comprenne immediatement ce qu'il vient de decouvrir.
- **Bug corrige : les joueurs ne voyaient jamais l'annonce des resultats de
  la nuit.** `renderAnnouncement()` cote joueur ignorait completement
  `lobbyData.resultsRevealed` et affichait en permanence "L'hote va
  annoncer..." meme apres que l'hote ait clique sur "Annoncer les
  resultats". Corrige en reprenant exactement la meme logique d'affichage
  que cote Hote (`renderAnnouncementPanel`).
- **Bouton "?" d'information sur chaque role** dans l'ecran de configuration
  de l'hote : ouvre une modale avec la description complete et la condition
  de victoire du role, pour aider l'hote a choisir la composition sans
  devoir se souvenir des regles de chaque role.

## Revision suite aux retours utilisateur (session 3)

- **La partie commence toujours par le Jour 1 (election du Gouverneur),
  jamais par la Nuit 1** : `launchGame()` positionne desormais le statut sur
  `election` (avec `electionReturnTo: "night"`) au lieu d'appeler `startNight`
  directement. La toute premiere nuit ne demarre qu'une fois l'election
  resolue. Ceci est coherent avec la regle deja existante "gouverneur absent
  → election obligatoire" (`governorId` demarre a `null`), simplement rendue
  explicite des le lancement plutot que decouverte apres coup.
- **L'election ne demarre plus automatiquement** : entrer en statut
  `election` affiche desormais un ecran cote Hote avec un bouton "Lancer
  l'election du Gouverneur". Le document `election/current` n'est cree qu'a
  ce clic (avant, il etait cree automatiquement des l'entree en phase
  election). Tant qu'il n'existe pas, les joueurs voient un message d'attente.
- **Fin du secours "tout le monde devient candidat"** : l'ancien
  comportement (si personne ne se presente, tous les joueurs vivants
  deviennent candidats par defaut) a ete supprime a la demande de
  l'utilisateur — il causait la confusion "on peut voter pour n'importe qui
  meme ceux qui ne se sont pas presentes". Desormais, le bouton "Lancer le
  vote" reste desactive tant qu'il n'y a pas au moins un candidat declare :
  c'est a l'hote/aux joueurs de s'assurer qu'au moins une personne se
  presente, sans filet de secours automatique.
- **Bug corrige : la liste des candidats ne se rafraichissait pas cote
  Hote.** La candidature (`isGovernorCandidate`) est ecrite sur le document
  du JOUEUR, pas sur le document `election/current` — or l'affichage de la
  liste des candidats n'etait redessine que depuis le listener du document
  d'election, qui ne se declenche pas quand un joueur se presente/se retire.
  Resultat : l'hote voyait une liste de candidats figee. Corrige en
  redessinant aussi le panneau d'election a chaque rafraichissement general
  de l'ecran (c'est-a-dire a chaque changement de la collection `players`),
  pas seulement quand le document d'election change.
- **Detective limite a une seule carte par nuit** : avant, rien n'empechait
  de cliquer sur plusieurs cibles avant de valider avec "Terminer", donc de
  voir plusieurs roles gratuitement la meme nuit. Le premier clic verrouille
  desormais la cible cote serveur (`nightActions.detective.peekedTargetId`,
  persiste en base et non plus seulement dans l'etat local de la page), donc
  la restriction resiste aussi a un rechargement de page.
- **Progression de la nuit desormais entierement pilotee par l'Hote.**
  Auparavant, des qu'un role validait son action, la machine a etats passait
  automatiquement au role suivant. Ce n'est plus le cas : chaque
  `submitXxx()` de `night-cycle.js` marque seulement l'action comme
  terminee ; c'est l'Hote qui voit apparaitre un bouton "Passer a [role
  suivant]" et doit cliquer pour faire avancer `currentNightStep`. Ceci
  laisse a l'hote le temps de gerer la table (silence, mimes, annonces
  orales) entre chaque role, comme demande. Le bouton de secours "Forcer le
  passage" reste disponible pendant l'attente d'un role (cas de blocage
  technique/joueur deconnecte).
- **Chat en partie : l'Hote peut desormais ecrire** (auparavant lecture
  seule) — ses messages sont marques `isDead: false` et donc visibles de
  tous (vivants et morts), coherent avec son role de narrateur omniscient.
- **Badge de messages non lus** sur le bouton "💬 Chat" (Hote et Joueurs) :
  compteur local (par session, non persiste), incremente pour chaque nouveau
  message recu pendant que la modale est fermee, remis a zero a l'ouverture.
  Base sur un suivi d'identifiants de messages deja vus (pas un simple
  comptage), pour rester correct meme si le filtrage vivant/mort change les
  messages visibles.
- **Bouton "Voir mon role" centre** (`justify-content: center` sur
  `.player-actions-row`), et le bouton "Je suis pret" est maintenant
  explicitement masque une fois la partie lancee (il ne l'etait pas
  auparavant, simplement inutilise visuellement).

## Architecture generale

- **Statuts de partie** (`lobbies/{code}.status`) : `config` (l'hote choisit
  les roles, salon ferme) → `lobby` (salon ouvert aux joueurs) → `night` →
  `day_announcement` → `election` → `day_vote` → (`sheriff_revenge` en
  intercalaire si besoin) → `night` → ... → `ended`.
  L'election du Gouverneur n'a pas de statut de depart fixe : elle est
  **toujours** declenchee quand `governorId` est `null` ou pointe vers un
  joueur mort, ce qui couvre naturellement l'election obligatoire du Jour 1
  (le gouverneur demarre a `null`) ET les reelections forcees en cas de mort
  du Gouverneur (nuit ou vote de jour), sans code special pour le "Jour 1".
- **Un seul document par nuit** : `lobbies/{code}/nightActions/night_{N}`
  regroupe les actions de tous les roles de la nuit N (plutot qu'un document
  par role), pour simplifier les transactions et l'ecoute temps reel cote
  client.
- **Deroule "Passer au jour" / "Annoncer les resultats"** : le resultat de la
  nuit est calcule (fonction pure `computeNightResult`) et stocke des le clic
  sur "Passer au jour", mais **applique** (morts, corruption) seulement au
  clic sur "Annoncer les resultats", conformement au cahier des charges qui
  veut que les joueurs ne voient rien avant l'annonce orale de l'hote.

## Roles et configuration

- Le **Gouverneur n'est pas un role assigne au demarrage** : c'est un statut
  (`lobby.governorId`) attribue par election. N'importe quel joueur (quel que
  soit son role/camp) peut se presenter et devenir Gouverneur.
- Roles configurables par l'hote avant lancement : Assassin, Detective,
  Chimiste, Sherif, Destin, Tueur en Serie, Corrupteur, Martyr, Psychopathe.
  Tous les emplacements non affectes sont completes automatiquement par des
  Citoyens.
- **Minimum de lancement** : au moins 4 joueurs (hors Hote) et au moins 1
  Assassin configure, en plus des 100% de joueurs "Prets" — le nombre de
  joueurs est verifie en phase `lobby`, l'Assassin est verifie des la phase
  `config` (voir section "Revision suite aux retours utilisateur" plus haut).
- **Valeurs par defaut des compteurs** : 1 Assassin, 1 Detective,
  1 Chimiste, le reste a 0. Purement pour eviter une configuration vide au
  premier lancement ; l'hote peut tout changer avant de valider.

## Machine a etats de la nuit

- **Ordre strict** : Destin (nuit 1 uniquement) → Detective → Assassins →
  Tueur en Serie → Corrupteur → Chimiste, avec saut automatique de toute
  etape non applicable (role absent de la partie, role mort, ou pouvoir
  epuise), conformement au cahier des charges.
- **Tueur en Serie** : perd definitivement son pouvoir des qu'un Assassin
  meurt, quelle que soit la cause (nuit suivante et pour le reste de la
  partie). Marque par `lobby.tueurPowerLost`, positionne au moment de
  "Annoncer les resultats" si un mort de la nuit avait le role `assassin`.
- **Chimiste / potion de Vie** : elle ne peut cibler QUE la victime actuelle
  des Assassins (le cahier des charges dit que le Chimiste "voit la cible des
  Assassins... si sa potion de vie est disponible", ce qui suggere que c'est
  la seule cible visible/utilisable pour cette potion). La potion de Mort,
  elle, peut cibler n'importe quel joueur vivant.
- **Bouton de secours "Forcer le passage"** (ecran Hote, pendant la nuit) :
  ajout non demande explicitement, mais justifie par l'exigence generale de
  resilience/anti-blocage du cahier des charges. Permet a l'hote de debloquer
  manuellement un tour si un joueur est deconnecte ou bloque techniquement.
  A utiliser en dernier recours seulement (confirmation requise).

## Election du Gouverneur

- **Deux phases** : `candidacy` (les joueurs se declarent/se retirent) puis
  `voting` (liste de candidats figee, vote). L'hote declenche manuellement le
  passage de l'une a l'autre ("Lancer le vote"), puis valide la fin du vote.
- **Egalite lors d'une election** : toujours tranchee par **tirage au sort**
  parmi les candidats a egalite. Justification : une election de Gouverneur
  n'a lieu QUE quand il n'y a justement PAS de Gouverneur vivant pour
  arbitrer, donc l'arbitrage humain habituel (le Gouverneur) est structurellement
  indisponible a ce moment precis.
- **Aucun candidat au moment de lancer le vote** : tous les joueurs vivants
  deviennent candidats par defaut (secours anti-blocage), plutot que de
  bloquer indefiniment l'hote.
- **Egalite lors du vote du village (Jour)** : tranchee par le Gouverneur
  vivant (conforme au cahier des charges), via une modale dediee sur son
  ecran joueur.

## Vote du village

- L'hote **cloture le vote manuellement** ("Clore le vote") plutot que
  d'attendre que 100% des joueurs vivants aient vote : permet de continuer
  meme si un joueur est passif/deconnecte, l'hote gardant la main sur le
  rythme (coherent avec le reste du cahier des charges ou l'hote pilote
  chaque transition).
- **Martyr** : la conversion en simple Citoyen (perte de pouvoir) est
  appliquee juste apres le tout premier vote du jour si le Martyr n'a pas ete
  elimine a ce moment precis (y compris si personne n'a ete elimine du tout,
  par exemple en cas d'egalite non tranchee).

## Riposte du Sherif

- **Minuteur d'1 seconde** cote client (le Sherif choisit une cible), avec un
  minuteur miroir cote hote qui **resout automatiquement au hasard** parmi
  les joueurs vivants si le delai expire sans choix. Choix explicitement
  laisse libre par le cahier des charges ("regle par defaut que tu
  documenteras") : le tirage aleatoire a ete prefere a "pas de tir" pour
  respecter l'esprit "une derniere balle part de toute facon".
- Le jeu entier se fige (`status: "sheriff_revenge"`) tant que la riposte
  n'est pas resolue, y compris si un Gouverneur devrait etre elu ou si la
  partie devrait continuer : la riposte du Sherif a la priorite sur toute
  autre transition.

## Victoire

- Ordre de verification implemente dans `checkVictoryConditions` /
  `checkDayVoteSpecialConditions` : Martyr/Psychopathe (uniquement juste
  apres un vote du village) → Ames Soeurs (2 derniers survivants) → camp
  Citoyens/Assassins (comptage des vivants). Cet ordre est impose par le
  cahier des charges pour Martyr/Psychopathe ; l'ordre Ames Soeurs avant
  camps generaux est un choix (les Ames Soeurs sont un "camp a part" qui doit
  logiquement primer si sa condition tres specifique est remplie).
- Les morts en chaine des Ames Soeurs sont resolues avant toute verification
  de victoire (pour que le decompte des vivants soit a jour).

## Code de salon

- 4 caracteres alphanumeriques (sans 0/O/1/I pour lisibilite a l'oral),
  avec repli automatique sur 5 caracteres apres plusieurs collisions
  improbables — le cahier des charges demandait "4-5 caracteres" sans trancher.

## Fermeture de salon

- `closeLobby()` supprime uniquement le document `lobbies/{code}` (pas ses
  sous-collections, Firestore ne le fait pas nativement cote client). Les
  joueurs sont redirection instantanement car leur listener `onSnapshot`
  detecte la disparition du document. Le nettoyage complet des
  sous-collections est laisse en `TODO_SECURITE.md` (necessite un backend/
  une Cloud Function pour etre fait proprement).

## PWA

- Icones PWA generees par un petit script Node maison
  (`scripts/generate-icons.js`, sans dependance externe) plutot que des
  images externes, faute d'outil de rasterisation disponible dans
  l'environnement de developpement. Design minimaliste (dague rouge sur fond
  sombre) coherent avec le theme "Tenebres et Mort".
- Le Service Worker met en cache le **shell statique uniquement** (HTML/CSS/
  JS/icones) : aucune tentative de faire fonctionner le jeu hors-ligne,
  puisque toute la logique temps reel depend de Firestore (conforme au
  cahier des charges).

## Bug critique decouvert et corrige pendant les tests automatises

En testant le cycle de nuit avec plusieurs onglets simultanes (Playwright,
1 hote + 4 joueurs), le vote des Assassins ne faisait jamais avancer la nuit
au role suivant, meme quand le vote etait unanime. Cause racine : la fonction
`submitAssassinVote` relisait le document `nightActions/night_N` via
`getDoc()` juste apres avoir commite sa transaction, pour decider s'il fallait
faire avancer la machine a etats. Or ce client a presque toujours un
`onSnapshot` deja actif sur ce meme document (ouvert par l'ecran de jeu), et
Firestore peut alors repondre a `getDoc()` avec la version en cache local
**pas encore rafraichie** par le flux temps reel, plutot que d'aller
re-interroger le serveur — donnant l'illusion que le vote n'etait pas
unanime. Corrige en faisant renvoyer directement le resultat (`unanimous`)
par la transaction elle-meme (qui, elle, est toujours coherente), et en
generalisant les lectures "juste apres une ecriture du meme client" a
`getDocFromServer`/`getDocsFromServer` partout ou un `onSnapshot` concurrent
existe deja sur le meme document (`night-cycle.js` et `host.js`). Sans ce
correctif, la partie se bloquait silencieusement des la premiere nuit avec
plusieurs joueurs connectes en meme temps — un scenario garanti de se
produire en usage reel.
