import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { readRange, rowsToObjects } from "./_shared/sheets";

function norm(v:unknown){return String(v??"").trim().toLowerCase();}
export default async(req:Request,context:Context)=>{
  const requestId=req.headers.get("x-request-id")||context.requestId;
  if(!getActor(req)) return fail("AUTH_REQUIRED","Secure login is not configured for this environment.",requestId,401);
  if(req.method!=="GET") return fail("METHOD_NOT_ALLOWED","Method not allowed.",requestId,405);
  try{
    const tz=Netlify.env.get("APP_TIME_ZONE")||"Asia/Colombo";
    const weekday=new Intl.DateTimeFormat("en-US",{timeZone:tz,weekday:"long"}).format(new Date());
    const [classesRaw,enrollRaw]=await Promise.all([readRange("Classes!A1:P1000","FORMATTED_VALUE"),readRange("Enrollments!A1:L5000","FORMATTED_VALUE")]);
    const classes=rowsToObjects(classesRaw) as Record<string,unknown>[];
    const enrollments=rowsToObjects(enrollRaw) as Record<string,unknown>[];
    const activeEnroll=enrollments.filter(e=>norm(e["Status"])==="active");
    const result=classes.filter(c=>norm(c["Status"])==="active"&&norm(c["Default Day"])===norm(weekday)).map(c=>({
      id:String(c["Class ID"]),name:String(c["Class Name"]),subject:String(c["Subject"]||""),grade:String(c["Grade"]||""),day:String(c["Default Day"]||""),startTime:String(c["Start Time"]||""),endTime:String(c["End Time"]||""),teacher:String(c["Teacher"]||""),location:String(c["Location / Room"]||""),studentCount:activeEnroll.filter(e=>String(e["Class ID"])===String(c["Class ID"])).length
    }));
    return ok({weekday,classes:result},requestId);
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown error";
    if(message.includes("MISSING")||message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED","Google Sheets backend credentials are not configured yet.",requestId,503);
    return fail("SHEET_READ_FAILED","Today's classes could not be loaded.",requestId,502);
  }
};
export const config:Config={path:"/api/today"};
