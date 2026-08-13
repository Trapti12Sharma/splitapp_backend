const multer = require('multer');
const { errorResponse } = require('../utils/apiResponse');
const uploadToCloudinary = require('../utils/uploadToCloudinary');

// Use memory storage — files go to Cloudinary, not disk
const storage = multer.memoryStorage();

// File filter - only images
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Middleware that uploads to Cloudinary after multer parses the file
const uploadAndSave = (fieldName, folder) => async (req, res, next) => {
  const singleUpload = upload.single(fieldName);

  singleUpload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'File size exceeds 5MB limit', 400);
      return errorResponse(res, err.message, 400);
    }
    if (err) return errorResponse(res, err.message, 400);

    // If a file was uploaded, push to Cloudinary
    if (req.file) {
      try {
        const url = await uploadToCloudinary(req.file.buffer, folder);
        req.file.cloudinaryUrl = url;
      } catch (uploadErr) {
        console.error('Cloudinary upload failed:', uploadErr.message);
        return errorResponse(res, 'Image upload failed. Please try again.', 500);
      }
    }

    next();
  });
};

const uploadProfile = uploadAndSave('profileImage', 'splitapp/profiles');
const uploadGroupImage = uploadAndSave('groupImage', 'splitapp/groups');
const uploadReceipt = uploadAndSave('receipt', 'splitapp/receipts');

module.exports = { uploadProfile, uploadGroupImage, uploadReceipt };
