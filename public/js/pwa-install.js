// Bouton "Installer l'app" sur l'ecran d'accueil.
//
// Android / Chrome / Edge (desktop ou mobile) : le navigateur emet
// l'evenement `beforeinstallprompt` quand l'app est installable (manifest
// valide, service worker enregistre, HTTPS) et pas deja installee. On
// intercepte cet evenement, on le garde de cote, et on l'utilise pour
// declencher l'invite d'installation NATIVE au clic sur le bouton.
//
// iOS (Safari, et les autres navigateurs qui utilisent le meme moteur
// WebKit impose par Apple) : il n'existe AUCUNE API programmable pour
// declencher une installation - c'est une limitation d'Apple, pas un oubli
// cote code. La seule facon d'installer est manuelle (bouton Partager ->
// "Sur l'ecran d'accueil"). Le bouton ouvre donc a la place une petite
// modale qui explique la manipulation.
//
// Dans tous les cas, si l'app tourne deja en mode installe (standalone), le
// bouton reste cache : inutile de proposer d'installer ce qui l'est deja.

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function initInstallButton() {
  const btn = document.getElementById("installAppBtn");
  if (!btn || isStandalone()) return;

  if (isIOS()) {
    // Pas d'evenement a attendre : on sait tout de suite que c'est possible
    // (manuellement), donc le bouton s'affiche immediatement.
    btn.classList.remove("hidden");
    btn.addEventListener("click", () => {
      document.getElementById("iosInstallModal")?.classList.remove("hidden");
    });
    document.getElementById("closeIosInstallModalBtn")?.addEventListener("click", () => {
      document.getElementById("iosInstallModal")?.classList.add("hidden");
    });
    return;
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.classList.remove("hidden");
  });

  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    btn.disabled = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.classList.add("hidden");
    btn.disabled = false;
  });

  window.addEventListener("appinstalled", () => {
    btn.classList.add("hidden");
    deferredPrompt = null;
  });
}
