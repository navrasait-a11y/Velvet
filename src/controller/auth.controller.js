const jwt = require("jsonwebtoken");
const { getDb } = require("../config/firebase");
const { validationResult } = require("express-validator");
const { sendOtp, verifyOtp, reserveOtpRequest } = require("../services/otp.service");
const { findOrCreateUser, findUserByPhone } = require("../services/user.service");
const { formatPhone } = require("../utils/phoneFormatter");
const { setOffline } = require("../services/presence.service");
const { admin } = require("../config/firebase");
const { logger } = require("../utils/logger");

// ─────────────────────────────────────────────────────────────────────────────
// Send OTP
// ─────────────────────────────────────────────────────────────────────────────
const sendOtpHandler = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const phone = formatPhone(req.body.phone);

    // Test bypass — ONLY allowed in non-production environments
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.TEST_PHONE &&
      phone === process.env.TEST_PHONE
    ) {
      reserveOtpRequest(phone);
      return res.status(200).json({
        success: true,
        sessionId: "test-session-id-velvet-dev-only",
      });
    }

    const sessionId = await sendOtp(phone);
    return res.status(200).json({ success: true, sessionId });
  } catch (err) {
    return res.status(err.status === 429 ? 429 : 400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Save FCM token after login
// ─────────────────────────────────────────────────────────────────────────────
const saveFcmToken = async (userId, fcmToken) => {
  if (!fcmToken || !userId) return;

  try {
    const db = getDb();
    await db.collection("users").doc(userId).set(
      { fcmToken, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (err) {
    // Non-fatal — log and continue
    logger.error("[FCM] saveFcmToken error:", err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sign JWT
// ─────────────────────────────────────────────────────────────────────────────
const signToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Verify OTP + Login / Register
// ─────────────────────────────────────────────────────────────────────────────
const verifyUserOtp = async (req, res) => {
  // Validate inputs
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const { phone, sessionId, otp, fcmToken } = req.body;

    if (!phone || !sessionId || !otp) {
      return res.status(400).json({
        success: false,
        message: "phone, sessionId, and otp are required",
      });
    }

    const formattedPhone = formatPhone(phone);

    await verifyOtp(sessionId, otp, formattedPhone);

    const existingUser = await findUserByPhone(formattedPhone);
    if (existingUser) {
      await saveFcmToken(existingUser.userId, fcmToken);
      return res.status(200).json({
        success: true,
        userId: existingUser.userId,
        token: signToken(existingUser.userId),
        isNewUser: false,
      });
    }

    const { userId } = await findOrCreateUser(formattedPhone);
    await saveFcmToken(userId, fcmToken);

    return res.status(201).json({
      success: true,
      userId,
      token: signToken(userId),
      isNewUser: true,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Logout
// JWT is stateless — the real logout work is:
//   1. Clear FCM token → stop push notifications on this device
//   2. Set presence offline → stop showing "Online" in chat
//   3. Client deletes the JWT from storage (client responsibility)
// ─────────────────────────────────────────────────────────────────────────────
const logout = async (req, res) => {
  const userId = req.user.userId;

  try {
    const db = getDb();

    // 1. Remove FCM token for this device
    await db.collection("users").doc(userId).update({
      fcmToken: admin.firestore.FieldValue.delete(),
      updatedAt: new Date().toISOString(),
    });

    // 2. Set presence offline
    await setOffline(userId);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    logger.error("[Logout] error:", err.message);
    // Still return success — client should delete token regardless
    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  }
};

module.exports = { saveFcmToken, sendOtpHandler, verifyUserOtp, logout };
