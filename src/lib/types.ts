export type SystemStatus = "healthy" | "warning" | "error" | "config";
export interface DashboardData { dateLabel:string;activeStudents:number;todayStudents:number;todayClasses:number;attendanceMarked:number;collectedThisMonth:number;outstandingThisMonth:number;paidStudents:number;partialStudents:number;unpaidStudents:number;systemStatus:SystemStatus;systemMessage:string; }
export interface Student { id:string;name:string;birthday?:string;admitDate?:string;phone?:string;whatsapp?:string;guardianName?:string;relationship?:string;guardianPhone?:string;guardianWhatsapp?:string;address?:string;startingFee?:number;status:string;notes?:string;currentFee?:number; }
export interface ClassItem { id:string;name:string;subject:string;grade:string;day:string;startTime:string;endTime:string;teacher:string;location:string;status:string; }
export interface ClassStudent { id:string;name:string;phone:string;status:string; }
export interface TodayData { weekday:string;classes:Array<ClassItem & {studentCount:number}>; }
export interface ReferenceOption { id:string;value:string;adminEditable:boolean; }
export interface StudentCreateInput { name:string;birthday?:string;admitDate:string;phone?:string;whatsapp?:string;guardianName?:string;relationship?:string;guardianPhone?:string;guardianWhatsapp?:string;address?:string;startingFee:number;notes?:string;classIds:string[];forceDuplicate?:boolean; }
export interface AttendanceSaveInput { classId:string;date:string;entries:Array<{studentId:string;status:string;checkInTime?:string;notes?:string}>; }
export interface PaymentInput { studentId:string;year:number;month:string;paymentDate:string;amount:number;paymentMethod:string;receiptRef?:string;notes?:string; }
export interface ApiEnvelope<T>{success:boolean;requestId:string;data?:T;error?:{code:string;message:string};}

export interface AttendanceRecord { id:string;date:string;studentId:string;studentName:string;status:string;checkInTime:string;className:string;classId:string;notes:string;sessionId:string;version:number;recordStatus:string;updatedAt:string; }
export interface PaymentRecord { id:string;feeRecordId:string;studentId:string;year:number;month:string;paymentDate:string;amount:number;paymentMethod:string;receiptRef:string;notes:string;status:string;recordedBy:string;recordedAt:string;updatedBy:string;updatedAt:string;correctionReason:string;version:number;requestId:string; }
export interface AttendanceCorrectionInput { status:string;checkInTime?:string;notes?:string;reason:string;expectedVersion:number; }
export interface PaymentCorrectionInput { amount:number;paymentDate:string;paymentMethod:string;receiptRef?:string;notes?:string;reason:string;expectedVersion:number; }
export interface PaymentVoidInput { reason:string;expectedVersion:number; }
