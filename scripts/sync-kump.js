// Recopie le module `kump-account` depuis node_modules vers public/js/vendor/,
// et tient à jour la liste du service worker.
//
// POURQUOI UNE COPIE, ET PAS UN IMPORT NORMAL ?
//
// Assassins n'a **aucun bundler** — c'est une propriété assumée du projet, pas
// un manque : `public/` est servi tel quel, en local par Express et en
// production par GitHub Pages (le workflow publie le dossier sans le
// construire). Un navigateur ne sait pas résoudre `import ... from
// 'kump-account'` : il lui faut une URL. Deux façons de la lui donner :
//
//   1. introduire un build (Vite) — casserait le « zéro build », le workflow
//      GitHub Actions, le service worker et les trois pages d'entrée ;
//   2. copier le module dans `public/` et le désigner par une **import map**.
//
// C'est la seconde qui est retenue. Le prix à payer est cette étape de
// synchronisation explicite, à relancer après chaque mise à jour du module.
//
// ⚠️ NE JAMAIS ÉDITER `public/js/vendor/kump-account/` À LA MAIN. C'est une
// copie : la prochaine synchronisation écrasera la modification sans prévenir.
// Une correction se fait dans le dépôt `kump-account`, se pousse, puis
// `npm install && npm run sync:kump` ici.
//
//     npm run sync:kump
//
// Le dossier vendor EST commité : c'est ce qui est servi en production, et le
// workflow de déploiement ne lance aucune installation npm.

const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'node_modules', 'kump-account', 'src');
const to = path.join(__dirname, '..', 'public', 'js', 'vendor', 'kump-account');

if (!fs.existsSync(from)) {
  console.error(
    '[sync:kump] `kump-account` absent de node_modules.\n' +
      "            Lancer `npm install` d'abord.",
  );
  process.exit(1);
}

// On repart d'un dossier propre : un fichier retiré du module doit disparaître
// ici aussi, sinon l'import map continuerait de servir du code mort.
fs.rmSync(to, { recursive: true, force: true });

// Copie RÉCURSIVE. Le module a gagné un sous-dossier `ui/` (les écrans prêts à
// l'emploi) : une boucle à plat sur `readdirSync` plantait dessus, avec une
// erreur `EISDIR` peu parlante. Corrigé le jour où `ui/` est apparu.
const copies = [];
function copier(source, cible, prefixe) {
  fs.mkdirSync(cible, { recursive: true });
  for (const entree of fs.readdirSync(source, { withFileTypes: true })) {
    // Les définitions TypeScript ne servent qu'aux projets TS (kump.fr) : les
    // servir au navigateur serait du poids pour rien.
    if (entree.name.endsWith('.d.ts')) continue;
    const chemin = path.join(source, entree.name);
    const destination = path.join(cible, entree.name);
    if (entree.isDirectory()) {
      copier(chemin, destination, prefixe + entree.name + '/');
    } else {
      fs.copyFileSync(chemin, destination);
      copies.push(prefixe + entree.name);
    }
  }
}
copier(from, to, '');
copies.sort();

const version = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'kump-account', 'package.json'), 'utf8'),
).version;

fs.writeFileSync(
  path.join(to, 'VERSION.txt'),
  [
    'kump-account ' + version,
    'copie du ' + new Date().toISOString().slice(0, 10) + ' par npm run sync:kump',
    'NE PAS EDITER CES FICHIERS A LA MAIN - voir scripts/sync-kump.js',
    '',
  ].join('\n'),
);

// --- Service worker : la liste doit rester EXACTE ---------------------------
//
// `cache.addAll()` échoue EN BLOC si une seule requête échoue. Un fichier du
// module absent de cette liste — ou une entrée pointant vers un fichier
// supprimé — fait donc échouer l'installation entière du service worker, EN
// SILENCE (piège déjà payé en session 16, voir DECISIONS.md).
//
// Tant que le module tenait en une poignée de fichiers, tenir la liste à la
// main passait. Maintenant qu'il grandit, on la REGÉNÈRE : compter sur le fait
// de s'en souvenir, c'est programmer la panne.
const swPath = path.join(__dirname, '..', 'public', 'service-worker.js');
const DEBUT = '  // <<< kump-account : liste generee par npm run sync:kump';
const FIN = '  // kump-account >>>';

let sw = fs.readFileSync(swPath, 'utf8');
if (sw.includes(DEBUT) && sw.includes(FIN)) {
  const lignes = copies.map((f) => '  "./js/vendor/kump-account/' + f + '",').join('\n');
  const avant = sw.slice(0, sw.indexOf(DEBUT) + DEBUT.length);
  const apres = sw.slice(sw.indexOf(FIN));
  let suivant = avant + '\n' + lignes + '\n' + apres;

  if (suivant !== sw) {
    // Le nom du cache DOIT changer, sinon les navigateurs qui ont déjà
    // l'ancienne liste ne réinstallent jamais la nouvelle.
    const cache = /assassins-shell-v(\d+)/.exec(suivant);
    if (cache) {
      const numero = Number(cache[1]) + 1;
      suivant = suivant.replace(cache[0], 'assassins-shell-v' + numero);
      console.log('[sync:kump] service-worker.js mis a jour, cache -> v' + numero);
    } else {
      console.warn('[sync:kump] nom de cache introuvable : a incrementer a la main.');
    }
    fs.writeFileSync(swPath, suivant);
  }
} else {
  console.warn(
    '[sync:kump] Reperes absents de service-worker.js : la liste des fichiers du\n' +
      '            module n a PAS ete mise a jour. Encadrer la liste par les lignes\n' +
      '            "' + DEBUT + '" et "' + FIN + '".',
  );
}

console.log(
  '[sync:kump] ' + copies.length + ' fichiers copies (kump-account ' + version + ')' +
    ' -> public/js/vendor/kump-account/',
);
