const { body } = require('express-validator');
const { handleValidationErrors } = require('./authValidators');

const groupValidators = [
  body('name')
    .trim()
    .notEmpty().withMessage('Group name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Group name must be 2–100 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),

  handleValidationErrors,
];

module.exports = { groupValidators };
