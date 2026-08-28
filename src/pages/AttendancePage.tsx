import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

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
 const students=useQuery({queryKey:["class-students",classId],queryFn:()=>api.classStudents(classId),enabled:!!classId});
 useEffect(()=>{setMarked({});setNotice("");setError("");},[classId,date]);
 const activeClasses=useMemo(()=>classes.data?.filter(c=>c.status.toLowerCase()==="active")||[],[classes.data]);
 const complete=students.data?.length?students.data.every(s=>!!marked[s.id]):false;
 const save=useMutation({mutationFn:()=>api.saveAttendance({classId,date,entries:(students.data||[]).map(s=>({studentId:s.id,status:marked[s.id]}))}),onSuccess:async r=>{setNotice(`Attendance saved for ${r.saved} students.`);await qc.invalidateQueries({queryKey:["dashboard"]});},onError:e=>setError((e as Error).message)});
 const markAll=()=>setMarked(Object.fromEntries((students.data||[]).map(s=>[s.id,"Present"])));
 return <>
  <div className="page-title"><div><h1>Attendance</h1><p>Fast daily attendance marking with Sheet-confirmed saves.</p></div></div>
  {notice&&<div className="success-banner">✓ {notice}</div>}{error&&<div className="form-error page-error"><b>!</b><span>{error}</span></div>}
  <div className="attendance-controls"><label>Class<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Select class…</option>{activeClasses.map(c=><option key={c.id} value={c.id}>{c.name}{c.day?` — ${c.day}`:""}</option>)}</select></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
  {!classId?<div className="empty-card"><b>✓</b><h3>Select a class</h3><p>Choose the class and date to load active enrolled students.</p></div>:students.isLoading?<div className="state-card"><div className="spinner"/><strong>Loading class students…</strong></div>:students.isError?<div className="state-card error-state"><b>!</b><strong>Class students could not be loaded.</strong><span>{(students.error as Error).message}</span></div>:(students.data?.length||0)===0?<div className="empty-card"><b>◎</b><h3>No active students</h3><p>This class has no active enrollments.</p></div>:<>
   <div className="attendance-toolbar"><div><strong>{students.data?.length} students</strong><span>{Object.keys(marked).length} marked</span></div><button className="secondary-button" onClick={markAll}>✓ Mark All Present</button></div>
   <div className="attendance-list">{students.data?.map(s=><article className="attendance-row" key={s.id}><div><strong>{s.name}</strong><span>{s.id}</span></div><div className="attendance-actions">{statuses.map(st=><button key={st} className={marked[s.id]===st?`att-${st.toLowerCase()} selected`:`att-${st.toLowerCase()}`} onClick={()=>setMarked(v=>({...v,[s.id]:st}))}>{st}</button>)}</div></article>)}</div>
   <div className="sticky-save"><div><strong>{Object.keys(marked).length} / {students.data?.length} marked</strong><span>{complete?"Ready to save":"Mark every student before saving"}</span></div><button className="primary-button" disabled={!complete||save.isPending} onClick={()=>{setError("");save.mutate();}}>{save.isPending?"Saving to Google Sheet…":"Save Attendance"}</button></div>
  </>}
 </>
}
