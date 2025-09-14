import { useEffect, useMemo, useRef, useState } from 'react';

// Simple LRU cache with TTL
class LRUCache {
  constructor(max = 50, ttlMs = 60000) {
    this.max = max; this.ttlMs = ttlMs; this.map = new Map();
  }
  get(k) {
    const v = this.map.get(k);
    if (!v) return null;
    if (Date.now() - v.t > this.ttlMs) { this.map.delete(k); return null; }
    // refresh recency
    this.map.delete(k); this.map.set(k, v);
    return v.data;
  }
  set(k, data) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { data, t: Date.now() });
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first != null) this.map.delete(first);
    }
  }
}

const sharedCache = new LRUCache(50, 60000);

export function useMaterialSearch(query, { debounceMs = 200, limit = 20 } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const q = (query || '').trim();

  const paramsKey = useMemo(() => `${q}|${limit}`, [q, limit]);

  useEffect(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (q.length < 2) { setItems([]); setLoading(false); setError(''); return; }
    const cached = sharedCache.get(paramsKey);
    let timer = setTimeout(async () => {
      try {
        if (cached) { setItems(cached); setError(''); return; }
        setLoading(true); setError('');
        const ctrl = new AbortController(); abortRef.current = ctrl;
        const qs = `q=${encodeURIComponent(q)}&limit=${limit}`;
        const urls = [
          `/api/materials/search?${qs}`,
          `http://localhost:4000/api/materials/search?${qs}`,
          `http://127.0.0.1:4000/api/materials/search?${qs}`,
        ];
        let data = null, lastErr = null;
        for (const u of urls) {
          try {
            const r = await fetch(u, { signal: ctrl.signal, headers: { 'Accept': 'application/json' }, cache: 'no-store' });
            if (!r.ok) { lastErr = new Error('HTTP '+r.status); continue; }
            const j = await r.json();
            if (!Array.isArray(j)) { lastErr = new Error('Bad response'); continue; }
            data = j; break;
          } catch (e) {
            if (e.name === 'AbortError') throw e; // bubble
            lastErr = e;
          }
        }
        if (!data) throw lastErr || new Error('No response');
        sharedCache.set(paramsKey, data);
        setItems(data);
      } catch (e) {
        if (e.name === 'AbortError') return; // ignore
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => { clearTimeout(timer); if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; } };
  }, [q, limit, debounceMs, paramsKey]);

  return { items, loading, error };
}
