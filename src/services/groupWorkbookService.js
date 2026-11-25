const ExcelJS = require('exceljs');

/**
 * Renders a group report (see groupReportService.buildGroupReport) into a
 * colour-coded Excel workbook. Pure: no database access, so it is unit-testable.
 *
 * Every sheet opens with the same banner — group name, description and key
 * figures — so a single sheet printed or shared on its own still says which
 * group it belongs to.
 */

// ── Palette (matches the app's brand + category colours) ──────────────────
const COLORS = {
  brand: '4F46E5',
  brandDark: '312E81',
  brandSoft: 'EEF2FF',
  brandSoft2: 'E0E7FF',
  white: 'FFFFFF',
  text: '1E293B',
  muted: '64748B',
  border: 'CBD5E1',
  zebra: 'F8FAFC',
  positive: '059669',
  positiveSoft: 'D1FAE5',
  negative: 'E11D48',
  negativeSoft: 'FFE4E6',
  warning: 'B45309',
  warningSoft: 'FEF3C7',
  empty: 'F1F5F9',
};

// Kept in sync with splitapp/src/utils/categoryStyle.js
const CATEGORY_COLORS = {
  Food: 'F97316',
  Travel: '0EA5E9',
  Shopping: 'D946EF',
  Entertainment: '8B5CF6',
  Bills: '64748B',
  Rent: '6366F1',
  Utilities: 'CA8A04', // darker than the app's eab308 so text stays readable on white
  Health: 'F43F5E',
  Groceries: '10B981',
  Transport: '14B8A6',
  Other: '6B7280',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROLE_LABELS ={ admin: 'Admin', member: 'Member', former: 'Former member' };
const SPLIT_LABELS = { equal: 'Equal', exact: 'Exact amounts', percentage: 'Percentage', shares: 'Shares' };

// ── Low-level style helpers ───────────────────────────────────────────────
const argb = (hex) => `FF${hex.toUpperCase()}`;
const solid = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });

/** Mix a colour with white — `amount` is how much of the colour to keep. */
const tint = (hex, amount) => {
  const n = parseInt(hex, 16);
  const mix = (c) => Math.round(c * amount + 255 * (1 - amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
};

const categoryColor = (category) => CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;

const thinBorder = {
  top: { style: 'thin', color: { argb: argb(COLORS.border) } },
  left: { style: 'thin', color: { argb: argb(COLORS.border) } },
  bottom: { style: 'thin', color: { argb: argb(COLORS.border) } },
  right: { style: 'thin', color: { argb: argb(COLORS.border) } },
};

// Characters that are illegal in XML 1.0 would corrupt the .xlsx file.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const clean = (value) => (value == null ? '' : String(value).replace(INVALID_XML_CHARS, ''));

// Header/footer strings use `&` as a control character.
const escapeHeaderFooter = (value) => clean(value).replace(/&/g, '&&');

// ── Formatting helpers ────────────────────────────────────────────────────
const isDateOnly = (d) =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

/**
 * ExcelJS writes a JS Date using its UTC components. Expense dates picked in the
 * app are stored as UTC midnight (calendar dates) and must not move; real
 * timestamps (settlements, join dates) are shifted into the viewer's timezone.
 */
const makeDateHelpers = (tzOffsetMinutes) => {
  const toLocal = (d) => {
    if (!d) return null;
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    return isDateOnly(date) ? date : new Date(date.getTime() - tzOffsetMinutes * 60000);
  };
  const toLocalTimestamp = (d) => {
    if (!d) return null;
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getTime() - tzOffsetMinutes * 60000);
  };
  // Hand-rolled rather than toLocaleString so text labels match the cells'
  // "dd mmm yyyy" format exactly, whatever ICU data the server ships with.
  const label = (d, withTime = false) => {
    if (!d) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    const base = `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    if (!withTime) return base;
    const h = d.getUTCHours();
    return `${base}, ${pad(h % 12 || 12)}:${pad(d.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
  };
  return { toLocal, toLocalTimestamp, label };
};

const makeMoneyHelpers = (currency) => {
  const sym = currency.code ? currency.symbol.replace(/"/g, '') : '';
  const prefix = sym ? `"${sym}"` : '';
  return {
    numFmt: `${prefix}#,##0.00;-${prefix}#,##0.00;${prefix}0.00`,
    signedFmt: `+${prefix}#,##0.00;-${prefix}#,##0.00;${prefix}0.00`,
    text: (n, code = currency.code) => {
      const s = code ? (currency.code === code ? currency.symbol : `${code} `) : '';
      const abs = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${n < 0 ? '-' : ''}${s}${abs}`;
    },
  };
};

// ── Sheet building blocks ─────────────────────────────────────────────────
const setWidths = (ws, widths) => {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
};

/**
 * Group banner shared by every sheet. Returns the next free row number.
 */
const addBanner = (ws, ctx, { title, subtitle }, width) => {
  const { report, dates, money } = ctx;
  const span = Math.max(width, 6);
  const { group, totals } = report;

  const bandRow = (rowNo, value, { fill, font, height, align = 'left' }) => {
    ws.mergeCells(rowNo, 1, rowNo, span);
    const cell = ws.getCell(rowNo, 1);
    cell.value = clean(value);
    cell.fill = solid(fill);
    cell.font = { name: 'Calibri', ...font };
    cell.alignment = { vertical: 'middle', horizontal: align, wrapText: true, indent: 1 };
    ws.getRow(rowNo).height = height;
  };

  const period = totals.firstDate
    ? `${dates.label(dates.toLocal(totals.firstDate))} – ${dates.label(dates.toLocal(totals.lastDate))}`
    : 'No expenses yet';
  const totalText = report.currency.mixed
    ? `${money.text(totals.amount)} (mixed currencies)`
    : money.text(totals.amount);

  bandRow(1, group.name, { fill: COLORS.brand, font: { size: 20, bold: true, color: { argb: argb(COLORS.white) } }, height: 36 });
  bandRow(2, group.description || 'Group expense report', {
    fill: COLORS.brand,
    font: { size: 11, italic: true, color: { argb: argb(COLORS.brandSoft2) } },
    height: 22,
  });
  bandRow(
    3,
    `Members: ${group.memberCount}   •   Expenses: ${totals.expenseCount}   •   Total spent: ${totalText}   •   Period: ${period}`,
    { fill: COLORS.brandSoft, font: { size: 11, bold: true, color: { argb: argb(COLORS.brandDark) } }, height: 22 }
  );
  bandRow(
    4,
    `Generated on ${dates.label(dates.toLocalTimestamp(report.generatedAt), true)}${report.generatedByName ? ` by ${report.generatedByName}` : ''}   •   SplitApp`,
    { fill: COLORS.brandSoft, font: { size: 9, color: { argb: argb(COLORS.muted) } }, height: 18 }
  );

  let row = 5;
  if (report.currency.mixed) {
    bandRow(
      row,
      `Note: this group has expenses in more than one currency (${report.currency.codes.join(', ')}). ` +
        'Totals add the amounts as recorded, the same way the app does — check each row\'s Currency column.',
      { fill: COLORS.warningSoft, font: { size: 10, bold: true, color: { argb: argb(COLORS.warning) } }, height: 30 }
    );
    row += 1;
  }

  row += 1; // spacer
  ws.mergeCells(row, 1, row, span);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = title;
  titleCell.font = { size: 14, bold: true, color: { argb: argb(COLORS.brand) } };
  ws.getRow(row).height = 22;
  row += 1;
  if (subtitle) {
    ws.mergeCells(row, 1, row, span);
    const sub = ws.getCell(row, 1);
    sub.value = subtitle;
    sub.font = { size: 10, italic: true, color: { argb: argb(COLORS.muted) } };
    row += 1;
  }
  return row + 1; // one blank row before the content
};

const styleHeaderRow = (ws, rowNo, headers, { fill = COLORS.brandDark } = {}) => {
  const row = ws.getRow(rowNo);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.fill = solid(fill);
    cell.font = { bold: true, color: { argb: argb(COLORS.white) }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  });
  row.height = 32;
};

/** Default body styling: borders, zebra stripes, vertical alignment. */
const styleBodyRow = (ws, rowNo, colCount, index) => {
  const row = ws.getRow(rowNo);
  for (let c = 1; c <= colCount; c += 1) {
    const cell = row.getCell(c);
    cell.border = thinBorder;
    if (!cell.fill || cell.fill.type !== 'pattern') {
      if (index % 2 === 1) cell.fill = solid(COLORS.zebra);
    }
    cell.alignment = { vertical: 'middle', wrapText: true, ...(cell.alignment || {}) };
  }
};

const styleTotalRow = (ws, rowNo, colCount) => {
  const row = ws.getRow(rowNo);
  for (let c = 1; c <= colCount; c += 1) {
    const cell = row.getCell(c);
    cell.fill = solid(COLORS.brandSoft2);
    cell.font = { ...(cell.font || {}), bold: true, color: { argb: argb(COLORS.brandDark) } };
    cell.border = {
      ...thinBorder,
      top: { style: 'double', color: { argb: argb(COLORS.brandDark) } },
    };
    cell.alignment = { vertical: 'middle', ...(cell.alignment || {}) };
  }
  row.height = 22;
};

const emptyStateRow = (ws, rowNo, colCount, message) => {
  ws.mergeCells(rowNo, 1, rowNo, colCount);
  const cell = ws.getCell(rowNo, 1);
  cell.value = message;
  cell.fill = solid(COLORS.empty);
  cell.font = { italic: true, color: { argb: argb(COLORS.muted) } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(rowNo).height = 26;
};

const paintCategory = (cell, category) => {
  const color = categoryColor(category);
  cell.value = clean(category);
  cell.fill = solid(tint(color, 0.18));
  cell.font = { bold: true, color: { argb: argb(color) } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
};

const paintNet = (cell, net) => {
  if (net > 0.004) {
    cell.fill = solid(COLORS.positiveSoft);
    cell.font = { bold: true, color: { argb: argb(COLORS.positive) } };
  } else if (net < -0.004) {
    cell.fill = solid(COLORS.negativeSoft);
    cell.font = { bold: true, color: { argb: argb(COLORS.negative) } };
  } else {
    cell.font = { bold: true, color: { argb: argb(COLORS.muted) } };
  }
};

const statusText = (net, money) => {
  if (net > 0.004) return `Gets back ${money.text(net)}`;
  if (net < -0.004) return `Owes ${money.text(-net)}`;
  return 'Settled up';
};

const finishSheet = (ws, ctx, { freezeRow, freezeCol = 0, headerRow, lastCol, lastRow }) => {
  ws.views = [{ state: 'frozen', xSplit: freezeCol, ySplit: freezeRow, showGridLines: false, zoomScale: 100 }];
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    ...(headerRow ? { printTitlesRow: `${headerRow}:${headerRow}` } : {}),
  };
  if (lastRow && lastCol) {
    ws.pageSetup.printArea = `A1:${ws.getColumn(lastCol).letter}${lastRow}`;
  }
  const name = escapeHeaderFooter(ctx.report.group.name);
  ws.headerFooter = {
    oddHeader: `&L&"Calibri,Bold"${name}&R${escapeHeaderFooter(ws.name)}`,
    oddFooter: '&LGenerated by SplitApp&RPage &P of &N',
  };
};

// ── Sheets ────────────────────────────────────────────────────────────────
const buildSummarySheet = (wb, ctx) => {
  const { report, money, dates } = ctx;
  const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: argb(COLORS.brand) } } });
  const headers = ['#', 'Member', 'Username', 'Role', 'Joined', 'Bills paid', 'Total paid', 'Total share', 'Net balance', 'Status'];
  setWidths(ws, [6, 26, 18, 16, 15, 11, 16, 16, 16, 24]);

  let row = addBanner(ws, ctx, {
    title: 'Group Overview',
    subtitle: 'Key facts about the group and where every member stands right now.',
  }, headers.length);

  // Key facts
  const facts = [
    ['Group name', report.group.name],
    ['Description', report.group.description || '—'],
    ['Created by', report.group.createdByName || '—'],
    ['Created on', dates.label(dates.toLocalTimestamp(report.group.createdAt))],
    ['Members', report.group.memberCount],
    ['Expenses recorded', report.totals.expenseCount],
    ['Total spent', { money: report.totals.amount }],
    ['Average per expense', { money: report.totals.expenseCount ? Math.round((report.totals.amount / report.totals.expenseCount) * 100) / 100 : 0 }],
    ['Settlements recorded', `${report.totals.settlementCount} (${money.text(report.totals.settlementAmount)})`],
    ['Currency', report.currency.mixed ? `Mixed: ${report.currency.codes.join(', ')}` : report.currency.code],
    ['Open debts to settle', report.settlePlan.length ? `${report.settlePlan.length} payment(s)` : 'None — everyone is settled up'],
  ];
  for (const [label, value] of facts) {
    ws.mergeCells(row, 1, row, 2);
    ws.mergeCells(row, 3, row, 6);
    const l = ws.getCell(row, 1);
    l.value = label;
    l.font = { bold: true, color: { argb: argb(COLORS.brandDark) } };
    l.fill = solid(COLORS.brandSoft);
    l.border = thinBorder;
    l.alignment = { vertical: 'middle', indent: 1 };
    const v = ws.getCell(row, 3);
    if (value && typeof value === 'object' && 'money' in value) {
      v.value = value.money;
      v.numFmt = money.numFmt;
    } else {
      v.value = typeof value === 'number' ? value : clean(value);
    }
    v.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    v.border = thinBorder;
    v.font = { color: { argb: argb(COLORS.text) } };
    row += 1;
  }

  row += 1;
  ws.mergeCells(row, 1, row, headers.length);
  const t = ws.getCell(row, 1);
  t.value = 'Member Summary';
  t.font = { size: 13, bold: true, color: { argb: argb(COLORS.brand) } };
  row += 1;

  const headerRow = row;
  styleHeaderRow(ws, headerRow, headers);
  row += 1;

  const firstData = row;
  report.people.forEach((p, i) => {
    const r = ws.getRow(row);
    r.values = [
      i + 1,
      clean(p.name),
      p.username ? `@${clean(p.username)}` : '—',
      ROLE_LABELS[p.role],
      p.joinedAt ? dates.toLocalTimestamp(p.joinedAt) : '—',
      p.expensesPaidCount,
      p.paid,
      p.share,
      p.net,
      statusText(p.net, money),
    ];
    r.getCell(5).numFmt = 'dd mmm yyyy';
    [7, 8].forEach((c) => { r.getCell(c).numFmt = money.numFmt; });
    r.getCell(9).numFmt = money.signedFmt;
    styleBodyRow(ws, row, headers.length, i);
    [1, 5, 6].forEach((c) => { r.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }; });
    const roleCell = r.getCell(4);
    if (p.role === 'admin') {
      roleCell.fill = solid(COLORS.warningSoft);
      roleCell.font = { bold: true, color: { argb: argb(COLORS.warning) } };
    } else if (p.role === 'former') {
      roleCell.font = { italic: true, color: { argb: argb(COLORS.muted) } };
    }
    r.getCell(2).font = { bold: true, color: { argb: argb(COLORS.text) } };
    paintNet(r.getCell(9), p.net);
    paintNet(r.getCell(10), p.net);
    row += 1;
  });

  if (report.people.length === 0) {
    emptyStateRow(ws, row, headers.length, 'No members');
    row += 1;
  } else {
    const lastData = row - 1;
    const tr = ws.getRow(row);
    tr.getCell(2).value = 'Total';
    tr.getCell(6).value = { formula: `SUM(F${firstData}:F${lastData})`, result: report.totals.expenseCount };
    tr.getCell(7).value = { formula: `SUM(G${firstData}:G${lastData})`, result: report.totals.amount };
    tr.getCell(8).value = { formula: `SUM(H${firstData}:H${lastData})`, result: report.totals.amount };
    tr.getCell(9).value = { formula: `ROUND(SUM(I${firstData}:I${lastData}),2)`, result: 0 };
    [7, 8].forEach((c) => { tr.getCell(c).numFmt = money.numFmt; });
    tr.getCell(9).numFmt = money.signedFmt;
    tr.getCell(10).value = 'Nets to zero ✓';
    tr.getCell(6).alignment = { horizontal: 'center' };
    styleTotalRow(ws, row, headers.length);
    row += 1;
  }

  row += 1;
  ws.mergeCells(row, 1, row, headers.length);
  const legend = ws.getCell(row, 1);
  legend.value = 'Net balance = what they paid − their share ± settle-ups.  Green = gets money back, Red = owes money.';
  legend.font = { italic: true, size: 9, color: { argb: argb(COLORS.muted) } };

  finishSheet(ws, ctx, { freezeRow: 4, headerRow, lastCol: headers.length, lastRow: row });
};

const buildExpensesSheet = (wb, ctx) => {
  const { report, money, dates, nameOf } = ctx;
  const ws = wb.addWorksheet('Expenses', { properties: { tabColor: { argb: argb(CATEGORY_COLORS.Food) } } });
  const headers = ['#', 'Date', 'Description', 'Category', 'Amount', 'Currency', 'Paid by', 'Split type', 'People', 'How it was split', 'Notes', 'Added by'];
  setWidths(ws, [6, 14, 32, 16, 15, 10, 20, 15, 9, 55, 30, 18]);

  let row = addBanner(ws, ctx, {
    title: 'All Expenses',
    subtitle: 'Every bill in the group, oldest first — who paid, the category and how it was divided.',
  }, headers.length);

  const headerRow = row;
  styleHeaderRow(ws, headerRow, headers);
  row += 1;
  const firstData = row;

  report.expenses.forEach((e, i) => {
    const splitText = e.splits
      .map((s) => {
        const amt = money.text(s.amount, e.currency);
        if (e.splitType === 'percentage' && s.percentage != null) return `${nameOf(s.userId)}: ${s.percentage}% (${amt})`;
        if (e.splitType === 'shares' && s.shares != null) return `${nameOf(s.userId)}: ${s.shares} share${s.shares === 1 ? '' : 's'} (${amt})`;
        return `${nameOf(s.userId)}: ${amt}`;
      })
      .join('  •  ');

    const r = ws.getRow(row);
    r.values = [
      i + 1,
      dates.toLocal(e.date),
      clean(e.description),
      null,
      e.amount,
      e.currency,
      nameOf(e.paidById),
      SPLIT_LABELS[e.splitType] || clean(e.splitType),
      e.splits.length,
      clean(splitText),
      clean(e.notes) || '',
      clean(e.createdByName),
    ];
    paintCategory(r.getCell(4), e.category);
    r.getCell(2).numFmt = 'dd mmm yyyy';
    r.getCell(5).numFmt = money.numFmt;
    styleBodyRow(ws, row, headers.length, i);
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(3).font = { bold: true, color: { argb: argb(COLORS.text) } };
    r.getCell(5).font = { bold: true, color: { argb: argb(COLORS.text) } };
    r.getCell(7).font = { color: { argb: argb(COLORS.positive) }, bold: true };
    row += 1;
  });

  if (report.expenses.length === 0) {
    emptyStateRow(ws, row, headers.length, 'No expenses have been added to this group yet.');
    row += 1;
  } else {
    const lastData = row - 1;
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastData, column: headers.length } };
    const tr = ws.getRow(row);
    tr.getCell(3).value = report.currency.mixed ? 'Total (mixed currencies)' : 'Total';
    tr.getCell(5).value = { formula: `SUM(E${firstData}:E${lastData})`, result: report.totals.amount };
    tr.getCell(5).numFmt = money.numFmt;
    tr.getCell(9).value = `${report.totals.expenseCount} bills`;
    styleTotalRow(ws, row, headers.length);
    row += 1;
  }

  finishSheet(ws, ctx, { freezeRow: headerRow, freezeCol: 3, headerRow, lastCol: headers.length, lastRow: row - 1 });
};

const buildSplitSheet = (wb, ctx) => {
  const { report, money, dates, nameOf } = ctx;
  const ws = wb.addWorksheet('Split Breakdown', { properties: { tabColor: { argb: argb(CATEGORY_COLORS.Travel) } } });
  const fixed = ['#', 'Date', 'Description', 'Category', 'Amount', 'Paid by'];
  const people = report.people;
  const headers = [
    ...fixed,
    ...people.map((p) => `${clean(p.name)}${p.username ? `\n@${clean(p.username)}` : ''}${p.role === 'former' ? '\n(former)' : ''}`),
  ];
  setWidths(ws, [6, 14, 30, 16, 15, 20, ...people.map(() => 17)]);

  let row = addBanner(ws, ctx, {
    title: 'Who Owes What — Per Expense',
    subtitle: 'Each person\'s share of every bill. Green cell = this person paid the bill. Red cell = their share. "—" = not part of it.',
  }, headers.length);

  const headerRow = row;
  styleHeaderRow(ws, headerRow, headers);
  // Person columns get the travel-blue header so the matrix reads as its own block.
  people.forEach((_, i) => { ws.getRow(headerRow).getCell(fixed.length + i + 1).fill = solid('0369A1'); });
  ws.getRow(headerRow).height = 46;
  row += 1;
  const firstData = row;

  report.expenses.forEach((e, i) => {
    const r = ws.getRow(row);
    r.values = [i + 1, dates.toLocal(e.date), clean(e.description), null, e.amount, nameOf(e.paidById)];
    paintCategory(r.getCell(4), e.category);
    r.getCell(2).numFmt = 'dd mmm yyyy';
    r.getCell(5).numFmt = money.numFmt;
    styleBodyRow(ws, row, headers.length, i);
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(5).font = { bold: true };

    const shareById = new Map();
    for (const s of e.splits) shareById.set(s.userId, (shareById.get(s.userId) || 0) + s.amount);

    people.forEach((p, pi) => {
      const cell = r.getCell(fixed.length + pi + 1);
      const isPayer = p.id === e.paidById;
      const share = shareById.get(p.id);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (share != null) {
        cell.value = Math.round(share * 100) / 100;
        cell.numFmt = money.numFmt;
      } else {
        cell.value = isPayer ? 0 : '—';
        if (isPayer) cell.numFmt = money.numFmt;
      }
      if (isPayer) {
        cell.fill = solid(COLORS.positiveSoft);
        cell.font = { bold: true, color: { argb: argb(COLORS.positive) } };
      } else if (share != null) {
        cell.fill = solid(COLORS.negativeSoft);
        cell.font = { color: { argb: argb(COLORS.negative) } };
      } else {
        cell.font = { color: { argb: argb(COLORS.border) } };
      }
    });
    row += 1;
  });

  if (report.expenses.length === 0) {
    emptyStateRow(ws, row, headers.length, 'No expenses have been added to this group yet.');
    row += 1;
  } else {
    const lastData = row - 1;
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastData, column: fixed.length } };

    const totalsSpec = [
      { label: 'Total share', key: 'share', formula: (col) => `SUM(${col}${firstData}:${col}${lastData})` },
      { label: 'Total paid', key: 'paid' },
      { label: 'Paid − share (before settle-ups)', key: 'diff' },
    ];
    const rowsAt = {};
    totalsSpec.forEach((spec) => {
      const tr = ws.getRow(row);
      rowsAt[spec.key] = row;
      ws.mergeCells(row, 1, row, fixed.length - 2);
      tr.getCell(1).value = spec.label;
      tr.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
      if (spec.key === 'share') {
        tr.getCell(5).value = { formula: `SUM(E${firstData}:E${lastData})`, result: report.totals.amount };
        tr.getCell(5).numFmt = money.numFmt;
      }
      people.forEach((p, pi) => {
        const colNo = fixed.length + pi + 1;
        const col = ws.getColumn(colNo).letter;
        const cell = tr.getCell(colNo);
        if (spec.key === 'share') cell.value = { formula: spec.formula(col), result: p.share };
        if (spec.key === 'paid') cell.value = p.paid;
        if (spec.key === 'diff') {
          const diff = Math.round((p.paid - p.share) * 100) / 100;
          cell.value = { formula: `${col}${rowsAt.paid}-${col}${rowsAt.share}`, result: diff };
        }
        cell.numFmt = spec.key === 'diff' ? money.signedFmt : money.numFmt;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      styleTotalRow(ws, row, headers.length);
      if (spec.key === 'diff') {
        people.forEach((p, pi) => paintNet(tr.getCell(fixed.length + pi + 1), p.paid - p.share));
      }
      row += 1;
    });
  }

  finishSheet(ws, ctx, { freezeRow: headerRow, freezeCol: 3, headerRow, lastCol: headers.length, lastRow: row - 1 });
};

const buildBalancesSheet = (wb, ctx) => {
  const { report, money, nameOf } = ctx;
  const ws = wb.addWorksheet('Balances', { properties: { tabColor: { argb: argb(COLORS.positive) } } });
  const headers = ['#', 'Member', 'Total paid', 'Total share', 'Paid − share', 'Settle-ups paid', 'Settle-ups received', 'Net balance', 'Status'];
  setWidths(ws, [6, 26, 16, 16, 16, 16, 18, 16, 26]);

  let row = addBanner(ws, ctx, {
    title: 'Balances',
    subtitle: 'How each net balance is worked out (the columns are live formulas), followed by the simplest way to settle up.',
  }, headers.length);

  const headerRow = row;
  styleHeaderRow(ws, headerRow, headers, { fill: '047857' });
  row += 1;
  const firstData = row;

  report.people.forEach((p, i) => {
    const r = ws.getRow(row);
    const diff = Math.round((p.paid - p.share) * 100) / 100;
    r.values = [
      i + 1,
      `${clean(p.name)}${p.role === 'former' ? ' (former)' : ''}`,
      p.paid,
      p.share,
      { formula: `C${row}-D${row}`, result: diff },
      p.settlementsPaid,
      p.settlementsReceived,
      { formula: `ROUND(E${row}+F${row}-G${row},2)`, result: p.net },
      statusText(p.net, money),
    ];
    [3, 4, 6, 7].forEach((c) => { r.getCell(c).numFmt = money.numFmt; });
    [5, 8].forEach((c) => { r.getCell(c).numFmt = money.signedFmt; });
    styleBodyRow(ws, row, headers.length, i);
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(2).font = { bold: true };
    paintNet(r.getCell(8), p.net);
    paintNet(r.getCell(9), p.net);
    row += 1;
  });

  if (report.people.length) {
    const lastData = row - 1;
    const tr = ws.getRow(row);
    tr.getCell(2).value = 'Total';
    const sum = (key) => report.people.reduce((s, p) => s + Math.round(p[key] * 100), 0) / 100;
    // [column letter, cached result] — the result is what viewers that don't
    // recalculate (previews, mobile) display.
    const totalCols = [
      ['C', sum('paid')],
      ['D', sum('share')],
      ['E', 0],
      ['F', sum('settlementsPaid')],
      ['G', sum('settlementsReceived')],
      ['H', 0],
    ];
    totalCols.forEach(([col, result], k) => {
      const cell = tr.getCell(3 + k);
      cell.value = { formula: `ROUND(SUM(${col}${firstData}:${col}${lastData}),2)`, result };
      cell.numFmt = col === 'E' || col === 'H' ? money.signedFmt : money.numFmt;
    });
    tr.getCell(9).value = 'Nets to zero ✓';
    styleTotalRow(ws, row, headers.length);
    row += 1;
  }

  // Settle-up plan
  row += 2;
  ws.mergeCells(row, 1, row, headers.length);
  const t = ws.getCell(row, 1);
  t.value = 'Settle-Up Plan — Who Pays Whom';
  t.font = { size: 13, bold: true, color: { argb: argb(COLORS.brand) } };
  row += 1;
  ws.mergeCells(row, 1, row, headers.length);
  const st = ws.getCell(row, 1);
  st.value = 'The fewest payments that clear every balance in the group (same as the app\'s "Who owes whom").';
  st.font = { size: 10, italic: true, color: { argb: argb(COLORS.muted) } };
  row += 2;

  const planHeaderRow = row;
  const planHeaders = ['#', 'Who pays', 'Amount', '', 'Who receives'];
  styleHeaderRow(ws, planHeaderRow, planHeaders);
  ws.getRow(planHeaderRow).getCell(4).value = '→';
  row += 1;

  if (report.settlePlan.length === 0) {
    emptyStateRow(ws, row, planHeaders.length, 'Everyone is settled up — nothing to pay. 🎉');
    row += 1;
  } else {
    report.settlePlan.forEach((t2, i) => {
      const r = ws.getRow(row);
      r.values = [i + 1, nameOf(t2.fromId), t2.amount, '→', nameOf(t2.toId)];
      styleBodyRow(ws, row, planHeaders.length, i);
      r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(2).fill = solid(COLORS.negativeSoft);
      r.getCell(2).font = { bold: true, color: { argb: argb(COLORS.negative) } };
      r.getCell(3).numFmt = money.numFmt;
      r.getCell(3).font = { bold: true, size: 12 };
      r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(4).font = { bold: true, color: { argb: argb(COLORS.muted) } };
      r.getCell(5).fill = solid(COLORS.positiveSoft);
      r.getCell(5).font = { bold: true, color: { argb: argb(COLORS.positive) } };
      row += 1;
    });
  }

  finishSheet(ws, ctx, { freezeRow: 4, headerRow, lastCol: headers.length, lastRow: row - 1 });
};

const buildCategoriesSheet = (wb, ctx) => {
  const { report, money } = ctx;
  const ws = wb.addWorksheet('Categories', { properties: { tabColor: { argb: argb(CATEGORY_COLORS.Shopping) } } });
  const people = report.people;
  const fixed = ['#', 'Category', 'Bills', 'Total spent', '% of total', 'Average bill'];
  const headers = [...fixed, ...people.map((p) => `${clean(p.name)}'s share${p.role === 'former' ? ' (former)' : ''}`)];
  setWidths(ws, [6, 20, 9, 16, 12, 15, ...people.map(() => 17)]);

  let row = addBanner(ws, ctx, {
    title: 'Spending by Category',
    subtitle: 'Where the group\'s money went, and how much of each category every person is responsible for.',
  }, headers.length);

  const headerRow = row;
  styleHeaderRow(ws, headerRow, headers, { fill: 'A21CAF' });
  ws.getRow(headerRow).height = 40;
  row += 1;
  const firstData = row;

  report.categories.forEach((c, i) => {
    const r = ws.getRow(row);
    const avg = Math.round((c.total / c.count) * 100) / 100;
    r.values = [
      i + 1,
      null,
      c.count,
      c.total,
      c.percentage,
      { formula: `IF(C${row}=0,0,ROUND(D${row}/C${row},2))`, result: avg },
      ...people.map((p) => c.byPerson[p.id] ?? 0),
    ];
    styleBodyRow(ws, row, headers.length, i);
    paintCategory(r.getCell(2), c.category);
    const color = categoryColor(c.category);
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(4).numFmt = money.numFmt;
    r.getCell(4).font = { bold: true, color: { argb: argb(color) } };
    r.getCell(5).numFmt = '0.0%';
    r.getCell(5).fill = solid(tint(color, 0.08 + 0.4 * c.percentage));
    r.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(5).font = { bold: true };
    r.getCell(6).numFmt = money.numFmt;
    people.forEach((_, pi) => {
      const cell = r.getCell(fixed.length + pi + 1);
      cell.numFmt = money.numFmt;
      if (!cell.value) cell.font = { color: { argb: argb(COLORS.border) } };
    });
    row += 1;
  });

  if (report.categories.length === 0) {
    emptyStateRow(ws, row, headers.length, 'No expenses have been added to this group yet.');
    row += 1;
  } else {
    const lastData = row - 1;
    const tr = ws.getRow(row);
    tr.getCell(2).value = 'Total';
    tr.getCell(3).value = { formula: `SUM(C${firstData}:C${lastData})`, result: report.totals.expenseCount };
    tr.getCell(4).value = { formula: `SUM(D${firstData}:D${lastData})`, result: report.totals.amount };
    tr.getCell(5).value = { formula: `SUM(E${firstData}:E${lastData})`, result: 1 };
    tr.getCell(3).alignment = { horizontal: 'center' };
    tr.getCell(4).numFmt = money.numFmt;
    tr.getCell(5).numFmt = '0.0%';
    tr.getCell(5).alignment = { horizontal: 'center' };
    people.forEach((p, pi) => {
      const colNo = fixed.length + pi + 1;
      const col = ws.getColumn(colNo).letter;
      tr.getCell(colNo).value = { formula: `SUM(${col}${firstData}:${col}${lastData})`, result: p.share };
      tr.getCell(colNo).numFmt = money.numFmt;
    });
    styleTotalRow(ws, row, headers.length);
    row += 1;
  }

  finishSheet(ws, ctx, { freezeRow: headerRow, freezeCol: 2, headerRow, lastCol: headers.length, lastRow: row - 1 });
};

const buildSettlementsSheet = (wb, ctx) => {
  const { report, money, dates, nameOf } = ctx;
  const ws = wb.addWorksheet('Settlements', { properties: { tabColor: { argb: argb(CATEGORY_COLORS.Transport) } } });
  const headers = ['#', 'Date & time', 'Paid by', '', 'Received by', 'Amount', 'Currency', 'Note'];
  setWidths(ws, [6, 22, 24, 5, 24, 15, 10, 40]);

  let row = addBanner(ws, ctx, {
    title: 'Settle-Up History',
    subtitle: 'Every payment recorded in this group to clear a balance.',
  }, headers.length);

  const headerRow = row;
  styleHeaderRow(ws, headerRow, headers, { fill: '0F766E' });
  ws.getRow(headerRow).getCell(4).value = '→';
  row += 1;
  const firstData = row;

  report.settlements.forEach((s, i) => {
    const r = ws.getRow(row);
    r.values = [i + 1, dates.toLocalTimestamp(s.date), nameOf(s.fromId), '→', nameOf(s.toId), s.amount, s.currency, clean(s.note)];
    r.getCell(2).numFmt = 'dd mmm yyyy, hh:mm AM/PM';
    r.getCell(6).numFmt = money.numFmt;
    styleBodyRow(ws, row, headers.length, i);
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(3).font = { bold: true, color: { argb: argb(COLORS.negative) } };
    r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(4).font = { color: { argb: argb(COLORS.muted) } };
    r.getCell(5).font = { bold: true, color: { argb: argb(COLORS.positive) } };
    r.getCell(6).font = { bold: true };
    r.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
    row += 1;
  });

  if (report.settlements.length === 0) {
    emptyStateRow(ws, row, headers.length, 'No settle-ups have been recorded in this group yet.');
    row += 1;
  } else {
    const lastData = row - 1;
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastData, column: headers.length } };
    const tr = ws.getRow(row);
    tr.getCell(3).value = 'Total settled';
    tr.getCell(6).value = { formula: `SUM(F${firstData}:F${lastData})`, result: report.totals.settlementAmount };
    tr.getCell(6).numFmt = money.numFmt;
    styleTotalRow(ws, row, headers.length);
    row += 1;
  }

  finishSheet(ws, ctx, { freezeRow: headerRow, headerRow, lastCol: headers.length, lastRow: row - 1 });
};

/**
 * @param {object} report  output of buildGroupReport
 * @param {object} [options]
 * @param {number} [options.tzOffsetMinutes=0]  value of the browser's Date#getTimezoneOffset()
 * @returns {ExcelJS.Workbook}
 */
const createGroupWorkbook = (report, { tzOffsetMinutes = 0 } = {}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SplitApp';
  wb.lastModifiedBy = 'SplitApp';
  wb.title = `${clean(report.group.name)} — expense report`;
  wb.subject = 'Group expenses, splits and balances';
  wb.created = report.generatedAt;
  wb.modified = report.generatedAt;

  const people = new Map(report.people.map((p) => [p.id, p]));
  const ctx = {
    report,
    dates: makeDateHelpers(tzOffsetMinutes),
    money: makeMoneyHelpers(report.currency),
    nameOf: (id) => {
      const p = people.get(id);
      if (!p) return 'Unknown';
      return `${clean(p.name)}${p.role === 'former' ? ' (former)' : ''}`;
    },
  };

  buildSummarySheet(wb, ctx);
  buildExpensesSheet(wb, ctx);
  buildSplitSheet(wb, ctx);
  buildBalancesSheet(wb, ctx);
  buildCategoriesSheet(wb, ctx);
  buildSettlementsSheet(wb, ctx);

  return wb;
};

module.exports = { createGroupWorkbook, CATEGORY_COLORS };
