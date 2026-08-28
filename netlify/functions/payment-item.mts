import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { batchUpdate, dateSerialFromIso, getSheetIds, insertRowsRequest, readRange, rowsToObjects, shortId, userValue } from "./_shared/sheets";

function num(v: unknown) { const n=Number(String(v ?? "").replace(/[^0-9.-]/g,"")); return Number.isFinite(n)?n:0; }
function norm(v: unknown) { return String(v ?? "").trim().toLowerCase(); }

export default async (req: Request, context: Context) => {
  const requestId=req.headers.get("x-request-id")||context.requestId;
  const actor=getActor(req);
  if(!actor) return fail("AUTH_REQUIRED","Secure login is not configured for this environment.",requestId,401);
  if(actor.role!=="Admin") return fail("PERMISSION_DENIED","Only an administrator can correct or void payments by default.",requestId,403);
  if(req.method!=="PATCH" && req.method!=="DELETE") return fail("METHOD_NOT_ALLOWED","Method not allowed.",requestId,405);
  const paymentId=context.params.id;
  if(!paymentId) return fail("VALIDATION_ERROR","Payment ID is required.",requestId,422);

  try{
    const body=await req.json() as { amount?:number; paymentDate?:string; paymentMethod?:string; receiptRef?:string; notes?:string; reason?:string };
    const reason=String(body.reason||"").trim();
    if(!reason) return fail("VALIDATION_ERROR","A correction reason is required.",requestId,422);
    const [paymentsRaw,feesRaw,auditRaw]=await Promise.all([
      readRange("Payments!A1:R10000","UNFORMATTED_VALUE"),
      readRange("'Fee Tracker'!A1:R2000","UNFORMATTED_VALUE"),
      readRange("'Audit Log'!A1:P20000","UNFORMATTED_VALUE"),
    ]);
    const rawIndex=paymentsRaw.findIndex((row,i)=>i>0 && String(row[0]??"")===paymentId);
    if(rawIndex<1) return fail("NOT_FOUND","Payment record not found.",requestId,404);
    const row=paymentsRaw[rawIndex];
    if(norm(row[10])!=="active" && req.method!=="DELETE") return fail("INVALID_STATE","Only active payments can be corrected.",requestId,409);
    if(norm(row[10])==="voided" && req.method==="DELETE") return ok({paymentId,status:"Voided",idempotent:true},requestId);
    const feeRecordId=String(row[1]??"");
    const studentId=String(row[2]??"");
    const old={paymentDate:row[5]??"",amount:num(row[6]),method:String(row[7]??""),receiptRef:String(row[8]??""),notes:String(row[9]??""),status:String(row[10]??"")};
    const ids=await getSheetIds();
    if(typeof ids["Payments"]!=="number"||typeof ids["Audit Log"]!=="number") throw new Error("SHEET_MISSING");
    const now=new Date().toISOString();
    const version=num(row[16])+1;

    if(req.method==="DELETE"){
      await batchUpdate([
        {updateCells:{start:{sheetId:ids["Payments"],rowIndex:rawIndex,columnIndex:10},rows:[{values:[userValue("Voided")]}],fields:"userEnteredValue"}},
        {updateCells:{start:{sheetId:ids["Payments"],rowIndex:rawIndex,columnIndex:13},rows:[{values:[userValue(actor.email),userValue(now),userValue(reason),userValue(version)]}],fields:"userEnteredValue"}},
        insertRowsRequest(ids["Audit Log"],auditRaw.length),
        {updateCells:{start:{sheetId:ids["Audit Log"],rowIndex:auditRaw.length,columnIndex:0},rows:[{values:[userValue(shortId("AUD")),userValue(now),userValue(actor.email),userValue(actor.email),userValue(actor.role),userValue("VOID"),userValue("Payments"),userValue("Payment"),userValue(paymentId),userValue(studentId),{},userValue(JSON.stringify(old)),userValue(JSON.stringify({...old,status:"Voided"})),userValue(reason),userValue(requestId),userValue("Success")]}],fields:"userEnteredValue"}},
      ]);
      return ok({paymentId,status:"Voided",version},requestId);
    }

    const paymentDate=body.paymentDate===undefined?row[5]:dateSerialFromIso(String(body.paymentDate));
    if(paymentDate===null) return fail("VALIDATION_ERROR","Payment date is invalid.",requestId,422);
    const amount=body.amount===undefined?num(row[6]):Number(body.amount);
    if(!Number.isFinite(amount)||amount<=0) return fail("VALIDATION_ERROR","Payment amount must be greater than zero.",requestId,422);
    const method=body.paymentMethod===undefined?String(row[7]??""):String(body.paymentMethod).trim();
    if(!method) return fail("VALIDATION_ERROR","Payment method is required.",requestId,422);

    const payments=rowsToObjects(paymentsRaw) as Record<string,unknown>[];
    const fees=rowsToObjects(feesRaw) as Record<string,unknown>[];
    const fee=fees.find(f=>String(f["Fee Record ID"])===feeRecordId);
    if(!fee) return fail("DATA_INTEGRITY_ERROR","The monthly fee record linked to this payment is missing.",requestId,409);
    const monthlyFee=num(fee["Monthly Fee (Auto)"]);
    const otherPaid=payments.filter(p=>String(p["Fee Record ID"])===feeRecordId && String(p["Payment ID"])!==paymentId && norm(p["Status"])==="active").reduce((s,p)=>s+num(p["Amount"]),0);
    if(otherPaid+amount>monthlyFee+0.0001) return fail("OVERPAYMENT",`This correction would exceed the monthly fee of LKR ${monthlyFee.toLocaleString("en-LK")}.`,requestId,422);
    const updated={paymentDate,amount,method,receiptRef:body.receiptRef===undefined?String(row[8]??""):String(body.receiptRef).trim(),notes:body.notes===undefined?String(row[9]??""):String(body.notes).trim(),status:"Active"};

    await batchUpdate([
      {updateCells:{start:{sheetId:ids["Payments"],rowIndex:rawIndex,columnIndex:5},rows:[{values:[userValue(updated.paymentDate),userValue(updated.amount),userValue(updated.method),userValue(updated.receiptRef),userValue(updated.notes)]}],fields:"userEnteredValue"}},
      {updateCells:{start:{sheetId:ids["Payments"],rowIndex:rawIndex,columnIndex:13},rows:[{values:[userValue(actor.email),userValue(now),userValue(reason),userValue(version)]}],fields:"userEnteredValue"}},
      insertRowsRequest(ids["Audit Log"],auditRaw.length),
      {updateCells:{start:{sheetId:ids["Audit Log"],rowIndex:auditRaw.length,columnIndex:0},rows:[{values:[userValue(shortId("AUD")),userValue(now),userValue(actor.email),userValue(actor.email),userValue(actor.role),userValue("UPDATE"),userValue("Payments"),userValue("Payment"),userValue(paymentId),userValue(studentId),{},userValue(JSON.stringify(old)),userValue(JSON.stringify(updated)),userValue(reason),userValue(requestId),userValue("Success")]}],fields:"userEnteredValue"}},
    ]);
    return ok({paymentId,status:"Active",version,amount,feeRecordId},requestId);
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown error";
    if(message.includes("MISSING")||message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED","Google Sheets backend credentials are not configured yet.",requestId,503);
    return fail("SHEET_WRITE_FAILED","The payment change was NOT saved to Google Sheets. Please retry.",requestId,502);
  }
};

export const config: Config={path:"/api/payments/:id"};
