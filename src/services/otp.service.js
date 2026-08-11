const axios = require("axios");
const { stripCountryCode } = require("../utils/phoneFormatter");
/**
 * Sends an OTP to the given phone number via 2Factor API.
 * @param {string} phone - Formatted phone: "91XXXXXXXXXX"
 * @returns {string} sessionId returned by 2Factor
 */
const sendOtp = async (phone) => {
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const localPhone = stripCountryCode(phone); // 10-digit for 2Factor

  const url = `${process.env.BASE_URL}/${apiKey}/VOICE/${localPhone}/AUTOGEN`;

  const { data } = await axios.get(url, { timeout: 8000 });

  if (data.Status !== "Success") {
    throw new Error(data.Details || "Failed to send OTP");
  }

  return data.Details; 
};

/**
 * Verifies the OTP against 2Factor API.
 * @param {string} sessionId - Session ID from sendOtp
 * @param {string} otp - OTP entered by user
 * @returns {boolean} true if verified
 */
const verifyOtp = async (sessionId, otp) => {
  // Test bypass — ONLY allowed in non-production environments
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TEST_OTP &&
    otp === process.env.TEST_OTP
  ) {
    return true;
  }

  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const url = `${process.env.BASE_URL}/${apiKey}/VOICE/VERIFY/${sessionId}/${otp}`;
  const { data } = await axios.get(url, { timeout: 8000 });

  if (data.Status !== "Success") {
    throw new Error(data.Details || "OTP verification failed");
  }

  return true;
};

module.exports = { sendOtp, verifyOtp };
