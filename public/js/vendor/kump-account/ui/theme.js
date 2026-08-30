// Habillage des écrans fournis par le module.
//
// TOUT passe par des variables CSS. C'est le contrat de cette couche : un jeu
// installe le module, obtient des écrans qui FONCTIONNENT, et n'a plus qu'à
// redéfinir une douzaine de variables pour qu'ils aient l'air d'appartenir à
// son univers. Aucun jeu ne devrait avoir à réécrire un écran de compte.
//
// POURQUOI LE CSS EST INJECTÉ PAR JAVASCRIPT, et pas livré en fichier `.css` :
// Assassins n'a AUCUN bundler — il ne peut pas faire `import './theme.css'`.
// Un `<style>` posé au premier usage marche partout, avec ou sans build, et
// n'impose aucune étape de copie de fichier.
//
// ⚠️ Toutes les classes sont préfixées `kump-`. Ces écrans s'insèrent dans des
// pages qui ont déjà leur propre CSS : une classe `.card` ou `.modal` entrerait
// en collision avec celle du jeu, et le jeu gagnerait ou perdrait selon
// l'ordre de chargement — un bug invisible et impossible à diagnostiquer.

const STYLE_ID = 'kump-account-styles';

/**
 * Valeurs par défaut. Un jeu les remplace en posant les mêmes variables sur
 * `:root` dans son propre CSS (il gagne, sa règle arrivant après), ou en
 * passant un objet à `applyKumpTheme()`.
 */
export const KUMP_THEME_DEFAULTS = {
  '--kump-bg': 'rgba(8, 9, 12, 0.82)',
  '--kump-surface': '#14161d',
  '--kump-surface-2': '#1c1f28',
  '--kump-border': '#2a2e3a',
  '--kump-text': '#eef0f6',
  '--kump-text-dim': '#9aa0b0',
  '--kump-accent': '#6c5ce7',
  '--kump-accent-text': '#ffffff',
  '--kump-danger': '#ef4444',
  '--kump-radius': '12px',
  '--kump-radius-sm': '8px',
  '--kump-font': 'inherit',
};

const CSS = `
.kump-overlay {
  position: fixed; inset: 0; z-index: 9000;
  display: grid; place-items: center; padding: 16px;
  background: var(--kump-bg); backdrop-filter: blur(4px);
  font-family: var(--kump-font); color: var(--kump-text);
  box-sizing: border-box;
}
.kump-overlay * { box-sizing: border-box; }
.kump-overlay[hidden] { display: none; }
.kump-card {
  position: relative; width: min(440px, 100%); max-height: min(88vh, 760px);
  overflow-y: auto; background: var(--kump-surface);
  border: 1px solid var(--kump-border); border-radius: var(--kump-radius);
  padding: 22px 20px 20px;
}
.kump-card:focus { outline: none; }
.kump-close {
  position: absolute; top: 8px; right: 10px;
  background: none; border: none; color: var(--kump-text-dim);
  font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 4px 8px;
}
.kump-close:hover { color: var(--kump-text); }
.kump-title { margin: 0 0 4px; font-size: 1.25rem; }
.kump-subtitle { margin: 18px 0 8px; font-size: .95rem; color: var(--kump-text-dim); }
.kump-note, .kump-intro { color: var(--kump-text-dim); font-size: .85rem; line-height: 1.5; }
.kump-intro { margin: 0 0 14px; }
.kump-note { margin: 10px 0 0; }
.kump-note a { color: var(--kump-accent); }
.kump-loading { color: var(--kump-text-dim); text-align: center; padding: 26px 0; }

.kump-alert {
  margin: 0 0 12px; padding: 9px 12px; border-radius: var(--kump-radius-sm);
  font-size: .85rem;
  background: color-mix(in srgb, var(--kump-danger) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--kump-danger) 45%, transparent);
}
/* Variante NEUTRE : pour une situation qui a une issue (« ce compte Google
   appartient déjà à un profil »), pas pour un échec. Le rouge est réservé à ce
   qui a vraiment échoué — sinon on alarme pour rien. */
.kump-alert.kump-info {
  background: var(--kump-surface-2);
  border-color: var(--kump-border);
}
.kump-alert[hidden] { display: none; }

.kump-label { display: block; margin: 10px 0 4px; font-size: .82rem; color: var(--kump-text-dim); }
.kump-input {
  width: 100%; padding: 11px 13px; border-radius: var(--kump-radius-sm);
  border: 1px solid var(--kump-border); background: var(--kump-surface-2);
  color: var(--kump-text); font: inherit;
}
.kump-input:focus { outline: none; border-color: var(--kump-accent); }

.kump-btn {
  border: 1px solid var(--kump-border); background: var(--kump-surface-2);
  color: var(--kump-text); font: inherit; padding: 10px 14px;
  border-radius: var(--kump-radius-sm); cursor: pointer;
}
.kump-btn:hover { border-color: var(--kump-accent); }
.kump-btn:disabled { opacity: .5; cursor: not-allowed; }
.kump-btn-primary { background: var(--kump-accent); color: var(--kump-accent-text); border-color: transparent; }
.kump-btn-block { display: block; width: 100%; margin-top: 12px; }
.kump-btn-quiet { background: none; border-color: transparent; color: var(--kump-text-dim); }
.kump-btn-danger { background: none; border-color: transparent; color: var(--kump-danger); }

.kump-sep { display: flex; align-items: center; gap: 10px; margin: 16px 0 4px; color: var(--kump-text-dim); font-size: .8rem; }
.kump-sep::before, .kump-sep::after { content: ''; flex: 1; height: 1px; background: var(--kump-border); }
.kump-center { margin-top: 14px; text-align: center; }

.kump-identity { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.kump-identity strong { display: block; }
.kump-email { color: var(--kump-text-dim); font-size: .82rem; word-break: break-all; }
.kump-avatar {
  flex: none; width: 46px; height: 46px; display: grid; place-items: center;
  border-radius: var(--kump-radius-sm); background: var(--kump-surface-2);
  border: 1px solid var(--kump-border); color: var(--kump-accent);
  font-size: 1.3rem; font-weight: 800;
}

.kump-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.kump-tile { background: var(--kump-surface-2); border: 1px solid var(--kump-border); border-radius: var(--kump-radius-sm); padding: 10px 12px; }
.kump-tile strong { display: block; font-size: 1.15rem; }
.kump-tile span { color: var(--kump-text-dim); font-size: .75rem; }

.kump-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.kump-chip { padding: 5px 10px; border-radius: 999px; font-size: .78rem; border: 1px solid var(--kump-border); }
/* Les objets non obtenus restent VISIBLES, en retrait : ils disent au joueur
   ce qui reste à faire. Les masquer priverait la liste de son intérêt. */
.kump-chip.kump-on { background: color-mix(in srgb, var(--kump-accent) 22%, transparent); border-color: var(--kump-accent); }
.kump-chip.kump-off { color: var(--kump-text-dim); opacity: .6; }

.kump-row { display: flex; gap: 8px; align-items: center; }
.kump-row .kump-input { flex: 1; }
.kump-box { margin-top: 12px; padding: 12px; border: 1px solid var(--kump-border); border-radius: var(--kump-radius-sm); background: var(--kump-surface-2); }
.kump-box[hidden] { display: none; }
.kump-box .kump-note { margin: 0 0 4px; }

.kump-balance { display: flex; align-items: baseline; gap: 6px; margin-bottom: 14px; }
.kump-balance strong { font-size: 1.5rem; }
.kump-balance span { color: var(--kump-text-dim); font-size: .85rem; }

.kump-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 0;
  border-top: 1px solid var(--kump-border);
}
.kump-item-main { flex: 1; min-width: 0; }
.kump-item-main strong { display: block; font-size: .95rem; }
.kump-item-main span { color: var(--kump-text-dim); font-size: .78rem; }
.kump-price { font-variant-numeric: tabular-nums; color: var(--kump-text-dim); font-size: .85rem; }
`;

/**
 * Injecte la feuille de style du module, une seule fois.
 *
 * Appelée automatiquement à l'ouverture d'un écran : un jeu n'a jamais besoin
 * de l'appeler lui-même.
 *
 * @param {Record<string,string>} [overrides] Variables à remplacer.
 */
export function applyKumpTheme(overrides) {
  if (typeof document === 'undefined') return;

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    const vars = Object.entries(KUMP_THEME_DEFAULTS)
      .map(([nom, valeur]) => `  ${nom}: ${valeur};`)
      .join('\n');
    // `:where(:root)` : spécificité ZÉRO. C'est ce qui permet à un jeu de
    // redéfinir n'importe quelle variable dans son propre `:root` sans avoir
    // à batailler avec `!important`, quel que soit l'ordre de chargement.
    style.textContent = `:where(:root) {\n${vars}\n}\n${CSS}`;
    document.head.append(style);
  }

  if (overrides) {
    for (const [nom, valeur] of Object.entries(overrides)) {
      document.documentElement.style.setProperty(nom, valeur);
    }
  }
}
