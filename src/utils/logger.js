const isProduction = process.env.NODE_ENV === "production";

const timestamp = () => new Date().toISOString();

const logger = {
  // info logs are always shown — server start, graceful shutdown etc.
  // Suppressing them in production was hiding critical operational events.
  info: (...args) => {
    console.log(`[INFO] ${timestamp()}`, ...args);
  },
  error: (...args) => {
    console.error(`[ERROR] ${timestamp()}`, ...args);
  },
  warn: (...args) => {
    console.warn(`[WARN] ${timestamp()}`, ...args);
  },
  // debug only in non-production to avoid log noise
  debug: (...args) => {
    if (!isProduction) console.debug(`[DEBUG] ${timestamp()}`, ...args);
  },
};

module.exports = { logger };
