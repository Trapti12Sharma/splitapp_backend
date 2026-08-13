const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Group name is required'],
      trim: true,
      maxlength: [100, 'Group name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    groupImage: {
      type: String,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    members: [memberSchema],
  },
  {
    timestamps: true,
  }
);

// Helper method to check if a user is a member
// Works whether members are populated (objects) or unpopulated (ObjectIds)
groupSchema.methods.isMember = function (userId) {
  const userIdStr = userId.toString();
  return this.members.some((m) => {
    const memberId = m.user?._id ? m.user._id.toString() : m.user?.toString();
    return memberId === userIdStr;
  });
};

// Helper method to check if a user is an admin
groupSchema.methods.isAdmin = function (userId) {
  const userIdStr = userId.toString();
  return this.members.some((m) => {
    const memberId = m.user?._id ? m.user._id.toString() : m.user?.toString();
    return memberId === userIdStr && m.role === 'admin';
  });
};

module.exports = mongoose.model('Group', groupSchema);
