const multer = require("multer");
const path = require("path");
const { verifyFileContent, detectMimeType } = require("../utils/fileSignature");

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg"];

const ALLOWED_CHAT_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
  ...ALLOWED_AUDIO_TYPES,
  ...ALLOWED_VIDEO_TYPES,
];

const EXTENSION_TO_MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mpeg": "audio/mpeg", ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".csv": "text/csv",
};

const PROFILE_IMAGE_LIMIT = 5 * 1024 * 1024;
const CHAT_FILE_LIMIT = 50 * 1024 * 1024;
const GROUP_IMAGE_LIMIT = 5 * 1024 * 1024;

const storage = multer.memoryStorage();

const inferMimeType = (file, allowedTypes) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const inferredFromExt = EXTENSION_TO_MIME[ext];
  if (inferredFromExt && allowedTypes.includes(inferredFromExt)) {
    return inferredFromExt;
  }
  if (file.buffer) {
    const detected = detectMimeType(file.buffer);
    if (detected && allowedTypes.includes(detected)) {
      return detected;
    }
  }
  return null;
};

const makeFileFilter = (allowedTypes) => (req, file, cb) => {
  let mimeType = file.mimetype;

  if (mimeType === "application/octet-stream" || !mimeType || mimeType === "") {
    const inferred = inferMimeType(file, allowedTypes);
    if (inferred) {
      mimeType = inferred;
      file.mimetype = inferred;
    } else {
      return cb(
        Object.assign(new Error(`File type not allowed: ${file.mimetype}`), { status: 400 }),
        false
      );
    }
  }

  if (!allowedTypes.includes(mimeType)) {
    return cb(
      Object.assign(new Error(`File type not allowed: ${mimeType}`), { status: 400 }),
      false
    );
  }

  const ext = path.extname(file.originalname);
  if (file.originalname.includes("..") || ext.includes("/") || ext.includes("\\")) {
    return cb(
      Object.assign(new Error("Invalid filename"), { status: 400 }),
      false
    );
  }

  if (file.buffer && !verifyFileContent(file, mimeType)) {
    return cb(
      Object.assign(new Error("File content does not match its type"), { status: 400 }),
      false
    );
  }

  cb(null, true);
};

// Profile images only
const profileUpload = multer({
  storage,
  limits: { fileSize: PROFILE_IMAGE_LIMIT },
  fileFilter: makeFileFilter(ALLOWED_IMAGE_TYPES),
});

// Group images only
const groupUpload = multer({
  storage,
  limits: { fileSize: GROUP_IMAGE_LIMIT },
  fileFilter: makeFileFilter(ALLOWED_IMAGE_TYPES),
});

// Chat files — images, docs, audio, video
const chatUpload = multer({
  storage,
  limits: { fileSize: CHAT_FILE_LIMIT },
  fileFilter: makeFileFilter(ALLOWED_CHAT_TYPES),
});

// Exported middleware
const uploadProfileFields = profileUpload.fields([
  { name: "profileImage", maxCount: 1 },
  { name: "bannerImage", maxCount: 1 },
]);

const uploadGroupProfileFields = groupUpload.fields([
  { name: "groupImage", maxCount: 1 },
  { name: "backgroundImage", maxCount: 1 },
]);

const uploadSingleFile = chatUpload.single("file");

// Error handler middleware for multer errors — must be used after upload middleware
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: "File too large" });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err && err.status === 400) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
};

module.exports = {
  uploadProfileFields,
  uploadSingleFile,
  uploadGroupProfileFields,
  handleUploadError,
};
