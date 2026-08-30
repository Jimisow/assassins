// Envoi au serveur de validation, et file d'attente hors ligne.
//
// EXTRAIT DE `runs.js`, sans changement de comportement, le jour où un
// deuxième type d'envoi est apparu (`session.js`, pour les jeux sans économie
// — voir README > Sessions de jeu). La raison est la règle d'or du module :
// ce fichier contient la distinction la plus coûteuse du projet — « le
// serveur a dit NON » contre « le serveur n'a pas répondu » contre « pas
// encore » — et l'avoir recopiée dans un deuxième fichier l'aurait laissée
// diverger. Un correctif fait ici doit profiter à tous les envois d'un coup.
//
// ⚠️ La faille que cette distinction ferme (Androgame > AUDIT.md, SEC-13) :
// confondre un refus DÉFINITIF avec un refus `retryable` faisait perdre sa
// partie au joueur honnête qui meurt deux fois en quelques secondes, ou qui
// rentre du métro avec plusieurs parties en attente. Ne jamais la simplifier.

import { getKumpContext } from './core.js';
import { ensureSignedIn, getIdToken } from './auth.js';

/** Au-delà, on jette les plus anciens : une file sans limite finirait par
 *  saturer le stockage du navigateur, et une partie vieille de trois semaines
 *  n'intéresse plus personne. */
const QUEUE_MAX = 50;

/**
 * Fabrique une file d'attente locale sur une clé de `localStorage` donnée.
 *
 * Chaque type d'envoi a la SIENNE (`kump.pendingRuns`, `kump.pendingSessions`)
 * plutôt qu'une file commune : les charges utiles n'ont pas la même forme et
 * ne partent pas au même endroit, les mélanger obligerait à trier au moment
 * de vider, pour aucun bénéfice.
 *
 * @param {string} storageKey
 */
export function makeQueue(storageKey) {
  function read() {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function write(items) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items.slice(-QUEUE_MAX)));
    } catch {
      /* stockage plein ou indisponible : tant pis, on ne bloque pas le jeu */
    }
  }

  return { read, write, count: () => read().length };
}

/**
 * POST authentifié vers le serveur de validation.
 *
 * @returns {Promise<{status?: number, data?: object, networkError: boolean}>}
 *   `networkError: true` couvre TOUT ce qui n'est pas une réponse du serveur :
 *   pas d'`apiBaseUrl`, pas de session, pas de jeton, réseau absent. L'appelant
 *   doit alors mettre en file — jamais abandonner.
 */
export async function post(path, body) {
  const { apiBaseUrl } = getKumpContext();
  if (!apiBaseUrl) {
    console.warn('[kump] initKump: `apiBaseUrl` absente — impossible de valider les parties.');
    return { networkError: true };
  }

  const user = await ensureSignedIn();
  if (!user) return { networkError: true };
  const token = await getIdToken();
  if (!token) return { networkError: true };

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    // On distingue soigneusement DEUX échecs très différents : le serveur a
    // répondu « non » (l'envoi est refusé, inutile de réessayer), ou il n'a pas
    // répondu du tout (à remettre en file). Confondre les deux ferait
    // réessayer indéfiniment quelque chose que le serveur rejettera toujours.
    return { status: response.status, data, networkError: false };
  } catch {
    return { networkError: true };
  }
}

/**
 * Vide une file, un envoi à la fois et DANS L'ORDRE.
 *
 * Partagé par `flushRunQueue()` et `flushSessionQueue()` : les deux ont
 * exactement les mêmes trois cas d'arrêt, et c'est précisément là que se
 * jouait SEC-13.
 *
 * - réseau absent → on garde celui-ci ET tous les suivants, sans insister ;
 * - `retryable` (réserve de temps réel épuisée) → idem : les suivants
 *   puisent dans la MÊME réserve, ils se heurteraient forcément au même mur.
 *   Rien n'est perdu, juste différé au prochain passage ;
 * - refus définitif → ABANDONNÉ, jamais réessayé : le renvoyer donnerait le
 *   même refus à chaque lancement.
 *
 * Séquentiel et jamais en parallèle : le serveur borne le rythme auquel il
 * crédite, un envoi groupé en verrait la plupart refusés pour « trop tôt ».
 *
 * @returns {Promise<{sent: number, remaining: number}>}
 */
export async function flushQueue(queue, path) {
  const items = queue.read();
  if (items.length === 0) return { sent: 0, remaining: 0 };

  const restants = [];
  let sent = 0;

  for (const [index, item] of items.entries()) {
    const result = await post(path, item);
    if (result.networkError || result.data?.retryable) {
      restants.push(...items.slice(index));
      break;
    }
    if (result.status === 200 && result.data?.ok) sent += 1;
  }

  queue.write(restants);
  return { sent, remaining: restants.length };
}
