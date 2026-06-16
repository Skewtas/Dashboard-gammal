import React, { useState, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, Clock, User, ChevronLeft, ChevronRight, GripHorizontal, RefreshCw, Layers, Search, Key, Loader, Check as IconCheck } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import axios from 'axios';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Drag-and-drop: en bookingline-flytt skickas direkt till Timewave.
// Avsiktlig avgränsning — endast SHIFT-läge (denna förekomst), inte serien.
// Vill användaren ändra serien → använd modalen.

const WEEKDAYS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

export default function TimewaveScheduleGrid() {
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [employees, setEmployees] = useState<any[]>([]);
  const [missions, setMissions] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, {adminNote: string, schemaNote: string}>>({});
  const [loading, setLoading] = useState(false);
  
  const [editingMission, setEditingMission] = useState<any>(null);

  // Drag-and-drop state. `dragging` = block-objektet som lyfts; `pendingMove`
  // = pågående PUT till Timewave (visa en toast, blockera nya drag).
  const [dragging, setDragging] = useState<any>(null);
  const [pendingMove, setPendingMove] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Generate Date Range based on viewMode and currentDate
  const datesInView = useMemo(() => {
     const d = new Date(currentDate);
     let start = new Date(d);
     let count = 7;
     
     if (viewMode === 'week') {
        const jsDay = start.getDay(); 
        const diff = start.getDate() - jsDay + (jsDay === 0 ? -6 : 1); // Get Monday
        start.setDate(diff);
        count = 7;
     } else {
        start.setDate(1); // 1st of the month
        count = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
     }

     const dates = [];
     for (let i = 0; i < count; i++) {
        const dt = new Date(start);
        dt.setDate(dt.getDate() + i);
        dates.push(dt.toISOString().split('T')[0]);
     }
     return dates;
  }, [currentDate, viewMode]);

  const startDateStr = datesInView[0];
  const endDateStr = datesInView[datesInView.length - 1];

  const fetchSchedule = async () => {
    setLoading(true);
    try {
      const empRes = await axios.get(`/api/timewave/employees?page[size]=1000`, {
         headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      let emps = empRes.data.data || [];
      const blockedNames = ['avbok', 'aa -', 'aa-', 'ebenazer', 'ebenezer'];
      emps = emps.filter((e: any) => {
         const name = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase().trim();
         if (name === 'aa' || e.first_name?.toLowerCase() === 'aa' || e.last_name?.toLowerCase() === 'aa') return false;
         return !blockedNames.some(blocked => name.includes(blocked));
      });
      emps.unshift({ id: 'UNASSIGNED', first_name: 'UTAN ANSTÄLLD', last_name: '(OBOKADE)', number: '' });
      setEmployees(emps);

      const fetchStart = new Date(startDateStr);
      const shiftStartStr = fetchStart.toISOString().split('T')[0];

      const fetchEnd = new Date(endDateStr);
      const shiftEndStr = fetchEnd.toISOString().split('T')[0];

      const misRes = await axios.get(`/api/timewave/missions?filter[startdate]=${shiftStartStr}&filter[enddate]=${shiftEndStr}&page[size]=1000`, {
         headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      
      
      setMissions(misRes.data.data || []);
      
      // Fetch Notes
      const notesRes = await axios.get('/api/notes/all').catch(() => ({data: {data: []}}));
      const notesArray = notesRes?.data?.data || [];
      const ns = notesArray.reduce((acc: any, curr: any) => {
          acc[curr.missionId] = curr;
          return acc;
      }, {});
      setNotes(ns);
    } catch (err: any) {
      const responseBody = err.response?.data ? JSON.stringify(err.response.data) : "";
      const failingUrl = err.config?.url || "Okänd URL";
      alert(`Kunde inte hämta schemat: ${err.message}\nURL: ${failingUrl}\nDetaljer: ${responseBody}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, [startDateStr, endDateStr]); // Refetch when the actual loaded range changes

  const changeDateBoundary = (direction: -1 | 1) => {
    const d = new Date(currentDate);
    if (viewMode === 'week') {
       d.setDate(d.getDate() + (7 * direction));
    } else {
       d.setMonth(d.getMonth() + direction);
    }
    setCurrentDate(d.toISOString().split('T')[0]);
  };

  // Convert missions to blocks
  const blocks = useMemo(() => {
     const res: any[] = [];
     missions.forEach((m: any) => {
        const shifts = m.employees || [];
        const dateRaw = m.startdate || '';
        let cleanDate = dateRaw.split(' ')[0].split('T')[0];
        if (!cleanDate) cleanDate = currentDate;

        const srvName = m.services?.[0]?.name || '';
        const clientNameRaw = m.client?.companyname || m.client?.company || `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim();
        const isAbsence = /vabb|sjuk|ej tillgänglig|frånvaro|semester/i.test(srvName);
        
        if (shifts.length === 0) {
           res.push({
              missionId: m.id,
              clientId: m.client?.id,
              workorderId: m.workorder?.id,
              workorderlineId: m.services?.[0]?.workorderline_id || null,
              shiftId: null,
              employeeId: 'UNASSIGNED',
              employeeName: 'Utan anställd',
              date: cleanDate,
              startTimeRaw: (m.starttime || '').substring(0,5) || '??:??',
              endTimeRaw: (m.endtime || '').substring(0,5) || '??:??',
              clientName: clientNameRaw || srvName,
              serviceName: srvName,
              isAbsence: false,
              address: m.client?.address || '',
              postalCode: m.client?.postal_code || '',
              city: m.client?.city || '',
              status: m.status || 'NEW'
           });
        }

        shifts.forEach((shift: any) => {
           if (shift.cancelled) return;
           const sCleanDate = shift.startdate ? shift.startdate.split(' ')[0].split('T')[0] : cleanDate;
           
           res.push({
              missionId: m.id,
              workorderId: m.workorder?.id,
              workorderlineId: m.services?.[0]?.workorderline_id || null,
              shiftId: shift.bookingline_id || shift.id, 
              employeeId: String(shift.employee_id || shift.id || ''),
              employeeName: shift.name || `${shift.first_name || ''} ${shift.last_name || ''}`.trim(),
              date: sCleanDate,
              startTimeRaw: (shift.starttime || '').substring(0,5),
              endTimeRaw: (shift.endtime || '').substring(0,5),
              clientName: clientNameRaw || srvName,
              serviceName: srvName,
              isAbsence,
              address: m.client?.address || '',
              postalCode: m.client?.postal_code || '',
              city: m.client?.city || '',
              status: m.status || 'NEW'
           });
        });
     });
     return res;
  }, [missions]);

  const filteredEmployees = useMemo(() => {
     if (!searchQuery.trim()) return employees;
     
     // Stöd för att söka på flera anställda genom att separera med kommatecken
     const queries = searchQuery.split(',').map(q => q.trim().toLowerCase()).filter(q => q.length > 0);
     if (queries.length === 0) return employees;

     return employees.filter(emp => {
        const fName = emp.first_name?.toLowerCase() || '';
        const lName = emp.last_name?.toLowerCase() || '';
        const num = emp.number?.toLowerCase() || '';
        // Träffa om systemet matchar NÅGON av de sökta termerna
        return queries.some(q => fName.includes(q) || lName.includes(q) || num.includes(q));
     });
  }, [employees, searchQuery]);

  // Flytta ett pass live → PUT mot Timewave bookingline. Frågar inte
  // SHIFT/SERIE — drag-och-släpp tolkas alltid som "bara denna gång".
  const moveBookingline = async (block: any, newEmployeeId: string, newDate: string) => {
    if (!block.shiftId) {
      alert('Det här passet saknar bookingline-id i Timewave och kan därför inte flyttas via drag-och-släpp. Klicka på passet för att redigera.');
      return;
    }
    const sameCell = String(block.employeeId) === String(newEmployeeId) && block.date === newDate;
    if (sameCell) return;

    setPendingMove(`${block.shiftId}`);
    // Optimistisk uppdatering: skriv om missions-state lokalt så cellen
    // hoppar omedelbart, även innan Timewave svarar.
    const prevMissions = missions;
    setMissions((curr) =>
      curr.map((m: any) => {
        if (m.id !== block.missionId) return m;
        const next = { ...m, employees: [...(m.employees || [])] };
        next.employees = next.employees.map((e: any) => {
          const shiftKey = e.bookingline_id ?? e.id;
          if (String(shiftKey) !== String(block.shiftId)) return e;
          return {
            ...e,
            startdate: newDate,
            employee_id: newEmployeeId === 'UNASSIGNED' ? null : Number(newEmployeeId),
          };
        });
        return next;
      })
    );

    const payload: any = {
      data: {
        type: 'bookinglines',
        id: block.shiftId,
        attributes: {
          startdate: newDate,
          enddate: newDate,
          starttime: (block.startTimeRaw || '08:00').substring(0, 5) + ':00',
          endtime: (block.endTimeRaw || '10:00').substring(0, 5) + ':00',
        },
      },
    };
    if (newEmployeeId && newEmployeeId !== 'UNASSIGNED') {
      payload.data.relationships = {
        employee: { data: { type: 'employees', id: newEmployeeId } },
      };
    }

    try {
      await axios.put(`/api/timewave/missions/bookinglines/${block.shiftId}`, payload);
      // Synka mot Timewave-statusen så vi inte cementerar fel optimistisk gissning
      await fetchSchedule();
    } catch (err: any) {
      console.error('[DnD] PUT failed', err?.response?.data || err.message);
      // Rulla tillbaka
      setMissions(prevMissions);
      alert(
        'Kunde inte flytta passet i Timewave: ' +
          (err?.response?.data?.message ||
            JSON.stringify(err?.response?.data?.errors) ||
            err.message)
      );
    } finally {
      setPendingMove(null);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const data = (e.active.data.current as any)?.block;
    if (data) setDragging(data);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const block = (e.active.data.current as any)?.block;
    setDragging(null);
    if (!block || !e.over) return;
    const dropId = String(e.over.id);
    const m = dropId.match(/^cell:([^:]+):(\d{4}-\d{2}-\d{2})$/);
    if (!m) return;
    const [, newEmployeeId, newDate] = m;
    await moveBookingline(block, newEmployeeId, newDate);
  };

  const handleSaveEdit = async (mode: 'SHIFT' | 'SERIES') => {
     if (!editingMission) return;
     try {
       setEditingMission({...editingMission, saving: true});
       
       let targetEndpoint = '';
       let payload = null;

       const rawStart = editingMission.startH_input.substring(0,5) + ":00";
       const rawEnd = editingMission.endH_input.substring(0,5) + ":00";
       const rawDate = editingMission.date;

       if (mode === 'SERIES') {
           if (!editingMission.workorderlineId) throw new Error("Inget underlag för återkommande schema hittades.");
           targetEndpoint = `/api/timewave/workorderlines/${editingMission.workorderlineId}`;
           payload = {
               data: {
                   type: "workorderlines",
                   id: editingMission.workorderlineId,
                   attributes: {
                       starttime: rawStart,
                       endtime: rawEnd
                   }
               }
           };
       } else {
           if (!editingMission.shiftId) throw new Error("Kunde inte identifiera specifikt pass (Bookingline ID saknas)");
           targetEndpoint = `/api/timewave/missions/bookinglines/${editingMission.shiftId}`;
           payload = {
               data: {
                   type: "bookinglines",
                   id: editingMission.shiftId,
                   attributes: {
                       startdate: rawDate,
                       enddate: rawDate,
                       starttime: rawStart,
                       endtime: rawEnd
                   }
               }
           };
           if (editingMission.emp_input && editingMission.emp_input !== 'UNASSIGNED') {
               payload.data.relationships = {
                   employee: { data: { type: "employees", id: editingMission.emp_input } }
               };
           }
       }

       console.log(`[SYNC DEBUG] HTTP Metod: PUT`);
       console.log(`[SYNC DEBUG] Endpoint: ${targetEndpoint}`);
       console.log(`[SYNC DEBUG] Payload:`, JSON.stringify(payload, null, 2));

       const res = await axios.put(targetEndpoint, payload);
       
       console.log(`[SYNC DEBUG] HTTP HTTP-status:`, res.status);
       console.log(`[SYNC DEBUG] TimeWave Svar:`, JSON.stringify(res.data, null, 2));

       // Save Local Notes
       await axios.post(`/api/notes/${editingMission.missionId}`, {
           adminNote: editingMission.adminNote,
           schemaNote: editingMission.schemaNote
       }).catch(() => {
           console.warn("Could not save note securely.");
       });

       setEditingMission(null);
       await fetchSchedule(); 

     } catch(err: any) {
        console.error("[SYNC] Error during update:", err?.response?.data || err.message);
        alert("Ett fel uppstod när ändringen skulle sparas till Timewave:\n" + (err?.response?.data?.message || JSON.stringify(err?.response?.data?.errors) || err.message));
        setEditingMission({...editingMission, saving: false});
     }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <div className="flex flex-col h-full bg-white overflow-hidden font-sans">

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-4">
         <div className="flex items-center gap-4">
            <h2 className="text-xl font-serif text-brand-dark flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-brand-accent" />
              Översiktsschema
            </h2>
            
            <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 ml-4 shadow-sm relative overflow-hidden">
               <button 
                  onClick={() => setViewMode('week')}
                  className={cn("px-4 py-1.5 rounded-md text-xs font-bold transition-all z-10 relative", viewMode === 'week' ? "bg-brand-dark text-white shadow-sm" : "text-gray-500 hover:text-brand-dark")}
               >
                  Arbetsvecka
               </button>
               <button 
                  onClick={() => setViewMode('month')}
                  className={cn("px-4 py-1.5 rounded-md text-xs font-bold transition-all z-10 relative", viewMode === 'month' ? "bg-brand-dark text-white shadow-sm" : "text-gray-500 hover:text-brand-dark")}
               >
                  Månad
               </button>
            </div>
            
            <div className="relative ml-2 w-64 hidden md:block">
               <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
               <input 
                  type="text" 
                  placeholder="Sök (Enter för fler)..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                     if (e.key === 'Enter') {
                        e.preventDefault();
                        if (searchQuery && !searchQuery.trim().endsWith(',')) {
                           setSearchQuery(prev => prev.trim() + ', ');
                        }
                     }
                  }}
                  className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-1.5 text-sm outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all font-medium placeholder:font-normal"
               />
            </div>
            
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1 shadow-sm ml-auto">
               <button onClick={() => changeDateBoundary(-1)} className="p-1 hover:bg-gray-100 rounded text-gray-500"><ChevronLeft className="w-4 h-4"/></button>
               <input 
                  type="date" 
                  value={currentDate} 
                  onChange={e => setCurrentDate(e.target.value)}
                  className="text-sm font-bold bg-transparent border-none outline-none py-1 px-2 text-center w-36 focus:ring-0"
               />
               <button onClick={() => changeDateBoundary(1)} className="p-1 hover:bg-gray-100 rounded text-gray-500"><ChevronRight className="w-4 h-4"/></button>
            </div>
            <button onClick={() => fetchSchedule()} className="p-2 hover:bg-brand-accent/10 hover:text-brand-accent rounded-lg transition-colors text-gray-400">
               <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
         </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto relative bg-gray-50/30">
         <div className="min-w-max inline-block w-full">
            
            {/* Headers (Dates) */}
            <div className="sticky top-0 z-20 flex bg-white border-b border-gray-200 shadow-sm ml-44 min-h-[48px]">
               {datesInView.map((dateStr, idx) => {
                  const d = new Date(dateStr);
                  const isToday = dateStr === new Date().toISOString().split('T')[0];
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const isCollapsed = isWeekend; // Kollapsa lördag/söndag för att spara plats
                  
                  return (
                     <div 
                        key={dateStr} 
                        className={cn(
                           "border-l border-gray-100 flex flex-col items-center justify-center transition-all",
                           isCollapsed ? "w-12 min-w-[48px] bg-gray-50/80" : "flex-1 min-w-[200px] p-2",
                           isToday && !isCollapsed && "bg-brand-accent/5",
                           isToday && isCollapsed && "bg-brand-accent/10"
                        )}
                     >
                        {isCollapsed ? (
                           <div className="flex flex-col items-center space-y-1 mt-1">
                              <span className={cn("text-[9px] font-bold uppercase", isToday ? "text-brand-accent" : "text-gray-400")}>
                                 {WEEKDAYS[d.getDay()]}
                              </span>
                              <span className={cn("text-[10px] font-bold", isToday ? "text-brand-dark" : "text-gray-500")}>
                                 {d.getDate()}
                              </span>
                           </div>
                        ) : (
                           <>
                              <span className={cn("text-[10px] font-bold uppercase tracking-wider", isToday ? "text-brand-accent" : "text-gray-400")}>
                                 {WEEKDAYS[d.getDay()]}
                              </span>
                              <span className={cn("text-xs font-bold", isToday ? "text-brand-dark" : "text-gray-700")}>
                                 {d.getDate()} {d.toLocaleString('sv-SE', { month: 'short' })}
                              </span>
                           </>
                        )}
                     </div>
                  );
               })}
            </div>

            {/* Rows (Employees) */}
            <div className="pb-20 relative z-10 w-full flex flex-col">
               {filteredEmployees.length === 0 && (
                  <div className="p-8 text-center text-gray-400 text-sm italic">
                     Ingen personal hittades som matchar sökningen.
                  </div>
               )}
               {filteredEmployees.map((emp, idx) => {
                  return (
                     <div key={emp.id} className={cn("flex min-h-[100px] border-b border-gray-100 transition-colors group", idx % 2 === 0 ? "bg-white" : "bg-gray-50/30")}>
                        {/* Employee Name (Sticky Left) */}
                        <div className="sticky left-0 w-44 bg-inherit px-4 py-4 flex flex-col justify-center border-r border-gray-200 z-10 group-hover:bg-gray-50">
                           <div className="w-8 h-8 mb-2 rounded-full bg-brand-dark text-white flex items-center justify-center font-bold text-xs uppercase shadow-sm">
                              {emp.first_name?.charAt(0)}{emp.last_name?.charAt(0)}
                           </div>
                           <span className="font-bold text-sm text-brand-dark leading-tight">{emp.first_name}</span>
                           <span className="text-xs text-brand-muted truncate">{emp.last_name}</span>
                        </div>

                        {/* Schedule Columns */}
                        <div className="flex-1 flex">
                           {datesInView.map(dateStr => {
                              const cellBlocks = blocks.filter(b => b.employeeId === String(emp.id) && b.date === dateStr);
                              cellBlocks.sort((a,b) => a.startTimeRaw.localeCompare(b.startTimeRaw));
                              const d = new Date(dateStr);
                              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                              const isCollapsed = isWeekend;

                              const dragDisabled = !!pendingMove;
                              return (
                                 <DroppableCell
                                    key={dateStr}
                                    employeeId={emp.id}
                                    dateStr={dateStr}
                                    className={cn(
                                       "flex-1 min-w-[200px] border-l border-gray-100 p-2 space-y-2 relative group/cell hover:bg-gray-50/50",
                                       isWeekend && "bg-gray-50/50"
                                    )}
                                 >
                                    {cellBlocks.map((block, i) => {
                                        const blockNonDraggable = block.isAbsence || !block.shiftId || dragDisabled;
                                        const openEditor = () => !block.isAbsence && setEditingMission({
                                                ...block,
                                                startH_input: block.startTimeRaw,
                                                endH_input: block.endTimeRaw,
                                                emp_input: block.employeeId,
                                                adminNote: notes[block.missionId]?.adminNote || '',
                                                schemaNote: notes[block.missionId]?.schemaNote || ''
                                          });
                                        if (isCollapsed) {
                                           return (
                                              <DraggableBlock
                                                key={i}
                                                block={block}
                                                disabled={blockNonDraggable}
                                                onClick={openEditor}
                                                className={cn("w-full mb-1 py-1 rounded text-center cursor-pointer shadow-sm text-[8px] font-bold text-white", block.isAbsence ? "bg-red-400" : "bg-brand-accent hover:bg-emerald-500", !blockNonDraggable && "cursor-grab active:cursor-grabbing")}
                                              >
                                                <span title={`${block.startTimeRaw} - ${block.clientName || block.serviceName}`}>{block.startTimeRaw}</span>
                                              </DraggableBlock>
                                           );
                                        }

                                        return (
                                       <DraggableBlock
                                          key={i}
                                          block={block}
                                          disabled={blockNonDraggable}
                                          onClick={openEditor}
                                          className={cn(
                                             "border shadow-sm rounded-lg p-2.5 text-left relative overflow-hidden transition-all",
                                             block.isAbsence
                                                ? "bg-red-50/50 border-red-100 opacity-90 cursor-default"
                                                : "bg-white border-gray-200 cursor-pointer hover:border-brand-accent hover:shadow-md",
                                             !blockNonDraggable && "cursor-grab active:cursor-grabbing"
                                          )}
                                       >
                                          <div className={cn("w-1 absolute left-0 top-0 bottom-0", block.isAbsence ? "bg-red-400" : "bg-brand-accent")} />
                                          <p className={cn("text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5", block.isAbsence ? "text-red-700/60" : "text-emerald-700")}>
                                             <Clock className="w-3 h-3" /> {block.startTimeRaw} - {block.endTimeRaw}
                                          </p>
                                          
                                          {block.isAbsence ? (
                                              <p className="text-xs font-bold text-red-700 leading-tight truncate">
                                                {block.serviceName}
                                              </p>
                                          ) : (
                                              <>
                                                <p className="text-xs font-bold text-brand-dark leading-tight truncate" title={block.clientName}>
                                                   {block.clientName}
                                                </p>
                                                <p className="text-[9px] text-brand-accent/80 font-bold truncate mt-0.5 border-b border-gray-100 pb-1 mb-1">
                                                   {block.serviceName}
                                                </p>
                                                <p className="text-[9px] text-gray-500 truncate" title={`${block.address}, ${block.postalCode} ${block.city}`}>
                                                   {block.address}{block.postalCode || block.city ? `, ${block.postalCode} ${block.city}` : ''}
                                                </p>
                                              </>
                                          )}

                                          {notes[block.missionId]?.adminNote && (
                                             <div className="mt-1 pt-1 border-t border-gray-100 opacity-90 line-clamp-2">
                                                <div className="text-[9px] font-bold text-sky-800 bg-sky-50 border border-sky-100 px-1 py-0.5 rounded leading-tight truncate">
                                                  A: {notes[block.missionId].adminNote}
                                                </div>
                                             </div>
                                          )}
                                          {notes[block.missionId]?.schemaNote && (
                                             <div className="mt-0.5 opacity-90 line-clamp-2">
                                                <div className="text-[9px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-100 px-1 py-0.5 rounded leading-tight truncate">
                                                  S: {notes[block.missionId].schemaNote}
                                                </div>
                                             </div>
                                          )}
                                       </DraggableBlock>
                                    );
                                    })}

                                    {!isCollapsed && cellBlocks.length === 0 && (
                                       <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                          <span className="text-[10px] uppercase font-bold text-gray-300">Ledig</span>
                                       </div>
                                    )}
                                 </DroppableCell>
                              );
                           })}
                        </div>
                     </div>
                  );
               })}
            </div>

         </div>
      </div>

      {/* Editor Modal Overlay */}
      {editingMission && (
         <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-gray-100">
               <div className="px-6 py-4 bg-brand-dark text-white flex items-center justify-between">
                  <h3 className="font-bold font-serif flex items-center gap-2">
                     <GripHorizontal className="w-4 h-4 opacity-70" /> Hantera Schemapass
                  </h3>
                  <button onClick={() => setEditingMission(null)} className="text-white/70 hover:text-white">Avbryt</button>
               </div>
               
               <div className="p-6 space-y-5">
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                     <div className="font-bold text-gray-800 text-base">{editingMission.clientName}</div>
                     <div className="text-sm border-l-2 border-brand-accent/30 pl-3 mt-3 text-gray-600">
                        <p>{editingMission.address}</p>
                        <p>{editingMission.postalCode} {editingMission.city}</p>
                     </div>
                     <div className="text-[10px] uppercase tracking-wider font-bold text-brand-accent mt-4 flex items-center gap-2">
                        <CalendarIcon className="w-3 h-3" />
                        {editingMission.date}
                     </div>
                  </div>

                  <div className="space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Tider</label>
                        <div className="flex items-center gap-3">
                           <input 
                              type="time" 
                              value={editingMission.startH_input} 
                              onChange={e => setEditingMission({...editingMission, startH_input: e.target.value})}
                              className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-accent"
                           />
                           <span className="text-gray-400">—</span>
                           <input 
                              type="time" 
                              value={editingMission.endH_input} 
                              onChange={e => setEditingMission({...editingMission, endH_input: e.target.value})}
                              className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-accent"
                           />
                        </div>
                     </div>

                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Resurs (Personal)</label>
                        <select 
                           value={editingMission.emp_input}
                           onChange={e => setEditingMission({...editingMission, emp_input: e.target.value})}
                           className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-accent"
                        >
                           <option value="UNASSIGNED">-- UTAN ANSTÄLLD (OBOKAD) --</option>
                           {employees.filter(e => e.id !== 'UNASSIGNED').map(emp => (
                              <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                           ))}
                        </select>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-sky-600 uppercase tracking-widest mb-1 flex items-center gap-1.5">Admin-anteckning</label>
                           <textarea 
                              className="w-full bg-sky-50/30 border border-sky-100 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-300 min-h-[80px] resize-none"
                              placeholder="Syns bara här i schemavyn..."
                              value={editingMission.adminNote}
                              onChange={e => setEditingMission({...editingMission, adminNote: e.target.value})}
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-indigo-600 uppercase tracking-widest mb-1 flex items-center gap-1.5">Schema-anteckning</label>
                           <textarea 
                              className="w-full bg-indigo-50/30 border border-indigo-100 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300 min-h-[80px] resize-none"
                              placeholder="Syns för personalen i deras app..."
                              value={editingMission.schemaNote}
                              onChange={e => setEditingMission({...editingMission, schemaNote: e.target.value})}
                           />
                        </div>
                     </div>
                  </div>
               
                  <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
                     <button onClick={() => setEditingMission(null)} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
                        Avbryt
                     </button>
                     
                     {editingMission.workorderlineId ? (
                        <>
                           <button 
                              onClick={() => handleSaveEdit('SHIFT')}
                              disabled={editingMission.saving}
                              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-70"
                           >
                              <span className={cn("transition-opacity", editingMission.saving ? "opacity-0" : "opacity-100")}>Spara endast detta pass</span>
                           </button>
                           <button 
                              onClick={() => handleSaveEdit('SERIES')}
                              disabled={editingMission.saving}
                              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-dark hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-70"
                           >
                              {editingMission.saving && <Loader className="w-4 h-4 animate-spin inline mr-2" />}
                              <span className={cn("transition-opacity", editingMission.saving ? "opacity-0" : "opacity-100")}>Spara på hela serien</span>
                           </button>
                        </>
                     ) : (
                        <button 
                           onClick={() => handleSaveEdit('SHIFT')}
                           disabled={editingMission.saving}
                           className="px-7 py-2.5 rounded-lg text-sm font-semibold text-white bg-brand-dark hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-70"
                        >
                           {editingMission.saving && <Loader className="w-4 h-4 animate-spin inline mr-2" />}
                           <span className={cn("transition-opacity flex items-center gap-2", editingMission.saving ? "opacity-0" : "opacity-100")}>
                              <IconCheck size={18} /> Spara
                           </span>
                        </button>
                     )}
                  </div>
               </div>
            </div>
         </div>
      )}

      {pendingMove && (
        <div className="fixed bottom-6 right-6 z-[60] bg-brand-dark text-white text-xs font-bold rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
          <Loader className="w-3 h-3 animate-spin" /> Flyttar passet i Timewave…
        </div>
      )}

    </div>

    <DragOverlay>
      {dragging ? (
        <div className="pointer-events-none border shadow-xl rounded-lg p-2.5 bg-white border-brand-accent w-[200px] scale-105">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5 text-emerald-700">
            <Clock className="w-3 h-3" /> {dragging.startTimeRaw} - {dragging.endTimeRaw}
          </p>
          <p className="text-xs font-bold text-brand-dark leading-tight truncate">{dragging.clientName}</p>
          <p className="text-[9px] text-brand-accent/80 font-bold truncate mt-0.5">{dragging.serviceName}</p>
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

// ────────── Drag-and-drop hjälpkomponenter ──────────

function DroppableCell({
  employeeId,
  dateStr,
  className,
  children,
}: {
  employeeId: string | number;
  dateStr: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${employeeId}:${dateStr}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'bg-brand-accent/10 ring-2 ring-inset ring-brand-accent/40')}
    >
      {children}
    </div>
  );
}

function DraggableBlock({
  block,
  disabled,
  className,
  onClick,
  children,
}: {
  block: any;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const dragId = `block:${block.shiftId ?? `m${block.missionId}`}:${block.employeeId}:${block.date}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { block },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn(className, isDragging && 'opacity-30')}
    >
      {children}
    </div>
  );
}
