import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMaterialSearch } from '../hooks/useMaterialSearch';
import './MaterialAutocomplete.css';
import './MaterialCommandPalette.css';
import FloatingWindow from './ui/FloatingWindow.jsx';

export type MaterialItem = {
  id: string;
  name: string;
  unit?: string | null;
  unit_price?: number | string | null;
  image?: string | null;
  sku?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (m: MaterialItem) => void;
  initialQuery?: string;
  width?: number;
  heightVh?: number; // viewport height percent for list area
  currentId?: string;
};

const ROW_H = 48;

export default function MaterialCommandPalette({ open, onOpenChange, onSelect, initialQuery = '', width = 800, heightVh = 72, currentId }: Props) {
  const [q, setQ] = useState(initialQuery || '');
  const [activeIdx, setActiveIdx] = useState(0);
  const [chosenIdx, setChosenIdx] = useState<number | null>(null);
  const listParentRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const { items, loading, error } = useMaterialSearch(q, { debounceMs: 200, limit: 50 });

  useEffect(() => { if (open) setQ(initialQuery || ''); }, [open, initialQuery]);
  useEffect(() => { if (!open) { setActiveIdx(0); setChosenIdx(null); } }, [open]);

  const visibleItems = useMemo<MaterialItem[]>(() => (items as MaterialItem[]) || [], [items]);

  const rowVirtualizer = useVirtualizer({
    count: loading ? 6 : visibleItems.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });
  const totalSize = rowVirtualizer.getTotalSize();
  useEffect(() => {
    if (measureRef.current) {
      measureRef.current.style.height = totalSize + 'px';
    }
  }, [totalSize, loading, visibleItems.length]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const confirm = useCallback(() => {
    const idx = (chosenIdx == null) ? activeIdx : chosenIdx;
    const it = visibleItems[idx];
    if (!it) return;
    // если выбран тот же, что и текущий, просто закрыть
    if (currentId && it.id === currentId) { close(); return; }
    onSelect(it);
    close();
  }, [chosenIdx, activeIdx, visibleItems, onSelect, close, currentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (loading && !visibleItems.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min((visibleItems.length-1), i+1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i-1)); }
      else if (e.key === 'Home') { e.preventDefault(); setActiveIdx(0); }
      else if (e.key === 'End') { e.preventDefault(); setActiveIdx(Math.max(0, visibleItems.length-1)); }
      else if (e.key === 'PageDown') { e.preventDefault(); setActiveIdx(i => Math.min(visibleItems.length-1, i + 10)); }
      else if (e.key === 'PageUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 10)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        // Подтверждаем активную строку сразу, без ожидания setState
        const it = visibleItems[activeIdx];
        if (it) {
          if (!currentId || it.id !== currentId) onSelect(it);
          close();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, visibleItems, activeIdx, loading, confirm]);

  // FloatingWindow сам обрабатывает overlay и закрытие по Esc/крестик

  const highlight = (txt?: string) => {
    const query = (q || '').trim().toLowerCase();
    if (!txt) return null;
    if (!query || query.length < 2) return txt;
    const lower = txt.toLowerCase();
    const i = lower.indexOf(query);
    if (i === -1) return txt;
    return (<>
      {txt.slice(0, i)}
      <mark className="auto-mark">{txt.slice(i, i + query.length)}</mark>
      {txt.slice(i + query.length)}
    </>);
  };

  const fmtPrice = (v?: number | string | null) => {
    if (v == null || Number.isNaN(+v)) return <span className="text-gray-400">—</span>;
    const n = Number(v);
    const s = n.toFixed(2);
    const trimmed = s.endsWith('.00') ? s.slice(0, -3) : s;
    return <span className="[font-variant-numeric:tabular-nums] [font-feature-settings:'tnum','lnum'] font-semibold">{trimmed} ₽</span>;
  };

  if (!open) return null;

  // map width to utility classes (avoid inline style); default 800px
  // normalize dims via class suffixes
  const widthSuffix = width >= 860 ? '880' : width >= 800 ? '800' : '720';
  const heightSuffix = heightVh >= 76 ? '76' : heightVh >= 72 ? '72' : '64';

  const content = (
    <div className={`mcp-container mcp-h-${heightSuffix}`}>
      <div className="mcp-header">
        <input
          autoFocus
          value={q}
          onChange={(e)=> setQ(e.target.value)}
          placeholder="Введите наименование материала…"
          className="mcp-input"
        />
      </div>
      <div
        ref={listParentRef}
        className="mcp-list"
        role="listbox"
        aria-label="Список материалов"
        aria-activedescendant={visibleItems[activeIdx]?.id ? `mcp-opt-${visibleItems[activeIdx]?.id}` : undefined}
        tabIndex={0}
      >
        <div ref={measureRef} className="mcp-measure">
            {rowVirtualizer.getVirtualItems().map((row) => {
              const idx = row.index;
              const isSkeleton = loading && !visibleItems.length;
              const it = isSkeleton ? undefined : visibleItems[idx];
              const selected = !isSkeleton && idx === activeIdx;
              return (
                <>
                  {isSkeleton ? (
                    <div
                      key={row.key}
                      className="mcp-skel"
                      ref={(el) => {
                        if (!el) return;
                        el.style.top = '0px';
                        el.style.height = ROW_H + 'px';
                        el.style.transform = `translateY(${row.start}px)`;
                      }}
                    >
                      <div className="mcp-skel-row">
                        <div className="mcp-skel-bar mcp-skel-64" />
                        <div className="mcp-skel-bar mcp-skel-flex" />
                        <div className="mcp-skel-bar mcp-skel-96" />
                        <div className="mcp-skel-bar mcp-skel-28" />
                      </div>
                    </div>
                  ) : it ? (
                    <div
                      key={row.key}
                      id={`mcp-opt-${(it as MaterialItem).id}`}
                      role="option"
                      className={`mcp-item ${selected ? 'selected' : ''}`}
                      ref={(el) => {
                        if (!el) return;
                        el.style.top = '0px';
                        el.style.height = ROW_H + 'px';
                        el.style.transform = `translateY(${row.start}px)`;
                      }}
                      onMouseEnter={()=> setActiveIdx(idx)}
                      onClick={()=> { setActiveIdx(idx); setChosenIdx(idx); }}
                    >
                      <div className="mcp-item-row">
                        {/* Левая часть: код + название */}
                        <div className="mcp-left">
                          <div className="mcp-code">{(it as MaterialItem).sku || (it as MaterialItem).id}</div>
                          <div className="mcp-name">{highlight((it as MaterialItem).name)}</div>
                        </div>
                        {/* Правая часть: цена и ед. */}
                        <div className="mcp-right">
                          <div className="mcp-price">{fmtPrice((it as MaterialItem).unit_price)}</div>
                          <div className="mcp-unit">{(it as MaterialItem).unit || '—'}</div>
                          <div className="mcp-thumb">
                            {(it as MaterialItem).image ? (
                              <img src={(it as MaterialItem).image || ''} alt="" className="mcp-img" onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display='none';}} />
                            ) : (
                              <div className="mcp-img-fallback" />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              );
            })}
          </div>
      </div>
      {!loading && !error && visibleItems.length === 0 && (
        <div className="mcp-empty">Ничего не найдено</div>
      )}
      {!!error && (
        <div className="mcp-error">
          <div className="mcp-error-text">{error}</div>
          <button className="mcp-retry" onClick={()=> setQ(q => q + ' ')}>Повторить</button>
        </div>
      )}
    </div>
  );

  const idxForAction = (chosenIdx == null) ? activeIdx : chosenIdx;
  const disableReplace = !visibleItems[idxForAction] || (currentId ? visibleItems[idxForAction]!.id === currentId : false);
  return (
    <FloatingWindow
      open={open}
      onClose={() => onOpenChange(false)}
      title="Выбор материала"
      width={parseInt(widthSuffix, 10)}
      center
      overlay
      footer={
        <div className="mcp-actions">
          <button className="mcp-btn" onClick={()=> onOpenChange(false)}>Отмена</button>
          <button className="mcp-btn mcp-btn-primary" disabled={disableReplace} onClick={confirm}>Заменить</button>
        </div>
      }
      persistKey="material-cmd"
    >
      {content}
    </FloatingWindow>
  );
}

// keep measure height in sync without inline JSX styles
// Note: placed after export to keep file simple; can be moved into the component if preferred.
