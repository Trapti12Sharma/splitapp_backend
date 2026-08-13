const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema(
  {
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Payer is required'],
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Receiver is required'],
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
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
    note: {
      type: String,
      trim: true,
      maxlength: [200, 'Note cannot exceed 200 characters'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
settlementSchema.index({ from: 1, createdAt: -1 });
settlementSchema.index({ to: 1, createdAt: -1 });
settlementSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model('Settlement', settlementSchema);
