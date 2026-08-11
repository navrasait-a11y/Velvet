const timeoutMiddleware = (ms = 30000) => (req, res, next) => {
  res.setTimeout(ms, () => {
    if (!res.headersSent) {
      res.status(503).json({ success: false, message: "Request timeout. Please try again." });
    }
  });
  next();
};

module.exports = { timeoutMiddleware };
