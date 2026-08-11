/**
 * Presence Service — Online Status & Last Seen
 *
 * Architecture:
 *   - RTDB path: presence/{userId}
 *       { online: true/false, lastSeen: timestamp }
 *
 *   - Client SDK sets online: true on connect and uses onDisconnect()
 *     to set online: false + lastSeen automatically when app closes.
 *
 *   - Backend (this service) is used for:
 *       1. Manually setting offline on logout (API call)
 *       2. Reading another user's presence status (via REST)
 *
 * Why RTDB for presence and NOT Firestore?
 *   Firebase RTDB has a built-in concept called "onDisconnect" that
 *   automatically writes data when a client disconnects — even on
 *   network drop or app kill. Firestore does NOT have this. This is
 *   the ONLY correct way to do presence in Firebase.
 *
 * Client-side (Flutter) must do this on app start:
 *   final presenceRef = FirebaseDatabase.instance.ref('presence/$userId');
 *   presenceRef.set({ 'online': true, 'lastSeen': ServerValue.TIMESTAMP });
 *   presenceRef.onDisconnect().set({
 *     'online': false,
 *     'lastSeen': ServerValue.TIMESTAMP,
 *   });
 */

const { getRealtimeDb } = require("../config/firebase");

const rtdb = getRealtimeDb();

// ─────────────────────────────────────────────────────────────────────────────
// Set user offline (called on logout from backend)
// ─────────────────────────────────────────────────────────────────────────────
const setOffline = async (userId) => {
  await rtdb.ref(`presence/${userId}`).set({
    online: false,
    lastSeen: Date.now(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Get presence status of a user
// ─────────────────────────────────────────────────────────────────────────────
const getPresence = async (userId) => {
  const snap = await rtdb.ref(`presence/${userId}`).once("value");
  if (!snap.exists()) {
    return { online: false, lastSeen: null };
  }
  return snap.val();
};

// ─────────────────────────────────────────────────────────────────────────────
// Get presence for multiple users at once — chunked parallel RTDB reads
// ─────────────────────────────────────────────────────────────────────────────
const getMultiplePresence = async (userIds) => {
  if (!userIds || userIds.length === 0) return {};

  const CHUNK_SIZE = 20;
  const results = new Map();

  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (userId) => {
        const snap = await rtdb.ref(`presence/${userId}`).once("value");
        return {
          userId,
          presence: snap.exists()
            ? snap.val()
            : { online: false, lastSeen: null },
        };
      })
    );
    chunkResults.forEach((r) => results.set(r.userId, r.presence));
  }

  return Object.fromEntries(results);
};

module.exports = { setOffline, getPresence, getMultiplePresence };
