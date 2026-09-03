const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');

/**
 * Upload a file buffer to Cloudinary
 */
const uploadToCloudinary = (buffer, folder = 'splitapp') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 800, height: 800, crop: 'limit', quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

module.exports = uploadToCloudinary;
