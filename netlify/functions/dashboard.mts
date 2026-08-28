import type { Config, Context } from "@netlify/functions";
import { getActor } from "./_shared/auth";
import { fail, ok } from "./_shared/response";
import { readRange, rowsToObjects } from "./_shared/sheets";

function number(v: unknown) { const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function localParts(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday:"long", year:"numeric", month:"long", day:"numeric" }).formatToParts(new Date());
  const get=(t:string)=>parts.find(p=>p.type===t)?.value||"";
  return { weekday:get("weekday"), year:Number(get("year")), month:get("month"), day:Number(get("day")), label:`${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}` };
}

export default async (req: Request, context: Context) => {
  const requestId = context.requestId;
  const actor = getActor(req);
  if (!actor) return fail("AUTH_REQUIRED", "Secure login is not configured for this environment.", requestId, 401);
  try {
    const tz = Netlify.env.get("APP_TIME_ZONE") || "Asia/Colombo";
    const p = localParts(tz);
    const [studentsRaw, classesRaw, enrollRaw, feesRaw, attendanceRaw] = await Promise.all([
      readRange("Students!A1:V1000", "FORMATTED_VALUE"), readRange("Classes!A1:P1000", "FORMATTED_VALUE"), readRange("Enrollments!A1:L5000", "UNFORMATTED_VALUE"), readRange("'Fee Tracker'!A1:R2000", "FORMATTED_VALUE"), readRange("Attendance!A1:Q5000", "UNFORMATTED_VALUE")
    ]);
    const students=rowsToObjects(studentsRaw) as Record<string,unknown>[];
    const classes=rowsToObjects(classesRaw) as Record<string,unknown>[];
    const enroll=rowsToObjects(enrollRaw) as Record<string,unknown>[];
    const fees=rowsToObjects(feesRaw) as Record<string,unknown>[];
    const attendance=rowsToObjects(attendanceRaw) as Record<string,unknown>[];
    const activeStudents=students.filter(x=>String(x["Status"]).toLowerCase()==="active");
    const todayClasses=classes.filter(x=>String(x["Status"]).toLowerCase()==="active" && String(x["Default Day"]).toLowerCase()===p.weekday.toLowerCase());
    const todayIds=new Set(todayClasses.map(x=>String(x["Class ID"])));
    const todayStudentIds=new Set(enroll.filter(x=>{
      if(String(x["Status"]).toLowerCase()!=="active" || !todayIds.has(String(x["Class ID"]))) return false;
      const from=number(x["Enrolled From"]);
      const until=number(x["Enrolled Until"]);
      return (from<=0 || from<=todaySerial) && (until<=0 || until>=todaySerial);
    }).map(x=>String(x["Student ID"])));
    const monthFees=fees.filter(x=>number(x["Year"])===p.year && String(x["Month"]).toLowerCase()===p.month.toLowerCase());
    const collected=monthFees.reduce((s,x)=>s+number(x["Amount Paid (Total This Month)"]),0);
    const outstanding=monthFees.reduce((s,x)=>s+number(x["Balance (Auto)"]),0);
    const paid=monthFees.filter(x=>String(x["Status (Auto)"]).toLowerCase()==="paid").length;
    const partial=monthFees.filter(x=>String(x["Status (Auto)"]).toLowerCase()==="partial").length;
    const unpaid=monthFees.filter(x=>String(x["Status (Auto)"]).toLowerCase()==="unpaid").length;
    const monthIndex = ["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(p.month);
    const todaySerial = Math.floor((Date.UTC(p.year, monthIndex, p.day) - Date.UTC(1899, 11, 30)) / 86400000);
    const attendanceMarked=attendance.filter(x=>number(x["Date"])===todaySerial).length;
    return ok({dateLabel:p.label,activeStudents:activeStudents.length,todayStudents:todayStudentIds.size,todayClasses:todayClasses.length,attendanceMarked,collectedThisMonth:collected,outstandingThisMonth:outstanding,paidStudents:paid,partialStudents:partial,unpaidStudents:unpaid,systemStatus:"healthy",systemMessage:"Google Sheets is connected and responding."}, requestId);
  } catch (error) {
    const message=error instanceof Error?error.message:"Unknown error";
    const config=message.includes("MISSING")||message.includes("AUTH_FAILED");
    return fail(config?"SHEET_CONFIGURATION_REQUIRED":"SHEET_READ_FAILED", config?"Google Sheets backend credentials are not configured yet.":"The master Google Sheet could not be read.", requestId, config?503:502);
  }
};
export const config: Config = { path: "/api/dashboard" };
