import type { ApiEnvelope, AttendanceSaveInput, ClassItem, ClassStudent, DashboardData, PaymentInput, ReferenceOption, Student, StudentCreateInput, TodayData } from "./types";
export class ApiError extends Error{constructor(public code:string,message:string,public status:number){super(message);this.name="ApiError";}}
function requestId(){return crypto.randomUUID();}
async function request<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(path,{...init,headers:{"Content-Type":"application/json",...(init?.headers||{})}});const body=(await response.json()) as ApiEnvelope<T>;if(!response.ok||!body.success||body.data===undefined)throw new ApiError(body.error?.code||"REQUEST_FAILED",body.error?.message||"The server could not complete the request.",response.status);return body.data;}
export const api={
 dashboard:()=>request<DashboardData>("/api/dashboard"),students:()=>request<Student[]>("/api/students"),classes:()=>request<ClassItem[]>("/api/classes"),today:()=>request<TodayData>("/api/today"),classStudents:(id:string)=>request<ClassStudent[]>(`/api/classes/${encodeURIComponent(id)}/students`),reference:(type:string)=>request<ReferenceOption[]>(`/api/reference/${encodeURIComponent(type)}`),
 addReference:(type:string,value:string)=>request<{id:string;value:string;existing:boolean}>(`/api/reference/${encodeURIComponent(type)}`,{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify({value})}),
 createStudent:(input:StudentCreateInput)=>request<{id:string;name:string;status:string;classIds:string[]}>("/api/students",{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 saveAttendance:(input:AttendanceSaveInput)=>request<{sessionId:string;classId:string;date:string;saved:number}>("/api/attendance",{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
 recordPayment:(input:PaymentInput)=>request<{paymentId:string;feeRecordId:string;studentId:string;year:number;month:string;monthlyFee:number;paidAfter:number;balanceAfter:number;status:string}>("/api/payments",{method:"POST",headers:{"x-request-id":requestId()},body:JSON.stringify(input)}),
};
