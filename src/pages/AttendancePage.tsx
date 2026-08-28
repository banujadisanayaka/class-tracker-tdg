import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AttendanceRecord } from "../lib/types";

function todayIso(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=(x:string)=>p.find(v=>v.type===x)?.value||"";return g("year")+"-"+g("month")+"-"+g("day");}
const statuses=["Present","Absent","Late","Excused"] as const;

export default function AttendancePage(){
 const qc=useQueryClient();
 const classes=useQuery({queryKey:["classes"],queryFn:api.classes});
 const [classId,setClassId]=useState("");
 const [date,setDate]=useState(todayIso());
 const [marked,setMarked]=useState<Record<string,string>>({});
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [editTarget,setEditTarget]=useState<AttendanceRecord|null>(null);
 const [edit,setEdit]=useState({status:"Present",checkInTime:"",notes:"",reason:""});

 const students=useQuery({queryKey:["class-students",classId,date],queryFn:()=>api.classStudents(classId,date),enabled:!!classId});
 const records=useQuery({queryKey:["attendance-records",classId,date],queryFn:()=>api.attendanceRecords({classId,date}),enabled:!!classId});
 useEffect(()=>{setMarked({});setNotice("");setError("");setEditTarget(null);},[classId,date]);
 useEffect(()=>{const active=(records.data||[]).filter(r=>r.recordStatus.toLowerCase()!=="voided");if(active.length)setMarked(Object.fromEntries(active.map(r=>[r.studentId,r.status])));},[records.data]);

 const activeClasses=useMemo(()=>classes.data?.filter(c=>c.status.toLowerCase()==="active")||[],[classes.data]);
 const activeSaved=useMemo(()=>(records.data||[]).filter(r=>r.recordStatus.toLowerCase()!=="voided"),[records.data]);
 const alreadySaved=activeSaved.length>0;
 const complete=students.data?.length?students.data.every(s=>!!marked[s.id]):false;

 const save=useMutation({
  mutationFn:()=>api.saveAttendance({classId,date,entries:(students.data||[]).map(s=>({studentId:s.id,status:marked[s.id]}))}),
  onSuccess:async r=>{setNotice("Attendance saved for "+r.saved+" students.");await Promise.all([qc.invalidateQueries({queryKey:["dashboard"]}),qc.invalidateQueries({queryKey:["attendance-records",classId,date]})]);},
  onError:e=>setError((e as Error).message)
 });
 const correct=useMutation({
  mutationFn:()=>api.correctAttendance(editTarget!.id,{status:edit.status,checkInTime:edit.checkInTime,notes:edit.notes,reason:edit.reason,expectedVersion:editTarget!.version}),
  onSuccess:async r=>{setNotice("Attendance "+r.attendanceId+" corrected successfully.");setEditTarget(null);await Promise.all([qc.invalidateQueries({queryKey:["attendance-records",classId,date]}),qc.invalidateQueries({queryKey:["dashboard"]})]);},
  onError:async e=>{setError((e as Error).message);await qc.invalidateQueries({queryKey:["attendance-records",classId,date]});}
 });
 const markAll=()=>{if(!alreadySaved)setMarked(Object.fromEntries((students.data||[]).map(s=>[s.id,"Present"])));};
 const openCorrection=(r:AttendanceRecord)=>{setError("");setNotice("");setEditTarget(r);setEdit({status:r.status,checkInTime:r.checkInTime,notes:r.notes,reason:""});};

 return <>
  <div className="page-title"><div><h1>Attendance</h1><p>Fast daily attendance marking with Sheet-confirmed saves.</p></div></div>
  {notice&&<div className="success-banner">✓ {notice}</div>}{error&&<div className="form-error page-error"><b>!</b><span>{error}</span></div>}
  <div className="attendance-controls"><label>Class<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Select class…</option>{activeClasses.map(c=><option key={c.id} value={c.id}>{c.name+(c.day?" — "+c.day:"")}</option>)}</select></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>

  {alreadySaved&&<div className="warning-banner"><b>Attendance already saved for this class and date.</b><span>Use Correct Attendance below instead of creating a second record.</span></div>}

  {!classId?<div className="empty-card"><b>✓</b><h3>Select a class</h3><p>Choose the class and date to load active enrolled students.</p></div>:students.isLoading?<div className="state-card"><div className="spinner"/><strong>Loading class students…</strong></div>:students.isError?<div className="state-card error-state"><b>!</b><strong>Class students could not be loaded.</strong><span>{(students.error as Error).message}</span></div>:(students.data?.length||0)===0?<div className="empty-card"><b>◎</b><h3>No active students</h3><p>This class has no active enrollments.</p></div>:<>
   <div className="attendance-toolbar"><div><strong>{students.data?.length} students</strong><span>{Object.keys(marked).length} marked</span></div><button className="secondary-button" disabled={alreadySaved} onClick={markAll}>✓ Mark All Present</button></div>
   <div className="attendance-list">{students.data?.map(s=><article className="attendance-row" key={s.id}><div><strong>{s.name}</strong><span>{s.id}</span></div><div className="attendance-actions">{statuses.map(st=><button disabled={alreadySaved} key={st} className={marked[s.id]===st?"att-"+st.toLowerCase()+" selected":"att-"+st.toLowerCase()} onClick={()=>setMarked(v=>({...v,[s.id]:st}))}>{st}</button>)}</div></article>)}</div>
   <div className="sticky-save"><div><strong>{Object.keys(marked).length} / {students.data?.length} marked</strong><span>{alreadySaved?"Already saved — use Correct Attendance below":complete?"Ready to save":"Mark every student before saving"}</span></div><button className="primary-button" disabled={!complete||save.isPending||alreadySaved} onClick={()=>{setError("");save.mutate();}}>{save.isPending?"Saving to Google Sheet…":alreadySaved?"Attendance Already Saved":"Save Attendance"}</button></div>
  </>}

  {classId&&<section className="history-section">
   <div className="history-header"><div><h2>Saved attendance & corrections</h2><p>Corrections require a reason and keep the full audit trail.</p></div>{records.isFetching&&<span>Refreshing…</span>}</div>
   {records.isLoading?<div className="state-card"><div className="spinner"/><strong>Loading saved attendance…</strong></div>:records.isError?<div className="state-card error-state"><b>!</b><strong>Saved attendance could not be loaded.</strong><span>{(records.error as Error).message}</span></div>:(records.data?.length||0)===0?<div className="empty-card compact"><b>◎</b><h3>No saved attendance</h3><p>Attendance records for this class and date will appear here after a confirmed save.</p></div>:<div className="record-list">{records.data?.map(r=><article className="record-card" key={r.id}><div className="record-main"><div><strong>{r.studentName||r.studentId}</strong><span>{r.status+(r.checkInTime?" · "+r.checkInTime:"")}</span><small>{r.id+" · Version "+r.version}</small></div><span className={r.recordStatus.toLowerCase()==="voided"?"record-badge voided":"record-badge active"}>{r.recordStatus}</span></div>{r.notes&&<p className="record-reason">Notes: {r.notes}</p>}<div className="record-actions"><span>{r.date+" · "+r.className}</span>{r.recordStatus.toLowerCase()!=="voided"&&<button className="secondary-button" onClick={()=>openCorrection(r)}>Correct Attendance</button>}</div></article>)}</div>}

   {editTarget&&<div className="correction-panel"><div className="correction-title"><div><strong>Correct attendance</strong><span>{editTarget.id+" · Current version "+editTarget.version}</span></div><button className="secondary-button" onClick={()=>setEditTarget(null)}>Cancel</button></div><div className="form-grid"><label>Status *<select value={edit.status} onChange={e=>setEdit(x=>({...x,status:e.target.value}))}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><label>Check-in time<input type="time" value={edit.checkInTime} onChange={e=>setEdit(x=>({...x,checkInTime:e.target.value}))}/></label><label className="span-2">Notes<textarea rows={2} value={edit.notes} onChange={e=>setEdit(x=>({...x,notes:e.target.value}))}/></label><label className="span-2">Correction reason *<textarea rows={2} value={edit.reason} onChange={e=>setEdit(x=>({...x,reason:e.target.value}))} placeholder="Why is this attendance being corrected?"/></label><button className="primary-button span-2" disabled={!edit.reason.trim()||correct.isPending} onClick={()=>{setError("");correct.mutate();}}>{correct.isPending?"Saving correction…":"Save Attendance Correction"}</button></div></div>}
  </section>}
 </>;
}
