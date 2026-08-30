// Connexion par fournisseur externe : Google et Apple.
//
// Deux usages, à ne pas confondre :
//
//   linkWithGoogle()   RATTACHE le compte anonyme en cours à un compte Google.
//                      Le joueur garde son identifiant interne, donc toute sa
//                      progression. C'est ce qu'un JEU doit proposer.
//
//   signInWithGoogle() BASCULE vers le compte Google, en abandonnant la
//                      session en cours. C'est ce qu'un SITE doit proposer
//                      (il n'y a pas de progression anonyme à préserver).
//
// Un jeu qui appellerait `signIn` au lieu de `link` ferait perdre au joueur
// tout ce qu'il a accumulé avant de créer son compte — d'où deux fonctions
// distinctes plutôt qu'une seule avec un drapeau.

import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  linkWithPopup,
} from 'firebase/auth';
import { getKumpContext, requireReady } from './core.js';
import { ensureProfile } from './profile.js';

function googleProvider() {
  const provider = new GoogleAuthProvider();
  // Force le choix du compte : sans ça, un navigateur déjà connecté à un
  // compte Google enchaîne sans rien demander, ce qui surprend le joueur qui
  // voulait en utiliser un autre.
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function appleProvider() {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  return provider;
}

/**
 * Connexion (ou inscription automatique) via Google. Pour un SITE.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function signInWithGoogle() {
  return runProvider('signInWithGoogle', googleProvider(), 'signin');
}

/** Connexion via Apple. Pour un SITE. */
export async function signInWithApple() {
  return runProvider('signInWithApple', appleProvider(), 'signin');
}

/**
 * Rattache le compte anonyme courant à un compte Google — la progression est
 * conservée. Pour un JEU.
 *
 * ⚠️ Échoue avec `credential-in-use` si ce compte Google appartient déjà à un
 * autre profil KUMP (cas courant : le joueur a déjà un compte créé depuis un
 * autre jeu). Ce n'est PAS une impasse — l'appelant doit alors proposer
 * `signInWithGoogle()`, en prévenant que la session anonyme sera abandonnée.
 */
export async function linkWithGoogle() {
  return runProvider('linkWithGoogle', googleProvider(), 'link');
}

/** Rattache le compte anonyme courant à un compte Apple. Pour un JEU. */
export async function linkWithApple() {
  return runProvider('linkWithApple', appleProvider(), 'link');
}

async function runProvider(fnName, provider, mode) {
  if (!requireReady(fnName)) return { success: false, error: 'not-ready' };
  const { auth } = getKumpContext();

  try {
    let credential;
    if (mode === 'link') {
      const user = auth.currentUser;
      if (!user) return { success: false, error: 'not-signed-in' };
      credential = await linkWithPopup(user, provider);
    } else {
      credential = await signInWithPopup(auth, provider);
    }
    await ensureProfile(credential.user);
    return { success: true };
  } catch (error) {
    return { success: false, error: mapProviderError(error) };
  }
}

// Codes courts et stables, pour que chaque appelant écrive ses propres
// messages sans dépendre du texte exact de Firebase.
function mapProviderError(error) {
  const code = String(error?.code ?? '');

  // Le fournisseur n'est pas activé dans la console Firebase. Cas courant
  // pour Apple, qui demande un compte développeur Apple payant : mieux vaut
  // un message explicite qu'une erreur brute incompréhensible.
  if (code.includes('operation-not-allowed')) return 'provider-disabled';

  // L'utilisateur a fermé la fenêtre : ce n'est pas une erreur, l'appelant ne
  // doit rien afficher d'alarmant.
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
    return 'cancelled';
  }
  if (code.includes('popup-blocked')) return 'popup-blocked';

  // ⚠️ TROIS SITUATIONS DISTINCTES, longtemps confondues sous un seul code
  // `already-linked`. Elles n'ont pas du tout la même sortie pour le joueur,
  // et les mélanger menait à une impasse : le message disait « ce compte est
  // déjà rattaché à un autre profil » sans proposer quoi que ce soit, alors
  // que dans le cas le plus fréquent il suffisait de SE CONNECTER.
  //
  // Cas le plus fréquent, et le seul qui a une vraie issue : ce compte Google
  // appartient à un AUTRE compte KUMP — typiquement le joueur a déjà un profil
  // créé depuis un autre jeu. Firebase refuse de rattacher une identité déjà
  // prise, ce qui est correct. La sortie est de basculer sur ce compte
  // (`signInWithGoogle`), en prévenant que la session anonyme en cours sera
  // abandonnée. On ne fusionne JAMAIS automatiquement : il faudrait choisir
  // quelle progression garder, ce qu'aucun code ne peut décider à la place du
  // joueur.
  if (code.includes('credential-already-in-use')) return 'credential-in-use';

  // Un compte KUMP existe déjà avec cette ADRESSE, mais via un autre moyen de
  // connexion (email + mot de passe, typiquement). La sortie est de se
  // connecter par ce moyen-là, pas par Google.
  if (code.includes('account-exists-with-different-credential')) {
    return 'email-in-use-other-provider';
  }

  // Le compte COURANT a déjà Google rattaché : il n'y a rien à faire, et
  // surtout rien d'alarmant à afficher.
  if (code.includes('provider-already-linked')) return 'already-linked';

  console.error('[kump] Connexion par fournisseur échouée', error);
  return 'unknown';
}
