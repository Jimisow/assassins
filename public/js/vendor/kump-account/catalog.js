// Catalogue public d'un jeu — `games/{gameId}`.
//
// Nom affichable, libellés des trophées et des niveaux. Lisible par TOUT LE
// MONDE (voir firestore.rules), écrit uniquement depuis la console Firebase
// ou un script d'administration : aucun client n'y touche.
//
// POURQUOI EN BASE, ET PAS DANS CHAQUE PROJET ?
//
// Ces libellés sont lus par au moins trois endroits : le jeu lui-même (son
// écran de compte), kump.fr/profil et kump.fr/admin. Écrits en dur, un
// trophée ajouté obligeait à modifier le jeu ET le site, et les deux
// pouvaient diverger sans que rien ne le signale. C'était une dette assumée
// tant qu'il n'y avait qu'un seul jeu (voir kump.fr > CLAUDE.md, « Libellés :
// côté site pour l'instant ») — elle ne l'est plus à trois.
//
// ⚠️ Les IDENTIFIANTS de trophée sont définitifs (un trophée obtenu par un
// joueur y est rattaché) ; les LIBELLÉS sont libres et peuvent être réécrits
// à tout moment ici, sans toucher au code.

import { doc, getDoc } from 'firebase/firestore';
import { getKumpContext, requireReady, getGameId } from './core.js';

// Un catalogue change rarement et est lu à chaque ouverture d'un écran de
// compte : le garder en mémoire pour la durée de la page évite des lectures
// Firestore inutiles. Pas de cache persistant — un libellé corrigé doit
// apparaître au prochain chargement, pas au bout d'une semaine.
const cache = new Map();

/**
 * Catalogue public d'un jeu.
 *
 * @param {string} [gameId] Par défaut, le jeu courant (`initKump`).
 * @returns {Promise<{gameId: string, name: string,
 *   trophies: Array<{id: string, label: string, description: string}>,
 *   levels: Record<string, string>}|null>}
 *   `null` si le document n'existe pas — l'appelant doit alors se rabattre sur
 *   les identifiants bruts plutôt que d'afficher un écran vide. Un catalogue
 *   absent ne doit JAMAIS empêcher d'afficher un profil.
 */
export async function getGameCatalog(gameId) {
  if (!requireReady('getGameCatalog')) return null;
  const id = gameId ?? getGameId();
  if (!id) {
    console.warn('[kump] getGameCatalog: aucun gameId.');
    return null;
  }
  if (cache.has(id)) return cache.get(id);

  const { db } = getKumpContext();
  try {
    const snapshot = await getDoc(doc(db, 'games', id));
    if (!snapshot.exists()) {
      console.warn(`[kump] getGameCatalog: aucun catalogue pour « ${id} ».`);
      cache.set(id, null);
      return null;
    }
    const data = snapshot.data();
    const catalog = {
      gameId: id,
      name: data.name ?? id,
      // Normalisé en tableau ORDONNÉ : l'ordre d'un objet Firestore n'est pas
      // garanti, et une liste de trophées qui change d'ordre à chaque
      // chargement donne l'impression d'un bug.
      trophies: Array.isArray(data.trophies)
        ? data.trophies.map((trophy) => ({
            id: String(trophy.id ?? ''),
            label: String(trophy.label ?? trophy.id ?? ''),
            description: String(trophy.description ?? ''),
          }))
        : [],
      levels: data.levels && typeof data.levels === 'object' ? data.levels : {},
    };
    cache.set(id, catalog);
    return catalog;
  } catch (error) {
    console.error('[kump] getGameCatalog a échoué', error);
    return null;
  }
}
