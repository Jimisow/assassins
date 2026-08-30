// Données du joueur POUR UN JEU — `users/{uid}/games/{gameId}`.
//
// Le module ne connaît PAS la forme de ces données : chaque jeu range ce qu'il
// veut (Androgame y met pièces, skins possédés, progression par niveau,
// diamants ; un futur jeu y mettra tout autre chose). C'est volontaire —
// ajouter un jeu ne doit jamais demander de modifier ce module ni les règles
// Firestore.
//
// Les trophées, eux, sont normalisés (`.../games/{gameId}/trophies/{trophyId}`)
// parce que kump.fr doit pouvoir les afficher de la même façon pour tous les
// jeux, sans connaître les règles de chacun.

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { getKumpContext, requireReady, requireGameId, getGameId } from './core.js';
import { ensureSignedIn } from './auth.js';

/**
 * Charge les données du joueur pour le jeu courant.
 * @returns {Promise<object|null>} L'objet enregistré, `{}` si le joueur n'a
 *   encore jamais joué, `null` si le module est inactif ou hors-ligne — dans
 *   ce dernier cas le jeu doit garder ses données locales.
 */
export async function loadGameData() {
  if (!requireReady('loadGameData') || !requireGameId('loadGameData')) return null;
  const user = await ensureSignedIn();
  if (!user) return null;

  const { db } = getKumpContext();
  try {
    const snapshot = await getDoc(doc(db, 'users', user.uid, 'games', getGameId()));
    if (!snapshot.exists()) return {};
    const { playtimeMs, lastPlayedAt, ...gameFields } = snapshot.data();
    // `playtimeMs`/`lastPlayedAt` sont gérés par le module (addPlaytime) : on
    // ne les rend pas au jeu, pour qu'il ne soit jamais tenté de les réécrire
    // lui-même via saveGameData().
    return gameFields;
  } catch (error) {
    console.error('[kump] loadGameData a échoué', error);
    return null;
  }
}

/**
 * Enregistre (en fusion) les données du joueur pour le jeu courant. Les champs
 * absents de `data` sont laissés tels quels en base — un jeu peut donc
 * sauvegarder juste `{ coins: 120 }` sans écraser le reste.
 *
 * ⚠️ Données DÉCLARÉES par le client : tant que la validation serveur n'est
 * pas en place, un joueur qui modifie le jeu peut écrire ce qu'il veut ICI.
 * Ne jamais y ranger quelque chose qui doit être infalsifiable (monnaie
 * payante, récompense réelle) — voir README > Limites.
 *
 * @param {object} data
 */
export async function saveGameData(data) {
  if (!requireReady('saveGameData') || !requireGameId('saveGameData')) return false;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.error('[kump] saveGameData attend un objet.');
    return false;
  }
  // Champs réservés au module : les refuser explicitement plutôt que de les
  // écraser silencieusement (un jeu qui les envoie a forcément un bug).
  const reserved = ['playtimeMs', 'lastPlayedAt'];
  const offending = reserved.filter((key) => key in data);
  if (offending.length > 0) {
    console.error(`[kump] saveGameData: champs réservés au module, retirés — ${offending.join(', ')}`);
    offending.forEach((key) => delete data[key]);
  }

  const user = await ensureSignedIn();
  if (!user) return false;

  const { db } = getKumpContext();
  try {
    await setDoc(doc(db, 'users', user.uid, 'games', getGameId()), data, { merge: true });
    return true;
  } catch (error) {
    console.error('[kump] saveGameData a échoué', error);
    return false;
  }
}

/**
 * Débloque un trophée pour le jeu courant. Idempotent : rappeler la fonction
 * pour un trophée déjà obtenu ne change pas sa date de déblocage.
 *
 * @param {string} trophyId  Identifiant stable, ex. 'niveau-01-100-pourcent'.
 *                           NE JAMAIS le renommer une fois en production : les
 *                           trophées déjà obtenus par les joueurs y sont liés.
 * @returns {Promise<boolean>} `true` si le trophée vient d'être débloqué,
 *                             `false` s'il l'était déjà (ou en cas d'échec) —
 *                             pratique pour n'afficher l'animation qu'une fois.
 */
export async function unlockTrophy(trophyId) {
  if (!requireReady('unlockTrophy') || !requireGameId('unlockTrophy')) return false;
  const id = String(trophyId ?? '').trim();
  if (!id) return false;

  const user = await ensureSignedIn();
  if (!user) return false;

  const { db } = getKumpContext();
  const ref = doc(db, 'users', user.uid, 'games', getGameId(), 'trophies', id);
  try {
    const snapshot = await getDoc(ref);
    if (snapshot.exists()) return false;
    await setDoc(ref, { unlockedAt: serverTimestamp() });
    return true;
  } catch (error) {
    console.error('[kump] unlockTrophy a échoué', error);
    return false;
  }
}

/**
 * Liste des trophées déjà obtenus sur le jeu courant.
 * @returns {Promise<Array<{id: string, unlockedAt: any}>>}
 */
export async function getUnlockedTrophies() {
  if (!requireReady('getUnlockedTrophies') || !requireGameId('getUnlockedTrophies')) return [];
  const user = await ensureSignedIn();
  if (!user) return [];

  const { db } = getKumpContext();
  try {
    const snapshot = await getDocs(collection(db, 'users', user.uid, 'games', getGameId(), 'trophies'));
    return snapshot.docs.map((d) => ({ id: d.id, unlockedAt: d.data().unlockedAt ?? null }));
  } catch (error) {
    console.error('[kump] getUnlockedTrophies a échoué', error);
    return [];
  }
}
