// Machine a etats de la nuit : determine quel role agit, saute automatiquement
// les roles absents ou sans pouvoir restant, et calcule le resultat de la nuit.
import { db, doc, getDoc, setDoc, updateDoc, runTransaction } from "./firebase-config.js";

// Ordre de passage nocturne impose par le cahier des charges.
export const NIGHT_ORDER = ["destin", "detective", "assassins", "tueur", "corrupteur", "chimiste"];

export const NIGHT_STEP_LABELS = {
  destin: "Le Destin choisit les Ames Soeurs",
  detective: "Le Detective enquete",
  assassins: "Les Assassins choisissent leur victime",
  tueur: "Le Tueur en Serie agit",
  corrupteur: "Le Corrupteur agit",
  chimiste: "Le Chimiste prepare ses potions",
};

// Noms courts (avec article) utilises pour composer les boutons de l'Hote
// ("Lancer ...", "Passer ...") - distincts de NIGHT_STEP_LABELS (phrases
// completes, utilisees comme texte informatif) pour eviter des messages
// grammaticalement incorrects du type "Passer a Le Chimiste prepare ses
// potions".
export const NIGHT_STEP_UI = {
  destin: { launch: "le Destin", pass: "au Destin", done: "Le Destin a termine son tour." },
  detective: { launch: "le Detective", pass: "au Detective", done: "Le Detective a termine son tour." },
  assassins: { launch: "les Assassins", pass: "aux Assassins", done: "Les Assassins ont termine leur tour." },
  tueur: { launch: "le Tueur en Serie", pass: "au Tueur en Serie", done: "Le Tueur en Serie a termine son tour." },
  corrupteur: { launch: "le Corrupteur", pass: "au Corrupteur", done: "Le Corrupteur a termine son tour." },
  chimiste: { launch: "le Chimiste", pass: "au Chimiste", done: "Le Chimiste a termine son tour." },
};

function livingWithRole(players, roleId) {
  return players.filter((p) => p.isAlive && p.role === roleId);
}

function livingWithCamp(players, camp) {
  return players.filter((p) => p.isAlive && p.camp === camp);
}

// Determine si une etape donnee necessite reellement une action cette nuit.
export function stepIsNeeded(stepId, players, lobby) {
  switch (stepId) {
    case "destin":
      return lobby.nightNumber === 1 && livingWithRole(players, "destin").length > 0;
    case "detective":
      return livingWithRole(players, "detective").length > 0;
    case "assassins":
      // Vote commun a tout le camp Assassins (Assassin, Tueur en Serie,
      // Corrupteur), pas seulement au role "assassin" a proprement parler.
      return livingWithCamp(players, "assassins").length > 0;
    case "tueur":
      return livingWithRole(players, "tueur_en_serie").length > 0 && !lobby.tueurPowerLost;
    case "corrupteur":
      return livingWithRole(players, "corrupteur").some((p) => !p.hasUsedCorruption);
    case "chimiste":
      return livingWithRole(players, "chimiste").some((p) => p.potions?.life || p.potions?.death);
    default:
      return false;
  }
}

// Renvoie le premier step necessaire a partir (et y compris) de `fromIndex`,
// ou "done" si plus aucun step n'est requis.
export function computeFirstNeededStep(players, lobby) {
  for (const stepId of NIGHT_ORDER) {
    if (stepIsNeeded(stepId, players, lobby)) return stepId;
  }
  return "done";
}

export function computeNextStep(currentStepId, players, lobby) {
  const idx = NIGHT_ORDER.indexOf(currentStepId);
  for (let i = idx + 1; i < NIGHT_ORDER.length; i++) {
    if (stepIsNeeded(NIGHT_ORDER[i], players, lobby)) return NIGHT_ORDER[i];
  }
  return "done";
}

function emptyNightActions() {
  return {
    destin: { done: false, targets: [] },
    detective: { done: false, targetId: null, peekedTargetId: null },
    assassins: { done: false, votes: {}, chosenTargetId: null, insistTargetId: null, insistNonce: 0 },
    tueur: { done: false, skipped: false, targetId: null },
    corrupteur: { done: false, skipped: false, infect: false },
    chimiste: { done: false, skipped: false, lifeUsed: false, deathUsed: false, lifeTargetId: null, deathTargetId: null },
  };
}

// La nuit commence en deux etapes, la seconde seule declenchee par un clic
// explicite de l'Hote (le premier role ne demarre jamais tout seul) :
//   1. beginNight        : cree le doc nightActions/night_N, determine le
//                          premier role necessaire et l'affiche via un
//                          bouton "Lancer <role>", sans encore le lancer.
//   2. launchPendingRole : le role determine a l'etape 1 commence reellement
//                          (bouton "Lancer <role>" clique par l'Hote).

// Etape 1 : quitte l'election/le vote du jour et prepare la nuit a venir.
export async function beginNight(code, nightNumber, players, lobbyData) {
  const nightRef = doc(db, "lobbies", code, "nightActions", `night_${nightNumber}`);
  await setDoc(nightRef, emptyNightActions());
  const firstStep = computeFirstNeededStep(players, { ...lobbyData, nightNumber });
  await updateDoc(doc(db, "lobbies", code), {
    status: "night",
    nightNumber,
    currentNightStep: "ready",
    pendingNightStep: firstStep,
    lastNightResult: null,
  });
  return firstStep;
}

// Etape 2 : le role determine a l'etape 1 commence reellement.
export async function launchPendingNightRole(code) {
  const lobbyRef = doc(db, "lobbies", code);
  const snap = await getDoc(lobbyRef);
  const pending = snap.data().pendingNightStep;
  await updateDoc(lobbyRef, { currentNightStep: pending, pendingNightStep: null });
  return pending;
}

export function nightActionsRef(code, nightNumber) {
  return doc(db, "lobbies", code, "nightActions", `night_${nightNumber}`);
}

// --- Destin ---
// Le Destin ne peut pas ecrire `loverId` directement sur les documents prives
// des deux joueurs choisis (seul l'Hote peut ecrire dans playersPrivate, cf.
// firestore.rules) : il pose seulement sa paire ici, et l'Hote applique
// l'appariement des Ames Soeurs juste apres (voir host.js:resolveDestinPairing).
export async function submitDestin(code, nightNumber, targetIds) {
  await runTransaction(db, async (tx) => {
    const nRef = nightActionsRef(code, nightNumber);
    tx.update(nRef, { destin: { done: true, targets: targetIds } });
  });
}

// --- Detective ---
// Le Detective ne peut sonder qu'un seul joueur par nuit : le premier clic
// "verrouille" la cible (persiste en base, pas seulement localement, pour
// resister a un rechargement de page), le clic sur "Terminer" valide le tour.
// Le Detective ne peut plus lire le role de sa cible directement (les roles
// sont prives, cf. firestore.rules) : il pose seulement sa cible ici. Le
// role decouvert n'est PAS stocke dans ce document (lisible par tous les
// joueurs, pour que le reste de la nuit fonctionne) mais dans le document
// prive du Detective lui-meme (`playersPrivate/{detectiveId}.detectiveReveal`,
// voir host.js:resolveDetectivePeek), pour ne pas fuiter sa decouverte aux
// autres joueurs.
export async function peekDetectiveTarget(code, nightNumber, targetId) {
  await updateDoc(nightActionsRef(code, nightNumber), {
    "detective.peekedTargetId": targetId,
  });
}

export async function submitDetective(code, nightNumber, targetId) {
  await updateDoc(nightActionsRef(code, nightNumber), {
    detective: { done: true, targetId, peekedTargetId: targetId },
  });
}

// --- Assassins (vote unanime + mecanique d'insistance) ---
export async function submitAssassinVote(code, nightNumber, assassinId, targetId, livingAssassinIds) {
  // Important : on ne relit JAMAIS le document via getDoc() apres la transaction
  // pour decider de la suite. Ce client a generalement deja un onSnapshot actif
  // sur ce meme document (ouvert par l'ecran de jeu) : un getDoc() juste apres le
  // commit peut alors renvoyer la version du cache local, pas encore rafraichie
  // par le flux temps reel, ce qui ferait croire a tort que le vote n'est pas
  // unanime et bloquerait la nuit indefiniment. La transaction renvoie donc
  // elle-meme le resultat, qui est fiable puisque calcule au moment du commit.
  const unanimous = await runTransaction(db, async (tx) => {
    const nRef = nightActionsRef(code, nightNumber);
    const snap = await tx.get(nRef);
    const data = snap.data();
    const votes = { ...(data.assassins.votes || {}), [assassinId]: targetId };
    const allVoted = livingAssassinIds.every((id) => votes[id]);
    const isUnanimous = allVoted && new Set(livingAssassinIds.map((id) => votes[id])).size === 1;
    tx.update(nRef, {
      assassins: {
        ...data.assassins,
        votes,
        done: isUnanimous,
        chosenTargetId: isUnanimous ? targetId : null,
      },
    });
    return isUnanimous;
  });
  return unanimous;
}

// Un assassin "insiste" sur une cible : incremente un compteur observe par les
// autres assassins pour declencher l'animation de tremblement (shake) chez eux.
export async function triggerAssassinInsist(code, nightNumber, targetId) {
  const nRef = nightActionsRef(code, nightNumber);
  const snap = await getDoc(nRef);
  const current = snap.data().assassins;
  await updateDoc(nRef, {
    assassins: { ...current, insistTargetId: targetId, insistNonce: (current.insistNonce || 0) + 1 },
  });
}

// --- Tueur en serie ---
export async function submitTueur(code, nightNumber, targetId) {
  await updateDoc(nightActionsRef(code, nightNumber), {
    tueur: { done: true, skipped: !targetId, targetId: targetId || null },
  });
}

// --- Corrupteur ---
export async function submitCorrupteur(code, nightNumber, infect, corrupteurId) {
  await updateDoc(nightActionsRef(code, nightNumber), {
    corrupteur: { done: true, skipped: !infect, infect: !!infect },
  });
  if (infect) {
    await updateDoc(doc(db, "lobbies", code, "players", corrupteurId), { hasUsedCorruption: true });
  }
}

// --- Chimiste ---
export async function submitChimiste(code, nightNumber, { lifeTargetId, deathTargetId }, chimisteId) {
  await updateDoc(nightActionsRef(code, nightNumber), {
    chimiste: {
      done: true,
      skipped: !lifeTargetId && !deathTargetId,
      lifeUsed: !!lifeTargetId,
      deathUsed: !!deathTargetId,
      lifeTargetId: lifeTargetId || null,
      deathTargetId: deathTargetId || null,
    },
  });
  const updates = {};
  if (lifeTargetId) updates["potions.life"] = false;
  if (deathTargetId) updates["potions.death"] = false;
  if (Object.keys(updates).length > 0) {
    await updateDoc(doc(db, "lobbies", code, "players", chimisteId), updates);
  }
}

// Calcule le resultat complet de la nuit a partir des actions enregistrees.
// Ne modifie AUCUN document : c'est une fonction pure appelee au moment de
// "Passer au jour", le resultat est stocke tel quel puis applique seulement
// au clic sur "Annoncer les resultats".
export function computeNightResult(nightActionsData, players) {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const deaths = new Map(); // playerId -> cause
  let savedPlayerId = null;
  let corruptedPlayerId = null;

  const assassinTarget = nightActionsData.assassins?.chosenTargetId || null;
  const corrupted = nightActionsData.corrupteur?.infect && assassinTarget;

  if (assassinTarget && corrupted) {
    corruptedPlayerId = assassinTarget;
  } else if (assassinTarget) {
    const savedByChimiste = nightActionsData.chimiste?.lifeUsed && nightActionsData.chimiste?.lifeTargetId === assassinTarget;
    if (savedByChimiste) {
      savedPlayerId = assassinTarget;
    } else {
      deaths.set(assassinTarget, "assassinated");
    }
  }

  const tueurTarget = nightActionsData.tueur?.targetId || null;
  if (tueurTarget && !deaths.has(tueurTarget)) {
    // La potion de Vie peut sauver la cible du Tueur en Serie tout comme
    // celle des Assassins (une seule des deux, selon ce que le Chimiste a
    // choisi) - avant, seule la cible des Assassins etait verifiee ici.
    const savedByChimiste = nightActionsData.chimiste?.lifeUsed && nightActionsData.chimiste?.lifeTargetId === tueurTarget;
    if (savedByChimiste) {
      savedPlayerId = tueurTarget;
    } else {
      deaths.set(tueurTarget, "assassinated");
    }
  }

  const poisonTarget = nightActionsData.chimiste?.deathUsed ? nightActionsData.chimiste.deathTargetId : null;
  if (poisonTarget && !deaths.has(poisonTarget)) {
    deaths.set(poisonTarget, "poisoned");
  }

  // Mort en chaine des Ames Soeurs : si l'une meurt cette nuit, l'autre meurt
  // aussitot de chagrin, et c'est annonce dans le meme ecran de resultat
  // (pas silencieusement plus tard). Boucle sur une copie des cles pour
  // pouvoir etendre `deaths` pendant l'iteration en toute securite.
  Array.from(deaths.keys()).forEach((deadId) => {
    const lover = byId[deadId]?.loverId ? byId[byId[deadId].loverId] : null;
    if (lover && lover.isAlive && !deaths.has(lover.id)) {
      deaths.set(lover.id, "heartbreak");
    }
  });

  return {
    deaths: Array.from(deaths.entries()).map(([playerId, cause]) => ({
      playerId,
      name: byId[playerId]?.name || "?",
      role: byId[playerId]?.role || null,
      cause,
    })),
    savedPlayer: savedPlayerId ? { playerId: savedPlayerId, name: byId[savedPlayerId]?.name || "?" } : null,
    corruptedPlayer: corruptedPlayerId ? { playerId: corruptedPlayerId, name: byId[corruptedPlayerId]?.name || "?" } : null,
    detective: nightActionsData.detective?.done
      ? { targetId: nightActionsData.detective.targetId }
      : null,
  };
}
