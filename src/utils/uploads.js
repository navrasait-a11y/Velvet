const path = require("path");
const crypto = require("crypto");
const { getBucket } = require("../config/firebase");

const getFileType = (mimeType = "") => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  const documentTypes = [
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv",
  ];
  if (documentTypes.includes(mimeType)) return "document";
  return "file";
};

/**
 * Upload a file to GCS.
 * Files are stored with a random UUID name to prevent enumeration.
 * Signed URLs are generated (1 hour) for access — no world-public files.
 *
 * For profile images and group images which need to be permanently accessible,
 * folder = "public/..." can opt-in to makePublic.
 */
const uploadFile = async (file, folder = "general", makePublic = false) => {
  if (!file) return null;

  const bucket = getBucket();

  const extension = path.extname(file.originalname).toLowerCase();

  // Use a random UUID as filename — prevents enumeration and path traversal
  const randomName = crypto.randomBytes(16).toString("hex");
  const fileName = `${folder}/${randomName}${extension}`;

  const blob = bucket.file(fileName);

  await blob.save(file.buffer, {
    metadata: { contentType: file.mimetype },
  });

  let url;

  if (makePublic) {
    // Profile images / group images — permanently public
    await blob.makePublic();
    url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
  } else {
    // Chat files — signed URL valid 7 days (sufficient for chat history)
    const [signedUrl] = await blob.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    url = signedUrl;
  }

  return {
    url,
    storagePath: fileName,
    mimeType: file.mimetype,
    fileType: getFileType(file.mimetype),
    size: file.size,
  };
};

/**
 * Upload a profile/group image — these are intentionally public
 */
const uploadPublicImage = async (file, folder = "profiles") => {
  return uploadFile(file, folder, true);
};

module.exports = { uploadFile, uploadPublicImage, getFileType };
