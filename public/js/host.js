// Logique de l'ecran Hote : configuration du lobby, pilotage de toutes les
// phases de la partie (nuit, jour, election, victoire). L'hote ne joue pas :
// il orchestre. Toutes les transitions d'etat critiques passent par des
// transactions Firestore pour eviter les races conditions multi-clients.
import {
  db,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "./firebase-config.js";
import { loadSession, clearSession, verifyHostSessionValid, closeLobby, validateRoleConfig, backToConfig } from "./lobby.js";
import { sendMessage, listenToChat, clearChat } from "./chat.js";
import {
  ROLES,
  CONFIGURABLE_ROLES,
  getRoleInfo,
  assignRoles,
  checkVictoryConditions,
  checkDayVoteSpecialConditions,
} from "./roles.js";
import {
  NIGHT_ORDER,
  NIGHT_STEP_LABELS,
  NIGHT_STEP_UI,
  beginNight,
  launchPendingNightRole,
  computeNightResult,
  computeNextStep,
  nightActionsRef,
} from "./night-cycle.js";
import { guardedClick, guardedSubmit } from "./ui-utils.js";
import { initNetworkStatus } from "./network-status.js";

initNetworkStatus();

const session = loadSession();
let CODE = null;
let HOST_ID = null;

let lobbyData = null;
let players = [];
// Le role/camp de chaque joueur vit dans un document PRIVE separe
// (`playersPrivate/{id}`), lisible uniquement par le joueur lui-meme et par
// l'Hote (cf. firestore.rules) : c'est ce qui empeche desormais de lire les
// roles des autres joueurs depuis la console du navigateur. L'Hote, en tant
// que "maitre du jeu", a acces a tout : on fusionne donc les deux
// collections en un seul tableau `players` a la forme identique a avant,
// pour ne rien changer au reste du code qui orchestre la partie.
let publicPlayers = [];
let privateById = {};
function mergePlayers() {
  players = publicPlayers.map((p) => ({ ...p, ...(privateById[p.id] || {}) }));
}
let unsubs = [];

const app = document.getElementById("hostApp");

async function init() {
  if (!session || session.type !== "host") {
    window.location.href = "index.html";
    return;
  }
  CODE = session.code;
  HOST_ID = session.hostId;

  const valid = await verifyHostSessionValid(CODE, HOST_ID);
  if (!valid) {
    clearSession();
    window.location.href = "index.html";
    return;
  }

  document.getElementById("lobbyCodeDisplay").textContent = CODE;

  unsubs.push(
    onSnapshot(doc(db, "lobbies", CODE), (snap) => {
      if (!snap.exists()) {
        alert("Le salon a ete ferme.");
        clearSession();
        window.location.href = "index.html";
        return;
      }
      lobbyData = { id: snap.id, ...snap.data() };
      render();
    })
  );

  unsubs.push(
    onSnapshot(collection(db, "lobbies", CODE, "players"), (snap) => {
      publicPlayers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      mergePlayers();
      resolveDetectivePeek();
      resolveDestinPairing();
      render();
    })
  );

  unsubs.push(
    onSnapshot(collection(db, "lobbies", CODE, "playersPrivate"), (snap) => {
      privateById = {};
      snap.docs.forEach((d) => { privateById[d.id] = d.data(); });
      mergePlayers();
      resolveDetectivePeek();
      resolveDestinPairing();
      render();
    })
  );

  document.getElementById("closeLobbyBtn").addEventListener("click", () => {
    document.getElementById("confirmCloseModal").classList.remove("hidden");
  });
  document.getElementById("confirmCloseNoBtn").addEventListener("click", () => {
    document.getElementById("confirmCloseModal").classList.add("hidden");
  });
  guardedClick(document.getElementById("confirmCloseYesBtn"), async () => {
    document.getElementById("confirmCloseModal").classList.add("hidden");
    unsubs.forEach((u) => u());
    await closeLobby(CODE);
    clearSession();
    window.location.href = "index.html";
  });

  document.getElementById("closeRoleInfoModalBtn").addEventListener("click", () => {
    document.getElementById("roleInfoModal").classList.add("hidden");
  });
}

const MIN_PLAYERS = 4;

function render() {
  if (!lobbyData) return;
  updateDayNightBadge();
  if (lobbyData.status === "config") {
    renderConfigScreen();
  } else if (lobbyData.status === "lobby") {
    renderSetup();
  } else if (lobbyData.status === "ended") {
    renderEnd();
  } else {
    renderGame();
  }
}

// ---------------------------------------------------------------------------
// PHASE : CONFIGURATION (avant ouverture du salon aux joueurs)
// ---------------------------------------------------------------------------

let configInitialized = false;
const configRoleCounts = { assassin: 1, detective: 1, chimiste: 1 };
CONFIGURABLE_ROLES.forEach((r) => { if (!(r in configRoleCounts)) configRoleCounts[r] = 0; });

function renderConfigScreen() {
  document.getElementById("configScreen").classList.remove("hidden");
  document.getElementById("setupScreen").classList.add("hidden");
  document.getElementById("gameScreen").classList.add("hidden");
  document.getElementById("endScreen").classList.add("hidden");

  if (!configInitialized) {
    configInitialized = true;
    buildRoleCounterForm();
    guardedClick(document.getElementById("validateConfigBtn"), async () => {
      await validateRoleConfig(CODE, { ...configRoleCounts });
    });
  }
  updateConfigValidity();
}

function buildRoleCounterForm() {
  const container = document.getElementById("roleConfigForm");
  container.innerHTML = "";
  CONFIGURABLE_ROLES.forEach((roleId) => {
    const info = getRoleInfo(roleId);
    const row = document.createElement("div");
    row.className = "role-config-row";
    row.innerHTML = `
      <span class="role-config-label"><button type="button" class="info-btn" data-role="${roleId}" title="Description du role">?</button> ${info.icon} ${info.label}</span>
      <div class="counter">
        <button type="button" class="counter-btn" data-role="${roleId}" data-delta="-1">−</button>
        <span class="counter-value" id="role-count-${roleId}">${configRoleCounts[roleId]}</span>
        <button type="button" class="counter-btn" data-role="${roleId}" data-delta="1">+</button>
      </div>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll(".counter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const roleId = btn.dataset.role;
      const delta = Number(btn.dataset.delta);
      configRoleCounts[roleId] = Math.max(0, Math.min(20, (configRoleCounts[roleId] || 0) + delta));
      document.getElementById(`role-count-${roleId}`).textContent = configRoleCounts[roleId];
      updateConfigValidity();
    });
  });
  container.querySelectorAll(".info-btn").forEach((btn) => {
    btn.addEventListener("click", () => openRoleInfoModal(btn.dataset.role));
  });
}

function openRoleInfoModal(roleId) {
  const info = getRoleInfo(roleId);
  document.getElementById("roleInfoModalTitle").textContent = `${info.icon} ${info.label}`;
  document.getElementById("roleInfoModalDesc").textContent = info.description;
  document.getElementById("roleInfoModalVictory").textContent = info.victoryText;
  document.getElementById("roleInfoModal").classList.remove("hidden");
}

function updateConfigValidity() {
  const total = Object.values(configRoleCounts).reduce((a, b) => a + b, 0);
  const canValidate = (configRoleCounts.assassin || 0) >= 1;
  document.getElementById("validateConfigBtn").disabled = !canValidate;
  document.getElementById("configHint").textContent = canValidate
    ? `${total} role(s) special(aux) configure(s). Les Citoyens completeront automatiquement le reste des joueurs.`
    : "Il faut configurer au moins 1 Assassin avant de valider.";
}

// ---------------------------------------------------------------------------
// PHASE : SETUP (salon ouvert, les joueurs rejoignent et se preparent)
// ---------------------------------------------------------------------------

let setupInitialized = false;

function renderSetup() {
  document.getElementById("configScreen").classList.add("hidden");
  document.getElementById("setupScreen").classList.remove("hidden");
  document.getElementById("gameScreen").classList.add("hidden");
  document.getElementById("endScreen").classList.add("hidden");

  if (!setupInitialized) {
    setupInitialized = true;
    unsubs.push(listenToChat(CODE, "chatLobby", renderLobbyChat));
    guardedSubmit(document.getElementById("lobbyChatForm"), async () => {
      const input = document.getElementById("lobbyChatInput");
      if (!input.value.trim()) return;
      await sendMessage(CODE, "chatLobby", HOST_ID, "Hote", input.value);
      input.value = "";
    });
    document.getElementById("launchGameBtn").addEventListener("click", launchGame);
    guardedClick(document.getElementById("backToConfigBtn"), () => backToConfig(CODE));
  }

  renderPlayerRosterSetup();
}

function renderPlayerRosterSetup() {
  const list = document.getElementById("setupPlayerList");
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.className = p.isReady ? "ready" : "not-ready";
    li.textContent = `${p.name} ${p.isReady ? "- Pret" : "- En attente"}`;
    list.appendChild(li);
  });

  const allReady = players.length > 0 && players.every((p) => p.isReady);
  const roleConfig = lobbyData.rolesConfig || {};
  const totalSpecial = Object.values(roleConfig).reduce((a, b) => a + b, 0);
  const citoyenCount = Math.max(0, players.length - totalSpecial);
  const enoughPlayers = players.length >= MIN_PLAYERS;
  const canLaunch = allReady && enoughPlayers;

  const btn = document.getElementById("launchGameBtn");
  btn.disabled = !canLaunch;
  document.getElementById("launchHint").textContent = !enoughPlayers
    ? `Il faut au moins ${MIN_PLAYERS} joueurs (hors Hote) pour lancer la partie.`
    : !allReady
    ? "En attente que 100% des joueurs cliquent sur Pret."
    : "Tout le monde est pret !";

  const recap = CONFIGURABLE_ROLES.filter((r) => roleConfig[r] > 0)
    .map((r) => `${getRoleInfo(r).label} x${roleConfig[r]}`)
    .concat([`Citoyen x${citoyenCount} (auto)`])
    .join(", ");
  document.getElementById("playerCountLabel").textContent = `${players.length} joueur(s) connecte(s) — ${recap}`;
}

function renderLobbyChat(messages) {
  const box = document.getElementById("lobbyChatMessages");
  box.innerHTML = messages
    .map((m) => `<div class="chat-msg"><span class="author">${escapeHtml(m.authorName)}</span> : ${escapeHtml(m.text)}</div>`)
    .join("");
  box.scrollTop = box.scrollHeight;
}

// Le camp Assassins doit se connaitre entre coequipiers (comme dans un vrai
// Loup-Garou), mais un joueur ne peut lire QUE son propre document prive
// (cf. firestore.rules) : chaque membre du camp recoit donc, dans son propre
// document prive, la liste des identifiants de ses coequipiers
// (`teammateIds`). C'est ce qui permet au ciblage des Assassins/Tueur en
// Serie (cote Joueur) de fonctionner sans jamais avoir a lire le camp d'un
// AUTRE joueur.
async function writeTeammateIds(assassinCampIds) {
  await Promise.all(
    assassinCampIds.map((id) =>
      updateDoc(doc(db, "lobbies", CODE, "playersPrivate", id), {
        teammateIds: assassinCampIds.filter((otherId) => otherId !== id),
      })
    )
  );
}

async function launchGame() {
  const btn = document.getElementById("launchGameBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("btn-busy");
  try {
    const roleConfig = lobbyData.rolesConfig || {};
    const assignment = assignRoles(roleConfig, players.map((p) => p.id));

    const batchUpdates = players.map((p) =>
      updateDoc(doc(db, "lobbies", CODE, "players", p.id), {
        isGovernorCandidate: false,
      })
    );
    const privateUpdates = players.map((p) =>
      updateDoc(doc(db, "lobbies", CODE, "playersPrivate", p.id), {
        role: assignment[p.id].role,
        camp: assignment[p.id].camp,
      })
    );
    await Promise.all([...batchUpdates, ...privateUpdates]);
    await writeTeammateIds(players.filter((p) => assignment[p.id].camp === "assassins").map((p) => p.id));
    await clearChat(CODE, "chatLobby");

    // La partie commence toujours par le Jour 1 : election obligatoire du
    // Gouverneur AVANT la toute premiere nuit (cf. DECISIONS.md).
    await updateDoc(doc(db, "lobbies", CODE), {
      governorId: null,
      isFirstDayVoteDone: false,
      tueurPowerLost: false,
      winningCamp: null,
      winningPlayerIds: [],
      winReason: null,
      nightNumber: 0,
      dayNumber: 0,
      status: "election",
      electionReturnTo: "night",
    });
  } catch (err) {
    console.error(err);
    alert("Erreur au lancement de la partie : " + err.message);
    btn.disabled = false;
    btn.classList.remove("btn-busy");
  }
}

// ---------------------------------------------------------------------------
// PHASE : JEU (nuit / jour / election / sherif)
// ---------------------------------------------------------------------------

let gameInitialized = false;
let currentNightUnsub = null;
let currentElectionUnsub = null;
let currentDayVoteUnsub = null;
let gameChatUnsub = null;
let lastRenderedStatus = null;
let lastRenderedNightStep = null;

// --- Indicateur Jour/Nuit persistant + animation de transition ---

const DAY_STATUSES = ["election", "day_announcement", "day_vote", "day_vote_result", "sheriff_revenge"];

function dayNightLabel(status, nightNumber) {
  if (status === "election" && nightNumber === 0) return "La partie commence";
  if (status === "night") return `Nuit ${nightNumber}`;
  if (DAY_STATUSES.includes(status)) return `Jour ${nightNumber === 0 ? 1 : nightNumber}`;
  return "";
}

function updateDayNightBadge() {
  const badge = document.getElementById("dayNightBadge");
  if (!badge) return;
  badge.textContent = dayNightLabel(lobbyData.status, lobbyData.nightNumber);
}

// Base sur nightNumber (pas seulement sur le statut precedent) pour rester
// correct meme apres un "Rejouer" (qui remet nightNumber a 0 sans recharger
// la page, donc sans reinitialiser les variables locales du module).
let lastTransitionStatus = null;
function maybeShowDayNightTransition() {
  const prev = lastTransitionStatus;
  if (lobbyData.status === prev) return;
  lastTransitionStatus = lobbyData.status;
  if (lobbyData.status === "election" && lobbyData.nightNumber === 0) {
    showDayNightTransition("LA PARTIE COMMENCE");
  } else if (lobbyData.status === "night") {
    showDayNightTransition(`NUIT ${lobbyData.nightNumber}`);
  } else if (lobbyData.status === "day_announcement" && prev === "night") {
    showDayNightTransition(`JOUR ${lobbyData.nightNumber === 0 ? 1 : lobbyData.nightNumber}`);
  }
}

let dayNightTransitionTimer = null;
function showDayNightTransition(text) {
  const el = document.getElementById("dayNightTransition");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "play");
  void el.offsetWidth; // force le redemarrage de l'animation CSS
  el.classList.add("play");
  clearTimeout(dayNightTransitionTimer);
  dayNightTransitionTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

function renderGame() {
  document.getElementById("setupScreen").classList.add("hidden");
  document.getElementById("gameScreen").classList.remove("hidden");
  document.getElementById("endScreen").classList.add("hidden");

  if (!gameInitialized) {
    gameInitialized = true;
    gameChatUnsub = listenToChat(CODE, "chatGame", renderHostChatModal);
    document.getElementById("chatBtn").addEventListener("click", () => {
      chatModalOpen = true;
      document.getElementById("chatModal").classList.remove("hidden");
      markChatAsRead();
    });
    document.getElementById("closeChatModalBtn").addEventListener("click", () => {
      chatModalOpen = false;
      document.getElementById("chatModal").classList.add("hidden");
    });
    guardedSubmit(document.getElementById("chatModalForm"), async () => {
      const input = document.getElementById("chatModalInput");
      if (!input.value.trim()) return;
      await sendMessage(CODE, "chatGame", HOST_ID, "Hote", input.value, { isDead: false });
      input.value = "";
    });
  }

  renderRosterFull();
  maybeShowDayNightTransition();

  if (lobbyData.status !== lastRenderedStatus) {
    lastRenderedStatus = lobbyData.status;
    if (currentNightUnsub) { currentNightUnsub(); currentNightUnsub = null; currentNightActionsData = null; }
    if (currentElectionUnsub) { currentElectionUnsub(); currentElectionUnsub = null; }
    if (currentDayVoteUnsub) { currentDayVoteUnsub(); currentDayVoteUnsub = null; }
  }

  const panel = document.getElementById("phasePanel");
  if (lobbyData.status === "night") {
    renderNightPanel(panel);
  } else if (lobbyData.status === "day_announcement") {
    renderAnnouncementPanel(panel);
  } else if (lobbyData.status === "election") {
    renderElectionPanel(panel);
  } else if (lobbyData.status === "day_vote") {
    renderDayVotePanel(panel);
  } else if (lobbyData.status === "day_vote_result") {
    renderDayVoteResultPanel(panel);
  } else if (lobbyData.status === "sheriff_revenge") {
    renderSheriffPanel(panel);
  }
}

// Ne reecrit le DOM que si le contenu a reellement change (voir renderRoster
// cote Joueur pour la meme technique) : evite un clignotement visible quand
// renderGame() est redeclenche par un evenement Firestore sans rapport
// (vote/chat d'un autre joueur) pendant que l'hote reste sur un ecran statique.
function renderRosterFull() {
  const list = document.getElementById("fullPlayerList");
  const html = players
    .map((p) => {
      const roleInfo = getRoleInfo(p.role);
      const badges = [];
      if (lobbyData.governorId === p.id) badges.push('<span class="badge governor">Gouverneur</span>');
      if (p.loverId) badges.push('<span class="badge lover">Amoureux</span>');
      if (!p.isAlive) badges.push(`<span class="badge dead-badge">${p.deathCause || "mort"}</span>`);
      return `<li class="${p.isAlive ? "alive" : "dead"}"><span class="skull">${p.isAlive ? "" : "&#128128; "}</span><strong>${escapeHtml(p.name)}</strong> — ${roleInfo.icon} ${roleInfo.label} ${badges.join(" ")}</li>`;
    })
    .join("");
  if (list.innerHTML !== html) list.innerHTML = html;
}

let chatModalOpen = false;
let seenChatMessageIds = new Set();
let unreadChatCount = 0;

function renderHostChatModal(messages) {
  const box = document.getElementById("chatModalMessages");
  if (!box) return;
  // L'hote voit tout : les messages des morts restent distingues en violet spectral.
  box.innerHTML = messages
    .map((m) => `<div class="chat-msg ${m.isDead ? "spectral-msg" : ""}"><span class="author">${escapeHtml(m.authorName)}</span> : ${escapeHtml(m.text)}</div>`)
    .join("");
  box.scrollTop = box.scrollHeight;

  if (!chatModalOpen) {
    messages.forEach((m) => {
      if (!seenChatMessageIds.has(m.id)) unreadChatCount++;
    });
  }
  messages.forEach((m) => seenChatMessageIds.add(m.id));
  updateChatBadge();
}

function markChatAsRead() {
  unreadChatCount = 0;
  updateChatBadge();
}

function updateChatBadge() {
  const badge = document.getElementById("chatBadge");
  if (!badge) return;
  if (unreadChatCount > 0) {
    badge.textContent = unreadChatCount > 9 ? "9+" : String(unreadChatCount);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// --- Nuit ---
// Important : le passage d'un role au suivant est toujours declenche
// manuellement par l'hote (bouton "Passer a..."), jamais automatiquement des
// qu'un role valide son action. Pour ça, l'hote ecoute lui-meme le document
// nightActions/night_N afin de savoir quand le role courant a fini.

let currentNightActionsData = null;

// Le Detective ne peut plus lire le role de sa cible directement (les roles
// sont prives, cf. firestore.rules) : il pose seulement sa cible
// (`detective.peekedTargetId`, dans le document de nuit partage, lisible de
// tous). L'Hote - qui observe deja ce document en temps reel et a acces a
// tous les roles - remplit alors la revelation dans le document PRIVE du
// Detective lui-meme (`playersPrivate/{detectiveId}.detectiveReveal`), pas
// dans le document de nuit partage : sinon n'importe quel joueur pourrait y
// lire la decouverte du Detective.
let resolvingDetectivePeek = false;
async function resolveDetectivePeek() {
  const d = currentNightActionsData?.detective;
  if (!d || !d.peekedTargetId || d.done || resolvingDetectivePeek) return;
  const detective = players.find((p) => p.role === "detective");
  if (!detective) return;
  const alreadyResolved = detective.detectiveReveal?.targetId === d.peekedTargetId
    && detective.detectiveReveal?.nightNumber === lobbyData.nightNumber;
  if (alreadyResolved) return;
  resolvingDetectivePeek = true;
  try {
    const target = players.find((p) => p.id === d.peekedTargetId);
    if (target) {
      await updateDoc(doc(db, "lobbies", CODE, "playersPrivate", detective.id), {
        detectiveReveal: { targetId: target.id, role: target.role, nightNumber: lobbyData.nightNumber },
      });
    }
  } finally {
    resolvingDetectivePeek = false;
  }
}

// Meme principe que resolveDetectivePeek() : le Destin ne peut pas ecrire
// `loverId` sur les documents prives des deux joueurs choisis (seul l'Hote
// peut ecrire dans playersPrivate), donc l'Hote applique l'appariement des
// Ames Soeurs des qu'il detecte une paire validee et pas encore appliquee.
let resolvingDestinPairing = false;
async function resolveDestinPairing() {
  const d = currentNightActionsData?.destin;
  if (!d || !d.done || !d.targets || d.targets.length !== 2 || resolvingDestinPairing) return;
  const [aId, bId] = d.targets;
  const a = players.find((p) => p.id === aId);
  const b = players.find((p) => p.id === bId);
  if (!a || !b || (a.loverId === bId && b.loverId === aId)) return;
  resolvingDestinPairing = true;
  try {
    await updateDoc(doc(db, "lobbies", CODE, "playersPrivate", aId), { loverId: bId });
    await updateDoc(doc(db, "lobbies", CODE, "playersPrivate", bId), { loverId: aId });
  } finally {
    resolvingDestinPairing = false;
  }
}

function renderNightPanel(panel) {
  const step = lobbyData.currentNightStep;
  if (step !== lastRenderedNightStep) {
    lastRenderedNightStep = step;
  }

  if (!currentNightUnsub) {
    currentNightUnsub = onSnapshot(nightActionsRef(CODE, lobbyData.nightNumber), (snap) => {
      currentNightActionsData = snap.data();
      resolveDetectivePeek();
      resolveDestinPairing();
      if (lobbyData.status === "night") renderNightPanel(document.getElementById("phasePanel"));
    });
  }

  // Le premier role necessaire est determine des l'entree en nuit, mais ne
  // demarre reellement qu'a ce clic (l'Hote garde la main sur le tout debut).
  if (step === "ready") {
    const roleName = NIGHT_STEP_UI[lobbyData.pendingNightStep]?.launch || lobbyData.pendingNightStep;
    panel.innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">🌙</div>
        <h2>Nuit ${lobbyData.nightNumber}</h2>
        <p class="hint">Premier role a agir : <strong>${escapeHtml(roleName)}</strong></p>
        <button id="launchRoleBtn" class="primary big">Lancer ${escapeHtml(roleName)}</button>
      </div>
    `;
    guardedClick(document.getElementById("launchRoleBtn"), () => launchPendingNightRole(CODE));
    return;
  }

  if (step === "done") {
    panel.innerHTML = `
      <h2>Nuit ${lobbyData.nightNumber}</h2>
      <p>Tous les roles actifs ont valide leur action.</p>
      <button id="passToDayBtn" class="primary">Passer au jour</button>
    `;
    guardedClick(document.getElementById("passToDayBtn"), passToDay);
    return;
  }

  const doneMessage = NIGHT_STEP_UI[step]?.done || `${NIGHT_STEP_LABELS[step] || step} : action validee.`;
  const stepDone = currentNightActionsData?.[step]?.done;

  if (stepDone) {
    const next = computeNextStep(step, players, lobbyData);
    // Dernier role de la nuit : plus besoin d'un clic intermediaire, on
    // propose directement "Passer au jour" (le clic "Passer a la fin de la
    // nuit" etait redondant).
    if (next === "done") {
      panel.innerHTML = `
        <h2>Nuit ${lobbyData.nightNumber}</h2>
        <p>Tous les roles actifs ont valide leur action.</p>
        <button id="passToDayBtn" class="primary">Passer au jour</button>
      `;
      guardedClick(document.getElementById("passToDayBtn"), passToDay);
      return;
    }
    const nextPass = NIGHT_STEP_UI[next]?.pass || next;
    panel.innerHTML = `
      <h2>Nuit ${lobbyData.nightNumber}</h2>
      <p>${escapeHtml(doneMessage)}</p>
      <button id="advanceNightBtn" class="primary">Passer ${escapeHtml(nextPass)}</button>
    `;
    guardedClick(document.getElementById("advanceNightBtn"), async () => {
      await updateDoc(doc(db, "lobbies", CODE), { currentNightStep: next });
    });
    return;
  }

  const waitingLabel = NIGHT_STEP_LABELS[step] || step;
  panel.innerHTML = `
    <h2>Nuit ${lobbyData.nightNumber}</h2>
    <p class="waiting">En attente : <strong>${escapeHtml(waitingLabel)}</strong>...</p>
  `;
}

async function passToDay() {
  const nRef = nightActionsRef(CODE, lobbyData.nightNumber);
  const nSnap = await getDocFromServer(nRef);
  const result = computeNightResult(nSnap.data(), players);
  await updateDoc(doc(db, "lobbies", CODE), {
    status: "day_announcement",
    lastNightResult: result,
    resultsRevealed: false,
  });
}

// N'ecrit dans le DOM (et ne rattache les listeners) que si le contenu a
// reellement change : renderGame() peut redeclencher cet ecran a cause d'un
// evenement Firestore sans rapport (vote/action d'un autre joueur) pendant
// que l'hote reste statique sur l'annonce - sans ce garde, ca provoquait un
// clignotement visible a chaque redessin inutile.
function renderAnnouncementPanel(panel) {
  let html, bind;
  if (!lobbyData.resultsRevealed) {
    html = `
      <div class="announcement-gate">
        <h2>Jour ${lobbyData.nightNumber === 0 ? 1 : lobbyData.nightNumber}</h2>
        <p>Faites votre annonce orale au groupe, puis revelez les resultats.</p>
        <button id="announceBtn" class="primary big">Annoncer les resultats</button>
      </div>
    `;
    bind = () => guardedClick(document.getElementById("announceBtn"), announceResults);
  } else {
    const result = lobbyData.lastNightResult || { deaths: [], savedPlayer: null };
    const entries = buildAnnouncementEntries(result);
    html = `
      <div class="announcement-card">
        <div class="announcement-title">Resultats de la Nuit ${lobbyData.nightNumber}</div>
        <div class="announcement-entries">${renderAnnouncementEntriesHtml(entries)}</div>
      </div>
      <button id="continueBtn" class="primary big">Continuer</button>
    `;
    bind = () => guardedClick(document.getElementById("continueBtn"), continueAfterAnnouncement);
  }
  if (panel.innerHTML !== html) { panel.innerHTML = html; bind(); }
}

// Construit une liste d'evenements {icone, classe, texte} a partir du
// resultat de nuit, pour un affichage plus percutant qu'une simple liste.
// Partage (duplique) avec player.js pour un rendu identique.
function buildAnnouncementEntries(result) {
  const entries = [];
  if (result.savedPlayer) {
    entries.push({ icon: "🛡️", cls: "entry-saved", text: "Quelqu'un a frole la mort cette nuit !" });
  }
  (result.deaths || []).forEach((d) => {
    const roleSuffix = d.role ? ` Il/elle etait ${getRoleInfo(d.role).icon} ${getRoleInfo(d.role).label}.` : "";
    if (d.cause === "poisoned") entries.push({ icon: "☠️", cls: "entry-poison", text: `${d.name} a ete empoisonne.${roleSuffix}` });
    else if (d.cause === "heartbreak") entries.push({ icon: "💔", cls: "entry-heartbreak", text: `${d.name} est mort de chagrin.${roleSuffix}` });
    else entries.push({ icon: "🗡️", cls: "entry-death", text: `${d.name} a ete assassine au coin d'une rue.${roleSuffix}` });
  });
  if (entries.length === 0) entries.push({ icon: "🌙", cls: "entry-calm", text: "Une nuit calme... personne n'est mort." });
  return entries;
}

function renderAnnouncementEntriesHtml(entries) {
  return entries
    .map(
      (e, i) => `
    <div class="announcement-entry ${e.cls}" style="animation-delay:${i * 0.35}s">
      <span class="entry-icon">${e.icon}</span>
      <span class="entry-text">${escapeHtml(e.text)}</span>
    </div>`
    )
    .join("");
}

async function announceResults() {
  // Avant, cette transaction relisait le document de CHAQUE joueur
  // (`tx.get`) uniquement pour savoir si un mort avait le role "assassin" -
  // N lectures serveur sequentielles avant de pouvoir ecrire quoi que ce
  // soit, ce qui rendait ce bouton perceptiblement lent des que la partie
  // comptait plusieurs joueurs. `computeNightResult` inclut deja le role de
  // chaque victime dans `lastNightResult.deaths`, donc ces lectures sont
  // inutiles : seul le document du salon (pour lire `lastNightResult`) doit
  // etre lu dans la transaction.
  await runTransaction(db, async (tx) => {
    const lobbyRef = doc(db, "lobbies", CODE);
    const lobbySnap = await tx.get(lobbyRef);
    const data = lobbySnap.data();
    const result = data.lastNightResult;

    if (result.corruptedPlayer) {
      tx.update(doc(db, "lobbies", CODE, "playersPrivate", result.corruptedPlayer.playerId), { role: "assassin", camp: "assassins" });
    }
    result.deaths.forEach((d) => {
      const label = d.cause === "poisoned" ? "empoisonne" : d.cause === "heartbreak" ? "mort de chagrin" : "assassine";
      tx.update(doc(db, "lobbies", CODE, "players", d.playerId), { isAlive: false, deathCause: label });
    });
    // Si un assassin meurt cette nuit, le Tueur en Serie perd definitivement son pouvoir.
    const anyAssassinDied = result.deaths.some((d) => d.role === "assassin");
    tx.update(lobbyRef, {
      resultsRevealed: true,
      tueurPowerLost: data.tueurPowerLost || anyAssassinDied,
    });
  });
  // Le Corrupteur vient d'ajouter un membre au camp Assassins : mettre a jour
  // la liste de coequipiers (teammateIds) de tout le camp en consequence,
  // pour que le nouvel Assassin (et les anciens) se reconnaissent au vote de
  // la nuit suivante.
  const corruptedId = lobbyData?.lastNightResult?.corruptedPlayer?.playerId;
  if (corruptedId) {
    const assassinCampIds = players.filter((p) => p.camp === "assassins").map((p) => p.id).concat([corruptedId]);
    await writeTeammateIds(assassinCampIds);
  }
  render();
}

async function continueAfterAnnouncement() {
  const newlyDeadIds = (lobbyData.lastNightResult?.deaths || []).map((d) => d.playerId);
  await resolveDeathConsequences(newlyDeadIds, { origin: "night" });
}

// --- Election du Gouverneur ---

let currentElectionData;

function renderElectionPanel(panel) {
  if (!currentElectionUnsub) {
    currentElectionData = undefined;
    currentElectionUnsub = onSnapshot(doc(db, "lobbies", CODE, "election", "current"), (snap) => {
      currentElectionData = snap.exists() ? snap.data() : null;
      renderElectionContent(panel, currentElectionData);
    });
  } else if (currentElectionData !== undefined) {
    // Reaffiche avec les dernieres candidatures : les joueurs se
    // presentent/se retirent en ecrivant sur LEUR document joueur, pas sur le
    // document d'election, donc ce n'est pas l'onSnapshot ci-dessus qui nous
    // avertirait d'un changement de candidature - il faut se rafraichir a
    // chaque changement de la collection players (via renderGame()).
    renderElectionContent(panel, currentElectionData);
  }
}

// Cree le document d'election (phase "candidacy") : appele uniquement au clic
// de l'hote sur "Lancer l'election du Gouverneur", jamais automatiquement.
async function startElection() {
  const ref = doc(db, "lobbies", CODE, "election", "current");
  await setDoc(ref, { phase: "candidacy", candidates: [], votes: {}, resultGovernorId: null });
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function renderElectionContent(panel, election) {
  const alivePlayers = players.filter((p) => p.isAlive);

  if (!election) {
    panel.innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">🗳️</div>
        <h2>Election du Gouverneur</h2>
        <p class="hint">Le village doit designer son Gouverneur.</p>
        <button id="startElectionBtn" class="primary big">Lancer l'election du Gouverneur</button>
      </div>
    `;
    guardedClick(document.getElementById("startElectionBtn"), startElection);
    return;
  }

  if (election.phase === "candidacy") {
    const candidates = alivePlayers.filter((p) => p.isGovernorCandidate);
    panel.innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">🗳️</div>
        <h2>Election du Gouverneur</h2>
        <p class="hint">Les joueurs se declarent candidats depuis leur telephone.</p>
        <div class="candidate-cards">
          ${candidates.map((c) => `<div class="candidate-card"><span class="candidate-avatar">${initials(c.name)}</span><span class="candidate-name">${escapeHtml(c.name)}</span></div>`).join("") || '<p class="hint"><em>Aucun candidat pour l\'instant...</em></p>'}
        </div>
        <button id="openVoteBtn" class="primary big" ${candidates.length === 0 ? "disabled" : ""}>Lancer le vote</button>
        ${candidates.length === 0 ? '<p class="hint">Au moins un joueur doit se presenter avant de lancer le vote.</p>' : ""}
      </div>
    `;
    guardedClick(document.getElementById("openVoteBtn"), async () => {
      if (candidates.length === 0) return;
      await updateDoc(doc(db, "lobbies", CODE, "election", "current"), {
        phase: "voting",
        candidates: candidates.map((c) => c.id),
        votes: {},
      });
    });
  } else if (election.phase === "voting") {
    const candidates = election.candidates.map((id) => players.find((p) => p.id === id)).filter(Boolean);
    const votes = election.votes || {};
    const tally = {};
    Object.values(votes).forEach((id) => { tally[id] = (tally[id] || 0) + 1; });
    const totalVotes = Object.keys(votes).length;
    panel.innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">🗳️</div>
        <h2>Vote en cours</h2>
        <p class="hint">${totalVotes} / ${alivePlayers.length} joueurs ont vote.</p>
        <div class="vote-tally">${renderTallyRows(candidates, tally, totalVotes)}</div>
        <button id="finalizeElectionBtn" class="primary big">Valider l'election</button>
      </div>
    `;
    guardedClick(document.getElementById("finalizeElectionBtn"), () => finalizeElection(election));
  }
}

function renderTallyRows(candidateList, tally, totalVotes) {
  return candidateList
    .map((c) => {
      const count = tally[c.id] || 0;
      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      return `
      <div class="tally-row">
        <span class="tally-avatar">${initials(c.name)}</span>
        <span class="tally-name">${escapeHtml(c.name)}</span>
        <div class="tally-bar"><div class="tally-bar-fill" style="width:${pct}%"></div></div>
        <span class="tally-count">${count}</span>
      </div>`;
    })
    .join("");
}

// En cas d'egalite (ou si personne n'a vote), c'est l'Hote qui tranche
// lui-meme (il n'y a par definition pas encore de Gouverneur pour arbitrer).
async function finalizeElection(election) {
  const votes = election.votes || {};
  const counts = {};
  Object.values(votes).forEach((candidateId) => {
    counts[candidateId] = (counts[candidateId] || 0) + 1;
  });

  let tied;
  if (Object.keys(counts).length === 0) {
    tied = election.candidates;
  } else {
    const max = Math.max(...Object.values(counts));
    tied = Object.keys(counts).filter((id) => counts[id] === max);
  }

  if (tied.length === 1) {
    await finishElection(tied[0]);
  } else {
    openElectionTieModal(tied);
  }
}

function openElectionTieModal(tiedIds) {
  const container = document.getElementById("electionTieChoices");
  container.innerHTML = tiedIds
    .map((id) => {
      const p = players.find((pl) => pl.id === id);
      return `<button type="button" class="choice-btn" data-id="${id}">${escapeHtml(p?.name || "?")}</button>`;
    })
    .join("");
  container.querySelectorAll(".choice-btn").forEach((btn) => {
    guardedClick(btn, async () => {
      document.getElementById("electionTieModal").classList.add("hidden");
      await finishElection(btn.dataset.id);
    }, container);
  });
  document.getElementById("electionTieModal").classList.remove("hidden");
}

async function finishElection(winnerId) {
  await updateDoc(doc(db, "lobbies", CODE), { governorId: winnerId });
  await Promise.all(players.map((p) => updateDoc(doc(db, "lobbies", CODE, "players", p.id), { isGovernorCandidate: false })));
  await deleteDoc(doc(db, "lobbies", CODE, "election", "current"));

  const returnTo = lobbyData.electionReturnTo || "day_vote";
  if (returnTo === "night") {
    await goToNight();
  } else {
    await goToDayVote();
  }
}

// --- Vote du village (jour) ---

function renderDayVotePanel(panel) {
  if (!currentDayVoteUnsub) {
    currentDayVoteUnsub = onSnapshot(doc(db, "lobbies", CODE, "dayVotes", `day_${lobbyData.dayNumber}`), (snap) => {
      renderDayVoteContent(panel, snap.exists() ? snap.data() : null);
    });
  }
}

// Cree le document de vote du jour : appele uniquement au clic de l'Hote sur
// "Lancer le vote du village", jamais automatiquement en arrivant sur la phase.
async function startDayVote() {
  await setDoc(doc(db, "lobbies", CODE, "dayVotes", `day_${lobbyData.dayNumber}`), { votes: {} });
}

function renderDayVoteContent(panel, voteData) {
  const alivePlayers = players.filter((p) => p.isAlive);

  if (!voteData) {
    panel.innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">⚖️</div>
        <h2>Vote du village</h2>
        <p class="hint">Debattez, puis lancez le vote quand le village est pret a designer un suspect.</p>
        <button id="startDayVoteBtn" class="primary big">Lancer le vote du village</button>
      </div>
    `;
    guardedClick(document.getElementById("startDayVoteBtn"), startDayVote);
    return;
  }

  const votes = voteData.votes || {};
  const tally = {};
  Object.values(votes).forEach((t) => { tally[t] = (tally[t] || 0) + 1; });

  if (voteData.tieBreakPending) {
    panel.innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">⚖️</div>
        <h2>Egalite au vote</h2>
        <p class="hint">Le Gouverneur (${escapeHtml(players.find((p) => p.id === lobbyData.governorId)?.name || "?")}) doit departager depuis son telephone.</p>
      </div>
    `;
    if (voteData.governorPick) finalizeDayVote(voteData);
    return;
  }

  const totalVotes = Object.keys(votes).length;
  panel.innerHTML = `
    <div class="vote-stage">
      <div class="vote-stage-icon">⚖️</div>
      <h2>Vote du village</h2>
      <p class="hint">${totalVotes} / ${alivePlayers.length} joueurs ont vote.</p>
      <div class="vote-tally">${renderTallyRows(alivePlayers, tally, totalVotes)}</div>
      <button id="closeVoteBtn" class="primary big">Clore le vote</button>
    </div>
  `;
  guardedClick(document.getElementById("closeVoteBtn"), () => finalizeDayVote(voteData));
}

async function finalizeDayVote(voteData) {
  const votes = voteData.votes || {};
  const tally = {};
  Object.values(votes).forEach((t) => { tally[t] = (tally[t] || 0) + 1; });

  let eliminatedId = null;

  if (voteData.governorPick) {
    eliminatedId = voteData.governorPick;
  } else if (Object.keys(tally).length > 0) {
    const max = Math.max(...Object.values(tally));
    const tied = Object.keys(tally).filter((id) => tally[id] === max);
    if (tied.length > 1) {
      const governorAlive = players.find((p) => p.id === lobbyData.governorId && p.isAlive);
      if (governorAlive) {
        await updateDoc(doc(db, "lobbies", CODE, "dayVotes", `day_${lobbyData.dayNumber}`), { tieBreakPending: true, tieCandidates: tied });
        return;
      }
      eliminatedId = tied[Math.floor(Math.random() * tied.length)];
    } else {
      eliminatedId = tied[0];
    }
  }

  const isFirstDayVote = !lobbyData.isFirstDayVoteDone;
  const eliminatedPlayer = eliminatedId ? players.find((p) => p.id === eliminatedId) : null;

  if (eliminatedPlayer) {
    await updateDoc(doc(db, "lobbies", CODE, "players", eliminatedPlayer.id), { isAlive: false, deathCause: "vote du village" });
  }

  // Le Martyr rate son coup : il perd son pouvoir et devient Citoyen.
  if (isFirstDayVote && (!eliminatedPlayer || eliminatedPlayer.role !== "martyr")) {
    const martyr = players.find((p) => p.role === "martyr" && p.isAlive);
    if (martyr) {
      await updateDoc(doc(db, "lobbies", CODE, "playersPrivate", martyr.id), { role: "citoyen", camp: "citoyens" });
    }
  }

  await updateDoc(doc(db, "lobbies", CODE), { isFirstDayVoteDone: true });

  const special = eliminatedPlayer ? checkDayVoteSpecialConditions(eliminatedPlayer, isFirstDayVote) : null;
  if (special) {
    await endGame(special);
    return;
  }

  // Mort en chaine des Ames Soeurs : annoncee dans le meme ecran de resultat
  // que l'elimination elle-meme (pas silencieusement plus tard, au moment de
  // "Passer a la nuit").
  let loverCascade = null;
  if (eliminatedPlayer?.loverId) {
    const lover = players.find((p) => p.id === eliminatedPlayer.loverId && p.isAlive);
    if (lover) {
      await updateDoc(doc(db, "lobbies", CODE, "players", lover.id), { isAlive: false, deathCause: "mort de chagrin" });
      loverCascade = { id: lover.id, name: lover.name, role: lover.role };
    }
  }

  // Le resultat du vote (qui a ete elimine, et son role) est annonce a tout
  // le monde AVANT de passer a la nuit : l'Hote garde la main via le bouton
  // "Passer a la nuit" (voir renderDayVoteResultPanel), qui ne fait
  // resolveDeathConsequences (Sherif, Gouverneur, victoire...) qu'a ce moment.
  // Nom et role sont graves directement ici (pas seulement l'id) : l'Hote est
  // le seul a pouvoir lire le role prive de la victime, donc c'est a lui de
  // publier cette revelation - les clients Joueur ne peuvent plus le
  // deviner eux-memes depuis leur propre lecture de `players`.
  await updateDoc(doc(db, "lobbies", CODE), {
    status: "day_vote_result",
    dayVoteResult: eliminatedPlayer
      ? { eliminatedId: eliminatedPlayer.id, eliminatedName: eliminatedPlayer.name, eliminatedRole: eliminatedPlayer.role, loverCascade }
      : { eliminatedId: null, eliminatedName: null, eliminatedRole: null, loverCascade },
  });
}

function renderDayVoteResultPanel(panel) {
  const { eliminatedId, eliminatedName, eliminatedRole, loverCascade } = lobbyData.dayVoteResult || {};
  const message = eliminatedId
    ? `Le village a elimine <strong>${escapeHtml(eliminatedName)}</strong>. Il/elle etait <strong>${getRoleInfo(eliminatedRole).icon} ${escapeHtml(getRoleInfo(eliminatedRole).label)}</strong>.`
    : "Le village n'a elimine personne aujourd'hui.";
  const loverMessage = loverCascade
    ? `<p>💔 Fou de chagrin, <strong>${escapeHtml(loverCascade.name)}</strong> en meurt aussi. Il/elle etait <strong>${getRoleInfo(loverCascade.role).icon} ${escapeHtml(getRoleInfo(loverCascade.role).label)}</strong>.</p>`
    : "";
  panel.innerHTML = `
    <div class="vote-stage">
      <div class="vote-stage-icon">⚖️</div>
      <h2>Resultat du vote</h2>
      <p>${message}</p>
      ${loverMessage}
      <button id="continueAfterDayVoteBtn" class="primary big">Passer a la nuit</button>
    </div>
  `;
  guardedClick(document.getElementById("continueAfterDayVoteBtn"), async () => {
    const newlyDeadIds = [eliminatedId, loverCascade?.id].filter(Boolean);
    await resolveDeathConsequences(newlyDeadIds, { origin: "day_vote" });
  });
}

// --- Sherif : riposte fatale ---

let sheriffTimeoutHandle = null;
let sheriffResolving = false;
let sheriffTimerForDeadline = null;

function renderSheriffPanel(panel) {
  const rev = lobbyData.sheriffRevenge;
  const sheriff = players.find((p) => p.id === rev?.sheriffId);
  panel.innerHTML = `
    <h2>Riposte du Sherif</h2>
    <p>${escapeHtml(sheriff?.name || "Le Sherif")} vient de mourir et dispose d'une seconde pour abattre quelqu'un depuis son telephone.</p>
    <p class="waiting">En attente de sa decision (ou resolution automatique)...</p>
  `;
  if (rev?.playerChoice !== undefined && rev.playerChoice !== null) {
    finalizeSheriffRevenge(rev.playerChoice);
    return;
  }
  maybeAutoResolveSheriff();
}

// Un seul minuteur actif a la fois : on le reamorce a chaque nouvel evenement
// (identifie par sa deadline), et on l'annule des qu'il est resolu.
function maybeAutoResolveSheriff() {
  const rev = lobbyData.sheriffRevenge;
  if (!rev) return;
  if (sheriffTimerForDeadline === rev.deadlineAt) return;
  if (sheriffTimeoutHandle) clearTimeout(sheriffTimeoutHandle);
  sheriffTimerForDeadline = rev.deadlineAt;
  const remaining = rev.deadlineAt - Date.now();
  sheriffTimeoutHandle = setTimeout(async () => {
    const freshLobby = (await getDocFromServer(doc(db, "lobbies", CODE))).data();
    if (!freshLobby.sheriffRevenge || freshLobby.status !== "sheriff_revenge") return; // deja resolu
    const candidates = players.filter((p) => p.isAlive && p.id !== rev.sheriffId);
    if (candidates.length === 0) { await finalizeSheriffRevenge(null); return; }
    const randomTarget = candidates[Math.floor(Math.random() * candidates.length)];
    await finalizeSheriffRevenge(randomTarget.id);
  }, Math.max(0, remaining));
}

async function finalizeSheriffRevenge(targetId) {
  if (sheriffResolving) return;
  sheriffResolving = true;
  if (sheriffTimeoutHandle) { clearTimeout(sheriffTimeoutHandle); sheriffTimeoutHandle = null; }
  const rev = lobbyData.sheriffRevenge;
  if (!rev) { sheriffResolving = false; return; }
  await updateDoc(doc(db, "lobbies", CODE, "players", rev.sheriffId), { hasFired: true });
  const newDead = [];
  if (targetId) {
    await updateDoc(doc(db, "lobbies", CODE, "players", targetId), { isAlive: false, deathCause: "abattu par le Sherif" });
    newDead.push(targetId);
  }
  const nextStatus = rev.nextStatus;
  await updateDoc(doc(db, "lobbies", CODE), { sheriffRevenge: null });
  sheriffResolving = false;
  await resolveDeathConsequences(newDead, { origin: "sheriff", forcedNextStatus: nextStatus });
}

// --- Consequences partagees (amoureux en chaine, sherif, gouverneur, victoire) ---

// Comme `players` (fusion des collections publique + privee), mais lu
// directement depuis le serveur (pas le cache local) : utilise partout ou le
// code a besoin d'un etat parfaitement a jour juste apres une ecriture (cf.
// le bug de cache documente en session 1 dans DECISIONS.md). Oublier de
// fusionner `playersPrivate` ici ferait disparaitre role/camp/amoureux de
// tous les calculs qui suivent (victoire, cascade des Ames Soeurs, Sherif...).
async function getFreshPlayers() {
  const [publicSnap, privateSnap] = await Promise.all([
    getDocsFromServer(collection(db, "lobbies", CODE, "players")),
    getDocsFromServer(collection(db, "lobbies", CODE, "playersPrivate")),
  ]);
  const privById = {};
  privateSnap.docs.forEach((d) => { privById[d.id] = d.data(); });
  return publicSnap.docs.map((d) => ({ id: d.id, ...d.data(), ...(privById[d.id] || {}) }));
}

async function resolveDeathConsequences(newlyDeadIds, { origin, forcedNextStatus } = {}) {
  let freshPlayers = await getFreshPlayers();

  // 1. Mort en chaine des Ames Soeurs.
  const cascade = [...newlyDeadIds];
  for (let i = 0; i < cascade.length; i++) {
    const dead = freshPlayers.find((p) => p.id === cascade[i]);
    if (!dead || !dead.loverId) continue;
    const lover = freshPlayers.find((p) => p.id === dead.loverId);
    if (lover && lover.isAlive) {
      await updateDoc(doc(db, "lobbies", CODE, "players", lover.id), { isAlive: false, deathCause: "mort de chagrin" });
      freshPlayers = freshPlayers.map((p) => (p.id === lover.id ? { ...p, isAlive: false, deathCause: "mort de chagrin" } : p));
      cascade.push(lover.id);
    }
  }

  // 2. Conditions de victoire generales.
  const victory = checkVictoryConditions(freshPlayers);
  if (victory) {
    await endGame(victory);
    return;
  }

  // Statut naturel suivant si aucune complication : nuit -> vote du jour, vote du jour -> nuit suivante.
  const natural = forcedNextStatus || (origin === "day_vote" ? "night" : "day_vote");

  // 3. Riposte du Sherif (seulement si non deja en cours de resolution).
  if (origin !== "sheriff") {
    const deadSheriff = cascade
      .map((id) => freshPlayers.find((p) => p.id === id))
      .find((p) => p && p.role === "sheriff" && !p.hasFired);
    if (deadSheriff) {
      await updateDoc(doc(db, "lobbies", CODE), {
        status: "sheriff_revenge",
        sheriffRevenge: { sheriffId: deadSheriff.id, deadlineAt: Date.now() + 1000, nextStatus: natural },
      });
      return;
    }
  }

  // 4. Gouverneur manquant -> election obligatoire ; sinon transition naturelle.
  const governorOk = freshPlayers.some((p) => p.id === lobbyData.governorId && p.isAlive);
  if (!governorOk) {
    await updateDoc(doc(db, "lobbies", CODE), { status: "election", electionReturnTo: natural });
  } else if (natural === "night") {
    await goToNight();
  } else {
    await goToDayVote();
  }
}

// Prepare la nuit a venir : determine le premier role necessaire, mais ne le
// lance pas encore. L'Hote devra cliquer "Lancer <role>" (voir
// renderNightPanel, step === "ready") avant qu'il ne commence reellement.
async function goToNight() {
  const nextNightNumber = (lobbyData.nightNumber || 0) + 1;
  const freshPlayers = await getFreshPlayers();
  await beginNight(CODE, nextNightNumber, freshPlayers, lobbyData);
}

async function goToDayVote() {
  const nextDayNumber = (lobbyData.dayNumber || 0) + 1;
  await updateDoc(doc(db, "lobbies", CODE), { status: "day_vote", dayNumber: nextDayNumber });
}

async function endGame(victory) {
  // Reveal final : l'Hote (seul a avoir acces a tous les roles prives) grave
  // ici le role de CHAQUE joueur dans le document du salon lui-meme, pour que
  // l'ecran de victoire cote Joueur puisse afficher "tous les roles" sans
  // avoir besoin (ni le droit) de lire les documents prives des autres.
  const finalReveal = players.map((p) => ({ id: p.id, name: p.name, role: p.role, camp: p.camp, isAlive: p.isAlive }));
  await updateDoc(doc(db, "lobbies", CODE), {
    status: "ended",
    winningCamp: victory.winningCamp,
    winningPlayerIds: victory.winningPlayerIds,
    winReason: victory.reason,
    finalReveal,
  });
}

// ---------------------------------------------------------------------------
// PHASE : FIN DE PARTIE
// ---------------------------------------------------------------------------

const CAMP_META = {
  citoyens: { icon: "🕊️", label: "Camp des Citoyens", color: "gold" },
  assassins: { icon: "🗡️", label: "Camp des Assassins", color: "blood" },
  martyr: { icon: "⚰️", label: "Le Martyr", color: "purple" },
  psychopathe: { icon: "🔪", label: "Le Psychopathe", color: "blood" },
  amoureux: { icon: "💞", label: "Les Ames Soeurs", color: "purple" },
};

function renderEnd() {
  document.getElementById("configScreen").classList.add("hidden");
  document.getElementById("setupScreen").classList.add("hidden");
  document.getElementById("gameScreen").classList.add("hidden");
  document.getElementById("endScreen").classList.remove("hidden");

  // La partie peut se terminer en plein milieu d'une phase (nuit, vote...) :
  // on coupe les listeners de cette phase pour eviter qu'ils ne perturbent
  // une eventuelle prochaine partie (bouton "Rejouer").
  if (currentNightUnsub) { currentNightUnsub(); currentNightUnsub = null; currentNightActionsData = null; }
  if (currentElectionUnsub) { currentElectionUnsub(); currentElectionUnsub = null; }
  if (currentDayVoteUnsub) { currentDayVoteUnsub(); currentDayVoteUnsub = null; }
  lastRenderedStatus = null;

  const el = document.getElementById("endScreen");
  // Source des roles pour cet ecran : le reveal final grave par l'Hote dans
  // `lobbyData.finalReveal` au moment de la victoire (voir endGame()), plutot
  // que le tableau `players` local - qui, cote Joueur, ne contient plus le
  // role des autres depuis la separation public/prive des documents joueur.
  const revealById = Object.fromEntries((lobbyData.finalReveal || []).map((r) => [r.id, r]));
  const winners = (lobbyData.winningPlayerIds || []).map((id) => revealById[id]).filter(Boolean);
  const meta = CAMP_META[lobbyData.winningCamp] || { icon: "🏆", label: lobbyData.winningCamp || "?", color: "gold" };

  // Garde anti-clignotement (voir renderAnnouncementPanel) : renderEnd() peut
  // etre redeclenche par un evenement Firestore sans rapport pendant que tout
  // le monde reste statique sur l'ecran de victoire/defaite.
  const html = `
    <div class="victory-banner victory-${meta.color}">
      <div class="victory-icon">${meta.icon}</div>
      <div class="victory-title">Victoire</div>
      <div class="victory-camp">${escapeHtml(meta.label)}</div>
      <p class="victory-reason">${escapeHtml(lobbyData.winReason || "")}</p>
    </div>
    <div class="winners-row">
      ${winners
        .map(
          (w) => `
        <div class="winner-chip">
          <span class="winner-avatar">${initials(w.name)}</span>
          <span class="winner-name">${escapeHtml(w.name)}</span>
          <span class="winner-role">${getRoleInfo(w.role).icon} ${escapeHtml(getRoleInfo(w.role).label)}</span>
        </div>`
        )
        .join("")}
    </div>
    <h3 class="reveal-title">Tous les roles</h3>
    <div class="reveal-grid">
      ${(lobbyData.finalReveal || [])
        .map(
          (p) => `
        <div class="reveal-card ${p.isAlive ? "" : "reveal-dead"}">
          <span class="reveal-status">${p.isAlive ? "🟢" : "💀"}</span>
          <span class="reveal-name">${escapeHtml(p.name)}</span>
          <span class="reveal-role">${getRoleInfo(p.role).icon} ${escapeHtml(getRoleInfo(p.role).label)}</span>
        </div>`
        )
        .join("")}
    </div>
    <div class="end-actions">
      <button id="rematchBtn" class="primary big">Rejouer</button>
      <button id="closeLobbyBtnEnd" class="danger-outline big">Fermer le salon</button>
    </div>
  `;
  if (el.innerHTML === html) return;
  el.innerHTML = html;
  guardedClick(document.getElementById("rematchBtn"), rematch);
  document.getElementById("closeLobbyBtnEnd").addEventListener("click", () => {
    document.getElementById("confirmCloseModal").classList.remove("hidden");
  });
}

// Supprime tous les documents d'une sous-collection (utilise pour purger
// nightActions/dayVotes/election entre deux parties du meme salon : leurs
// identifiants de document sont reutilises d'une partie a l'autre - night_1,
// day_1, ... - donc un document laisse par la partie precedente serait
// repris tel quel (avec ses votes/actions perimes) par la nouvelle partie).
async function purgeSubcollection(name) {
  const snap = await getDocs(collection(db, "lobbies", CODE, name));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

// Remet le meme salon (memes joueurs, meme composition) en etat de lobby
// ouvert : tout le monde retourne a l'ecran d'attente pour relancer une
// partie sans avoir a redonner le code.
async function rematch() {
  await Promise.all(
    players.map((p) =>
      updateDoc(doc(db, "lobbies", CODE, "players", p.id), {
        isAlive: true,
        deathCause: null,
        isReady: false,
        isGovernorCandidate: false,
        potions: { life: true, death: true },
        hasUsedCorruption: false,
        hasFired: false,
      })
    )
  );
  await Promise.all(
    players.map((p) =>
      updateDoc(doc(db, "lobbies", CODE, "playersPrivate", p.id), {
        role: null,
        camp: null,
        loverId: null,
        teammateIds: [],
        detectiveReveal: null,
      })
    )
  );
  await clearChat(CODE, "chatGame");
  await Promise.all([
    purgeSubcollection("nightActions"),
    purgeSubcollection("dayVotes"),
    purgeSubcollection("election"),
  ]);
  await updateDoc(doc(db, "lobbies", CODE), {
    status: "lobby",
    governorId: null,
    currentNightStep: null,
    pendingNightStep: null,
    nightNumber: 0,
    dayNumber: 0,
    isFirstDayVoteDone: false,
    electionReturnTo: null,
    tueurPowerLost: false,
    sheriffRevenge: null,
    winningCamp: null,
    winningPlayerIds: [],
    winReason: null,
    lastNightResult: null,
    dayVoteResult: null,
    finalReveal: null,
    resultsRevealed: false,
  });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

init();
