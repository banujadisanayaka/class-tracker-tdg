import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { dateSerialFromIso, isoFromGoogleSerial, readRange, rowsToObjects } from "./_shared/sheets";

type ReportType = "financial" | "attendance" | "students" | "classes" | "staff";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function norm(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: Netlify.env.get("APP_TIME_ZONE") || "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

function monthKey(year: number, month: string) {
  const index = MONTHS.findIndex(m => m.toLowerCase() === month.toLowerCase());
  return index < 0 ? null : year * 12 + index;
}

function dateRange(url: URL) {
  const today = localToday();
  const first = today.slice(0, 8) + "01";
  const from = url.searchParams.get("from") || first;
  const to = url.searchParams.get("to") || today;
  const fromSerial = dateSerialFromIso(from);
  const toSerial = dateSerialFromIso(to);
  if (fromSerial === null || toSerial === null || fromSerial > toSerial) return null;
  return { from, to, fromSerial, toSerial };
}

function periodLabel(from: string, to: string) {
  return from === to ? from : from + " to " + to;
}

function monthRangeKeys(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return { first: fy * 12 + (fm - 1), last: ty * 12 + (tm - 1) };
}

function reportError(error: unknown, requestId: string) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message.includes("MISSING") || message.includes("AUTH_FAILED")) {
    return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
  }
  return fail("SHEET_READ_FAILED", "The report could not be generated from Google Sheets.", requestId, 502);
}

export default async (req: Request, context: Context) => {
  const requestId = context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is required.", requestId, 401);
  if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "Reports are read-only.", requestId, 405);

  const url = new URL(req.url);
  const type = String(url.searchParams.get("type") || "financial").toLowerCase() as ReportType;
  if (!["financial","attendance","students","classes","staff"].includes(type)) {
    return fail("VALIDATION_ERROR", "Unknown report type.", requestId, 422);
  }

  const range = dateRange(url);
  if (!range) return fail("VALIDATION_ERROR", "A valid report date range is required.", requestId, 422);

  try {
    const generatedAt = new Date().toISOString();

    if (type === "financial") {
      const [feeRaw, paymentRaw] = await Promise.all([
        readRange("'Fee Tracker'!A:R", "UNFORMATTED_VALUE"),
        readRange("Payments!A:R", "UNFORMATTED_VALUE"),
      ]);
      const rows = rowsToObjects(feeRaw) as Record<string, unknown>[];
      const payments = rowsToObjects(paymentRaw) as Record<string, unknown>[];
      const keys = monthRangeKeys(range.from, range.to);
      const selected = rows.filter(r => {
        const key = monthKey(num(r["Year"]), String(r["Month"] || ""));
        return key !== null && key >= keys.first && key <= keys.last;
      });

      const receivedByFeeRecord = new Map<string, number>();
      for (const payment of payments) {
        if (norm(payment["Status"] || "Active") !== "active") continue;
        const paymentDate = num(payment["Payment Date"]);
        if (paymentDate < range.fromSerial || paymentDate > range.toSerial) continue;
        const feeRecordId = String(payment["Fee Record ID"] || "");
        if (!feeRecordId) continue;
        receivedByFeeRecord.set(feeRecordId, (receivedByFeeRecord.get(feeRecordId) || 0) + num(payment["Amount"]));
      }

      const detail = selected.map(r => {
        const feeRecordId = String(r["Fee Record ID"] || "");
        return {
          period: String(r["Month"] || "") + " " + num(r["Year"]),
          studentId: String(r["Student ID"] || ""),
          studentName: String(r["Student Name (Auto)"] || ""),
          monthlyFee: num(r["Monthly Fee (Auto)"]),
          paid: num(r["Amount Paid (Total This Month)"]),
          balance: num(r["Balance (Auto)"]),
          receivedInPeriod: receivedByFeeRecord.get(feeRecordId) || 0,
          status: String(r["Status (Auto)"] || ""),
        };
      });

      const due = detail.reduce((sum, r) => sum + r.monthlyFee, 0);
      const paid = detail.reduce((sum, r) => sum + r.paid, 0);
      const balance = detail.reduce((sum, r) => sum + r.balance, 0);
      const receivedInPeriod = detail.reduce((sum, r) => sum + r.receivedInPeriod, 0);

      return ok({
        type,
        title: "Financial Report",
        periodLabel: periodLabel(range.from, range.to),
        generatedAt,
        summary: [
          { label: "Monthly fees", value: due, format: "money", detail: "Obligations for months touched by this date range" },
          { label: "Current paid", value: paid, format: "money", detail: "All active payments currently applied to those fee records" },
          { label: "Outstanding", value: balance, format: "money" },
          { label: "Received in selected dates", value: receivedInPeriod, format: "money", detail: "Only active transactions with a known payment date inside this range" },
          { label: "Fee records", value: detail.length, format: "number" },
        ],
        columns: [
          { key: "period", label: "Period", format: "text" },
          { key: "studentId", label: "Student ID", format: "text" },
          { key: "studentName", label: "Student", format: "text" },
          { key: "monthlyFee", label: "Monthly Fee", format: "money" },
          { key: "paid", label: "Current Paid", format: "money" },
          { key: "balance", label: "Balance", format: "money" },
          { key: "receivedInPeriod", label: "Received in Selected Dates", format: "money" },
          { key: "status", label: "Status", format: "text" },
        ],
        rows: detail,
        note: "Monthly fees, current paid and outstanding use the authoritative Fee Tracker for every month touched by the selected period. 'Received in selected dates' uses active Payment transactions whose payment date falls inside the exact selected range. Migrated payments with no known payment date remain included in Current Paid but are not assigned to an arbitrary day.",
      }, requestId);
    }

    if (type === "attendance") {
      const raw = await readRange("Attendance!A:Q", "UNFORMATTED_VALUE");
      const rows = rowsToObjects(raw) as Record<string, unknown>[];
      const selected = rows.filter(r => {
        const serial = num(r["Date"]);
        return serial >= range.fromSerial && serial <= range.toSerial && norm(r["Record Status"] || "Active") !== "voided";
      });

      const detail = selected.map(r => ({
        date: isoFromGoogleSerial(r["Date"]),
        studentId: String(r["Student ID"] || ""),
        studentName: String(r["Student Name (Auto)"] || ""),
        status: String(r["Attendance Status"] || ""),
        className: String(r["Class / Subject"] || ""),
        notes: String(r["Notes"] || ""),
      }));

      const count = (status: string) => detail.filter(r => norm(r.status) === status).length;
      const present = count("present");
      const late = count("late");
      const absent = count("absent");
      const excused = count("excused");
      const denominator = Math.max(0, detail.length - excused);
      const rate = denominator ? Math.round(((present + late) / denominator) * 1000) / 10 : 0;

      return ok({
        type,
        title: "Attendance Report",
        periodLabel: periodLabel(range.from, range.to),
        generatedAt,
        summary: [
          { label: "Attendance records", value: detail.length, format: "number" },
          { label: "Present", value: present, format: "number" },
          { label: "Late", value: late, format: "number" },
          { label: "Absent", value: absent, format: "number" },
          { label: "Attendance rate", value: rate, format: "percent" },
        ],
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "studentId", label: "Student ID", format: "text" },
          { key: "studentName", label: "Student", format: "text" },
          { key: "status", label: "Status", format: "text" },
          { key: "className", label: "Class", format: "text" },
          { key: "notes", label: "Notes", format: "text" },
        ],
        rows: detail,
        note: "Voided attendance records are excluded from report totals.",
      }, requestId);
    }

    if (type === "students") {
      const raw = await readRange("Students!A:V", "UNFORMATTED_VALUE");
      const rows = rowsToObjects(raw) as Record<string, unknown>[];
      const detail = rows.map(r => ({
        studentId: String(r["Student ID"] || ""),
        studentName: String(r["Student Name"] || ""),
        status: String(r["Status"] || ""),
        studentPhone: String(r["Student Telephone"] || ""),
        guardian: String(r["Parent / Guardian Name"] || ""),
        guardianPhone: String(r["Parent Telephone"] || ""),
        admitDate: isoFromGoogleSerial(r["Admit Date"]),
        currentFee: num(r["Current Monthly Fee (Auto)"] || r["Starting Monthly Fee"]),
      }));
      const count = (status: string) => detail.filter(r => norm(r.status) === status).length;

      return ok({
        type,
        title: "Student Register Report",
        periodLabel: "Current register",
        generatedAt,
        summary: [
          { label: "Total students", value: detail.length, format: "number" },
          { label: "Active", value: count("active"), format: "number" },
          { label: "Inactive", value: count("inactive"), format: "number" },
          { label: "Left", value: count("left"), format: "number" },
          { label: "Archived", value: count("archived"), format: "number" },
        ],
        columns: [
          { key: "studentId", label: "Student ID", format: "text" },
          { key: "studentName", label: "Student", format: "text" },
          { key: "status", label: "Status", format: "text" },
          { key: "studentPhone", label: "Phone", format: "text" },
          { key: "guardian", label: "Guardian", format: "text" },
          { key: "guardianPhone", label: "Guardian Phone", format: "text" },
          { key: "admitDate", label: "Admit Date", format: "date" },
          { key: "currentFee", label: "Current Fee", format: "money" },
        ],
        rows: detail,
        note: "This is a current student-register snapshot; the report date range does not hide historical student records.",
      }, requestId);
    }

    if (type === "classes") {
      const [classesRaw, enrollRaw] = await Promise.all([
        readRange("Classes!A:P", "FORMATTED_VALUE"),
        readRange("Enrollments!A:L", "UNFORMATTED_VALUE"),
      ]);
      const classes = rowsToObjects(classesRaw) as Record<string, unknown>[];
      const enrollments = rowsToObjects(enrollRaw) as Record<string, unknown>[];

      const detail = classes.map(c => {
        const classId = String(c["Class ID"] || "");
        const overlappingStudentIds = new Set(
          enrollments
            .filter(e => {
              if (String(e["Class ID"] || "") !== classId) return false;
              const from = num(e["Enrolled From"]);
              const until = num(e["Enrolled Until"]);
              return (from <= 0 || from <= range.toSerial) && (until <= 0 || until >= range.fromSerial);
            })
            .map(e => String(e["Student ID"] || ""))
            .filter(Boolean),
        );
        return {
          classId,
          className: String(c["Class Name"] || ""),
          subject: String(c["Subject"] || ""),
          grade: String(c["Grade"] || c["Grade / Level"] || ""),
          day: String(c["Default Day"] || ""),
          time: [String(c["Start Time"] || ""), String(c["End Time"] || "")].filter(Boolean).join(" - "),
          teacher: String(c["Teacher"] || ""),
          students: overlappingStudentIds.size,
          status: String(c["Status"] || ""),
        };
      });

      return ok({
        type,
        title: "Class Report",
        periodLabel: periodLabel(range.from, range.to),
        generatedAt,
        summary: [
          { label: "Classes", value: detail.length, format: "number" },
          { label: "Active classes", value: detail.filter(r => norm(r.status) === "active").length, format: "number" },
          { label: "Student-class links", value: detail.reduce((sum, r) => sum + r.students, 0), format: "number" },
        ],
        columns: [
          { key: "classId", label: "Class ID", format: "text" },
          { key: "className", label: "Class", format: "text" },
          { key: "subject", label: "Subject", format: "text" },
          { key: "grade", label: "Grade", format: "text" },
          { key: "day", label: "Day", format: "text" },
          { key: "time", label: "Time", format: "text" },
          { key: "teacher", label: "Teacher", format: "text" },
          { key: "students", label: "Students", format: "number" },
          { key: "status", label: "Status", format: "text" },
        ],
        rows: detail,
        note: "Student counts show unique students whose enrollment periods overlap the selected date range.",
      }, requestId);
    }

    const raw = await readRange("Users!A:Z", "FORMATTED_VALUE");
    const rows = rowsToObjects(raw) as Record<string, unknown>[];
    const detail = rows.map(r => ({
      userId: String(r["User ID"] || ""),
      email: String(r["Google Email"] || r["Email"] || ""),
      displayName: String(r["Display Name"] || ""),
      role: String(r["Role"] || ""),
      status: String(r["Account Status"] || ""),
      approvedBy: String(r["Approved By"] || ""),
      approvedAt: String(r["Approved At"] || ""),
    }));

    return ok({
      type,
      title: "Staff & Access Report",
      periodLabel: "Current access register",
      generatedAt,
      summary: [
        { label: "Users", value: detail.length, format: "number" },
        { label: "Active", value: detail.filter(r => norm(r.status) === "active").length, format: "number" },
        { label: "Admins", value: detail.filter(r => norm(r.role) === "admin").length, format: "number" },
        { label: "Staff", value: detail.filter(r => norm(r.role) === "staff").length, format: "number" },
      ],
      columns: [
        { key: "userId", label: "User ID", format: "text" },
        { key: "displayName", label: "Name", format: "text" },
        { key: "email", label: "Email", format: "text" },
        { key: "role", label: "Role", format: "text" },
        { key: "status", label: "Status", format: "text" },
        { key: "approvedBy", label: "Approved By", format: "text" },
        { key: "approvedAt", label: "Approved At", format: "text" },
      ],
      rows: detail,
      note: "This is a current access-register snapshot.",
    }, requestId);
  } catch (error) {
    return reportError(error, requestId);
  }
};

export const config: Config = { path: "/api/reports" };
