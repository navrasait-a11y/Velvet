const sanitize = (req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === "string") {
        req.body[key] = req.body[key].trim().replace(/[<>]/g, "");
      } else if (Array.isArray(req.body[key])) {
        req.body[key] = req.body[key].map((item) =>
          typeof item === "string" ? item.trim().replace(/[<>]/g, "") : item
        );
      }
    }
  }
  next();
};

module.exports = { sanitize };
