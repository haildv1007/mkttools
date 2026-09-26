import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { ContentType } from '@prisma/client';
import type { ExcelRow } from '../../types';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.DEFAULT_TIMEZONE || 'Asia/Ho_Chi_Minh';

const COLUMN_MAP: Record<string, string> = {
  'ngày': 'date', 'ngay': 'date', 'date': 'date', 'ngày đăng': 'date',
  'giờ': 'time', 'gio': 'time', 'time': 'time', 'giờ đăng': 'time', 'gio_dang': 'time',
  'page': 'page', 'trang': 'page', 'fanpage': 'page', 'kênh': 'page',
  'chủ đề': 'topic', 'chu_de': 'topic', 'topic': 'topic', 'nội dung': 'topic', 'tiêu đề': 'topic',
  'loại': 'contentType', 'loai': 'contentType', 'type': 'contentType', 'loại content': 'contentType',
  'ghi chú': 'notes', 'ghi_chu': 'notes', 'notes': 'notes', 'note': 'notes', 'mô tả': 'notes',
};

function normalizeHeader(header: string): string | undefined {
  return COLUMN_MAP[header.toLowerCase().trim()];
}

function parseContentType(raw: string): ContentType {
  const lower = raw?.toLowerCase().trim() || '';
  if (lower.includes('video')) return 'VIDEO';
  if (lower.includes('text') || lower === 'bài viết') return 'TEXT';
  return 'IMAGE';
}

function parseDate(dateVal: unknown, timeVal: unknown): Date {
  let year: number, month: number, day: number, hours = 9, minutes = 0;

  // Parse date part
  if (typeof dateVal === 'number') {
    // Excel date serial number (no cellDates, so always a number for dates)
    const d = XLSX.SSF.parse_date_code(dateVal);
    year = d.y; month = d.m; day = d.d;
  } else {
    const s = String(dateVal).trim();
    // Try common formats
    for (const fmt of ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'M/D/YYYY', 'MM/DD/YYYY']) {
      const p = dayjs(s, fmt, true);
      if (p.isValid()) { year = p.year(); month = p.month() + 1; day = p.date(); break; }
    }
    if (!year!) throw new Error(`Cannot parse date: "${s}"`);
  }

  // Parse time part
  if (typeof timeVal === 'number') {
    // Excel time as fraction of day (0.875 = 21:00)
    const totalMins = Math.round(timeVal * 24 * 60);
    hours = Math.floor(totalMins / 60);
    minutes = totalMins % 60;
  } else if (timeVal) {
    const s = String(timeVal).trim();
    const m = s.match(/(\d{1,2})[:\.](\d{2})/);
    if (m) { hours = parseInt(m[1]); minutes = parseInt(m[2]); }
  }

  const dateStr = `${year!}-${String(month!).padStart(2, '0')}-${String(day!).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  console.log(`[parseDate] raw date=${dateVal}, time=${timeVal} → "${dateStr}" TZ=${TZ}`);
  const result = dayjs.tz(dateStr, 'YYYY-MM-DD HH:mm', TZ);
  if (!result.isValid()) throw new Error(`Invalid date: "${dateStr}"`);
  return result.toDate();
}

export function parseExcel(buffer: Buffer): ExcelRow[] {
  // cellDates:false → dates stay as numbers, we parse them ourselves
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });

  if (rawRows.length === 0) throw new Error('File Excel trống');

  const firstRow = rawRows[0];
  const headerMap: Record<string, string> = {};
  for (const key of Object.keys(firstRow)) {
    const mapped = normalizeHeader(key);
    if (mapped) headerMap[key] = mapped;
  }

  if (!Object.values(headerMap).includes('date')) {
    throw new Error('Không tìm thấy cột ngày. Cần có cột: ngày, giờ, page, chủ đề');
  }
  if (!Object.values(headerMap).includes('topic')) {
    throw new Error('Không tìm thấy cột chủ đề/topic');
  }

  const rows: ExcelRow[] = [];
  for (const raw of rawRows) {
    const mapped: Record<string, unknown> = {};
    for (const [origKey, normalKey] of Object.entries(headerMap)) {
      mapped[normalKey] = raw[origKey];
    }
    if (!mapped.date || !mapped.topic) continue;

    rows.push({
      date: String(mapped.date),
      time: String(mapped.time || '09:00'),
      rawDate: mapped.date,
      rawTime: mapped.time,
      page: String(mapped.page || ''),
      topic: String(mapped.topic),
      contentType: parseContentType(String(mapped.contentType || 'image')),
      notes: mapped.notes ? String(mapped.notes) : undefined,
    });
  }

  return rows;
}

export function parseExcelToSchedule(buffer: Buffer) {
  const rows = parseExcel(buffer);
  return rows.map(row => ({
    ...row,
    scheduledAt: parseDate(row.rawDate ?? row.date, row.rawTime ?? row.time),
  }));
}
