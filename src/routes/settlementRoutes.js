const express = require('express');
const router = express.Router();
const { getSettlements, createSettlement, getSettlementById } = require('../controllers/settlementController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getSettlements);
router.post('/', protect, createSettlement);
router.get('/:id', protect, getSettlementById);

module.exports = router;
