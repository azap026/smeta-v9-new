import React, { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { useMaterialSearch } from '../hooks/useMaterialSearch';
import './MaterialAutocomplete.css';
import MaterialCommandPalette from './MaterialCommandPalette.tsx';

// Значения по умолчанию; будут переопределены через CSS-переменные при наличии
const GRID_DEFAULT = "88px minmax(320px,1fr) 120px 72px 40px"; // [код] [название] [цена] [ед.] [иконка]
const ROW_H_DEFAULT = 48;
// Используем CSS var с фолбэком на дефолты
const GRID = `var(--mat-autocomplete-grid, ${GRID_DEFAULT})`;
const ROW_H = `var(--mat-autocomplete-row-h, ${ROW_H_DEFAULT}px)`;
const DEBUG_GRID_OUTLINE = false; // set true to visualize grid bounds

function MaterialAutocompleteInner({
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
}, ref) {
  const [input, setInput] = useState(value?.name || '');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [alignKw, setAlignKw] = useState({
    code: { justify: 'flex-start', text: 'left' },
    name: { justify: 'flex-start', text: 'left' },
    price:{ justify: 'flex-end',   text: 'right' },
    unit: { justify: 'center',     text: 'center' },
    thumb:{ justify: 'center',     text: 'center' },
  });
  const { items, loading } = useMaterialSearch(input, { debounceMs: 200, limit: 20 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { setInput(value?.name || ''); }, [value?.name]);

  const visibleItems = useMemo(() => (
    (items || []).map(m => ({ ...m, __selected: currentId != null && m.id === currentId }))
  ), [items, currentId]);
  // Expose imperative API for opening palette from parent
  useImperativeHandle(ref, () => ({
    openPalette: (initialQuery = '') => {
      try {
        if (typeof initialQuery === 'string') setInput(initialQuery);
      } catch {}
      setPaletteOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }), []);


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
  // Drop old overlay; we'll use modal palette instead

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
    // Прочитать числовые переменные выравнивания и отмапить в ключевые слова
    try {
      const cs = getComputedStyle(document.documentElement);
      const readNum = (name, dflt) => {
        const raw = cs.getPropertyValue(name).trim();
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : dflt;
      };
      const toJustify = (n) => (n <= 0.34 ? 'flex-start' : n < 0.66 ? 'center' : 'flex-end');
      const toText = (n) => (n <= 0.34 ? 'left' : n < 0.66 ? 'center' : 'right');
      const code = readNum('--mat-col-code-align-x', 0);
      const name = readNum('--mat-col-name-align-x', 0);
      const price = readNum('--mat-col-price-align-x', 1);
      const unit = readNum('--mat-col-unit-align-x', 0.5);
      const thumb = readNum('--mat-col-thumb-align-x', 0.5);
      setAlignKw({
        code: { justify: toJustify(code), text: toText(code) },
        name: { justify: toJustify(name), text: toText(name) },
        price:{ justify: toJustify(price), text: toText(price) },
        unit: { justify: toJustify(unit), text: toText(unit) },
        thumb:{ justify: toJustify(thumb), text: toText(thumb) },
      });
    } catch { /* noop */ }
  }, [open, syncPosition]);

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={(e)=> { setInput(e.target.value); if (!paletteOpen && e.target.value.trim().length>=2) setPaletteOpen(true); }}
          onFocus={()=> { /* do not auto-open modal on focus to avoid reopening after Replace */ }}
          onBlur={()=> {
            // небольшая задержка, чтобы клик по элементу успел сработать
            setTimeout(()=> setOpen(false), 150);
          }}
          onKeyDown={(e)=>{
            if (!paletteOpen && (input||'').trim().length>=2) setPaletteOpen(true);
            if (!open) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i=> Math.min(visibleItems.length-1, (i<0?0:i+1))); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i=> Math.max(0, (i<=0?0:i-1))); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (activeIdx>=0 && activeIdx<visibleItems.length) onPick(visibleItems[activeIdx]);
            } else if (e.key === 'Escape') {
              setPaletteOpen(false);
            }
          }}
          placeholder={placeholder}
          className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
          autoComplete="off"
        />
        {input && (
          <button
            type="button"
            className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-1"
            title="Очистить"
            onMouseDown={(e)=> e.preventDefault()}
            onClick={()=> { setInput(''); setOpen(false); setPaletteOpen(false); setActiveIdx(-1); inputRef.current?.focus(); }}
          >×</button>
        )}
      </div>

      {/* Modal command palette instead of dropdown */}
      <MaterialCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        initialQuery={input}
        currentId={currentId}
        onSelect={(m)=> {
          setInput(m.name || '');
          onSelect?.(m);
          setPaletteOpen(false);
          setTimeout(()=> inputRef.current?.focus(), 0);
        }}
      />
    </>
  );
}

const MaterialAutocomplete = forwardRef(MaterialAutocompleteInner);
export default MaterialAutocomplete;
