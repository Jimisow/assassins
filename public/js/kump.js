// Pont entre Assassins et le compte KUMP (module `kump-account`).
//
// Le compte KUMP est partage par tous les jeux du studio : une seule identite,
// un temps de jeu cumule, des statistiques par jeu et des trophees, visibles
// aussi sur kump.fr/profil.
//
// ⚠️ DEUX PROJETS FIREBASE COHABITENT DANS CETTE PAGE, ne jamais les confondre :
//
//   - `loup-garou-e5fd5` (js/firebase-config.js) : les SALONS de jeu. C'est
//     l'app Firebase par defaut, et c'est elle qui porte l'identite anonyme
//     utilisee par les regles de securite du jeu (`firestore.rules`).
//   - `kump-812dd` (ici) : le COMPTE JOUEUR. `initKump()` cree une app
//     Firebase NOMMEE « kump » a cote de la premiere.
//
// Deux bases, deux jeux de regles, deux sessions anonymes distinctes. Le
// `uid` d'un joueur dans un salon n'a AUCUN rapport avec son uid KUMP — ne
// jamais utiliser l'un a la place de l'autre.
//
// ⚠️ NE JAMAIS ECRIRE DANS FIRESTORE KUMP DEPUIS CE FICHIER, ni appeler
// `saveGameData()` / `addPlaytime()` / `unlockTrophy()`. Les regles refusent au
// client d'ecrire son temps de jeu, ses statistiques et ses trophees, et le
// refus est SILENCIEUX (le module avale l'erreur et renvoie `false`). La seule
// voie est `submitSession()`.

import {
  initKump,
  isKumpReady,
  getCurrentUser,
  onUserChanged,
  ensureSignedIn,
  getProfile,
  setDisplayName,
  linkWithEmail,
  signInWithEmail,
  linkWithGoogle,
  signInWithGoogle,
  signOutKump,
  loadGameData,
  getUnlockedTrophies,
  getGameCatalog,
  submitSession,
  flushSessionQueue,
} from "kump-account";

/**
 * Identifiant du jeu cote compte KUMP : nom de dossier des donnees du joueur
 * (`users/{uid}/games/assassins`).
 *
 * ⚠️ DEFINITIF. Le changer reviendrait a perdre la progression de tous les
 * joueurs. Il est deja inscrit tel quel dans le catalogue de kump.fr et dans
 * le registre du serveur de validation.
 */
const GAME_ID = "assassins";

// Identifiants Firebase du projet KUMP. PUBLICS par nature : ils partent dans
// le navigateur de chaque joueur, exactement comme ceux du salon juste a cote.
// La securite repose sur les regles Firestore, pas sur leur secret.
const firebaseConfig = {
  apiKey: "AIzaSyAP1uoOoFw6gE_R8pTsSgeZJszQcloApkQ",
  authDomain: "kump-812dd.firebaseapp.com",
  projectId: "kump-812dd",
  storageBucket: "kump-812dd.firebasestorage.app",
  messagingSenderId: "809129439305",
  appId: "1:809129439305:web:706f7ac2a53f38182fcf98",
};

/**
 * URL du serveur qui valide les parties (routes /api/game/* de kump.fr).
 *
 * Assassins n'a pas d'etape de build, donc pas de variables d'environnement :
 * l'URL est choisie a l'execution d'apres le nom d'hote. Sans elle, les
 * parties resteraient en file d'attente locale sans jamais partir.
 *
 * ⚠️ A mettre a jour le jour ou le domaine kump.fr sera branche sur le projet
 * Vercel (voir kump.fr > CLAUDE.md > Deploiement).
 */
const API_PRODUCTION = "https://kump-studio.vercel.app";
function apiBaseUrl() {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  return local ? "http://localhost:3000" : API_PRODUCTION;
}

let started = false;

function ensureStarted() {
  if (!started) {
    started = true;
    initKump({ firebaseConfig, gameId: GAME_ID, apiBaseUrl: apiBaseUrl() });
  }
  return isKumpReady();
}

export {
  getProfile,
  getCurrentUser,
  ensureSignedIn,
  setDisplayName,
  loadGameData,
  getUnlockedTrophies,
  getGameCatalog,
};

/**
 * Prepare le module SANS creer de compte, et previent a chaque changement
 * d'utilisateur.
 *
 * ⚠️ Ne jamais remplacer par `ensureSignedIn()` pour « savoir qui est
 * connecte » : cette fonction-la CREE un compte anonyme s'il n'y en a pas.
 * Ouvrir l'ecran de compte puis le refermer fabriquerait alors un compte
 * fantome a chaque fois.
 */
export function watchAccount(callback) {
  if (!ensureStarted()) {
    callback(null);
    return () => {};
  }
  return onUserChanged(callback);
}

/**
 * Rattache un email au compte COURANT (`link*`), sans rien perdre.
 *
 * ⚠️ `link*` et non `signIn*` : le joueur a deja un compte anonyme et des
 * parties enregistrees. `link*` garde le meme identifiant interne, donc toute
 * sa progression ; `signIn*` basculerait vers un AUTRE compte et
 * l'abandonnerait.
 */
export async function createAccount(email, password) {
  if (!ensureStarted()) return { success: false, error: "not-ready" };
  await ensureSignedIn();
  return linkWithEmail(email, password);
}

/**
 * Rattache un compte Google au compte courant (progression conservee).
 *
 * ⚠️ Peut echouer avec `credential-in-use` — ce compte Google appartient deja
 * a un AUTRE profil KUMP, typiquement parce que le joueur s'en est deja servi
 * sur un autre jeu KUMP. Ce n'est pas une impasse : l'ecran doit alors
 * proposer `loginWithGoogle()`. Voir js/account.js.
 */
export async function createAccountWithGoogle() {
  if (!ensureStarted()) return { success: false, error: "not-ready" };
  await ensureSignedIn();
  return linkWithGoogle();
}

/**
 * Bascule vers le compte Google — pour le joueur qui a DEJA un profil KUMP.
 *
 * ⚠️ Abandonne la session anonyme en cours. A ne proposer qu'apres avoir
 * prevenu le joueur, et seulement quand le rattachement a echoue parce que
 * l'identite etait deja prise.
 */
export async function loginWithGoogle() {
  if (!ensureStarted()) return { success: false, error: "not-ready" };
  return signInWithGoogle();
}

/** Connexion a un compte existant — bascule vers CE compte, abandonne l'actuel. */
export async function loginToAccount(email, password) {
  if (!ensureStarted()) return { success: false, error: "not-ready" };
  return signInWithEmail(email, password);
}

export async function logoutAccount() {
  if (!ensureStarted()) return;
  await signOutKump();
}

/**
 * Enregistre une partie terminee sur le compte KUMP.
 *
 * ⚠️ CES STATISTIQUES SONT DECLAREES, et le serveur ne peut pas les verifier :
 * le resultat d'une nuit est calcule par le navigateur de l'Hote, dans un
 * projet Firebase auquel kump.fr n'a aucun acces. Il verifie seulement que les
 * valeurs existent dans le jeu (role, camp, nombre de joueurs) et qu'une
 * partie n'ajoute qu'un a chaque compteur. C'est une limite assumee, deja
 * documentee dans TODO_SECURITE.md : jamais de recompense reelle adossee a ces
 * chiffres.
 *
 * Ne leve jamais : une partie qui ne part pas ne doit pas casser l'ecran de
 * victoire. Le pire cas est une mise en file d'attente, renvoyee plus tard.
 */
export async function recordGame({ role, camp, won, survived, players, nights, durationMs }) {
  if (!ensureStarted()) return null;
  try {
    // On vide la file AVANT : les parties s'enregistrent dans l'ordre joue.
    await flushSessionQueue();
    return await submitSession({
      kind: "partie",
      durationMs,
      payload: { role, camp, won: won === true, survived: survived === true, players, nights },
    });
  } catch (error) {
    console.warn("[kump] enregistrement de la partie impossible", error);
    return null;
  }
}
