// Classement par jeu — `leaderboards/{gameId}/entries/{uid}`.
//
// Un document par joueur et par jeu (jamais un par partie) : le classement
// montre le meilleur de chacun, pas 50 lignes pour celui qui a rejoué 50 fois.
//
// Le module ne décide PAS du critère de tri : chaque jeu envoie ses propres
// métriques dans `stats` et choisit sur quel champ trier. Androgame trie par
// pourcentage de progression puis diamants ; un jeu de score classique triera
// par score. Un `orderBy` sur un champ de `stats` demande un index composite
// Firestore (voir README > Index).

import {
  doc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  getCountFromServer,
  serverTimestamp,
} from 'firebase/firestore';
import { getKumpContext, requireReady, requireGameId, getGameId } from './core.js';
import { ensureSignedIn } from './auth.js';
import { getProfile } from './profile.js';

/**
 * Publie (ou met à jour) l'entrée de classement du joueur pour le jeu courant.
 *
 * ⚠️ Réservé aux comptes NON anonymes : un classement public n'a pas de sens
 * avec des pseudos générés que personne ne peut revendiquer, et ça pousse
 * naturellement le joueur à rattacher un email — c'est le moment où il en a
 * envie. Renvoie `{ success: false, error: 'guest' }` sinon, à l'appelant
 * d'afficher une invitation à créer son compte.
 *
 * @param {object} stats  Métriques du jeu (nombres/chaînes courtes uniquement).
 */
export async function submitScore(stats) {
  if (!requireReady('submitScore') || !requireGameId('submitScore')) return { success: false, error: 'not-ready' };
  const user = await ensureSignedIn();
  if (!user) return { success: false, error: 'not-signed-in' };
  if (user.isAnonymous) return { success: false, error: 'guest' };

  const profile = await getProfile();
  const { db } = getKumpContext();
  try {
    await setDoc(
      doc(db, 'leaderboards', getGameId(), 'entries', user.uid),
      {
        displayName: profile?.displayName ?? 'Joueur',
        updatedAt: serverTimestamp(),
        ...stats,
      },
      { merge: true },
    );
    return { success: true };
  } catch (error) {
    console.error('[kump] submitScore a échoué', error);
    return { success: false, error: 'unknown' };
  }
}

/**
 * Top N du classement du jeu courant.
 * @param {object}   options
 * @param {string}   options.sortBy      Champ de tri principal (ex. 'avgProgressPercent').
 * @param {string}  [options.thenBy]     Champ de départage (ex. 'totalDiamonds').
 * @param {number}  [options.max=10]
 */
export async function fetchLeaderboard({ sortBy, thenBy, max = 10 } = {}) {
  if (!requireReady('fetchLeaderboard') || !sortBy) return [];
  const { db } = getKumpContext();
  try {
    const clauses = [orderBy(sortBy, 'desc')];
    if (thenBy) clauses.push(orderBy(thenBy, 'desc'));
    const q = query(collection(db, 'leaderboards', getGameId(), 'entries'), ...clauses, limit(max));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ uid: d.id, ...d.data() }));
  } catch (error) {
    // Cause la plus fréquente : index composite manquant (Firestore renvoie
    // alors un lien direct pour le créer dans le message d'erreur).
    console.error('[kump] fetchLeaderboard a échoué', error);
    return [];
  }
}

/**
 * Rang exact du joueur (1-indexé) — un COMPTAGE côté serveur, pas un
 * téléchargement du classement : combien de joueurs le devancent, + 1.
 * Fonctionne donc aussi pour un joueur très loin du top.
 */
export async function fetchRank({ sortBy, thenBy, value, thenValue } = {}) {
  if (!requireReady('fetchRank') || !sortBy) return null;
  const { db } = getKumpContext();
  try {
    const col = collection(db, 'leaderboards', getGameId(), 'entries');
    const queries = [getCountFromServer(query(col, where(sortBy, '>', value)))];
    if (thenBy) {
      queries.push(getCountFromServer(query(col, where(sortBy, '==', value), where(thenBy, '>', thenValue))));
    }
    const snaps = await Promise.all(queries);
    return snaps.reduce((total, snap) => total + snap.data().count, 0) + 1;
  } catch (error) {
    console.error('[kump] fetchRank a échoué', error);
    return null;
  }
}
