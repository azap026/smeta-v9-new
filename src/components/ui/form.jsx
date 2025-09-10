import React from 'react';

export function Label({ className = '', htmlFor, children }) {
  return <label htmlFor={htmlFor} className={`block text-xs text-gray-600 mb-1 ${className}`}>{children}</label>;
}

export function Input({ className = '', ...props }) {
  return <input {...props} className={`w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${className}`} />;
}

export function Button({ className = '', variant, ...props }) {
  const base = 'px-3 py-1.5 rounded-md text-sm';
  const styles = variant === 'outline'
    ? 'border border-gray-200 text-gray-700 bg-white hover:bg-gray-50'
    : 'bg-primary-600 text-white hover:bg-primary-700';
  return <button {...props} className={`${base} ${styles} ${className}`} />;
}
