const crypto = require("crypto");

/**
 * Generates a cryptographically secure random user ID.
 * Uses crypto.randomBytes for security instead of Math.random().
 * @param {number} length - Desired ID length (default 28)
 * @returns {string} Random alphanumeric ID
 */
const generateUserId = (length = 28) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
};

module.exports = { generateUserId };