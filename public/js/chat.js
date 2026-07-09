// Chat du lobby (avant partie) + chat unifie en partie ("chatGame").
// En partie, un seul flux de messages est stocke : chaque message porte un
// flag `isDead` (statut de son auteur au moment de l'envoi). Les vivants
// filtrent les messages des morts a l'affichage ; les morts voient tout.
import {
  db,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDocs,
  deleteDoc,
} from "./firebase-config.js";

function chatCollection(code, channel) {
  // channel: "chatLobby" (avant partie) | "chatGame" (en partie, unifie)
  return collection(db, "lobbies", code, channel);
}

export async function sendMessage(code, channel, authorId, authorName, text, extra = {}) {
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) return;
  await addDoc(chatCollection(code, channel), {
    authorId,
    authorName,
    text: trimmed,
    createdAt: serverTimestamp(),
    ...extra,
  });
}

export function listenToChat(code, channel, callback) {
  const q = query(chatCollection(code, channel), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(messages);
  });
}

// Supprime completement l'historique d'un chat (utilise pour reset chatLobby au lancement).
export async function clearChat(code, channel) {
  const snap = await getDocs(chatCollection(code, channel));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
