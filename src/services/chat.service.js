const { getDb, getRealtimeDb } = require("../config/firebase");
const { isBlocked } = require("./block.service");
const { notifyNewMessage } = require("./notification.service");
const { logger } = require("../utils/logger");

const db = getDb();
const rtdb = getRealtimeDb();

const MAX_MESSAGES_PER_PAGE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Create chat room
// Block check happens HERE — once at room creation.
// ─────────────────────────────────────────────────────────────────────────────
const createRoom = async (roomId, senderId, receiverId) => {
  const roomRef = rtdb.ref(`chatRooms/${roomId}`);

  const existingSnap = await roomRef.once("value");
  const roomExists = existingSnap.exists();
  const existingRoom = roomExists ? existingSnap.val() : null;

  if (roomExists) {
    return existingRoom;
  }

  const blocked = await isBlocked(senderId, receiverId);
  if (blocked) {
    throw new Error("Cannot send message. A block exists between you and this user.");
  }

  const timestamp = Date.now();
  const roomData = {
    roomId,
    participants: { [senderId]: true, [receiverId]: true },
    lastMessage: "",
    lastMessageType: "",
    lastMessageSender: "",
    lastMessageTime: 0,
    createdAt: timestamp,
  };

  await roomRef.transaction((currentData) => {
    if (currentData !== null) return currentData;
    return roomData;
  });

  const finalSnap = await roomRef.once("value");
  return finalSnap.val();
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Room
// ─────────────────────────────────────────────────────────────────────────────
const getRoom = async (roomId) => {
  const snapshot = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  return snapshot.exists() ? snapshot.val() : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Send Message
// ─────────────────────────────────────────────────────────────────────────────
const sendMessage = async ({
  roomId,
  senderId,
  receiverId,
  message = "",
  type = "text",
  media = null,
  location = null,
  contact = null,
}) => {
  // Prevent self-messaging
  if (senderId === receiverId) {
    throw new Error("You cannot send messages to yourself");
  }

  // Verify room exists and mutual contact was verified at room creation
  const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  if (!roomSnap.exists()) {
    throw new Error("Chat room not found. Create a room first.");
  }

  const room = roomSnap.val();

  // Participant check
  if (!room.participants?.[senderId]) {
    throw new Error("Unauthorized");
  }

  // Fast block check — still run per message since block can happen after room creation
  const blocked = await isBlocked(senderId, receiverId);
  if (blocked) {
    throw new Error("Cannot send message. A block exists between you and this user.");
  }

  const messageRef = rtdb.ref(`messages/${roomId}`).push();
  const messageId = messageRef.key;
  const timestamp = Date.now();

  const messageData = {
    messageId,
    roomId,
    senderId,
    receiverId,
    type,
    text: type === "text" ? message : null,
    media: media || null,
    location: type === "location" ? location : null,
    contact: type === "contact" ? contact : null,
    status: "sent",
    createdAt: timestamp,
    deliveredAt: null,
    readAt: null,
    edited: false,
    editedAt: null,
    deletedFor: {},
    deletedForEveryone: false,
    deletedAt: null,
  };

  const updates = {};
  updates[`messages/${roomId}/${messageId}`] = messageData;
  updates[`chatRooms/${roomId}/lastMessage`] = type === "text" ? message : `[${type}]`;
  updates[`chatRooms/${roomId}/lastMessageType`] = type;
  updates[`chatRooms/${roomId}/lastMessageSender`] = senderId;
  updates[`chatRooms/${roomId}/lastMessageTime`] = timestamp;

  // Sender chat entry
  updates[`userChats/${senderId}/${roomId}/roomId`] = roomId;
  updates[`userChats/${senderId}/${roomId}/otherUser`] = receiverId;
  updates[`userChats/${senderId}/${roomId}/lastMessage`] = type === "text" ? message : `[${type}]`;
  updates[`userChats/${senderId}/${roomId}/lastMessageType`] = type;
  updates[`userChats/${senderId}/${roomId}/updatedAt`] = timestamp;

  const senderSnap = await rtdb.ref(`userChats/${senderId}/${roomId}`).once("value");
  if (!senderSnap.exists()) {
    updates[`userChats/${senderId}/${roomId}/unreadCount`] = 0;
    updates[`userChats/${senderId}/${roomId}/isFavorite`] = false;
    updates[`userChats/${senderId}/${roomId}/isArchived`] = false;
    updates[`userChats/${senderId}/${roomId}/isPinned`] = false;
    updates[`userChats/${senderId}/${roomId}/isPrivate`] = false;
  }

  // Receiver chat entry
  updates[`userChats/${receiverId}/${roomId}/roomId`] = roomId;
  updates[`userChats/${receiverId}/${roomId}/otherUser`] = senderId;
  updates[`userChats/${receiverId}/${roomId}/lastMessage`] = type === "text" ? message : `[${type}]`;
  updates[`userChats/${receiverId}/${roomId}/lastMessageType`] = type;
  updates[`userChats/${receiverId}/${roomId}/updatedAt`] = timestamp;

  const receiverSnap = await rtdb.ref(`userChats/${receiverId}/${roomId}`).once("value");
  if (!receiverSnap.exists()) {
    updates[`userChats/${receiverId}/${roomId}/unreadCount`] = 0;
    updates[`userChats/${receiverId}/${roomId}/isFavorite`] = false;
    updates[`userChats/${receiverId}/${roomId}/isArchived`] = false;
    updates[`userChats/${receiverId}/${roomId}/isPinned`] = false;
    updates[`userChats/${receiverId}/${roomId}/isPrivate`] = false;
  }

  await rtdb.ref().update(updates);

  // Increment receiver unread count atomically
  await rtdb
    .ref(`userChats/${receiverId}/${roomId}/unreadCount`)
    .transaction((count) => (count || 0) + 1);

  // FCM — fire and forget, never block message delivery
  setImmediate(async () => {
    try {
      const senderProfileDoc = await db.collection("Users_Profile").doc(senderId).get();
      const senderName = senderProfileDoc.exists
        ? senderProfileDoc.data().name || "Velvet User"
        : "Velvet User";

      await notifyNewMessage({ receiverId, senderId, senderName, message: type === "text" ? message : "", type, roomId });
    } catch (err) {
      logger.error("[FCM] 1-to-1 notification error:", err.message);
    }
  });

  return messageData;
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Messages (paginated, newest-first)
// ─────────────────────────────────────────────────────────────────────────────
const getMessages = async (roomId, userId, limit = 20, lastKey = null) => {
  const clampedLimit = Math.min(Number(limit) || 20, MAX_MESSAGES_PER_PAGE);

  let query = rtdb.ref(`messages/${roomId}`).orderByKey().limitToLast(clampedLimit);

  if (lastKey) {
    query = rtdb.ref(`messages/${roomId}`).orderByKey().endBefore(lastKey).limitToLast(clampedLimit);
  }

  const snapshot = await query.once("value");
  if (!snapshot.exists()) return [];

  const messages = [];
  const updates = {};

  snapshot.forEach((doc) => {
    const msg = doc.val();
    if (msg.deletedFor?.[userId]) return;
    if (msg.deletedForEveryone === true) return;
    messages.push(msg);

    if (msg.receiverId === userId && msg.status === "sent") {
      updates[`${doc.key}/status`] = "delivered";
      updates[`${doc.key}/deliveredAt`] = Date.now();
      msg.status = "delivered";
      msg.deliveredAt = Date.now();
    }
  });

  if (Object.keys(updates).length > 0) {
    await rtdb.ref(`messages/${roomId}`).update(updates);
  }

  return messages.reverse();
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Chat List — N+1 fixed with batch Firestore reads
// ─────────────────────────────────────────────────────────────────────────────
const getChatList = async (userId, favorite, archived, isPrivate) => {
  const snapshot = await rtdb
    .ref(`userChats/${userId}`)
    .orderByChild("updatedAt")
    .once("value");

  if (!snapshot.exists()) return [];

  const chatData = snapshot.val();

  const isFavoriteMode = favorite === "true";
  const isArchivedMode = archived === "true";
  const isPrivateMode = isPrivate === "true";

  // Filter chats by list type
  const filtered = [];
  for (const roomId in chatData) {
    const chat = chatData[roomId];
    const chatIsFavorite = chat.isFavorite || false;
    const chatIsArchived = chat.isArchived || false;
    const chatIsPrivate = chat.isPrivate || false;

    if (isPrivateMode) {
      // Private list: only chats marked as private
      if (!chatIsPrivate) continue;
    } else if (isArchivedMode) {
      // Archived list: only chats marked as archived (and not private)
      if (!chatIsArchived || chatIsPrivate) continue;
    } else if (isFavoriteMode) {
      // Favorites list: only favorite chats that are not archived or private
      if (!chatIsFavorite || chatIsArchived || chatIsPrivate) continue;
    } else {
      // Default inbox: exclude archived and private chats
      if (chatIsArchived || chatIsPrivate) continue;
    }

    filtered.push({ roomId, chat });
  }

  if (filtered.length === 0) return [];

  // Batch-fetch all otherUser profiles at once (N+1 fix)
  const otherUserIds = [...new Set(filtered.map((f) => f.chat.otherUser).filter(Boolean))];

  const profileMap = new Map();
  const userDataMap = new Map();

  if (otherUserIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < otherUserIds.length; i += 30) chunks.push(otherUserIds.slice(i, i + 30));

    const [profileResults, userResults] = await Promise.all([
      Promise.all(chunks.map((chunk) =>
        db.getAll(...chunk.map((id) => db.collection("Users_Profile").doc(id)))
      )),
      Promise.all(chunks.map((chunk) =>
        db.getAll(...chunk.map((id) => db.collection("users").doc(id)))
      )),
    ]);

    profileResults.flat().forEach((doc) => { if (doc.exists) profileMap.set(doc.id, doc.data()); });
    userResults.flat().forEach((doc) => { if (doc.exists) userDataMap.set(doc.id, doc.data()); });
  }

  const chats = filtered.map(({ roomId, chat }) => {
    const otherUserId = chat.otherUser;
    let profile = {};

    if (otherUserId && profileMap.has(otherUserId)) {
      const pd = profileMap.get(otherUserId);
      const ud = userDataMap.get(otherUserId) || {};
      profile = {
        userId: otherUserId,
        name: pd.name || "",
        phone: ud.phone || "",
        profileImage: pd.profileImage || null,
      };
    }

    return {
      ...chat,
      isFavorite: chat.isFavorite || false,
      isArchived: chat.isArchived || false,
      isPinned: chat.isPinned || false,
      isPrivate: chat.isPrivate || false,
      profile,
    };
  });

  chats.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
    return b.updatedAt - a.updatedAt;
  });

  return chats;
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete for me
// ─────────────────────────────────────────────────────────────────────────────
const deleteForMe = async ({ roomId, messageId, userId }) => {
  // Verify user is a participant
  const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  if (!roomSnap.exists()) throw new Error("Room not found");
  if (!roomSnap.val().participants?.[userId]) throw new Error("Unauthorized");

  const ref = rtdb.ref(`messages/${roomId}/${messageId}`);
  const snap = await ref.once("value");
  if (!snap.exists()) throw new Error("Message not found");

  await ref.update({ [`deletedFor/${userId}`]: true });
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete for everyone (sender only)
// ─────────────────────────────────────────────────────────────────────────────
const deleteForEveryone = async ({ roomId, messageId, userId }) => {
  const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  if (!roomSnap.exists()) throw new Error("Room not found");
  if (!roomSnap.val().participants?.[userId]) throw new Error("Unauthorized");

  const ref = rtdb.ref(`messages/${roomId}/${messageId}`);
  const snapshot = await ref.once("value");
  if (!snapshot.exists()) throw new Error("Message not found");

  const message = snapshot.val();
  if (message.senderId !== userId) throw new Error("Only the sender can delete for everyone");

  await ref.update({ text: null, media: null, deletedForEveryone: true, deletedAt: Date.now() });
};

// ─────────────────────────────────────────────────────────────────────────────
// Mark Delivered — batch RTDB read (fixes N+1 per-messageId reads)
// ─────────────────────────────────────────────────────────────────────────────
const markDelivered = async (roomId, messageIds, userId) => {
  const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  if (!roomSnap.exists()) throw new Error("Room not found");
  if (!roomSnap.val().participants?.[userId]) throw new Error("Unauthorized");

  // Fetch all messages in one shot instead of N individual reads
  const messagesSnap = await rtdb.ref(`messages/${roomId}`).once("value");
  if (!messagesSnap.exists()) return;

  const allMessages = messagesSnap.val();
  const updates = {};
  const now = Date.now();

  for (const messageId of messageIds) {
    const msg = allMessages[messageId];
    if (!msg) continue;
    if (msg.receiverId !== userId || msg.status !== "sent") continue;
    updates[`${messageId}/status`] = "delivered";
    updates[`${messageId}/deliveredAt`] = now;
  }

  if (Object.keys(updates).length > 0) {
    await rtdb.ref(`messages/${roomId}`).update(updates);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Mark Read
// ─────────────────────────────────────────────────────────────────────────────
const markRead = async (roomId, messageIds, userId) => {
  const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  if (!roomSnap.exists()) throw new Error("Room not found");
  if (!roomSnap.val().participants?.[userId]) throw new Error("Unauthorized");

  const messagesSnap = await rtdb.ref(`messages/${roomId}`).once("value");
  if (!messagesSnap.exists()) return { updated: 0 };

  const messages = messagesSnap.val();
  const updates = {};
  const now = Date.now();
  let updatedCount = 0;

  for (const messageId of messageIds) {
    const msg = messages[messageId];
    if (!msg) continue;
    if (msg.receiverId !== userId) continue;
    if (msg.status === "read") continue;
    if (!["sent", "delivered"].includes(msg.status)) continue;

    updates[`${messageId}/status`] = "read";
    updates[`${messageId}/readAt`] = now;
    updatedCount++;
  }

  if (Object.keys(updates).length > 0) {
    await rtdb.ref(`messages/${roomId}`).update(updates);
  }

  await rtdb.ref(`userChats/${userId}/${roomId}/unreadCount`).set(0);
  return { updated: updatedCount };
};

// ─────────────────────────────────────────────────────────────────────────────
// Typing Status
// ─────────────────────────────────────────────────────────────────────────────
const updateTyping = async (roomId, userId, isTyping) => {
  const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  if (!roomSnap.exists()) throw new Error("Room not found");
  if (!roomSnap.val().participants?.[userId]) throw new Error("Unauthorized");

  const typingRef = rtdb.ref(`typing/${roomId}/${userId}`);
  const current = await typingRef.once("value");

  if (current.exists() && current.val().isTyping === isTyping) return;

  await typingRef.set({ isTyping, updatedAt: Date.now() });
};

// ─────────────────────────────────────────────────────────────────────────────
// Export Chat — returns all non-deleted messages in chronological order
// ─────────────────────────────────────────────────────────────────────────────
const exportChat = async (roomId, userId) => {
  const roomSnap = await rtdb.ref(`chatRooms/${roomId}`).once("value");
  if (!roomSnap.exists()) throw new Error("Room not found");
  if (!roomSnap.val().participants?.[userId]) throw new Error("Unauthorized");

  // orderByChild('createdAt') already returns in ascending (oldest-first) order
  // which is correct for a chat export — no reverse needed
  const messagesSnap = await rtdb.ref(`messages/${roomId}`).orderByChild("createdAt").once("value");
  if (!messagesSnap.exists()) return [];

  const messages = [];
  messagesSnap.forEach((doc) => {
    const msg = doc.val();
    if (msg.deletedFor?.[userId]) return;
    if (msg.deletedForEveryone === true) return;
    messages.push(msg);
  });

  return messages;
};

module.exports = {
  createRoom, getRoom, sendMessage, getMessages, getChatList,
  deleteForMe, deleteForEveryone, markDelivered, markRead, updateTyping,
  exportChat,
};
