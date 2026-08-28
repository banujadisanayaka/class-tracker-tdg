const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function b64url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const clean = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken() {
  const email = Netlify.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = Netlify.env.get("GOOGLE_PRIVATE_KEY");
  if (!email || !privateKey) throw new Error("GOOGLE_CREDENTIALS_MISSING");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: email, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  if (!response.ok) throw new Error("GOOGLE_AUTH_FAILED");
  const token = await response.json() as { access_token: string };
  return token.access_token;
}

function spreadsheetId() {
  const id = Netlify.env.get("GOOGLE_SHEET_ID");
  if (!id) throw new Error("GOOGLE_SHEET_ID_MISSING");
  return id;
}

export async function readRange(range: string, render: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" = "FORMATTED_VALUE") {
  const token = await accessToken();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId()}/values/${encodeURIComponent(range)}`);
  url.searchParams.set("valueRenderOption", render);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`SHEET_READ_FAILED:${response.status}`);
  const body = await response.json() as { values?: unknown[][] };
  return body.values || [];
}

export async function appendValues(range: string, values: unknown[][]) {
  const token = await accessToken();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId()}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
  if (!response.ok) throw new Error(`SHEET_WRITE_FAILED:${response.status}`);
  return response.json();
}

export function rowsToObjects(rows: unknown[][]) {
  if (!rows.length) return [];
  const headers = rows[0].map(String);
  return rows.slice(1).filter(row => row.some(v => v !== "" && v != null)).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));
}

export async function getSheetIds() {
  const token = await accessToken();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId()}`);
  url.searchParams.set("fields", "sheets.properties(sheetId,title)");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`SHEET_METADATA_FAILED:${response.status}`);
  const body = await response.json() as { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> };
  return Object.fromEntries((body.sheets || []).flatMap(s => {
    const id = s.properties?.sheetId;
    const title = s.properties?.title;
    return typeof id === "number" && title ? [[title, id] as const] : [];
  }));
}

export async function batchUpdate(requests: Record<string, unknown>[]) {
  const token = await accessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId()}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`SHEET_WRITE_FAILED:${response.status}:${detail.slice(0, 240)}`);
  }
  return response.json();
}

export function insertRowsRequest(sheetId: number, rowIndex: number, count = 1) {
  if (!Number.isInteger(rowIndex) || rowIndex < 1) throw new Error("INVALID_ROW_INDEX");
  if (!Number.isInteger(count) || count < 1) throw new Error("INVALID_ROW_COUNT");
  return {
    insertDimension: {
      range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + count },
      inheritFromBefore: rowIndex > 1,
    },
  };
}

export function userValue(value: unknown) {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  if (value === null || value === undefined || value === "") return {};
  if (typeof value === "string" && value.startsWith("=")) return { userEnteredValue: { formulaValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}

export function dateSerialFromIso(value: string) {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const utc = Date.UTC(Number(y), Number(m) - 1, Number(d));
  return Math.floor((utc - Date.UTC(1899, 11, 30)) / 86400000);
}

export function shortId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export function googleSerialFor(date: Date) {
  const epoch = Date.UTC(1899, 11, 30);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - epoch) / 86400000);
}
