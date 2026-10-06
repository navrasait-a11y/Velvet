const axios = require("axios");
const { randomInt, randomUUID } = require("crypto");
const { formatPhone, stripCountryCode } = require("../utils/phoneFormatter");

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 15 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 4;

const sessions = new Map();
const activeSessionsByPhone = new Map();
const lastOtpRequestByPhone = new Map();

const removeSession = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  clearTimeout(session.expiryTimer);
  if (activeSessionsByPhone.get(session.phone) === sessionId) {
    activeSessionsByPhone.delete(session.phone);
  }
};

const reserveOtpRequest = (phone) => {
  const formattedPhone = formatPhone(phone);
  const now = Date.now();

  for (const [requestedPhone, requestedAt] of lastOtpRequestByPhone) {
    if (now - requestedAt >= RESEND_COOLDOWN_MS) {
      lastOtpRequestByPhone.delete(requestedPhone);
    }
  }

  const lastRequestAt = lastOtpRequestByPhone.get(formattedPhone);

  if (lastRequestAt !== undefined && now - lastRequestAt < RESEND_COOLDOWN_MS) {
    const error = new Error("Please wait 15 seconds before requesting another OTP.");
    error.status = 429;
    throw error;
  }

  lastOtpRequestByPhone.set(formattedPhone, now);
};

const sendOtp = async (phone) => {
  const formattedPhone = formatPhone(phone);
  const apiKey = process.env.APITXT_API_KEY;
  if (!apiKey) {
    throw new Error("APITXT_API_KEY is not configured.");
  }
  reserveOtpRequest(formattedPhone);

  const otp = String(randomInt(0, 10_000)).padStart(4, "0");
  const sessionId = randomUUID();
  const previousSessionId = activeSessionsByPhone.get(formattedPhone);
  const session = {
    phone: formattedPhone,
    otp,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  };

  sessions.set(sessionId, session);
  session.expiryTimer = setTimeout(() => removeSession(sessionId), OTP_TTL_MS);
  session.expiryTimer.unref();

  const baseUrl = (process.env.APITXT_BASE_URL || "https://apitxt.com").replace(/\/+$/, "");
  const endpoint = (process.env.APITXT_OTP_ENDPOINT || "/api/sendOTP").replace(/^\/+/, "");
  const url = `${baseUrl}/${endpoint}`;
  const params = new URLSearchParams({
    authkey: apiKey,
    mobile: stripCountryCode(formattedPhone),
    otp,
    channel: "sms",
  });
  if (process.env.APITXT_TEMPLATE_ID) {
    params.set("template_id", process.env.APITXT_TEMPLATE_ID);
  }

  try {
    await axios.post(url, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 8000,
    });
  } catch (error) {
    removeSession(sessionId);
    throw error;
  }

  if (previousSessionId) {
    removeSession(previousSessionId);
  }
  activeSessionsByPhone.set(formattedPhone, sessionId);

  return sessionId;
};

const verifyOtp = async (sessionId, otp, phone) => {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TEST_OTP &&
    otp === process.env.TEST_OTP
  ) {
    return true;
  }

  const formattedPhone = formatPhone(phone);
  const session = sessions.get(sessionId);

  if (!session || session.phone !== formattedPhone) {
    throw new Error("OTP session is invalid or has expired.");
  }

  if (Date.now() >= session.expiresAt) {
    removeSession(sessionId);
    throw new Error("OTP session is invalid or has expired.");
  }

  if (otp !== session.otp) {
    session.attempts += 1;
    if (session.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      removeSession(sessionId);
    }
    throw new Error("OTP verification failed.");
  }

  removeSession(sessionId);
  return true;
};

module.exports = { sendOtp, verifyOtp, reserveOtpRequest };
