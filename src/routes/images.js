const express = require('express');
const router = express.Router();
const {
    updateProductImage,
    updateCategoryImage,
    deleteProductImage,
    deleteCategoryImage
} = require('../controllers/imageController');
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Product image routes
router.put('/product/:id', protect, admin, upload.single('image'), updateProductImage);
router.delete('/product/:id', protect, admin, deleteProductImage);

// Category image routes
router.put('/category/:id', protect, admin, upload.single('image'), updateCategoryImage);
router.delete('/category/:id', protect, admin, deleteCategoryImage);

module.exports = router;
