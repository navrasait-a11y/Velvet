const isProduction = process.env.NODE_ENV === "production";

const logger = {
  info: (...args) => {
    if (!isProduction) console.log("[INFO]", ...args);
  },
  error: (...args) => {
    console.error("[ERROR]", ...args);
  },
  warn: (...args) => {
    console.warn("[WARN]", ...args);
  },
  debug: (...args) => {
    if (!isProduction) console.debug("[DEBUG]", ...args);
  },
};

module.exports = { logger };
