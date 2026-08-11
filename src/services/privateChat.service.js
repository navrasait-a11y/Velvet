const bcrypt = require("bcrypt");
const { getDb, getRealtimeDb } = require("../config/firebase");
const db = getDb();
const rtdb = getRealtimeDb();

// Setup Password
exports.setupPrivateChat = async (userId, password) => {

  const docRef = db.collection("Users_Private_Settings").doc(userId);

  const doc = await docRef.get();

  if (doc.exists) {
    throw new Error("Private chat password already exists");
  }

  const hash = await bcrypt.hash(password, 10);

  await docRef.set({
    enabled: true,
    password: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

};

// Verify Password
exports.verifyPrivateChat = async (userId, password) => {

  const doc = await db.collection("Users_Private_Settings").doc(userId).get();

  if (!doc.exists) {
    throw new Error("Private chat is not enabled");
  }

  const data = doc.data();

  const matched = await bcrypt.compare(
    password,
    data.password
  );

  if (!matched) {
    throw new Error("Invalid password");
  }

  return true;
};

// Change Password
exports.changePrivateChatPassword = async (
  userId,
  oldPassword,
  newPassword
) => {

  const ref = db.collection("Users_Private_Settings").doc(userId);

  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error("Private chat is not enabled");
  }

  const data = doc.data();

  const matched = await bcrypt.compare(
    oldPassword,
    data.password
  );

  if (!matched) {
    throw new Error("Old password is incorrect");
  }

  const hash = await bcrypt.hash(
    newPassword,
    10
  );

  await ref.update({
    password: hash,
    updatedAt: Date.now(),
  });

};

// Remove Password
exports.removePrivateChatPassword = async (
  userId,
  password
) => {

  const ref = db.collection("Users_Private_Settings").doc(userId);

  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error("Private chat is not enabled");
  }

  const data = doc.data();

  const matched = await bcrypt.compare(
    password,
    data.password
  );

  if (!matched) {
    throw new Error("Invalid password");
  }

  await ref.delete();

};

exports.getPrivateChatStatus = async (userId) => {
  const doc = await db.collection("Users_Private_Settings").doc(userId).get();
  return doc.exists;
};