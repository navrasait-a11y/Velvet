const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const authMiddleware = require("./middleware/auth.middleware");
const { requestId } = require("./middleware/requestId");
const { timeoutMiddleware } = require("./middleware/timeout");
const { sanitize } = require("./middleware/sanitize");
const { logger } = require("./utils/logger");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const chatRoutes = require("./routes/chat.routes");
const blockRoutes = require("./routes/block.routes");
const chatOptionRoutes = require("./routes/chatOption.routes");
const privateChatRoutes = require("./routes/privateChat.routes");
const groupChatRoutes = require("./routes/group.routes");
const taskRoutes = require("./routes/task.routes");
const reportRoutes = require("./routes/report.routes");
const presenceRoutes = require("./routes/presence.routes");

const app = express();

// Trust proxy only in production (prevents X-Forwarded-For spoofing in dev)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Request ID for tracing
app.use(requestId);

// Security headers with production hardening
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://firebaseapp.com", "https://*.firebaseio.com", "https://*.googleapis.com", "https://*.gstatic.com"],
        fontSrc: ["'self'", "data:", "https:", "fonts.gstatic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "data:", "https:", "blob:"],
        frameSrc: ["'none'"],
      },
      reportOnly: process.env.NODE_ENV !== "production",
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    permissionsPolicy: {
      features: {
        geolocation: ["'self'"],
        microphone: ["'self'"],
        camera: ["'self'"],
      },
    },
  })
);

const normalizeOrigin = (origin) => origin?.trim().replace(/\/$/, "");

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(normalizeOrigin).filter(Boolean)
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      if (allowedOrigins.includes(normalizeOrigin(origin))) {
        return callback(null, true);
      }
      callback(Object.assign(new Error("Not allowed by CORS"), { status: 403 }));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86400,
    credentials: true,
  })
);

// HTTP request logging
if (process.env.NODE_ENV !== "test") {
  app.use(
    morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
      skip: (req) => req.url === "/health",
    })
  );
}

// Response compression
app.use(compression());

// Timeout middleware - prevents hung requests
app.use(timeoutMiddleware(30000));

app.use(express.json({ limit: "5mb", strict: true }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Input sanitization - strips angle brackets and trims parsed request fields
app.use(sanitize);

const isProduction = process.env.NODE_ENV === "production";

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 1000 : 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});
app.use(globalLimiter);

// Message rate limiter - prevents spam (keyed by user ID)
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 30 : 100,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req),
  message: { success: false, message: "Too many messages. Please slow down." },
});

// OTP rate limiter — keyed by phone number + IP fallback
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isProduction ? 5 : 20,
  keyGenerator: (req) => {
    if (req.body?.phone) return `phone:${req.body.phone}:${ipKeyGenerator(req)}`;
    return ipKeyGenerator(req);
  },
  message: { success: false, message: "Too many OTP requests. Please wait before retrying." },
});

app.use("/api/auth/send-otp", otpLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/chat", authMiddleware, messageLimiter, chatRoutes);
app.use("/api/block", blockRoutes);
app.use("/api/options", chatOptionRoutes);
app.use("/api/privateChat", authMiddleware, messageLimiter, privateChatRoutes);
app.use("/api/groupChat", authMiddleware, messageLimiter, groupChatRoutes);
app.use("/api/groupChat", authMiddleware, messageLimiter, taskRoutes);
app.use("/api/report", reportRoutes);
app.use("/api/presence", presenceRoutes);

app.get("/health", (_, res) =>
  res.status(200).json({ success: true, service: "Velvet Backend", status: "ok", timestamp: Date.now() })
);

// 404 handler
app.use((req, res) =>
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` })
);

// Global error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const isOperational = err.isOperational;

  if (!isOperational && isProduction) {
    logger.error("[UNEXPECTED ERROR]", err);
  }

  const message =
    isProduction && status === 500 && !isOperational
      ? "Internal server error"
      : err.message || "Something went wrong";

  if (!res.headersSent) {
    res.status(status).json({
      success: false,
      message,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  }
});

module.exports = app;
