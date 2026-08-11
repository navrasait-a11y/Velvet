/**
 * FCM Notification Service
 * Backend writes to RTDB (real-time delivery via WebSocket to foreground clients)
 * + fires FCM push for background/killed app state.
 */

const { admin, getDb } = require("../config/firebase");

const db = getDb();
const { logger } = require("../utils/logger");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getFcmToken = async (userId) => {
  const doc = await db.collection("users").doc(userId).get();
  if (!doc.exists) return null;
  return doc.data().fcmToken || null;
};

const getFcmTokens = async (userIds) => {
  if (!userIds || userIds.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < userIds.length; i += 30) chunks.push(userIds.slice(i, i + 30));

  // Fetch all chunks in parallel
  const snapshots = await Promise.all(
    chunks.map((chunk) =>
      db
        .collection("users")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get()
    )
  );

  const tokens = [];
  snapshots.forEach((snap) => {
    snap.forEach((doc) => {
      const token = doc.data().fcmToken;
      if (token) tokens.push(token);
    });
  });
  return tokens;
};

const removeStaleToken = async (token) => {
  try {
    const snap = await db.collection("users").where("fcmToken", "==", token).limit(1).get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({ fcmToken: admin.firestore.FieldValue.delete() });
    }
  } catch (err) {
    logger.error("[FCM] removeStaleToken error:", err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Send to single token
// ─────────────────────────────────────────────────────────────────────────────
const sendToToken = async (token, notification, data = {}) => {
  if (!token) return;
  try {
    await admin.messaging().send({
      token,
      notification: { title: notification.title, body: notification.body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: "high",
        notification: { sound: "default", channelId: "velvet_messages", priority: "high" },
      },
      apns: {
        payload: { aps: { sound: "default", badge: 1, contentAvailable: true } },
      },
    });
  } catch (err) {
    if (
      err.code === "messaging/registration-token-not-registered" ||
      err.code === "messaging/invalid-registration-token"
    ) {
      await removeStaleToken(token);
    } else {
      logger.error("[FCM] sendToToken error:", err.code || err.message);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Send to multiple tokens (batch)
// ─────────────────────────────────────────────────────────────────────────────
const sendToTokens = async (tokens, notification, data = {}) => {
  if (!tokens || tokens.length === 0) return;

  const uniqueTokens = [...new Set(tokens)].filter(Boolean);
  if (uniqueTokens.length === 0) return;

  // FCM multicast max 500 per call
  const chunks = [];
  for (let i = 0; i < uniqueTokens.length; i += 500) chunks.push(uniqueTokens.slice(i, i + 500));

  for (const chunk of chunks) {
    try {
      const response = await admin.messaging().sendEachForMulticast({
        notification: { title: notification.title, body: notification.body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: {
          priority: "high",
          notification: { sound: "default", channelId: "velvet_messages" },
        },
        apns: {
          payload: { aps: { sound: "default", badge: 1, contentAvailable: true } },
        },
        tokens: chunk,
      });

      const staleTokens = response.responses
        .map((resp, idx) => (!resp.success &&
          (resp.error?.code === "messaging/registration-token-not-registered" ||
           resp.error?.code === "messaging/invalid-registration-token"))
          ? chunk[idx] : null)
        .filter(Boolean);

      if (staleTokens.length > 0) {
        await Promise.all(staleTokens.map(removeStaleToken));
      }
    } catch (err) {
      logger.error("[FCM] sendToTokens error:", err.code || err.message);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Notify new 1-to-1 message
// BUG FIX: was passing senderId: receiverId — now correctly passes senderId
// ─────────────────────────────────────────────────────────────────────────────
const notifyNewMessage = async ({ receiverId, senderId, senderName, message, type, roomId }) => {
  const token = await getFcmToken(receiverId);
  if (!token) return;

  const body =
    type === "text"   ? (message.length > 100 ? message.slice(0, 97) + "..." : message)
    : type === "image"    ? "📷 Photo"
    : type === "video"    ? "🎥 Video"
    : type === "audio"    ? "🎵 Voice message"
    : type === "document" ? "📄 Document"
    : "New message";

  await sendToToken(
    token,
    { title: senderName || "Velvet", body },
    {
      type: "new_message",
      roomId,
      senderId: senderId || "",   // FIX: correct field
    }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Notify new group message
// ─────────────────────────────────────────────────────────────────────────────
const notifyNewGroupMessage = async ({ groupId, groupName, senderName, message, type, memberIds }) => {
  const tokens = await getFcmTokens(memberIds);
  if (tokens.length === 0) return;

  const body =
    type === "text"
      ? `${senderName}: ${message.length > 80 ? message.slice(0, 77) + "..." : message}`
      : `${senderName}: ${type === "image" ? "📷 Photo" : type === "video" ? "🎥 Video" : "New message"}`;

  await sendToTokens(
    tokens,
    { title: groupName || "Velvet Group", body },
    { type: "new_group_message", groupId }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Notify group invitation
// ─────────────────────────────────────────────────────────────────────────────
const notifyGroupInvitation = async ({ inviteeId, inviterName, groupName, groupId }) => {
  const token = await getFcmToken(inviteeId);
  if (!token) return;

  await sendToToken(
    token,
    { title: "Group invitation", body: `${inviterName} invited you to join "${groupName}"` },
    { type: "group_invitation", groupId }
  );
};

module.exports = { notifyNewMessage, notifyNewGroupMessage, notifyGroupInvitation };
