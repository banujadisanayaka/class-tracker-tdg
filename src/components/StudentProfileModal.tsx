import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface Props { studentId:string; onClose:()=>void; onUpdated:(message:string)=>void; }

type Tab = "profile" | "attendance" | "payments" | "history";

function money(value:number){return new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR",maximumFractionDigits:0}).format(value||0);}
function niceDate(value:string){if(!value)return "—";const d=new Date(value.includes("T")?value:`${value}T00:00:00`);return Number.isNaN(d.getTime())?value:d.toLocaleDateString("en-LK",{year:"numeric",month:"short",day:"numeric"});}
function niceDateTime(value:string){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString("en-LK");}

const emptyForm={name:"",birthday:"",admitDate:"",phone:"",whatsapp:"",guardianName:"",relationship:"",guardianPhone:"",guardianWhatsapp:"",address:"",startingFee:"",notes:"",status:"Active",classIds:[] as string[],reason:""};

export default function StudentProfileModal({studentId,onClose,onUpdated}:Props){
  const qc=useQueryClient();
  const detail=useQuery({queryKey:["student",studentId],queryFn:()=>api.student(studentId)});
  const classes=useQuery({queryKey:["classes"],queryFn:api.classes});
  const relationships=useQuery({queryKey:["reference","Relationship"],queryFn:()=>api.reference("Relationship")});
  const [tab,setTab]=useState<Tab>("profile");
  const [editing,setEditing]=useState(false);
  const [error,setError]=useState("");
  const [form,setForm]=useState(emptyForm);
  const data=detail.data;
  const activeClasses=useMemo(()=>classes.data?.filter(c=>c.status.toLowerCase()==="active")||[],[classes.data]);

  useEffect(()=>{
    if(!data)return;
    setForm({
      name:data.student.name,birthday:data.student.birthday||"",admitDate:data.student.admitDate||"",phone:data.student.phone||"",whatsapp:data.student.whatsapp||"",
      guardianName:data.student.guardianName||"",relationship:data.student.relationship||"",guardianPhone:data.student.guardianPhone||"",guardianWhatsapp:data.student.guardianWhatsapp||"",
      address:data.student.address||"",startingFee:String(data.student.startingFee??0),notes:data.student.notes||"",status:data.student.status||"Active",
      classIds:data.enrollments.filter(e=>e.status.toLowerCase()==="active").map(e=>e.classId),reason:"",
    });
  },[data?.student.version,studentId]);

  const set=(key:string,value:string|string[])=>setForm(v=>({...v,[key]:value}));
  const toggleClass=(id:string)=>setForm(v=>({...v,classIds:v.classIds.includes(id)?v.classIds.filter(x=>x!==id):[...v.classIds,id]}));
  const save=useMutation({
    mutationFn:()=>api.updateStudent(studentId,{
      name:form.name,birthday:form.birthday||undefined,admitDate:form.admitDate,phone:form.phone,whatsapp:form.whatsapp,guardianName:form.guardianName,
      relationship:form.relationship,guardianPhone:form.guardianPhone,guardianWhatsapp:form.guardianWhatsapp,address:form.address,startingFee:Number(form.startingFee),notes:form.notes,
      status:form.status,classIds:form.classIds,reason:form.reason,expectedVersion:data!.student.version,
    }),
    onSuccess:async result=>{
      await Promise.all([
        qc.invalidateQueries({queryKey:["student",studentId]}),qc.invalidateQueries({queryKey:["students"]}),qc.invalidateQueries({queryKey:["dashboard"]}),
        qc.invalidateQueries({queryKey:["class-students"]}),qc.invalidateQueries({queryKey:["history"]}),
      ]);
      setEditing(false);setError("");onUpdated(`Student ${result.id} updated in Google Sheets. Version ${result.version}.`);
    },
    onError:async e=>{
      const err=e as ApiError;
      setError(err.message);
      if(err.code==="VERSION_CONFLICT") await qc.invalidateQueries({queryKey:["student",studentId]});
    },
  });
  const submit=(e:FormEvent)=>{
    e.preventDefault();setError("");
    if(!form.reason.trim()){setError("Please enter a reason for this change.");return;}
    if(form.status==="Active"&&!form.classIds.length){setError("An active student must have at least one class.");return;}
    save.mutate();
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!save.isPending)onClose();}}>
    <div className="modal-panel student-profile-modal" role="dialog" aria-modal="true" aria-labelledby="student-profile-title">
      {detail.isLoading?<div className="student-profile-loading"><div className="spinner"/><strong>Loading student profile from Google Sheets…</strong></div>:
       detail.isError?<div className="student-profile-loading"><div className="form-error"><b>!</b><span>{(detail.error as Error).message}</span></div><button className="secondary-button" onClick={()=>detail.refetch()}>Retry</button><button className="secondary-button" onClick={onClose}>Close</button></div>:
       data?<>
        <div className="modal-header student-profile-head"><div className="student-title-row"><div className="student-avatar large">{data.student.name.slice(0,1).toUpperCase()}</div><div><h2 id="student-profile-title">{data.student.name}</h2><p>{data.student.id} · Version {data.student.version}</p></div></div><div className="profile-head-actions"><span className={`status ${data.student.status.toLowerCase()}`}>{data.student.status}</span>{!editing&&<button className="secondary-button" onClick={()=>{setEditing(true);setError("");}}>Edit Student</button>}<button className="icon-button" onClick={onClose} disabled={save.isPending}>×</button></div></div>
        {editing?<form className="student-edit-form" onSubmit={submit}>
          {error&&<div className="form-error"><b>!</b><span>{error}</span></div>}
          {(form.status==="Archived"||form.status==="Left")&&<div className="danger-note"><strong>{form.status} student</strong><span>Saving this status will close active class enrolments. Historical attendance and payments are preserved.</span></div>}
          {form.status==="Inactive"&&<div className="warning-banner"><b>Inactive student</b><span>Existing class enrolments stay on record, but the student will not appear in active attendance lists until reactivated.</span></div>}
          <div className="form-section"><h3>Student details</h3><div className="form-grid">
            <label className="span-2">Student Name *<input value={form.name} onChange={e=>set("name",e.target.value)} required autoFocus/></label>
            <label>Birthday<input type="date" value={form.birthday} onChange={e=>set("birthday",e.target.value)}/></label>
            <label>Admit Date *<input type="date" value={form.admitDate} onChange={e=>set("admitDate",e.target.value)} required/></label>
            <label>Student Telephone<input inputMode="tel" value={form.phone} onChange={e=>set("phone",e.target.value)}/></label>
            <label>Student WhatsApp<input inputMode="tel" value={form.whatsapp} onChange={e=>set("whatsapp",e.target.value)}/></label>
            <label className="span-2">Address<textarea rows={2} value={form.address} onChange={e=>set("address",e.target.value)}/></label>
          </div></div>
          <div className="form-section"><h3>Parent / Guardian</h3><div className="form-grid">
            <label className="span-2">Parent / Guardian Name<input value={form.guardianName} onChange={e=>set("guardianName",e.target.value)}/></label>
            <label>Relationship<select value={form.relationship} onChange={e=>set("relationship",e.target.value)}><option value="">Select…</option>{form.relationship&&!relationships.data?.some(x=>x.value===form.relationship)&&<option value={form.relationship}>{form.relationship}</option>}{relationships.data?.map(x=><option key={x.id} value={x.value}>{x.value}</option>)}</select></label>
            <label>Parent Telephone<input inputMode="tel" value={form.guardianPhone} onChange={e=>set("guardianPhone",e.target.value)}/></label>
            <label>Parent WhatsApp<input inputMode="tel" value={form.guardianWhatsapp} onChange={e=>set("guardianWhatsapp",e.target.value)}/></label>
          </div></div>
          <div className="form-section"><h3>Status, class & fee</h3><div className="form-grid">
            <label>Status<select value={form.status} onChange={e=>set("status",e.target.value)}><option>Active</option><option>Inactive</option><option>Left</option><option>Archived</option></select></label>
            <label>Starting Monthly Fee *<input type="number" min="0" step="1" value={form.startingFee} onChange={e=>set("startingFee",e.target.value)} required/></label>
            <div className="span-2 class-picker"><span>Active class enrolments</span>{activeClasses.length?<div className="class-check-grid">{activeClasses.map(c=><label key={c.id} className={form.classIds.includes(c.id)?"checked":""}><input type="checkbox" checked={form.classIds.includes(c.id)} onChange={()=>toggleClass(c.id)} disabled={form.status==="Archived"||form.status==="Left"}/><div><strong>{c.name}</strong><small>{[c.day,c.startTime,c.grade].filter(Boolean).join(" · ")}</small></div></label>)}</div>:<small>No active classes found.</small>}</div>
            <label className="span-2">Notes<textarea rows={2} value={form.notes} onChange={e=>set("notes",e.target.value)}/></label>
            <label className="span-2">Reason for change *<textarea rows={2} value={form.reason} onChange={e=>set("reason",e.target.value)} required placeholder="e.g. Parent requested phone number and class update"/><small className="field-help">Saved to the Audit Log with the before/after values.</small></label>
          </div></div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={()=>{setEditing(false);setError("");detail.refetch();}} disabled={save.isPending}>Cancel</button><button className="primary-button" disabled={save.isPending}>{save.isPending?"Saving to Google Sheets…":"Save Changes"}</button></div>
        </form>:<div className="student-profile-body">
          <section className="profile-summary-grid"><div><span>Current fee</span><strong>{money(data.student.currentFee||data.student.startingFee||0)}</strong></div><div><span>Active classes</span><strong>{data.summary.activeEnrollments}</strong></div><div><span>Attendance rate</span><strong>{data.summary.attendanceRate}%</strong></div><div><span>Total paid recorded</span><strong>{money(data.summary.totalPaid)}</strong></div></section>
          <div className="profile-tabs"><button className={tab==="profile"?"active":""} onClick={()=>setTab("profile")}>Profile</button><button className={tab==="attendance"?"active":""} onClick={()=>setTab("attendance")}>Attendance</button><button className={tab==="payments"?"active":""} onClick={()=>setTab("payments")}>Payments</button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>History</button></div>
          {tab==="profile"&&<div className="profile-pane">
            <div className="profile-info-grid"><div><small>Birthday</small><strong>{niceDate(data.student.birthday||"")}</strong></div><div><small>Admit date</small><strong>{niceDate(data.student.admitDate||"")}</strong></div><div><small>Student phone</small><strong>{data.student.phone||"—"}</strong></div><div><small>Student WhatsApp</small><strong>{data.student.whatsapp||"—"}</strong></div><div><small>Parent / guardian</small><strong>{data.student.guardianName||"—"}</strong><span>{data.student.relationship||""}</span></div><div><small>Parent telephone</small><strong>{data.student.guardianPhone||"—"}</strong></div><div className="span-2"><small>Address</small><strong>{data.student.address||"—"}</strong></div><div className="span-2"><small>Notes</small><strong>{data.student.notes||"—"}</strong></div></div>
            <div className="profile-subsection"><div className="history-header"><div><h2>Class enrolments</h2><p>Current and historical class membership.</p></div><span>{data.enrollments.length} records</span></div>{data.enrollments.length?<div className="enrollment-list">{data.enrollments.map(e=><div className="enrollment-card" key={e.id}><div><strong>{e.className}</strong><span>{[e.subject,e.grade,e.day].filter(Boolean).join(" · ")}</span><small>{niceDate(e.enrolledFrom)} → {e.enrolledUntil?niceDate(e.enrolledUntil):"Current"}</small></div><span className={`status ${e.status.toLowerCase()}`}>{e.status}</span></div>)}</div>:<div className="empty-card compact">No enrolment records.</div>}</div>
            <div className="profile-audit-meta"><span>Created {niceDateTime(data.student.createdAt)} by {data.student.createdBy||"—"}</span><span>Last updated {niceDateTime(data.student.updatedAt)} by {data.student.updatedBy||"—"}</span></div>
          </div>}
          {tab==="attendance"&&<div className="profile-pane">{data.recentAttendance.length?<div className="profile-record-list">{data.recentAttendance.map(a=><div className="profile-record" key={a.id}><div><strong>{a.className||a.classId}</strong><span>{niceDate(a.date)}{a.checkInTime?` · ${a.checkInTime}`:""}</span><small>{a.notes||a.id}</small></div><span className={`record-badge ${a.recordStatus.toLowerCase()==="voided"?"voided":"active"}`}>{a.status}</span></div>)}</div>:<div className="empty-card compact">No attendance recorded for this student yet.</div>}</div>}
          {tab==="payments"&&<div className="profile-pane">{data.recentPayments.length?<div className="profile-record-list">{data.recentPayments.map(p=><div className="profile-record" key={p.id}><div><strong>{p.month} {p.year}</strong><span>{niceDate(p.paymentDate)} · {p.paymentMethod||"Method not set"}</span><small>{p.receiptRef||p.id}</small></div><div className="profile-record-value"><b>{money(p.amount)}</b><span className={`record-badge ${p.status.toLowerCase()==="active"?"active":"voided"}`}>{p.status}</span></div></div>)}</div>:<div className="empty-card compact">No payments recorded for this student yet.</div>}</div>}
          {tab==="history"&&<div className="profile-pane">{data.history.length?<div className="profile-record-list">{data.history.map(h=><details className="student-history-event" key={h.id}><summary><div><strong>{h.action} · {h.module}</strong><span>{niceDateTime(h.timestamp)} · {h.actorEmail||h.actorRole}</span></div><span className={`record-badge ${h.result.toLowerCase()==="success"?"active":"voided"}`}>{h.result||"Logged"}</span></summary><div className="student-history-body">{h.reason&&<p><b>Reason:</b> {h.reason}</p>}<div><small>Before</small><pre>{h.beforeValue||"—"}</pre></div><div><small>After</small><pre>{h.afterValue||"—"}</pre></div></div></details>)}</div>:<div className="empty-card compact">No audit history available for this student.</div>}</div>}
        </div>}
       </>:null}
    </div>
  </div>;
}
