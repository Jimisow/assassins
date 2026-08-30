// Écran de compte prêt à l'emploi : connexion, création de compte, profil.
//
// C'EST LA RAISON D'ÊTRE DE CETTE COUCHE. Cet écran a été écrit trois fois —
// Androgame, D-Track, Assassins — avec à chaque fois les mêmes pièges à
// repayer. Il vit désormais ici, une seule fois, avec tous les correctifs
// déjà trouvés. Un nouveau jeu appelle `openKumpAccount()` et n'a plus qu'à
// redéfinir les variables CSS (voir theme.js).
//
// LES QUATRE PIÈGES QU'IL FERME, à ne défaire sous aucun prétexte :
//
// 1. **Ouvrir cet écran ne crée AUCUN compte.** On observe l'identité
//    (`onUserChanged`) sans jamais appeler `ensureSignedIn()` tant que le
//    joueur n'agit pas. L'inverse fabriquerait un compte anonyme fantôme à
//    chaque coup d'œil, et la base se remplirait de comptes vides.
// 2. **On ne reconstruit pas l'écran à chaque événement d'identité.** « Créer
//    mon compte » appelle d'abord `ensureSignedIn()` : l'utilisateur passe de
//    `null` à anonyme AU MILIEU de la saisie. Redessiner là vidait le
//    formulaire et effaçait le message d'erreur — symptôme observé : un mot de
//    passe trop court ne produisait aucun message.
// 3. **`onAuthStateChanged` ne se déclenche PAS lors d'un `link*`.** Rattacher
//    un email à un compte anonyme n'en change pas l'identifiant : pour
//    Firebase, c'est le même utilisateur. Sans bascule explicite vers le
//    profil, le joueur créait son compte et l'écran ne bougeait pas.
// 4. **« Ce compte Google est déjà pris » n'est pas une impasse.** C'est le cas
//    le PLUS FRÉQUENT dès qu'un joueur a un profil créé depuis un autre jeu :
//    l'écran propose de s'y connecter, en disant franchement ce que ça coûte.
//
// ⚠️ `link*` et jamais `signIn*` pour CRÉER un compte : le joueur a déjà une
// progression sur son compte anonyme. `link*` la garde, `signIn*` l'abandonne.

import { ensureSignedIn, isGuest, linkWithEmail, signInWithEmail, signOutKump } from '../auth.js';
import { onUserChanged } from '../auth.js';
import { linkWithGoogle, signInWithGoogle } from '../providers.js';
import { getProfile, setDisplayName } from '../profile.js';
import { loadGameData, getUnlockedTrophies } from '../gameData.js';
import { getGameCatalog } from '../catalog.js';
import { isKumpReady } from '../core.js';
import { kumpMessage, isSilentCode } from '../messages.js';
import { el, openDialog, renderLoading, formatDuration } from './dom.js';

/**
 * Ouvre l'écran de compte.
 *
 * @param {object}   [options]
 * @param {object}   [options.messages]  Remplacements de messages (voir messages.js).
 * @param {Function} [options.onChange]  Appelé quand l'identité change — pour
 *   rafraîchir un bouton « Compte » ailleurs dans la page.
 * @param {Array<{label: string, value: (data: object) => string}>} [options.stats]
 *   Statistiques propres au jeu à afficher en tuiles. Sans ça, seuls le temps
 *   de jeu et les trophées apparaissent — ce qui reste utile, mais générique.
 * @param {string}   [options.profileUrl] Lien « voir tous mes jeux ».
 * @returns {{ close: () => void }|null} `null` si le module n'est pas prêt.
 */
export function openKumpAccount(options = {}) {
  if (!isKumpReady()) {
    console.warn('[kump] openKumpAccount: module non initialisé — appel ignoré.');
    return null;
  }
  const { messages, onChange, stats = [], profileUrl = 'https://kump.fr/profil' } = options;
  const msg = (code) => kumpMessage(code, messages);

  let vue = null;
  let unwatch = null;

  const dialogue = openDialog({
    title: 'Compte KUMP',
    onClose: () => unwatch?.(),
  });

  renderLoading(dialogue.body);

  // On OBSERVE l'identité, on ne la force pas (piège 1), et on ne reconstruit
  // que si la VUE change réellement (piège 2).
  unwatch = onUserChanged((user) => {
    onChange?.();
    const cible = user && !user.isAnonymous ? 'profil' : 'invite';
    if (cible === vue) return;
    vue = cible;
    if (cible === 'profil') rendreProfil();
    else rendreInvite(Boolean(user));
  });

  /** Bascule explicite vers le profil — voir piège 3. */
  function allerAuProfil() {
    vue = 'profil';
    rendreProfil();
  }

  // --- Invité : créer un compte, ou se connecter ---------------------------

  function rendreInvite(connecte) {
    let mode = 'creation'; // « créer » d'abord : c'est le cas courant

    const alerte = el('p', { class: 'kump-alert', role: 'alert', hidden: true });
    const email = el('input', { class: 'kump-input', type: 'email', id: 'kump-email', autocomplete: 'email', placeholder: 'vous@exemple.fr' });
    const mdp = el('input', { class: 'kump-input', type: 'password', id: 'kump-mdp', autocomplete: 'new-password', placeholder: '6 caractères minimum' });
    const valider = el('button', { class: 'kump-btn kump-btn-primary kump-btn-block' });
    const bascule = el('button', { class: 'kump-btn kump-btn-quiet' });
    const explication = el('p', { class: 'kump-note' });

    function erreur(code) {
      if (isSilentCode(code)) return; // fermer la fenêtre Google n'est pas une erreur
      alerte.textContent = msg(code);
      alerte.classList.remove('kump-info');
      alerte.hidden = false;
      reprise.hidden = true;
    }

    /** Piège 4 : ce compte appartient à un autre profil — on propose la sortie. */
    function proposerConnexion() {
      alerte.textContent = msg('credential-in-use');
      alerte.classList.add('kump-info'); // ton neutre : ce n'est pas un échec
      alerte.hidden = false;
      reprise.hidden = false;
      // La sortie est plus bas que le pli de la carte : sans ça le joueur voit
      // un bandeau et rien d'autre, et se croit bloqué.
      reprise.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const google = el('button', {
      class: 'kump-btn kump-btn-block',
      onclick: async () => {
        await ensureSignedIn();
        const r = await linkWithGoogle();
        if (r.success) { onChange?.(); return allerAuProfil(); }
        if (r.error === 'credential-in-use') return proposerConnexion();
        erreur(r.error);
      },
    }, 'Continuer avec Google');

    const reprise = el('div', { class: 'kump-box', hidden: true },
      el('p', { class: 'kump-note' },
        'Vous connecter récupérera ce profil et tout ce qu’il contient. En revanche, les parties jouées ici sans compte ne seront pas reprises.'),
      el('button', {
        class: 'kump-btn kump-btn-primary kump-btn-block',
        onclick: async () => {
          const r = await signInWithGoogle();
          if (!r.success) return erreur(r.error);
          onChange?.();
          allerAuProfil();
        },
      }, 'Me connecter avec ce compte'));

    function appliquerMode() {
      alerte.hidden = true;
      alerte.classList.remove('kump-info');
      reprise.hidden = true;
      const creation = mode === 'creation';
      valider.textContent = creation ? 'Créer mon compte' : 'Me connecter';
      bascule.textContent = creation ? 'J’ai déjà un compte' : 'Créer un compte à la place';
      mdp.setAttribute('autocomplete', creation ? 'new-password' : 'current-password');
      // La différence n'est PAS cosmétique et le joueur doit la comprendre
      // AVANT de cliquer : créer rattache ses parties, se connecter bascule sur
      // un autre compte et les abandonne.
      explication.textContent = creation
        ? connecte
          ? 'Vos parties déjà jouées sur cet appareil seront rattachées à ce compte — rien n’est perdu.'
          : 'Votre compte vous suivra sur vos autres appareils, et sur vos autres jeux KUMP.'
        : 'Attention : vous retrouverez les parties de CE compte. Celles jouées ici sans compte ne seront pas reprises.';
    }

    async function envoyer() {
      const adresse = email.value.trim();
      if (!adresse || !mdp.value) return erreur('invalid-email');
      valider.disabled = true;
      valider.textContent = 'Un instant…';
      let r;
      if (mode === 'creation') {
        // Un compte anonyme doit exister pour qu'il y ait quelque chose à
        // rattacher — c'est CET appel qui déclenche le piège 2.
        await ensureSignedIn();
        r = await linkWithEmail(adresse, mdp.value);
      } else {
        r = await signInWithEmail(adresse, mdp.value);
      }
      valider.disabled = false;
      appliquerMode();
      if (!r.success) return erreur(r.error);
      onChange?.();
      allerAuProfil();
    }

    valider.addEventListener('click', envoyer);
    mdp.addEventListener('keydown', (e) => { if (e.key === 'Enter') envoyer(); });
    bascule.addEventListener('click', () => {
      mode = mode === 'creation' ? 'connexion' : 'creation';
      appliquerMode();
    });

    dialogue.body.replaceChildren(
      el('p', { class: 'kump-intro' },
        'Un seul compte pour tous les jeux KUMP : vos parties, votre temps de jeu et vos trophées vous suivent d’un appareil à l’autre.'),
      alerte,
      el('label', { class: 'kump-label', for: 'kump-email' }, 'Email'),
      email,
      el('label', { class: 'kump-label', for: 'kump-mdp' }, 'Mot de passe'),
      mdp,
      valider,
      explication,
      el('div', { class: 'kump-sep' }, 'ou'),
      google,
      reprise,
      el('div', { class: 'kump-center' }, bascule),
    );
    appliquerMode();
  }

  // --- Connecté : le profil ------------------------------------------------

  async function rendreProfil() {
    renderLoading(dialogue.body);

    // Les quatre lectures partent ensemble : séquentiellement, l'écran
    // resterait sur « Chargement… » le temps de quatre allers-retours.
    const [profil, donnees, trophees, catalogue] = await Promise.all([
      getProfile(),
      loadGameData(),
      getUnlockedTrophies(),
      getGameCatalog(),
    ]);
    if (vue !== 'profil') return; // fermé, ou déconnecté entre-temps
    if (!profil) {
      dialogue.body.replaceChildren(el('p', { class: 'kump-alert' }, msg('unknown')));
      return;
    }
    onChange?.();

    const data = donnees ?? {};
    const obtenus = new Set(trophees.map((t) => t.id));
    // Un catalogue absent ne doit jamais donner un écran vide : on retombe sur
    // les identifiants bruts des trophées réellement obtenus.
    const liste = catalogue?.trophies?.length
      ? catalogue.trophies
      : trophees.map((t) => ({ id: t.id, label: t.id, description: '' }));

    const pseudo = el('input', { class: 'kump-input', type: 'text', maxlength: '16', value: profil.displayName });
    const retour = el('p', { class: 'kump-note' });

    const tuiles = [
      el('div', { class: 'kump-tile' },
        el('strong', {}, formatDuration(profil.totalPlaytimeMs)),
        el('span', {}, 'Temps de jeu (tous jeux)')),
      el('div', { class: 'kump-tile' },
        el('strong', {}, `${obtenus.size} / ${liste.length}`),
        el('span', {}, 'Trophées')),
      // Statistiques propres au jeu, déclarées par l'appelant : le module ne
      // peut pas les deviner, et les inventer donnerait des chiffres faux.
      ...stats.map((stat) => el('div', { class: 'kump-tile' },
        el('strong', {}, String(stat.value(data) ?? '—')),
        el('span', {}, stat.label))),
    ];

    dialogue.body.replaceChildren(
      el('div', { class: 'kump-identity' },
        el('div', { class: 'kump-avatar', 'aria-hidden': 'true' }, profil.displayName.slice(0, 1).toUpperCase()),
        el('div', {},
          el('strong', {}, profil.displayName),
          el('span', { class: 'kump-email' }, profil.email ?? 'Compte externe'))),
      el('div', { class: 'kump-tiles' }, tuiles),
      el('h3', { class: 'kump-subtitle' }, `Trophées ${obtenus.size} / ${liste.length}`),
      el('div', { class: 'kump-chips' },
        liste.map((t) => el('span', {
          class: `kump-chip ${obtenus.has(t.id) ? 'kump-on' : 'kump-off'}`,
          title: t.description || t.label,
        }, t.label))),
      el('h3', { class: 'kump-subtitle' }, 'Pseudo'),
      el('div', { class: 'kump-row' },
        pseudo,
        el('button', {
          class: 'kump-btn',
          onclick: async () => {
            const r = await setDisplayName(pseudo.value);
            retour.textContent = r.success ? 'Pseudo mis à jour.' : msg(r.error);
            onChange?.();
          },
        }, 'Changer')),
      retour,
      el('p', { class: 'kump-note' },
        'Retrouvez tous vos jeux KUMP sur ',
        el('a', { href: profileUrl, target: '_blank', rel: 'noopener' }, 'kump.fr/profil'),
        '.'),
      el('button', {
        class: 'kump-btn kump-btn-danger kump-btn-block',
        onclick: async () => {
          await signOutKump();
          onChange?.();
          dialogue.close();
        },
      }, 'Se déconnecter'),
    );
  }

  return { close: dialogue.close };
}

export { isGuest };
