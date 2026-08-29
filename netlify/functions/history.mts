import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { dateSerialFromIso, readRange, rowsToObjects } from "./_shared/sheets";

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

function localDate(value: unknown) {
  const raw = String(value ?? "");
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: Netlify.env.get("APP_TIME_ZONE") || "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

export default async (req: Request, context: Context) => {
  const requestId = context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is required.", requestId, 401);
  if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "History is read-only.", requestId, 405);

  const url = new URL(req.url);
  const today = localToday();
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || today;
  const fromSerial = dateSerialFromIso(from);
  const toSerial = dateSerialFromIso(to);
  if (fromSerial === null || toSerial === null || fromSerial > toSerial) {
    return fail("VALIDATION_ERROR", "A valid history date range is required.", requestId, 422);
  }

  const moduleFilter = String(url.searchParams.get("module") || "").trim();

  try {
    const raw = await readRange("'Audit Log'!A:P", "FORMATTED_VALUE");
    const rows = rowsToObjects(raw) as Record<string, unknown>[];
    const filtered = rows
      .map(r => ({
        id: String(r["Audit ID"] || ""),
        timestamp: String(r["Timestamp"] || ""),
        localDate: localDate(r["Timestamp"]),
        actorId: String(r["Actor User ID"] || ""),
        actorEmail: String(r["Actor Email"] || ""),
        actorRole: String(r["Actor Role"] || ""),
        action: String(r["Action"] || ""),
        module: String(r["Module"] || ""),
        recordType: String(r["Record Type"] || ""),
        recordId: String(r["Record ID"] || ""),
        studentId: String(r["Student ID"] || ""),
        classId: String(r["Class ID"] || ""),
        beforeValue: String(r["Old Value"] || ""),
        afterValue: String(r["New Value"] || ""),
        reason: String(r["Reason"] || ""),
        requestId: String(r["Request ID"] || ""),
        result: String(r["Result"] || ""),
      }))
      .filter(r => r.localDate >= from && r.localDate <= to)
      .filter(r => !moduleFilter || norm(r.module) === norm(moduleFilter))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const limit = 1000;
    const events = filtered.slice(0, limit);
    const modules = Array.from(new Set(filtered.map(r => r.module).filter(Boolean))).sort();
    const actors = Array.from(new Set(filtered.map(r => r.actorEmail || r.actorId).filter(Boolean)));

    return ok({
      from,
      to,
      generatedAt: new Date().toISOString(),
      totalEvents: filtered.length,
      successEvents: filtered.filter(r => norm(r.result) === "success").length,
      failedEvents: filtered.filter(r => r.result && norm(r.result) !== "success").length,
      uniqueActors: actors.length,
      modules,
      truncated: filtered.length > limit,
      events,
    }, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("MISSING") || message.includes("AUTH_FAILED")) {
      return fail("SHEET_CONFIGURATION_REQUIRED", "Google Sheets backend credentials are not configured yet.", requestId, 503);
    }
    return fail("SHEET_READ_FAILED", "History could not be loaded from the Audit Log.", requestId, 502);
  }
};

export const config: Config = { path: "/api/history" };
