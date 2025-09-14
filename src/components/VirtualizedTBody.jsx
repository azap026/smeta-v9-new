import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// Находит ближайший скролл-контейнер по вертикали
function getScrollParent(node) {
  if (!node) return null;
  let el = node.parentElement;
  while (el) {
    const style = getComputedStyle(el);
    const oy = style.overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el;
    el = el.parentElement;
  }
  // fallback: document.scrollingElement
  return typeof document !== 'undefined' ? document.scrollingElement || document.documentElement : null;
}

/**
 * Виртуализированный tbody для таблицы.
 * Применение: внутри <table> замените обычный <tbody> на <VirtualizedTBody ... />
 *
 * props:
 * - rows: any[] — массив строковых моделей
 * - renderRow: (row, index, ctx) => ReactElement<tr> — отрисовщик строки;
 *            получит ctx.measureRef, назначьте его на <tr ref={ctx.measureRef}>
 * - estimateSize: (row, index) => number — оценка высоты строки в px
 * - overscan?: number — запас строк сверху/снизу (по умолчанию 6)
 * - colCount: number — количество колонок (для spacer-строк colSpan)
 */
export default function VirtualizedTBody({
  rows,
  renderRow,
  estimateSize,
  overscan = 6,
  colCount,
  getRowKey,
  enabled = true,
}) {
  const anchorRef = useRef(null);
  const [scrollEl, setScrollEl] = useState(null);
  const [isPrint, setIsPrint] = useState(false);

  // Печать: рендерим как обычный tbody, без виртуализации
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia('print') : null;
    const onChange = (e) => setIsPrint(e.matches);
    if (mq && mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq) mq.addListener(onChange);
    const before = () => setIsPrint(true);
    const after = () => setIsPrint(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq) mq.removeListener(onChange);
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  useEffect(() => {
    if (!anchorRef.current) return;
    const el = getScrollParent(anchorRef.current);
    setScrollEl(el);
  }, []);

  const count = rows?.length || 0;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollEl,
    estimateSize: (index) => {
      try { return Math.max(1, Math.floor(estimateSize(rows[index], index) || 0)); } catch { return 44; }
    },
    overscan,
    // debounced measure via rAF
    measureElement: (el) => {
      if (!el) return undefined;
      let rafId = null;
      const doMeasure = () => {
        rafId = null;
        return el.getBoundingClientRect()?.height || undefined;
      };
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(doMeasure);
      return el.getBoundingClientRect()?.height || undefined;
    },
  });

  // Если контейнер скрыт (display:none) — переизмерим при появлении
  useEffect(() => {
    if (!anchorRef.current) return;
    const root = anchorRef.current;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          // небольшой таймаут чтобы стиль применился
          setTimeout(() => virtualizer?.measure?.(), 0);
        }
      }
    }, { root: null, threshold: 0 });
    io.observe(root);
    return () => io.disconnect();
  }, [virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1].end) : 0;

  // Если строк мало — рендерим как есть, без виртуализации
  const shouldBypass = !enabled || isPrint;

  if (shouldBypass || !scrollEl || count <= Math.max(overscan * 2, 40)) {
    return (
      <tbody ref={anchorRef} role="rowgroup">
        {rows.map((row, i) => {
          const key = getRowKey ? getRowKey(row, i) : (row?.key ?? i);
          return (
            <React.Fragment key={key}>
              {renderRow(row, i, { measureRef: undefined, ariaRowIndex: i + 1 })}
            </React.Fragment>
          );
        })}
      </tbody>
    );
  }

  return (
    <tbody ref={anchorRef} role="rowgroup">
      {paddingTop > 0 && (
        <tr aria-hidden="true" role="presentation">
          <td colSpan={colCount} style={{ height: paddingTop, padding: 0, border: 'none' }} />
        </tr>
      )}
      {virtualItems.map((vi) => {
        const idx = vi.index;
        const row = rows[idx];
        const key = getRowKey ? getRowKey(row, idx) : (row?.key ?? vi.key);
        return (
          <React.Fragment key={key}>
            {renderRow(row, idx, {
              measureRef: (el) => el && virtualizer.measureElement(el),
              ariaRowIndex: idx + 1,
            })}
          </React.Fragment>
        );
      })}
      {paddingBottom > 0 && (
        <tr aria-hidden="true" role="presentation">
          <td colSpan={colCount} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
        </tr>
      )}
    </tbody>
  );
}
