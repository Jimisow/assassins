// Ecran "Compte KUMP" d'Assassins — connexion, creation de compte et profil.
//
// Le compte KUMP est partage par tous les jeux du studio : une seule identite,
// un temps de jeu cumule, des statistiques par jeu et des trophees, visibles
// aussi sur kump.fr/profil.
//
// TROIS PRINCIPES, a ne pas defaire :
//
// 1. **Jouer ne demande jamais de compte.** Cet ecran est une porte ouverte,
//    pas un peage. Assassins fonctionne exactement comme avant sans lui.
// 2. **Rien n'est perdu en creant un compte.** Le joueur a deja un compte
//    anonyme (cree a sa premiere partie terminee) : on le RATTACHE a un email
//    (`link*`), on ne bascule pas vers un autre (`signIn*`).
// 3. **Ouvrir cet ecran ne cree aucun compte.** On observe l'etat
//    (`watchAccount`) sans appeler `ensureSignedIn()` tant que le joueur
//    n'agit pas.
//
// Reutilise les classes de modale deja presentes dans le jeu
// (`.modal-overlay`, `.modal`, `.modal-close`) plutot que d'inventer un
// vocabulaire visuel parallele — l'ecran de compte doit avoir l'air
// d'appartenir a Assassins, pas d'un service tiers colle par-dessus.
//
// ⚠️ Texte SANS ACCENTS, comme tout le reste de l'interface de ce jeu. Ce
// n'est pas une negligence, c'est la convention du projet : ne pas la casser
// sur ce seul ecran.

import * as kump from "./kump.js";

// Le module ne renvoie que des CODES courts et stables ; chaque projet ecrit
// ses propres phrases, dans son ton.
const ERREURS = {
  "email-already-in-use": "Un compte existe deja avec cet email — connectez-vous.",
  "weak-password": "Mot de passe trop court (6 caracteres minimum).",
  "invalid-email": "Cet email n'a pas l'air valide.",
  "user-not-found": "Aucun compte avec cet email — creez le votre si c'est votre premiere fois.",
  "wrong-password": "Email ou mot de passe incorrect.",
  "invalid-credential": "Email ou mot de passe incorrect.",
  "too-many-requests": "Trop de tentatives — reessayez dans quelques minutes.",
  "already-linked": "Ce compte Google est deja rattache a votre profil.",
  "email-in-use-other-provider":
    "Un compte KUMP existe deja avec cette adresse, mais avec un mot de passe — connectez-vous par email.",
  "provider-disabled": "Cette connexion n'est pas encore disponible.",
  "popup-blocked": "Votre navigateur a bloque la fenetre de connexion.",
  "not-signed-in": "Compte indisponible, rechargez la page.",
  "not-ready": "Le compte KUMP est indisponible pour le moment.",
  "invalid-length": "Le pseudo doit faire entre 3 et 16 caracteres.",
};
const messageErreur = (code) => ERREURS[code] || "Une erreur est survenue, reessayez.";

// Miroir local du pseudo : permet au bouton de l'accueil d'afficher le nom du
// joueur sans avoir a interroger le compte (donc sans charger le SDK) a chaque
// affichage. La source de verite reste le compte KUMP.
const CLE_NOM = "assassins.kumpName";
export function nomLocal() {
  try {
    return localStorage.getItem(CLE_NOM);
  } catch {
    return null;
  }
}
function memoriserNom(nom) {
  try {
    if (nom) localStorage.setItem(CLE_NOM, nom);
    else localStorage.removeItem(CLE_NOM);
  } catch {
    /* stockage indisponible : sans importance, ce n'est qu'un miroir */
  }
}

let overlay = null;
let corps = null;
let unwatch = null;
let declencheur = null;
// Vue affichee ("invite" | "profil"). Sert a NE PAS reconstruire l'ecran quand
// l'identite change sans changer de vue — voir le piege dans `ouvrir()`.
let vue = null;
let auChangement = null;

function fermer() {
  if (!overlay) return;
  if (unwatch) unwatch();
  unwatch = null;
  vue = null;
  overlay.classList.add("hidden");
  document.removeEventListener("keydown", surEchap);
  if (declencheur) declencheur.focus();
  declencheur = null;
}

function surEchap(event) {
  if (event.key === "Escape") fermer();
}

function creerOverlay() {
  overlay = document.createElement("div");
  overlay.id = "kumpAccountModal";
  overlay.className = "modal-overlay hidden";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) fermer();
  });

  const modal = document.createElement("div");
  modal.className = "modal account-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Compte KUMP");
  modal.tabIndex = -1;

  const fermeture = document.createElement("button");
  fermeture.className = "modal-close";
  fermeture.setAttribute("aria-label", "Fermer");
  fermeture.innerHTML = "&times;";
  fermeture.addEventListener("click", fermer);

  const titre = document.createElement("h2");
  titre.textContent = "Compte KUMP";

  corps = document.createElement("div");
  corps.className = "account-body";

  modal.append(fermeture, titre, corps);
  overlay.append(modal);
  document.body.append(overlay);
  return modal;
}

/**
 * Ouvre l'ecran de compte.
 * @param {{ onChange?: () => void }} [options] appele quand l'identite change,
 *   pour que l'accueil rafraichisse son bouton.
 */
export function ouvrirCompte(options) {
  auChangement = (options && options.onChange) || null;
  declencheur = document.activeElement;
  const modal = overlay ? overlay.querySelector(".account-modal") : creerOverlay();
  overlay.classList.remove("hidden");
  document.addEventListener("keydown", surEchap);
  modal.focus();

  corps.innerHTML = '<p class="account-loading">Chargement...</p>';

  // On OBSERVE l'identite, on ne la force pas.
  //
  // ⚠️ PIEGE : ce callback se declenche AUSSI au milieu d'une creation de
  // compte. "Creer mon compte" appelle d'abord `ensureSignedIn()` (il faut un
  // compte anonyme a rattacher), ce qui fait passer l'utilisateur de `null` a
  // anonyme — et reconstruire l'ecran a ce moment-la viderait le formulaire
  // que le joueur vient de remplir, message d'erreur compris. On ne
  // reconstruit donc que si la VUE change reellement.
  unwatch = kump.watchAccount((user) => {
    if (auChangement) auChangement();
    const cible = user && !user.isAnonymous ? "profil" : "invite";
    if (cible === vue) return;
    vue = cible;
    if (cible === "profil") rendreProfil();
    else rendreInvite(Boolean(user));
  });
}

/**
 * Bascule explicitement vers le profil apres une identification reussie.
 *
 * ⚠️ INDISPENSABLE : `onAuthStateChanged` ne se declenche PAS lors d'un
 * `link*`. Rattacher un email a un compte anonyme n'en change pas
 * l'identifiant — pour Firebase, l'utilisateur connecte est le meme, seuls ses
 * fournisseurs ont change. Sans cette bascule, le joueur creait son compte et
 * l'ecran ne bougeait pas.
 */
function allerAuProfil() {
  vue = "profil";
  rendreProfil();
}

// --- Invite : creer un compte, ou se connecter -----------------------------

function rendreInvite(connecte) {
  let mode = "creation"; // "creer" d'abord : c'est le cas courant

  corps.innerHTML = `
    <p class="account-intro">Un seul compte pour tous les jeux KUMP : vos parties, vos roles joues et vos trophees vous suivent d'un appareil a l'autre.</p>
    <p class="account-error hidden" role="alert"></p>
    <label for="kumpEmail">Email</label>
    <input type="email" id="kumpEmail" autocomplete="email" placeholder="vous@exemple.fr" />
    <label for="kumpPassword">Mot de passe</label>
    <input type="password" id="kumpPassword" autocomplete="new-password" placeholder="6 caracteres minimum" />
    <button class="primary big" id="kumpSubmit"></button>
    <p class="account-note" id="kumpExplain"></p>
    <div class="account-sep">ou</div>
    <button class="secondary big" id="kumpGoogle">Continuer avec Google</button>
    <div class="account-reprise hidden" id="kumpReprise">
      <p class="account-note">Vous connecter recuperera ce profil et tout ce qu'il contient. En revanche, les parties jouees ici sans compte ne seront pas reprises.</p>
      <button class="primary big" id="kumpGoogleLogin">Me connecter avec ce compte Google</button>
    </div>
    <div class="account-switch"><button class="secondary" id="kumpToggle"></button></div>
  `;

  const erreur = corps.querySelector(".account-error");
  const email = corps.querySelector("#kumpEmail");
  const motDePasse = corps.querySelector("#kumpPassword");
  const valider = corps.querySelector("#kumpSubmit");
  const bascule = corps.querySelector("#kumpToggle");
  const explication = corps.querySelector("#kumpExplain");

  const reprise = corps.querySelector("#kumpReprise");

  function afficherErreur(code) {
    // Fermer la fenetre Google n'est PAS une erreur : ne rien afficher.
    if (code === "cancelled") return;
    erreur.textContent = messageErreur(code);
    erreur.classList.remove("hidden", "info");
    reprise.classList.add("hidden");
  }

  /**
   * Le compte Google vise appartient deja a un AUTRE profil KUMP.
   *
   * C'est le cas le PLUS FREQUENT des qu'un joueur a deja un compte cree
   * depuis un autre jeu KUMP — et le laisser sur "ce compte est deja
   * rattache" sans rien proposer etait une impasse : aucun moyen de recuperer
   * son profil. On lui propose donc de s'y connecter, en disant franchement
   * ce que ca coute.
   */
  function proposerConnexionGoogle() {
    erreur.textContent =
      "Ce compte Google appartient deja a un profil KUMP — sans doute le votre, cree depuis un autre jeu.";
    // Ton NEUTRE, pas rouge sang : ce n'est pas un echec, c'est une situation
    // qui a une issue, proposee juste en dessous.
    erreur.classList.add("info");
    erreur.classList.remove("hidden");
    reprise.classList.remove("hidden");
    // La sortie est plus bas que le pli de la carte : sans ca, le joueur voit
    // un bandeau et rien d'autre, et croit etre bloque.
    reprise.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function appliquerMode() {
    erreur.classList.add("hidden");
    erreur.classList.remove("info");
    reprise.classList.add("hidden");
    const creation = mode === "creation";
    valider.textContent = creation ? "Creer mon compte" : "Me connecter";
    bascule.textContent = creation ? "J'ai deja un compte" : "Creer un compte a la place";
    motDePasse.setAttribute("autocomplete", creation ? "new-password" : "current-password");
    // La difference n'est PAS cosmetique et le joueur doit la comprendre AVANT
    // de cliquer : creer rattache ses parties actuelles, se connecter bascule
    // sur un autre compte et les abandonne.
    explication.textContent = creation
      ? connecte
        ? "Vos parties deja jouees sur cet appareil seront rattachees a ce compte — rien n'est perdu."
        : "Votre compte vous suivra sur vos autres appareils, et sur vos autres jeux KUMP."
      : "Attention : vous retrouverez les parties de CE compte. Celles jouees ici sans compte ne seront pas reprises.";
  }

  async function envoyer() {
    const mail = email.value.trim();
    const mdp = motDePasse.value;
    if (!mail || !mdp) return afficherErreur("invalid-email");

    valider.disabled = true;
    valider.textContent = "Un instant...";
    const resultat =
      mode === "creation" ? await kump.createAccount(mail, mdp) : await kump.loginToAccount(mail, mdp);
    valider.disabled = false;
    appliquerMode();
    if (!resultat.success) return afficherErreur(resultat.error);
    if (auChangement) auChangement();
    allerAuProfil();
  }

  valider.addEventListener("click", envoyer);
  motDePasse.addEventListener("keydown", (e) => {
    if (e.key === "Enter") envoyer();
  });
  bascule.addEventListener("click", () => {
    mode = mode === "creation" ? "connexion" : "creation";
    appliquerMode();
  });
  corps.querySelector("#kumpGoogle").addEventListener("click", async () => {
    const resultat = await kump.createAccountWithGoogle();
    if (resultat.success) {
      if (auChangement) auChangement();
      return allerAuProfil();
    }
    if (resultat.error === "credential-in-use") return proposerConnexionGoogle();
    afficherErreur(resultat.error);
  });

  corps.querySelector("#kumpGoogleLogin").addEventListener("click", async () => {
    const resultat = await kump.loginWithGoogle();
    if (!resultat.success) return afficherErreur(resultat.error);
    if (auChangement) auChangement();
    allerAuProfil();
  });

  appliquerMode();
}

// --- Connecte : le profil --------------------------------------------------

function formatDuree(ms) {
  if (!ms || ms < 1000) return "—";
  if (ms < 60000) return Math.round(ms / 1000) + " s";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return minutes + " min";
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? heures + " h" : heures + " h " + reste;
}

function echapper(texte) {
  const noeud = document.createElement("span");
  noeud.textContent = String(texte);
  return noeud.innerHTML;
}

async function rendreProfil() {
  corps.innerHTML = '<p class="account-loading">Chargement...</p>';

  // Les quatre lectures partent ensemble : sequentiellement, l'ecran resterait
  // sur "Chargement..." le temps de quatre allers-retours Firestore.
  const [profil, donnees, trophees, catalogue] = await Promise.all([
    kump.getProfile(),
    kump.loadGameData(),
    kump.getUnlockedTrophies(),
    // Libelles lisibles : ils vivent en base (`games/assassins`), pas ici — le
    // jeu et kump.fr lisent ainsi la meme source.
    kump.getGameCatalog(),
  ]);
  if (!overlay || overlay.classList.contains("hidden")) return; // ferme entre-temps
  if (!profil) {
    corps.innerHTML = '<p class="account-error">Profil indisponible. Reessayez plus tard.</p>';
    return;
  }

  memoriserNom(profil.displayName);
  if (auChangement) auChangement();

  const stats = donnees || {};
  const obtenus = {};
  trophees.forEach((t) => {
    obtenus[t.id] = true;
  });
  // Un catalogue absent ne doit jamais donner un ecran vide : on retombe sur
  // les identifiants bruts des trophees reellement obtenus.
  const liste =
    catalogue && catalogue.trophies && catalogue.trophies.length
      ? catalogue.trophies
      : trophees.map((t) => ({ id: t.id, label: t.id, description: "" }));

  const tuile = (valeur, libelle) =>
    `<div class="account-tile"><strong>${echapper(valeur)}</strong><span>${libelle}</span></div>`;

  // Camp le plus joue : une statistique parlante dans un jeu de roles, et
  // deja disponible sans lecture supplementaire.
  const camps = stats.camps || {};
  const campFavori =
    Object.keys(camps).sort((a, b) => camps[b] - camps[a])[0] || null;

  corps.innerHTML = `
    <div class="account-identity">
      <div class="account-avatar" aria-hidden="true">${echapper(profil.displayName.slice(0, 1).toUpperCase())}</div>
      <div>
        <strong>${echapper(profil.displayName)}</strong>
        <span class="account-email">${echapper(profil.email || "Compte Google")}</span>
      </div>
    </div>
    <div class="account-tiles">
      ${tuile(stats.gamesPlayed || 0, "Parties")}
      ${tuile(stats.wins || 0, "Victoires")}
      ${tuile(stats.survivals || 0, "Fois survecu")}
      ${tuile(formatDuree(profil.totalPlaytimeMs), "Temps de jeu (tous jeux)")}
    </div>
    ${campFavori ? `<p class="account-note">Camp le plus joue : <strong>${echapper(campFavori)}</strong> (${camps[campFavori]} parties).</p>` : ""}
    <h3 class="account-subtitle">Trophees ${trophees.length} / ${liste.length}</h3>
    <div class="account-trophies">
      ${liste
        .map(
          (t) =>
            `<span class="account-trophy ${obtenus[t.id] ? "won" : "locked"}" title="${echapper(t.description || t.label)}">${echapper(t.label)}</span>`,
        )
        .join("")}
    </div>
    <h3 class="account-subtitle">Pseudo</h3>
    <div class="account-rename">
      <input type="text" id="kumpName" maxlength="16" value="${echapper(profil.displayName)}" />
      <button class="secondary" id="kumpRename">Changer</button>
    </div>
    <p class="account-note">Retrouvez tous vos jeux KUMP sur <a href="https://kump.fr/profil" target="_blank" rel="noopener">kump.fr/profil</a>.</p>
    <button class="secondary account-logout" id="kumpLogout">Se deconnecter</button>
  `;

  corps.querySelector("#kumpRename").addEventListener("click", async () => {
    const champ = corps.querySelector("#kumpName");
    const resultat = await kump.setDisplayName(champ.value);
    const note = document.createElement("p");
    note.className = "account-note";
    if (!resultat.success) {
      note.textContent = messageErreur(resultat.error);
    } else {
      memoriserNom(champ.value.trim());
      if (auChangement) auChangement();
      note.textContent = "Pseudo mis a jour.";
    }
    champ.parentElement.after(note);
    setTimeout(() => note.remove(), 3000);
  });

  corps.querySelector("#kumpLogout").addEventListener("click", async () => {
    await kump.logoutAccount();
    memoriserNom(null);
    if (auChangement) auChangement();
    fermer();
  });
}
