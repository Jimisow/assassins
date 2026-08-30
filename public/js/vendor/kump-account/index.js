// Compte KUMP — point d'entrée unique du module.
//
// Un seul compte pour TOUS les jeux KUMP : le joueur se connecte une fois,
// chaque jeu range ses propres données dans son coin, et kump.fr affiche le
// profil complet (temps de jeu, trophées, progression par jeu).
//
// Chaque jeu appelle `initKump()` une fois au démarrage, puis n'utilise plus
// que les fonctions de ce fichier — AUCUN jeu ne doit importer `firebase/*`
// directement : c'est ce qui garantit qu'un correctif de sécurité fait ici
// profite à tous les jeux d'un coup, sans avoir à repasser dans chacun.
//
// Voir README.md pour l'intégration pas à pas et le schéma Firestore.

export {
  initKump,
  getKumpContext,
  isKumpReady,
} from './core.js';

export {
  ensureSignedIn,
  onUserChanged,
  getCurrentUser,
  getIdToken,
  isGuest,
  linkWithEmail,
  signInWithEmail,
  sendPasswordReset,
  signOutKump,
} from './auth.js';

export {
  signInWithGoogle,
  signInWithApple,
  linkWithGoogle,
  linkWithApple,
} from './providers.js';

export {
  getProfile,
  setDisplayName,
  addPlaytime,
} from './profile.js';

export {
  loadGameData,
  saveGameData,
  unlockTrophy,
  getUnlockedTrophies,
} from './gameData.js';

export {
  getFullProfile,
} from './fullProfile.js';

export {
  purchaseGameItem,
} from './purchase.js';

export {
  submitRun,
  flushRunQueue,
  pendingRunCount,
  purchaseFromServer,
} from './runs.js';

export {
  getGameCatalog,
} from './catalog.js';

export {
  getShopCatalog,
  getShopState,
  buyItem,
  equipItem,
} from './shop.js';

export {
  kumpMessage,
  isSilentCode,
  KUMP_MESSAGES,
} from './messages.js';

export {
  submitSession,
  flushSessionQueue,
  pendingSessionCount,
} from './session.js';

export {
  submitScore,
  fetchLeaderboard,
  fetchRank,
} from './leaderboard.js';
