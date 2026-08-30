// Profil KUMP global du joueur — `users/{uid}`.
//
// Ce document est COMMUN à tous les jeux : pseudo affiché, avatar, date
// d'inscription, temps de jeu cumulé. Tout ce qui est propre à un jeu vit
// dans `users/{uid}/games/{gameId}` (voir gameData.js) — ne jamais ajouter
// ici un champ qui ne concerne qu'un seul jeu, sinon le document devient un
// fourre-tout que chaque nouveau jeu doit connaître.

import { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { getKumpContext, requireReady, requireGameId, getGameId } from './core.js';
import { ensureSignedIn, getCurrentUser } from './auth.js';

/** Pseudo par défaut d'un compte tout neuf : "Joueur" + 4 chiffres du uid. */
function defaultDisplayName(uid) {
  return `Joueur${uid.slice(0, 4).toUpperCase()}`;
}

/**
 * Crée le document de profil s'il n'existe pas encore, et rafraîchit la date
 * de dernière visite. Appelée automatiquement à chaque connexion.
 * @param {import('firebase/auth').User} user
 */
export async function ensureProfile(user) {
  if (!requireReady('ensureProfile') || !user) return;
  const { db } = getKumpContext();
  const ref = doc(db, 'users', user.uid);

  try {
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) {
      await setDoc(ref, {
        displayName: defaultDisplayName(user.uid),
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        totalPlaytimeMs: 0,
      });
      return;
    }
    await updateDoc(ref, { lastSeenAt: serverTimestamp() });
  } catch (error) {
    console.error('[kump] ensureProfile a échoué', error);
  }
}

/**
 * Profil global du joueur connecté.
 * @returns {Promise<{uid: string, displayName: string, isGuest: boolean,
 *   email: string|null, totalPlaytimeMs: number, createdAt: any}|null>}
 */
export async function getProfile() {
  if (!requireReady('getProfile')) return null;
  const user = await ensureSignedIn();
  if (!user) return null;

  const { db } = getKumpContext();
  try {
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    const data = snapshot.exists() ? snapshot.data() : {};
    return {
      uid: user.uid,
      displayName: data.displayName ?? defaultDisplayName(user.uid),
      isGuest: user.isAnonymous,
      email: user.email ?? null,
      totalPlaytimeMs: data.totalPlaytimeMs ?? 0,
      createdAt: data.createdAt ?? null,
      // Drapeau d'administration, en LECTURE SEULE : posé à la main dans la
      // console Firebase sur le compte concerné, jamais écrit par le module
      // ni par un jeu. `firestore.rules` ne liste `isAdmin` dans AUCUN des
      // `hasOnly()` de création/mise à jour du profil : il est donc
      // structurellement impossible de se l'attribuer depuis un client, même
      // en modifiant le code du jeu. C'est la seule protection nécessaire.
      isAdmin: data.isAdmin === true,
    };
  } catch (error) {
    console.error('[kump] getProfile a échoué', error);
    return null;
  }
}

/**
 * Change le pseudo affiché (classements, profil kump.fr).
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setDisplayName(displayName) {
  if (!requireReady('setDisplayName')) return { success: false, error: 'not-ready' };
  const name = String(displayName ?? '').trim();
  // Bornes alignées sur `firestore.rules` : une valeur refusée côté serveur
  // doit l'être ici aussi, pour donner un message clair au joueur plutôt
  // qu'un `permission-denied` opaque.
  if (name.length < 3 || name.length > 16) return { success: false, error: 'invalid-length' };

  const user = await ensureSignedIn();
  if (!user) return { success: false, error: 'not-signed-in' };

  const { db } = getKumpContext();
  try {
    await updateDoc(doc(db, 'users', user.uid), { displayName: name });
    return { success: true };
  } catch (error) {
    console.error('[kump] setDisplayName a échoué', error);
    return { success: false, error: 'unknown' };
  }
}

/**
 * Ajoute du temps de jeu, à la fois au total global (profil KUMP) et au
 * compteur du jeu courant — c'est ce qui alimente le profil détaillé de
 * kump.fr ("X h sur Androgame, Y h sur ...").
 *
 * À appeler à la FIN d'une session de jeu (ou périodiquement, ex. toutes les
 * 60 s), jamais à chaque frame : chaque appel est une écriture Firestore.
 *
 * ⚠️ Valeur DÉCLARÉE par le client, donc falsifiable tant que la validation
 * serveur (Cloud Functions) n'est pas en place — voir README > Limites.
 *
 * @param {number} ms Durée à ajouter, en millisecondes.
 */
export async function addPlaytime(ms) {
  if (!requireReady('addPlaytime') || !requireGameId('addPlaytime')) return false;
  const amount = Math.floor(Number(ms) || 0);
  if (amount <= 0) return false;
  // Plafond de sécurité : une session de plus de 6 h vient forcément d'un
  // compteur laissé tourner (onglet oublié en arrière-plan) ou d'une valeur
  // trafiquée — dans les deux cas, mieux vaut ne rien enregistrer que de
  // polluer un profil à vie avec une valeur aberrante.
  if (amount > 6 * 60 * 60 * 1000) {
    console.warn('[kump] addPlaytime: durée aberrante ignorée', amount);
    return false;
  }

  const user = await ensureSignedIn();
  if (!user) return false;

  const { db } = getKumpContext();
  const gameId = getGameId();
  try {
    await updateDoc(doc(db, 'users', user.uid), { totalPlaytimeMs: increment(amount) });
    await setDoc(
      doc(db, 'users', user.uid, 'games', gameId),
      { playtimeMs: increment(amount), lastPlayedAt: serverTimestamp() },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.error('[kump] addPlaytime a échoué', error);
    return false;
  }
}

/** Utilitaire interne : uid courant sans forcer de connexion. */
export function currentUid() {
  return getCurrentUser()?.uid ?? null;
}
