import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
function localNow(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=(x:string)=>p.find(v=>v.type===x)?.value||"";const m=Number(g("month"));return {date:`${g("year")}-${g("month")}-${g("day")}`,year:Number(g("year")),month:months[m-1]};}
function money(v:number){return new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR",maximumFractionDigits:0}).format(v||0)}

export default function PaymentsPage(){
 const now=localNow();const qc=useQueryClient();
 const students=useQuery({queryKey:["students"],queryFn:api.students});
 const methods=useQuery({queryKey:["reference","Payment Method"],queryFn:()=>api.reference("Payment Method")});
 const [form,setForm]=useState({studentId:"",year:String(now.year),month:now.month,paymentDate:now.date,amount:"",method:"Cash",receiptRef:"",notes:""});
 const [newMethod,setNewMethod]=useState("");const [error,setError]=useState("");const [result,setResult]=useState<{paymentId:string;balanceAfter:number;status:string}|null>(null);
 const activeStudents=useMemo(()=>students.data?.filter(s=>s.status.toLowerCase()==="active")||[],[students.data]);
 const selected=activeStudents.find(s=>s.id===form.studentId);const set=(k:string,v:string)=>setForm(x=>({...x,[k]:v}));
 const addMethod=useMutation({mutationFn:()=>api.addReference("Payment Method",newMethod),onSuccess:async r=>{await qc.invalidateQueries({queryKey:["reference","Payment Method"]});set("method",r.value);setNewMethod("");},onError:e=>setError((e as Error).message)});
 const record=useMutation({mutationFn:()=>api.recordPayment({studentId:form.studentId,year:Number(form.year),month:form.month,paymentDate:form.paymentDate,amount:Number(form.amount),paymentMethod:form.method,receiptRef:form.receiptRef,notes:form.notes}),onSuccess:async r=>{setResult({paymentId:r.paymentId,balanceAfter:r.balanceAfter,status:r.status});set("amount","");await Promise.all([qc.invalidateQueries({queryKey:["dashboard"]}),qc.invalidateQueries({queryKey:["students"]})]);},onError:e=>setError((e as Error).message)});
 const submit=(e:React.FormEvent)=>{e.preventDefault();setError("");setResult(null);record.mutate();};
 return <>
  <div className="page-title"><div><h1>Fees & Payments</h1><p>Admin-only payment entry with permanent transaction history.</p></div></div>
  {error&&<div className="form-error page-error"><b>!</b><span>{error}</span></div>}
  {result&&<div className="payment-success"><b>✓ Payment recorded</b><span>{result.paymentId} · {result.status} · Balance {money(result.balanceAfter)}</span></div>}
  <div className="payment-layout"><form className="payment-form" onSubmit={submit}><div className="form-section"><h3>Student & Month</h3><div className="form-grid"><label className="span-2">Student *<select required value={form.studentId} onChange={e=>set("studentId",e.target.value)}><option value="">Select student…</option>{activeStudents.map(s=><option key={s.id} value={s.id}>{s.name} — {s.id}</option>)}</select></label><label>Month<select value={form.month} onChange={e=>set("month",e.target.value)}>{months.map(m=><option key={m}>{m}</option>)}</select></label><label>Year<input type="number" value={form.year} onChange={e=>set("year",e.target.value)} min="2000" max="2200"/></label></div></div>
   <div className="form-section"><h3>Payment</h3><div className="form-grid"><label>Amount Received *<input required type="number" min="1" step="1" inputMode="decimal" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="3500"/></label><label>Paid Date *<input required type="date" value={form.paymentDate} onChange={e=>set("paymentDate",e.target.value)}/></label><label>Payment Method *<select value={form.method} onChange={e=>set("method",e.target.value)}>{methods.data?.map(x=><option key={x.id} value={x.value}>{x.value}</option>)}</select></label><div className="smart-add"><span>Add new method</span><div><input value={newMethod} onChange={e=>setNewMethod(e.target.value)} placeholder="e.g. QR Payment"/><button type="button" className="secondary-button" disabled={!newMethod.trim()||addMethod.isPending} onClick={()=>addMethod.mutate()}>Add</button></div></div><label>Receipt / Ref<input value={form.receiptRef} onChange={e=>set("receiptRef",e.target.value)}/></label><label>Notes<input value={form.notes} onChange={e=>set("notes",e.target.value)}/></label></div></div>
   <button className="primary-button payment-submit" disabled={record.isPending}>{record.isPending?"Saving to Google Sheet…":"Record Payment"}</button></form>
   <aside className="payment-summary"><h3>Selected student</h3>{selected?<><strong>{selected.name}</strong><span>{selected.id}</span><div><small>Current monthly fee</small><b>{money(selected.currentFee||selected.startingFee||0)}</b></div><p>The backend checks the exact selected month's historical fee and remaining balance before accepting a payment.</p></>:<p>Select a student to see their current fee information.</p>}</aside>
  </div>
 </>
}
