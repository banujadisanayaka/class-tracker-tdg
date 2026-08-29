import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ReportFormat, ReportPayload, ReportValue } from "../lib/types";

type ReportType = "financial" | "attendance" | "students" | "classes" | "staff";

const REPORTS: Array<{id:ReportType;label:string}> = [
  {id:"financial",label:"Financial"},
  {id:"attendance",label:"Attendance"},
  {id:"students",label:"Students"},
  {id:"classes",label:"Classes"},
  {id:"staff",label:"Staff"},
];

function localToday(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const g=(x:string)=>p.find(v=>v.type===x)?.value||"";
  return g("year")+"-"+g("month")+"-"+g("day");
}

function money(value:number){
  return new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR",maximumFractionDigits:0}).format(value||0);
}

function formatValue(value:ReportValue,format:ReportFormat){
  if(value===null||value===undefined||value==="") return "—";
  if(format==="money") return money(Number(value));
  if(format==="number") return new Intl.NumberFormat("en-LK").format(Number(value)||0);
  if(format==="percent") return (Number(value)||0).toFixed(1).replace(/\.0$/,"")+"%";
  return String(value);
}

function safeCsvCell(value:ReportValue){
  let s=value===null||value===undefined?"":String(value);
  if(/^[=+\-@]/.test(s)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}

function downloadBlob(blob:Blob,filename:string){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function filenameFor(data:ReportPayload,ext:string){
  const base=(data.type+"-"+data.periodLabel).replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase();
  return "class-tracker-"+base+"."+ext;
}

function exportCsv(data:ReportPayload){
  const header=data.columns.map(c=>safeCsvCell(c.label)).join(",");
  const lines=data.rows.map(row=>data.columns.map(c=>safeCsvCell(row[c.key]??"")).join(","));
  const csv="\uFEFF"+[header,...lines].join("\r\n");
  downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),filenameFor(data,"csv"));
}

function createReportImageBlob(data:ReportPayload){
  const width=1400;
  const rowCount=Math.min(data.rows.length,16);
  const height=445+rowCount*42;
  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  const ctx=canvas.getContext("2d");
  if(!ctx) return Promise.resolve<Blob|null>(null);

  ctx.fillStyle="#ffffff";
  ctx.fillRect(0,0,width,height);
  ctx.fillStyle="#163b5b";
  ctx.font="700 42px system-ui";
  ctx.fillText(data.title,70,80);
  ctx.fillStyle="#667b8d";
  ctx.font="24px system-ui";
  ctx.fillText(data.periodLabel,70,120);
  ctx.font="18px system-ui";
  ctx.fillText("Generated "+new Date(data.generatedAt).toLocaleString("en-LK"),70,152);

  let x=70;
  data.summary.slice(0,4).forEach(item=>{
    ctx.fillStyle="#f4f7f9";
    ctx.fillRect(x,190,285,110);
    ctx.fillStyle="#708294";
    ctx.font="18px system-ui";
    ctx.fillText(item.label,x+18,222);
    ctx.fillStyle="#173b5e";
    ctx.font="700 28px system-ui";
    ctx.fillText(formatValue(item.value,item.format),x+18,265);
    x+=310;
  });

  const cols=data.columns.slice(0,5);
  const colWidth=1240/Math.max(cols.length,1);
  let y=340;
  ctx.fillStyle="#eef3f6";
  ctx.fillRect(70,y-28,1240,38);
  ctx.fillStyle="#435d73";
  ctx.font="700 16px system-ui";
  cols.forEach((col,i)=>ctx.fillText(col.label,78+i*colWidth,y-3));
  ctx.font="15px system-ui";
  data.rows.slice(0,rowCount).forEach(row=>{
    y+=42;
    ctx.fillStyle="#e8edf1";
    ctx.fillRect(70,y+7,1240,1);
    ctx.fillStyle="#30495f";
    cols.forEach((col,i)=>{
      const raw=formatValue(row[col.key]??"",col.format);
      const text=raw.length>26?raw.slice(0,25)+"…":raw;
      ctx.fillText(text,78+i*colWidth,y);
    });
  });
  if(data.rows.length>rowCount){
    y+=42;
    ctx.fillStyle="#758696";
    ctx.fillText("Image includes first "+rowCount+" of "+data.rows.length+" rows. CSV/PDF contains the complete report.",78,y);
  }

  ctx.fillStyle="#8a98a7";
  ctx.font="16px system-ui";
  ctx.fillText("Class Tracker • Google Sheets source of truth • "+data.rows.length+" report rows",70,height-35);

  return new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png"));
}

async function exportImage(data:ReportPayload){
  const blob=await createReportImageBlob(data);
  if(blob) downloadBlob(blob,filenameFor(data,"png"));
}

export default function ReportsPage(){
  const today=localToday();
  const [type,setType]=useState<ReportType>("financial");
  const [from,setFrom]=useState(today.slice(0,8)+"01");
  const [to,setTo]=useState(today);
  const [notice,setNotice]=useState("");

  const q=useQuery({
    queryKey:["report",type,from,to],
    queryFn:()=>api.report({type,from,to}),
    enabled:!!from&&!!to&&from<=to,
  });

  const data=q.data;
  const exportSummary=useMemo(()=>{
    if(!data) return "";
    return [data.title,data.periodLabel,...data.summary.map(x=>x.label+": "+formatValue(x.value,x.format))].join("\n");
  },[data]);

  const share=async()=>{
    if(!data) return;
    try{
      const blob=await createReportImageBlob(data);
      const file=blob?new File([blob],filenameFor(data,"png"),{type:"image/png"}):null;
      if(file&&navigator.share&&navigator.canShare?.({files:[file]})){
        await navigator.share({title:data.title,text:exportSummary,files:[file]});
        setNotice("Report image shared.");
      }else if(navigator.share){
        await navigator.share({title:data.title,text:exportSummary});
        setNotice("Report shared.");
      }else if(navigator.clipboard){
        await navigator.clipboard.writeText(exportSummary);
        setNotice("Report summary copied to clipboard.");
      }else{
        setNotice("Sharing is not supported on this browser.");
      }
    }catch{
      setNotice("Share was cancelled.");
    }
  };

  return <>
    <div className="page-title print-hide"><div><h1>Reports Centre</h1><p>Live reports generated from the Google Sheets source of truth.</p></div></div>

    <div className="report-type-tabs">
      {REPORTS.map(r=><button key={r.id} className={type===r.id?"active":""} onClick={()=>setType(r.id)}>{r.label}</button>)}
    </div>

    <div className="report-controls">
      <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <span style={{fontSize:11,color:"#7a8b9a",paddingBottom:11}}>Student and staff reports are current-register snapshots.</span>
    </div>

    {notice&&<div className="success-banner">✓ {notice}</div>}
    {from>to&&<div className="form-error page-error"><b>!</b><span>From date cannot be after To date.</span></div>}

    {q.isLoading?<div className="state-card"><div className="spinner"/><strong>Generating report from Google Sheets…</strong></div>:
     q.isError?<div className="state-card error-state"><b>!</b><strong>Report could not be generated.</strong><span>{(q.error as Error).message}</span></div>:
     data?<section className="report-print">
      <div className="page-title"><div><h2>{data.title}</h2><p>{data.periodLabel}</p><small className="report-generated">Generated {new Date(data.generatedAt).toLocaleString("en-LK")} · Google Sheets source of truth</small></div></div>

      <div className="report-summary">
        {data.summary.map(item=><div className="stat-card" key={item.label}><span>{item.label}</span><strong>{formatValue(item.value,item.format)}</strong>{item.detail&&<small>{item.detail}</small>}</div>)}
      </div>

      <div className="report-export-bar">
        <button className="primary" onClick={()=>exportCsv(data)}>CSV / Excel</button>
        <button onClick={()=>window.print()}>PDF / Print</button>
        <button onClick={()=>exportImage(data)}>Image</button>
        <button onClick={share}>Share</button>
      </div>

      {data.note&&<div className="report-note">{data.note}</div>}

      {data.rows.length===0?<div className="report-empty">No records match this report.</div>:<>
        <div className="report-table-wrap">
          <table className="report-table"><thead><tr>{data.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>
            {data.rows.map((row,i)=><tr key={i}>{data.columns.map(c=><td key={c.key}>{formatValue(row[c.key]??"",c.format)}</td>)}</tr>)}
          </tbody></table>
        </div>
        <div className="report-card-list">
          {data.rows.map((row,i)=><article className="report-row-card" key={i}><strong>{formatValue(row[data.columns[0]?.key]??"",data.columns[0]?.format||"text")}</strong><dl>
            {data.columns.slice(1).map(c=><div key={c.key}><dt>{c.label}</dt><dd>{formatValue(row[c.key]??"",c.format)}</dd></div>)}
          </dl></article>)}
        </div>
      </>}
     </section>:null}
  </>;
}
