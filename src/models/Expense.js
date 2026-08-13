const mongoose = require('mongoose');

const splitSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, 'Split amount cannot be negative'],
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100,
    },
    shares: {
      type: Number,
      min: 0,
    },
    settled: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const expenseSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [200, 'Description cannot exceed 200 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0.01, 'Amount must be greater than 0'],
    },
    currency: {
      type: String,
      enum: ['INR', 'USD', 'EUR', 'GBP'],
      default: 'INR',
    },
    category: {
      type: String,
      enum: [
        'Food',
        'Travel',
        'Shopping',
        'Entertainment',
        'Bills',
        'Rent',
        'Utilities',
        'Health',
        'Groceries',
        'Transport',
        'Other',
      ],
      default: 'Other',
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'PaidBy is required'],
    },
    splitType: {
      type: String,
      enum: ['equal', 'exact', 'percentage', 'shares'],
      required: [true, 'Split type is required'],
    },
    splits: [splitSchema],
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    receipt: {
      type: String,
      default: null,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
expenseSchema.index({ group: 1, date: -1 });
expenseSchema.index({ 'splits.user': 1, date: -1 });
expenseSchema.index({ paidBy: 1, date: -1 });
expenseSchema.index({ createdBy: 1, date: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
