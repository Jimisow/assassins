// Petit bandeau "Connexion perdue" affiche automatiquement quand l'appareil
// perd sa connexion internet (4G/5G qui coupe, wifi instable, changement de
// reseau...), et masque des que la connexion revient. `navigator.onLine` ne
// garantit pas que Firestore precisement est joignable, mais couvre le cas
// le plus frequent (coupure reseau complete) sans complexite superflue :
// Firestore lui-meme se reconnecte et resynchronise automatiquement des que
// la connexion redevient disponible (comportement natif du SDK), ce bandeau
// sert juste a informer le joueur qu'il ne se passe rien d'anormal.
export function initNetworkStatus() {
  const banner = document.createElement("div");
  banner.id = "networkStatusBanner";
  banner.className = "network-status-banner hidden";
  banner.textContent = "⚠️ Connexion perdue — reconnexion en cours...";
  document.body.appendChild(banner);

  function update() {
    banner.classList.toggle("hidden", navigator.onLine);
  }
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}
