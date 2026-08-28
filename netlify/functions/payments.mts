import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { batchUpdate, dateSerialFromIso, getSheetIds, insertRowsRequest, readRange, rowsToObjects, shortId, userValue } from "./_shared/sheets";

const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function num(v: unknown) { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function norm(v: unknown) { return String(v ?? "").trim().toLowerCase(); }
function feeId(year: number, month: string, studentId: string) {
  return `FEE-${year}${String(months.indexOf(month) + 1).padStart(2,"0")}-${studentId.replace(/-/g,"")}`;
}

interface PaymentBody {
  studentId?: string;
  year?: number;
  month?: string;
  paymentDate?: string;
  amount?: number;
  paymentMethod?: string;
  receiptRef?: string;
  notes?: string;
}

export default async (req: Request, context: Context) => {
  const requestId = req.headers.get("x-request-id") || context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is not configured for this environment.", requestId, 401);
  if (actor.role !== "Admin") return fail("PERMISSION_DENIED", "Only an administrator can manage payments by default.", requestId, 403);

  if (req.method === "GET") {
    try {
      const raw = await readRange("Payments!A1:R10000", "FORMATTED_VALUE");
      return ok(rowsToObjects(raw), requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("MISSING") || message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
      return fail("SHEET_READ_FAILED", "Payment records could not be loaded.", requestId, 502);
    }
  }
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Method not allowed.", requestId, 405);

  try {
    const body = await req.json() as PaymentBody;
    const studentId = String(body.studentId || "").trim();
    const year = Number(body.year);
    const month = String(body.month || "").trim();
    const paymentDate = String(body.paymentDate || "").trim();
    const paymentSerial = dateSerialFromIso(paymentDate);
    const amount = Number(body.amount);
    const method = String(body.paymentMethod || "").trim();
    if (!studentId) return fail("VALIDATION_ERROR", "Student is required.", requestId, 422);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) return fail("VALIDATION_ERROR", "Year is invalid.", requestId, 422);
    if (!months.includes(month)) return fail("VALIDATION_ERROR", "Month is invalid.", requestId, 422);
    if (paymentSerial === null) return fail("VALIDATION_ERROR", "A valid payment date is required.", requestId, 422);
    if (!Number.isFinite(amount) || amount <= 0) return fail("VALIDATION_ERROR", "Payment amount must be greater than zero.", requestId, 422);
    if (!method) return fail("VALIDATION_ERROR", "Payment method is required.", requestId, 422);

    const [studentsRaw, feeChangesRaw, feesRaw, paymentsRaw, auditRaw] = await Promise.all([
      readRange("Students!A1:V1000", "UNFORMATTED_VALUE"),
      readRange("'Fee Changes'!A1:J1000", "UNFORMATTED_VALUE"),
      readRange("'Fee Tracker'!A1:R2000", "UNFORMATTED_VALUE"),
      readRange("Payments!A1:R10000", "UNFORMATTED_VALUE"),
      readRange("'Audit Log'!A1:P20000", "UNFORMATTED_VALUE"),
    ]);
    const students = rowsToObjects(studentsRaw) as Record<string, unknown>[];
    const changes = rowsToObjects(feeChangesRaw) as Record<string, unknown>[];
    const fees = rowsToObjects(feesRaw) as Record<string, unknown>[];
    const payments = rowsToObjects(paymentsRaw) as Record<string, unknown>[];

    const previousRequest = payments.find(p => String(p["Request ID"] || "") === requestId && norm(p["Status"]) === "active");
    if (previousRequest) {
      return ok({ paymentId: String(previousRequest["Payment ID"]), idempotent: true, studentId, year, month }, requestId);
    }

    const student = students.find(s => String(s["Student ID"]) === studentId);
    if (!student || norm(student["Status"]) !== "active") return fail("VALIDATION_ERROR", "Student is invalid or inactive.", requestId, 422);

    const targetMonthSerial = Math.floor((Date.UTC(year, months.indexOf(month), 1) - Date.UTC(1899,11,30)) / 86400000);
    let monthlyFee = num(student["Starting Monthly Fee"]);
    const applicable = changes
      .filter(c => String(c["Student ID"]) === studentId && num(c["Effective From"]) <= targetMonthSerial && num(c["Effective From"]) > 0)
      .sort((a,b) => num(b["Effective From"]) - num(a["Effective From"]));
    if (applicable.length) monthlyFee = num(applicable[0]["New Monthly Fee"]);
    if (monthlyFee < 0) return fail("DATA_INTEGRITY_ERROR", "The student's monthly fee is invalid. Fix the student fee before recording a payment.", requestId, 409);

    let fee = fees.find(f => num(f["Year"]) === year && String(f["Month"]) === month && String(f["Student ID"]) === studentId);
    const recordId = fee ? String(fee["Fee Record ID"] || "") || feeId(year, month, studentId) : feeId(year, month, studentId);
    const paidBefore = payments.filter(p => String(p["Fee Record ID"]) === recordId && norm(p["Status"]) === "active").reduce((sum,p) => sum + num(p["Amount"]), 0);
    const balanceBefore = Math.max(monthlyFee - paidBefore, 0);
    if (balanceBefore <= 0) return fail("ALREADY_PAID", "This monthly fee is already fully paid.", requestId, 409);
    if (amount > balanceBefore + 0.0001) return fail("OVERPAYMENT", `This payment exceeds the remaining balance of LKR ${balanceBefore.toLocaleString("en-LK")}.`, requestId, 422);

    const ids = await getSheetIds();
    for (const title of ["Fee Tracker", "Payments", "Audit Log"]) if (typeof ids[title] !== "number") throw new Error(`SHEET_MISSING:${title}`);
    const now = new Date().toISOString();
    const requests: Record<string, unknown>[] = [];

    if (!fee) {
      const feeRowIndex = feesRaw.length;
      const rowNumber = feeRowIndex + 1;
      const nameFormula = `=IF(C${rowNumber}="","",IFERROR(VLOOKUP(C${rowNumber},Students!$A:$B,2,FALSE),"Unknown"))`;
      const paidFormula = `=IF($M${rowNumber}="","",SUMIFS(Payments!$G$2:$G$10000,Payments!$B$2:$B$10000,$M${rowNumber},Payments!$K$2:$K$10000,"Active"))`;
      const balFormula = `=IF(E${rowNumber}="","",MAX(E${rowNumber}-F${rowNumber},0))`;
      const statusFormula = `=IF(E${rowNumber}="","",IF(F${rowNumber}<=0,"Unpaid",IF(F${rowNumber}>=E${rowNumber},"Paid","Partial")))`;
      const feeValues = [year, month, studentId, nameFormula, monthlyFee, paidFormula, balFormula, statusFormula, "", "", "", "", recordId, now, actor.email, now, actor.email, 1];
      requests.push(insertRowsRequest(ids["Fee Tracker"], feeRowIndex));
      requests.push({ updateCells: { start: { sheetId: ids["Fee Tracker"], rowIndex: feeRowIndex, columnIndex: 0 }, rows: [{ values: feeValues.map(userValue) }], fields: "userEnteredValue" } });
    }

    const paymentId = `PAY-${paymentDate.replace(/-/g,"")}-${crypto.randomUUID().replace(/-/g,"").slice(0,8).toUpperCase()}`;
    const paymentRowIndex = paymentsRaw.length;
    const paymentValues = [paymentId, recordId, studentId, year, month, paymentSerial, amount, method, String(body.receiptRef || "").trim(), String(body.notes || "").trim(), "Active", actor.email, now, "", "", "", 1, requestId];
    requests.push(insertRowsRequest(ids["Payments"], paymentRowIndex));
    requests.push({ updateCells: { start: { sheetId: ids["Payments"], rowIndex: paymentRowIndex, columnIndex: 0 }, rows: [{ values: paymentValues.map(userValue) }], fields: "userEnteredValue" } });
    requests.push(insertRowsRequest(ids["Audit Log"], auditRaw.length));
    requests.push({ updateCells: { start: { sheetId: ids["Audit Log"], rowIndex: auditRaw.length, columnIndex: 0 }, rows: [{ values: [
      userValue(shortId("AUD")), userValue(now), userValue(actor.email), userValue(actor.email), userValue(actor.role), userValue("CREATE"), userValue("Payments"), userValue("Payment"), userValue(paymentId), userValue(studentId), {}, {}, userValue(JSON.stringify({ year, month, amount, method, paymentDate })), userValue("Payment recorded from website"), userValue(requestId), userValue("Success"),
    ] }], fields: "userEnteredValue" } });

    await batchUpdate(requests);
    const paidAfter = paidBefore + amount;
    const balanceAfter = Math.max(monthlyFee - paidAfter, 0);
    const status = paidAfter <= 0 ? "Unpaid" : balanceAfter <= 0 ? "Paid" : "Partial";
    return ok({ paymentId, feeRecordId: recordId, studentId, year, month, monthlyFee, paidAfter, balanceAfter, status }, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("MISSING") || message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
    return fail("SHEET_WRITE_FAILED", "The payment was NOT saved to Google Sheets. Please retry.", requestId, 502);
  }
};

export const config: Config = { path: "/api/payments" };
