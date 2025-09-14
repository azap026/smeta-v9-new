import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMaterialSearch } from '../hooks/useMaterialSearch';

export default function MaterialAutocomplete({ value, onSelect, placeholder = 'Начните вводить название или артикул…', disabled, currentId }) {
  const [input, setInput] = useState(value?.name || '');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const { items, loading } = useMaterialSearch(input, { debounceMs: 200, limit: 20 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { setInput(value?.name || ''); }, [value?.name]);

  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const onPick = (m) => {
    if (!m || m.id === currentId) return; // already selected
    onSelect?.(m);
    setOpen(false);
    setActiveIdx(-1);
    // keep focus for typing continuity
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const highlight = (txt) => {
    const q = (input||'').trim().toLowerCase();
    if (!q || q.length<2) return txt;
    const i = (txt||'').toLowerCase().indexOf(q);
    if (i === -1) return txt;
    return (<>
      {txt.slice(0,i)}<span className="bg-yellow-200 rounded px-0.5">{txt.slice(i, i+q.length)}</span>{txt.slice(i+q.length)}
    </>);
  };

  // Positioning via portal
  const [overlay, setOverlay] = useState(null);
  useEffect(() => {
    if (!overlay) {
      const div = document.createElement('div');
      div.style.position = 'fixed';
      div.style.zIndex = 9999;
      setOverlay(div);
      document.body.appendChild(div);
      return () => { document.body.removeChild(div); };
    }
  }, [overlay]);

  // Sync overlay position with input
  useEffect(() => {
    if (!overlay || !open || !inputRef.current) return;
    const el = inputRef.current;
    const rect = el.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = (rect.bottom + 4) + 'px';
    overlay.style.width = rect.width + 'px';
  }, [overlay, open, input]);

  const visibleItems = useMemo(() => {
    // mark current
    return (items||[]).slice(0,20).map(it => ({ ...it, __selected: currentId && it.id === currentId }));
  }, [items, currentId]);

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e)=> { setInput(e.target.value); setOpen(true); setActiveIdx(0); }}
        onFocus={()=> { if ((input||'').trim().length>=2) setOpen(true); }}
        onBlur={(e)=> {
          // небольшая задержка, чтобы клик по элементу успел сработать
          setTimeout(()=> setOpen(false), 150);
        }}
        onKeyDown={(e)=>{
          if (!open && (input||'').trim().length>=2) setOpen(true);
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i=> Math.min(visibleItems.length-1, (i<0?0:i+1))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i=> Math.max(0, (i<=0?0:i-1))); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx>=0 && activeIdx<visibleItems.length) onPick(visibleItems[activeIdx]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
        autoComplete="off"
      />
      {overlay && open && (input||'').trim().length>=2 && createPortal(
        <div
          ref={listRef}
          className="max-h-80 overflow-auto rounded-md shadow-lg border border-gray-200 bg-white"
          style={{ boxShadow:'0 8px 20px rgba(0,0,0,0.12)' }}
        >
          {loading && (<div className="px-3 py-2 text-xs text-gray-500">Поиск…</div>)}
          {!loading && visibleItems.length===0 && (
            <div className="px-3 py-2 text-xs text-gray-500">Ничего не найдено</div>
          )}
          {visibleItems.map((m, idx) => (
            <button
              type="button"
              key={m.id}
              data-idx={idx}
              onMouseEnter={()=> setActiveIdx(idx)}
              onMouseDown={(e)=> e.preventDefault()}
              onClick={()=> onPick(m)}
              disabled={m.__selected}
              className={
                "w-full text-left px-3 py-2 text-sm hover:bg-primary-50 flex items-center gap-3 " +
                (idx===activeIdx ? 'bg-primary-50' : '') + ' ' +
                (m.__selected ? 'opacity-60 cursor-not-allowed' : '')
              }
            >
              {m.image && (
                <img src={m.image} alt="" className="w-6 h-6 object-cover rounded border" onError={(e)=>{e.currentTarget.style.display='none';}} />
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate text-gray-800">{highlight(m.name)}</div>
                <div className="text-xs text-gray-500">SKU: {highlight(m.sku || m.id)}</div>
              </div>
              <div className="text-xs text-gray-600 whitespace-nowrap">{m.unit || ''} · {m.unit_price!=null? m.unit_price : ''}</div>
            </button>
          ))}
        </div>,
        overlay
      )}
    </>
  );
}
