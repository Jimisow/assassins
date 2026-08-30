// Fin de session pour un jeu SANS économie — Assassins, D-Track, et les
// suivants.
//
// Pourquoi une deuxième porte, à côté de `submitRun()` ?
//
// `submitRun()` parle le vocabulaire d'Androgame : un niveau, des pièces, un
// pourcentage de progression, des diamants. Un jeu de dés ou un jeu social
// n'a rien de tout ça. Plutôt que de tordre ce vocabulaire — ce qui aurait
// obligé chaque nouveau jeu à inventer un « niveau » et des « pièces » qui
// n'existent pas chez lui —, cette fonction envoie une forme LIBRE que le
// serveur interprète à partir d'un registre propre à chaque jeu.
//
// Ce qui ne change PAS, et ne doit jamais changer : le jeu ne DÉCLARE pas ce
// qu'il a gagné, il le DEMANDE. Depuis la phase 3, les règles Firestore
// interdisent au client d'écrire son temps de jeu, ses statistiques et ses
// trophées (voir firestore.rules) — cette fonction est la SEULE voie
// légitime, exactement comme `submitRun()` l'est pour Androgame. Un jeu qui
// tenterait `addPlaytime()` ou `saveGameData()` recevra un
// `permission-denied` : c'est voulu.
//
// Ce que le serveur vérifie dépend du jeu, et il faut être honnête sur la
// différence (voir kump.fr > src/lib/game/games/) :
//   - D-Track : la partie est REJOUÉE côté serveur (grille + séquence de dés
//     déclarées, score recalculé, légalité de chaque placement vérifiée). Le
//     score n'est pas cru, il est recalculé.
//   - Assassins : le résultat d'une nuit est calculé par le navigateur de
//     l'Hôte, le serveur ne peut pas le rejouer. Les statistiques y sont donc
//     DÉCLARÉES, bornées seulement par plausibilité. Ne jamais y adosser une
//     récompense réelle.

import { requireReady, requireGameId, getGameId } from './core.js';
import { makeQueue, post, flushQueue } from './transport.js';

const SESSION_PATH = '/api/game/session';
const queue = makeQueue('kump.pendingSessions');

/** Nombre de sessions en attente d'envoi — pour l'afficher au joueur si besoin. */
export function pendingSessionCount() {
  return queue.count();
}

/**
 * Envoie une fin de session au serveur, qui décide de ce qui est enregistré.
 *
 * @param {object}  session
 * @param {string}  session.kind        Type de session, propre au jeu ('solo',
 *                                      'online', 'partie'…). Le registre du jeu
 *                                      côté serveur décide de ce qu'il accepte.
 * @param {number}  session.durationMs  Durée réelle de la session. ⚠️ DÉCLARÉE
 *                                      par le client : elle ne borne rien à
 *                                      elle seule. Ce qui borne vraiment le
 *                                      rythme, c'est la réserve de temps réel
 *                                      mesurée par le serveur.
 * @param {object} [session.payload]    Tout le reste, forme libre : ce que le
 *                                      registre du jeu sait vérifier.
 * @returns {Promise<{accepted: boolean, queued?: boolean, refused?: boolean,
 *   reason?: string, stats?: object, trophies?: string[]}>}
 */
export async function submitSession({ kind, durationMs, payload } = {}) {
  if (!requireReady('submitSession') || !requireGameId('submitSession')) {
    return { accepted: false };
  }

  const body = {
    gameId: getGameId(),
    kind: kind ?? 'partie',
    durationMs: Math.max(0, Math.floor(Number(durationMs) || 0)),
    payload: payload ?? {},
  };

  const result = await post(SESSION_PATH, body);

  if (result.networkError) {
    // Hors ligne : on garde la session pour le prochain lancement. C'est le
    // cas NORMAL en solo sur D-Track, qui est jouable sans réseau — sans
    // cette file, une soirée de parties dans le train ne compterait pour
    // rien. Un tricheur peut fabriquer de fausses sessions en attente, mais
    // le serveur les validera comme les autres : la file n'ouvre aucune
    // faille.
    queue.write([...queue.read(), { ...body, queuedAt: Date.now() }]);
    return { accepted: false, queued: true };
  }

  if (result.status === 200 && result.data?.ok) {
    return {
      accepted: true,
      stats: result.data.stats ?? {},
      trophies: result.data.trophies ?? [],
    };
  }

  // « Pas encore » n'est PAS « non » — voir runs.js, même piège, même
  // conséquence : jeter une session refusée pour réserve épuisée ferait
  // perdre de vraies parties à un joueur honnête.
  if (result.data?.retryable) {
    queue.write([...queue.read(), { ...body, queuedAt: Date.now() }]);
    return { accepted: false, queued: true, reason: result.data?.reason ?? 'too-soon' };
  }

  return { accepted: false, refused: true, reason: result.data?.reason ?? 'unknown' };
}

/**
 * Renvoie les sessions restées en attente. À appeler au démarrage du jeu.
 * Voir `transport.js > flushQueue` pour les trois cas d'arrêt.
 *
 * @returns {Promise<{sent: number, remaining: number}>}
 */
export async function flushSessionQueue() {
  if (!requireReady('flushSessionQueue')) return { sent: 0, remaining: 0 };
  return flushQueue(queue, SESSION_PATH);
}
