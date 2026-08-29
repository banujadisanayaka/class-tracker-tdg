import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { HistoryEvent } from "../lib/types";

type PeriodMode = "daily" | "weekly" | "monthly" | "yearly" | "custom";

function localToday(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const g=(x:string)=>p.find(v=>v.type===x)?.value||"";
  return g("year")+"-"+g("month")+"-"+g("day");
}

function isoDate(date:Date){
  return date.toISOString().slice(0,10);
}

function addDays(value:string,days:number){
  const d=new Date(value+"T00:00:00Z");
  d.setUTCDate(d.getUTCDate()+days);
  return isoDate(d);
}

function rangeFor(mode:PeriodMode,anchor:string,customFrom:string,customTo:string){
  if(mode==="custom") return {from:customFrom,to:customTo};
  if(mode==="daily") return {from:anchor,to:anchor};
  const d=new Date(anchor+"T00:00:00Z");
  if(mode==="weekly"){
    const offset=(d.getUTCDay()+6)%7;
    const from=addDays(anchor,-offset);
    return {from,to:addDays(from,6)};
  }
  if(mode==="monthly"){
    const from=anchor.slice(0,8)+"01";
    const next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1));
    next.setUTCDate(0);
    return {from,to:isoDate(next)};
  }
  return {from:anchor.slice(0,4)+"-01-01",to:anchor.slice(0,4)+"-12-31"};
}

function safeCsv(value:string){
  let s=value||"";
  if(/^[=+\-@]/.test(s)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}

function downloadCsv(events:HistoryEvent[],from:string,to:string){
  const header=["Date","Timestamp","Module","Action","Record Type","Record ID","Student ID","Class ID","Actor","Reason","Result","Request ID"];
  const lines=events.map(e=>[
    e.localDate,e.timestamp,e.module,e.action,e.recordType,e.recordId,e.studentId,e.classId,e.actorEmail||e.actorId,e.reason,e.result,e.requestId
  ].map(safeCsv).join(","));
  const csv="\uFEFF"+[header.map(safeCsv).join(","),...lines].join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="class-tracker-history-"+from+"-"+to+".csv";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function pretty(value:string){
  if(!value) return "—";
  try{return JSON.stringify(JSON.parse(value),null,2);}catch{return value;}
}

function eventTime(value:string){
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("en-LK",{timeZone:"Asia/Colombo",hour:"2-digit",minute:"2-digit"});
}

export default function HistoryPage(){
  const today=localToday();
  const [mode,setMode]=useState<PeriodMode>("daily");
  const [anchor,setAnchor]=useState(today);
  const [customFrom,setCustomFrom]=useState(today);
  const [customTo,setCustomTo]=useState(today);
  const [moduleFilter,setModuleFilter]=useState("");

  const range=useMemo(()=>rangeFor(mode,anchor,customFrom,customTo),[mode,anchor,customFrom,customTo]);
  const valid=!!range.from&&!!range.to&&range.from<=range.to;

  const q=useQuery({
    queryKey:["history",mode,range.from,range.to,moduleFilter],
    queryFn:()=>api.history({from:range.from,to:range.to,module:moduleFilter||undefined}),
    enabled:valid,
  });

  const modules=useMemo(()=>{
    const base=["Students","Attendance","Payments","Reference Data","System","Admin"];
    return Array.from(new Set([...base,...(q.data?.modules||[])])).sort();
  },[q.data?.modules]);

  const groups=useMemo(()=>{
    const map=new Map<string,HistoryEvent[]>();
    for(const event of q.data?.events||[]){
      const key=mode==="yearly"?event.localDate.slice(0,7):event.localDate;
      const list=map.get(key)||[];
      list.push(event);
      map.set(key,list);
    }
    return Array.from(map.entries());
  },[q.data?.events,mode]);

  return <>
    <div className="page-title"><div><h1>History Centre</h1><p>Audit-backed daily, weekly, monthly, yearly and custom activity history.</p></div></div>

    <div className="period-tabs">
      {(["daily","weekly","monthly","yearly","custom"] as PeriodMode[]).map(p=><button key={p} className={mode===p?"active":""} onClick={()=>setMode(p)}>{p[0].toUpperCase()+p.slice(1)}</button>)}
    </div>

    <div className="history-controls">
      {mode==="custom"?<>
        <label>From<input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/></label>
        <label>To<input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}/></label>
      </>:<label>Date within period<input type="date" value={anchor} onChange={e=>setAnchor(e.target.value)}/></label>}
      <label>Module<select value={moduleFilter} onChange={e=>setModuleFilter(e.target.value)}><option value="">All modules</option>{modules.map(m=><option key={m}>{m}</option>)}</select></label>
      <span style={{fontSize:11,color:"#7a8b9a",paddingBottom:11}}>{range.from} → {range.to}</span>
    </div>

    {!valid&&<div className="form-error page-error"><b>!</b><span>Choose a valid history date range.</span></div>}

    {q.isLoading?<div className="state-card"><div className="spinner"/><strong>Loading permanent audit history…</strong></div>:
     q.isError?<div className="state-card error-state"><b>!</b><strong>History could not be loaded.</strong><span>{(q.error as Error).message}</span></div>:
     q.data?<>
      <div className="history-summary">
        <div className="stat-card"><span>Events</span><strong>{q.data.totalEvents}</strong></div>
        <div className="stat-card"><span>Successful</span><strong>{q.data.successEvents}</strong></div>
        <div className="stat-card"><span>Failed</span><strong>{q.data.failedEvents}</strong></div>
        <div className="stat-card"><span>Actors</span><strong>{q.data.uniqueActors}</strong></div>
      </div>

      <div className="report-export-bar">
        <button className="primary" disabled={!q.data.events.length} onClick={()=>downloadCsv(q.data.events,range.from,range.to)}>CSV / Excel</button>
        <button onClick={()=>window.print()}>PDF / Print</button>
      </div>

      {q.data.truncated&&<div className="history-truncated">More than 1,000 events match this period. Narrow the date range to inspect the full history.</div>}

      {groups.length===0?<div className="empty-card"><b>↺</b><h3>No audit events</h3><p>No permanent system events match this period and module.</p></div>:
       groups.map(([group,events])=><section className="history-day" key={group}><h3>{mode==="yearly"?"Month "+group:group}</h3>{events.map(event=>
        <details className="history-event" key={event.id}>
          <summary>
            <time>{eventTime(event.timestamp)}</time>
            <b>{event.module||"System"}</b>
            <span>{event.action} · {event.recordType||event.recordId||"Record"}</span>
            <i className={event.result&&event.result.toLowerCase()!=="success"?"failed":""}>{event.result||"Recorded"}</i>
          </summary>
          <div className="history-event-body">
            <div className="history-meta">
              <div><small>Record</small><strong>{event.recordId||"—"}</strong></div>
              <div><small>Actor</small><strong>{event.actorEmail||event.actorId||"—"}</strong></div>
              <div><small>Request ID</small><strong>{event.requestId||"—"}</strong></div>
              {event.studentId&&<div><small>Student</small><strong>{event.studentId}</strong></div>}
              {event.classId&&<div><small>Class</small><strong>{event.classId}</strong></div>}
            </div>
            {(event.beforeValue||event.afterValue)&&<div className="history-change-grid">
              <div><small>Before</small><pre>{pretty(event.beforeValue)}</pre></div>
              <div><small>After</small><pre>{pretty(event.afterValue)}</pre></div>
            </div>}
            {event.reason&&<div className="history-reason"><b>Reason:</b> {event.reason}</div>}
          </div>
        </details>
       )}</section>)}
     </>:null}
  </>;
}
