import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { readRange } from "./_shared/sheets";

export default async (req: Request, context: Context) => {
  const requestId=context.requestId;
  if(!getActor(req)) return fail("AUTH_REQUIRED","Secure login is not configured for this environment.",requestId,401);
  try{
    const values=await readRange("Settings!A14:B20");
    const map=Object.fromEntries(values.filter(r=>r.length>=2).map(r=>[String(r[0]),r[1]]));
    return ok({sheetConnected:true,schemaVersion:map["System Schema Version"]||"unknown",environment:map["Environment"]||"unknown",dataSourceMode:map["Data Source Mode"]||"unknown"},requestId);
  }catch(error){
    return fail("SHEET_CONFIGURATION_REQUIRED","Google Sheets backend credentials are not configured or the development Sheet is not shared with the service account.",requestId,503);
  }
};
export const config: Config={path:"/api/health"};
