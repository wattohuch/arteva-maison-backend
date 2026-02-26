/**
 * Cloudinary Configuration & Helpers
 * Handles image upload/delete for persistent cloud storage
 */

const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload a buffer to Cloudinary
 * @param {Buffer} buffer - Image file buffer
 * @param {string} folder - Cloudinary folder (e.g., 'products', 'categories')
 * @param {string} [publicId] - Optional custom public ID
 * @returns {Promise<{url: string, publicId: string}>}
 */
async function uploadToCloudinary(buffer, folder = 'products', publicId = null) {
    return new Promise((resolve, reject) => {
        const options = {
            folder: `arteva/${folder}`,
            resource_type: 'image',
            quality: 'auto',
            fetch_format: 'auto'
        };

        if (publicId) {
            options.public_id = publicId;
            options.overwrite = true;
        }

        const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) {
                console.error('❌ Cloudinary upload error:', error.message);
                reject(error);
            } else {
                resolve({
                    url: result.secure_url,
                    publicId: result.public_id
                });
            }
        });

        stream.end(buffer);
    });
}

/**
 * Upload a local file path to Cloudinary
 * @param {string} filePath - Absolute path to local file
 * @param {string} folder - Cloudinary folder
 * @param {string} [publicId] - Optional custom public ID
 * @returns {Promise<{url: string, publicId: string}>}
 */
async function uploadFileToCloudinary(filePath, folder = 'products', publicId = null) {
    const options = {
        folder: `arteva/${folder}`,
        resource_type: 'image',
        quality: 'auto',
        fetch_format: 'auto'
    };

    if (publicId) {
        options.public_id = publicId;
        options.overwrite = true;
    }

    const result = await cloudinary.uploader.upload(filePath, options);
    return {
        url: result.secure_url,
        publicId: result.public_id
    };
}

/**
 * Delete an image from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<boolean>}
 */
async function deleteFromCloudinary(publicId) {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result.result === 'ok';
    } catch (error) {
        console.error('❌ Cloudinary delete error:', error.message);
        return false;
    }
}

/**
 * Extract public ID from a Cloudinary URL
 */
function getPublicIdFromUrl(url) {
    if (!url || !url.includes('cloudinary.com')) return null;
    // URL format: https://res.cloudinary.com/cloud/image/upload/v123/arteva/products/filename.ext
    const match = url.match(/\/upload\/(?:v\d+\/)?(arteva\/.+?)(?:\.[a-z]+)?$/i);
    return match ? match[1] : null;
}

module.exports = {
    cloudinary,
    uploadToCloudinary,
    uploadFileToCloudinary,
    deleteFromCloudinary,
    getPublicIdFromUrl
};
