// Serveur Express minimal : sert la PWA statique et une route de sante.
// Toute la logique temps reel du jeu vit cote client, via Firebase Firestore.
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Toute route inconnue retombe sur l'accueil (routing simple cote client par pages).
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Assassins server running on http://localhost:${PORT}`);
});
