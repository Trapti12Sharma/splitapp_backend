const multer = require('multer');
const { errorResponse } = require('../utils/apiResponse');

// Use memory storage
const storage = multer.memoryStorage();

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
]);

const imageFilter = (req, file, cb) => {
  // `image/*` alone also lets through formats Cloudinary will reject (e.g. SVG,
  // which is an XSS vector when served inline). Allow a known-good list instead.
  if (ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported image type. Use JPG, PNG, WEBP, GIF, HEIC or AVIF.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    // Cap non-file fields too, so a multipart body cannot be used to blow up memory.
    fields: 30,
    fieldSize: 1024 * 1024,
  },
});

// Check if Cloudinary is configured
const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

const uploadAndSave = (fieldName, folder) => async (req, res, next) => {
  const singleUpload = upload.single(fieldName);

  singleUpload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'File too large (max 5MB)', 400);
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return errorResponse(res, `Unexpected file field. Expected "${fieldName}".`, 400);
      }
      return errorResponse(res, err.message, 400);
    }
    if (err) return errorResponse(res, err.message, 400);

    // No file on the request is normal — these fields are all optional.
    if (!req.file) return next();

    if (!isCloudinaryConfigured()) {
      // Previously this silently dropped the image and reported success, so the
      // user saw "Profile updated" with no photo and no explanation. Say so.
      console.error('Image upload attempted but Cloudinary is not configured');
      return errorResponse(
        res,
        'Image uploads are not configured on the server. Please contact support.',
        503
      );
    }

    try {
      const uploadToCloudinary = require('../utils/uploadToCloudinary');
      const url = await uploadToCloudinary(req.file.buffer, folder);
      if (!url) throw new Error('Upload returned no URL');
      req.file.cloudinaryUrl = url;
      // Release the buffer once it is uploaded — holding 5MB per in-flight
      // request adds up quickly under concurrency.
      req.file.buffer = undefined;
      return next();
    } catch (uploadErr) {
      console.error('Cloudinary upload failed:', uploadErr.message);
      return errorResponse(res, 'Image upload failed. Please try again.', 502);
    }
  });
};

const uploadProfile = uploadAndSave('profileImage', 'splitapp/profiles');
const uploadGroupImage = uploadAndSave('groupImage', 'splitapp/groups');
const uploadReceipt = uploadAndSave('receipt', 'splitapp/receipts');

module.exports = { uploadProfile, uploadGroupImage, uploadReceipt, isCloudinaryConfigured };
