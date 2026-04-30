const express = require('express');
const router = express.Router();
const {
    getHeroSlides,
    getAllHeroSlides,
    createHeroSlide,
    updateHeroSlide,
    deleteHeroSlide,
    reorderHeroSlides
} = require('../controllers/heroController');
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Public route — homepage fetches active slides
router.get('/', getHeroSlides);

// Admin routes
router.get('/all', protect, admin, getAllHeroSlides);
router.post('/', protect, admin, upload.single('image'), createHeroSlide);
router.put('/reorder', protect, admin, reorderHeroSlides);
router.put('/:id', protect, admin, upload.single('image'), updateHeroSlide);
router.delete('/:id', protect, admin, deleteHeroSlide);

module.exports = router;
