// Couche VISIBLE du module : des écrans prêts à l'emploi.
//
// Volontairement séparée de `src/index.js` : le cœur du module reste sans
// interface, et un projet qui a déjà ses propres écrans (kump.fr, en React)
// n'importe rien de tout ceci. Les jeux, eux, obtiennent des écrans qui
// fonctionnent dès l'installation et n'ont plus qu'à redéfinir les variables
// CSS (voir theme.js).

export { openKumpAccount } from './account.js';
export { openKumpShop } from './shop.js';
export { applyKumpTheme, KUMP_THEME_DEFAULTS } from './theme.js';
export { el, openDialog, formatDuration } from './dom.js';
