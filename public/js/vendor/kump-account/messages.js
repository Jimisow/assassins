// Messages destinés au JOUEUR, en français.
//
// POURQUOI ILS SONT ICI MAINTENANT
//
// Ils étaient recopiés dans QUATRE projets : Androgame, D-Track, Assassins et
// kump.fr. Le module ne renvoyait que des codes courts (`user-not-found`,
// `weak-password`…) et chaque projet écrivait ses propres phrases. C'était une
// dette assumée et documentée tant qu'il y avait un seul jeu — elle ne l'était
// plus à quatre : reformuler un message demandait d'y penser quatre fois, et
// les copies pouvaient diverger sans que rien ne le signale.
//
// Un projet qui veut un autre ton reste libre : `kumpMessage()` accepte une
// table de remplacement (voir `overrides`). Ce qui change, c'est qu'il n'a plus
// à réécrire les vingt autres pour en personnaliser deux.
//
// ⚠️ NE PAS SUPPRIMER `cancelled` DE CETTE TABLE. Fermer la fenêtre de
// connexion Google n'est PAS une erreur : le code existe pour que l'appelant
// le reconnaisse et n'affiche rien. Un écran qui le traite comme les autres
// affiche « une erreur est survenue » à quelqu'un qui a simplement changé
// d'avis.

/** Codes qui ne doivent RIEN afficher : ce ne sont pas des échecs. */
export const SILENT_CODES = ['cancelled'];

export const KUMP_MESSAGES = {
  // --- Connexion / création de compte ---
  'user-not-found': "Aucun compte avec cet email — créez le vôtre si c'est votre première fois.",
  'wrong-password': 'Email ou mot de passe incorrect.',
  'invalid-credential': 'Email ou mot de passe incorrect.',
  'invalid-email': "Cet email n'a pas l'air valide.",
  'email-already-in-use': 'Un compte existe déjà avec cet email — connectez-vous.',
  'weak-password': 'Mot de passe trop court (6 caractères minimum).',
  'too-many-requests': 'Trop de tentatives — réessayez dans quelques minutes.',
  'invalid-length': 'Le pseudo doit faire entre 3 et 16 caractères.',

  // --- Fournisseurs externes ---
  // `credential-in-use` n'est PAS une impasse : l'écran doit proposer de se
  // connecter à ce compte (voir README > Le cas « ce compte Google est déjà
  // pris »). Le message le dit, mais il ne suffit pas — il faut le bouton.
  'credential-in-use':
    "Ce compte appartient déjà à un profil KUMP — sans doute le vôtre, créé depuis un autre jeu.",
  'email-in-use-other-provider':
    'Un compte KUMP existe déjà avec cette adresse, mais avec un mot de passe — connectez-vous par email.',
  'already-linked': 'Ce compte est déjà rattaché à votre profil.',
  'provider-disabled': "Cette connexion n'est pas encore disponible.",
  'popup-blocked': 'Votre navigateur a bloqué la fenêtre de connexion.',
  cancelled: '',

  // --- Boutique ---
  'insufficient-coins': 'Vous n’avez pas assez pour cet objet.',
  'item-unknown': 'Cet objet n’existe pas ou n’est plus disponible.',
  'no-data': 'Jouez une partie avant de faire des achats.',
  'game-unknown': 'Ce jeu n’a pas de boutique.',
  offline: 'Connexion perdue — réessayez dans un instant.',

  // --- Divers ---
  'not-signed-in': 'Compte indisponible, rechargez la page.',
  'not-ready': 'Le compte KUMP est indisponible pour le moment.',
  'too-soon': 'Partie enregistrée, elle sera comptabilisée dans un instant.',
  unknown: 'Une erreur est survenue, réessayez.',
};

/**
 * Phrase à montrer au joueur pour un code d'erreur.
 *
 * @param {string} code       Le code renvoyé par une fonction du module.
 * @param {object} [overrides] Table de remplacement propre au projet, pour
 *   n'ajuster QUE les messages qu'on veut, sans recopier les autres.
 * @returns {string} La phrase, ou `''` pour un code silencieux — un appelant
 *   doit donc tester le résultat avant d'afficher quoi que ce soit.
 */
export function kumpMessage(code, overrides) {
  const key = code || 'unknown';
  if (overrides && key in overrides) return overrides[key];
  return key in KUMP_MESSAGES ? KUMP_MESSAGES[key] : KUMP_MESSAGES.unknown;
}

/** `true` si ce code ne doit rien afficher du tout. */
export function isSilentCode(code) {
  return SILENT_CODES.includes(code);
}
