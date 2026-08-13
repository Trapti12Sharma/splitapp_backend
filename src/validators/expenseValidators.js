const { body, validationResult } = require('express-validator');
const { errorResponse } = require('../utils/apiResponse');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return errorResponse(res, 'Validation failed', 400, errors.array().map(e => e.msg));
  }
  next();
};

const expenseValidators = [
  body('description')
    .trim()
    .notEmpty().withMessage('Description is required')
    .isLength({ max: 200 }).withMessage('Description cannot exceed 200 characters'),

  body('amount')
    .notEmpty().withMessage('Amount is required')
    .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),

  body('currency')
    .optional()
    .isIn(['INR', 'USD', 'EUR', 'GBP']).withMessage('Invalid currency'),

  body('splitType')
    .notEmpty().withMessage('Split type is required')
    .isIn(['equal', 'exact', 'percentage', 'shares']).withMessage('Invalid split type'),

  body('paidBy')
    .notEmpty().withMessage('PaidBy is required')
    .isMongoId().withMessage('Invalid paidBy user ID'),

  body('splits')
    .custom((value) => {
      // splits can be a JSON string (from FormData) or an array
      if (typeof value === 'string') {
        try { JSON.parse(value) } catch { throw new Error('splits must be a valid JSON array') }
        return true;
      }
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error('At least one split participant is required');
      }
      return true;
    }),

  body('category')
    .optional()
    .isIn(['Food', 'Travel', 'Shopping', 'Entertainment', 'Bills', 'Rent', 'Utilities', 'Health', 'Groceries', 'Transport', 'Other'])
    .withMessage('Invalid category'),

  body('date')
    .optional()
    .isISO8601().withMessage('Invalid date format'),

  handleValidationErrors,
];

module.exports = { expenseValidators, handleValidationErrors };
