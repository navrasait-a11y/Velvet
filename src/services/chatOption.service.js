const { getDb, getRealtimeDb } = require("../config/firebase");
const db = getDb();
const rtdb = getRealtimeDb();
const { logger } = require("../utils/logger");

exports.updateFavorite = async (userId, roomId, isFavorite) => {
  const ref = rtdb.ref(`userChats/${userId}/${roomId}`);

  const result = await ref.transaction((current) => {
    if (!current) return;
    return { ...current, isFavorite };
  });

  if (!result.committed) {
    throw new Error("Chat not found");
  }

  return true;
};

exports.updateArchived = async (userId, roomId, isArchived) => {
  const ref = rtdb.ref(`userChats/${userId}/${roomId}`);

  const result = await ref.transaction((current) => {
    if (!current) return;
    return { ...current, isArchived };
  });

  if (!result.committed) {
    throw new Error("Chat not found");
  }

  return true;
};

exports.updatePinned = async (userId, roomId, isPinned) => {
  const ref = rtdb.ref(`userChats/${userId}/${roomId}`);

  const result = await ref.transaction((current) => {
    if (!current) return;
    return { ...current, isPinned };
  });

  if (!result.committed) {
    throw new Error("Chat not found");
  }

  return true;
};

exports.updatePrivate = async (userId, roomId, isPrivate) => {
  if (isPrivate) {
    const settingsDoc = await db.collection("Users_Private_Settings").doc(userId).get();
    if (!settingsDoc.exists) {
      throw new Error("Set up a private chat password first");
    }
  }

  const ref = rtdb.ref(`userChats/${userId}/${roomId}`);

  const result = await ref.transaction((current) => {
    if (!current) return;
    return { ...current, isPrivate };
  });

  if (!result.committed) {
    throw new Error("Chat not found");
  }

  return true;
};
