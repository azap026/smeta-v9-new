import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMaterialSearch } from '../hooks/useMaterialSearch';
import './MaterialAutocomplete.css';

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
};

const ROW_H = 48;

export default function MaterialCommandPalette({ open, onOpenChange, onSelect, initialQuery = '', width = 800, heightVh = 72 }: Props) {
  const [q, setQ] = useState(initialQuery || '');
  const [activeIdx, setActiveIdx] = useState(0);
  const listParentRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const { items, loading, error } = useMaterialSearch(q, { debounceMs: 200, limit: 50 });

  useEffect(() => { if (open) setQ(initialQuery || ''); }, [open, initialQuery]);
  useEffect(() => { if (!open) setActiveIdx(0); }, [open]);

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
        const it = visibleItems[activeIdx];
        if (it) { onSelect(it); close(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, visibleItems, activeIdx, loading, onSelect, close]);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!overlayRef.current) return;
      if (e.target instanceof Node && e.target === overlayRef.current) {
        onOpenChange(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open, onOpenChange]);

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
  const widthClass = width >= 860 ? 'max-w-[880px] w-[880px]' : width >= 800 ? 'max-w-[880px] w-[800px]' : 'max-w-[720px] w-[720px]';
  const maxHClass = heightVh >= 76 ? 'max-h-[76vh]' : heightVh >= 72 ? 'max-h-[72vh]' : 'max-h-[64vh]';

  const dialog = (
    <div ref={overlayRef} className="fixed inset-0 z-[2147483646] bg-black/20 backdrop-blur-sm flex items-center justify-center">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${widthClass}`}>
        <div className="p-3 border-b">
          <input
            autoFocus
            value={q}
            onChange={(e)=> setQ(e.target.value)}
            placeholder="Название или артикул…"
            className="w-full text-base outline-none placeholder:text-gray-400"
          />
        </div>
        <div
          ref={listParentRef}
          className={`overflow-auto ${maxHClass}`}
          role="listbox"
          aria-label="Список материалов"
          aria-activedescendant={visibleItems[activeIdx]?.id ? `mcp-opt-${visibleItems[activeIdx]?.id}` : undefined}
          tabIndex={0}
        >
          <div ref={measureRef} className="relative">
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
                      className={`absolute left-0 w-full`}
                      ref={(el) => {
                        if (!el) return;
                        el.style.top = '0px';
                        el.style.height = ROW_H + 'px';
                        el.style.transform = `translateY(${row.start}px)`;
                      }}
                    >
                      <div className="h-full px-3 flex items-center gap-3">
                        <div className="h-3 w-16 bg-gray-200 rounded" />
                        <div className="h-3 flex-1 bg-gray-200 rounded" />
                        <div className="h-3 w-24 bg-gray-200 rounded" />
                        <div className="h-7 w-7 bg-gray-200 rounded" />
                      </div>
                    </div>
                  ) : it ? (
                    <div
                      key={row.key}
                      id={`mcp-opt-${(it as MaterialItem).id}`}
                      role="option"
                      aria-selected={selected ? 'true' : undefined}
                      className={`${selected ? 'bg-gray-100' : ''} hover:bg-gray-50 cursor-pointer absolute left-0 w-full`}
                      ref={(el) => {
                        if (!el) return;
                        el.style.top = '0px';
                        el.style.height = ROW_H + 'px';
                        el.style.transform = `translateY(${row.start}px)`;
                      }}
                      onMouseEnter={()=> setActiveIdx(idx)}
                      onClick={()=> { onSelect(it as MaterialItem); close(); }}
                    >
                      <div className="h-full px-3 flex items-center justify-between gap-3">
                        {/* Левая часть: код + название */}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-gray-500 truncate">{(it as MaterialItem).sku || (it as MaterialItem).id}</div>
                          <div className="text-sm font-medium truncate">{highlight((it as MaterialItem).name)}</div>
                        </div>
                        {/* Правая часть: цена и ед. */}
                        <div className="flex items-center gap-3">
                          <div className="text-right text-sm">{fmtPrice((it as MaterialItem).unit_price)}</div>
                          <div className="text-xs text-gray-500 whitespace-nowrap">{(it as MaterialItem).unit || '—'}</div>
                          <div className="flex items-center justify-center w-9">
                            {(it as MaterialItem).image ? (
                              <img src={(it as MaterialItem).image || ''} alt="" className="w-7 h-7 object-contain block rounded" onError={(e)=>{(e.currentTarget as HTMLImageElement).style.display='none';}} />
                            ) : (
                              <div className="w-7 h-7 bg-gray-100 rounded" />
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
          <div className="py-6 text-center text-sm text-gray-500">Ничего не найдено</div>
        )}
        {!!error && (
          <div className="py-4 text-center">
            <div className="text-sm text-red-600 mb-2">{error}</div>
            <button className="px-3 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50" onClick={()=> setQ(q => q + ' ')}>Повторить</button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

// keep measure height in sync without inline JSX styles
// Note: placed after export to keep file simple; can be moved into the component if preferred.
