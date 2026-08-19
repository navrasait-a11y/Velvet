const bcrypt = require("bcrypt");
const { getDb } = require("../config/firebase");

// bcrypt cost factor — 12 is the production-safe minimum (2^12 = 4096 rounds)
// 10 is too fast on modern hardware making brute-force cheaper
const BCRYPT_ROUNDS = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Setup Private Chat Password
// ─────────────────────────────────────────────────────────────────────────────
exports.setupPrivateChat = async (userId, password) => {
  const db = getDb();
  const docRef = db.collection("Users_Private_Settings").doc(userId);
  const doc = await docRef.get();

  if (doc.exists) {
    throw new Error("Private chat password already exists");
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await docRef.set({
    enabled: true,
    password: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Verify Password
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyPrivateChat = async (userId, password) => {
  const db = getDb();
  const doc = await db.collection("Users_Private_Settings").doc(userId).get();

  if (!doc.exists) {
    throw new Error("Private chat is not enabled");
  }

  const matched = await bcrypt.compare(password, doc.data().password);

  if (!matched) {
    throw new Error("Invalid password");
  }

  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// Change Password
// ─────────────────────────────────────────────────────────────────────────────
exports.changePrivateChatPassword = async (userId, oldPassword, newPassword) => {
  const db = getDb();
  const ref = db.collection("Users_Private_Settings").doc(userId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error("Private chat is not enabled");
  }

  const matched = await bcrypt.compare(oldPassword, doc.data().password);

  if (!matched) {
    throw new Error("Old password is incorrect");
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await ref.update({
    password: hash,
    updatedAt: Date.now(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Remove Password (disable private chat)
// ─────────────────────────────────────────────────────────────────────────────
exports.removePrivateChatPassword = async (userId, password) => {
  const db = getDb();
  const ref = db.collection("Users_Private_Settings").doc(userId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error("Private chat is not enabled");
  }

  const matched = await bcrypt.compare(password, doc.data().password);

  if (!matched) {
    throw new Error("Invalid password");
  }

  await ref.delete();
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Status
// ─────────────────────────────────────────────────────────────────────────────
exports.getPrivateChatStatus = async (userId) => {
  const db = getDb();
  const doc = await db.collection("Users_Private_Settings").doc(userId).get();
  return doc.exists;
};
