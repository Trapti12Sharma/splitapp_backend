const multer = require('multer');
const { errorResponse } = require('../utils/apiResponse');

// Use memory storage
const storage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Check if Cloudinary is configured
const isCloudinaryConfigured = () =>
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

const uploadAndSave = (fieldName, folder) => async (req, res, next) => {
  const singleUpload = upload.single(fieldName);

  singleUpload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'File too large (max 5MB)', 400);
      return errorResponse(res, err.message, 400);
    }
    if (err) return errorResponse(res, err.message, 400);

    // Only upload to Cloudinary if a file was provided AND Cloudinary is configured
    if (req.file) {
      if (!isCloudinaryConfigured()) {
        // Cloudinary not configured — skip upload, no image will be saved
        console.warn('Cloudinary not configured — skipping image upload');
        req.file = null;
        return next();
      }

      try {
        const uploadToCloudinary = require('../utils/uploadToCloudinary');
        const url = await uploadToCloudinary(req.file.buffer, folder);
        req.file.cloudinaryUrl = url;
      } catch (uploadErr) {
        console.error('Cloudinary upload failed:', uploadErr.message);
        // Non-blocking for profile/group images — continue without image
        // For receipts this is also acceptable
        req.file = null;
      }
    }

    next();
  });
};

const uploadProfile = uploadAndSave('profileImage', 'splitapp/profiles');
const uploadGroupImage = uploadAndSave('groupImage', 'splitapp/groups');
const uploadReceipt = uploadAndSave('receipt', 'splitapp/receipts');

module.exports = { uploadProfile, uploadGroupImage, uploadReceipt };
