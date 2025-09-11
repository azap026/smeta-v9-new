import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Универсальное плавающее окно.
 * Props:
 * - open: boolean
 * - title?: string | ReactNode
 * - onClose?: () => void
 * - children: содержимое
 * - footer?: ReactNode
 * - width?: number (px)
 * - persistKey?: string (сохраняет позицию в localStorage)
 * - center?: boolean (по центру при первом открытии)
 * - lockInside?: boolean (не выходит за пределы окна)
 * - overlay?: boolean (если нужен лёгкий фон затемнения)
 */
export function FloatingWindow({
  open,
  title,
  onClose,
  children,
  footer,
  width = 800,
  persistKey,
  center = true,
  lockInside = true,
  overlay = false,
}) {
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const posRef = useRef({ x: 0, y: 0 });
  const mountedRef = useRef(false);
  const [, force] = useState(0);

  // Восстановление позиции
  useEffect(() => {
    if (!open) return;
    if (persistKey) {
      try {
        const raw = localStorage.getItem('fw-pos:' + persistKey);
        if (raw) {
          const { x, y } = JSON.parse(raw);
          posRef.current.x = x; posRef.current.y = y;
        }
      } catch { /* ignore */ }
    }
  }, [open, persistKey]);

  useEffect(() => {
    if (!open) return;
    // Fallback стили если глобальный style.css не применился
    if (!document.getElementById('fw-styles')) {
      const tag = document.createElement('style');
      tag.id = 'fw-styles';
      tag.textContent = `/* fallback floating window styles */\n.fw-overlay{position:fixed;inset:0;z-index:1900;pointer-events:none;font-family:inherit;}\n.fw-overlay.has-overlay:before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);pointer-events:auto;}\n.fw-window{position:absolute;top:0;left:0;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 12px 32px -4px rgba(0,0,0,.18),0 6px 14px -6px rgba(0,0,0,.16);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;max-width:95vw;}\n.fw-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:linear-gradient(90deg,#631bff,#824dff);color:#fff;font-size:16px;font-weight:600;cursor:move;-webkit-user-select:none;user-select:none;}\n.fw-header button{background:transparent;border:0;color:inherit;cursor:pointer;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;}\n.fw-header button:hover{background:rgba(255,255,255,.18);}\n.fw-content{flex:1;overflow:auto;padding:20px;font-size:14px;line-height:1.45;}\n.fw-footer{padding:14px 20px;background:#f9fafb;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:12px;}\n`;
      document.head.appendChild(tag);
    }
    const el = cardRef.current; if (!el) return;
    if (!mountedRef.current) {
      if (center) {
        const w = width;
        const h = Math.min(el.offsetHeight || 400, window.innerHeight - 40);
        posRef.current.x = Math.max(10, (window.innerWidth - w) / 2);
        posRef.current.y = Math.max(10, (window.innerHeight - h) / 2);
      }
      mountedRef.current = true;
    }
    el.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px)`;
    force(n => n + 1);
  }, [open, width, center]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    let nx = dragRef.current.x + dx;
    let ny = dragRef.current.y + dy;
    const el = cardRef.current;
    if (el && lockInside) {
      const w = el.offsetWidth; const h = el.offsetHeight;
      nx = Math.min(Math.max(0, nx), window.innerWidth - w);
      ny = Math.min(Math.max(0, ny), window.innerHeight - h);
    }
    posRef.current.x = nx; posRef.current.y = ny;
    if (el) el.style.transform = `translate(${nx}px, ${ny}px)`;
  };
  const onUp = () => {
    dragRef.current = null;
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (persistKey) {
      try { localStorage.setItem('fw-pos:' + persistKey, JSON.stringify(posRef.current)); } catch {}
    }
  };
  const startDrag = (e) => {
    if (e.button !== 0) return;
    if ((e.target).closest('button, input, textarea, select')) return;
    const el = cardRef.current; if (!el) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, x: posRef.current.x, y: posRef.current.y };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!open) return null;
  return createPortal(
    <div className={`fw-overlay${overlay ? ' has-overlay' : ''}`}>
      <div
        ref={cardRef}
        className="fw-window"
        style={{ width: width > window.innerWidth - 40 ? '95vw' : width }}
      >
        <div className="fw-header" onMouseDown={startDrag}>
          <div style={{flex:1, minWidth:0}}>{title}</div>
          <button type="button" aria-label="Закрыть" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="fw-content">
          {children}
        </div>
        {footer && (
          <div className="fw-footer">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default FloatingWindow;
