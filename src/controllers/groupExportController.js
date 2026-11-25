const mongoose = require('mongoose');
const Group = require('../models/Group');
const { errorResponse } = require('../utils/apiResponse');
const { loadGroupReport } = require('../services/groupReportService');
const { createGroupWorkbook } = require('../services/groupWorkbookService');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Real-world UTC offsets range from -12:00 to +14:00.
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

/** Browser's Date#getTimezoneOffset() — falls back to UTC on anything odd. */
const parseTzOffset = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && Math.abs(n) <= MAX_TZ_OFFSET_MINUTES ? n : 0;
};

/**
 * "Goa Trip 2026!" → ascii "Goa-Trip-2026" for the legacy filename parameter and
 * a UTF-8 version (non-Latin names kept) for filename*.
 */
const buildFilenames = (groupName, now, tzOffsetMinutes) => {
  const local = new Date(now.getTime() - tzOffsetMinutes * 60000);
  const stamp = local.toISOString().slice(0, 10);

  const base = String(groupName || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);

  const ascii = base
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    ascii: `${ascii || 'group'}-expenses-${stamp}.xlsx`,
    utf8: `${base || 'group'}-expenses-${stamp}.xlsx`,
  };
};

// @desc    Download a group's full report (expenses, splits, balances,
//          categories, settlements) as a styled Excel workbook
// @route   GET /api/groups/:id/export?tzOffset=-330
// @access  Private (members only)
const exportGroupSpreadsheet = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return errorResponse(res, 'Group not found', 404);
    }

    const group = await Group.findById(req.params.id);
    if (!group) return errorResponse(res, 'Group not found', 404);
    if (!group.isMember(req.user._id)) return errorResponse(res, 'Access denied', 403);

    const tzOffsetMinutes = parseTzOffset(req.query.tzOffset);
    const report = await loadGroupReport(group.toObject(), req.user);
    const workbook = createGroupWorkbook(report, { tzOffsetMinutes });

    // Build fully in memory first: if anything throws we can still send a
    // clean JSON error instead of a truncated file with a 200 status.
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { ascii, utf8 } = buildFilenames(group.name, report.generatedAt, tzOffsetMinutes);

    res.status(200);
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utf8)}`,
      'Content-Length': buffer.length,
      // Financial data: never let a shared proxy or the browser cache keep it.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(buffer);
  } catch (error) {
    next(error);
  }
};

module.exports = { exportGroupSpreadsheet, buildFilenames, parseTzOffset };
