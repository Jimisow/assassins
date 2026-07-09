// Definitions des roles, camps et conditions de victoire.
// Module partage par host.js, player.js et night-cycle.js.

export const CAMPS = {
  CITOYENS: "citoyens",
  ASSASSINS: "assassins",
  MARTYR: "martyr",
  PSYCHOPATHE: "psychopathe",
};

// Cle = identifiant de role utilise dans rolesConfig / players.role
export const ROLES = {
  citoyen: {
    id: "citoyen",
    label: "Citoyen",
    icon: "🧑",
    camp: CAMPS.CITOYENS,
    description: "Un habitant ordinaire du village. Aucun pouvoir particulier.",
    victoryText: "Vous gagnez quand tous les Assassins, le Tueur en Serie et le Corrupteur sont morts.",
    hasNightAction: false,
  },
  detective: {
    id: "detective",
    label: "Detective",
    icon: "🔍",
    camp: CAMPS.CITOYENS,
    description: "Chaque nuit, vous pouvez sonder un joueur pour decouvrir son role reel.",
    victoryText: "Vous gagnez quand tous les Assassins, le Tueur en Serie et le Corrupteur sont morts.",
    hasNightAction: true,
  },
  chimiste: {
    id: "chimiste",
    label: "Chimiste",
    icon: "🧪",
    camp: CAMPS.CITOYENS,
    description: "Vous possedez une potion de Vie (sauver la cible des Assassins) et une potion de Mort (tuer un joueur), chacune utilisable une seule fois dans la partie.",
    victoryText: "Vous gagnez quand tous les Assassins, le Tueur en Serie et le Corrupteur sont morts.",
    hasNightAction: true,
  },
  sheriff: {
    id: "sheriff",
    label: "Sherif",
    icon: "⭐",
    camp: CAMPS.CITOYENS,
    description: "Si vous mourez (de nuit ou de jour), vous pouvez immediatement abattre un dernier joueur avant de succomber.",
    victoryText: "Vous gagnez quand tous les Assassins, le Tueur en Serie et le Corrupteur sont morts.",
    hasNightAction: false,
  },
  destin: {
    id: "destin",
    label: "Le Destin",
    icon: "💘",
    camp: CAMPS.CITOYENS,
    description: "La premiere nuit uniquement, vous designez deux joueurs qui deviennent Ames Soeurs.",
    victoryText: "Vous gagnez quand tous les Assassins, le Tueur en Serie et le Corrupteur sont morts.",
    hasNightAction: true,
  },
  assassin: {
    id: "assassin",
    label: "Assassin",
    icon: "🗡️",
    camp: CAMPS.ASSASSINS,
    description: "Chaque nuit, avec les autres Assassins, vous choisissez une victime a l'unanimite. Vous ne pouvez pas discuter entre vous a voix haute : utilisez le tremblement pour insister.",
    victoryText: "Vous gagnez quand le nombre d'Assassins vivants egale le nombre de Citoyens vivants.",
    hasNightAction: true,
  },
  tueur_en_serie: {
    id: "tueur_en_serie",
    label: "Tueur en Serie",
    icon: "🔪",
    camp: CAMPS.ASSASSINS,
    description: "Tant qu'aucun Assassin n'est mort, vous pouvez tuer une victime bonus chaque nuit.",
    victoryText: "Vous gagnez quand le nombre d'Assassins vivants egale le nombre de Citoyens vivants.",
    hasNightAction: true,
  },
  corrupteur: {
    id: "corrupteur",
    label: "Corrupteur",
    icon: "😈",
    camp: CAMPS.ASSASSINS,
    description: "Une seule fois dans la partie, vous pouvez corrompre la victime des Assassins pour la faire rejoindre leur camp au lieu de la tuer.",
    victoryText: "Vous gagnez quand le nombre d'Assassins vivants egale le nombre de Citoyens vivants.",
    hasNightAction: true,
  },
  martyr: {
    id: "martyr",
    label: "Le Martyr",
    icon: "⚰️",
    camp: CAMPS.MARTYR,
    description: "Si le village vous elimine lors du tout premier vote du jour, vous gagnez seul instantanement. Sinon, vous perdez ce pouvoir et devenez un simple Citoyen.",
    victoryText: "Vous gagnez seul si vous etes elimine par le tout premier vote du village.",
    hasNightAction: false,
  },
  psychopathe: {
    id: "psychopathe",
    label: "Le Psychopathe",
    icon: "🪓",
    camp: CAMPS.PSYCHOPATHE,
    description: "Si le village vous elimine par un vote, a n'importe quel moment de la partie, vous gagnez seul instantanement.",
    victoryText: "Vous gagnez seul si vous etes elimine par un vote du village, a tout moment.",
    hasNightAction: false,
  },
};

export const ASSIGNABLE_ROLE_IDS = Object.keys(ROLES);

// Roles dont on peut choisir la quantite a la creation du lobby (le citoyen comble le reste).
export const CONFIGURABLE_ROLES = [
  "assassin",
  "detective",
  "chimiste",
  "sheriff",
  "destin",
  "tueur_en_serie",
  "corrupteur",
  "martyr",
  "psychopathe",
];

export function getRoleInfo(roleId) {
  return ROLES[roleId] || ROLES.citoyen;
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Construit la liste des roles a distribuer a partir de la config choisie par l'hote,
// complete avec des Citoyens jusqu'a atteindre le nombre de joueurs.
export function buildRoleDeck(rolesConfig, playerCount) {
  const deck = [];
  for (const roleId of CONFIGURABLE_ROLES) {
    const qty = Number(rolesConfig[roleId] || 0);
    for (let i = 0; i < qty; i++) deck.push(roleId);
  }
  while (deck.length < playerCount) deck.push("citoyen");
  return shuffle(deck).slice(0, playerCount);
}

// Retourne une Map playerId -> { role, camp }
export function assignRoles(rolesConfig, playerIds) {
  const deck = buildRoleDeck(rolesConfig, playerIds.length);
  const shuffledPlayers = shuffle(playerIds);
  const assignment = {};
  shuffledPlayers.forEach((playerId, idx) => {
    const roleId = deck[idx];
    assignment[playerId] = { role: roleId, camp: getRoleInfo(roleId).camp };
  });
  return assignment;
}

function livingCount(players, predicate) {
  return players.filter((p) => p.isAlive && predicate(p)).length;
}

// Verifie les conditions de victoire "generales" (camps + amoureux), appelee apres
// chaque mort ou changement d'etat. Retourne null si la partie continue, ou
// { winningCamp, winningPlayerIds, reason } si la partie est terminee.
export function checkVictoryConditions(players) {
  const alive = players.filter((p) => p.isAlive);

  // 1. Les Ames Soeurs gagnent si elles finissent seules survivantes toutes les deux.
  if (alive.length === 2) {
    const [a, b] = alive;
    if (a.loverId === b.id && b.loverId === a.id) {
      return {
        winningCamp: "amoureux",
        winningPlayerIds: [a.id, b.id],
        reason: "Les Ames Soeurs terminent la partie ensemble, parmi les deux derniers survivants.",
      };
    }
  }

  const livingAssassinsCamp = livingCount(players, (p) => p.camp === CAMPS.ASSASSINS);
  const livingCitizensCamp = livingCount(players, (p) => p.camp === CAMPS.CITOYENS);

  if (livingAssassinsCamp === 0 && players.some((p) => p.camp === CAMPS.ASSASSINS)) {
    return {
      winningCamp: CAMPS.CITOYENS,
      winningPlayerIds: players.filter((p) => p.camp === CAMPS.CITOYENS).map((p) => p.id),
      reason: "Tous les Assassins, le Tueur en Serie et le Corrupteur sont morts.",
    };
  }

  if (livingAssassinsCamp > 0 && livingAssassinsCamp >= livingCitizensCamp) {
    return {
      winningCamp: CAMPS.ASSASSINS,
      winningPlayerIds: players.filter((p) => p.camp === CAMPS.ASSASSINS).map((p) => p.id),
      reason: "Le nombre d'Assassins vivants egale ou depasse le nombre de Citoyens vivants.",
    };
  }

  return null;
}

// Verifie les conditions speciales (Martyr / Psychopathe), a appeler juste apres
// la resolution d'un vote du village, AVANT checkVictoryConditions.
// eliminatedPlayer: le joueur qui vient d'etre elimine par le vote (ou null si egalite non tranchee).
// isFirstDayVote: vrai s'il s'agit du tout premier vote d'elimination de la partie.
export function checkDayVoteSpecialConditions(eliminatedPlayer, isFirstDayVote) {
  if (!eliminatedPlayer) return null;

  if (eliminatedPlayer.role === "martyr" && isFirstDayVote) {
    return {
      winningCamp: CAMPS.MARTYR,
      winningPlayerIds: [eliminatedPlayer.id],
      reason: "Le Martyr a ete elimine des le tout premier vote du village.",
    };
  }

  if (eliminatedPlayer.role === "psychopathe") {
    return {
      winningCamp: CAMPS.PSYCHOPATHE,
      winningPlayerIds: [eliminatedPlayer.id],
      reason: "Le Psychopathe a ete elimine par un vote du village.",
    };
  }

  return null;
}
