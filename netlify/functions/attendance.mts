import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { batchUpdate, dateSerialFromIso, getSheetIds, insertRowsRequest, readRange, rowsToObjects, shortId, userValue } from "./_shared/sheets";

const allowedStatuses = new Set(["Present", "Absent", "Late", "Excused"]);
function norm(v: unknown) { return String(v ?? "").trim().toLowerCase(); }
function timeFraction(v: string | undefined) {
  if (!v) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return (h * 60 + min) / 1440;
}

interface AttendanceEntry { studentId?: string; status?: string; checkInTime?: string; notes?: string; }
interface AttendanceBody { classId?: string; date?: string; entries?: AttendanceEntry[]; }

export default async (req: Request, context: Context) => {
  const requestId = req.headers.get("x-request-id") || context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is not configured for this environment.", requestId, 401);
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Method not allowed.", requestId, 405);

  try {
    const body = await req.json() as AttendanceBody;
    const classId = String(body.classId || "").trim();
    const date = String(body.date || "").trim();
    const dateSerial = dateSerialFromIso(date);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!classId) return fail("VALIDATION_ERROR", "Class is required.", requestId, 422);
    if (dateSerial === null) return fail("VALIDATION_ERROR", "A valid attendance date is required.", requestId, 422);
    if (!entries.length) return fail("VALIDATION_ERROR", "Attendance entries are required.", requestId, 422);

    const seen = new Set<string>();
    for (const e of entries) {
      const sid = String(e.studentId || "").trim();
      const status = String(e.status || "").trim();
      if (!sid || !allowedStatuses.has(status)) return fail("VALIDATION_ERROR", "Every student must have a valid attendance status.", requestId, 422);
      if (seen.has(sid)) return fail("DUPLICATE_RECORD", `Student ${sid} appears more than once in this attendance submission.`, requestId, 409);
      seen.add(sid);
      if (timeFraction(e.checkInTime) === null) return fail("VALIDATION_ERROR", `Invalid check-in time for ${sid}.`, requestId, 422);
    }

    const [studentsRaw, classesRaw, enrollRaw, sessionsRaw, attendanceRaw, auditRaw] = await Promise.all([
      readRange("Students!A1:V1000", "FORMATTED_VALUE"),
      readRange("Classes!A1:P1000", "FORMATTED_VALUE"),
      readRange("Enrollments!A1:L5000", "UNFORMATTED_VALUE"),
      readRange("'Class Sessions'!A1:L5000", "UNFORMATTED_VALUE"),
      readRange("Attendance!A1:Q5000", "UNFORMATTED_VALUE"),
      readRange("'Audit Log'!A1:P20000", "UNFORMATTED_VALUE"),
    ]);
    const students = rowsToObjects(studentsRaw) as Record<string, unknown>[];
    const classes = rowsToObjects(classesRaw) as Record<string, unknown>[];
    const enrollments = rowsToObjects(enrollRaw) as Record<string, unknown>[];
    const sessions = rowsToObjects(sessionsRaw) as Record<string, unknown>[];
    const attendance = rowsToObjects(attendanceRaw) as Record<string, unknown>[];
    const audit = rowsToObjects(auditRaw) as Record<string, unknown>[];
    const previousRequest = audit.find(a =>
      String(a["Request ID"] || "") === requestId &&
      norm(a["Module"]) === "attendance" &&
      norm(a["Action"]) === "create_batch" &&
      norm(a["Result"]) === "success"
    );
    if (previousRequest) {
      return ok({
        sessionId: String(previousRequest["Record ID"] || ""),
        classId,
        date,
        saved: entries.length,
        idempotent: true,
      }, requestId);
    }
    const klass = classes.find(c => String(c["Class ID"]) === classId && norm(c["Status"]) === "active");
    if (!klass) return fail("VALIDATION_ERROR", "The selected class is invalid or inactive.", requestId, 422);

    const studentMap = new Map(students.map(s => [String(s["Student ID"]), s]));
    const validEnrollment = new Set(enrollments.filter(e => {
      if (String(e["Class ID"]) !== classId || norm(e["Status"]) !== "active") return false;
      const from = Number(e["Enrolled From"] || 0);
      const until = Number(e["Enrolled Until"] || 0);
      return (from <= 0 || from <= dateSerial) && (until <= 0 || until >= dateSerial);
    }).map(e => String(e["Student ID"])));
    for (const e of entries) {
      const sid = String(e.studentId);
      const student = studentMap.get(sid);
      if (!student || norm(student["Status"]) !== "active") return fail("VALIDATION_ERROR", `Student ${sid} is invalid or inactive.`, requestId, 422);
      if (!validEnrollment.has(sid)) return fail("VALIDATION_ERROR", `Student ${sid} is not actively enrolled in this class.`, requestId, 422);
    }

    let sessionId = "";
    const existingSession = sessions.find(s => String(s["Class ID"]) === classId && Number(s["Session Date"]) === dateSerial && norm(s["Status"]) !== "cancelled");
    if (existingSession) sessionId = String(existingSession["Session ID"]);
    else sessionId = `SES-${date.replace(/-/g, "")}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    const existingKeys = new Set(attendance.filter(a => norm(a["Record Status"] || "Active") !== "voided").map(a => `${String(a["Session ID"])}|${String(a["Student ID"])}`));
    for (const e of entries) {
      const key = `${sessionId}|${String(e.studentId)}`;
      if (existingKeys.has(key)) return fail("DUPLICATE_RECORD", `Attendance for ${String(e.studentId)} has already been saved for this session. Use Correct Attendance instead.`, requestId, 409);
    }

    const ids = await getSheetIds();
    for (const title of ["Class Sessions", "Attendance", "Audit Log"]) if (typeof ids[title] !== "number") throw new Error(`SHEET_MISSING:${title}`);
    const now = new Date().toISOString();
    const requests: Record<string, unknown>[] = [];
    if (!existingSession) {
      requests.push(insertRowsRequest(ids["Class Sessions"], sessionsRaw.length));
      requests.push({ updateCells: { start: { sheetId: ids["Class Sessions"], rowIndex: sessionsRaw.length, columnIndex: 0 }, rows: [{ values: [
        userValue(sessionId), userValue(classId), userValue(dateSerial), {}, {}, userValue("Completed"), userValue("Created automatically when attendance was saved."), userValue(now), userValue(actor.email), userValue(now), userValue(actor.email), userValue(1),
      ] }], fields: "userEnteredValue" } });
    }

    const firstRowIndex = attendanceRaw.length;
    const className = String(klass["Class Name"] || "");
    const attendanceRows = entries.map((e, offset) => {
      const rowNumber = firstRowIndex + offset + 1;
      const sid = String(e.studentId);
      const attId = `ATT-${date.replace(/-/g, "")}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      return { values: [
        userValue(dateSerial), userValue(sid), userValue(`=IF(B${rowNumber}="","",IFERROR(VLOOKUP(B${rowNumber},Students!$A:$B,2,FALSE),"Unknown"))`), userValue(String(e.status)), userValue(timeFraction(e.checkInTime) ?? ""), userValue(className), userValue(String(e.notes || "").trim()), userValue(actor.email), userValue(attId), userValue(sessionId), userValue(classId), userValue(now), {}, {}, {}, userValue(1), userValue("Active"),
      ] };
    });
    requests.push(insertRowsRequest(ids["Attendance"], firstRowIndex, attendanceRows.length));
    requests.push({ updateCells: { start: { sheetId: ids["Attendance"], rowIndex: firstRowIndex, columnIndex: 0 }, rows: attendanceRows, fields: "userEnteredValue" } });
    requests.push(insertRowsRequest(ids["Audit Log"], auditRaw.length));
    requests.push({ updateCells: { start: { sheetId: ids["Audit Log"], rowIndex: auditRaw.length, columnIndex: 0 }, rows: [{ values: [
      userValue(shortId("AUD")), userValue(now), userValue(actor.email), userValue(actor.email), userValue(actor.role), userValue("CREATE_BATCH"), userValue("Attendance"), userValue("Attendance Batch"), userValue(sessionId), {}, userValue(classId), {}, userValue(JSON.stringify({ date, count: entries.length, students: entries.map(e => e.studentId) })), userValue("Attendance saved from website"), userValue(requestId), userValue("Success"),
    ] }], fields: "userEnteredValue" } });

    await batchUpdate(requests);
    return ok({ sessionId, classId, date, saved: entries.length }, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("MISSING") || message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
    return fail("SHEET_WRITE_FAILED", "Attendance was NOT saved to Google Sheets. Please retry.", requestId, 502);
  }
};

export const config: Config = { path: "/api/attendance" };
