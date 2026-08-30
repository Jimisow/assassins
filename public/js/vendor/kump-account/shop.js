// Boutique — catalogue et achats.
//
// LE PRINCIPE, identique à celui des parties : le jeu ne décide de rien. Il
// demande le catalogue au serveur (qui détient les PRIX), et pour acheter il
// n'envoie que l'objet voulu. Un prix n'a jamais à figurer dans le code d'un
// jeu, et un jeu ne peut donc pas se tromper — ni mentir — sur ce que coûte
// quelque chose.
//
// ⚠️ ACHETER UN OBJET DÉJÀ POSSÉDÉ = L'ÉQUIPER, sans débit. Ce n'est pas un
// effet de bord : c'est la SEULE façon pour un jeu d'équiper un objet. Les
// règles Firestore n'autorisent le client à écrire que `equippedSkin` et
// `equippedTrail` (noms hérités d'Androgame) ; un jeu neuf, dont le champ
// s'appelle autrement, passe forcément par le serveur. `equipItem()` ci-dessous
// n'est donc qu'un nom lisible pour le même appel.
//
// ⚠️ LA MONNAIE EST PAR JEU. Le solde vit dans `users/{uid}/games/{gameId}`,
// pas sur le profil global : un jeu dont l'économie serait mal bornée ne
// contamine pas les autres.

import { requireReady, requireGameId, getGameId, getKumpContext } from './core.js';
import { post } from './transport.js';
import { loadGameData } from './gameData.js';

// Le catalogue change rarement et l'écran de boutique peut être rouvert
// souvent : on le garde en mémoire pour la durée de la page. Pas de cache
// persistant — un prix corrigé côté serveur doit s'appliquer au prochain
// chargement, pas au bout d'une semaine.
const cache = new Map();

/**
 * Catalogue de la boutique du jeu : catégories, objets, prix, nom de la monnaie.
 *
 * @param {string} [gameId] Par défaut, le jeu courant.
 * @returns {Promise<{gameId: string, currencyLabel: string, kinds: Array<{
 *   kind: string, label: string, ownedField: string, equippedField: string,
 *   items: Array<{id: string, label: string, price: number, description?: string}>
 * }>}|null>} `null` si le serveur est injoignable ou ne connaît pas ce jeu —
 *   l'appelant doit alors afficher « boutique indisponible », jamais une
 *   boutique vide qui laisserait croire qu'il n'y a rien à acheter.
 */
export async function getShopCatalog(gameId) {
  const id = gameId ?? getGameId();
  if (!id) {
    console.warn('[kump] getShopCatalog: aucun gameId.');
    return null;
  }
  if (cache.has(id)) return cache.get(id);

  const { apiBaseUrl } = getKumpContext();
  if (!apiBaseUrl) {
    console.warn('[kump] getShopCatalog: `apiBaseUrl` absente — boutique indisponible.');
    return null;
  }

  try {
    // Route PUBLIQUE : un catalogue de prix n'est pas un secret, et l'écran de
    // boutique doit pouvoir afficher ses étiquettes sans attendre de session.
    const response = await fetch(`${apiBaseUrl}/api/game/shop?gameId=${encodeURIComponent(id)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      console.warn('[kump] getShopCatalog: refusé', data.reason ?? response.status);
      return null;
    }
    cache.set(id, data);
    return data;
  } catch (error) {
    console.warn('[kump] getShopCatalog a échoué', error);
    return null;
  }
}

/**
 * Ce que le joueur possède et a équipé, plus son solde.
 *
 * Lit les données du jeu (protégées par les règles Firestore : personne ne lit
 * celles d'un autre) et les recoupe avec le catalogue, pour que l'écran de
 * boutique n'ait aucun croisement à faire lui-même.
 *
 * @returns {Promise<{coins: number, owned: Record<string, string[]>,
 *   equipped: Record<string, string|null>}|null>}
 */
export async function getShopState(gameId) {
  if (!requireReady('getShopState')) return null;
  const catalog = await getShopCatalog(gameId);
  if (!catalog) return null;

  const data = (await loadGameData()) ?? {};
  const owned = {};
  const equipped = {};
  for (const kind of catalog.kinds) {
    const liste = data[kind.ownedField];
    owned[kind.kind] = Array.isArray(liste) ? liste.map(String) : [];
    const porte = data[kind.equippedField];
    equipped[kind.kind] = typeof porte === 'string' ? porte : null;
  }
  return {
    coins: typeof data.coins === 'number' ? data.coins : 0,
    owned,
    equipped,
  };
}

/**
 * Achète un objet. Le serveur détient le prix, vérifie le solde, débite et
 * débloque en une seule transaction.
 *
 * Pas de file d'attente, volontairement : un achat hors ligne ne peut pas être
 * validé plus tard sans mentir au joueur sur son solde entre-temps. Mieux vaut
 * lui dire tout de suite que ça n'a pas marché.
 *
 * @returns {Promise<{success: boolean, error?: string, coins?: number,
 *   alreadyOwned?: boolean, price?: number}>}
 */
export async function buyItem({ kind, itemId }) {
  if (!requireReady('buyItem') || !requireGameId('buyItem')) {
    return { success: false, error: 'not-ready' };
  }
  const result = await post('/api/game/purchase', { gameId: getGameId(), kind, itemId });
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

/**
 * Équipe un objet déjà possédé.
 *
 * C'est le MÊME appel qu'un achat : le serveur, voyant que l'objet est déjà
 * possédé, se contente de l'équiper sans débiter. Ce n'est pas un détour —
 * c'est la seule voie, les règles Firestore n'autorisant pas le client à
 * écrire son champ d'équipement (voir l'en-tête de ce fichier).
 */
export function equipItem({ kind, itemId }) {
  return buyItem({ kind, itemId });
}
