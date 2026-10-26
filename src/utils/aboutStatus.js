const emojiSequence = new RegExp(
  "^(?:\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?(?:\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?(?:\\p{Emoji_Modifier})?)*)$",
  "u"
);
const flagSequence = /^\p{Regional_Indicator}{2}$/u;
const keycapSequence = /^[#*0-9]\uFE0F?\u20E3$/u;

const isEmojiOnlyAbout = (value) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;

  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  for (const { segment } of segments) {
    if (/^\s+$/u.test(segment)) continue;
    if (
      !emojiSequence.test(segment) &&
      !flagSequence.test(segment) &&
      !keycapSequence.test(segment)
    ) {
      return false;
    }
  }
  return true;
};

const parseAboutExpiry = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new Error("aboutExpiresAt must be a timezone-qualified ISO 8601 datetime");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("aboutExpiresAt must be a timezone-qualified ISO 8601 datetime");
  }
  if (timestamp <= Date.now()) {
    throw new Error("aboutExpiresAt must be in the future");
  }
  return timestamp;
};

const isAboutStatusActive = (profile, now = Date.now()) => {
  const expiresAt = profile.aboutExpiresAt;
  const hasValidExpiry =
    expiresAt === undefined ||
    expiresAt === null ||
    (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > now);

  return (
    typeof profile.aboutStatus === "string" &&
    profile.aboutStatus.length > 0 &&
    hasValidExpiry
  );
};

module.exports = { isEmojiOnlyAbout, parseAboutExpiry, isAboutStatusActive };
