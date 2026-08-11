const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const app = require("./app");
const { ensureFirebaseInitialized } = require("./config/firebase");
const { logger } = require("./utils/logger");

const PORT = process.env.PORT || 3000;

let server;

const startServer = async () => {
  try {
    // ── Production safety guards ──────────────────────────────────────────
    if (process.env.NODE_ENV === "production") {
      const forbidden = ["TEST_PHONE", "TEST_OTP"];
      const leaks = forbidden.filter((key) => process.env[key]);
      if (leaks.length > 0) {
        logger.error(
          `FATAL: Test variables found in production environment: ${leaks.join(", ")}. These allow OTP bypass and are a critical security risk. Remove them from your production environment and restart.`
        );
        process.exit(1);
      }

      const hasServiceAccountJson = !!process.env.FIREBASE_SERVICE_ACCOUNT;
      const hasServiceAccountPath = !!process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const hasInlineServiceAccount =
        !!process.env.FIREBASE_PROJECT_ID &&
        !!process.env.FIREBASE_PRIVATE_KEY &&
        !!process.env.FIREBASE_CLIENT_EMAIL;

      if (!hasServiceAccountJson && !hasServiceAccountPath && !hasInlineServiceAccount) {
        logger.error(
          "FATAL: Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT, FIREBASE_SERVICE_ACCOUNT_PATH, or FIREBASE_PROJECT_ID/FIREBASE_PRIVATE_KEY/FIREBASE_CLIENT_EMAIL."
        );
        process.exit(1);
      }

      if (!process.env.FIREBASE_DATABASE_URL) {
        logger.error("FATAL: FIREBASE_DATABASE_URL is not set. Realtime Database will not work.");
        process.exit(1);
      }

      if (!process.env.FIREBASE_STORAGE_BUCKET) {
        logger.error("FATAL: FIREBASE_STORAGE_BUCKET is not set. File uploads will not work.");
        process.exit(1);
      }

      if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        logger.error("FATAL: JWT_SECRET is missing or too short (minimum 32 characters).");
        process.exit(1);
      }

      if (!process.env.TWO_FACTOR_API_KEY || !process.env.BASE_URL) {
        logger.error("FATAL: OTP configuration is incomplete. Set TWO_FACTOR_API_KEY and BASE_URL.");
        process.exit(1);
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Verify Firebase connection before accepting traffic
    ensureFirebaseInitialized();

    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} — ${process.env.NODE_ENV || "development"}`);
    });
  } catch (err) {
    logger.error("Failed to start server:", err.message);
    logger.error(err.stack);
    process.exit(1);
  }
};

const shutdown = (signal) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      logger.info("HTTP server closed. Exiting.");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced exit after timeout.");
      process.exit(1);
    }, 10_000).unref();
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  process.exit(1);
});

startServer();
