import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { batchUpdate, dateSerialFromIso, getSheetIds, insertRowsRequest, readRange, rowsToObjects, shortId, userValue } from "./_shared/sheets";

function num(v: unknown) {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function norm(v: unknown) { return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " "); }
function nextStudentId(rows: Record<string, unknown>[]) {
  const max = rows.reduce((m, r) => {
    const hit = /^STU-(\d+)$/.exec(String(r["Student ID"] || ""));
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `STU-${String(max + 1).padStart(4, "0")}`;
}

interface StudentBody {
  name?: string;
  birthday?: string;
  admitDate?: string;
  phone?: string;
  whatsapp?: string;
  guardianName?: string;
  relationship?: string;
  guardianPhone?: string;
  guardianWhatsapp?: string;
  address?: string;
  startingFee?: number;
  notes?: string;
  classIds?: string[];
  forceDuplicate?: boolean;
}

export default async (req: Request, context: Context) => {
  const requestId = req.headers.get("x-request-id") || context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is not configured for this environment.", requestId, 401);

  if (req.method === "GET") {
    try {
      const raw = await readRange("Students!A1:V1000", "FORMATTED_VALUE");
      const rows = rowsToObjects(raw) as Record<string, unknown>[];
      return ok(rows.map(r => ({
        id: String(r["Student ID"] || ""),
        name: String(r["Student Name"] || ""),
        birthday: String(r["Birthday"] || ""),
        admitDate: String(r["Admit Date"] || ""),
        phone: String(r["Student Telephone"] || ""),
        whatsapp: String(r["Student WhatsApp"] || ""),
        guardianName: String(r["Parent / Guardian Name"] || ""),
        relationship: String(r["Relationship"] || ""),
        guardianPhone: String(r["Parent Telephone"] || ""),
        guardianWhatsapp: String(r["Parent WhatsApp"] || ""),
        address: String(r["Address"] || ""),
        startingFee: num(r["Starting Monthly Fee"]),
        status: String(r["Status"] || ""),
        notes: String(r["Notes"] || ""),
        currentFee: num(r["Current Monthly Fee (Auto)"]),
      })), requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const config = message.includes("MISSING") || message.includes("AUTH_FAILED");
      return fail(config ? "SHEET_CONFIGURATION_REQUIRED" : "SHEET_READ_FAILED", config ? "Google Sheets backend credentials are not configured yet." : "Student records could not be loaded.", requestId, config ? 503 : 502);
    }
  }

  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Method not allowed.", requestId, 405);
  if (actor.role !== "Admin") return fail("PERMISSION_DENIED", "Only an administrator can add students.", requestId, 403);

  try {
    const body = await req.json() as StudentBody;
    const name = String(body.name || "").trim();
    const admitDate = String(body.admitDate || "").trim();
    const startingFee = Number(body.startingFee);
    const classIds = Array.isArray(body.classIds) ? [...new Set(body.classIds.map(String).filter(Boolean))] : [];
    if (!name) return fail("VALIDATION_ERROR", "Student name is required.", requestId, 422);
    if (!admitDate || dateSerialFromIso(admitDate) === null) return fail("VALIDATION_ERROR", "A valid admit date is required.", requestId, 422);
    if (!Number.isFinite(startingFee) || startingFee < 0) return fail("VALIDATION_ERROR", "Starting monthly fee must be zero or more.", requestId, 422);
    if (!classIds.length) return fail("VALIDATION_ERROR", "Select at least one class.", requestId, 422);

    const [studentsRaw, classesRaw, enrollmentsRaw, auditRaw] = await Promise.all([
      readRange("Students!A1:V1000", "FORMATTED_VALUE"),
      readRange("Classes!A1:P1000", "FORMATTED_VALUE"),
      readRange("Enrollments!A1:L5000", "UNFORMATTED_VALUE"),
      readRange("'Audit Log'!A1:P20000", "UNFORMATTED_VALUE"),
    ]);
    const students = rowsToObjects(studentsRaw) as Record<string, unknown>[];
    const classes = rowsToObjects(classesRaw) as Record<string, unknown>[];
    const selectedClasses = classIds.map(id => classes.find(c => String(c["Class ID"]) === id && norm(c["Status"]) === "active")).filter(Boolean) as Record<string, unknown>[];
    if (selectedClasses.length !== classIds.length) return fail("VALIDATION_ERROR", "One or more selected classes are invalid or inactive.", requestId, 422);

    const birthday = String(body.birthday || "").trim();
    const phone = String(body.phone || "").trim();
    const duplicate = students.find(s => norm(s["Student Name"]) === norm(name) && ((phone && String(s["Student Telephone"] || "").trim() === phone) || (birthday && String(s["Birthday"] || "").trim() === birthday)));
    if (duplicate && !body.forceDuplicate) {
      return fail("POSSIBLE_DUPLICATE", `A similar student already exists (${String(duplicate["Student ID"])}). Review that profile before adding another record.`, requestId, 409);
    }

    const ids = await getSheetIds();
    for (const title of ["Students", "Enrollments", "Audit Log"]) if (typeof ids[title] !== "number") throw new Error(`SHEET_MISSING:${title}`);
    const studentId = nextStudentId(students);
    const now = new Date().toISOString();
    const nextRowNumber = studentsRaw.length + 1;
    const studentRowIndex = nextRowNumber - 1;
    const admitSerial = dateSerialFromIso(admitDate)!;
    const birthdaySerial = birthday ? dateSerialFromIso(birthday) : null;
    if (birthday && birthdaySerial === null) return fail("VALIDATION_ERROR", "Birthday must be a valid date.", requestId, 422);
    const primaryClass = String(selectedClasses[0]["Class Name"] || "");
    const ageFormula = `=IF(C${nextRowNumber}="","",DATEDIF(C${nextRowNumber},TODAY(),"Y"))`;
    const feeFormula = `=IF(A${nextRowNumber}="","",IFERROR(LOOKUP(2,1/(('Fee Changes'!$A$2:$A$1000=A${nextRowNumber})*('Fee Changes'!$B$2:$B$1000<=TODAY())),'Fee Changes'!$C$2:$C$1000),IF(M${nextRowNumber}<>"",M${nextRowNumber},Settings!$B$3)))`;

    const studentValues = [
      studentId, name, birthdaySerial ?? "", ageFormula, admitSerial,
      String(body.phone || "").trim(), String(body.whatsapp || "").trim(), String(body.guardianName || "").trim(), String(body.relationship || "").trim(), String(body.guardianPhone || "").trim(), String(body.guardianWhatsapp || "").trim(), String(body.address || "").trim(),
      startingFee, primaryClass, "Active", String(body.notes || "").trim(), feeFormula,
      now, actor.email, now, actor.email, 1,
    ];

    const enrollmentRows = selectedClasses.map((c, index) => ({ values: [
      userValue(shortId("ENR")), userValue(studentId), userValue(String(c["Class ID"])), userValue(admitSerial), {}, userValue("Active"), userValue(index === 0 ? "Primary enrollment created from website." : "Additional enrollment created from website."), userValue(now), userValue(actor.email), userValue(now), userValue(actor.email), userValue(1),
    ] }));
    const auditId = shortId("AUD");
    const auditRow = { values: [
      userValue(auditId), userValue(now), userValue(actor.email), userValue(actor.email), userValue(actor.role), userValue("CREATE"), userValue("Students"), userValue("Student"), userValue(studentId), userValue(studentId), {}, {}, userValue(JSON.stringify({ name, classIds, startingFee })), userValue("Student created from website"), userValue(requestId), userValue("Success"),
    ] };

    await batchUpdate([
      insertRowsRequest(ids["Students"], studentRowIndex),
      { updateCells: { start: { sheetId: ids["Students"], rowIndex: studentRowIndex, columnIndex: 0 }, rows: [{ values: studentValues.map(userValue) }], fields: "userEnteredValue" } },
      insertRowsRequest(ids["Enrollments"], enrollmentsRaw.length, enrollmentRows.length),
      { updateCells: { start: { sheetId: ids["Enrollments"], rowIndex: enrollmentsRaw.length, columnIndex: 0 }, rows: enrollmentRows, fields: "userEnteredValue" } },
      insertRowsRequest(ids["Audit Log"], auditRaw.length),
      { updateCells: { start: { sheetId: ids["Audit Log"], rowIndex: auditRaw.length, columnIndex: 0 }, rows: [auditRow], fields: "userEnteredValue" } },
    ]);

    return ok({ id: studentId, name, status: "Active", classIds }, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("MISSING") || message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
    return fail("SHEET_WRITE_FAILED", "The student was NOT saved to Google Sheets. Please retry.", requestId, 502);
  }
};

export const config: Config = { path: "/api/students" };
