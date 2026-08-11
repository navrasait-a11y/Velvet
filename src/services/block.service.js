const { getDb } = require("../config/firebase");
const { getRealtimeDb } = require("../config/firebase");
const { generateRoomId } = require("../utils/roomId");

const db = getDb();
const rtdb = getRealtimeDb();

/**
 * Block a user.
 * Also invalidates the RTDB room cache (mutualVerified) so the blocked user
 * cannot bypass the block check on their next message attempt.
 */
const blockUser = async (blockerId, blockedUserId) => {
  // Validate target user exists
  const targetUser = await db.collection("users").doc(blockedUserId).get();
  if (!targetUser.exists) {
    throw new Error("User not found");
  }

  const docRef = db.collection("Blocked_Users").doc(blockerId);
  const doc = await docRef.get();

  if (doc.exists) {
    const blockedUsers = doc.data().blockedUsers || {};
    if (blockedUsers[blockedUserId]) {
      throw new Error("User already blocked");
    }
  }

  await docRef.set(
    { blockedUsers: { [blockedUserId]: { blockedAt: Date.now() } } },
    { merge: true }
  );

  // Invalidate the room cache in both directions so neither side bypasses checks
  const roomId = generateRoomId(blockerId, blockedUserId);
  rtdb
    .ref(`chatRooms/${roomId}/mutualVerified`)
    .set(false)
    .catch(() => {}); // Non-fatal — block check in sendMessage is the real enforcement
};

const unblockUser = async (blockerId, blockedUserId) => {
  const docRef = db.collection("Blocked_Users").doc(blockerId);
  const doc = await docRef.get();

  // Treat "no block list" and "not in block list" both as 404
  if (!doc.exists || !doc.data().blockedUsers?.[blockedUserId]) {
    throw new Error("User is not blocked");
  }

  const { admin } = require("../config/firebase");
  await docRef.update({
    [`blockedUsers.${blockedUserId}`]: admin.firestore.FieldValue.delete(),
  });
};

const getBlockedUsers = async (blockerId) => {
  const doc = await db.collection("Blocked_Users").doc(blockerId).get();
  if (!doc.exists) return [];

  const blockedUsers = doc.data().blockedUsers || {};
  return Object.entries(blockedUsers).map(([userId, data]) => ({
    userId,
    blockedAt: data.blockedAt,
  }));
};

/**
 * Returns true if userA blocked userB OR userB blocked userA.
 */
const isBlocked = async (userA, userB) => {
  const [docA, docB] = await Promise.all([
    db.collection("Blocked_Users").doc(userA).get(),
    db.collection("Blocked_Users").doc(userB).get(),
  ]);

  const blockedByA = docA.exists ? docA.data().blockedUsers || {} : {};
  const blockedByB = docB.exists ? docB.data().blockedUsers || {} : {};

  return !!blockedByA[userB] || !!blockedByB[userA];
};

module.exports = { blockUser, unblockUser, getBlockedUsers, isBlocked };
