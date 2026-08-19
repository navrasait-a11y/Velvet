const { getDb, getRealtimeDb } = require("../config/firebase");
const db = getDb();
const rtdb = getRealtimeDb();

/**
 * Helper: updates a single boolean flag on a userChats node.
 * Uses a direct set (after existence check) instead of transaction
 * to avoid the RTDB transaction abort issue where null nodes cause
 * the update to silently do nothing.
 */
const updateChatFlag = async (userId, roomId, flagKey, flagValue) => {
  const ref = rtdb.ref(`userChats/${userId}/${roomId}`);
  const snap = await ref.once("value");

  if (!snap.exists()) {
    throw new Error("Chat not found");
  }

  await ref.update({ [flagKey]: flagValue });
  return true;
};

exports.updateFavorite = async (userId, roomId, isFavorite) => {
  return updateChatFlag(userId, roomId, "isFavorite", isFavorite);
};

exports.updateArchived = async (userId, roomId, isArchived) => {
  return updateChatFlag(userId, roomId, "isArchived", isArchived);
};

exports.updatePinned = async (userId, roomId, isPinned) => {
  return updateChatFlag(userId, roomId, "isPinned", isPinned);
};

exports.updatePrivate = async (userId, roomId, isPrivate) => {
  // Only require password setup when ENABLING private mode
  if (isPrivate) {
    const settingsDoc = await db.collection("Users_Private_Settings").doc(userId).get();
    if (!settingsDoc.exists) {
      throw new Error("Set up a private chat password first");
    }
  }

  return updateChatFlag(userId, roomId, "isPrivate", isPrivate);
};
