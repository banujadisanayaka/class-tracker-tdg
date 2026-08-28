import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { batchUpdate, getSheetIds, insertRowsRequest, readRange, shortId, userValue } from "./_shared/sheets";

const allowedStatuses = new Set(["Present", "Absent", "Late", "Excused"]);
function timeFraction(v: string | undefined) {
  if (v === undefined || v === "") return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 23 && min <= 59 ? (h * 60 + min) / 1440 : null;
}

export default async (req: Request, context: Context) => {
  const requestId = req.headers.get("x-request-id") || context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is not configured for this environment.", requestId, 401);
  if (req.method !== "PATCH") return fail("METHOD_NOT_ALLOWED", "Method not allowed.", requestId, 405);
  const attendanceId = context.params.id;
  if (!attendanceId) return fail("VALIDATION_ERROR", "Attendance ID is required.", requestId, 422);

  try {
    const body = await req.json() as { status?: string; checkInTime?: string; notes?: string; reason?: string; expectedVersion?: number };
    const status = String(body.status || "").trim();
    const reason = String(body.reason || "").trim();
    const expectedVersion = Number(body.expectedVersion);
    if (!allowedStatuses.has(status)) return fail("VALIDATION_ERROR", "A valid attendance status is required.", requestId, 422);
    if (!reason) return fail("VALIDATION_ERROR", "A correction reason is required.", requestId, 422);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return fail("VALIDATION_ERROR", "The current record version is required.", requestId, 422);
    const checkIn = timeFraction(body.checkInTime);
    if (checkIn === null) return fail("VALIDATION_ERROR", "Check-in time is invalid.", requestId, 422);

    const [raw, auditRaw] = await Promise.all([
      readRange("Attendance!A1:Q5000", "UNFORMATTED_VALUE"),
      readRange("'Audit Log'!A1:P20000", "UNFORMATTED_VALUE"),
    ]);
    const rawIndex = raw.findIndex((row, i) => i > 0 && String(row[8] ?? "") === attendanceId);
    if (rawIndex < 1) return fail("NOT_FOUND", "Attendance record not found.", requestId, 404);
    const previousRequest = auditRaw.find((row, i) =>
      i > 0 &&
      String(row[14] ?? "") === requestId &&
      String(row[5] ?? "").toUpperCase() === "UPDATE" &&
      String(row[8] ?? "") === attendanceId &&
      String(row[15] ?? "").toLowerCase() === "success"
    );
    if (previousRequest) {
      const row = raw[rawIndex];
      return ok({ attendanceId, status: String(row[3] ?? ""), version: Number(row[15] || 0), idempotent: true }, requestId);
    }
    const row = raw[rawIndex];
    const currentVersion = Number(row[15] || 0);
    const recordStatus = String(row[16] ?? "Active");
    if (recordStatus.toLowerCase() === "voided") return fail("INVALID_STATE", "Voided attendance cannot be corrected.", requestId, 409);
    if (currentVersion !== expectedVersion) return fail("VERSION_CONFLICT", "This attendance record changed after you opened it. Reload before correcting it.", requestId, 409);
    const oldStatus = String(row[3] ?? "");
    const oldCheckIn = row[4] ?? "";
    const oldNotes = String(row[6] ?? "");
    const version = currentVersion + 1;
    const studentId = String(row[1] ?? "");
    const classId = String(row[10] ?? "");
    const now = new Date().toISOString();
    const ids = await getSheetIds();
    if (typeof ids["Attendance"] !== "number" || typeof ids["Audit Log"] !== "number") throw new Error("SHEET_MISSING");

    await batchUpdate([
      { updateCells: { start: { sheetId: ids["Attendance"], rowIndex: rawIndex, columnIndex: 3 }, rows: [{ values: [userValue(status), userValue(checkIn ?? "")] }], fields: "userEnteredValue" } },
      { updateCells: { start: { sheetId: ids["Attendance"], rowIndex: rawIndex, columnIndex: 6 }, rows: [{ values: [userValue(body.notes === undefined ? oldNotes : String(body.notes).trim())] }], fields: "userEnteredValue" } },
      { updateCells: { start: { sheetId: ids["Attendance"], rowIndex: rawIndex, columnIndex: 12 }, rows: [{ values: [userValue(actor.email), userValue(now), userValue(reason), userValue(version)] }], fields: "userEnteredValue" } },
      insertRowsRequest(ids["Audit Log"], auditRaw.length),
      { updateCells: { start: { sheetId: ids["Audit Log"], rowIndex: auditRaw.length, columnIndex: 0 }, rows: [{ values: [
        userValue(shortId("AUD")), userValue(now), userValue(actor.email), userValue(actor.email), userValue(actor.role), userValue("UPDATE"), userValue("Attendance"), userValue("Attendance"), userValue(attendanceId), userValue(studentId), userValue(classId), userValue(JSON.stringify({ status: oldStatus, checkIn: oldCheckIn, notes: oldNotes })), userValue(JSON.stringify({ status, checkIn: checkIn ?? "", notes: body.notes === undefined ? oldNotes : String(body.notes).trim() })), userValue(reason), userValue(requestId), userValue("Success"),
      ] }], fields: "userEnteredValue" } },
    ]);
    return ok({ attendanceId, status, version }, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("MISSING") || message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
    return fail("SHEET_WRITE_FAILED", "The attendance correction was NOT saved to Google Sheets. Please retry.", requestId, 502);
  }
};

export const config: Config = { path: "/api/attendance/:id" };
