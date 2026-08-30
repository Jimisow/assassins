// Envoi des parties au serveur de validation, et file d'attente hors ligne.
//
// C'est le point de bascule de l'anti-triche (voir Androgame/AUDIT.md §3) : un
// jeu ne DÉCLARE plus ce qu'il a gagné, il le DEMANDE. Le serveur juge la
// plausibilité du run contre les données réelles du niveau, puis écrit
// lui-même — le client n'ayant plus le droit d'écrire pièces, progression ni
// diamants.
//
// Conséquence assumée : le jeu dépend du réseau pour enregistrer une partie.
// D'où la file d'attente — sans elle, un joueur dans le métro perdrait sa
// progression, ce qui serait bien pire que la triche qu'on cherche à empêcher.
//
// La mécanique de file et d'envoi vit dans `transport.js`, partagée avec les
// sessions de jeu (`session.js`) : c'est là que se trouve la distinction
// refus définitif / `retryable` / réseau absent, et elle ne doit exister qu'à
// un seul endroit (voir SEC-13).

import { requireReady, requireGameId, getGameId } from './core.js';
import { makeQueue, post, flushQueue } from './transport.js';

const RUN_PATH = '/api/game/run';
const queue = makeQueue('kump.pendingRuns');

/** Nombre de parties en attente d'envoi — pour l'afficher au joueur si besoin. */
export function pendingRunCount() {
  return queue.count();
}

/**
 * Envoie une fin de partie au serveur.
 *
 * @param {object} run  `{ levelId, coins, percent, diamondIds, durationMs }` —
 *   la forme exacte est propre au jeu, le serveur la valide.
 * @returns {Promise<{accepted: boolean, queued?: boolean, refused?: boolean,
 *   reason?: string, coins?: number, trophies?: string[]}>}
 */
export async function submitRun(run) {
  if (!requireReady('submitRun') || !requireGameId('submitRun')) {
    return { accepted: false };
  }

  const payload = { ...run, gameId: getGameId() };
  const result = await post(RUN_PATH, payload);

  if (result.networkError) {
    // Hors ligne : on garde le run pour le prochain lancement. Un tricheur
    // peut fabriquer de faux runs en attente, mais le serveur les validera
    // comme les autres — la file ne crée donc aucune faille.
    queue.write([...queue.read(), { ...payload, queuedAt: Date.now() }]);
    return { accepted: false, queued: true };
  }

  if (result.status === 200 && result.data?.ok) {
    return {
      accepted: true,
      coins: result.data.coins,
      percent: result.data.percent,
      newDiamonds: result.data.newDiamonds,
      trophies: result.data.trophies ?? [],
    };
  }

  // « Pas encore » n'est PAS « non ». Le serveur limite le rythme auquel une
  // progression peut être créditée (voir kump.fr > /api/game/run, réserve de
  // temps réel) : une partie refusée pour cette raison est parfaitement
  // valide, elle arrive juste trop tôt. La jeter perdrait la progression d'un
  // joueur honnête — typiquement celui qui meurt deux fois en quelques
  // secondes, ou qui rentre du métro avec plusieurs parties en attente. On la
  // remet donc en file, comme si le réseau avait manqué.
  if (result.data?.retryable) {
    queue.write([...queue.read(), { ...payload, queuedAt: Date.now() }]);
    return { accepted: false, queued: true, reason: result.data?.reason ?? 'too-soon' };
  }

  return { accepted: false, refused: true, reason: result.data?.reason ?? 'unknown' };
}

/**
 * Renvoie les parties restées en attente. À appeler au démarrage du jeu.
 *
 * Les runs partent un par un et dans l'ordre : le serveur borne le rythme
 * auquel il crédite, donc un envoi en parallèle en verrait la plupart
 * refusés. Les trois cas d'arrêt sont dans `transport.js > flushQueue`.
 *
 * @returns {Promise<{sent: number, remaining: number}>}
 */
export async function flushRunQueue() {
  if (!requireReady('flushRunQueue')) return { sent: 0, remaining: 0 };
  return flushQueue(queue, RUN_PATH);
}

/**
 * Achat d'un objet — le serveur détient le catalogue, donc les prix. Le jeu
 * n'envoie plus que l'objet voulu.
 *
 * Pas de file d'attente ici, volontairement : un achat hors ligne ne peut pas
 * être validé plus tard sans mentir au joueur sur son solde entre-temps.
 * Mieux vaut lui dire tout de suite que ça n'a pas marché.
 */
export async function purchaseFromServer({ kind, itemId }) {
  if (!requireReady('purchaseFromServer') || !requireGameId('purchaseFromServer')) {
    return { success: false, error: 'not-ready' };
  }

  const result = await post('/api/game/purchase', { kind, itemId, gameId: getGameId() });
  if (result.networkError) return { success: false, error: 'offline' };
  if (result.status === 200 && result.data?.ok) {
    return {
      success: true,
      coins: result.data.coins,
      alreadyOwned: result.data.alreadyOwned === true,
      price: result.data.price,
    };
  }
  return { success: false, error: result.data?.reason ?? 'unknown' };
}
