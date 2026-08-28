import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { readRange, rowsToObjects } from "./_shared/sheets";

export default async (req: Request, context: Context) => {
  const requestId=req.headers.get("x-request-id")||context.requestId;
  if(!getActor(req)) return fail("AUTH_REQUIRED","Secure login is not configured for this environment.",requestId,401);
  if(req.method!=="GET") return fail("METHOD_NOT_ALLOWED","Method not allowed.",requestId,405);
  try{
    const raw=await readRange("Classes!A1:P1000","FORMATTED_VALUE");
    const rows=rowsToObjects(raw) as Record<string,unknown>[];
    return ok(rows.map(r=>({
      id:String(r["Class ID"]||""),name:String(r["Class Name"]||""),subject:String(r["Subject"]||""),grade:String(r["Grade"]||""),day:String(r["Default Day"]||""),startTime:String(r["Start Time"]||""),endTime:String(r["End Time"]||""),teacher:String(r["Teacher"]||""),location:String(r["Location / Room"]||""),status:String(r["Status"]||"")
    })),requestId);
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown error";
    if(message.includes("MISSING")||message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED","Google Sheets backend credentials are not configured yet.",requestId,503);
    return fail("SHEET_READ_FAILED","Classes could not be loaded.",requestId,502);
  }
};
export const config: Config={path:"/api/classes"};
