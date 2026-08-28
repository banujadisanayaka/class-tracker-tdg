import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { readRange, rowsToObjects } from "./_shared/sheets";

function norm(v:unknown){return String(v??"").trim().toLowerCase();}
export default async(req:Request,context:Context)=>{
  const requestId=req.headers.get("x-request-id")||context.requestId;
  if(!getActor(req)) return fail("AUTH_REQUIRED","Secure login is not configured for this environment.",requestId,401);
  if(req.method!=="GET") return fail("METHOD_NOT_ALLOWED","Method not allowed.",requestId,405);
  const classId=context.params.id;
  if(!classId) return fail("VALIDATION_ERROR","Class ID is required.",requestId,422);
  try{
    const [studentsRaw,enrollRaw]=await Promise.all([readRange("Students!A1:V1000","FORMATTED_VALUE"),readRange("Enrollments!A1:L5000","FORMATTED_VALUE")]);
    const students=rowsToObjects(studentsRaw) as Record<string,unknown>[];
    const enrollments=rowsToObjects(enrollRaw) as Record<string,unknown>[];
    const ids=new Set(enrollments.filter(e=>String(e["Class ID"])===classId&&norm(e["Status"])==="active").map(e=>String(e["Student ID"])));
    return ok(students.filter(s=>ids.has(String(s["Student ID"]))&&norm(s["Status"])==="active").map(s=>({id:String(s["Student ID"]),name:String(s["Student Name"]),phone:String(s["Student Telephone"]||""),status:String(s["Status"])})),requestId);
  }catch(error){
    const message=error instanceof Error?error.message:"Unknown error";
    if(message.includes("MISSING")||message.includes("AUTH_FAILED")) return fail("SHEET_CONFIGURATION_REQUIRED","Google Sheets backend credentials are not configured yet.",requestId,503);
    return fail("SHEET_READ_FAILED","Class students could not be loaded.",requestId,502);
  }
};
export const config:Config={path:"/api/classes/:id/students"};
