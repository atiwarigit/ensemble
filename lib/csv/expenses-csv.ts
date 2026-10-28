import { createHash } from "node:crypto";
import Papa from "papaparse";
import type { AmountMode, ColumnMap } from "@/db/schema/expenses";

export const SUPPORTED_CURRENCIES = ["USD"] as const;
export const DEFAULT_CURRENCY = "USD";
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export const DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "M/D/YY", "DD.MM.YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Bank exports are UTF-8 (often with a BOM) or Windows-1252/Latin-1. */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export type ParsedCsv = { headers: string[]; rows: string[][]; delimiter: string };

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
  });
  const [headerRow = [], ...rows] = result.data;
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: rows.filter((r) => r.some((c) => c.trim() !== "")), delimiter: result.meta.delimiter };
}

export function headerSignature(headers: string[]) {
  const normalized = headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

const HEADER_HINTS: Record<keyof ColumnMap, RegExp> = {
  date: /^(transaction |trans\.? |posting |posted )?date$|^date posted$|^booking date$/i,
  description: /^(description|details|narrative|memo|transaction description|payee|name)$/i,
  amount: /^(amount|transaction amount|amount \(usd\)|value)$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|paid out)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|paid in)$/i,
  merchant: /^(merchant|merchant name|payee|vendor)$/i,
  category: /^(category|type of transaction)$/i,
  account: /^(account|account #|account number|card|card no\.?|card number|card last 4)$/i,
  currency: /^(currency|ccy)$/i,
};

/** Best-effort column mapping from header names. */
export function guessMapping(headers: string[], sample: string[][] = []): {
  columnMap: Partial<ColumnMap>;
  amountMode: AmountMode;
  dateFormat: DateFormat;
} {
  const find = (key: keyof ColumnMap, exclude: string[] = []) =>
    headers.find((h) => HEADER_HINTS[key].test(h.trim()) && !exclude.includes(h)) ?? null;

  const date = find("date") ?? headers.find((h) => /date/i.test(h)) ?? null;
  const description =
    headers.find((h) => /^(transaction )?description$/i.test(h.trim())) ??
    find("description") ??
    headers.find((h) => /desc/i.test(h)) ??
    null;
  const merchant = find("merchant", description ? [description] : []);
  const amount = find("amount");
  const debit = find("debit");
  const credit = find("credit");
  const columnMap: Partial<ColumnMap> = {
    date: date ?? undefined,
    description: description ?? undefined,
    merchant,
    amount: amount ?? null,
    debit: amount ? null : debit,
    credit: amount ? null : credit,
    category: find("category"),
    account: find("account"),
    currency: find("currency"),
  };

  let amountMode: AmountMode = "negative_is_expense";
  if (!amount && debit) amountMode = "split";
  else if (amount) {
    const idx = headers.indexOf(amount);
    const values = sample.map((r) => parseAmountMinor(r[idx] ?? "")).filter((v): v is number => v !== null);
    const negatives = values.filter((v) => v < 0).length;
    // Card exports (e.g. Amex) list charges as positive numbers.
    if (values.length && negatives / values.length < 0.3) amountMode = "positive_is_expense";
  }

  let dateFormat: DateFormat = "MM/DD/YYYY";
  if (date) {
    const idx = headers.indexOf(date);
    const values = sample.map((r) => r[idx]?.trim() ?? "").filter(Boolean);
    dateFormat = guessDateFormat(values);
  }
  return { columnMap, amountMode, dateFormat };
}

/** Picks the format that parses the most sample values; ties go to the earlier (more common) format. */
export function guessDateFormat(values: string[]): DateFormat {
  let best: DateFormat = "MM/DD/YYYY";
  let bestCount = 0;
  for (const f of DATE_FORMATS) {
    const count = values.filter((v) => parseDate(v, f) !== null).length;
    if (count > bestCount) [best, bestCount] = [f, count];
  }
  return best;
}

/** Returns ISO `YYYY-MM-DD`, or null when the value doesn't match the format or isn't a real date. */
export function parseDate(raw: string, format: DateFormat): string | null {
  const v = raw.trim().split(/[ T]/)[0];
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  switch (format) {
    case "YYYY-MM-DD":
      match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return null;
      [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
    case "MM/DD/YYYY":
      match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) return null;
      [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
    case "DD/MM/YYYY":
      match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) return null;
      [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
    case "M/D/YY":
      match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (!match) return null;
      [m, d, y] = [Number(match[1]), Number(match[2]), 2000 + Number(match[3])];
      break;
    case "DD.MM.YYYY":
      match = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (!match) return null;
      [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parses a money string into signed minor units (cents). Handles currency symbols, thousands
 * separators, parentheses and trailing minus/CR/DR. Decimal comma is accepted when unambiguous.
 */
export function parseAmountMinor(raw: string): number | null {
  let v = raw.trim();
  if (!v) return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (/\s*(CR)$/i.test(v)) v = v.replace(/\s*CR$/i, "");
  if (/\s*(DR)$/i.test(v)) {
    negative = true;
    v = v.replace(/\s*DR$/i, "");
  }
  if (v.endsWith("-")) {
    negative = !negative;
    v = v.slice(0, -1);
  }
  if (v.startsWith("-")) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.startsWith("+")) v = v.slice(1);
  v = v.replace(/[$€£\s]|USD/gi, "");
  if (v.startsWith("-")) {
    negative = !negative;
    v = v.slice(1);
  }
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(v) || /^\d+,\d{1,2}$/.test(v)) {
    v = v.replace(/\./g, "").replace(",", ".");
  } else {
    v = v.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -minor : minor;
}

export function maskAccount(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return `••${digits.slice(-4)}`;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

export function normalizeDescription(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function dedupeHash(parts: {
  workspaceId: string;
  date: string;
  amountMinor: number;
  description: string;
  accountLast4: string | null;
  occurrence: number;
}) {
  return createHash("sha256")
    .update(
      [
        parts.workspaceId,
        parts.date,
        String(parts.amountMinor),
        normalizeDescription(parts.description),
        parts.accountLast4 ?? "",
        String(parts.occurrence),
      ].join("\u001f"),
    )
    .digest("hex");
}

const TRANSFER_PATTERN =
  /\b(payment thank you|autopay|online transfer|transfer (to|from)|zelle (to|from)|credit card payment|internal transfer|mobile payment)\b/i;

export type RowStatus = "ok" | "credit" | "transfer" | "error";

export type TransformedRow = {
  line: number;
  status: RowStatus;
  errors: string[];
  date: string | null;
  /** Positive = money spent. */
  amountMinor: number | null;
  currency: string;
  description: string;
  merchant: string | null;
  categoryText: string | null;
  account: string | null;
  /** Nth identical (date, amount, description, account) row within this file, starting at 0. */
  occurrence: number;
};

export type MappingConfig = { columnMap: ColumnMap; amountMode: AmountMode; dateFormat: DateFormat };

export function validateMapping(headers: string[], m: MappingConfig): string | null {
  const has = (col?: string | null) => !col || headers.includes(col);
  if (!m.columnMap.date || !headers.includes(m.columnMap.date)) return "Choose the date column.";
  if (!m.columnMap.description || !headers.includes(m.columnMap.description)) return "Choose the description column.";
  if (m.amountMode === "split") {
    if (!m.columnMap.debit || !headers.includes(m.columnMap.debit)) return "Choose the debit (money out) column.";
    if (!has(m.columnMap.credit)) return "The credit column isn't in this file.";
  } else if (!m.columnMap.amount || !headers.includes(m.columnMap.amount)) {
    return "Choose the amount column.";
  }
  for (const key of ["merchant", "category", "account", "currency"] as const) {
    if (!has(m.columnMap[key])) return `The ${key} column isn't in this file.`;
  }
  if (!DATE_FORMATS.includes(m.dateFormat)) return "Choose a date format.";
  return null;
}

/** Applies a column mapping to raw rows. Credits/refunds and transfers are flagged so they can be excluded. */
export function transformRows(headers: string[], rows: string[][], m: MappingConfig): TransformedRow[] {
  const col = (name?: string | null) => (name ? headers.indexOf(name) : -1);
  const idx = {
    date: col(m.columnMap.date),
    description: col(m.columnMap.description),
    amount: col(m.columnMap.amount),
    debit: col(m.columnMap.debit),
    credit: col(m.columnMap.credit),
    merchant: col(m.columnMap.merchant),
    category: col(m.columnMap.category),
    account: col(m.columnMap.account),
    currency: col(m.columnMap.currency),
  };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const seen = new Map<string, number>();

  return rows.map((r, i) => {
    const errors: string[] = [];
    const line = i + 2;
    const rawDate = cell(r, idx.date);
    const date = parseDate(rawDate, m.dateFormat);
    if (!date) errors.push(rawDate ? `Date "${rawDate}" doesn't match ${m.dateFormat}` : "Missing date");

    let signed: number | null = null;
    if (m.amountMode === "split") {
      const debit = parseAmountMinor(cell(r, idx.debit));
      const credit = parseAmountMinor(cell(r, idx.credit));
      if (debit !== null && debit !== 0) signed = Math.abs(debit);
      else if (credit !== null && credit !== 0) signed = -Math.abs(credit);
      else if (debit === 0 || credit === 0) signed = 0;
      else errors.push("Missing debit/credit amount");
    } else {
      const rawAmount = cell(r, idx.amount);
      const parsed = parseAmountMinor(rawAmount);
      if (parsed === null) errors.push(rawAmount ? `Amount "${rawAmount}" isn't a number` : "Missing amount");
      else signed = m.amountMode === "negative_is_expense" ? -parsed : parsed;
    }

    const description = cell(r, idx.description);
    if (!description) errors.push("Missing description");
    const currency = (cell(r, idx.currency) || DEFAULT_CURRENCY).toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
      errors.push(`Currency ${currency} isn't supported yet (USD only)`);
    }
    const account = maskAccount(cell(r, idx.account));

    let status: RowStatus = "ok";
    if (errors.length) status = "error";
    else if (TRANSFER_PATTERN.test(description)) status = "transfer";
    else if (signed !== null && signed <= 0) status = "credit";

    let occurrence = 0;
    if (date && signed !== null) {
      const key = [date, signed, normalizeDescription(description), account ?? ""].join("|");
      occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
    }

    return {
      line,
      status,
      errors,
      date,
      amountMinor: signed,
      currency,
      description,
      merchant: cell(r, idx.merchant) || null,
      categoryText: cell(r, idx.category) || null,
      account,
      occurrence,
    };
  });
}
