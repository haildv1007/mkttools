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
  const lower = header.toLowerCase().trim();
  return COLUMN_MAP[lower];
}

function parseContentType(raw: string): ContentType {
  const lower = raw?.toLowerCase().trim() || '';
  if (lower.includes('video')) return 'VIDEO';
  if (lower.includes('text') || lower === 'bài viết') return 'TEXT';
  return 'IMAGE';
}

function parseTimeStr(timeVal: unknown): { hours: number; minutes: number } {
  if (timeVal instanceof Date) {
    return { hours: timeVal.getUTCHours(), minutes: timeVal.getUTCMinutes() };
  }
  if (typeof timeVal === 'number' && timeVal < 1) {
    const totalMinutes = Math.round(timeVal * 24 * 60);
    return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
  }
  const str = timeVal ? String(timeVal).trim() : '09:00';
  const m = str.match(/(\d{1,2})[:\.](\d{2})/);
  if (m) return { hours: parseInt(m[1]), minutes: parseInt(m[2]) };
  return { hours: 9, minutes: 0 };
}

function parseDate(dateVal: unknown, timeVal: unknown): Date {
  const { hours, minutes } = parseTimeStr(timeVal);
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  let year: number, month: number, day: number;

  if (dateVal instanceof Date) {
    year = dateVal.getUTCFullYear();
    month = dateVal.getUTCMonth() + 1;
    day = dateVal.getUTCDate();
  } else if (typeof dateVal === 'number') {
    const d = XLSX.SSF.parse_date_code(dateVal);
    year = d.y;
    month = d.m;
    day = d.d;
  } else {
    const dateStr = String(dateVal).trim();
    const combined = `${dateStr} ${timeStr}`;
    for (const fmt of ['YYYY-MM-DD HH:mm', 'DD/MM/YYYY HH:mm', 'DD-MM-YYYY HH:mm', 'M/D/YYYY HH:mm', 'MM/DD/YYYY HH:mm']) {
      const parsed = dayjs.tz(combined, fmt, TZ);
      if (parsed.isValid()) return parsed.toDate();
    }
    const fallback = dayjs.tz(combined, TZ);
    if (fallback.isValid()) return fallback.toDate();
    throw new Error(`Cannot parse date: "${dateStr}" time: "${timeStr}"`);
  }

  const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${timeStr}`;
  return dayjs.tz(dateString, 'YYYY-MM-DD HH:mm', TZ).toDate();
}

export function parseExcel(buffer: Buffer): ExcelRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

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
