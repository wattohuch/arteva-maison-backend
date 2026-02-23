const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const productUploadDir = path.join(__dirname, '../../../assets/images/products');
const categoryUploadDir = path.join(__dirname, '../../../assets/images/categories');

if (!fs.existsSync(productUploadDir)) {
    fs.mkdirSync(productUploadDir, { recursive: true });
}
if (!fs.existsSync(categoryUploadDir)) {
    fs.mkdirSync(categoryUploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Determine upload directory based on route
        const uploadDir = req.path.includes('category') ? categoryUploadDir : productUploadDir;
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Create unique filename: [type]-[timestamp]-[random].ext
        const prefix = req.path.includes('category') ? 'category' : 'product';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, prefix + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter (images only)
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Not an image! Please upload only images.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: fileFilter
});

module.exports = upload;
