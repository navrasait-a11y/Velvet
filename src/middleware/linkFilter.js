const { logger } = require("../utils/logger");

const BLACKLISTED_DOMAINS = new Set([
  "phishing-site.com",
  "free-iphone-winner.com",
  "click-here-to-win.net",
  "malware-download.xyz",
  "virus-test.ru",
]);

const SUSPICIOUS_TLDS = [".tk", ".ml", ".ga", ".cf", ".gq"];

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const IP_URL_REGEX = /https?:\/\/\d{1,3}(\.\d{1,3}){3}/i;

const extractHostname = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const analyzeUrl = (url) => {
  if (IP_URL_REGEX.test(url)) {
    return { blocked: true, reason: "IP-based URLs are not allowed" };
  }
  const hostname = extractHostname(url);
  if (!hostname) return { blocked: false };
  if (BLACKLISTED_DOMAINS.has(hostname)) {
    return { blocked: true, reason: "This link has been flagged as unsafe" };
  }
  for (const tld of SUSPICIOUS_TLDS) {
    if (hostname.endsWith(tld)) {
      return { blocked: true, reason: "Links with this domain extension are not allowed" };
    }
  }
  return { blocked: false };
};

const checkUrls = (text) => {
  if (!text || typeof text !== "string") return null;
  const urls = text.match(URL_REGEX) || [];
  for (const url of urls) {
    const result = analyzeUrl(url);
    if (result.blocked) return result.reason;
  }
  return null;
};

const linkFilter = (req, res, next) => {
  try {
    const { message } = req.body || {};
    const type = req.body?.type || "text";

    if (type === "text" && message) {
      const blocked = checkUrls(message);
      if (blocked) {
        return res.status(400).json({ success: false, message: blocked });
      }
    }

    if (type === "location" && req.body.maplink) {
      const blocked = checkUrls(req.body.maplink);
      if (blocked) {
        return res.status(400).json({ success: false, message: blocked });
      }
    }

    next();
  } catch (err) {
    logger.error("[LinkFilter] error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Unable to validate message",
    });
  }
};

module.exports = linkFilter;
