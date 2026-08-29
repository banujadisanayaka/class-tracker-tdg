import type { ApiEnvelope, AttendanceCorrectionInput, AttendanceRecord, AttendanceSaveInput, ClassItem, ClassStudent, DashboardData, HistoryPayload, PaymentCorrectionInput, PaymentInput, PaymentRecord, ReferenceOption, ReportPayload, Student, StudentCreateInput, TodayData } from "./types";
export class ApiError extends Error{constructor(public code:string,message:string,public status:number){super(message);this.name="ApiError";}}
function requestId(){return crypto.randomUUID();}
async function request<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(path,{...init,headers:{"Content-Type":"application/json",...(init?.headers||{})}});const body=(await response.json()) as ApiEnvelope<T>;if(!response.ok||!body.success||body.data===undefined)throw new ApiError(body.error?.code||"REQUEST_FAILED",body.error?.message||"The server could not complete the request.",response.status);return body.data;}
export const api={
 dashboard:()=>request<DashboardData>("/api/dashboard"),
 students:()=>request<Student[]>("/api/students"),
 classes:()=>request<ClassItem[]>("/api/classes"),
 today:()=>request<TodayData>("/api/today"),
 classStudents:(id:string,date?:string)=>request<ClassStudent[]>(`/api/classes/${encodeURIComponent(id)}/students${date?`?date=${encodeURIComponent(date)}`:""}`),
 reference:(type:string)=>request<ReferenceOption[]>(`/api/reference/${encodeURIComponent(type)}`),
 addReference:(type:string,value:string)=>request<{id:string;value:string;existing:boolean}>(`/api/reference/${encodeURIComponent(type)}`,{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify({value})}),
 createStudent:(input:StudentCreateInput)=>request<{id:string;name:string;status:string;classIds:string[]}>("/api/students",{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 attendanceRecords:(filters:{classId:string;date:string})=>request<AttendanceRecord[]>(`/api/attendance?classId=${encodeURIComponent(filters.classId)}&date=${encodeURIComponent(filters.date)}`),
 saveAttendance:(input:AttendanceSaveInput)=>request<{sessionId:string;classId:string;date:string;saved:number}>("/api/attendance",{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 correctAttendance:(id:string,input:AttendanceCorrectionInput)=>request<{attendanceId:string;status:string;version:number;idempotent?:boolean}>(`/api/attendance/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 payments:(filters?:{studentId?:string;year?:number;month?:string})=>{const p=new URLSearchParams();if(filters?.studentId)p.set("studentId",filters.studentId);if(filters?.year)p.set("year",String(filters.year));if(filters?.month)p.set("month",filters.month);const q=p.toString();return request<PaymentRecord[]>(`/api/payments${q?`?${q}`:""}`);},
 recordPayment:(input:PaymentInput)=>request<{paymentId:string;feeRecordId:string;studentId:string;year:number;month:string;monthlyFee:number;paidAfter:number;balanceAfter:number;status:string}>("/api/payments",{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 correctPayment:(id:string,input:PaymentCorrectionInput)=>request<{paymentId:string;status:string;version:number;amount:number;feeRecordId:string;idempotent?:boolean}>(`/api/payments/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 voidPayment:(id:string,input:{reason:string;expectedVersion:number})=>request<{paymentId:string;status:string;version:number;idempotent?:boolean}>(`/api/payments/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 report:(filters:{type:"financial"|"attendance"|"students"|"classes"|"staff";from:string;to:string})=>{const p=new URLSearchParams({type:filters.type,from:filters.from,to:filters.to});return request<ReportPayload>(`/api/reports?${p.toString()}`);},
 history:(filters:{from:string;to:string;module?:string})=>{const p=new URLSearchParams({from:filters.from,to:filters.to});if(filters.module)p.set("module",filters.module);return request<HistoryPayload>(`/api/history?${p.toString()}`);},
};
