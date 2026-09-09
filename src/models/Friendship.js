const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'blocked'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate friendship records
friendshipSchema.index({ requester: 1, receiver: 1 }, { unique: true });
// For fast lookup of all friendships for a user
friendshipSchema.index({ receiver: 1, status: 1 });
friendshipSchema.index({ requester: 1, status: 1 });

module.exports = mongoose.model('Friendship', friendshipSchema);
