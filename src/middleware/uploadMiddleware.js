const multer = require('multer');
const path = require('path');
const { errorResponse } = require('../utils/apiResponse');

// File filter - only images
const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Storage for profile images
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/profiles'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `profile_${req.user._id}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// Storage for group images
const groupStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/groups'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `group_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// Storage for expense receipts
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/receipts'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `receipt_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const uploadProfile = multer({
  storage: profileStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
}).single('profileImage');

const uploadGroupImage = multer({
  storage: groupStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('groupImage');

const uploadReceipt = multer({
  storage: receiptStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('receipt');

// Wrapper to handle multer errors gracefully
const handleUpload = (uploadFn) => (req, res, next) => {
  uploadFn(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return errorResponse(res, 'File size exceeds 5MB limit', 400);
      }
      return errorResponse(res, err.message, 400);
    } else if (err) {
      return errorResponse(res, err.message, 400);
    }
    next();
  });
};

module.exports = {
  uploadProfile: handleUpload(uploadProfile),
  uploadGroupImage: handleUpload(uploadGroupImage),
  uploadReceipt: handleUpload(uploadReceipt),
};
