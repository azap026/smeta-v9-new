import React, { useEffect } from 'react';

export function Dialog({ open, onOpenChange, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onOpenChange?.(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange?.(false)} />
      {children}
    </div>
  );
}

export function DialogContent({ className = '', children }) {
  return (
    <div className={`absolute inset-0 flex items-center justify-center p-4 ${className}`}>
  <div className="bg-white rounded-2xl shadow-lg w-full max-w-3xl flex flex-col max-h-[85vh]">
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className = '', children }) {
  return <div className={`px-4 py-3 border-b border-gray-200 flex items-center justify-between ${className}`}>{children}</div>;
}
export function DialogTitle({ className = '', children }) {
  return <h3 className={`text-base font-semibold ${className}`}>{children}</h3>;
}
export function DialogDescription({ className = '', children }) {
  return <p className={`text-sm text-gray-500 ${className}`}>{children}</p>;
}
export function DialogFooter({ className = '', align = 'end', children }) {
  const justify = align === 'start' ? 'justify-start' : align === 'between' ? 'justify-between' : 'justify-end';
  return <div className={`px-4 py-3 border-t border-gray-200 flex ${justify} gap-2 ${className}`}>{children}</div>;
}
