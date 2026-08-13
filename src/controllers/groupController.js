const Group = require('../models/Group');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { createNotification } = require('../services/notificationService');
const { calculateGroupBalances } = require('../services/balanceService');

// @desc    Get user's groups
// @route   GET /api/groups
// @access  Private
const getUserGroups = async (req, res, next) => {
  try {
    const groups = await Group.find({ 'members.user': req.user._id })
      .populate('members.user', 'name username profileImage')
      .populate('createdBy', 'name username profileImage')
      .sort({ updatedAt: -1 });

    return successResponse(res, 'Groups fetched', { groups });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a group
// @route   POST /api/groups
// @access  Private
const createGroup = async (req, res, next) => {
  try {
    const { name, description, memberIds = [] } = req.body;

    let groupImage = null;
    if (req.file) {
      groupImage = `/uploads/groups/${req.file.filename}`;
    }

    // Build members array: creator is admin
    const members = [{ user: req.user._id, role: 'admin', joinedAt: new Date() }];

    // Handle memberIds from FormData (comes as JSON string) or regular JSON (array)
    let parsedMemberIds = [];
    if (memberIds) {
      parsedMemberIds = Array.isArray(memberIds) ? memberIds : JSON.parse(memberIds);
    }
    for (const id of parsedMemberIds) {
      if (id.toString() !== req.user._id.toString()) {
        members.push({ user: id, role: 'member', joinedAt: new Date() });
      }
    }

    const group = await Group.create({
      name,
      description,
      groupImage,
      createdBy: req.user._id,
      members,
    });

    await group.populate('members.user', 'name username profileImage');

    // Notify added members
    for (const member of group.members) {
      if (member.user._id.toString() !== req.user._id.toString()) {
        await createNotification({
          userId: member.user._id,
          type: 'group_added',
          title: 'Added to Group',
          message: `${req.user.name} added you to the group "${group.name}"`,
          relatedGroup: group._id,
        });
      }
    }

    return successResponse(res, 'Group created successfully', { group }, 201);
  } catch (error) {
    next(error);
  }
};

// @desc    Get group by ID
// @route   GET /api/groups/:id
// @access  Private (members only)
const getGroupById = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.user', 'name username profileImage email')
      .populate('createdBy', 'name username profileImage');

    if (!group) return errorResponse(res, 'Group not found', 404);

    // Filter out any members whose user document was deleted
    group.members = group.members.filter((m) => m.user != null);

    if (!group.isMember(req.user._id)) return errorResponse(res, 'Access denied', 403);

    return successResponse(res, 'Group fetched', { group });
  } catch (error) {
    next(error);
  }
};

// @desc    Update group
// @route   PUT /api/groups/:id
// @access  Private (admin only)
const updateGroup = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can update the group', 403);

    const { name, description } = req.body;
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (req.file) group.groupImage = `/uploads/groups/${req.file.filename}`;

    await group.save();
    await group.populate('members.user', 'name username profileImage');

    return successResponse(res, 'Group updated successfully', { group });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete group
// @route   DELETE /api/groups/:id
// @access  Private (admin only)
const deleteGroup = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can delete the group', 403);

    await group.deleteOne();
    return successResponse(res, 'Group deleted successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Add members to group
// @route   POST /api/groups/:id/members
// @access  Private (admin only)
const addMembers = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can add members', 403);

    const { memberIds } = req.body;
    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return errorResponse(res, 'memberIds array is required', 400);
    }

    const added = [];
    for (const id of memberIds) {
      if (!group.isMember(id)) {
        const user = await User.findById(id);
        if (user) {
          group.members.push({ user: id, role: 'member', joinedAt: new Date() });
          added.push(user);

          await createNotification({
            userId: id,
            type: 'group_added',
            title: 'Added to Group',
            message: `${req.user.name} added you to the group "${group.name}"`,
            relatedGroup: group._id,
          });
        }
      }
    }

    await group.save();
    await group.populate('members.user', 'name username profileImage');

    return successResponse(res, `${added.length} member(s) added`, { group });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove member from group
// @route   DELETE /api/groups/:id/members/:userId
// @access  Private (admin only)
const removeMember = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can remove members', 403);

    const targetUserId = req.params.userId;
    if (targetUserId === req.user._id.toString()) {
      return errorResponse(res, 'Admin cannot remove themselves', 400);
    }

    group.members = group.members.filter((m) => {
      const memberId = m.user?._id ? m.user._id.toString() : m.user?.toString();
      return memberId !== targetUserId;
    });
    await group.save();

    return successResponse(res, 'Member removed successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Get group balances
// @route   GET /api/groups/:id/balances
// @access  Private (members only)
const getGroupBalances = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id).populate('members.user', 'name username profileImage');
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isMember(req.user._id)) return errorResponse(res, 'Access denied', 403);

    // Filter out members whose user doc was deleted
    const validMembers = group.members.filter((m) => m.user != null);
    const memberIds = validMembers.map((m) => m.user._id);
    const { memberBalances, whoOwesWhom } = await calculateGroupBalances(group._id, memberIds);

    const balances = validMembers.map((m) => ({
      user: m.user,
      role: m.role,
      netBalance: memberBalances[m.user._id.toString()] || 0,
    }));

    return successResponse(res, 'Group balances fetched', { balances, whoOwesWhom });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMember,
  getGroupBalances,
};
