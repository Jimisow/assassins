// Briques communes aux écrans du module : création d'éléments et dialogue
// accessible.
//
// Volontairement minuscule et sans dépendance : ces écrans doivent pouvoir
// tourner dans un jeu sans bundler (Assassins), dans un jeu Vite (D-Track,
// Androgame) et à côté de n'importe quel framework, sans rien imposer.

import { applyKumpTheme } from './theme.js';

/** `el('div', { class: 'x', onclick: fn }, enfant, 'texte')` */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(attrs)) {
    if (cle.startsWith('on') && typeof valeur === 'function') {
      node.addEventListener(cle.slice(2), valeur);
    } else if (cle === 'class') {
      node.className = valeur;
    } else if (valeur !== false && valeur !== null && valeur !== undefined) {
      node.setAttribute(cle, valeur === true ? '' : valeur);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

/**
 * Ouvre un dialogue accessible et renvoie de quoi le piloter.
 *
 * Reprend le patron déjà éprouvé sur kump.fr et dans les jeux : `role="dialog"`
 * + `aria-modal`, fermeture à l'Échap et au clic sur le fond, verrou de
 * défilement de la page, focus posé sur le dialogue à l'ouverture et **rendu au
 * bouton qui l'a déclenché** à la fermeture.
 *
 * ⚠️ Le verrou de défilement restaure la valeur PRÉCÉDENTE de `overflow`, pas
 * `''` : une page qui bloquait déjà son défilement (un jeu en plein écran, par
 * exemple) se retrouverait sinon déverrouillée en fermant l'écran de compte.
 *
 * @returns {{ body: HTMLElement, close: () => void, card: HTMLElement }}
 */
export function openDialog({ title, label, onClose }) {
  applyKumpTheme();

  const declencheur = document.activeElement;
  const overflowPrecedent = document.body.style.overflow;

  const body = el('div', { class: 'kump-body' });
  const card = el('div', {
      class: 'kump-card',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': label ?? title,
      tabindex: '-1',
    },
    el('button', { class: 'kump-close', 'aria-label': 'Fermer', onclick: () => close() }, '×'),
    title ? el('h2', { class: 'kump-title' }, title) : null,
    body,
  );

  const overlay = el('div', {
    class: 'kump-overlay',
    onclick: (event) => { if (event.target === overlay) close(); },
  }, card);

  function surTouche(event) {
    if (event.key === 'Escape') close();
  }

  let ferme = false;
  function close() {
    if (ferme) return;
    ferme = true;
    document.removeEventListener('keydown', surTouche);
    document.body.style.overflow = overflowPrecedent;
    overlay.remove();
    if (declencheur && typeof declencheur.focus === 'function') declencheur.focus();
    onClose?.();
  }

  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', surTouche);
  card.focus();

  return { body, card, close };
}

/** Remplace le contenu d'un conteneur par un état de chargement. */
export function renderLoading(container, texte = 'Chargement…') {
  container.replaceChildren(el('p', { class: 'kump-loading' }, texte));
}

/** « 2 h 34 » / « 12 min » / « 45 s » — jamais « 0.7 heures », jamais « — »
 *  pour une durée qui existe vraiment. */
export function formatDuration(ms) {
  if (!ms || ms < 1000) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)} s`;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${reste}`;
}
