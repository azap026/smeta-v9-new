import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMaterialSearch } from '../hooks/useMaterialSearch';
import './MaterialAutocomplete.css';

const GRID = "88px minmax(320px,1fr) 120px 72px 40px"; // [код] [название] [цена] [ед.] [иконка]
const ROW_H = 48;
const DEBUG_GRID_OUTLINE = false; // set true to visualize grid bounds

export default function MaterialAutocomplete({
  value,
  onSelect,
  placeholder = 'Начните вводить название или артикул…',
  disabled,
  currentId,
  // UI extensions
  // eslint-disable-next-line no-unused-vars
  onAddNew: _onAddNew, // (text:string) => void
  // eslint-disable-next-line no-unused-vars
  headerContent: _headerContent, // ReactNode: renders at the top of the dropdown
  footerContent, // ReactNode: renders at the bottom of the dropdown
  dropdownMaxHeight = '56vh',
  // eslint-disable-next-line no-unused-vars
  thumbnailSize: _thumbnailSize = 24,
}) {
  const [input, setInput] = useState(value?.name || '');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const { items, loading } = useMaterialSearch(input, { debounceMs: 200, limit: 20 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { setInput(value?.name || ''); }, [value?.name]);

  const visibleItems = useMemo(() => (
    (items || []).map(m => ({ ...m, __selected: currentId != null && m.id === currentId }))
  ), [items, currentId]);

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
    const lower = (txt||'');
    const i = lower.toLowerCase().indexOf(q);
    if (i === -1) return txt;
    return (
      <>
        {txt.slice(0,i)}
        <mark className="auto-mark">{txt.slice(i, i+q.length)}</mark>
        {txt.slice(i+q.length)}
      </>
    );
  };

  const fmtPrice = (v) => {
    if (v == null || Number.isNaN(+v)) return <span className="text-gray-400">—</span>;
    const n = Number(v);
    const s = n.toFixed(2);
    const trimmed = s.endsWith('.00') ? s.slice(0, -3) : s;
    return <span className="tabular-nums">{trimmed} ₽</span>;
  };

  // Overlay via portal (always on top)
  const [overlay, setOverlay] = useState(null);
  useEffect(() => {
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.zIndex = '2147483647';
    div.style.left = '0px';
    div.style.top = '0px';
    div.style.width = '0px';
    div.style.height = '0px';
    document.body.appendChild(div);
    setOverlay(div);
    return () => { try { document.body.removeChild(div); } catch (e) { void e; } };
  }, []);

  const dropdownStyleRef = useRef({ left: 0, top: 0, minWidth: 0, maxWidth: 0 });
  const [, setTick] = useState(0); // used to force rerender
  const syncPosition = React.useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const rightClamp = Math.max(200, viewportWidth - rect.left - 8);
    const minWidth = Math.round(rect.width);
    const maxWidth = Math.min(Math.round(rect.width * 1.15), rightClamp);
    dropdownStyleRef.current = {
      left: rect.left,
      top: rect.bottom + 4,
      minWidth,
      maxWidth,
    };
    // force rerender
    // force rerender
    setTick(t => t + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    syncPosition();
    const onScroll = () => syncPosition();
    const onResize = () => syncPosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, syncPosition]);

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={(e)=> { setInput(e.target.value); if (!open && e.target.value.trim().length>=2) setOpen(true); }}
          onFocus={()=> { if ((input||'').trim().length>=2) setOpen(true); }}
          onBlur={()=> {
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
          disabled={disabled}
          autoComplete="off"
        />
        {!!input && (
          <button
            type="button"
            className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-1"
            title="Очистить"
            onMouseDown={(e)=> e.preventDefault()}
            onClick={()=> { setInput(''); setOpen(false); setActiveIdx(-1); inputRef.current?.focus(); }}
          >×</button>
        )}
      </div>

      {open && (input||'').trim().length>=2 && overlay && createPortal(
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={activeIdx>=0 && activeIdx<visibleItems.length ? `mat-opt-${visibleItems[activeIdx]?.id}` : undefined}
          className="max-h-80 overflow-auto rounded-xl shadow-lg border border-gray-200 bg-white p-1"
          style={{
            position: 'fixed',
            left: dropdownStyleRef.current.left,
            top: dropdownStyleRef.current.top,
            minWidth: dropdownStyleRef.current.minWidth,
            maxWidth: dropdownStyleRef.current.maxWidth,
            maxHeight: dropdownMaxHeight,
            overflowY: 'auto',
            boxShadow:'0 8px 20px rgba(0,0,0,0.12)',
            zIndex: 2147483647,
            background: '#ffffff'
          }}
        >
          {/* Табличный заголовок */}
          <div className="sticky top-0 bg-white z-[10] border-b" style={{ boxSizing:'border-box' }}>
            <div style={{ display:'grid', gridTemplateColumns: GRID, outline: DEBUG_GRID_OUTLINE ? '1px solid #e33' : undefined }}>
              <div style={{height: ROW_H}}>
                <div className="h-full flex items-center pl-3 leading-snug text-xs text-gray-500">Код</div>
              </div>
              <div style={{height: ROW_H}}>
                <div className="h-full flex items-center pl-3 leading-snug text-xs text-gray-500">Наименование</div>
              </div>
              <div style={{height: ROW_H}}>
                <div className="h-full flex items-center pr-3 justify-end leading-snug text-xs text-gray-500">Цена</div>
              </div>
              <div style={{height: ROW_H}}>
                <div className="h-full flex items-center justify-center leading-snug text-xs text-gray-500">Ед.</div>
              </div>
              <div style={{height: ROW_H}}>
                <div className="h-full flex items-center justify-center leading-snug text-xs text-gray-500"></div>
              </div>
            </div>
          </div>

          {loading && (
            <div className="py-1">
              {[...Array(5)].map((_,i)=>(
                <div key={i} className="px-3" style={{ display:'grid', gridTemplateColumns: GRID, alignItems:'center', height:44 }}>
                  <div style={{height:10}} className="bg-gray-200 rounded" />
                  <div style={{height:10}} className="bg-gray-200 rounded" />
                  <div style={{height:10}} className="bg-gray-200 rounded" />
                  <div style={{height:10}} className="bg-gray-200 rounded" />
                  <div style={{height:28, width:28}} className="bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          )}
          {!loading && visibleItems.length===0 && (
            <div className="px-3 py-3 text-sm text-gray-500">Ничего не найдено</div>
          )}
          <div>
            {visibleItems.map((m, idx) => (
              <button
                type="button"
                key={m.id}
                id={`mat-opt-${m.id}`}
                data-idx={idx}
                role="option"
                aria-selected={idx===activeIdx}
                onMouseEnter={()=> setActiveIdx(idx)}
                onMouseDown={(e)=> e.preventDefault()}
                onClick={()=> onPick(m)}
                disabled={m.__selected}
                className={
                  "w-full text-left grid items-center text-sm hover:bg-gray-50 " +
                  (idx===activeIdx ? 'bg-gray-100' : '') + ' ' +
                  (m.__selected ? 'opacity-60 cursor-not-allowed' : '') + ' ' +
                  (idx>0 ? 'border-t border-gray-100' : '')
                }
                style={{ display:'grid', gridTemplateColumns: GRID, boxSizing:'border-box', height: ROW_H, outline: DEBUG_GRID_OUTLINE ? '1px solid #e33' : undefined }}
              >
                {/* Код */}
                <div className="h-full flex items-center pl-3 leading-snug">
                  <div className="truncate whitespace-nowrap text-gray-500">{highlight(m.sku || m.id)}</div>
                </div>
                {/* Наименование */}
                <div className="h-full flex items-center pl-3 leading-snug">
                  <div className="truncate text-gray-800 font-medium" style={{ display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{highlight(m.name)}</div>
                </div>
                {/* Цена */}
                <div className="h-full flex items-center pr-3 justify-end leading-snug">
                  <div className="[font-variant-numeric:tabular-nums] [font-feature-settings:'tnum','lnum'] text-right font-semibold">{fmtPrice(m.unit_price)}</div>
                </div>
                {/* Ед. */}
                <div className="h-full flex items-center justify-center leading-snug">
                  <div className="text-gray-500 whitespace-nowrap">{m.unit || '—'}</div>
                </div>
                {/* Иконка */}
                <div className="h-full flex items-center justify-center leading-snug">
                  {m.image ? (
                    <img src={m.image} alt="" className="w-7 h-7 object-contain block rounded" onError={(e)=>{e.currentTarget.style.display='none';}} />
                  ) : (
                    <div className="w-7 h-7 bg-gray-100 rounded" />
                  )}
                </div>
              </button>
            ))}
          </div>
          {footerContent && (
            <div className="sticky bottom-0 bg-white border-t px-2 py-1 text-xs text-gray-600">{footerContent}</div>
          )}
        </div>,
        overlay
      )}
    </>
  );
}
