// Empeche le double-clic / spam d'un bouton pendant une action asynchrone
// Firestore en cours, et donne un retour visuel immediat (petit spinner).
// Principe : desactiver un <button> AVANT tout `await` fait que le
// navigateur ignore silencieusement les clics suivants sur ce meme bouton
// (un bouton disabled ne recoit plus jamais d'evenements "click"), donc pas
// besoin de logique de deduplication cote serveur pour ce cas simple.

// `group`, si fourni (ex: le conteneur d'une grille de choix), desactive
// aussi tous les boutons de ce conteneur le temps de l'action - pour eviter
// qu'un clic sur un AUTRE choix pendant l'envoi du premier ne parte aussi.
export function guardedClick(el, handler, group) {
  el.addEventListener("click", async (e) => {
    if (el.disabled) return;
    const scope = group ? Array.from(group.querySelectorAll("button")) : [el];
    scope.forEach((b) => { b.disabled = true; });
    el.classList.add("btn-busy");
    try {
      await handler(e);
    } finally {
      // Le bouton a pu disparaitre entre-temps (re-rendu de l'ecran suite au
      // changement declenche par l'action elle-meme) : reactiver un noeud
      // detache du DOM ne fait rien de mal, pas besoin de verifier isConnected.
      scope.forEach((b) => { b.disabled = false; });
      el.classList.remove("btn-busy");
    }
  });
}

// Meme principe pour un formulaire (ex: rejoindre un salon) : desactive le
// bouton de soumission des le "submit", quel que soit le nombre de fois ou
// l'utilisateur appuie sur Entree ou clique juste apres.
export function guardedSubmit(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add("btn-busy"); }
    try {
      await handler(e);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove("btn-busy"); }
    }
  });
}
