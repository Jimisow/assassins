// Initialisation et état partagé du module (app Firebase, Firestore, Auth,
// identifiant du jeu appelant). Volontairement le SEUL endroit du module qui
// crée l'app Firebase : tous les autres fichiers lisent ce contexte.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const state = {
  app: null,
  auth: null,
  db: null,
  gameId: null,
  // URL du serveur de validation (kump.fr). Sans elle, un jeu ne peut pas
  // faire valider ses parties : elles resteront en file d'attente locale
  // jusqu'a ce qu'elle soit renseignee.
  apiBaseUrl: null,
  ready: false,
};

/**
 * À appeler UNE FOIS au démarrage du jeu, avant toute autre fonction.
 *
 * @param {object}  options
 * @param {object}  options.firebaseConfig  Config du projet Firebase KUMP (voir README).
 * @param {string}  options.gameId          Identifiant du jeu, ex. 'androgame'. Sert de
 *                                          nom de dossier pour les données du joueur :
 *                                          `users/{uid}/games/{gameId}`. Une fois choisi,
 *                                          NE JAMAIS le changer — ce serait perdre la
 *                                          progression de tous les joueurs de ce jeu.
 * @param {string} [options.databaseId]     Base Firestore nommée, si le projet n'utilise
 *                                          pas la base "(default)".
 * @returns {boolean} `true` si le module est utilisable, `false` si la config est
 *                    incomplète (le jeu doit alors continuer à tourner en mode
 *                    hors-ligne, voir README > Dégradation).
 */
export function initKump({ firebaseConfig, gameId, databaseId, apiBaseUrl } = {}) {
  if (state.ready) return true;

  // `gameId` est obligatoire pour un JEU, optionnel pour un client qui ne
  // fait que lire des profils (kump.fr) : les fonctions de données de jeu
  // refuseront alors de s'exécuter (voir requireGameId), le reste marche.
  if (gameId !== undefined && typeof gameId !== 'string') {
    console.error('[kump] initKump: `gameId` doit être une chaîne (ex. "androgame").');
    return false;
  }
  // Une config incomplète ne doit JAMAIS faire planter le jeu : le module
  // reste simplement inactif et chaque fonction renvoie une valeur neutre
  // (voir `requireReady` plus bas). C'est la même convention que
  // `isFirebaseConfigured` dans Androgame avant ce module.
  if (!firebaseConfig || !Object.values(firebaseConfig).every(Boolean)) {
    console.warn('[kump] initKump: configuration Firebase absente ou incomplète — module inactif.');
    state.gameId = gameId;
    state.apiBaseUrl = apiBaseUrl ?? null;
    return false;
  }

  // `getApps()` : un jeu peut déjà avoir sa propre app Firebase (cas d'une
  // migration progressive) — on réutilise l'app nommée "kump" si elle existe
  // déjà plutôt que d'en créer une seconde, ce que Firebase refuserait.
  const existing = getApps().find((a) => a.name === 'kump');
  state.app = existing ?? initializeApp(firebaseConfig, 'kump');
  state.auth = getAuth(state.app);
  state.db = databaseId ? getFirestore(state.app, databaseId) : getFirestore(state.app);
  state.gameId = gameId;
  // Sans slash final : les chemins appeles commencent tous par '/'.
  state.apiBaseUrl = apiBaseUrl ? String(apiBaseUrl).replace(/\/$/, '') : null;
  state.ready = true;
  return true;
}

/** Contexte interne — réservé aux fichiers du module, pas à l'usage d'un jeu. */
export function getKumpContext() {
  return state;
}

/** `true` si `initKump()` a réussi et que le module peut parler à Firebase. */
export function isKumpReady() {
  return state.ready;
}

/**
 * Garde-fou commun à toutes les fonctions publiques : si le module n'est pas
 * prêt (config absente, `initKump()` jamais appelée), on ne lève PAS d'erreur
 * — le jeu doit continuer de fonctionner en local. L'appelant reçoit une
 * valeur neutre et un avertissement en console.
 */
export function requireReady(fnName) {
  if (!state.ready) {
    console.warn(`[kump] ${fnName}: module non initialisé — appel ignoré.`);
    return false;
  }
  return true;
}

/** Nom de fichier/collection du jeu courant. */
export function getGameId() {
  return state.gameId;
}

/**
 * Garde-fou des fonctions qui écrivent dans les données d'un jeu : sans
 * `gameId`, elles n'ont aucun endroit où écrire. Évite qu'un client de
 * lecture (kump.fr) crée par accident un document de jeu fantôme.
 */
export function requireGameId(fnName) {
  if (!state.gameId) {
    console.warn(`[kump] ${fnName}: aucun gameId — initKump() a été appelée sans, appel ignoré.`);
    return false;
  }
  return true;
}
