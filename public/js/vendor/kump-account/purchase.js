// Achat d'un objet payé avec la monnaie du jeu — en UNE transaction.
//
// Pourquoi une transaction plutôt que deux écritures : c'est la faille SEC-05
// de l'audit Androgame, à ne jamais réintroduire dans un jeu KUMP. Le code
// d'origine débitait les pièces puis débloquait l'objet en deux appels
// indépendants, et vérifiait le solde depuis le stockage LOCAL du joueur.
// Conséquence : en gonflant son solde local (une ligne dans la console du
// navigateur), le débit était rejeté par les règles pendant que le déblocage
// passait quand même — objets gratuits à volonté.
//
// Ici : le solde est relu DANS la transaction, côté serveur, et les trois
// changements (débiter, débloquer, équiper) partent ensemble ou pas du tout.
//
// ⚠️ Le PRIX reste fourni par le jeu, donc par le client. Un joueur qui
// modifie le jeu peut annoncer un prix de 0. Fermer ça demande une Cloud
// Function qui détient le catalogue (voir README > Limites). Cette
// transaction ferme la désynchronisation, pas encore la falsification du prix.

import { doc, runTransaction, arrayUnion } from 'firebase/firestore';
import { getKumpContext, requireReady, requireGameId, getGameId } from './core.js';
import { ensureSignedIn } from './auth.js';

/**
 * @param {object}  options
 * @param {string}  options.itemId         Identifiant de l'objet acheté.
 * @param {number}  options.price          Prix, dans la monnaie du jeu.
 * @param {string}  options.ownedField     Champ tableau des objets possédés, ex. 'ownedSkins'.
 * @param {string} [options.equippedField] Champ à mettre à jour pour équiper l'objet dans la foulée.
 * @param {string} [options.coinsField='coins'] Champ du solde dans les données du jeu.
 * @returns {Promise<{success: boolean, error?: string, alreadyOwned?: boolean, remaining?: number}>}
 *   `error` vaut 'insufficient-coins', 'not-signed-in', 'no-data' ou 'unknown'.
 */
export async function purchaseGameItem({
  itemId,
  price,
  ownedField,
  equippedField,
  coinsField = 'coins',
} = {}) {
  if (!requireReady('purchaseGameItem') || !requireGameId('purchaseGameItem')) return { success: false, error: 'not-ready' };
  if (!itemId || !ownedField || !Number.isFinite(price) || price < 0) {
    console.error('[kump] purchaseGameItem: paramètres invalides.');
    return { success: false, error: 'invalid-args' };
  }

  const user = await ensureSignedIn();
  if (!user) return { success: false, error: 'not-signed-in' };

  const { db } = getKumpContext();
  const ref = doc(db, 'users', user.uid, 'games', getGameId());

  try {
    return await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) {
        // Aucune donnée de jeu : le joueur n'a jamais joué, il ne peut pas
        // avoir de monnaie. Refuser plutôt que de créer un document à la
        // volée, qui masquerait un vrai problème de synchronisation.
        throw new Error('no-data');
      }

      const data = snapshot.data();
      const coins = typeof data[coinsField] === 'number' ? data[coinsField] : 0;
      const owned = Array.isArray(data[ownedField]) ? data[ownedField] : [];

      // Déjà possédé (acheté depuis un autre appareil entre-temps) : on
      // équipe sans débiter une seconde fois.
      if (owned.includes(itemId)) {
        if (equippedField) transaction.update(ref, { [equippedField]: itemId });
        return { success: true, alreadyOwned: true, remaining: coins };
      }

      if (coins < price) throw new Error('insufficient-coins');

      const changes = {
        [coinsField]: coins - price,
        [ownedField]: arrayUnion(itemId),
      };
      if (equippedField) changes[equippedField] = itemId;
      transaction.update(ref, changes);

      return { success: true, alreadyOwned: false, remaining: coins - price };
    });
  } catch (error) {
    const known = ['insufficient-coins', 'no-data'];
    const code = known.includes(error?.message) ? error.message : 'unknown';
    if (code === 'unknown') console.error('[kump] purchaseGameItem a échoué', error);
    return { success: false, error: code };
  }
}
