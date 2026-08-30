// Écran de boutique prêt à l'emploi.
//
// Le jeu ne connaît ni les objets ni les prix : tout vient du serveur
// (`/api/game/shop`), qui est aussi celui qui applique les prix à l'achat. Les
// deux lisent le même registre, donc ce que le joueur VOIT est exactement ce
// qui lui sera facturé — impossible de faire diverger l'étiquette et la caisse.
//
// ⚠️ ÉQUIPER PASSE PAR LE SERVEUR, comme acheter. Les règles Firestore
// n'autorisent le client à écrire que `equippedSkin` et `equippedTrail` (noms
// hérités d'Androgame) : un jeu neuf ne peut pas écrire son propre champ
// d'équipement. `equipItem()` est donc le même appel qu'un achat, et le serveur
// n'y débite rien puisque l'objet est déjà possédé. Ce n'est pas un détour,
// c'est la seule voie.
//
// ⚠️ Le solde affiché vient TOUJOURS de la réponse du serveur après un achat,
// jamais d'un calcul local (`solde - prix`). Recalculer côté client, c'est
// exactement la faille SEC-05 d'Androgame : l'affichage finit par diverger du
// solde réel, et le joueur croit avoir de quoi acheter.

import { isKumpReady } from '../core.js';
import { getShopCatalog, getShopState, buyItem } from '../shop.js';
import { kumpMessage, isSilentCode } from '../messages.js';
import { el, openDialog, renderLoading } from './dom.js';

/**
 * Ouvre la boutique du jeu courant.
 *
 * @param {object}   [options]
 * @param {object}   [options.messages] Remplacements de messages.
 * @param {Function} [options.onChange] Appelé après tout achat ou équipement —
 *   c'est là qu'un jeu recharge l'apparence équipée.
 * @returns {{ close: () => void }|null}
 */
export function openKumpShop(options = {}) {
  if (!isKumpReady()) {
    console.warn('[kump] openKumpShop: module non initialisé — appel ignoré.');
    return null;
  }
  const { messages, onChange } = options;
  const msg = (code) => kumpMessage(code, messages);

  const dialogue = openDialog({ title: 'Boutique' });
  renderLoading(dialogue.body);
  rendre();

  async function rendre() {
    const [catalogue, etat] = await Promise.all([getShopCatalog(), getShopState()]);

    // Boutique indisponible ≠ boutique vide. Afficher une liste vide laisserait
    // croire qu'il n'y a rien à acheter, alors que le serveur n'a pas répondu.
    if (!catalogue || !etat) {
      dialogue.body.replaceChildren(
        el('p', { class: 'kump-alert' }, 'Boutique indisponible pour le moment.'),
        el('p', { class: 'kump-note' }, 'Vérifiez votre connexion et réessayez.'),
      );
      return;
    }

    const alerte = el('p', { class: 'kump-alert', role: 'alert', hidden: true });
    const solde = el('strong', {}, String(etat.coins));

    function erreur(code) {
      if (isSilentCode(code)) return;
      alerte.textContent = msg(code);
      alerte.hidden = false;
    }

    async function agir(kind, item, bouton) {
      alerte.hidden = true;
      bouton.disabled = true;
      const r = await buyItem({ kind: kind.kind, itemId: item.id });
      bouton.disabled = false;
      if (!r.success) return erreur(r.error);
      onChange?.();
      // On redessine à partir de l'état RÉEL relu, plutôt que de bricoler le
      // DOM : c'est ce qui garantit que le solde, les objets possédés et
      // l'objet équipé restent cohérents entre eux après n'importe quelle
      // action.
      rendre();
    }

    const sections = catalogue.kinds.map((kind) => {
      const possedes = new Set(etat.owned[kind.kind] ?? []);
      const equipe = etat.equipped[kind.kind];

      return el('div', {},
        el('h3', { class: 'kump-subtitle' }, kind.label),
        ...kind.items.map((item) => {
          const possede = possedes.has(item.id) || item.price === 0;
          const porte = equipe === item.id;
          const bouton = el('button', {
            class: `kump-btn ${porte ? '' : 'kump-btn-primary'}`,
            disabled: porte,
          }, porte ? 'Équipé' : possede ? 'Équiper' : 'Acheter');
          if (!porte) bouton.addEventListener('click', () => agir(kind, item, bouton));

          return el('div', { class: 'kump-item' },
            el('div', { class: 'kump-item-main' },
              el('strong', {}, item.label),
              item.description ? el('span', {}, item.description) : null),
            // Le prix ne s'affiche que s'il reste à payer : « 120 » à côté d'un
            // objet déjà possédé donne l'impression qu'on va payer deux fois.
            possede ? null : el('span', { class: 'kump-price' }, `${item.price} ${catalogue.currencyLabel}`),
            bouton);
        }),
      );
    });

    dialogue.body.replaceChildren(
      el('div', { class: 'kump-balance' }, solde, el('span', {}, catalogue.currencyLabel)),
      alerte,
      ...sections,
    );
  }

  return { close: dialogue.close };
}
