import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { batchUpdate, getSheetIds, insertRowsRequest, readRange, rowsToObjects, shortId, userValue } from "./_shared/sheets";

const creatableTypes=new Set(["Payment Method","Relationship","Subject","Grade","Teacher","Location"]);
function norm(v:unknown){return String(v??"").trim().toLowerCase().replace(/\s+/g," ");}
function nextRefId(rows:Record<string,unknown>[]){
  const max=rows.reduce((m,r)=>{const hit=/^REF-(\d+)$/.exec(String(r["Reference ID"]||""));return hit?Math.max(m,Number(hit[1])):m;},0);
  return `REF-${String(max+1).padStart(6,"0")}`;
}

export default async(req:Request,context:Context)=>{
  const requestId=req.headers.get("x-request-id")||context.requestId;
  const actor=getActor(req);
  if(!actor) return fail("AUTH_REQUIRED","Secure login is not configured for this environment.",requestId,401);
  const type=decodeURIComponent(context.params.type||"");
  if(!type) return fail("VALIDATION_ERROR","Reference type is required.",requestId,422);
  try{
    const [raw,auditRaw]=await Promise.all([
      readRange("'Reference Data'!A1:J5000","FORMATTED_VALUE"),
      readRange("'Audit Log'!A1:P20000","UNFORMATTED_VALUE"),
    ]);
    const rows=rowsToObjects(raw) as Record<string,unknown>[];
    if(req.method==="GET"){
      return ok(rows.filter(r=>String(r["Type"])===type && norm(r["Active"])!=="false").sort((a,b)=>Number(a["Sort Order"]||999)-Number(b["Sort Order"]||999)).map(r=>({id:String(r["Reference ID"]),value:String(r["Value"]),adminEditable:norm(r["Admin Editable"])==="true"})),requestId);
    }
    if(req.method!=="POST") return fail("METHOD_NOT_ALLOWED","Method not allowed.",requestId,405);
    if(actor.role!=="Admin") return fail("PERMISSION_DENIED","Only an administrator can add reusable list values.",requestId,403);
    if(!creatableTypes.has(type)) return fail("CONTROLLED_FIELD","This system list is controlled and cannot accept manual values.",requestId,422);
    const body=await req.json() as {value?:string};
    const value=String(body.value||"").trim().replace(/\s+/g," ");
    if(!value) return fail("VALIDATION_ERROR","A value is required.",requestId,422);
    const existing=rows.find(r=>String(r["Type"])===type && norm(r["Value"])===norm(value));
    if(existing) return ok({id:String(existing["Reference ID"]),value:String(existing["Value"]),existing:true},requestId);
    const ids=await getSheetIds();
    if(typeof ids["Reference Data"]!=="number"||typeof ids["Audit Log"]!=="number") throw new Error("SHEET_MISSING");
    const now=new Date().toISOString();
    const id=nextRefId(rows);
    const sort=Math.max(0,...rows.filter(r=>String(r["Type"])===type).map(r=>Number(r["Sort Order"]||0)))+1;
    await batchUpdate([
      insertRowsRequest(ids["Reference Data"],raw.length),
      {updateCells:{start:{sheetId:ids["Reference Data"],rowIndex:raw.length,columnIndex:0},rows:[{values:[userValue(id),userValue(type),userValue(value),userValue(true),userValue(true),userValue(sort),userValue(now),userValue(actor.email),userValue(now),userValue(actor.email)]}],fields:"userEnteredValue"}},
      insertRowsRequest(ids["Audit Log"],auditRaw.length),
      {updateCells:{start:{sheetId:ids["Audit Log"],rowIndex:auditRaw.length,columnIndex:0},rows:[{values:[userValue(shortId("AUD")),userValue(now),userValue(actor.email),userValue(actor.email),userValue(actor.role),userValue("CREATE"),userValue("Reference Data"),userValue(type),userValue(id),{},{},{},userValue(value),userValue("Reusable dropdown value added from website"),userValue(requestId),userValue("Success")]}],fields:"userEnteredValue"}},
    ]);
    return ok({id,value,existing:false},requestId);
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown error";
    if(message.includes("MISSING")||message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED","Google Sheets backend credentials are not configured yet.",requestId,503);
    return fail("SHEET_OPERATION_FAILED","The reference list operation could not be completed.",requestId,502);
  }
};
export const config:Config={path:"/api/reference/:type"};
