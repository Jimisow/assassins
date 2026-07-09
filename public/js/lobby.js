// Creation / connexion aux lobbies, et persistance de session (localStorage)
// pour permettre la reconnexion automatique apres fermeture/veille du telephone.
//
// Identite des joueurs : chaque appareil s'authentifie de facon anonyme
// aupres de Firebase (voir ensureSignedIn() dans firebase-config.js), et
// c'est cet identifiant (`uid`), verifiable cote serveur, qui sert de
// playerId/hostId - plus un UUID genere par le client et stocke tel quel
// dans localStorage, qui pouvait etre falsifie librement depuis la console
// du navigateur pour usurper un autre joueur (cf. TODO_SECURITE.md).
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  ensureSignedIn,
} from "./firebase-config.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I pour lisibilite
const STORAGE_KEY = "assassins_session";

function randomCode(length) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// Genere un code de 4 caracteres, et verifie son unicite en base (essaie 5 caracteres
// si trop de collisions, cf. DECISIONS.md).
export async function generateUniqueLobbyCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const length = attempt < 10 ? 4 : 5;
    const code = randomCode(length);
    const snap = await getDoc(doc(db, "lobbies", code));
    if (!snap.exists()) return code;
  }
  throw new Error("Impossible de generer un code de lobby unique, reessayez.");
}

export async function createLobby(rolesConfig) {
  const hostId = await ensureSignedIn();
  const code = await generateUniqueLobbyCode();
  await setDoc(doc(db, "lobbies", code), {
    hostId,
    // "config" : l'hote choisit encore la composition des roles, personne ne
    // peut rejoindre. Passe a "lobby" (salon ouvert) une fois valide.
    status: "config",
    rolesConfig,
    governorId: null,
    currentNightStep: null,
    nightNumber: 0,
    dayNumber: 0,
    isFirstDayVoteDone: false,
    electionReturnTo: null,
    sheriffRevenge: null,
    winningCamp: null,
    winningPlayerIds: [],
    winReason: null,
    lastNightResult: null,
    finalReveal: null,
    createdAt: serverTimestamp(),
  });
  persistHostSession(code, hostId);
  return { code, hostId };
}

export async function joinLobby(code, playerName) {
  const playerId = await ensureSignedIn();
  const upperCode = code.trim().toUpperCase();
  const lobbyRef = doc(db, "lobbies", upperCode);
  const lobbySnap = await getDoc(lobbyRef);
  if (!lobbySnap.exists()) {
    throw new Error("Ce salon n'existe pas. Verifiez le code.");
  }
  const status = lobbySnap.data().status;
  if (status === "config") {
    throw new Error("L'hote configure encore la partie. Patientez quelques secondes et reessayez.");
  }
  if (status !== "lobby") {
    throw new Error("Cette partie a deja commence.");
  }

  await setDoc(doc(db, "lobbies", upperCode, "players", playerId), {
    name: playerName.trim().slice(0, 24) || "Joueur",
    isAlive: true,
    deathCause: null,
    isReady: false,
    isGovernorCandidate: false,
    potions: { life: true, death: true },
    hasUsedCorruption: false,
    hasFired: false,
    joinedAt: serverTimestamp(),
  });
  // Document prive (role/camp/amoureux/coequipiers) : cree vide a la
  // connexion, rempli uniquement par l'Hote au lancement de la partie
  // (voir host.js:launchGame). Seuls le joueur lui-meme et l'Hote peuvent le
  // lire (cf. firestore.rules) - c'est ce qui empeche desormais de decouvrir
  // le role des autres joueurs depuis la console du navigateur.
  await setDoc(doc(db, "lobbies", upperCode, "playersPrivate", playerId), {
    role: null,
    camp: null,
    loverId: null,
    teammateIds: [],
    detectiveReveal: null,
  });
  persistPlayerSession(upperCode, playerId, playerName);
  return { code: upperCode, playerId };
}

export async function closeLobby(code) {
  // Purge les sous-collections avant de supprimer le document lobby
  // lui-meme : Firestore ne supprime jamais les sous-collections en cascade,
  // donc sans ca elles restaient orphelines indefiniment (cf. TODO_SECURITE.md).
  const subcollections = ["players", "playersPrivate", "chatLobby", "chatGame", "nightActions", "dayVotes", "election"];
  for (const name of subcollections) {
    const snap = await getDocs(collection(db, "lobbies", code, name));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }
  await deleteDoc(doc(db, "lobbies", code));
}

// --- Persistance de session (localStorage) ---

export function persistPlayerSession(code, playerId, name) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ type: "player", code, playerId, name, savedAt: Date.now() })
  );
}

export function persistHostSession(code, hostId) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ type: "host", code, hostId, savedAt: Date.now() })
  );
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// Verifie a la fois que la session enregistree correspond bien a l'identite
// Firebase Auth actuelle de cet appareil (et pas seulement a ce qu'affirme le
// localStorage) et que le salon/joueur existe toujours.
export async function verifyPlayerSessionValid(code, playerId) {
  const currentUid = await ensureSignedIn();
  if (currentUid !== playerId) return false;
  const lobbySnap = await getDoc(doc(db, "lobbies", code));
  if (!lobbySnap.exists()) return false;
  const playerSnap = await getDoc(doc(db, "lobbies", code, "players", playerId));
  return playerSnap.exists();
}

export async function verifyHostSessionValid(code, hostId) {
  const currentUid = await ensureSignedIn();
  if (currentUid !== hostId) return false;
  const lobbySnap = await getDoc(doc(db, "lobbies", code));
  if (!lobbySnap.exists()) return false;
  return lobbySnap.data().hostId === hostId;
}

export async function setPlayerReady(code, playerId, isReady) {
  await updateDoc(doc(db, "lobbies", code, "players", playerId), { isReady });
}

// Valide la composition choisie par l'hote et ouvre le salon aux joueurs.
export async function validateRoleConfig(code, rolesConfig) {
  await updateDoc(doc(db, "lobbies", code), { rolesConfig, status: "lobby" });
}

// Permet a l'hote de revenir modifier la composition avant le lancement de la partie.
export async function backToConfig(code) {
  await updateDoc(doc(db, "lobbies", code), { status: "config" });
}

export async function withdrawOrCandidate(code, playerId, isGovernorCandidate) {
  await updateDoc(doc(db, "lobbies", code, "players", playerId), { isGovernorCandidate });
}

// Transaction : verifie que 100% des joueurs sont prets avant de lancer la partie.
// (L'attribution des roles proprement dite vit dans host.js / roles.js.)
export async function allPlayersReady(playersSnapshotDocs) {
  if (playersSnapshotDocs.length === 0) return false;
  return playersSnapshotDocs.every((p) => p.isReady);
}

export { runTransaction, doc, db, ensureSignedIn };
