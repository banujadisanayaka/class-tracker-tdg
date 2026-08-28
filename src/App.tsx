import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import type { DashboardData } from "./lib/types";
import StudentFormModal from "./components/StudentFormModal";
import AttendancePage from "./pages/AttendancePage";
import PaymentsPage from "./pages/PaymentsPage";
import TodayPage from "./pages/TodayPage";

const nav = [
  ["/dashboard", "Home", "⌂"],
  ["/today", "Today", "◷"],
  ["/students", "Students", "◎"],
  ["/attendance", "Attendance", "✓"],
  ["/more", "More", "•••"],
] as const;

function money(value: number) {
  return new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(value || 0);
}

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">CT</div><div><strong>Class Tracker</strong><span>Admin Portal</span></div></div>
      <nav className="side-nav">
        {nav.slice(0,4).map(([to,label,icon]) => <NavLink key={to} to={to} className={({isActive})=>isActive?"nav-item active":"nav-item"}><b>{icon}</b>{label}</NavLink>)}
        <div className="nav-group">Management</div>
        <NavLink to="/payments" className={({isActive})=>isActive?"nav-item active":"nav-item"}><b>₨</b>Payments</NavLink>
        <NavLink to="/reports" className={({isActive})=>isActive?"nav-item active":"nav-item"}><b>▥</b>Reports</NavLink>
        <NavLink to="/history" className={({isActive})=>isActive?"nav-item active":"nav-item"}><b>↺</b>History</NavLink>
        <div className="nav-group">Administration</div>
        <NavLink to="/admin" className={({isActive})=>isActive?"nav-item active":"nav-item"}><b>⚙</b>Admin Portal</NavLink>
      </nav>
      <div className="side-footer"><span className="avatar">A</span><div><strong>Development Admin</strong><small>Staging environment</small></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="env-dot"/> DEVELOPMENT</div><div className="top-actions"><button className="icon-button" aria-label="Help">?</button><span className="profile-dot">A</span></div></header>
      <div className="content">{children}</div>
    </main>
    <nav className="bottom-nav">
      {nav.map(([to,label,icon]) => <NavLink key={to} to={to} className={({isActive})=>isActive||location.pathname.startsWith(to+"/")?"bottom-item active":"bottom-item"}><b>{icon}</b><span>{label}</span></NavLink>)}
    </nav>
  </div>
}

function PageTitle({title,subtitle,action}:{title:string;subtitle?:string;action?:React.ReactNode}) {
  return <div className="page-title"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>
}

function Stat({label,value,detail,tone="normal"}:{label:string;value:string|number;detail?:string;tone?:string}) {
  return <div className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</div>
}

function LoadingState({label="Loading class data..."}:{label?:string}) { return <div className="state-card"><div className="spinner"/><strong>{label}</strong><span>Please keep this page open.</span></div> }
function ErrorState({message}:{message:string}) { return <div className="state-card error-state"><b>!</b><strong>We couldn't load this information.</strong><span>{message}</span><button onClick={()=>location.reload()} className="secondary-button">Retry</button></div> }

function Dashboard() {
  const q=useQuery({queryKey:["dashboard"],queryFn:api.dashboard});
  if(q.isLoading) return <LoadingState/>;
  if(q.isError) return <><PageTitle title="Dashboard" subtitle="Your daily class overview"/><ErrorState message={(q.error as Error).message}/></>;
  const d=q.data as DashboardData;
  return <>
    <PageTitle title="Good morning 👋" subtitle={d.dateLabel}/>
    <section className="quick-actions">
      <NavLink className="action-card primary" to="/attendance"><b>✓</b><div><strong>Mark Attendance</strong><span>Open today's class list</span></div></NavLink>
      <NavLink className="action-card" to="/payments"><b>₨</b><div><strong>Record Payment</strong><span>Find a student and record a fee</span></div></NavLink>
      <NavLink className="action-card" to="/students"><b>+</b><div><strong>Add / Find Student</strong><span>Manage student records</span></div></NavLink>
    </section>
    <h2 className="section-title">Today</h2>
    <section className="stats-grid">
      <Stat label="Today's classes" value={d.todayClasses}/><Stat label="Today's students" value={d.todayStudents}/><Stat label="Attendance marked" value={d.attendanceMarked}/><Stat label="Active students" value={d.activeStudents}/>
    </section>
    <h2 className="section-title">This month</h2>
    <section className="stats-grid finance">
      <Stat label="Collected" value={money(d.collectedThisMonth)} tone="success"/><Stat label="Outstanding" value={money(d.outstandingThisMonth)} tone="warning"/><Stat label="Paid" value={d.paidStudents}/><Stat label="Partial / Unpaid" value={`${d.partialStudents} / ${d.unpaidStudents}`}/>
    </section>
    <section className={`health-card ${d.systemStatus}`}><div><b>{d.systemStatus==="healthy"?"✓":"!"}</b><div><strong>System status</strong><span>{d.systemMessage}</span></div></div><NavLink to="/admin">View system health →</NavLink></section>
  </>
}

function Students(){
 const q=useQuery({queryKey:["students"],queryFn:api.students});
 const [showAdd,setShowAdd]=useState(false);
 const [notice,setNotice]=useState("");
 const [search,setSearch]=useState("");
 const [status,setStatus]=useState("All");
 const visible=(q.data||[]).filter(s=>(status==="All"||s.status===status)&&(!search.trim()||[s.name,s.id,s.phone,s.guardianPhone].join(" ").toLowerCase().includes(search.toLowerCase())));
 return <><PageTitle title="Students" subtitle="Search and view the complete student register" action={<button className="primary-button" onClick={()=>setShowAdd(true)}>+ Add Student</button>}/>
 {notice&&<div className="success-banner">✓ {notice}</div>}
 <div className="toolbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, Student ID, phone or parent phone"/><select value={status} onChange={e=>setStatus(e.target.value)}><option>All</option><option>Active</option><option>Inactive</option><option>Left</option><option>Archived</option></select></div>
 {q.isLoading?<LoadingState label="Loading students..."/>:q.isError?<ErrorState message={(q.error as Error).message}/>:visible.length?<div className="card-list">{visible.map(s=><article className="student-card" key={s.id}><div className="student-avatar">{s.name?.slice(0,1).toUpperCase()||"S"}</div><div className="student-main"><strong>{s.name}</strong><span>{s.id}</span><small>{s.phone||"No student phone"}</small></div><span className={`status ${s.status.toLowerCase()}`}>{s.status}</span><button className="secondary-button">View</button></article>)}</div>:<div className="empty-card"><b>◎</b><h3>No matching students</h3><p>Change the search or filters, or add a new student.</p></div>}
 {showAdd&&<StudentFormModal onClose={()=>setShowAdd(false)} onSaved={id=>{setShowAdd(false);setNotice(`Student ${id} was saved to Google Sheets.`);}}/>}
 </>
}

function Reports(){return <><PageTitle title="Reports" subtitle="Financial, attendance, student, class and staff reports"/><div className="report-menu">{["Financial Reports","Attendance Reports","Student Reports","Class Reports","Staff Reports"].map(x=><button key={x}><b>▥</b><span>{x}</span><i>PDF · Excel · Image · Share</i></button>)}</div></>}
function History(){return <><PageTitle title="History Centre" subtitle="Daily, weekly, monthly, yearly and custom activity history"/><div className="period-tabs"><button className="active">Daily</button><button>Weekly</button><button>Monthly</button><button>Yearly</button><button>Custom</button></div><div className="empty-card"><b>↺</b><h3>Audit-backed history</h3><p>Student, attendance, payment, staff and system events will be generated from the permanent Audit Log and transaction tables.</p></div></>}
function More(){return <><PageTitle title="More" subtitle="Management and administration"/><div className="more-grid">{[["Payments","/payments"],["Reports","/reports"],["History","/history"],["Admin Portal","/admin"]].map(([l,p])=><NavLink to={p} key={p}><strong>{l}</strong><span>Open →</span></NavLink>)}</div></>}
function Admin(){return <><PageTitle title="Admin Portal" subtitle="Full management, access, settings and system health"/><div className="admin-grid">{["Classes","Staff & Access","Pending Access Requests","Permissions","System Health","Audit Log","Lists & Dropdowns","Settings","Help Centre","Master Google Sheet"].map(x=><button key={x}><strong>{x}</strong><span>Manage →</span></button>)}</div><div className="setup-note"><b>Development configuration</b><p>The site will refuse live Sheet operations until the Netlify server has valid Google service-account credentials. This is intentional—there is no silent fallback database.</p></div></>}

export default function App(){return <Layout><Routes><Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/today" element={<TodayPage/>}/><Route path="/students" element={<Students/>}/><Route path="/attendance" element={<AttendancePage/>}/><Route path="/payments" element={<PaymentsPage/>}/><Route path="/reports" element={<Reports/>}/><Route path="/history" element={<History/>}/><Route path="/more" element={<More/>}/><Route path="/admin" element={<Admin/>}/><Route path="*" element={<Navigate to="/dashboard" replace/>}/></Routes></Layout>}
