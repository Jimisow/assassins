// Logique de l'ecran Joueur : role prive, actions nocturnes, votes, chat etanche.
import { db, doc, collection, updateDoc, onSnapshot } from "./firebase-config.js";
import { loadSession, clearSession, verifyPlayerSessionValid, setPlayerReady, withdrawOrCandidate } from "./lobby.js";
import { sendMessage, listenToChat } from "./chat.js";
import { getRoleInfo } from "./roles.js";
import {
  submitDestin,
  submitDetective,
  peekDetectiveTarget,
  submitAssassinVote,
  triggerAssassinInsist,
  submitTueur,
  submitCorrupteur,
  submitChimiste,
  nightActionsRef,
} from "./night-cycle.js";
import { guardedClick, guardedSubmit } from "./ui-utils.js";
import { initNetworkStatus } from "./network-status.js";

initNetworkStatus();

const session = loadSession();
let CODE = null;
let PLAYER_ID = null;

let lobbyData = null;
let players = [];
// Le role/camp/amoureux/coequipiers vivent dans un document PRIVE separe
// (`playersPrivate/{id}`) : les regles Firestore ne permettent a ce client
// de lire QUE le sien (cf. firestore.rules), donc apres fusion, seul "me"
// aura ces champs renseignes dans `players` - les autres joueurs y
// apparaissent uniquement avec leurs champs publics (nom, vivant, etc.).
let publicPlayers = [];
let privateById = {};
function mergePlayers() {
  players = publicPlayers.map((p) => ({ ...p, ...(privateById[p.id] || {}) }));
  me = players.find((p) => p.id === PLAYER_ID) || null;
}
let me = null;
let nightActionsData = null;
let insistShakeSeen = 0;

async function init() {
  if (!session || session.type !== "player") {
    window.location.href = "index.html";
    return;
  }
  CODE = session.code;
  PLAYER_ID = session.playerId;

  const valid = await verifyPlayerSessionValid(CODE, PLAYER_ID);
  if (!valid) {
    clearSession();
    window.location.href = "index.html";
    return;
  }

  document.getElementById("lobbyCodeDisplay").textContent = CODE;

  onSnapshot(doc(db, "lobbies", CODE), (snap) => {
    if (!snap.exists()) {
      sessionStorage.setItem("assassins_notice", "L'hote a ferme le salon.");
      clearSession();
      window.location.href = "index.html";
      return;
    }
    lobbyData = { id: snap.id, ...snap.data() };
    render();
  });

  onSnapshot(collection(db, "lobbies", CODE, "players"), (snap) => {
    publicPlayers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    mergePlayers();
    render();
  });

  // Requete sur UN SEUL document (pas sur toute la collection) : les regles
  // Firestore n'autorisent la lecture de playersPrivate qu'au proprietaire du
  // document ou a l'Hote, et Firestore rejette entierement une requete de
  // LISTE (collection().onSnapshot() sans filtre `where`) des qu'elle ne peut
  // pas garantir que TOUS les documents potentiellement renvoyes passent la
  // regle - contrairement a une lecture d'un document precis, qui elle est
  // evaluee individuellement. Comme ce client n'a de toute facon jamais le
  // droit de lire que SON PROPRE document prive, cibler directement ce
  // document est a la fois necessaire (pour eviter le refus global) et plus
  // simple (pas besoin de filtrer un tableau).
  onSnapshot(doc(db, "lobbies", CODE, "playersPrivate", PLAYER_ID), (snap) => {
    privateById = snap.exists() ? { [PLAYER_ID]: snap.data() } : {};
    mergePlayers();
    render();
  });

  document.getElementById("showRoleBtn").addEventListener("click", () => { if (me) openRoleModal(); });
  document.getElementById("closeRoleModalBtn").addEventListener("click", closeRoleModal);

  guardedClick(document.getElementById("readyBtn"), async () => {
    if (!me) return;
    await setPlayerReady(CODE, PLAYER_ID, !me.isReady);
  });

  bindChatForms();
  initGameChatModal();
}

function render() {
  if (!lobbyData || !me) return;

  // Premier statut de jeu vu : la partie commence maintenant. Un
  // rafraichissement en cours de partie remet ce chrono a zero — la duree
  // envoyee sera alors sous-estimee, jamais surestimee ; c'est le bon sens de
  // l'erreur (elle coute moins cher en reserve de temps reel cote serveur).
  if (kumpDebutPartie === null && lobbyData.status !== "lobby" && lobbyData.status !== "config" && lobbyData.status !== "ended") {
    kumpDebutPartie = Date.now();
  }

  renderRoster();
  renderStatusBanner();
  updateDayNightBadge();
  maybeShowDayNightTransition();

  const lobbyScreen = document.getElementById("lobbyWaitScreen");
  const gameScreen = document.getElementById("gameScreen");
  const endScreen = document.getElementById("endScreen");

  const chatBtn = document.getElementById("chatBtn");
  const readyBtn = document.getElementById("readyBtn");
  const rosterCard = document.querySelector(".roster-card");

  if (lobbyData.status === "lobby" || lobbyData.status === "config") {
    // Retour au salon = "Rejouer". La trace de la partie precedente doit
    // repartir a zero, sinon le verrou anti-doublon resterait arme et la
    // partie suivante ne serait JAMAIS enregistree — et sa duree serait
    // comptee depuis la partie d'avant.
    kumpDebutPartie = null;
    kumpPartieEnvoyee = false;
    lobbyScreen.classList.remove("hidden");
    gameScreen.classList.add("hidden");
    endScreen.classList.add("hidden");
    chatBtn.classList.add("hidden");
    readyBtn.classList.remove("hidden");
    rosterCard.classList.remove("hidden");
    renderLobbyWait();
  } else if (lobbyData.status === "ended") {
    lobbyScreen.classList.add("hidden");
    gameScreen.classList.add("hidden");
    endScreen.classList.remove("hidden");
    chatBtn.classList.add("hidden");
    readyBtn.classList.add("hidden");
    // L'ecran de victoire affiche deja tous les roles/statuts : la liste de
    // joueurs "brute" (sans role) devient redondante a ce stade.
    rosterCard.classList.add("hidden");
    renderEnd();
    envoyerPartieAuCompteKump();
  } else {
    lobbyScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    endScreen.classList.add("hidden");
    chatBtn.classList.remove("hidden");
    readyBtn.classList.add("hidden");
    rosterCard.classList.remove("hidden");
    renderGamePhase();
    renderGameChatModal();
  }
}

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
// correct meme apres un "Rejouer" (le meme onglet reste ouvert, sans
// rechargement, donc sans reinitialisation des variables locales du module).
let lastTransitionStatus = null;

// --- Compte KUMP -------------------------------------------------------------
// Instant ou la partie a REELLEMENT commence (premier statut de jeu), pas
// l'arrivee dans le salon : sinon l'attente des autres joueurs serait comptee
// comme du temps de jeu, et une partie de 10 minutes precedee d'une heure de
// salon en vaudrait soixante-dix.
let kumpDebutPartie = null;
// L'ecran de fin se redessine a chaque snapshot Firestore : sans ce verrou, la
// meme partie partirait plusieurs fois.
let kumpPartieEnvoyee = false;
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

// --- Roster & bandeau de statut ---

// Ne reecrit le DOM que si le contenu a reellement change : la liste des
// joueurs est reconstruite a chaque rafraichissement general de l'ecran (tres
// frequent en partie reelle - vote/chat/pret d'un autre joueur), et reecrire
// inconditionnellement l'innerHTML provoquait un clignotement visible meme
// quand rien ne changeait vraiment pour ce joueur.
function renderRoster() {
  const list = document.getElementById("playerList");
  const html = players
    .map((p) => {
      const badges = [];
      if (lobbyData.governorId === p.id) badges.push('<span class="badge governor">&#128081; Gouverneur</span>');
      if (p.id === PLAYER_ID) badges.push('<span class="badge me">Vous</span>');
      return `<li class="${p.isAlive ? "alive" : "dead"}"><span class="skull">${p.isAlive ? "" : "&#128128; "}</span>${escapeHtml(p.name)} ${badges.join(" ")}</li>`;
    })
    .join("");
  if (list.innerHTML !== html) list.innerHTML = html;
}

function renderStatusBanner() {
  const banner = document.getElementById("statusBanner");
  const labels = {
    lobby: "Salon d'attente",
    election: "Election du Gouverneur",
    day_vote: "Vote du village",
    day_vote_result: "Resultat du vote",
    night: "La nuit tombe...",
    day_announcement: "Le village se reveille",
    sheriff_revenge: "Riposte du Sherif",
    ended: "Partie terminee",
  };
  banner.textContent = labels[lobbyData.status] || lobbyData.status;
}

// --- Lobby (avant partie) ---

let lobbyChatBound = false;
function renderLobbyWait() {
  document.getElementById("readyBtn").textContent = me.isReady ? "Pret ! (cliquer pour annuler)" : "Je suis pret";
  document.getElementById("readyBtn").classList.toggle("active", me.isReady);
  if (!lobbyChatBound) {
    lobbyChatBound = true;
    listenToChat(CODE, "chatLobby", (msgs) => renderChatBox("lobbyChatMessages", msgs));
  }
}

// --- Modale "Voir mon role" ---

let roleModalTimer = null;
function openRoleModal() {
  const info = getRoleInfo(me.role || "citoyen");
  const lover = me.loverId ? players.find((p) => p.id === me.loverId) : null;
  document.getElementById("roleModalTitle").textContent = `${info.icon} ${info.label}`;
  document.getElementById("roleModalDesc").textContent = info.description;
  document.getElementById("roleModalVictory").textContent = info.victoryText;
  document.getElementById("roleModalLover").textContent = lover ? `Votre ame soeur : ${lover.name}` : "";
  document.getElementById("roleModal").classList.remove("hidden");
  document.getElementById("roleModal").classList.add("fade-in");
  clearTimeout(roleModalTimer);
  roleModalTimer = setTimeout(closeRoleModal, 7000);
}
function closeRoleModal() {
  document.getElementById("roleModal").classList.add("hidden");
  clearTimeout(roleModalTimer);
}

// --- Phases de jeu ---

// A chaque changement de statut, on coupe les listeners propres a la phase
// qu'on quitte (election/vote/nuit). Sans ça, un listener reste actif pour
// toujours et peut re-ecrire #gamePhasePanel avec du contenu perime (ex: un
// vote d'election affiche par-dessus le vote du village qui vient de
// commencer) des qu'un document qu'il observe change a nouveau plus tard.
let lastGamePhaseStatus = null;
// Incremente a chaque nettoyage : permet aux callbacks onSnapshot de detecter
// qu'ils sont perimes meme si une notification etait deja "en vol" au moment
// de l'appel a unsubscribe() (course reseau rare mais possible).
let phaseListenerGen = 0;
function renderGamePhase() {
  if (lobbyData.status !== lastGamePhaseStatus) {
    lastGamePhaseStatus = lobbyData.status;
    phaseListenerGen++;
    if (electionUnsub) { electionUnsub(); electionUnsub = null; electionData = null; }
    if (dayVoteUnsub) { dayVoteUnsub(); dayVoteUnsub = null; dayVoteData = null; }
    if (nightActionsUnsub) { nightActionsUnsub(); nightActionsUnsub = null; nightActionsData = null; nightActionsLoadedForNight = null; }
  }

  const panel = document.getElementById("gamePhasePanel");
  if (lobbyData.status === "night") {
    renderNightAction(panel);
  } else if (lobbyData.status === "day_announcement") {
    renderAnnouncement(panel);
  } else if (lobbyData.status === "election") {
    renderElection(panel);
  } else if (lobbyData.status === "day_vote") {
    renderDayVote(panel);
  } else if (lobbyData.status === "day_vote_result") {
    renderDayVoteResult(panel);
  } else if (lobbyData.status === "sheriff_revenge") {
    renderSheriffModal(panel);
  }
}

function renderDayVoteResult(panel) {
  document.getElementById("actionModal").classList.add("hidden");
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
      <p class="waiting">En attente que l'hote passe a la nuit...</p>
    </div>
  `;
}

// --- Chat en partie : flux unique, les vivants ne voient pas les messages des morts ---

let gameChatBound = false;
let gameChatMessages = [];
let chatModalOpen = false;
let seenChatMessageIds = new Set();
let unreadChatCount = 0;

function initGameChatModal() {
  if (gameChatBound) return;
  gameChatBound = true;
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
    await sendMessage(CODE, "chatGame", PLAYER_ID, me.name, input.value, { isDead: !me.isAlive });
    input.value = "";
  });
  listenToChat(CODE, "chatGame", (msgs) => {
    gameChatMessages = msgs;
    renderGameChatModal();
  });
}

function renderGameChatModal() {
  const box = document.getElementById("chatModalMessages");
  if (!box || !me) return;
  // Les vivants ne voient pas les messages envoyes par les morts ; les morts voient tout.
  const visible = me.isAlive ? gameChatMessages.filter((m) => !m.isDead) : gameChatMessages;
  box.innerHTML = visible
    .map((m) => `<div class="chat-msg ${m.isDead ? "spectral-msg" : ""}"><span class="author">${escapeHtml(m.authorName)}</span> : ${escapeHtml(m.text)}</div>`)
    .join("");
  box.scrollTop = box.scrollHeight;

  if (!chatModalOpen) {
    visible.forEach((m) => {
      if (!seenChatMessageIds.has(m.id)) unreadChatCount++;
    });
  }
  visible.forEach((m) => seenChatMessageIds.add(m.id));
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

function bindChatForms() {
  guardedSubmit(document.getElementById("lobbyChatForm"), async () => {
    const input = document.getElementById("lobbyChatInput");
    if (!input.value.trim()) return;
    await sendMessage(CODE, "chatLobby", PLAYER_ID, me?.name || "Joueur", input.value);
    input.value = "";
  });
}

function renderChatBox(elId, messages) {
  const box = document.getElementById(elId);
  if (!box) return;
  box.innerHTML = messages
    .map((m) => `<div class="chat-msg"><span class="author">${escapeHtml(m.authorName)}</span> : ${escapeHtml(m.text)}</div>`)
    .join("");
  box.scrollTop = box.scrollHeight;
}

// --- Nuit : actions par role ---

// Le Tueur en Serie et le Corrupteur font partie du camp Assassins : ils
// participent au vote commun de la cible principale (etape "assassins"), en
// plus de leur propre etape dediee plus tard dans la nuit (kill bonus /
// corruption). "assassin" (role) et le camp "assassins" pendant l'etape
// "assassins" designent donc le meme groupe de joueurs actifs.
const MY_TURN_ROLE_STEP = { destin: "destin", detective: "detective", assassin: "assassins", tueur_en_serie: "tueur", corrupteur: "corrupteur", chimiste: "chimiste" };

function renderNightAction(panel) {
  const currentStep = lobbyData.currentNightStep;
  const isAssassinsCampTurn = currentStep === "assassins" && me.camp === "assassins";
  const activeStep = isAssassinsCampTurn ? "assassins" : MY_TURN_ROLE_STEP[me.role];
  const isMyStep = me.isAlive && currentStep === activeStep;

  if (!nightActionsUnsub) {
    const myGen = phaseListenerGen;
    nightActionsUnsub = onSnapshot(nightActionsRef(CODE, lobbyData.nightNumber), (snap) => {
      if (myGen !== phaseListenerGen) return;
      nightActionsData = snap.data();
      if (lobbyData.status === "night") renderNightAction(document.getElementById("gamePhasePanel"));
    });
    nightActionsLoadedForNight = lobbyData.nightNumber;
  }
  if (nightActionsLoadedForNight !== lobbyData.nightNumber) {
    nightActionsUnsub();
    nightActionsUnsub = null;
    nightActionsData = null;
    return renderNightAction(panel);
  }

  const actionModal = document.getElementById("actionModal");

  if (!isMyStep) {
    actionModal.classList.add("hidden");
    panel.innerHTML = `<p class="waiting">La nuit est tombee. Attendez votre tour ou le reveil du village...</p>`;
    return;
  }
  if (!nightActionsData) { panel.innerHTML = "<p>Chargement...</p>"; return; }

  // Tant que le role n'a pas valide son action, celle-ci s'affiche dans une
  // modale bien visible (comme la riposte du Sherif). Une fois validee, la
  // modale se ferme et le panneau principal indique l'attente de l'hote.
  const stepData = nightActionsData[activeStep];
  if (stepData?.done) {
    actionModal.classList.add("hidden");
    panel.innerHTML = `<p class="waiting">Action validee. En attente que l'hote passe au role suivant...</p>`;
    return;
  }

  panel.innerHTML = `<p class="waiting">C'est votre tour : une fenetre est ouverte pour votre action.</p>`;
  actionModal.classList.remove("hidden");
  const modalBody = document.getElementById("actionModalBody");

  // isAssassinsCampTurn couvre le role "assassin" lui-meme (camp assassins,
  // etape "assassins"), donc pas besoin d'un cas separe pour ce role ici.
  if (isAssassinsCampTurn) renderAssassinAction(modalBody);
  else if (me.role === "destin") renderDestinAction(modalBody);
  else if (me.role === "detective") renderDetectiveAction(modalBody);
  else if (me.role === "tueur_en_serie") renderTueurAction(modalBody);
  else if (me.role === "corrupteur") renderCorrupteurAction(modalBody);
  else if (me.role === "chimiste") renderChimisteAction(modalBody);
}
let nightActionsUnsub = null;
let nightActionsLoadedForNight = null;

function livingOthers() {
  return players.filter((p) => p.isAlive && p.id !== PLAYER_ID);
}

// Selection du Destin : cliquer un premier pseudo puis un second les relie
// par une ligne rose animee (au lieu de cases a cocher). Cliquer un pseudo
// deja choisi le deselectionne ; choisir un troisieme remplace le plus
// ancien des deux (toujours au plus 2 selectionnes).
let destinSelected = [];

function renderDestinAction(panel) {
  if (nightActionsData.destin.done) { destinSelected = []; panel.innerHTML = "<p>Vous avez designe les Ames Soeurs. En attente...</p>"; return; }
  const candidates = livingOthers().concat([me]);
  panel.innerHTML = `
    <h2>💘 Le Destin</h2>
    <p>Cliquez deux pseudos pour les relier : ils deviendront Ames Soeurs.</p>
    <div id="destinWrap" class="destin-wrap">
      <div id="destinChoices" class="choice-grid">
        ${candidates.map((p) => `<button type="button" class="choice-btn destin-pick ${destinSelected.includes(p.id) ? "selected" : ""}" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join("")}
      </div>
      <svg id="destinLineSvg" class="destin-line-svg"></svg>
    </div>
    <button id="destinValidate" class="primary" ${destinSelected.length === 2 ? "" : "disabled"}>Valider</button>
  `;
  panel.querySelectorAll(".destin-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (destinSelected.includes(id)) destinSelected = destinSelected.filter((x) => x !== id);
      else if (destinSelected.length < 2) destinSelected = [...destinSelected, id];
      else destinSelected = [destinSelected[1], id];
      renderDestinAction(panel);
    });
  });
  guardedClick(document.getElementById("destinValidate"), async () => {
    if (destinSelected.length !== 2) return;
    const pair = destinSelected;
    destinSelected = [];
    await submitDestin(CODE, lobbyData.nightNumber, pair);
  });
  drawDestinLine();
}

// Trace la ligne (+ etincelles) entre les deux pseudos selectionnes, en
// mesurant leur position reelle dans la grille (variable selon le nombre de
// joueurs / la largeur d'ecran, donc non calculable en CSS pur).
function drawDestinLine() {
  const svg = document.getElementById("destinLineSvg");
  const wrap = document.getElementById("destinWrap");
  if (!svg || !wrap || destinSelected.length !== 2) return;
  const elA = wrap.querySelector(`.destin-pick[data-id="${destinSelected[0]}"]`);
  const elB = wrap.querySelector(`.destin-pick[data-id="${destinSelected[1]}"]`);
  if (!elA || !elB) return;
  const wrapRect = wrap.getBoundingClientRect();
  const ra = elA.getBoundingClientRect();
  const rb = elB.getBoundingClientRect();
  const x1 = ra.left + ra.width / 2 - wrapRect.left;
  const y1 = ra.top + ra.height / 2 - wrapRect.top;
  const x2 = rb.left + rb.width / 2 - wrapRect.left;
  const y2 = rb.top + rb.height / 2 - wrapRect.top;
  svg.setAttribute("width", wrapRect.width);
  svg.setAttribute("height", wrapRect.height);
  const sparks = Array.from({ length: 6 })
    .map((_, i) => {
      const t = (i + 1) / 7;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      return `<circle cx="${px}" cy="${py}" r="3" class="destin-spark" style="animation-delay:${i * 0.15}s" />`;
    })
    .join("");
  svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="destin-line" />${sparks}`;
}

function renderDetectiveAction(panel) {
  const data = nightActionsData.detective;
  if (data.done) { panel.innerHTML = "<p>Enquete terminee. En attente que l'hote passe au role suivant...</p>"; return; }

  // Une seule cible sondee par nuit : des qu'un choix est fait, il est
  // verrouille en base (detective.peekedTargetId) pour empecher de revoir
  // d'autres cartes, meme apres un rechargement de page.
  if (data.peekedTargetId) {
    const target = players.find((p) => p.id === data.peekedTargetId);
    // Le role n'est plus lu directement (prive) ni stocke dans ce document
    // partage (lisible de tous) : l'Hote le remplit dans le document PRIVE
    // du Detective (`me.detectiveReveal`), un instant apres le choix de la
    // cible. Bref etat de chargement le temps que ca arrive (quasi
    // instantane en pratique, l'Hote observe deja tout ceci en temps reel).
    const reveal = me.detectiveReveal;
    const hasReveal = reveal?.targetId === data.peekedTargetId && reveal?.nightNumber === lobbyData.nightNumber;
    if (!hasReveal) {
      panel.innerHTML = `<p class="waiting">Sondage de ${escapeHtml(target?.name || "?")} en cours...</p>`;
      return;
    }
    const info = getRoleInfo(reveal.role);
    panel.innerHTML = `
      <h2>🔍 Le Detective</h2>
      <p class="detective-result-row"><span class="detective-result-label">Joueur</span> <strong>${escapeHtml(target?.name || "?")}</strong></p>
      <p class="detective-result-row"><span class="detective-result-label">Role</span> <strong>${info.icon} ${escapeHtml(info.label)}</strong></p>
      <p class="detective-result-desc">${escapeHtml(info.description)}</p>
      <button id="detectiveFinish" class="primary">Terminer</button>
    `;
    guardedClick(document.getElementById("detectiveFinish"), async () => {
      await submitDetective(CODE, lobbyData.nightNumber, data.peekedTargetId);
    });
    return;
  }

  panel.innerHTML = `
    <h2>🔍 Le Detective</h2>
    <p>Choisissez un joueur a sonder (un seul choix possible cette nuit).</p>
    <div id="detectiveChoices" class="choice-grid">${livingOthers().map((p) => `<button class="choice-btn" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join("")}</div>
  `;
  const detectiveChoices = document.getElementById("detectiveChoices");
  panel.querySelectorAll(".choice-btn").forEach((btn) => {
    guardedClick(btn, async () => {
      await peekDetectiveTarget(CODE, lobbyData.nightNumber, btn.dataset.id);
    }, detectiveChoices);
  });
}

// Un joueur ne peut lire QUE son propre document prive (cf. firestore.rules)
// : impossible de determiner le camp d'un AUTRE joueur en filtrant sur
// `p.camp`. `me.teammateIds` (rempli par l'Hote a l'assignation des roles,
// voir host.js:writeTeammateIds) donne directement la liste des coequipiers
// du camp Assassins, sans jamais avoir besoin de lire leur camp.
function isAssassinCampMember(id) {
  return id === PLAYER_ID || (me?.teammateIds || []).includes(id);
}

function renderAssassinAction(panel) {
  const data = nightActionsData.assassins;
  const targets = players.filter((p) => p.isAlive && !isAssassinCampMember(p.id));
  const myVote = data.votes?.[PLAYER_ID];

  if (data.insistTargetId && data.insistNonce > insistShakeSeen) {
    insistShakeSeen = data.insistNonce;
    setTimeout(() => {
      const row = document.querySelector(`[data-target-row="${data.insistTargetId}"]`);
      if (row) { row.classList.add("shake"); setTimeout(() => row.classList.remove("shake"), 600); }
    }, 50);
  }

  panel.innerHTML = `
    <h2>🗡️ Les Assassins</h2>
    <p>Choisissez la victime a l'unanimite. Pas de discussion a voix haute : utilisez "Insister" pour attirer l'attention.</p>
    <div id="assassinChoices" class="choice-grid">
      ${targets
        .map((p) => {
          const votedByOthers = Object.entries(data.votes || {}).filter(([voter, t]) => t === p.id && voter !== PLAYER_ID).length;
          return `
        <div class="assassin-target-cell" data-target-row="${p.id}">
          <button class="choice-btn ${myVote === p.id ? "selected" : ""}" data-id="${p.id}">${escapeHtml(p.name)}</button>
          ${votedByOthers > 0 ? `<span class="vote-marker">${votedByOthers} autre(s) assassin(s)</span>` : ""}
          ${myVote === p.id ? `<button class="insist-btn" data-id="${p.id}">Insister !</button>` : ""}
        </div>`;
        })
        .join("")}
    </div>
  `;
  const assassinChoices = document.getElementById("assassinChoices");
  panel.querySelectorAll(".choice-btn").forEach((btn) => {
    guardedClick(btn, async () => {
      // Le Tueur en Serie et le Corrupteur votent aussi (meme camp) : c'est
      // l'unanimite de tout le camp Assassins vivant qui est requise, pas
      // seulement celle des joueurs ayant le role "assassin".
      const livingAssassinIds = [PLAYER_ID, ...(me.teammateIds || [])].filter(
        (id) => players.find((p) => p.id === id)?.isAlive
      );
      await submitAssassinVote(CODE, lobbyData.nightNumber, PLAYER_ID, btn.dataset.id, livingAssassinIds);
    }, assassinChoices);
  });
  panel.querySelectorAll(".insist-btn").forEach((btn) => {
    btn.addEventListener("click", () => triggerAssassinInsist(CODE, lobbyData.nightNumber, btn.dataset.id));
  });
}

function renderTueurAction(panel) {
  if (nightActionsData.tueur.done) { panel.innerHTML = "<p>Action enregistree. En attente...</p>"; return; }
  // Ne peut pas cibler ses propres allies (camp Assassins), lui y compris.
  const targets = players.filter((p) => p.isAlive && !isAssassinCampMember(p.id));
  panel.innerHTML = `
    <h2>🔪 Le Tueur en Serie</h2>
    <p>Choisissez une victime bonus, ou passez votre tour.</p>
    <div class="choice-grid">${targets.map((p) => `<button class="choice-btn" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join("")}</div>
    <button id="tueurSkip" class="secondary">Passer</button>
  `;
  panel.querySelectorAll(".choice-btn").forEach((btn) => guardedClick(btn, () => submitTueur(CODE, lobbyData.nightNumber, btn.dataset.id), panel));
  guardedClick(document.getElementById("tueurSkip"), () => submitTueur(CODE, lobbyData.nightNumber, null), panel);
}

function renderCorrupteurAction(panel) {
  if (nightActionsData.corrupteur.done) { panel.innerHTML = "<p>Action enregistree. En attente...</p>"; return; }
  const assassinTarget = players.find((p) => p.id === nightActionsData.assassins.chosenTargetId);
  panel.innerHTML = `
    <h2>😈 Le Corrupteur</h2>
    <p>Cible actuelle des Assassins : <strong>${assassinTarget ? escapeHtml(assassinTarget.name) : "aucune"}</strong></p>
    <p>Vous pouvez la corrompre pour en faire un Assassin (une seule fois par partie), au lieu de la laisser mourir.</p>
    <button id="corruptBtn" class="primary" ${assassinTarget ? "" : "disabled"}>Infecter</button>
    <button id="corruptSkip" class="secondary">Passer</button>
  `;
  guardedClick(document.getElementById("corruptBtn"), () => submitCorrupteur(CODE, lobbyData.nightNumber, true, PLAYER_ID), panel);
  guardedClick(document.getElementById("corruptSkip"), () => submitCorrupteur(CODE, lobbyData.nightNumber, false, PLAYER_ID), panel);
}

// Selection locale (non persistee) le temps que le Chimiste compose ses
// potions ; remise a zero a chaque validation ou nouvelle nuit.
let chimisteLifeTargetId = null;
let chimisteDeathTargetId = null;

function renderChimisteAction(panel) {
  // Garde defensive : les boutons de cette modale se re-affichent eux-memes
  // (toggle des potions) en appelant directement cette fonction, en dehors
  // du chemin normal protege par renderNightAction. Si entre-temps la phase
  // a change (nightActionsData redevenu null/perime), on revient au rendu
  // standard plutot que de planter sur un acces null.
  if (!nightActionsData?.chimiste) { renderNightAction(document.getElementById("gamePhasePanel")); return; }
  if (nightActionsData.chimiste.done) { panel.innerHTML = "<p>Potions preparees. En attente...</p>"; return; }
  // Deux victimes possibles la meme nuit (Assassins + Tueur en Serie, s'il
  // agit) : la potion de Vie ne peut en sauver qu'une seule, donc on propose
  // les deux comme choix quand elles existent (et different l'une de l'autre).
  const assassinTarget = players.find((p) => p.id === nightActionsData.assassins?.chosenTargetId);
  const tueurTarget = players.find((p) => p.id === nightActionsData.tueur?.targetId);
  const lifeCandidates = [assassinTarget, tueurTarget].filter(Boolean).filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i);
  const canLife = me.potions?.life && lifeCandidates.length > 0;
  const canDeath = me.potions?.death;
  const others = players.filter((p) => p.isAlive && p.id !== PLAYER_ID);

  panel.innerHTML = `
    <h2>🧪 Le Chimiste</h2>
    <div class="potion-card potion-life ${!canLife ? "potion-disabled" : ""}">
      <h3>🧪 Potion de Vie</h3>
      ${canLife
        ? `<p>${lifeCandidates.length > 1 ? "Victimes cette nuit, choisissez qui sauver :" : "Victime cette nuit :"}</p>
           <div class="choice-grid">${lifeCandidates.map((p) => `<button type="button" class="choice-btn life-target-btn ${chimisteLifeTargetId === p.id ? "selected" : ""}" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join("")}</div>`
        : `<p class="hint">Indisponible (deja utilisee, ou aucune victime cette nuit).</p>`}
    </div>
    <div class="potion-card potion-death ${!canDeath ? "potion-disabled" : ""}">
      <h3>☠️ Potion de Mort</h3>
      ${canDeath
        ? `<p>Choisissez une victime, ou laissez sans cible :</p>
           <div class="choice-grid">${others.map((p) => `<button type="button" class="choice-btn death-target-btn ${chimisteDeathTargetId === p.id ? "selected" : ""}" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join("")}</div>`
        : `<p class="hint">Indisponible (deja utilisee).</p>`}
    </div>
    <button id="chimisteValidate" class="primary big">Valider</button>
  `;

  if (canLife) {
    panel.querySelectorAll(".life-target-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        chimisteLifeTargetId = chimisteLifeTargetId === btn.dataset.id ? null : btn.dataset.id;
        renderChimisteAction(panel);
      });
    });
  }
  if (canDeath) {
    panel.querySelectorAll(".death-target-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        chimisteDeathTargetId = chimisteDeathTargetId === btn.dataset.id ? null : btn.dataset.id;
        renderChimisteAction(panel);
      });
    });
  }
  guardedClick(document.getElementById("chimisteValidate"), async () => {
    const lifeTargetId = canLife && chimisteLifeTargetId ? chimisteLifeTargetId : null;
    const deathTargetId = canDeath && chimisteDeathTargetId ? chimisteDeathTargetId : null;
    chimisteLifeTargetId = null;
    chimisteDeathTargetId = null;
    await submitChimiste(CODE, lobbyData.nightNumber, { lifeTargetId, deathTargetId }, PLAYER_ID);
  });
}

// --- Annonce du jour ---

// Garde anti-clignotement (voir renderRoster) : cet ecran peut etre
// redessine par un evenement Firestore sans rapport pendant qu'on reste
// statique en attente de l'hote.
function renderAnnouncement(panel) {
  let html;
  if (!lobbyData.resultsRevealed) {
    html = `<p class="waiting">L'hote va annoncer les resultats de la nuit...</p>`;
  } else {
    const result = lobbyData.lastNightResult || { deaths: [], savedPlayer: null };
    const entries = buildAnnouncementEntries(result);
    html = `
      <div class="announcement-card">
        <div class="announcement-title">Resultats de la Nuit ${lobbyData.nightNumber}</div>
        <div class="announcement-entries">${renderAnnouncementEntriesHtml(entries)}</div>
      </div>
      <p class="waiting">En attente que l'hote continue...</p>
    `;
  }
  if (panel.innerHTML !== html) panel.innerHTML = html;
}

// Construit une liste d'evenements {icone, classe, texte} pour un affichage
// plus percutant qu'une simple liste (duplique cote host.js pour un rendu identique).
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

// --- Election du Gouverneur ---

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function renderElection(panel) {
  if (!electionUnsub) {
    const myGen = phaseListenerGen;
    electionUnsub = onSnapshot(doc(db, "lobbies", CODE, "election", "current"), (snap) => {
      if (myGen !== phaseListenerGen) return; // listener perime, deja "unsubscribe" logiquement
      electionData = snap.exists() ? snap.data() : null;
      if (lobbyData.status === "election") renderElection(document.getElementById("gamePhasePanel"));
    });
  }
  const actionModal = document.getElementById("actionModal");

  if (!electionData) {
    actionModal.classList.add("hidden");
    panel.innerHTML = "<p class='waiting'>En attente que l'hote lance l'election du Gouverneur...</p>";
    return;
  }

  if (electionData.phase === "candidacy") {
    panel.innerHTML = `<p class="waiting">Election du Gouverneur : les joueurs se presentent...</p>`;
    const candidates = players.filter((p) => p.isGovernorCandidate);
    document.getElementById("actionModalBody").innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">🗳️</div>
        <h2>Election du Gouverneur</h2>
        ${me.isAlive ? `<button id="candidacyBtn" class="primary big ${me.isGovernorCandidate ? "active" : ""}">${me.isGovernorCandidate ? "Retirer ma candidature" : "Me presenter"}</button>` : "<p class='hint'>Vous etes mort : vous ne pouvez pas vous presenter.</p>"}
        <div class="candidate-cards">
          ${candidates.map((c) => `<div class="candidate-card"><span class="candidate-avatar">${initials(c.name)}</span><span class="candidate-name">${escapeHtml(c.name)}</span></div>`).join("") || '<p class="hint"><em>Aucun candidat pour l\'instant...</em></p>'}
        </div>
      </div>
    `;
    actionModal.classList.remove("hidden");
    if (me.isAlive) {
      guardedClick(document.getElementById("candidacyBtn"), () => withdrawOrCandidate(CODE, PLAYER_ID, !me.isGovernorCandidate));
    }
  } else if (electionData.phase === "voting") {
    if (!me.isAlive) { actionModal.classList.add("hidden"); panel.innerHTML = "<p class='waiting'>Vous etes mort : vous ne pouvez pas voter.</p>"; return; }
    const myVote = electionData.votes?.[PLAYER_ID];
    if (myVote) {
      actionModal.classList.add("hidden");
      panel.innerHTML = `<p class="waiting">Vote enregistre. En attente des autres joueurs...</p>`;
      return;
    }
    const candidates = electionData.candidates.map((id) => players.find((p) => p.id === id)).filter(Boolean);
    panel.innerHTML = `<p class="waiting">Vote pour le Gouverneur en cours...</p>`;
    document.getElementById("actionModalBody").innerHTML = `
      <div class="vote-stage">
        <div class="vote-stage-icon">🗳️</div>
        <h2>Vote pour le Gouverneur</h2>
        <div class="choice-grid">${candidates.map((c) => `<button class="choice-btn" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join("")}</div>
      </div>
    `;
    actionModal.classList.remove("hidden");
    const electionChoices = document.getElementById("actionModalBody");
    electionChoices.querySelectorAll(".choice-btn").forEach((btn) => {
      guardedClick(btn, () => updateDoc(doc(db, "lobbies", CODE, "election", "current"), { [`votes.${PLAYER_ID}`]: btn.dataset.id }), electionChoices);
    });
  }
}
let electionUnsub = null;
let electionData = null;

// --- Vote du village ---

let tieBreakModalShown = false;

function renderDayVote(panel) {
  if (!dayVoteUnsub) {
    const myGen = phaseListenerGen;
    dayVoteUnsub = onSnapshot(doc(db, "lobbies", CODE, "dayVotes", `day_${lobbyData.dayNumber}`), (snap) => {
      if (myGen !== phaseListenerGen) return;
      dayVoteData = snap.exists() ? snap.data() : null;
      if (lobbyData.status === "day_vote") renderDayVote(document.getElementById("gamePhasePanel"));
    });
  }

  const actionModal = document.getElementById("actionModal");

  if (!dayVoteData) {
    actionModal.classList.add("hidden");
    panel.innerHTML = `<p class="waiting">En attente que l'hote lance le vote du village...</p>`;
    document.getElementById("tieBreakModal").classList.add("hidden");
    tieBreakModalShown = false;
    return;
  }

  if (!me.isAlive) { actionModal.classList.add("hidden"); panel.innerHTML = "<p class='waiting'>Vous etes mort : vous ne pouvez pas voter.</p>"; return; }

  // Egalite a departager : affichee en modale bien visible sur l'ecran du
  // Gouverneur, comme les actions de role.
  if (dayVoteData.tieBreakPending && lobbyData.governorId === PLAYER_ID && !dayVoteData.governorPick) {
    actionModal.classList.add("hidden");
    panel.innerHTML = `<p class="waiting">Egalite : departagez depuis la fenetre qui s'est ouverte.</p>`;
    if (!tieBreakModalShown) {
      tieBreakModalShown = true;
      const tied = dayVoteData.tieCandidates.map((id) => players.find((p) => p.id === id)).filter(Boolean);
      document.getElementById("tieBreakChoices").innerHTML = tied
        .map((c) => `<button class="choice-btn" data-id="${c.id}">${escapeHtml(c.name)}</button>`)
        .join("");
      const tieBreakChoices = document.getElementById("tieBreakChoices");
      tieBreakChoices.querySelectorAll(".choice-btn").forEach((btn) => {
        guardedClick(btn, async () => {
          document.getElementById("tieBreakModal").classList.add("hidden");
          await updateDoc(doc(db, "lobbies", CODE, "dayVotes", `day_${lobbyData.dayNumber}`), { governorPick: btn.dataset.id });
        }, tieBreakChoices);
      });
      document.getElementById("tieBreakModal").classList.remove("hidden");
    }
    return;
  }
  document.getElementById("tieBreakModal").classList.add("hidden");
  tieBreakModalShown = false;

  if (dayVoteData.tieBreakPending) { actionModal.classList.add("hidden"); panel.innerHTML = "<p class='waiting'>Egalite : le Gouverneur departage...</p>"; return; }

  const myVote = dayVoteData.votes?.[PLAYER_ID];
  if (myVote) {
    actionModal.classList.add("hidden");
    panel.innerHTML = `<p class="waiting">Vote enregistre. En attente des autres joueurs...</p>`;
    return;
  }
  const targets = players.filter((p) => p.isAlive);
  panel.innerHTML = `<p class="waiting">Vote du village en cours...</p>`;
  document.getElementById("actionModalBody").innerHTML = `
    <div class="vote-stage">
      <div class="vote-stage-icon">⚖️</div>
      <h2>Vote du village</h2>
      <p class="hint">Qui souhaitez-vous eliminer ?</p>
      <div class="choice-grid">${targets.map((p) => `<button class="choice-btn" data-id="${p.id}">${escapeHtml(p.name)}</button>`).join("")}</div>
    </div>
  `;
  actionModal.classList.remove("hidden");
  const dayVoteChoices = document.getElementById("actionModalBody");
  dayVoteChoices.querySelectorAll(".choice-btn").forEach((btn) => {
    guardedClick(btn, () => updateDoc(doc(db, "lobbies", CODE, "dayVotes", `day_${lobbyData.dayNumber}`), { [`votes.${PLAYER_ID}`]: btn.dataset.id }), dayVoteChoices);
  });
}
let dayVoteUnsub = null;
let dayVoteData = null;

// --- Riposte du Sherif (modale bloquante, 1 seconde) ---

let sheriffModalShown = false;
function renderSheriffModal(panel) {
  const rev = lobbyData.sheriffRevenge;
  panel.innerHTML = `<p class="waiting">Le village retient son souffle...</p>`;
  if (!rev || rev.sheriffId !== PLAYER_ID) { sheriffModalShown = false; return; }
  if (sheriffModalShown) return;
  sheriffModalShown = true;

  const modal = document.getElementById("sheriffModal");
  modal.classList.remove("hidden");
  const targets = players.filter((p) => p.isAlive && p.id !== PLAYER_ID);
  const countdownEl = document.getElementById("sheriffCountdown");
  document.getElementById("sheriffTargets").innerHTML = targets
    .map((p) => `<button class="choice-btn" data-id="${p.id}">${escapeHtml(p.name)}</button>`)
    .join("");

  let fired = false;
  const fire = async (targetId) => {
    if (fired) return;
    fired = true;
    modal.classList.add("hidden");
    await updateDoc(doc(db, "lobbies", CODE), { "sheriffRevenge.playerChoice": targetId });
  };

  document.getElementById("sheriffTargets").querySelectorAll(".choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => fire(btn.dataset.id));
  });

  const deadline = rev.deadlineAt;
  const tick = () => {
    const remaining = Math.max(0, deadline - Date.now());
    countdownEl.textContent = (remaining / 1000).toFixed(2) + "s";
    if (remaining > 0 && !fired) requestAnimationFrame(tick);
  };
  tick();
}

// --- Fin de partie ---

const CAMP_META = {
  citoyens: { icon: "🕊️", label: "Camp des Citoyens", color: "gold" },
  assassins: { icon: "🗡️", label: "Camp des Assassins", color: "blood" },
  martyr: { icon: "⚰️", label: "Le Martyr", color: "purple" },
  psychopathe: { icon: "🔪", label: "Le Psychopathe", color: "blood" },
  amoureux: { icon: "💞", label: "Les Ames Soeurs", color: "purple" },
};

/**
 * Envoie la partie terminee au compte KUMP (une seule fois).
 *
 * Chargement PARESSEUX du module : un joueur qui ne se sert jamais du compte
 * ne telecharge le SDK Firebase du projet KUMP qu'a la toute fin de sa
 * premiere partie, et jamais pendant qu'il joue.
 *
 * ⚠️ CES STATISTIQUES SONT DECLAREES. Le serveur de kump.fr ne peut pas les
 * verifier : le resultat d'une nuit est calcule par le navigateur de l'Hote,
 * dans un projet Firebase auquel il n'a aucun acces. C'est la limite deja
 * documentee dans TODO_SECURITE.md, elle n'a pas change. Jamais de recompense
 * reelle adossee a ces chiffres.
 *
 * Ne bloque rien et n'affiche aucune erreur : l'ecran de victoire est le
 * moment le moins approprie pour signaler un probleme de reseau. Une partie
 * qui ne part pas est mise en file d'attente et repartira a la suivante.
 */
async function envoyerPartieAuCompteKump() {
  if (kumpPartieEnvoyee || !me || !me.role || !me.camp) return;
  kumpPartieEnvoyee = true;
  try {
    const kump = await import("./kump.js");
    await kump.recordGame({
      role: me.role,
      camp: me.camp,
      won: Boolean(lobbyData.winningPlayerIds && lobbyData.winningPlayerIds.includes(PLAYER_ID)),
      survived: me.isAlive === true,
      players: publicPlayers.length,
      // `nightNumber` vaut 0 tant qu'aucune nuit n'est passee ; le serveur
      // exige au moins 1 (une partie sans nuit n'existe pas).
      nights: Math.max(1, lobbyData.nightNumber || 1),
      durationMs: kumpDebutPartie ? Date.now() - kumpDebutPartie : 0,
    });
  } catch (error) {
    console.warn("[kump] partie non enregistree", error);
  }
}

// Garde anti-clignotement (voir renderRoster) : evite de reecrire cet ecran
// (donc de redemarrer ses animations d'entree) si rien n'a change.
function renderEnd() {
  const el = document.getElementById("endScreen");
  const iWon = lobbyData.winningPlayerIds?.includes(PLAYER_ID);
  // Source des roles : le reveal final grave par l'Hote dans
  // `lobbyData.finalReveal` (voir endGame() cote host.js), puisque ce client
  // ne peut plus lire le role prive des autres joueurs directement.
  const revealById = Object.fromEntries((lobbyData.finalReveal || []).map((r) => [r.id, r]));
  const winners = (lobbyData.winningPlayerIds || []).map((id) => revealById[id]).filter(Boolean);
  const meta = CAMP_META[lobbyData.winningCamp] || { icon: "🏆", label: lobbyData.winningCamp || "?", color: "gold" };

  const html = `
    <div class="victory-banner victory-${meta.color}">
      <div class="victory-icon">${meta.icon}</div>
      <div class="victory-title">${iWon ? "Victoire !" : "Defaite"}</div>
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
  `;
  if (el.innerHTML !== html) el.innerHTML = html;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

init();
