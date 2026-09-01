import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { batchUpdate, dateSerialFromIso, getSheetIds, insertRowsRequest, isoFromGoogleSerial, readRange, rowsToObjects, shortId, userValue } from "./_shared/sheets";

function num(v: unknown) {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function norm(v: unknown) { return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " "); }
function timeString(v: unknown) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 1) return "";
  const total = Math.round(n * 1440);
  const h = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}
function localDateSerial() {
  const tz = Netlify.env.get("APP_TIME_ZONE") || "Asia/Colombo";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return dateSerialFromIso(`${get("year")}-${get("month")}-${get("day")}`)!;
}

const allowedStatuses = new Set(["Active", "Inactive", "Left", "Archived"]);

interface StudentUpdateBody {
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
  status?: string;
  classIds?: string[];
  reason?: string;
  expectedVersion?: number;
}

function studentFromRow(r: Record<string, unknown>) {
  return {
    id: String(r["Student ID"] || ""),
    name: String(r["Student Name"] || ""),
    birthday: isoFromGoogleSerial(r["Birthday"]),
    admitDate: isoFromGoogleSerial(r["Admit Date"]),
    phone: String(r["Student Telephone"] || ""),
    whatsapp: String(r["Student WhatsApp"] || ""),
    guardianName: String(r["Parent / Guardian Name"] || ""),
    relationship: String(r["Relationship"] || ""),
    guardianPhone: String(r["Parent Telephone"] || ""),
    guardianWhatsapp: String(r["Parent WhatsApp"] || ""),
    address: String(r["Address"] || ""),
    startingFee: num(r["Starting Monthly Fee"]),
    primaryClass: String(r["Primary Class"] || ""),
    status: String(r["Status"] || ""),
    notes: String(r["Notes"] || ""),
    currentFee: num(r["Current Monthly Fee (Auto)"]),
    createdAt: String(r["Created At"] || ""),
    createdBy: String(r["Created By"] || ""),
    updatedAt: String(r["Updated At"] || ""),
    updatedBy: String(r["Updated By"] || ""),
    version: Math.max(1, num(r["Record Version"])),
  };
}

export default async (req: Request, context: Context) => {
  const requestId = req.headers.get("x-request-id") || context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is not configured for this environment.", requestId, 401);
  const studentId = String(context.params.id || "").trim();
  if (!studentId) return fail("VALIDATION_ERROR", "Student ID is required.", requestId, 422);

  if (req.method === "GET") {
    try {
      const [studentsRaw, enrollRaw, classesRaw, attendanceRaw, paymentsRaw, auditRaw] = await Promise.all([
        readRange("Students!A1:V1000", "UNFORMATTED_VALUE"),
        readRange("Enrollments!A1:L5000", "UNFORMATTED_VALUE"),
        readRange("Classes!A1:P1000", "FORMATTED_VALUE"),
        readRange("Attendance!A1:Q5000", "UNFORMATTED_VALUE"),
        readRange("Payments!A1:R10000", "UNFORMATTED_VALUE"),
        readRange("'Audit Log'!A1:P20000", "FORMATTED_VALUE"),
      ]);
      const students = rowsToObjects(studentsRaw) as Record<string, unknown>[];
      const studentRow = students.find(s => String(s["Student ID"] || "") === studentId);
      if (!studentRow) return fail("NOT_FOUND", "Student record not found.", requestId, 404);
      const classes = rowsToObjects(classesRaw) as Record<string, unknown>[];
      const classMap = new Map(classes.map(c => [String(c["Class ID"] || ""), c]));
      const enrollments = (rowsToObjects(enrollRaw) as Record<string, unknown>[])
        .filter(e => String(e["Student ID"] || "") === studentId)
        .map(e => {
          const classId = String(e["Class ID"] || "");
          const klass = classMap.get(classId);
          return {
            id: String(e["Enrollment ID"] || ""),
            classId,
            className: String(klass?.["Class Name"] || classId),
            subject: String(klass?.["Subject"] || ""),
            grade: String(klass?.["Grade"] || ""),
            day: String(klass?.["Default Day"] || ""),
            enrolledFrom: isoFromGoogleSerial(e["Enrolled From"]),
            enrolledUntil: isoFromGoogleSerial(e["Enrolled Until"]),
            status: String(e["Status"] || ""),
            notes: String(e["Notes"] || ""),
            version: num(e["Version"]),
          };
        })
        .sort((a, b) => (norm(a.status) === "active" ? -1 : 1) - (norm(b.status) === "active" ? -1 : 1));

      const attendance = (rowsToObjects(attendanceRaw) as Record<string, unknown>[])
        .filter(a => String(a["Student ID"] || "") === studentId)
        .map(a => ({
          id: String(a["Attendance ID"] || ""),
          date: isoFromGoogleSerial(a["Date"]),
          status: String(a["Attendance Status"] || ""),
          checkInTime: timeString(a["Check-in Time"]),
          className: String(a["Class / Subject"] || ""),
          classId: String(a["Class ID"] || ""),
          notes: String(a["Notes"] || ""),
          recordStatus: String(a["Record Status"] || "Active"),
          updatedAt: String(a["Updated At"] || a["Marked At"] || ""),
        }))
        .sort((a, b) => (b.updatedAt || b.date).localeCompare(a.updatedAt || a.date));

      const payments = (rowsToObjects(paymentsRaw) as Record<string, unknown>[])
        .filter(p => String(p["Student ID"] || "") === studentId)
        .map(p => ({
          id: String(p["Payment ID"] || ""),
          year: num(p["Year"]),
          month: String(p["Month"] || ""),
          paymentDate: isoFromGoogleSerial(p["Payment Date"]),
          amount: num(p["Amount"]),
          paymentMethod: String(p["Payment Method"] || ""),
          receiptRef: String(p["Receipt / Ref"] || ""),
          notes: String(p["Notes"] || ""),
          status: String(p["Status"] || ""),
          updatedAt: String(p["Updated At"] || p["Recorded At"] || ""),
        }))
        .sort((a, b) => (b.updatedAt || b.paymentDate).localeCompare(a.updatedAt || a.paymentDate));

      const history = (rowsToObjects(auditRaw) as Record<string, unknown>[])
        .filter(a => String(a["Student ID"] || "") === studentId || (norm(a["Record Type"]) === "student" && String(a["Record ID"] || "") === studentId))
        .map(a => ({
          id: String(a["Audit ID"] || ""),
          timestamp: String(a["Timestamp"] || ""),
          actorEmail: String(a["Actor Email"] || ""),
          actorRole: String(a["Actor Role"] || ""),
          action: String(a["Action"] || ""),
          module: String(a["Module"] || ""),
          recordType: String(a["Record Type"] || ""),
          recordId: String(a["Record ID"] || ""),
          beforeValue: String(a["Old Value"] || ""),
          afterValue: String(a["New Value"] || ""),
          reason: String(a["Reason"] || ""),
          result: String(a["Result"] || ""),
        }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const activeAttendance = attendance.filter(a => norm(a.recordStatus) !== "voided");
      const activePayments = payments.filter(p => norm(p.status) === "active");
      const presentCount = activeAttendance.filter(a => norm(a.status) === "present" || norm(a.status) === "late").length;
      return ok({
        student: studentFromRow(studentRow),
        enrollments,
        recentAttendance: attendance.slice(0, 25),
        recentPayments: payments.slice(0, 25),
        history: history.slice(0, 50),
        summary: {
          activeEnrollments: enrollments.filter(e => norm(e.status) === "active").length,
          attendanceRecords: activeAttendance.length,
          attendanceRate: activeAttendance.length ? Math.round((presentCount / activeAttendance.length) * 100) : 0,
          totalPaid: activePayments.reduce((sum, p) => sum + p.amount, 0),
        },
      }, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("MISSING") || message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
      return fail("SHEET_READ_FAILED", "Student profile could not be loaded from Google Sheets.", requestId, 502);
    }
  }

  if (req.method !== "PATCH") return fail("METHOD_NOT_ALLOWED", "Method not allowed.", requestId, 405);
  if (actor.role !== "Admin") return fail("PERMISSION_DENIED", "Only an administrator can edit student records.", requestId, 403);

  try {
    const body = await req.json() as StudentUpdateBody;
    const reason = String(body.reason || "").trim();
    const expectedVersion = Number(body.expectedVersion);
    if (!reason) return fail("VALIDATION_ERROR", "A reason is required for student changes.", requestId, 422);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return fail("VALIDATION_ERROR", "The current student record version is required.", requestId, 422);

    const [studentsRaw, enrollRaw, classesRaw, auditRaw] = await Promise.all([
      readRange("Students!A1:V1000", "UNFORMATTED_VALUE"),
      readRange("Enrollments!A1:L5000", "UNFORMATTED_VALUE"),
      readRange("Classes!A1:P1000", "FORMATTED_VALUE"),
      readRange("'Audit Log'!A1:P20000", "UNFORMATTED_VALUE"),
    ]);
    const rawIndex = studentsRaw.findIndex((row, index) => index > 0 && String(row[0] ?? "") === studentId);
    if (rawIndex < 1) return fail("NOT_FOUND", "Student record not found.", requestId, 404);
    const currentRow = studentsRaw[rawIndex];
    const currentVersion = Math.max(1, num(currentRow[21]));
    const previousRequest = auditRaw.find((row, index) =>
      index > 0 &&
      String(row[14] ?? "") === requestId &&
      String(row[5] ?? "").toUpperCase() === "UPDATE" &&
      String(row[6] ?? "").toLowerCase() === "students" &&
      String(row[8] ?? "") === studentId &&
      String(row[15] ?? "").toLowerCase() === "success"
    );
    if (previousRequest) return ok({ id: studentId, status: String(currentRow[14] ?? ""), version: currentVersion, idempotent: true }, requestId);
    if (currentVersion !== expectedVersion) return fail("VERSION_CONFLICT", "This student record changed after you opened it. Reload before saving your changes.", requestId, 409);

    const name = body.name === undefined ? String(currentRow[1] ?? "").trim() : String(body.name).trim();
    const birthday = body.birthday === undefined ? isoFromGoogleSerial(currentRow[2]) : String(body.birthday || "").trim();
    const admitDate = body.admitDate === undefined ? isoFromGoogleSerial(currentRow[4]) : String(body.admitDate || "").trim();
    const birthdaySerial = birthday ? dateSerialFromIso(birthday) : null;
    const admitSerial = dateSerialFromIso(admitDate);
    const startingFee = body.startingFee === undefined ? num(currentRow[12]) : Number(body.startingFee);
    const status = body.status === undefined ? String(currentRow[14] || "Active") : String(body.status).trim();
    if (!name) return fail("VALIDATION_ERROR", "Student name is required.", requestId, 422);
    if (birthday && birthdaySerial === null) return fail("VALIDATION_ERROR", "Birthday must be a valid date.", requestId, 422);
    if (admitSerial === null) return fail("VALIDATION_ERROR", "Admit date must be valid.", requestId, 422);
    if (!Number.isFinite(startingFee) || startingFee < 0) return fail("VALIDATION_ERROR", "Starting monthly fee must be zero or more.", requestId, 422);
    if (!allowedStatuses.has(status)) return fail("VALIDATION_ERROR", "Student status is invalid.", requestId, 422);

    const enrollments = rowsToObjects(enrollRaw) as Record<string, unknown>[];
    const activeEnrollments = enrollments.filter(e => String(e["Student ID"] || "") === studentId && norm(e["Status"]) === "active");
    const activeClassIds = activeEnrollments.map(e => String(e["Class ID"] || "")).filter(Boolean);
    let desiredClassIds = body.classIds === undefined ? activeClassIds : [...new Set(body.classIds.map(String).filter(Boolean))];
    if (status === "Archived" || status === "Left") desiredClassIds = [];
    if (status === "Active" && !desiredClassIds.length) return fail("VALIDATION_ERROR", "An active student must be enrolled in at least one class.", requestId, 422);

    const classes = rowsToObjects(classesRaw) as Record<string, unknown>[];
    const desiredClasses = desiredClassIds.map(id => classes.find(c => String(c["Class ID"] || "") === id && norm(c["Status"]) === "active")).filter(Boolean) as Record<string, unknown>[];
    if (desiredClasses.length !== desiredClassIds.length) return fail("VALIDATION_ERROR", "One or more selected classes are invalid or inactive.", requestId, 422);

    const before = {
      name: String(currentRow[1] ?? ""), birthday: isoFromGoogleSerial(currentRow[2]), admitDate: isoFromGoogleSerial(currentRow[4]),
      phone: String(currentRow[5] ?? ""), whatsapp: String(currentRow[6] ?? ""), guardianName: String(currentRow[7] ?? ""), relationship: String(currentRow[8] ?? ""),
      guardianPhone: String(currentRow[9] ?? ""), guardianWhatsapp: String(currentRow[10] ?? ""), address: String(currentRow[11] ?? ""), startingFee: num(currentRow[12]),
      primaryClass: String(currentRow[13] ?? ""), status: String(currentRow[14] ?? ""), notes: String(currentRow[15] ?? ""), classIds: activeClassIds,
    };
    const primaryClass = desiredClasses.length ? String(desiredClasses[0]["Class Name"] || "") : "";
    const after = {
      name, birthday, admitDate,
      phone: body.phone === undefined ? before.phone : String(body.phone || "").trim(),
      whatsapp: body.whatsapp === undefined ? before.whatsapp : String(body.whatsapp || "").trim(),
      guardianName: body.guardianName === undefined ? before.guardianName : String(body.guardianName || "").trim(),
      relationship: body.relationship === undefined ? before.relationship : String(body.relationship || "").trim(),
      guardianPhone: body.guardianPhone === undefined ? before.guardianPhone : String(body.guardianPhone || "").trim(),
      guardianWhatsapp: body.guardianWhatsapp === undefined ? before.guardianWhatsapp : String(body.guardianWhatsapp || "").trim(),
      address: body.address === undefined ? before.address : String(body.address || "").trim(),
      startingFee, primaryClass, status,
      notes: body.notes === undefined ? before.notes : String(body.notes || "").trim(),
      classIds: desiredClassIds,
    };
    const sortedBefore = { ...before, classIds: [...before.classIds].sort() };
    const sortedAfter = { ...after, classIds: [...after.classIds].sort() };
    if (JSON.stringify(sortedBefore) === JSON.stringify(sortedAfter)) return fail("NO_CHANGES", "Nothing changed in this student profile.", requestId, 409);

    const ids = await getSheetIds();
    for (const title of ["Students", "Enrollments", "Audit Log"]) if (typeof ids[title] !== "number") throw new Error(`SHEET_MISSING:${title}`);
    const now = new Date().toISOString();
    const version = currentVersion + 1;
    const requests: Record<string, unknown>[] = [];

    requests.push({ updateCells: { start: { sheetId: ids["Students"], rowIndex: rawIndex, columnIndex: 1 }, rows: [{ values: [userValue(after.name), birthdaySerial === null ? {} : userValue(birthdaySerial)] }], fields: "userEnteredValue" } });
    requests.push({ updateCells: { start: { sheetId: ids["Students"], rowIndex: rawIndex, columnIndex: 4 }, rows: [{ values: [
      userValue(admitSerial), userValue(after.phone), userValue(after.whatsapp), userValue(after.guardianName), userValue(after.relationship), userValue(after.guardianPhone), userValue(after.guardianWhatsapp), userValue(after.address), userValue(after.startingFee), userValue(after.primaryClass), userValue(after.status), userValue(after.notes),
    ] }], fields: "userEnteredValue" } });
    requests.push({ updateCells: { start: { sheetId: ids["Students"], rowIndex: rawIndex, columnIndex: 19 }, rows: [{ values: [userValue(now), userValue(actor.email), userValue(version)] }], fields: "userEnteredValue" } });

    const desiredSet = new Set(desiredClassIds);
    const currentSet = new Set(activeClassIds);
    const todaySerial = localDateSerial();
    for (let rawEnrollmentIndex = 1; rawEnrollmentIndex < enrollRaw.length; rawEnrollmentIndex++) {
      const row = enrollRaw[rawEnrollmentIndex];
      if (String(row[1] ?? "") !== studentId || norm(row[5]) !== "active") continue;
      const classId = String(row[2] ?? "");
      if (desiredSet.has(classId)) continue;
      const enrollmentVersion = Math.max(1, num(row[11])) + 1;
      requests.push({ updateCells: { start: { sheetId: ids["Enrollments"], rowIndex: rawEnrollmentIndex, columnIndex: 4 }, rows: [{ values: [userValue(todaySerial), userValue("Ended")] }], fields: "userEnteredValue" } });
      requests.push({ updateCells: { start: { sheetId: ids["Enrollments"], rowIndex: rawEnrollmentIndex, columnIndex: 9 }, rows: [{ values: [userValue(now), userValue(actor.email), userValue(enrollmentVersion)] }], fields: "userEnteredValue" } });
    }

    const addClassIds = desiredClassIds.filter(id => !currentSet.has(id));
    if (addClassIds.length) {
      const newEnrollmentStart = enrollRaw.length;
      const enrollmentRows = addClassIds.map(id => ({ values: [
        userValue(shortId("ENR")), userValue(studentId), userValue(id), userValue(admitSerial), {}, userValue("Active"), userValue("Enrollment updated from student profile."), userValue(now), userValue(actor.email), userValue(now), userValue(actor.email), userValue(1),
      ] }));
      requests.push(insertRowsRequest(ids["Enrollments"], newEnrollmentStart, enrollmentRows.length));
      requests.push({ updateCells: { start: { sheetId: ids["Enrollments"], rowIndex: newEnrollmentStart, columnIndex: 0 }, rows: enrollmentRows, fields: "userEnteredValue" } });
    }

    requests.push(insertRowsRequest(ids["Audit Log"], auditRaw.length));
    requests.push({ updateCells: { start: { sheetId: ids["Audit Log"], rowIndex: auditRaw.length, columnIndex: 0 }, rows: [{ values: [
      userValue(shortId("AUD")), userValue(now), userValue(actor.email), userValue(actor.email), userValue(actor.role), userValue("UPDATE"), userValue("Students"), userValue("Student"), userValue(studentId), userValue(studentId), {}, userValue(JSON.stringify(before)), userValue(JSON.stringify(after)), userValue(reason), userValue(requestId), userValue("Success"),
    ] }], fields: "userEnteredValue" } });

    await batchUpdate(requests);
    return ok({ id: studentId, status: after.status, version, classIds: desiredClassIds }, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("MISSING") || message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
    return fail("SHEET_WRITE_FAILED", "The student changes were NOT saved to Google Sheets. Please retry.", requestId, 502);
  }
};

export const config: Config = { path: "/api/students/:id" };
