// Identité du joueur KUMP.
//
// Principe retenu (voir README > Parcours de connexion) : le joueur n'a JAMAIS
// à créer de compte pour jouer. Un compte anonyme est créé silencieusement à
// la première partie, sa progression est donc déjà sauvegardée dans le cloud ;
// il ne rattache un email que le jour où il veut apparaître au classement ou
// retrouver sa partie sur un autre appareil — et à ce moment-là, RIEN n'est
// perdu (`linkWithCredential` transforme le compte anonyme en compte
// permanent, en gardant le même `uid`, donc les mêmes données).

import {
  signInAnonymously,
  onAuthStateChanged,
  EmailAuthProvider,
  linkWithCredential,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { getKumpContext, requireReady } from './core.js';
import { ensureProfile } from './profile.js';

/**
 * Garantit qu'un joueur est connecté (anonyme si besoin) et que son document
 * de profil existe. Toutes les fonctions de données l'appellent d'abord, donc
 * un jeu n'a normalement jamais besoin de l'appeler lui-même.
 *
 * @returns {Promise<import('firebase/auth').User|null>}
 */
export async function ensureSignedIn() {
  if (!requireReady('ensureSignedIn')) return null;
  const { auth } = getKumpContext();

  if (auth.currentUser) return auth.currentUser;

  // Attendre la restauration de session AVANT de créer un compte anonyme :
  // Firebase relit l'utilisateur déjà connecté depuis le stockage local de
  // façon ASYNCHRONE. Sans cette attente, un `signInAnonymously()` lancé trop
  // tôt créerait un NOUVEAU compte anonyme à chaque lancement du jeu, et le
  // joueur perdrait sa progression à chaque fois — piège classique de
  // Firebase Auth, à ne jamais court-circuiter.
  const restored = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
  if (restored) {
    await ensureProfile(restored);
    return restored;
  }

  try {
    const credential = await signInAnonymously(auth);
    await ensureProfile(credential.user);
    return credential.user;
  } catch (error) {
    console.error('[kump] Connexion anonyme impossible', error);
    return null;
  }
}

/**
 * Prévient à chaque changement d'utilisateur (connexion, rattachement d'un
 * email, déconnexion). Rend une fonction pour se désabonner.
 *
 * @param {(user: import('firebase/auth').User|null) => void} callback
 * @returns {() => void}
 */
export function onUserChanged(callback) {
  if (!requireReady('onUserChanged')) return () => {};
  const { auth } = getKumpContext();
  return onAuthStateChanged(auth, callback);
}

/**
 * Jeton d'identité du joueur connecté, à envoyer à un serveur qui doit
 * VÉRIFIER qui appelle (`Authorization: Bearer <token>`).
 *
 * C'est la seule façon correcte de s'authentifier auprès d'un backend avec
 * Firebase : le serveur valide le jeton cryptographiquement auprès de Google.
 * Ne JAMAIS envoyer un `uid` brut à la place — n'importe qui pourrait écrire
 * celui d'un autre dans sa requête et se faire passer pour lui.
 *
 * Le jeton est renouvelé automatiquement par Firebase (validité ~1 h) : le
 * redemander avant chaque appel plutôt que de le mettre en cache.
 *
 * @returns {Promise<string|null>}
 */
export async function getIdToken() {
  if (!requireReady('getIdToken')) return null;
  const { auth } = getKumpContext();
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (error) {
    console.error('[kump] getIdToken a échoué', error);
    return null;
  }
}

/** Utilisateur courant, ou `null`. Synchrone : peut valoir `null` juste au démarrage. */
export function getCurrentUser() {
  const { auth, ready } = getKumpContext();
  return ready ? auth.currentUser : null;
}

/** `true` si le joueur est encore sur un compte anonyme (aucun email rattaché). */
export function isGuest() {
  const user = getCurrentUser();
  return !!user && user.isAnonymous;
}

/**
 * Rattache un email + mot de passe au compte ANONYME courant : le joueur garde
 * son `uid`, donc toute sa progression, et peut désormais se reconnecter
 * depuis n'importe quel appareil.
 *
 * @returns {Promise<{ success: boolean, error?: string }>} `error` vaut
 *   'email-already-in-use' (cet email appartient déjà à un autre compte),
 *   'weak-password', 'invalid-email', 'not-signed-in' ou 'unknown'.
 */
export async function linkWithEmail(email, password) {
  if (!requireReady('linkWithEmail')) return { success: false, error: 'not-ready' };
  const { auth } = getKumpContext();
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'not-signed-in' };

  try {
    const credential = EmailAuthProvider.credential(email, password);
    await linkWithCredential(user, credential);
    return { success: true };
  } catch (error) {
    // `auth/email-already-in-use` : cet email a déjà un compte KUMP. On NE
    // fusionne PAS les deux comptes automatiquement — il faudrait choisir
    // quelle progression garder, ce qu'aucun code ne peut décider à la place
    // du joueur. L'appelant doit lui proposer de se connecter à son compte
    // existant (`signInWithEmail`), en le prévenant que la progression
    // anonyme en cours sera abandonnée.
    return { success: false, error: mapAuthError(error) };
  }
}

/**
 * Connexion à un compte KUMP existant. ⚠️ Remplace la session courante : si le
 * joueur était sur un compte anonyme avec de la progression non rattachée,
 * elle devient inaccessible. Toujours l'avertir avant d'appeler ceci.
 */
export async function signInWithEmail(email, password) {
  if (!requireReady('signInWithEmail')) return { success: false, error: 'not-ready' };
  const { auth } = getKumpContext();
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await ensureProfile(credential.user);
    return { success: true };
  } catch (error) {
    return { success: false, error: mapAuthError(error) };
  }
}

/** Envoie un email de réinitialisation de mot de passe. */
export async function sendPasswordReset(email) {
  if (!requireReady('sendPasswordReset')) return { success: false, error: 'not-ready' };
  const { auth } = getKumpContext();
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (error) {
    return { success: false, error: mapAuthError(error) };
  }
}

/**
 * Déconnexion. ⚠️ Sur un compte ANONYME, c'est définitif : il n'y a aucun moyen
 * de se reconnecter à un compte sans email. L'appelant doit refuser ou avertir
 * très clairement si `isGuest()` est vrai.
 */
export async function signOutKump() {
  if (!requireReady('signOutKump')) return;
  const { auth } = getKumpContext();
  await signOut(auth);
}

// Traduit les codes Firebase en codes courts et stables, pour que chaque jeu
// affiche ses propres messages sans dépendre du texte exact de Firebase.
function mapAuthError(error) {
  const code = String(error?.code ?? '');
  if (code.includes('email-already-in-use')) return 'email-already-in-use';
  if (code.includes('weak-password')) return 'weak-password';
  if (code.includes('invalid-email')) return 'invalid-email';
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'wrong-password';
  if (code.includes('user-not-found')) return 'user-not-found';
  if (code.includes('too-many-requests')) return 'too-many-requests';
  console.error('[kump] Erreur auth non répertoriée', error);
  return 'unknown';
}
