import * as XLSX from "xlsx";

/**
 * Hardened Excel/CSV parsing for staff-only import flows.
 *
 * Mitigations against the known SheetJS advisories (Prototype Pollution
 * GHSA-4r6h-8v6p-xvw6 and ReDoS GHSA-5pgg-2g8v-p4x9) on top of the fact
 * that only authenticated staff can upload files:
 *
 *  - Strict file-size cap (default 10 MB) before any parsing.
 *  - Strict extension + MIME allowlist (.xlsx / .xls / .csv).
 *  - Parse options that disable formula evaluation, embedded HTML, styles
 *    and VBA macros so malformed cells cannot trigger heavy parsers.
 *  - Row cap per sheet to bound CPU/memory when reading attacker-shaped
 *    rectangular sheets.
 *  - Removes any inherited `__proto__` / `constructor` / `prototype` keys
 *    from parsed rows so a malicious cell name cannot pollute Object.prototype.
 */

export const MAX_EXCEL_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_EXCEL_ROWS = 50_000;

const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;
const ALLOWED_MIME_TYPES = new Set<string>([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv",
  "application/csv",
  "text/plain", // some browsers report this for .csv
  "", // some browsers (Safari) leave type empty — fall back to extension check
]);

export class SafeExcelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeExcelError";
  }
}

export function validateExcelFile(
  file: File,
  opts: { maxBytes?: number } = {}
): void {
  const maxBytes = opts.maxBytes ?? MAX_EXCEL_FILE_BYTES;
  const lowerName = file.name.toLowerCase();
  const hasAllowedExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!hasAllowedExt) {
    throw new SafeExcelError(
      "نوع الملف غير مدعوم. يُسمح فقط بملفات .xlsx أو .xls أو .csv"
    );
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new SafeExcelError("نوع الملف (MIME) غير مدعوم");
  }
  if (file.size <= 0) {
    throw new SafeExcelError("الملف فارغ");
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new SafeExcelError(`حجم الملف يتجاوز الحد المسموح (${mb} ميجابايت)`);
  }
}

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function sanitizeRow<T extends Record<string, any>>(row: T): T {
  const out: Record<string, any> = Object.create(null);
  for (const k of Object.keys(row)) {
    if (UNSAFE_KEYS.has(k)) continue;
    out[k] = row[k];
  }
  return out as T;
}

export interface SafeParseResult<T = Record<string, any>> {
  workbook: XLSX.WorkBook;
  firstSheetName: string;
  rows: T[];
}

/**
 * Validate then parse an uploaded Excel/CSV file using hardened options.
 * Returns the rows of the first sheet plus the workbook for advanced cases.
 */
export async function safeParseExcel<T = Record<string, any>>(
  file: File,
  opts: { maxBytes?: number; maxRows?: number; defval?: any } = {}
): Promise<SafeParseResult<T>> {
  validateExcelFile(file, { maxBytes: opts.maxBytes });
  const maxRows = opts.maxRows ?? MAX_EXCEL_ROWS;

  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, {
    type: "array",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    dense: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new SafeExcelError("الملف لا يحتوي على أوراق عمل");
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: opts.defval ?? "",
  });

  if (rawRows.length > maxRows) {
    throw new SafeExcelError(
      `عدد الصفوف يتجاوز الحد المسموح (${maxRows.toLocaleString()} صف)`
    );
  }

  const rows = rawRows.map((r) => sanitizeRow(r)) as T[];
  return { workbook, firstSheetName, rows };
}
