import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { readRange } from "./_shared/sheets";

function diagnosticCode(error: unknown) {
  if (!(error instanceof Error)) return "UNKNOWN_RUNTIME_ERROR";
  const message = error.message || "";
  if (message.includes("GOOGLE_CREDENTIALS_MISSING")) return "GOOGLE_CREDENTIALS_MISSING";
  if (message.includes("GOOGLE_AUTH_FAILED")) return "GOOGLE_AUTH_FAILED";
  if (message.includes("GOOGLE_SHEET_ID_MISSING")) return "GOOGLE_SHEET_ID_MISSING";
  if (message.includes("SHEET_READ_FAILED:403")) return "SHEET_READ_FORBIDDEN";
  if (message.includes("SHEET_READ_FAILED:404")) return "SHEET_NOT_FOUND";
  if (message.includes("SHEET_READ_FAILED")) return "SHEET_READ_FAILED";
  if (error.name === "DataError" || error.name === "SyntaxError") return "PRIVATE_KEY_PARSE_FAILED";
  return "GOOGLE_BACKEND_RUNTIME_ERROR";
}

export default async (req: Request, context: Context) => {
  const requestId = context.requestId;
  if (!getActor(req)) return fail("AUTH_REQUIRED", "Secure login is not configured for this environment.", requestId, 401);

  try {
    const values = await readRange("Settings!A14:B20");
    const map = Object.fromEntries(values.filter(r => r.length >= 2).map(r => [String(r[0]), r[1]]));
    return ok({
      sheetConnected: true,
      schemaVersion: map["System Schema Version"] || "unknown",
      environment: map["Environment"] || "unknown",
      dataSourceMode: map["Data Source Mode"] || "unknown",
    }, requestId);
  } catch (error) {
    const diagnostic = diagnosticCode(error);
    return fail(
      "SHEET_CONFIGURATION_REQUIRED",
      `Google Sheets health check failed: ${diagnostic}`,
      requestId,
      503,
    );
  }
};

export const config: Config = { path: "/api/health" };
