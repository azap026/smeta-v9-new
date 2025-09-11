// components/AddWorkModal.tsx
import React, { useState, useRef, useEffect } from "react";
import { DialogFooter } from "./ui/dialog";
import FloatingWindow from "./ui/FloatingWindow.jsx";
import { Label, Input, Button } from "./ui/form";

export default function AddWorkModal({ open, onOpenChange, onSaveSuccess }) {
  const [modalData, setModalData] = useState({
    phase_id: "", phase_name: "",
    stage_id: "", stage_name: "",
    substage_id: "", substage_name: "",
    work_id: "", work_name: "",
    unit: "", unit_price: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [idStatus, setIdStatus] = useState<'idle'|'checking'|'duplicate'|'free'>('idle');
  const debounceRef = useRef<any>(null);
  const [phases, setPhases] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [substages, setSubstages] = useState<any[]>([]);
  const [mode, setMode] = useState({ phase:'existing', stage:'existing', sub:'existing' });
  const [showPhase, setShowPhase] = useState(false);
  const modalBoxRef = useRef<HTMLDivElement | null>(null);
  const setMD = (k: string, v: string) => setModalData((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setModalData({
      phase_id: "", phase_name: "",
      stage_id: "", stage_name: "",
      substage_id: "", substage_name: "",
      work_id: "", work_name: "",
      unit: "", unit_price: "",
    });
    setError(null);
    setIdStatus('idle');
    setMode({ phase:'existing', stage:'existing', sub:'existing' });
    setShowPhase(false);
    const t = setTimeout(() => { modalBoxRef.current?.querySelector("input")?.focus(); }, 0);
    // загрузка справочников
    (async () => {
      try {
        const [ph, st, ss] = await Promise.all([
          fetch('/api/phases').then(r=>r.json()).catch(()=>[]),
          fetch('/api/stages').then(r=>r.json()).catch(()=>[]),
          fetch('/api/substages').then(r=>r.json()).catch(()=>[]),
        ]);
        setPhases(ph); setStages(st); setSubstages(ss);
      } catch {}
    })();
    return () => clearTimeout(t);
  }, [open]);

  // live проверка дубликата по work_id (debounce 450ms)
  useEffect(() => {
    const wid = modalData.work_id.trim();
    if (!wid) { setIdStatus('idle'); return; }
    setIdStatus('checking');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch('/api/admin/work-ref/' + encodeURIComponent(wid));
        const j = await r.json().catch(()=>({}));
        if (r.ok && j.exists) {
          setIdStatus('duplicate');
        } else {
          setIdStatus('free');
        }
      } catch {
        setIdStatus('idle');
      }
    }, 450);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [modalData.work_id]);

  const submitAddModal = async () => {
    setError(null);
    const wid = modalData.work_id.trim();
    const wname = modalData.work_name.trim();
    if (!wid || !wname) { setError('Укажите work_id и work_name'); return; }
    try {
  if (idStatus === 'duplicate') { setError('Дубликат: такой work_id уже существует'); return; }
  const r = await fetch('/api/admin/create-work-ref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...modalData, work_id: wid, work_name: wname })
      });
      const j = await r.json().catch(()=>({}));
      if (r.status === 409 || j.duplicate) { setError('Дубликат: такой work_id уже существует'); return; }
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      onOpenChange(false);
      onSaveSuccess?.();
    } catch (e:any) {
      setError('Ошибка сохранения: ' + (e.message || e));
    }
  };

  return (
    <FloatingWindow
      open={open}
      onClose={() => onOpenChange(false)}
      title="Новая работа"
      persistKey="add-work-modal"
      width={900}
      center
  overlay
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" className="bg-primary-600 text-white hover:bg-primary-700" onClick={submitAddModal}>Сохранить</Button>
        </>
      }
    >
      <div className="fw-form" ref={modalBoxRef}>
        {/* Размещение */}
        <div className="fw-block">
          <div className="fw-block-title">Размещение</div>
          <div className="fw-grid">
            {showPhase ? (
              <HierarchyField
                level="phase"
                mode={mode.phase}
                onModeChange={(m)=>setMode(s=>({...s, phase:m }))}
                items={phases}
                valueId={modalData.phase_id}
                valueName={modalData.phase_name}
                onSelect={(item)=>{ setMD('phase_id', item?.id||''); setMD('phase_name', item?.name||''); }}
                onNewId={(v)=>setMD('phase_id', v)}
                onNewName={(v)=>setMD('phase_name', v)}
                labelId="ID Этапа" labelName="Этап №"
              />
            ) : (
              <div className="fw-phase-inline fw-col-span-2">
                {modalData.phase_id ? (
                  <>
                    <span className="fw-phase-chip">Этап: {modalData.phase_id} · {modalData.phase_name || modalData.phase_id} (авто)</span>
                    <button type="button" className="fw-phase-btn" onClick={()=>setShowPhase(true)}>Изменить</button>
                  </>
                ) : (
                  <button type="button" className="fw-phase-btn" onClick={()=>setShowPhase(true)}>Выбрать / создать этап</button>
                )}
              </div>
            )}
            <HierarchyField
              level="stage"
              mode={mode.stage}
              onModeChange={(m)=>setMode(s=>({...s, stage:m }))}
              items={stages.filter(s=> !modalData.phase_id || s.phase_id===modalData.phase_id)}
              valueId={modalData.stage_id}
              valueName={modalData.stage_name}
              onSelect={(item)=>{ setMD('stage_id', item?.id||''); setMD('stage_name', item?.name||''); if(item?.phase_id){ setMD('phase_id', item.phase_id); const ph=phases.find(p=>p.id===item.phase_id); if(ph) setMD('phase_name', ph.name);} }}
              onNewId={(v)=>setMD('stage_id', v)}
              onNewName={(v)=>setMD('stage_name', v)}
              labelId="ID Раздела" labelName="Наименование раздела"
            />
            <HierarchyField
              level="sub"
              mode={mode.sub}
              onModeChange={(m)=>setMode(s=>({...s, sub:m }))}
              items={substages.filter(ss=> !modalData.stage_id || ss.stage_id===modalData.stage_id)}
              valueId={modalData.substage_id}
              valueName={modalData.substage_name}
              onSelect={(item)=>{ setMD('substage_id', item?.id||''); setMD('substage_name', item?.name||''); if(item?.stage_id){ setMD('stage_id', item.stage_id); const st=stages.find(s=>s.id===item.stage_id); if(st){ setMD('stage_name', st.name); if(st.phase_id){ setMD('phase_id', st.phase_id); const ph=phases.find(p=>p.id===st.phase_id); if(ph) setMD('phase_name', ph.name); } } }} }
              onNewId={(v)=>setMD('substage_id', v)}
              onNewName={(v)=>setMD('substage_name', v)}
              labelId="ID Подраздела" labelName="Наименование подраздела"
            />
          </div>
        </div>

        {/* Детали работы */}
        <div className="fw-block">
          <div className="fw-block-title">Детали работы</div>
          <div className="fw-grid">
            <Field id="work_id" label="ID Работы" placeholder="w.1"
              value={modalData.work_id}
              onChange={(e)=>{ setMD("work_id", e.target.value); if(error) setError(null); }}
              after={
                <IdStatusBadge status={idStatus} />
              }
            />
            <Field id="unit" label="Ед. изм." placeholder="м2" value={modalData.unit} onChange={(e)=>setMD("unit", e.target.value)} />
            <Field id="work_name" label="Наименование работы" className="fw-col-span-2" placeholder="Например: Демонтаж покрытия" value={modalData.work_name} onChange={(e)=>{ setMD("work_name", e.target.value); if(error) setError(null); }} />
            <Field id="unit_price" label="Цена за единицу" type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={modalData.unit_price} onChange={(e)=>setMD("unit_price", e.target.value)} />
          </div>
          {error && <div className="fw-error fw-error-inline">{error}</div>}
        </div>
      </div>
        </FloatingWindow>
  );
}

function Field(props: any) {
  const { id, label, className = "", after, ...rest } = props;
  return (
    <div className={"fw-field " + className}>
      <label htmlFor={id} className="fw-label">{label}</label>
      <div className="fw-input-wrap">
        <input id={id} className="fw-input" {...rest} />
        {after && <div className="fw-input-after">{after}</div>}
      </div>
    </div>
  );
}

function IdStatusBadge({ status }:{ status:'idle'|'checking'|'duplicate'|'free'}) {
  if (status === 'idle') return null;
  const map = {
    checking: { txt:'проверка…', bg:'#f59e0b', color:'#111' },
    duplicate: { txt:'есть', bg:'#dc2626', color:'#fff' },
    free: { txt:'свободен', bg:'#16a34a', color:'#fff' }
  } as any;
  const s = map[status];
  return <span className={`fw-badge fw-badge-${status}`}>{s.txt}</span>;
}

function HierarchyField({ level, mode, onModeChange, items, valueId, valueName, onSelect, onNewId, onNewName, labelId, labelName }) {
  return (
    <div className="fw-hier-field fw-col-span-2">
      <div className="fw-hier-head">
        <span className="fw-hier-title">{labelName.split(' ')[0]}</span>
        <div className="fw-hier-switch">
          <button type="button" className={mode==='existing'?'fw-hier-btn active':'fw-hier-btn'} onClick={()=>onModeChange('existing')}>Существ.</button>
          <button type="button" className={mode==='new'?'fw-hier-btn active':'fw-hier-btn'} onClick={()=>onModeChange('new')}>Новый</button>
        </div>
      </div>
      {mode === 'existing' ? (
        <div className="fw-hier-existing">
          <select className="fw-input" aria-label={labelId+ ' список'} value={valueId} onChange={e=>{ const id=e.target.value; const item = items.find(i=>String(i.id)===id); onSelect(item||null); }}>
            <option value="">-- не выбирать --</option>
            {items.map(it => <option key={it.id} value={it.id}>{it.id} · {it.name || it.id}</option>)}
          </select>
          {valueName && <div className="fw-hier-selected">{valueName}</div>}
        </div>
      ) : (
        <div className="fw-hier-new fw-grid">
          <div>
            <label className="fw-label" htmlFor={`${level}_new_id`}>{labelId}</label>
            <input id={`${level}_new_id`} className="fw-input" value={valueId} onChange={e=>onNewId(e.target.value)} />
          </div>
          <div className="fw-col-span-1">
            <label className="fw-label" htmlFor={`${level}_new_name`}>{labelName}</label>
            <input id={`${level}_new_name`} className="fw-input" value={valueName} onChange={e=>onNewName(e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

// (DraggableCard и FloatingLayer удалены - заменены универсальным FloatingWindow)
