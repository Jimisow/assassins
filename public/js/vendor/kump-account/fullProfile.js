// Profil COMPLET d'un joueur, tous jeux confondus — pour kump.fr.
//
// Le reste du module raisonne toujours « pour le jeu courant » (`gameId`
// passé à `initKump`), parce que c'est ce dont un jeu a besoin. Le site, lui,
// doit afficher l'inverse : tout ce qu'un joueur a fait, sur TOUS les jeux.
// D'où ce fichier à part, seul endroit qui parcourt la sous-collection
// `users/{uid}/games`.
//
// Les règles Firestore autorisent déjà cette lecture sans changement : un
// joueur peut lire tout ce qui est sous `users/{sonUid}`, y compris lister
// ses jeux et ses trophées.

import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { getKumpContext, requireReady } from './core.js';
import { ensureSignedIn } from './auth.js';

/**
 * @returns {Promise<{
 *   uid: string, displayName: string, email: string|null, isGuest: boolean,
 *   isAdmin: boolean, createdAt: any, totalPlaytimeMs: number,
 *   games: Array<{ gameId: string, playtimeMs: number, lastPlayedAt: any,
 *                  trophies: Array<{id: string, unlockedAt: any}>, data: object }>
 * }|null>}
 */
export async function getFullProfile() {
  if (!requireReady('getFullProfile')) return null;
  const user = await ensureSignedIn();
  if (!user) return null;

  const { db } = getKumpContext();
  try {
    const [profileSnap, gamesSnap] = await Promise.all([
      getDoc(doc(db, 'users', user.uid)),
      getDocs(collection(db, 'users', user.uid, 'games')),
    ]);

    const profile = profileSnap.exists() ? profileSnap.data() : {};

    // Les trophées de chaque jeu, en parallèle : un joueur a peu de jeux, et
    // les charger l'un après l'autre rendrait la page inutilement lente.
    const games = await Promise.all(
      gamesSnap.docs.map(async (gameDoc) => {
        const { playtimeMs, lastPlayedAt, ...data } = gameDoc.data();
        const trophiesSnap = await getDocs(
          collection(db, 'users', user.uid, 'games', gameDoc.id, 'trophies'),
        );
        return {
          gameId: gameDoc.id,
          playtimeMs: playtimeMs ?? 0,
          lastPlayedAt: lastPlayedAt ?? null,
          trophies: trophiesSnap.docs.map((t) => ({ id: t.id, unlockedAt: t.data().unlockedAt ?? null })),
          // Le reste des données du jeu (pièces, progression...) : de forme
          // libre, propre à chaque jeu — le site l'affiche au mieux sans
          // prétendre la comprendre.
          data,
        };
      }),
    );

    // Le jeu le plus récemment joué en premier : c'est ce qu'un joueur
    // s'attend à voir en haut de son profil.
    games.sort((a, b) => (b.lastPlayedAt?.seconds ?? 0) - (a.lastPlayedAt?.seconds ?? 0));

    return {
      uid: user.uid,
      displayName: profile.displayName ?? 'Joueur',
      email: user.email ?? null,
      isGuest: user.isAnonymous,
      isAdmin: profile.isAdmin === true,
      createdAt: profile.createdAt ?? null,
      totalPlaytimeMs: profile.totalPlaytimeMs ?? 0,
      games,
    };
  } catch (error) {
    console.error('[kump] getFullProfile a échoué', error);
    return null;
  }
}
