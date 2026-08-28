import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface Props { onClose: () => void; onSaved: (id: string) => void; }

function todayIso() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get=(x:string)=>p.find(v=>v.type===x)?.value||"";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export default function StudentFormModal({ onClose, onSaved }: Props) {
  const qc=useQueryClient();
  const classes=useQuery({queryKey:["classes"],queryFn:api.classes});
  const relationships=useQuery({queryKey:["reference","Relationship"],queryFn:()=>api.reference("Relationship")});
  const [form,setForm]=useState({name:"",birthday:"",admitDate:todayIso(),phone:"",whatsapp:"",guardianName:"",relationship:"",guardianPhone:"",guardianWhatsapp:"",address:"",startingFee:"",classId:"",notes:""});
  const [newRelationship,setNewRelationship]=useState("");
  const [error,setError]=useState("");
  const activeClasses=useMemo(()=>classes.data?.filter(c=>c.status.toLowerCase()==="active")||[],[classes.data]);
  const set=(key:string,value:string)=>setForm(v=>({...v,[key]:value}));

  const addRelationship=useMutation({
    mutationFn:()=>api.addReference("Relationship",newRelationship),
    onSuccess:async result=>{await qc.invalidateQueries({queryKey:["reference","Relationship"]});set("relationship",result.value);setNewRelationship("");},
    onError:e=>setError((e as Error).message),
  });
  const create=useMutation({
    mutationFn:()=>api.createStudent({
      name:form.name,birthday:form.birthday||undefined,admitDate:form.admitDate,phone:form.phone,whatsapp:form.whatsapp,guardianName:form.guardianName,relationship:form.relationship,guardianPhone:form.guardianPhone,guardianWhatsapp:form.guardianWhatsapp,address:form.address,startingFee:Number(form.startingFee),notes:form.notes,classIds:[form.classId],
    }),
    onSuccess:async result=>{await Promise.all([qc.invalidateQueries({queryKey:["students"]}),qc.invalidateQueries({queryKey:["dashboard"]})]);onSaved(result.id);},
    onError:e=>{const err=e as ApiError;setError(err.code==="POSSIBLE_DUPLICATE"?`${err.message} If this is definitely a different student, duplicate override will be added in the next UI pass.`:err.message);},
  });
  const submit=(e:React.FormEvent)=>{e.preventDefault();setError("");if(!form.classId){setError("Please select a class.");return;}create.mutate();};

  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!create.isPending)onClose();}}>
    <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="add-student-title">
      <div className="modal-header"><div><h2 id="add-student-title">Add Student</h2><p>Create the permanent student record and class enrollment.</p></div><button className="icon-button" onClick={onClose} disabled={create.isPending}>×</button></div>
      <form onSubmit={submit}>
        {error&&<div className="form-error"><b>!</b><span>{error}</span></div>}
        <div className="form-section"><h3>Student</h3><div className="form-grid">
          <label className="span-2">Student Name *<input value={form.name} onChange={e=>set("name",e.target.value)} required autoFocus/></label>
          <label>Birthday<input type="date" value={form.birthday} onChange={e=>set("birthday",e.target.value)}/></label>
          <label>Admit Date *<input type="date" value={form.admitDate} onChange={e=>set("admitDate",e.target.value)} required/></label>
          <label>Student Telephone<input inputMode="tel" value={form.phone} onChange={e=>set("phone",e.target.value)}/></label>
          <label>Student WhatsApp<input inputMode="tel" value={form.whatsapp} onChange={e=>set("whatsapp",e.target.value)}/></label>
          <label className="span-2">Address<textarea rows={2} value={form.address} onChange={e=>set("address",e.target.value)}/></label>
        </div></div>
        <div className="form-section"><h3>Parent / Guardian</h3><div className="form-grid">
          <label className="span-2">Parent / Guardian Name<input value={form.guardianName} onChange={e=>set("guardianName",e.target.value)}/></label>
          <label>Relationship<select value={form.relationship} onChange={e=>set("relationship",e.target.value)}><option value="">Select…</option>{relationships.data?.map(x=><option key={x.id} value={x.value}>{x.value}</option>)}</select></label>
          <div className="smart-add"><span>Add new relationship</span><div><input value={newRelationship} onChange={e=>setNewRelationship(e.target.value)} placeholder="e.g. Aunt"/><button type="button" className="secondary-button" disabled={!newRelationship.trim()||addRelationship.isPending} onClick={()=>addRelationship.mutate()}>Add</button></div></div>
          <label>Parent Telephone<input inputMode="tel" value={form.guardianPhone} onChange={e=>set("guardianPhone",e.target.value)}/></label>
          <label>Parent WhatsApp<input inputMode="tel" value={form.guardianWhatsapp} onChange={e=>set("guardianWhatsapp",e.target.value)}/></label>
        </div></div>
        <div className="form-section"><h3>Class & Fee</h3><div className="form-grid">
          <label>Class *<select value={form.classId} onChange={e=>set("classId",e.target.value)} required><option value="">Select class…</option>{activeClasses.map(c=><option key={c.id} value={c.id}>{c.name}{c.day?` — ${c.day}`:""}</option>)}</select><small className="field-help">New classes are created in Class Management because a class also needs schedule details.</small></label>
          <label>Starting Monthly Fee *<input type="number" min="0" step="1" inputMode="decimal" value={form.startingFee} onChange={e=>set("startingFee",e.target.value)} required placeholder="6500"/></label>
          <label className="span-2">Notes<textarea rows={2} value={form.notes} onChange={e=>set("notes",e.target.value)}/></label>
        </div></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={create.isPending}>Cancel</button><button className="primary-button" disabled={create.isPending}>{create.isPending?"Saving to Google Sheet…":"Save Student"}</button></div>
      </form>
    </div>
  </div>
}
