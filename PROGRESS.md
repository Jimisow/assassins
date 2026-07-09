# PROGRESS — Etat d'avancement du projet "Assassins"

Construit de facon autonome. Ce document recapitule ce qui est fait, ce qui
est partiel, et comment tester chaque fonctionnalite.

## Serveur en cours d'execution

Le serveur Node.js tourne deja en arriere-plan, lance via `node server.js`
depuis `e:/Projet/Assassins` (log dans `server.log`).

- **URL a ouvrir : http://localhost:3000**
- Route de sante : http://localhost:3000/health → `{"status":"ok"}`
- Pour l'arreter : trouvez son PID (`Get-NetTCPConnection -LocalPort 3000`
  sous PowerShell, ou `netstat -ano | findstr :3000`) puis
  `Stop-Process -Id <PID> -Force`.
- Pour le relancer manuellement : `cd e:/Projet/Assassins && node server.js`
  (ou `npm start`).

## Etat general : fonctionnel de bout en bout

Le cycle complet a ete teste automatiquement (Playwright, 1 onglet Hote + 4
onglets Joueurs simultanes) : creation de salon → **configuration des roles
(salon ferme)** → validation → salon ouvert/chat/sondage Pret → lancement →
**Jour 1 : election du Gouverneur** (demarree manuellement par l'hote,
candidature, vote restreint aux candidats) → **Nuit 1** (Detective, Assassins,
Chimiste, avec **progression manuelle role par role controlee par l'hote**) →
annonce des resultats → vote du village → **victoire du camp Citoyens** avec
ecran de fin correct cote Hote et cote Joueur, **sans aucune erreur JS
console** a aucune etape. Le chat unifie en partie (modale, filtrage
vivants/morts, ecriture Hote, badge de non-lus) a egalement ete teste et
verifie directement au niveau des donnees.

Un bug critique de blocage a ete trouve et corrige lors des premiers tests
(voir `DECISIONS.md`) : le vote des Assassins ne faisait jamais avancer la
nuit a cause d'une lecture Firestore en cache perimee. C'est exactement le
genre de bug qui ne se voit qu'en testant avec plusieurs clients reels en
parallele — corrige et reteste avec succes.

### Mise a jour suite aux retours (session 2)

Suite a vos retours, plusieurs changements de flux ont ete apportes (details
complets dans `DECISIONS.md`, section "Revision suite aux retours
utilisateur") :

1. **La configuration des roles se fait maintenant AVANT l'ouverture du
   salon.** L'hote cree la partie, choisit la composition via des boutons
   +/-, puis clique "Valider la configuration" — ce n'est qu'a ce moment que
   les joueurs peuvent rejoindre avec le code. Toute tentative de rejoindre
   avant cette validation est refusee avec un message explicite.
2. **Compteurs +/-** a la place des champs numeriques pour choisir chaque
   role.
3. **Minimum releve a 4 joueurs** (hors Hote) pour pouvoir lancer la partie.
4. **Le role de Citoyen est maintenant visible** dans le recapitulatif du
   salon ouvert ("Citoyen x N (auto)") — son effectif se calcule en direct
   (joueurs connectes moins roles speciaux configures), puisqu'il ne peut
   pas etre fixe avant que les joueurs n'aient rejoint.
5. **Chat en partie repense** : un seul flux de messages (au lieu de deux
   chats separes Vivants/Morts), accessible via un petit bouton flottant
   "💬 Chat" qui ouvrit une modale — plus de panneau de chat permanent a
   l'ecran. Les vivants ne voient pas les messages envoyes par les morts (qui
   restent en violet spectral), mais les morts voient tout le flux, y
   compris les messages des vivants. Le chat du salon (avant partie), lui,
   reste affiche en permanence comme precedemment.

### Mise a jour suite aux retours (session 3)

Nouveaux ajustements (details complets dans `DECISIONS.md`) :

1. **La partie commence par le Jour 1** (election du Gouverneur), jamais par
   la nuit. L'hote doit cliquer "Lancer l'election du Gouverneur" pour
   ouvrir les candidatures — l'election ne demarre plus toute seule.
2. **Le vote de gouverneur ne propose plus que les candidats declares** :
   l'ancien filet de secours qui rendait tout le monde candidat par defaut a
   ete supprime. Un bug ou la liste des candidats ne se rafraichissait pas
   cote Hote a egalement ete corrige au passage.
3. **Le Detective ne peut plus sonder qu'un seul joueur par nuit** : le choix
   se verrouille des le premier clic (persiste en base, resiste a un
   rechargement de page).
4. **La nuit ne progresse plus automatiquement d'un role a l'autre.** Des
   qu'un role termine son action, l'Hote voit un bouton "Passer a [role
   suivant]" et doit cliquer explicitement pour continuer.
5. **L'Hote peut desormais ecrire dans le chat de la partie** (avant, lecture
   seule).
6. **Badge de messages non lus** sur le bouton "💬 Chat" (Hote et Joueurs).
7. **Bouton "Voir mon role" centre** a l'ecran.

### Mise a jour suite aux retours (session 4)

1. **Les actions nocturnes du role actif s'affichent dans une modale**
   (comme la riposte du Sherif), beaucoup plus visible que le simple
   panneau de jeu. Elle se ferme automatiquement une fois l'action validee.
2. **Le Detective voit desormais le detail complet** de sa cible : Joueur,
   Role, et la description complete du role (pas seulement son nom).
3. **Bug corrige : les joueurs ne voyaient pas l'annonce des resultats de la
   nuit** faite par l'hote (l'ecran restait bloque sur "l'hote va
   annoncer..."). C'est corrige : ils voient maintenant exactement les
   memes messages que l'hote (assassine/empoisonne/frole la mort/etc).
4. **Bouton "?" a cote de chaque role** dans l'ecran de configuration de
   l'hote, ouvrant une modale avec la description et la condition de
   victoire du role.

### Mise a jour suite aux retours (session 5) — corrections + design

Details complets dans `DECISIONS.md`. Tout retestee de bout en bout
(Playwright, plusieurs scenarios avec egalites forcees, mort du Gouverneur en
cours de partie, etc.), **sans aucune erreur console**.

1. **Egalite a l'election du Gouverneur : c'est desormais l'Hote qui tranche**
   via une modale de choix (au lieu d'un tirage au sort silencieux).
2. **Vote du village gate par un bouton explicite "Lancer le vote du
   village"**, comme l'election — il ne s'ouvre plus automatiquement.
3. **Indicateur "Jour N" / "Nuit N" permanent** en haut de l'ecran (Hote et
   Joueurs), plus une **animation plein ecran** a chaque changement de
   jour/nuit. Ceci clarifie aussi la reelection forcee du Gouverneur en
   cours de partie : le compteur ne "revient jamais au Jour 1" (verifie), il
   n'y avait simplement pas d'indicateur visible avant pour le prouver.
4. **Interface du Chimiste repensee** : deux cartes de potion avec des
   boutons cliquables (comme les autres roles), a la place de la case a
   cocher + liste deroulante.
5. **Toutes les actions nocturnes, la riposte du Sherif et l'egalite du
   Gouverneur au vote du village s'affichent en modale**, pour plus de
   visibilite.
6. **Ecran d'annonce des resultats redessine** : carte dediee avec une icone
   par type d'evenement (🛡️ sauve, 🗡️ assassine, ☠️ empoisonne, 💔 chagrin,
   🌙 nuit calme), plus percutant qu'une simple liste.
7. **Election et vote du village redessines** : cartes de candidats/cibles
   avec avatars, jauges de progression pendant le vote.
8. **Ecran de victoire entierement repense** : banniere coloree selon le
   camp vainqueur, cartes des vainqueurs, grille de reveal des roles — au
   lieu d'une simple page de texte sur fond noir.

### Mise a jour suite aux retours (session 6)

Details complets dans `DECISIONS.md`. Retestee de bout en bout (Playwright),
**sans aucune erreur console**.

1. **Passage a la nuit en trois clics explicites de l'Hote** : "Passer a la
   nuit" (annonce la nuit a venir) → "Lancer <role>" (determine et affiche
   le premier role, mais ne le demarre pas encore) → le role commence
   vraiment. S'applique a chaque nuit de la partie, pas seulement la
   premiere.
2. **Election, candidature et vote du village s'affichent maintenant dans la
   meme modale que les actions de nuit**, avec les boutons de choix
   **centres**.
3. **Ecran de victoire : la liste de joueurs (sans role) est masquee** cote
   Joueur — le reveal des roles a l'interieur donne deja toute l'info utile.
4. **Bouton "🔁 Rejouer" cote Hote** a la fin de la partie : remet le meme
   salon (memes joueurs, meme composition) en salon ouvert, sans que
   personne n'ait a resaisir le code.
5. **Fermeture de salon : notification toast** en haut de l'ecran d'accueil
   (auto-effacee apres quelques secondes) au lieu d'un `alert()` bloquant —
   chaque joueur est redirige immediatement.
6. **Correction de l'indicateur Jour/Nuit en debut de partie** : la toute
   premiere election affiche desormais "La partie commence" (au lieu de
   "Jour 1", qui s'affichait aussi apres la Nuit 1 et donnait une fausse
   impression de retour en arriere).

### Mise a jour suite aux retours (session 7)

Details complets dans `DECISIONS.md`. Retestee de bout en bout, **sans
aucune erreur console**.

1. **Message de sauvetage du Chimiste anonymise** : "Quelqu'un a frole la
   mort cette nuit !" (plus de nom affiche).
2. **Deux boutons superflus retires** : "Passer a la nuit" (on passe
   directement a "Lancer <role>") et "Passer a la fin de la nuit" (le
   dernier role termine affiche directement "Passer au jour").
3. **Bouton "Forcer le passage (secours)" retire** de l'ecran de nuit.
4. **Confirmation de fermeture de salon en modale** (Oui/Non) au lieu de la
   boite de dialogue native du navigateur.
5. **Centrage generalise** : texte de la transition Jour/Nuit, et tout le
   contenu des modales d'action (noms de joueurs, boutons, textes) —
   rendu plus elegant, surtout sur mobile.
6. **Icones par role** partout ou le nom d'un role est affiche (modale de
   role, info "?", listes, resultat du Detective, ecran de victoire).
7. **Bouton "Rejouer" simplifie** : texte seul, sans emoji.

### Mise a jour suite aux retours (session 8)

Details complets dans `DECISIONS.md`. Retestee de bout en bout (Playwright,
plusieurs parties completes), **sans aucune erreur console**.

1. **Grilles a 3 colonnes** pour la cible des Assassins et tous les ecrans de
   vote (election, vote du village) — repli a 2 colonnes sur petit ecran.
2. **Nouvel ecran de resultat du vote du village avant la nuit** : "Le
   village a elimine X, qui etait [icone] Role." s'affiche a tous (Hote et
   Joueurs) ; l'Hote doit cliquer explicitement "Passer a la nuit" pour
   continuer (au lieu d'un enchainement automatique).
3. **Ecran d'accueil repense** : un champ Pseudo (pre-rempli avec le dernier
   utilise), un bouton "Creer une partie", et un bouton "Rejoindre" qui
   deroule un mini-formulaire code + validation.
4. **Nouvelle police de titre** ("Cinzel Decorative"), plus fidele au theme.
5. **Particules de sang animees** en fond de l'ecran d'accueil.
6. **Fiabilisation de l'affichage cote Joueur** : les ecouteurs Firestore de
   chaque phase (election/vote/nuit) sont maintenant correctement nettoyes a
   chaque changement de phase (avant, un ancien ecouteur pouvait tres
   rarement redessiner un contenu perime par-dessus la phase courante), plus
   un rendu de secours automatique toutes les 4 secondes en filet de securite.

### Mise a jour suite aux retours (session 9)

Details complets dans `DECISIONS.md`. Retestee de bout en bout (Playwright,
2 parties completes jouees dans le meme salon via "Rejouer"), **sans aucune
erreur console**.

1. **Bug corrige : "Rejouer" ne remettait pas tout a zero.** Les votes/
   actions de nuit de la partie precedente restaient present en base
   (memes identifiants de document reutilises d'une partie a l'autre) et
   polluaient la partie suivante — corrige, chaque "Rejouer" repart
   desormais d'un etat totalement propre (memes joueurs, meme code de salon,
   mais aucune trace de vote/action de la partie precedente).
2. **Grilles a 3 colonnes generalisees** : Detective, Tueur en Serie, Destin
   (deja fait pour Assassins et votes en session 8).
3. **Messages de progression de nuit corriges** ("Passer au Chimiste" au
   lieu de "Passer a Le Chimiste prepare ses potions", etc.).
4. **Clignotement corrige** sur la liste des joueurs, l'ecran d'annonce des
   resultats, et l'ecran de victoire/defaite : ces ecrans ne se
   reecrivent plus inutilement quand rien n'a change.
5. **Reveal du role a chaque mort annoncee** : les messages d'annonce de
   nuit ("X a ete assassine/empoisonne/mort de chagrin") indiquent
   maintenant aussi le role de la victime, comme pour le vote du village.

### Mise a jour suite aux retours (session 10)

Details complets dans `DECISIONS.md`. Retestee de bout en bout (Playwright,
partie a 6 joueurs avec Assassin + Tueur en Serie + Corrupteur + Chimiste +
Destin + Citoyen), **sans regression fonctionnelle**.

1. **Le Tueur en Serie et le Corrupteur votent desormais avec les Assassins**
   pour designer la victime principale (unanimite requise des 3), en plus de
   leurs propres pouvoirs (kill bonus / corruption) plus tard dans la nuit.
2. **Le Tueur en Serie ne peut plus cibler ses allies Assassins** pour son
   kill bonus.
3. **Le Chimiste voit desormais les deux victimes potentielles de la nuit**
   (celle des Assassins ET celle du Tueur en Serie) pour sa potion de Vie, et
   choisit laquelle sauver.
4. **Mort de chagrin annoncee en meme temps que la mort initiale** (nuit et
   vote du village), au lieu d'etre appliquee silencieusement plus tard.
5. **Selection du Destin par clic** (2 pseudos relies par une ligne rose
   animee) au lieu de cases a cocher.
6. **Bouton "Regles du jeu"** sur l'ecran d'accueil, avec une modale
   expliquant simplement le deroule, l'ordre de la nuit, les camps/victoires
   et la riposte du Sherif.
7. **Verifie** : l'ecran de victoire du camp Assassins affiche bien le Tueur
   en Serie et le Corrupteur parmi les vainqueurs (deja correct, confirme par
   un test dedie).

### Mise a jour suite aux retours (session 11)

Details complets dans `DECISIONS.md`. Retestee de bout en bout, **sans
regression fonctionnelle**.

1. **Bug corrige : spammer un bouton (ex. "Valider" pour rejoindre) pouvait
   creer plusieurs entrees en base.** Tous les boutons/formulaires d'action
   (Hote et Joueur) se desactivent desormais immediatement au premier clic,
   avec un petit spinner a la place du texte le temps de la reponse
   Firestore. Verifie par un test dedie (spam de 9 soumissions = 1 seul
   joueur cree).
2. **"Annoncer les resultats" reellement plus rapide** : la transaction ne
   relit plus le document de chaque joueur un par un (lecture devenue
   inutile depuis l'ajout du role dans `lastNightResult.deaths`).
3. **Modale "Regles du jeu" : se ferme aussi au clic en dehors**, pas
   seulement via la croix.

### Mise a jour suite aux retours (session 12)

Details complets dans `DECISIONS.md`. Retestee de bout en bout, **sans
regression fonctionnelle**.

1. **Bug corrige : spammer "Envoyer" dans le chat affichait le message
   plusieurs fois.** Les formulaires de chat (salon et partie, Hote et
   Joueur) ont maintenant la meme garde anti-spam que les autres boutons.
2. **Spinner ajoute sur "Lancer la partie"**, qui n'en avait pas encore
   malgre sa propre protection anti-double-clic.

### Securisation avant mise en ligne publique (session 13)

Details complets dans `DECISIONS.md` et `TODO_SECURITE.md`. Retestee de
bout en bout (parties completes, rematch, reconnexion apres fermeture du
navigateur, camp Assassins avec Tueur en Serie/Corrupteur), **sans
regression fonctionnelle**.

**⚠️ Deux actions manuelles restent a faire dans la console Firebase avant
que ces corrections soient reellement actives — voir `TODO_SECURITE.md` en
tete de fichier (activer l'authentification anonyme + publier les nouvelles
regles Firestore, 5 minutes, instructions pas-a-pas fournies).**

1. **Authentification anonyme Firebase** : chaque appareil a desormais un
   identifiant verifie par le serveur, impossible a falsifier depuis la
   console du navigateur (contrairement a l'ancien UUID stocke en clair dans
   localStorage).
2. **Roles reellement prives** : le role/camp de chaque joueur vit dans un
   document separe, lisible uniquement par le joueur concerne et par
   l'Hote. Ouvrir les DevTools ne permet plus de lire le role des autres —
   avant, c'etait immediat.
3. **Verification d'auteur** : impossible d'agir/voter a la place d'un autre
   joueur, ou de modifier le salon comme si on etait l'Hote.
4. **Chat valide** (auteur verifie, longueur limitee cote serveur en plus du
   client).
5. **Nettoyage complet a la fermeture du salon** (sous-collections purgees,
   plus de donnees orphelines).

### Resilience reseau, installation PWA, verification finale (session 15)

Details complets dans `DECISIONS.md`. Suite de tests complete (rounds 8 a
15) rejouee contre les regles Firestore reellement en ligne, aucune
regression.

1. **Resilience reseau verifiee concretement** : partie complete jouee par
   4 joueurs simultanement sous des profils reseau distincts (wifi rapide,
   4G, 3G lente avec 400ms de latence) — tout fonctionne. Un bandeau
   "Connexion perdue" s'affiche desormais si l'appareil perd toute
   connexion internet.
2. **Bouton "Installer l'app"** sur l'ecran d'accueil : invite native sur
   Android/Chrome/Edge, instructions manuelles (Partager → Sur l'ecran
   d'accueil) sur iOS puisqu'aucune installation programmee n'y est
   possible. Reste cache si deja installe.
3. **Formulation des annonces de mort** changee sur demande : "X a ete
   assassine. Il/elle etait [role]." au lieu de "X a ete assassine, qui
   etait [role]."
4. **Verification finale des fichiers** : aucune erreur de syntaxe, aucun
   import casse, aucune ecriture de role residuelle sur la mauvaise
   collection, relecture complete de `firestore.rules` pour confirmer
   qu'aucune autre collection n'a la faille corrigee en session 14.

### Mise en ligne sur GitHub Pages + bug PWA corrige (session 16)

Details complets dans `DECISIONS.md`. **Le jeu est en ligne :
https://jimisow.github.io/assassins/** (depot public
`github.com/Jimisow/assassins`, deploiement automatique a chaque push via
GitHub Actions).

**Bug corrige** : l'app installee (PWA) affichait une erreur 404 au
lancement. Cause : `manifest.json` et `service-worker.js` utilisaient des
chemins absolus (`/index.html`), qui pointaient hors du projet puisque
GitHub Pages sert ce depot sous `/assassins/`, pas a la racine du domaine.
Passes en chemins relatifs — fonctionne desormais aussi bien en local que
sur GitHub Pages. Verifie directement sur le site en ligne : installation,
activation du Service Worker et mise en cache toutes confirmees.

## Fonctionnalites completes

- **Lobby** : creation d'un salon (code unique 4-5 caracteres) qui demarre en
  phase de **configuration fermee** ; l'hote choisit la composition via des
  compteurs +/-, valide, puis le salon s'ouvre et les joueurs peuvent
  rejoindre par code + pseudo. Persistance `localStorage` et reconnexion
  automatique (hote et joueur) apres fermeture/veille du navigateur.
- **Chat du lobby** (avant partie, affiche en permanence) : temps reel,
  reinitialise (supprime) au lancement de la partie.
- **Sondage "Pret"** : bouton cote joueur, bouton "Lancer la partie" cote
  hote bloque tant que 100% ne sont pas prets et qu'il n'y a pas au moins 4
  joueurs connectes.
- **Attribution des roles** : melange aleatoire respectant les quantites
  choisies, citoyens en complement (effectif visible dans le recapitulatif).
- **Ecran Joueur** : modale "Voir mon role" (fermeture auto 7s ou croix),
  affichage de l'amoureux potentiel, liste des joueurs (vivant/mort, badge
  Gouverneur), chat en partie unifie accessible via un bouton "💬 Chat"
  (modale) : les vivants ne voient pas les messages des morts (violet
  spectral), les morts voient tout.
- **Ecran Hote** : code de salon toujours visible, vue complete des roles/
  statuts/amoureux/Gouverneur, boutons d'action qui se debloquent selon
  l'etat de la partie, bouton "Fermer le salon" (supprime le document lobby,
  redirige tous les joueurs connectes en temps reel).
- **Election du Gouverneur** : candidature/retrait, vote, egalite tranchee
  par tirage au sort (justifie dans DECISIONS.md), badge dore visible par
  tous, reelection automatique si le Gouverneur meurt (nuit ou jour).
- **Machine a etats de la nuit** : ordre strict Destin (nuit 1) → Detective →
  Assassins → Tueur en Serie → Corrupteur → Chimiste, avec saut automatique
  des roles absents/sans pouvoir. Mecanique de tremblement ("Insister") pour
  les Assassins tant que le vote n'est pas unanime.
- **Reveil/annonce** : "Passer au jour" puis "Annoncer les resultats" en deux
  clics separes, messages differencies (assassine / empoisonne / frole la
  mort / mort de chagrin), corruption silencieuse (pas d'annonce, changement
  de camp discret).
- **Cas speciaux** : mort en chaine des Ames Soeurs, riposte du Sherif
  (modale bloquante + minuteur 1s + resolution automatique aleatoire si
  timeout), reelection forcee du Gouverneur.
- **Victoire** : `checkVictoryConditions` (camps Citoyens/Assassins, Ames
  Soeurs dernieres survivantes) + `checkDayVoteSpecialConditions` (Martyr,
  Psychopathe), ecran de fin avec reveal de tous les roles, cote Hote et
  cote Joueur.
- **PWA** : `manifest.json` + `service-worker.js` fonctionnels (cache du
  shell statique), icones generees (192/512 PNG + SVG), installable sur
  mobile/desktop.
- **Theme "Tenebres et Mort"** : fonds sombres, rouge sang, violet spectral
  pour les morts, dorures pour le Gouverneur, animations fade (transitions)
  et shake (tremblement des Assassins + modale du Sherif).

## Limitations connues / partiel

- **Confidentialite des roles et securite generale** : corrigees en session
  13 (authentification, roles reellement prives, regles Firestore
  restrictives, nettoyage des sous-collections) — **a condition d'avoir fait
  les deux actions manuelles listees en tete de `TODO_SECURITE.md`**
  (activer l'authentification anonyme + publier les nouvelles regles dans la
  console Firebase). Limite assumee restante : ce n'est pas une architecture
  "zero trust" avec logique de jeu cote serveur (Cloud Functions) — voir
  `TODO_SECURITE.md` pour le detail et l'option d'aller plus loin.
- **Tests couverts par l'automatisation** : lobby → config → election (Jour
  1, demarrage manuel, vote restreint aux candidats) → nuit 1 avec
  progression manuelle role par role (Detective verrouille sur une seule
  cible meme apres rechargement, Assassins, Chimiste — Destin/Tueur en
  Serie/Corrupteur non exerces faute de configuration dans ces parties de
  test precises, mais verifies dans une partie de test dediee au Sherif) →
  vote du village → victoire Citoyens ; chat unifie (filtrage vivant/mort,
  ecriture Hote, badge de non-lus) ; riposte du Sherif + Destin/Ames Soeurs
  (partie de test separee). **Non exerces automatiquement** : Corrupteur,
  potion de Mort du Chimiste, victoire Assassins/Martyr/Psychopathe, parties
  a plusieurs nuits/jours. La logique existe et a ete relue avec soin, mais
  un test manuel de ces chemins est recommande (voir "Comment tester"
  ci-dessous).

## Comment tester demain matin

Le serveur tourne deja (voir le message de fin de session pour l'URL exacte,
normalement `http://localhost:3000`).

1. **Ouvrez un onglet "Hote"** : allez sur `http://localhost:3000`, cliquez
   "Devenir l'Hote". Vous atterrissez sur l'ecran de **configuration** (le
   salon n'est pas encore ouvert).
2. Choisissez la composition avec les boutons +/- (au moins 1 Assassin),
   puis cliquez "Valider la configuration et ouvrir le salon". Le code de
   salon s'affiche alors en haut de l'ecran.
3. **Ouvrez plusieurs fenetres de navigation privee** (une par joueur — c'est
   necessaire car `localStorage` est isole par profil/fenetre privee, donc
   chaque fenetre privee simule un telephone different). Dans chacune, allez
   sur `http://localhost:3000`, entrez un pseudo et le code du salon (au
   moins 4 joueurs sont necessaires).
4. Attendez que tous les joueurs cliquent "Je suis pret", puis cliquez
   "Lancer la partie" cote Hote. L'indicateur affiche **"La partie
   commence"** (pas "Jour 1", reserve aux vraies journees).
5. **Election du Gouverneur (obligatoire)** : l'Hote clique "Lancer
   l'election du Gouverneur" ; un ou plusieurs joueurs cliquent "Me
   presenter" **dans la fenetre modale qui s'ouvre** ; l'Hote clique "Lancer
   le vote" (desactive tant qu'aucun candidat ne s'est presente) ; chaque
   joueur vote **dans sa modale, parmi les seuls candidats affiches** ;
   l'Hote clique "Valider l'election". **En cas d'egalite, une modale
   apparait sur l'ecran de l'Hote** pour qu'il choisisse lui-meme le
   Gouverneur.
6. **L'Hote garde la main sur l'entree en nuit** : des la resolution de
   l'election (badge passant a "Nuit 1"), il voit un bouton "Lancer <role>"
   indiquant le premier role qui va agir — ce n'est qu'a ce clic que ce role
   commence vraiment chez le joueur concerne.
7. Chaque joueur peut cliquer "Voir mon role" pour decouvrir sa carte, et
   "💬 Chat" pour ouvrir la messagerie de la partie (badge numerote en cas de
   message non lu). Suivez le fil role par role : le role actif voit son
   ecran d'action dans une **fenetre modale bien visible** ; les autres
   voient "en attente". Pour le Chimiste, utilisez les deux cartes de potion
   (boutons cliquables). **Une fois l'action validee, l'Hote voit un bouton
   "Passer a [role suivant]" et doit cliquer dessus lui-meme** — la nuit
   n'avance jamais toute seule.
8. Une fois tous les roles nocturnes joues (l'Hote voit "Passer au jour"),
   il clique dessus puis "Annoncer les resultats" (faites votre propre
   annonce orale au groupe avant de cliquer). Le resultat s'affiche dans une
   carte dediee avec une icone par evenement (🗡️ assassine, ☠️ empoisonne,
   💔 chagrin, 🛡️ sauve). L'indicateur passe alors a "Jour 1".
9. Vote du village : l'Hote doit cliquer **"Lancer le vote du village"**,
   puis chaque joueur vivant vote **dans sa modale**, et l'Hote clique "Clore
   le vote". **En cas d'egalite, une modale apparait sur l'ecran du
   Gouverneur** pour qu'il departage. (Si le Gouverneur meurt en cours de
   partie, une reelection se redeclenche avec le meme bouton "Lancer
   l'election" — l'indicateur "Jour N"/"Nuit N" reste coherent avec le jour
   reel, il ne revient jamais a "La partie commence".) Le resultat s'affiche
   ensuite a tous ("Le village a elimine X, qui etait [role]") **avant** la
   nuit suivante — l'Hote doit cliquer "Passer a la nuit" pour continuer
   (sauf si l'elimination met immediatement fin a la partie).
10. Repetez nuit/jour jusqu'a la victoire d'un camp : un **ecran de victoire
    redessine** s'affiche automatiquement (Hote et Joueurs), avec une
    banniere coloree selon le camp vainqueur et le reveal de tous les roles
    (la liste "brute" des joueurs est masquee a ce moment-la, cote Joueur).
11. **Pour rejouer** : l'Hote clique **"🔁 Rejouer"** sur l'ecran de
    victoire — tout le monde revient au salon ouvert (meme code, memes
    joueurs, meme composition), sans avoir a resaisir quoi que ce soit.
12. **Pour tester la fermeture de salon** : l'Hote clique "Fermer le salon"
    (confirmation demandee) — chaque Joueur est immediatement redirige vers
    l'accueil avec une **notification qui s'affiche en haut de l'ecran et
    disparait seule** apres quelques secondes.

**Pour tester la limite du Detective** : verifiez qu'apres avoir clique sur
un premier joueur a sonder, il n'est plus possible d'en choisir un autre
(meme apres avoir recharge la page) tant que la nuit suivante n'a pas
commence.

**Pour tester le chat unifie** : faites mourir un joueur (nuit ou vote),
verifiez que ses messages envoyes APRES sa mort apparaissent en violet et
restent invisibles pour les joueurs encore vivants (mais visibles par
l'Hote et les autres morts), alors que ses messages d'avant sa mort restent
visibles de tous.

**Pour tester la riposte du Sherif** : configurez 1 Sherif, faites-le
eliminer (nuit ou vote) et verifiez que la modale bloquante avec minuteur
d'1 seconde apparait sur son ecran, et que le jeu reprend correctement apres
son tir (ou apres l'expiration automatique du minuteur).

**Pour tester le Destin/Ames Soeurs** : configurez 1 Destin, verifiez qu'il
choisit 2 joueurs (en cliquant leurs pseudos, une ligne rose animee les relie)
la premiere nuit uniquement, que chacun voit son "amoureux" dans sa modale de
role, et que la mort de l'un declenche bien la mort de chagrin de l'autre
**dans la meme annonce/ecran de resultat**, pas plus tard.

**Pour tester le Corrupteur** : configurez 1 Corrupteur + 1 Assassin,
verifiez qu'il peut transformer silencieusement la victime des Assassins en
Assassin (aucune annonce publique, juste un changement de camp).

**Pour tester le vote commun du camp Assassins** : configurez 1 Assassin + 1
Tueur en Serie + 1 Corrupteur, verifiez que les 3 voient l'ecran de vote des
Assassins et doivent tous les 3 designer la meme cible (unanimite) avant que
la nuit n'avance ; verifiez aussi que le Tueur en Serie ne peut pas cibler
ses allies pour son kill bonus, et que le Chimiste voit bien les deux
victimes potentielles (Assassins + Tueur en Serie) pour sa potion de Vie.

## Fichiers cles

- `server.js` — Express minimal (statique + `/health`).
- `public/js/roles.js` — definitions des roles/camps + conditions de
  victoire (fonctions pures, faciles a tester isolement).
- `public/js/night-cycle.js` — machine a etats de la nuit.
- `public/js/host.js` — orchestration complete cote Hote (le plus gros
  fichier : toutes les transitions d'etat critiques y vivent).
- `public/js/player.js` — toutes les interactions cote Joueur.
- `public/js/lobby.js` / `chat.js` — creation/connexion de salon, chats.
- `public/js/ui-utils.js` — garde anti-double-clic/spam (`guardedClick`/
  `guardedSubmit`), utilisee par tous les boutons d'action de `host.js`,
  `player.js` et `index.html`.
- `public/js/network-status.js` — bandeau "Connexion perdue" (3 pages).
- `public/js/pwa-install.js` — bouton "Installer l'app" (ecran d'accueil).
- `scripts/generate-icons.js` — generateur d'icones PWA (a relancer si vous
  changez le design des icones : `node scripts/generate-icons.js`).
- `firestore.rules` — regles de securite Firestore (auth, roles prives,
  validation). **A publier manuellement dans la console Firebase** (voir
  `TODO_SECURITE.md`, pas fait automatiquement).
- `firebase.json` / `.firebaserc` — config minimale pour deployer les regles
  via `firebase deploy --only firestore:rules` si vous preferez la ligne de
  commande a la console.
