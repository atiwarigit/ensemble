import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCsv,
  dedupeHash,
  guessMapping,
  maskAccount,
  parseAmountMinor,
  parseCsv,
  parseDate,
  transformRows,
  type MappingConfig,
} from "@/lib/csv/expenses-csv";
import type { ColumnMap } from "@/db/schema/expenses";

const sample = (name: string) => readFileSync(path.join(__dirname, "../../samples/bank-csv", name));

function load(name: string) {
  const { text, encoding } = decodeCsv(sample(name));
  const parsed = parseCsv(text);
  const guess = guessMapping(parsed.headers, parsed.rows);
  const mapping: MappingConfig = {
    columnMap: guess.columnMap as ColumnMap,
    amountMode: guess.amountMode,
    dateFormat: guess.dateFormat,
  };
  return { parsed, guess, encoding, rows: transformRows(parsed.headers, parsed.rows, mapping) };
}

describe("parseAmountMinor", () => {
  it.each([
    ["12.34", 1234],
    ["-12.34", -1234],
    ["$1,234.56", 123456],
    ["(45.00)", -4500],
    ["45.00-", -4500],
    ["1.234,56", 123456],
    ["-4,80", -480],
    ["7", 700],
    ["12.5", 1250],
    ["100.00 CR", 10000],
    ["100.00 DR", -10000],
    ["USD 9.99", 999],
  ])("%s → %i", (raw, expected) => expect(parseAmountMinor(raw)).toBe(expected));

  it.each(["", "abc", "1.2.3", "12.345"])("rejects %j", (raw) => expect(parseAmountMinor(raw)).toBeNull());
});

describe("parseDate", () => {
  it("parses each supported format", () => {
    expect(parseDate("2026-10-05", "YYYY-MM-DD")).toBe("2026-10-05");
    expect(parseDate("10/05/2026", "MM/DD/YYYY")).toBe("2026-10-05");
    expect(parseDate("05/10/2026", "DD/MM/YYYY")).toBe("2026-10-05");
    expect(parseDate("10/5/26", "M/D/YY")).toBe("2026-10-05");
    expect(parseDate("05.10.2026", "DD.MM.YYYY")).toBe("2026-10-05");
    expect(parseDate("2026-10-05T12:00:00", "YYYY-MM-DD")).toBe("2026-10-05");
  });
  it("rejects impossible dates", () => {
    expect(parseDate("31/09/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("02/30/2026", "MM/DD/YYYY")).toBeNull();
  });
});

describe("maskAccount", () => {
  it("keeps only the last 4 digits", () => {
    expect(maskAccount("4111 1111 1111 1234")).toBe("••1234");
    expect(maskAccount("-41007")).toBe("••1007");
    expect(maskAccount("")).toBeNull();
  });
});

describe("sample bank exports", () => {
  it("Chase checking: negative = expense, flags credits, refunds and transfers", () => {
    const { guess, rows } = load("chase-checking-2026-10.csv");
    expect(guess.columnMap).toMatchObject({ date: "Posting Date", description: "Description", amount: "Amount" });
    expect(guess.amountMode).toBe("negative_is_expense");
    expect(guess.dateFormat).toBe("MM/DD/YYYY");
    const byStatus = Object.groupBy(rows, (r) => r.status);
    expect(byStatus.ok?.length).toBe(12);
    expect(byStatus.credit?.map((r) => r.description)).toEqual([
      "CREATE MUSIC GROUP ROYALTY PPD ID: 1234567",
      "SPLICE.COM REFUND",
    ]);
    expect(byStatus.transfer?.length).toBe(1);
    const suno = rows.find((r) => r.description.startsWith("SUNO"))!;
    expect(suno).toMatchObject({ date: "2026-10-27", amountMinor: 3000, currency: "USD" });
  });

  it("identical rows in one file get increasing occurrence numbers", () => {
    const { rows } = load("chase-checking-2026-10.csv");
    const meta = rows.filter((r) => r.description.startsWith("META ADS"));
    expect(meta.map((r) => r.occurrence)).toEqual([0, 1]);
  });

  it("Amex: positive = expense and masks the account", () => {
    const { guess, rows } = load("amex-gold-2026-10.csv");
    expect(guess.amountMode).toBe("positive_is_expense");
    expect(guess.columnMap.account).toBe("Account #");
    expect(rows[0]).toMatchObject({ amountMinor: 41280, account: "••1007", status: "ok" });
    expect(rows.find((r) => r.description.startsWith("AUTOPAY"))?.status).toBe("transfer");
    expect(rows.find((r) => r.description.includes("REFUND"))?.status).toBe("credit");
  });

  it("Capital One: split debit/credit columns with ISO dates", () => {
    const { guess, rows } = load("capital-one-2026-q3.csv");
    expect(guess.amountMode).toBe("split");
    expect(guess.dateFormat).toBe("YYYY-MM-DD");
    expect(guess.columnMap).toMatchObject({ date: "Transaction Date", debit: "Debit", credit: "Credit", category: "Category" });
    expect(rows.filter((r) => r.status === "ok")).toHaveLength(6);
    expect(rows.find((r) => r.description.includes("MOBILE PAYMENT"))?.status).toBe("transfer");
  });

  it("Latin-1, semicolons and decimal commas, with per-row errors", () => {
    const { encoding, parsed, guess, rows } = load("messy-semicolon-latin1.csv");
    expect(encoding).toBe("windows-1252");
    expect(parsed.delimiter).toBe(";");
    expect(guess.dateFormat).toBe("DD/MM/YYYY");
    expect(rows[0]).toMatchObject({ description: "Café Mozart Wien", amountMinor: 480, status: "ok" });
    const errors = rows.filter((r) => r.status === "error");
    expect(errors.map((r) => r.errors[0])).toEqual([
      "Currency EUR isn't supported yet (USD only)",
      'Date "31/09/2026" doesn\'t match DD/MM/YYYY',
      "Missing amount",
    ]);
  });
});

describe("dedupeHash", () => {
  const base = { workspaceId: "w", date: "2026-10-01", amountMinor: 3000, description: "SUNO  INC", accountLast4: null, occurrence: 0 };
  it("ignores case and whitespace in the description", () => {
    expect(dedupeHash(base)).toBe(dedupeHash({ ...base, description: "suno inc" }));
  });
  it("differs by occurrence, amount and workspace", () => {
    expect(dedupeHash(base)).not.toBe(dedupeHash({ ...base, occurrence: 1 }));
    expect(dedupeHash(base)).not.toBe(dedupeHash({ ...base, amountMinor: 3001 }));
    expect(dedupeHash(base)).not.toBe(dedupeHash({ ...base, workspaceId: "x" }));
  });
});
