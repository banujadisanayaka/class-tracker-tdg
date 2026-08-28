import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AttendanceRecord } from "../lib/types";

function todayIso(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=(x:string)=>p.find(v=>v.type===x)?.value||"";return `${g("year")}-${g("month")}-${g("day")}`;}
const statuses=["Present","Absent","Late","Excused"] as const;

export default function AttendancePage(){
 const qc=useQueryClient();
 const classes=useQuery({queryKey:["classes"],queryFn:api.classes});
 const [classId,setClassId]=useState("");
 const [date,setDate]=useState(todayIso());
 const [marked,setMarked]=useState<Record<string,string>>({});
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [editing,setEditing]=useState<AttendanceRecord|null>(null);
 const [editStatus,setEditStatus]=useState("Present");
 const [editTime,setEditTime]=useState("");
 const [editNotes,setEditNotes]=useState("");
 const [editReason,setEditReason]=useState("");
 const students=useQuery({queryKey:["class-students",classId,date],queryFn:()=>api.classStudents(classId,date),enabled:!!classId});
 const records=useQuery({queryKey:["attendance-records",classId,date],queryFn:()=>api.attendanceRecords(classId,date),enabled:!!classId});
 useEffect(()=>{setMarked({});setNotice("");setError("");setEditing(null);},[classId,date]);
 const activeClasses=useMemo(()=>classes.data?.filter(c=>c.status.toLowerCase()==="active")||[],[classes.data]);
 const activeRecords=useMemo(()=>records.data?.filter(r=>r.recordStatus.toLowerCase()!=="voided")||[],[records.data]);
 const complete=students.data?.length?students.data.every(s=>!!marked[s.id]):false;
 const save=useMutation({
   mutationFn:()=>api.saveAttendance({classId,date,entries:(students.data||[]).map(s=>({studentId:s.id,status:marked[s.id]}))}),
   onSuccess:async r=>{setNotice(`Attendance saved for ${r.saved} students.`);setMarked({});await Promise.all([qc.invalidateQueries({queryKey:["attendance-records",classId,date]}),qc.invalidateQueries({queryKey:["dashboard"]})]);},
   onError:e=>setError((e as Error).message)
 });
 const correct=useMutation({
   mutationFn:()=>{if(!editing) throw new Error("Select an attendance record first.");return api.correctAttendance(editing.id,{status:editStatus,checkInTime:editTime,notes:editNotes,reason:editReason,expectedVersion:editing.version});},
   onSuccess:async r=>{setNotice(`Attendance corrected. New version: ${r.version}.`);setEditing(null);await Promise.all([qc.invalidateQueries({queryKey:["attendance-records",classId,date]}),qc.invalidateQueries({queryKey:["dashboard"]})]);},
   onError:e=>setError((e as Error).message)
 });
 const markAll=()=>setMarked(Object.fromEntries((students.data||[]).map(s=>[s.id,"Present"])));
 const openCorrection=(r:AttendanceRecord)=>{setError("");setEditing(r);setEditStatus(r.status);setEditTime(r.checkInTime||"");setEditNotes(r.notes||"");setEditReason("");};
 const loading=students.isLoading||records.isLoading;
 const loadError=students.isError?(students.error as Error).message:records.isError?(records.error as Error).message:"";
 return <>
  <div className="page-title"><div><h1>Attendance</h1><p>Fast daily attendance marking with Sheet-confirmed saves and safe corrections.</p></div></div>
  {notice&&<div className="success-banner">✓ {notice}</div>}{error&&<div className="form-error page-error"><b>!</b><span>{error}</span></div>}
  <div className="attendance-controls"><label>Class<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Select class…</option>{activeClasses.map(c=><option key={c.id} value={c.id}>{c.name}{c.day?` — ${c.day}`:""}</option>)}</select></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
  {!classId?<div className="empty-card"><b>✓</b><h3>Select a class</h3><p>Choose the class and date to load active enrolled students.</p></div>:loading?<div className="state-card"><div className="spinner"/><strong>Loading attendance…</strong></div>:loadError?<div className="state-card error-state"><b>!</b><strong>Attendance could not be loaded.</strong><span>{loadError}</span></div>:activeRecords.length>0?<section className="history-section">
    <div className="history-header"><div><h2>Saved attendance</h2><p>This date is already saved. Correct mistakes here instead of saving a second attendance set.</p></div><span className="status active">{activeRecords.length} records</span></div>
    <div className="record-list">{activeRecords.map(r=><article className="record-card" key={r.id}><div className="record-main"><strong>{r.studentName||r.studentId}</strong><span>{r.studentId} · {r.id}</span><small>Version {r.version}{r.notes?` · ${r.notes}`:""}</small></div><div className="record-value"><b>{r.status}</b>{r.checkInTime&&<span>{r.checkInTime}</span>}</div><div className="record-actions"><button className="secondary-button" onClick={()=>openCorrection(r)}>Correct</button></div></article>)}</div>
   </section>:(students.data?.length||0)===0?<div className="empty-card"><b>◎</b><h3>No active students</h3><p>This class has no active enrollments for the selected date.</p></div>:<>
   <div className="attendance-toolbar"><div><strong>{students.data?.length} students</strong><span>{Object.keys(marked).length} marked</span></div><button className="secondary-button" onClick={markAll}>✓ Mark All Present</button></div>
   <div className="attendance-list">{students.data?.map(s=><article className="attendance-row" key={s.id}><div><strong>{s.name}</strong><span>{s.id}</span></div><div className="attendance-actions">{statuses.map(st=><button key={st} className={marked[s.id]===st?`att-${st.toLowerCase()} selected`:`att-${st.toLowerCase()}`} onClick={()=>setMarked(v=>({...v,[s.id]:st}))}>{st}</button>)}</div></article>)}</div>
   <div className="sticky-save"><div><strong>{Object.keys(marked).length} / {students.data?.length} marked</strong><span>{complete?"Ready to save":"Mark every student before saving"}</span></div><button className="primary-button" disabled={!complete||save.isPending} onClick={()=>{setError("");save.mutate();}}>{save.isPending?"Saving to Google Sheet…":"Save Attendance"}</button></div>
  </>}
  {editing&&<div className="modal-backdrop"><section className="modal-panel compact"><div className="modal-header"><div><h2>Correct attendance</h2><p>{editing.studentName||editing.studentId} · Version {editing.version}</p></div><button className="icon-button" onClick={()=>setEditing(null)}>×</button></div><form onSubmit={e=>{e.preventDefault();setError("");correct.mutate();}}><div className="form-section"><div className="form-grid"><label>Status *<select value={editStatus} onChange={e=>setEditStatus(e.target.value)}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><label>Check-in time<input type="time" value={editTime} onChange={e=>setEditTime(e.target.value)}/></label><label className="span-2">Notes<textarea rows={3} value={editNotes} onChange={e=>setEditNotes(e.target.value)}/></label><label className="span-2">Correction reason *<textarea required rows={3} value={editReason} onChange={e=>setEditReason(e.target.value)} placeholder="Why is this attendance being changed?"/></label></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>setEditing(null)}>Cancel</button><button className="primary-button" disabled={!editReason.trim()||correct.isPending}>{correct.isPending?"Saving correction…":"Save Correction"}</button></div></form></section></div>}
 </>;
}
