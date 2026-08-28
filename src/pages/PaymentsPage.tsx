import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { PaymentRecord } from "../lib/types";

const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
function localNow(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=(x:string)=>p.find(v=>v.type===x)?.value||"";const m=Number(g("month"));return {date:g("year")+"-"+g("month")+"-"+g("day"),year:Number(g("year")),month:months[m-1]};}
function money(v:number){return new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR",maximumFractionDigits:0}).format(v||0)}

export default function PaymentsPage(){
 const now=localNow();const qc=useQueryClient();
 const students=useQuery({queryKey:["students"],queryFn:api.students});
 const methods=useQuery({queryKey:["reference","Payment Method"],queryFn:()=>api.reference("Payment Method")});
 const [form,setForm]=useState({studentId:"",year:String(now.year),month:now.month,paymentDate:now.date,amount:"",method:"Cash",receiptRef:"",notes:""});
 const [newMethod,setNewMethod]=useState("");
 const [error,setError]=useState("");
 const [result,setResult]=useState<{paymentId:string;balanceAfter:number;status:string}|null>(null);
 const [actionNotice,setActionNotice]=useState("");
 const [actionMode,setActionMode]=useState<"correct"|"void"|null>(null);
 const [actionTarget,setActionTarget]=useState<PaymentRecord|null>(null);
 const [edit,setEdit]=useState({amount:"",paymentDate:"",method:"Cash",receiptRef:"",notes:"",reason:""});

 const activeStudents=useMemo(()=>students.data?.filter(s=>s.status.toLowerCase()==="active")||[],[students.data]);
 const selected=activeStudents.find(s=>s.id===form.studentId);
 const set=(k:string,v:string)=>setForm(x=>({...x,[k]:v}));
 const history=useQuery({
  queryKey:["payments",form.studentId,form.year,form.month],
  queryFn:()=>api.payments({studentId:form.studentId,year:Number(form.year),month:form.month}),
  enabled:!!form.studentId
 });

 const addMethod=useMutation({mutationFn:()=>api.addReference("Payment Method",newMethod),onSuccess:async r=>{await qc.invalidateQueries({queryKey:["reference","Payment Method"]});set("method",r.value);setNewMethod("");},onError:e=>setError((e as Error).message)});
 const record=useMutation({
  mutationFn:()=>api.recordPayment({studentId:form.studentId,year:Number(form.year),month:form.month,paymentDate:form.paymentDate,amount:Number(form.amount),paymentMethod:form.method,receiptRef:form.receiptRef,notes:form.notes}),
  onSuccess:async r=>{setResult({paymentId:r.paymentId,balanceAfter:r.balanceAfter,status:r.status});setActionNotice("");set("amount","");await Promise.all([qc.invalidateQueries({queryKey:["dashboard"]}),qc.invalidateQueries({queryKey:["students"]}),qc.invalidateQueries({queryKey:["payments"]})]);},
  onError:e=>setError((e as Error).message)
 });
 const correct=useMutation({
  mutationFn:()=>api.correctPayment(actionTarget!.id,{amount:Number(edit.amount),paymentDate:edit.paymentDate,paymentMethod:edit.method,receiptRef:edit.receiptRef,notes:edit.notes,reason:edit.reason,expectedVersion:actionTarget!.version}),
  onSuccess:async r=>{setActionNotice("Payment "+r.paymentId+" corrected successfully.");setActionMode(null);setActionTarget(null);await Promise.all([qc.invalidateQueries({queryKey:["payments"]}),qc.invalidateQueries({queryKey:["dashboard"]})]);},
  onError:async e=>{setError((e as Error).message);await qc.invalidateQueries({queryKey:["payments"]});}
 });
 const voidMutation=useMutation({
  mutationFn:()=>api.voidPayment(actionTarget!.id,{reason:edit.reason,expectedVersion:actionTarget!.version}),
  onSuccess:async r=>{setActionNotice("Payment "+r.paymentId+" was voided. Historical record kept.");setActionMode(null);setActionTarget(null);await Promise.all([qc.invalidateQueries({queryKey:["payments"]}),qc.invalidateQueries({queryKey:["dashboard"]})]);},
  onError:async e=>{setError((e as Error).message);await qc.invalidateQueries({queryKey:["payments"]});}
 });

 const submit=(e:React.FormEvent)=>{e.preventDefault();setError("");setResult(null);setActionNotice("");record.mutate();};
 const openCorrect=(p:PaymentRecord)=>{setError("");setActionNotice("");setActionTarget(p);setActionMode("correct");setEdit({amount:String(p.amount),paymentDate:p.paymentDate,method:p.paymentMethod||"Cash",receiptRef:p.receiptRef,notes:p.notes,reason:""});};
 const openVoid=(p:PaymentRecord)=>{setError("");setActionNotice("");setActionTarget(p);setActionMode("void");setEdit({amount:String(p.amount),paymentDate:p.paymentDate,method:p.paymentMethod||"Cash",receiptRef:p.receiptRef,notes:p.notes,reason:""});};
 const closeAction=()=>{setActionMode(null);setActionTarget(null);setEdit({amount:"",paymentDate:"",method:"Cash",receiptRef:"",notes:"",reason:""});};

 return <>
  <div className="page-title"><div><h1>Fees & Payments</h1><p>Admin-only payment entry with permanent transaction history.</p></div></div>
  {error&&<div className="form-error page-error"><b>!</b><span>{error}</span></div>}
  {result&&<div className="payment-success"><b>✓ Payment recorded</b><span>{result.paymentId} · {result.status} · Balance {money(result.balanceAfter)}</span></div>}
  {actionNotice&&<div className="success-banner">✓ {actionNotice}</div>}
  <div className="payment-layout"><form className="payment-form" onSubmit={submit}><div className="form-section"><h3>Student & Month</h3><div className="form-grid"><label className="span-2">Student *<select required value={form.studentId} onChange={e=>set("studentId",e.target.value)}><option value="">Select student…</option>{activeStudents.map(s=><option key={s.id} value={s.id}>{s.name+" — "+s.id}</option>)}</select></label><label>Month<select value={form.month} onChange={e=>set("month",e.target.value)}>{months.map(m=><option key={m}>{m}</option>)}</select></label><label>Year<input type="number" value={form.year} onChange={e=>set("year",e.target.value)} min="2000" max="2200"/></label></div></div>
   <div className="form-section"><h3>Payment</h3><div className="form-grid"><label>Amount Received *<input required type="number" min="1" step="1" inputMode="decimal" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="3500"/></label><label>Paid Date *<input required type="date" value={form.paymentDate} onChange={e=>set("paymentDate",e.target.value)}/></label><label>Payment Method *<select value={form.method} onChange={e=>set("method",e.target.value)}>{methods.data?.map(x=><option key={x.id} value={x.value}>{x.value}</option>)}</select></label><div className="smart-add"><span>Add new method</span><div><input value={newMethod} onChange={e=>setNewMethod(e.target.value)} placeholder="e.g. QR Payment"/><button type="button" className="secondary-button" disabled={!newMethod.trim()||addMethod.isPending} onClick={()=>addMethod.mutate()}>Add</button></div></div><label>Receipt / Ref<input value={form.receiptRef} onChange={e=>set("receiptRef",e.target.value)}/></label><label>Notes<input value={form.notes} onChange={e=>set("notes",e.target.value)}/></label></div></div>
   <button className="primary-button payment-submit" disabled={record.isPending}>{record.isPending?"Saving to Google Sheet…":"Record Payment"}</button></form>
   <aside className="payment-summary"><h3>Selected student</h3>{selected?<><strong>{selected.name}</strong><span>{selected.id}</span><div><small>Current monthly fee</small><b>{money(selected.currentFee||selected.startingFee||0)}</b></div><p>The backend checks the exact selected month's historical fee and remaining balance before accepting a payment.</p></>:<p>Select a student to see their current fee information.</p>}</aside>
  </div>

  <section className="history-section">
   <div className="history-header"><div><h2>Payment history & corrections</h2><p>Select a student and month above. Corrections never delete the original history.</p></div>{history.isFetching&&<span>Refreshing…</span>}</div>
   {!form.studentId?<div className="empty-card compact"><b>₹</b><h3>Select a student</h3><p>Payment history will appear here.</p></div>:history.isLoading?<div className="state-card"><div className="spinner"/><strong>Loading payment history…</strong></div>:history.isError?<div className="state-card error-state"><b>!</b><strong>Payment history could not be loaded.</strong><span>{(history.error as Error).message}</span></div>:(history.data?.length||0)===0?<div className="empty-card compact"><b>◎</b><h3>No payments for this month</h3><p>New payments will appear here after Google Sheets confirms the save.</p></div>:<div className="record-list">{history.data?.map(p=><article className="record-card" key={p.id}><div className="record-main"><div><strong>{money(p.amount)}</strong><span>{p.paymentDate+" · "+p.paymentMethod}</span><small>{p.id+(p.receiptRef?" · Ref "+p.receiptRef:"")}</small></div><span className={p.status.toLowerCase()==="active"?"record-badge active":"record-badge voided"}>{p.status}</span></div>{p.correctionReason&&<p className="record-reason">Last reason: {p.correctionReason}</p>}<div className="record-actions"><span>Version {p.version}</span>{p.status.toLowerCase()==="active"&&<><button className="secondary-button" onClick={()=>openCorrect(p)}>Correct</button><button className="danger-link" onClick={()=>openVoid(p)}>Void</button></>}</div></article>)}</div>}

   {actionTarget&&actionMode&&<div className="correction-panel"><div className="correction-title"><div><strong>{actionMode==="correct"?"Correct payment":"Void payment"}</strong><span>{actionTarget.id+" · Current version "+actionTarget.version}</span></div><button className="secondary-button" onClick={closeAction}>Cancel</button></div>{actionMode==="correct"?<div className="form-grid"><label>Amount *<input type="number" min="1" step="1" value={edit.amount} onChange={e=>setEdit(x=>({...x,amount:e.target.value}))}/></label><label>Paid Date *<input type="date" value={edit.paymentDate} onChange={e=>setEdit(x=>({...x,paymentDate:e.target.value}))}/></label><label>Payment Method *<select value={edit.method} onChange={e=>setEdit(x=>({...x,method:e.target.value}))}>{methods.data?.map(x=><option key={x.id} value={x.value}>{x.value}</option>)}</select></label><label>Receipt / Ref<input value={edit.receiptRef} onChange={e=>setEdit(x=>({...x,receiptRef:e.target.value}))}/></label><label className="span-2">Notes<textarea rows={2} value={edit.notes} onChange={e=>setEdit(x=>({...x,notes:e.target.value}))}/></label><label className="span-2">Correction reason *<textarea rows={2} value={edit.reason} onChange={e=>setEdit(x=>({...x,reason:e.target.value}))} placeholder="Why is this payment being corrected?"/></label><button className="primary-button span-2" disabled={!edit.reason.trim()||correct.isPending} onClick={()=>{setError("");correct.mutate();}}>{correct.isPending?"Saving correction…":"Save Correction"}</button></div>:<><p className="danger-note">Voiding keeps this payment permanently in history but removes it from fee totals.</p><label className="stacked-field">Void reason *<textarea rows={3} value={edit.reason} onChange={e=>setEdit(x=>({...x,reason:e.target.value}))} placeholder="Why should this payment be voided?"/></label><button className="danger-button" disabled={!edit.reason.trim()||voidMutation.isPending} onClick={()=>{setError("");voidMutation.mutate();}}>{voidMutation.isPending?"Voiding…":"Confirm Void Payment"}</button></>}</div>}
  </section>
 </>;
}
