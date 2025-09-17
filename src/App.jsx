import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
// ----- Константы ширин / отступов (унификация вместо magic numbers) -----
const CELL_PADDING_X = 8;            // Горизонтальный padding ячеек (px)
const HEADER_EXTRA = 6;              // Доп. запас к измеренному тексту заголовка
const IMAGE_CONTAINER_PADDING = 16;  // Паддинги контейнера превью (суммарно по горизонтали)
const IMAGE_EXTRA = 8;               // Доп. запас для колонки изображения
const INPUT_EXTRA = 16;              // Паддинг+граница вокруг input (минимальная обвязка)
const INPUT_NUMERIC_EXTRA = 20;      // Дополнительный запас для числовых полей (выравнивание по правому краю)
// Минимальная ширина колонки наименования
const calcColWidths = { nameMin: 200 };
// Фиксированные ширины самих input в ячейках (автоподгон остаётся только на уровне колонки по заголовку)
const calcCellInputWidths = {
  work: {
    unit: 30,        // "м2"
    quantity: 55,    // Кол-во работ
    unit_price: 50  // Цена за единицу работы
  },
  material: {
    unit: 30,        // Ед. изм. материала
    effQty: 55,      // Расчётное количество (если бы был input)
    unit_price: 50, // Цена материала
    cpu: 40          // Норматив (CPU)
  }
};
// Держим вычисленные ширины (по заголовку) в state


// Универсальная нормализация числового ввода с поддержкой запятой и округлением до N знаков (default=1)
function normalizeDecimalInput(rawValue, decimals = 2) {
  if(rawValue == null) return '';
  const replaced = String(rawValue).replace(',', '.');
  if(replaced.trim()==='') return '';
  const num = parseFloat(replaced);
  if(isNaN(num)) return rawValue; // если не число – отдаём как есть
  const factor = 10 ** decimals;
  const rounded = Math.round(num * factor)/factor;
  return rounded.toFixed(decimals).replace('.', ',');
}

// Преобразование строки с запятой в число (используем вместо parseFloat напрямую)
function toNum(v) {
  if(v==null) return 0;
  const s = String(v).trim();
  if(!s) return 0;
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Форматирование числа (или строки) в вид с двумя десятичными и запятой
function formatDec2(v) {
  const n = toNum(v);
  return n.toFixed(2).replace('.', ',');
}
// Централизованные размеры превью изображений материалов
// Меняйте здесь — обновятся все таблицы
const previewSizes = {
  refMaterial:  { w: 28, h: 28, offsetX: 0,  offsetY: 0,   scale: 1 }, // Справочник материалов
  calcMaterial: { w: 30, h: 30, offsetX: 0,  offsetY: 0,   scale: 1 }, // Таблица расчета (смещение убрано для стабильной сетки)
  // Пример дополнительного профиля:
  // summary: { w: 48, h: 48, offsetX: 100, offsetY: 100, scale: 1 }
};
// Подвинуть: меняйте offsetX / offsetY (в пикселях, могут быть отрицательными)
// Масштаб: scale (например 0.9 или 1.2). Размер w/h задаёт контейнер, scale уменьшит/увеличит изображение внутри без ломки сетки.
// ВНИМАНИЕ: смещение реализовано через CSS transform: translate(x,y) чтобы не ломать поток верстки и избежать влияния margin-collapse.
function getPreviewStyle(kind = 'refMaterial') {
  const cfg = previewSizes[kind] || previewSizes.refMaterial;
  const { w, h } = cfg;
  return { width: w, height: h, display: 'block', objectFit: 'cover' };
}
import AddWorkModal from './components/AddWorkModal.tsx';
import { Label, Input, Button } from './components/ui/form';
import FloatingWindow from './components/ui/FloatingWindow.jsx';
import VirtualizedTBody from './components/VirtualizedTBody.jsx';
import MaterialAutocomplete from './components/MaterialAutocomplete.jsx';
import CreateProject from './components/CreateProject.jsx';
import LoaderOverlay from './components/LoaderOverlay.tsx';
import { rowHeights as _rowHeights, overscanDefaults } from './virtualizationConfig.js';
// Теперь после импорта можно безопасно ссылаться на _rowHeights
const calcRowHeights = _rowHeights.calc;
// import { exportToCSV } from './utils/exporters.js';

export default function App() {
  // Живой режим: считаем материалы из work_materials на лету и не сохраняем снимок сметы
  const LIVE_CALC_NO_SNAPSHOT = true;
  // Активная вкладка: читаем из localStorage, по умолчанию 'calc'
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem('activeTab') || 'calc'; } catch { return 'calc'; }
  }); // calc | works | materials
  const [works, setWorks] = useState([]);
  const worksScrollRef = useRef(null);
  const worksTheadRef = useRef(null);
  const [worksMaxHeight, setWorksMaxHeight] = useState(null);
  const [worksPageSize, setWorksPageSize] = useState(0);
  const [worksPage, setWorksPage] = useState(1); // текущая страница (для запроса)
  const [worksHasMore, setWorksHasMore] = useState(false);
  const [_worksTotal, setWorksTotal] = useState(0);
  const [worksSearch, setWorksSearch] = useState(''); // строка поиска (UI)
  const worksSearchRef = useRef(''); // актуальная применённая строка (для отмены гонок)
  const searchDebounce = useRef(null);
  const [collapsed, setCollapsed] = useState({}); // { [groupCode]: boolean }

  // Сохраняем активную вкладку между перезагрузками/горячими заменами
  useEffect(() => {
    try { localStorage.setItem('activeTab', active); } catch { /* ignore quota errors */ }
  }, [active]);

  // Persist collapsed state per user
  useEffect(() => {
    if (active !== 'works') return;
    try {
      const raw = localStorage.getItem('worksCollapsed');
      if (raw) setCollapsed(JSON.parse(raw));
    } catch { /* ignore parse errors */ }
  }, [active]);
  useEffect(() => {
    if (active !== 'works') return;
    try { localStorage.setItem('worksCollapsed', JSON.stringify(collapsed)); } catch { /* ignore quota */ }
  }, [collapsed, active]);

  const _toggleGroup = (code) => setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));
  const _collapseAll = () => {
    const codes = works.filter(w => w.type === 'group').map(g => g.code);
    const next = {};
    for (const c of codes) next[c] = true;
    setCollapsed(next);
  };
  const _expandAll = () => setCollapsed({});
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksError, setWorksError] = useState('');
  // ===== Materials state =====
  const materialsScrollRef = useRef(null);
  const materialsTheadRef = useRef(null);
  const [materialsMaxHeight, setMaterialsMaxHeight] = useState(null);
  const [materialsPageSize, setMaterialsPageSize] = useState(0);
  const [materials, setMaterials] = useState([]);
  const [materialsPage, setMaterialsPage] = useState(1);
  const [materialsHasMore, setMaterialsHasMore] = useState(false);
  const [_materialsTotal, setMaterialsTotal] = useState(0);
  const [materialsSearch, setMaterialsSearch] = useState('');
  const materialsSearchRef = useRef('');
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const materialsSearchDebounce = useRef(null);
  // ===== Infinite scroll guards and sentinel =====
  const worksLoadMoreLock = useRef(false);
  const materialsLoadMoreLock = useRef(false);
  const requestMoreWorks = useCallback(() => {
    if (worksLoading || worksLoadMoreLock.current || !worksHasMore) return;
    worksLoadMoreLock.current = true;
    setWorksPage((p) => p + 1);
  }, [worksLoading, worksHasMore]);
  const requestMoreMaterials = useCallback(() => {
    if (materialsLoading || materialsLoadMoreLock.current || !materialsHasMore) return;
    materialsLoadMoreLock.current = true;
    setMaterialsPage((p) => p + 1);
  }, [materialsLoading, materialsHasMore]);
  useEffect(() => { if (!worksLoading) worksLoadMoreLock.current = false; }, [worksLoading]);
  useEffect(() => { if (!materialsLoading) materialsLoadMoreLock.current = false; }, [materialsLoading]);

  const EndSentinel = ({ onReachEnd, colSpan = 1, label = 'Загрузка…' }) => {
    const ref = useRef(null);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      let triggered = false;
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !triggered) {
            triggered = true;
            onReachEnd?.();
            setTimeout(() => { triggered = false; }, 800);
          }
        }
      }, { root: null, threshold: 0.1 });
      io.observe(el);
      return () => io.disconnect();
    }, [onReachEnd]);
    return (
      <tr ref={ref} role="row">
        <td role="cell" colSpan={colSpan} className="px-4 py-4 text-center text-sm text-gray-500">{label}</td>
      </tr>
    );
  };
  // ===== Calc template blocks (эталонные блоки) =====
  const [calcBlocks, setCalcBlocks] = useState([]); // [{id, groupName, work:{}, materials:[{}}]]
  // Динамически измеренные ширины колонок по тексту заголовков
  const [calcHeaderWidths, setCalcHeaderWidths] = useState(null); // { idx, name, image, unit, qty, unitPrice, cpu, mats, labor, actions }
  const headerSpanRefs = useRef({});
  const assignHeaderRef = (key) => (el) => { if (el) headerSpanRefs.current[key] = el; };
  // Ручные оверрайды ширин колонок (px)
  const [colWidthOverrides, setColWidthOverrides] = useState(() => {
    try {
      const raw = localStorage.getItem('calcColWidthOverrides');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('calcColWidthOverrides', JSON.stringify(colWidthOverrides||{})); } catch { /* ignore */ }
  }, [colWidthOverrides]);
  // Настраиваемая ширина контейнера таблицы расчёта
  const [calcWidthMode, setCalcWidthMode] = useState(() => {
    try { return localStorage.getItem('calcWidthMode') || 'auto'; } catch { return 'auto'; }
  }); // 'auto' | 'fixed'
  const [calcCustomWidth, setCalcCustomWidth] = useState(() => {
    try { const v = parseInt(localStorage.getItem('calcCustomWidth')||'1200',10); return isNaN(v)?1200:v; } catch { return 1200; }
  });
  useEffect(()=>{ try { localStorage.setItem('calcWidthMode', calcWidthMode); } catch {} }, [calcWidthMode]);
  useEffect(()=>{ if(calcWidthMode==='fixed') { try { localStorage.setItem('calcCustomWidth', String(calcCustomWidth)); } catch {} } }, [calcCustomWidth, calcWidthMode]);
  const resizeSessionRef = useRef(null);
  const startCalcWidthResize = useCallback((e)=>{
    if (calcWidthMode !== 'fixed') return;
    resizeSessionRef.current = { startX: e.clientX, startW: calcCustomWidth };
    const move = (ev) => {
      if (!resizeSessionRef.current) return;
      const dx = ev.clientX - resizeSessionRef.current.startX;
      const next = Math.min(2400, Math.max(600, resizeSessionRef.current.startW + dx));
      setCalcCustomWidth(next);
    };
    const up = () => {
      resizeSessionRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
  }, [calcWidthMode, calcCustomWidth]);

  // Измеряем ширины заголовков с повторной проверкой после загрузки шрифта и таймаута
  useLayoutEffect(() => {
    if (active !== 'calc') return;
    let frame1, frame2, t1;
    const measure = (second = false) => {
      const map = headerSpanRefs.current;
      if (!map || !map.idx) return;
      const cellHorizontalPadding = CELL_PADDING_X * 2;
      const extra = HEADER_EXTRA; // централизованный запас
      const next = {};
      Object.entries(map).forEach(([k, el]) => {
        if (!el) return;
        const w = el.getBoundingClientRect().width;
        next[k] = Math.ceil(w + cellHorizontalPadding + extra);
      });
      if (next.name < calcColWidths.nameMin) next.name = calcColWidths.nameMin;
      // Добавим защиту: если image и unit визуально пересекаются (сумма ширин < их реальных offsetLeft расстояний), компенсируем
      try {
        const imgSpan = map.image?.parentElement; // th
        const unitSpan = map.unit?.parentElement;
        if (imgSpan && unitSpan) {
          const imgRect = imgSpan.getBoundingClientRect();
          const unitRect = unitSpan.getBoundingClientRect();
            if (imgRect.right > unitRect.left - 2) {
              // Увеличиваем image на разницу
              const delta = Math.ceil(imgRect.right - unitRect.left + 4);
              next.image += delta;
            }
        }
      } catch { /* ignore */ }
      setCalcHeaderWidths(prev => {
        // Если второе измерение и ширины стали больше — обновим
        if (!prev) return next;
        if (second) {
          const changed = Object.keys(next).some(k => next[k] > prev[k]);
          return changed ? next : prev;
        }
        return next;
      });
    };
    // Первое измерение
    frame1 = requestAnimationFrame(() => measure(false));
    // После загрузки шрифтов / таймаут измеряем снова
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        frame2 = requestAnimationFrame(() => measure(true));
      });
    }
    t1 = setTimeout(() => measure(true), 300);
    const onResize = () => measure(true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame1) cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
      if (t1) clearTimeout(t1);
    };
  }, [active]);


  // Пересчитываем финальные ширины колонок когда есть измерения заголовков или контейнера
  // Пересчёт минимальных ширин: добавим производные прямо в calcHeaderWidths (вторая стадия) через отдельный effect
  useEffect(() => {
    if (active !== 'calc') return;
    if (!calcHeaderWidths) return;
    // Если уже есть пометка _final, не пересчитываем
    if (calcHeaderWidths && calcHeaderWidths._final) return;
    const previewW = previewSizes.calcMaterial?.w || 36;
    const enriched = {
      ...calcHeaderWidths,
      name: Math.max(calcHeaderWidths.name, calcColWidths.nameMin),
      image: Math.max(calcHeaderWidths.image, previewW + IMAGE_CONTAINER_PADDING + IMAGE_EXTRA),
      unit: Math.max(calcHeaderWidths.unit, calcCellInputWidths.work.unit + INPUT_EXTRA),
      qty: Math.max(calcHeaderWidths.qty, calcCellInputWidths.work.quantity + INPUT_EXTRA),
      unitPrice: Math.max(calcHeaderWidths.unitPrice, calcCellInputWidths.work.unit_price + INPUT_NUMERIC_EXTRA),
      cpu: Math.max(calcHeaderWidths.cpu, calcCellInputWidths.material.cpu + INPUT_NUMERIC_EXTRA),
      mats: calcHeaderWidths.mats,
      labor: calcHeaderWidths.labor,
      actions: Math.max(calcHeaderWidths.actions, 90),
      _final: true
    };
    setCalcHeaderWidths(enriched);
  }, [calcHeaderWidths, active]);

  // Итоговые ширины с учётом ручных overrides
  const effectiveCalcWidths = useMemo(() => {
    if (!calcHeaderWidths) return null;
    const keys = ['idx','name','image','unit','qty','unitPrice','cpu','mats','labor','actions'];
    const out = {};
    for (const k of keys) {
      const base = typeof calcHeaderWidths[k] === 'number' ? calcHeaderWidths[k] : undefined;
      const ov = colWidthOverrides[k];
      out[k] = (ov && ov > 20) ? ov : base; // минимальный порог 20px
    }
    // Подсчёт суммарной ширины (если все есть) для фиксации таблицы и предотвращения перераспределения
    let total = 0; let complete = true;
    for (const k of keys) {
      const v = out[k];
      if (typeof v === 'number' && v > 0) total += v; else { complete = false; break; }
    }
    if (complete) out.__total = total;
    return out;
  }, [calcHeaderWidths, colWidthOverrides]);
  // Inline вставка материала под выбранной строкой
  const [addMatInline, setAddMatInline] = useState(null); // { blockId, afterIndex }
  // Сворачивание материалов внутри блока расчёта
  const [collapsedCalc, setCollapsedCalc] = useState(()=>({})); // { [blockId]: true }
  const toggleBlockMaterials = (blockId) => {
    setCollapsedCalc(prev => {
      const next = { ...prev, [blockId]: !prev[blockId] };
      // Если сворачиваем блок с активной вставкой — сбрасываем
      if (next[blockId] && addMatInline && addMatInline.blockId === blockId) setAddMatInline(null);
      return next;
    });
  };
  // Скрывать материалы по умолчанию для новых блоков
  useEffect(()=>{
    setCollapsedCalc(prev => {
      let changed = false;
      const next = { ...prev };
      for (const b of calcBlocks) {
        if (b.id != null && !(b.id in next)) { next[b.id] = true; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [calcBlocks]);
  const startAddMaterialBelow = (blockId, afterIndex) => setAddMatInline({ blockId, afterIndex });
  const cancelAddMaterialInline = () => setAddMatInline(null);
  const handleSelectNewMaterial = async (blockId, afterIndex, mat) => {
    if (!mat) return;
    let workIdForFetch = null;
    setCalcBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b;
      workIdForFetch = b?.work?.code || null;
      const ms = [...(b.materials || [])];
      const insertIdx = afterIndex + 1;
      ms.splice(insertIdx, 0, {
        code: mat.id,
        name: mat.name,
        unit: mat.unit || '',
        unit_price: mat.unit_price != null ? String(mat.unit_price) : '',
        quantity: '',
        cpu: null,
        image_url: mat.image || '',
        sku: mat.sku || mat.id
      });
      return { ...b, materials: ms };
    }));
    setAddMatInline(null);
    // Создаём нормативную связь (если есть workId) с пустым расходом (cpu=null)
    try {
      if (workIdForFetch && mat.id) {
        await fetch('/api/work-materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_id: workIdForFetch, material_id: mat.id, consumption_per_work_unit: null, waste_coeff: 1 })
        });
      }
    } catch (e) {
      console.warn('Не удалось создать связь работа-материал при вставке:', e);
    }
  };
  const CALC_PAGE_BLOCKS = 30;
  const [calcVisibleBlocks, setCalcVisibleBlocks] = useState(CALC_PAGE_BLOCKS);
  // Ограничение высоты для таблицы расчёта сметы (как для работ/материалов)
  const calcTheadRef = useRef(null);
  const [calcMaxHeight, setCalcMaxHeight] = useState(null);
  const [linksUploading, setLinksUploading] = useState(false);
  // Состояние сохранения сметы
  const [estimateSaving, setEstimateSaving] = useState(false);
  const [estimateSavedAt, setEstimateSavedAt] = useState(null); // Date
  const estimateInitialLoad = useRef(false);
  const estimateSaveTimer = useRef(null);
  // Флаг для подавления ближайшего автосохранения после явного сохранения
  const suppressNextAutosave = useRef(false);
  // Подпись последнего сохранённого состояния (чтобы не отправлять одинаковые снимки)
  const lastSavedSigRef = useRef('');

  // Упрощённый ввод количества работы: без автоочистки, форматирование на blur/Enter
  const [editingWorkQtyBlockId, setEditingWorkQtyBlockId] = useState(null);

  // Авто-нормализация числовых полей (quantity, unit_price, cpu) к формату "#,##0,00" с запятой.
  useEffect(()=>{
    // Пока активно редактируем количество работы — не трогаем авто-нормализацию (иначе мешает стиранию)
    if (editingWorkQtyBlockId) return;
    setCalcBlocks(prev => {
      let changed = false;
      const next = prev.map(b => {
        let wChanged = false;
        const newWork = { ...b.work };
        const normField = (obj, key) => {
          const val = obj?.[key];
          if (val == null || val === '') return false;
          // quantity работы пропускаем если сейчас редактируем
          if (key==='quantity' && b.id===editingWorkQtyBlockId) return false;
          // уже отформатировано? признак: содержит запятую и ровно два знака после
          if (/^\d+(,\d{2})?$/.test(String(val))) return false;
          const norm = formatDec2(val);
          if (norm !== val) { obj[key] = norm; return true; }
          return false;
        };
        wChanged = ['quantity','unit_price'].some(k => normField(newWork,k));
        let mChangedAny = false;
        const newMaterials = (b.materials||[]).map(m => {
          let mChanged = false;
          const nm = { ...m };
          ['quantity','unit_price','cpu'].forEach(f => { if(normField(nm,f)) mChanged = true; });
          if (mChanged) { mChangedAny = true; return nm; }
          return m;
        });
        if (wChanged || mChangedAny) { changed = true; return { ...b, work:newWork, materials:newMaterials }; }
        return b;
      });
      return changed ? next : prev;
    });
  }, [calcBlocks, editingWorkQtyBlockId]);

  const hashString = (s) => {
    // Быстрый нех crypt хеш (djb2 xor) + длина
    let h = 5381 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36) + ':' + s.length;
  };

  // Helper: преобразовать calcBlocks -> payload (мемоизировано)
  const buildEstimatePayload = useCallback((blocksArg) => {
    const blocks = blocksArg || calcBlocks;
    return {
      code: 'current',
      title: 'Текущая смета',
      items: blocks.map(b => ({
        work_code: b.work.code || '',
        work_name: b.work.name || b.work.code || '',
        unit: b.work.unit || null,
        quantity: b.work.quantity || '',
        unit_price: b.work.unit_price || '',
        stage_id: b.work.stage_id || null,
        substage_id: b.work.substage_id || null,
        materials: b.materials.map(m => ({
          material_code: m.code || null,
          material_name: m.name || m.code || '',
          unit: m.unit || null,
          quantity: m.quantity || '',
          unit_price: m.unit_price || ''
        }))
      }))
    };
  }, [calcBlocks]);

  async function saveEstimateSnapshot(blocksArg) {
    if (LIVE_CALC_NO_SNAPSHOT) return true;
    try {
      setEstimateSaving(true);
      const payload = buildEstimatePayload(blocksArg);
      const str = JSON.stringify(payload);
      const sig = hashString(str);
      if (sig === lastSavedSigRef.current) {
        return true; // нет изменений с прошлого сохранения
      }
      const r = await fetch('/api/estimates/by-code/current/full', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: str, keepalive: true
      });
  const j = await r.json().catch(()=>({})); // swallow JSON errors
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
      setEstimateSavedAt(new Date());
      lastSavedSigRef.current = sig;
      return true;
    } catch (e) {
      console.warn('saveEstimateSnapshot error:', e?.message || e);
      return false;
    } finally { setEstimateSaving(false); }
  }

  // Полная очистка сохранённой сметы (снимка) по коду 'current'
  async function clearEstimateSnapshot() {
    if (LIVE_CALC_NO_SNAPSHOT) return true;
    try {
      setEstimateSaving(true);
      const payload = { code: 'current', title: 'Текущая смета', items: [], clear: true };
      const r = await fetch('/api/estimates/by-code/current/full', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
      setEstimateSavedAt(new Date());
      return true;
    } catch (e) {
      console.warn('clearEstimateSnapshot error:', e?.message || e);
      return false;
    } finally { setEstimateSaving(false); }
  }

  // Последняя попытка сохранить на выгрузке страницы
  const saveEstimateBeacon = useCallback((blocksArg) => {
    try {
      const payload = buildEstimatePayload(blocksArg);
      const str = JSON.stringify(payload);
      const sig = hashString(str);
      if (sig === lastSavedSigRef.current) return true; // нечего отправлять
      const blob = new Blob([str], { type: 'application/json' });
      // navigator.sendBeacon ограничен ~64KB; для больших данных может не пройти
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon('/api/estimates/by-code/current/full', blob);
        if (ok) lastSavedSigRef.current = sig;
        return ok;
      }
      return false;
    } catch { return false; }
  }, [buildEstimatePayload]);

  // Сохранение при закрытии/перезагрузке страницы
  useEffect(() => {
    const handler = () => {
      if (!calcBlocks.length) return;
      // Стараемся отправить моментальный снимок
      const ok = saveEstimateBeacon();
      if (!ok) {
        // запасной вариант: синхронная блокировка не используется; просто надеемся на keepalive в автосейве
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [calcBlocks, saveEstimateBeacon]);

  // Загрузка сохранённой сметы при входе во вкладку calc (однократно за сессию)
  useEffect(() => {
    if (active !== 'calc') return;
    // Блокируем автосейв на время первичной загрузки снимка,
    // чтобы исключить отправку пустого снимка до прихода данных
    estimateInitialLoad.current = true;
    let aborted = false;
    (async () => {
      try {
        const r = await fetch('/api/estimates/by-code/current/full');
        const j = await r.json().catch(()=>({}));
        if (!aborted && r.ok && j.ok && j.exists && j.estimate) {
          const blocks = (j.estimate.items||[]).map(it => ({
            id: 'est_'+it.work_code+'_'+Math.random().toString(36).slice(2),
            groupName: '',
            work: { code: it.work_code, name: it.work_name, unit: it.unit||'', quantity: it.quantity||'', unit_price: it.unit_price||'', labor_total:0, stage_id: it.stage_id, substage_id: it.substage_id },
            materials: (it.materials||[]).map(m => ({
              code: m.material_code || '',
              name: m.material_name || m.material_code || '',
              unit: m.unit || '',
              quantity: m.quantity || '',
              unit_price: m.unit_price || '',
              image_url: m.image_url || '',
              total: ''
            }))
          }));
          setCalcBlocks(blocks);
          // Ограничим первоначально видимые блоки
          setCalcVisibleBlocks((prev) => Math.min(Math.max(prev, CALC_PAGE_BLOCKS), blocks.length || CALC_PAGE_BLOCKS));
        }
  } catch { /* ignore fetch/load error */ }
      finally {
        // Снимем блокировку спустя микротакт, чтобы debounce мог работать дальше
        setTimeout(()=> { estimateInitialLoad.current = false; }, 50);
      }
    })();
    return () => { aborted = true; };
  }, [active]);

  // Следим за длиной списка блоков, чтобы не выходить за пределы
  useEffect(() => {
    setCalcVisibleBlocks((prev) => Math.min(prev, calcBlocks.length));
  }, [calcBlocks.length]);

  const requestMoreCalc = useCallback(() => {
    if (calcVisibleBlocks >= calcBlocks.length) return;
    setCalcVisibleBlocks((v) => Math.min(v + CALC_PAGE_BLOCKS, calcBlocks.length));
  }, [calcVisibleBlocks, calcBlocks.length]);

  // Автосохранение сметы (debounce 1000ms)
  useEffect(() => {
  if (LIVE_CALC_NO_SNAPSHOT) return; // живой режим: не автосохраняем
  // Всегда сносим прежний таймер перед любыми ранними выходами,
  // чтобы не ушёл старый пустой снимок
  if (estimateSaveTimer.current) { clearTimeout(estimateSaveTimer.current); estimateSaveTimer.current = null; }
  if (estimateInitialLoad.current) return; // пропуск после загрузки
  if (active !== 'calc') return;
  // Если только что было явное сохранение — пропустим один цикл автосейва
  if (suppressNextAutosave.current) { suppressNextAutosave.current = false; return; }
    estimateSaveTimer.current = setTimeout(async () => {
      try {
        setEstimateSaving(true);
        const payload = buildEstimatePayload();
        const str = JSON.stringify(payload);
        const sig = hashString(str);
        if (sig === lastSavedSigRef.current) {
          setEstimateSaving(false);
          return;
        }
        const r = await fetch('/api/estimates/by-code/current/full', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: str
        });
        const j = await r.json().catch(()=>({}));
        if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
        setEstimateSavedAt(new Date());
        lastSavedSigRef.current = sig;
      } catch (e) {
        console.warn('Ошибка сохранения сметы:', e.message || e);
      } finally {
        setEstimateSaving(false);
      }
    }, 1000);
  return () => { if (estimateSaveTimer.current) { clearTimeout(estimateSaveTimer.current); estimateSaveTimer.current = null; } };
  }, [calcBlocks, active, buildEstimatePayload, LIVE_CALC_NO_SNAPSHOT]);
  // Справочник названий для разделов/подразделов (по их id)
  const [groupTitles, setGroupTitles] = useState({}); // { stage_id: title }

  // Мемоизированные ряды для таблиц (вынесены из JSX для соблюдения правил хуков)
  const calcRows = useMemo(() => {
    if (!calcBlocks.length) return [{ kind: 'empty', key: 'empty' }];
    const natural = (a,b)=> String(a||'').localeCompare(String(b||''),'ru',{numeric:true,sensitivity:'base'});
    // Группируем по stage → substage на полном наборе блоков (без slice), чтобы итоговый порядок был глобально корректен
    const stagesMap = new Map();
    const orphan = [];
    for (const b of calcBlocks) {
      const st = b.work.stage_id || null;
      const ss = b.work.substage_id || null;
      if (!st) { orphan.push(b); continue; }
      if (!stagesMap.has(st)) stagesMap.set(st, { stage_id: st, stage_name: b.work.stage_name||st, works:[], substages: new Map() });
      const bucket = stagesMap.get(st);
      if (ss) {
        if (!bucket.substages.has(ss)) bucket.substages.set(ss, { substage_id:ss, substage_name: b.work.substage_name||ss, works:[] });
        bucket.substages.get(ss).works.push(b);
      } else {
        bucket.works.push(b);
      }
    }
    const stageKeys = Array.from(stagesMap.keys()).sort((a,b)=> natural(a,b));
    const outFull = [];
    for (const stId of stageKeys) {
      const stage = stagesMap.get(stId);
      const stageTitle = groupTitles[stId] || stage.stage_name || stId;
      outFull.push({ kind:'stage-header', key:'stage_'+stId, stId, title: stageTitle });
      stage.works.sort((a,b)=> natural(a.work.code, b.work.code));
      for (const wb of stage.works) {
        outFull.push({ kind:'block', key:'blk_'+wb.id, block: wb });
      }
      const subKeys = Array.from(stage.substages.keys()).sort((a,b)=> natural(a,b));
      for (const ssId of subKeys) {
        const ss = stage.substages.get(ssId);
        const subTitle = groupTitles[ssId] || ss.substage_name || ssId;
        outFull.push({ kind:'sub-header', key:'sub_'+stId+'_'+ssId, stId, ssId, title: subTitle });
        ss.works.sort((a,b)=> natural(a.work.code, b.work.code));
        for (const wb of ss.works) {
          outFull.push({ kind:'block', key:'blk_'+wb.id, block: wb });
        }
      }
    }
    if (orphan.length) {
      orphan.sort((a,b)=> natural(a.work.code, b.work.code));
      outFull.push({ kind:'stage-header', key:'orph', stId:'—', title:'Прочее' });
      for (const wb of orphan) outFull.push({ kind:'block', key:'blk_'+wb.id, block: wb });
    }
    // Ограничиваем по количеству блоков (а не по исходному массиву), чтобы порядок оставался глобальным
    let blocksCount = 0;
    const outCapped = [];
    for (const row of outFull) {
      outCapped.push(row);
      if (row.kind === 'block') {
        blocksCount++;
        if (blocksCount >= calcVisibleBlocks) break;
      }
    }
    const hasMore = calcBlocks.length > calcVisibleBlocks;
    return hasMore ? [...outCapped, { kind:'loader', key:'calc_loader' }] : outCapped;
  }, [calcBlocks, calcVisibleBlocks, groupTitles]);

  const worksRows = useMemo(() => {
    const visible = works.filter((w) => {
      if (!w.parents || w.parents.length === 0) return true;
      for (const p of w.parents) { if (collapsed[p]) return false; }
      return true;
    }).filter(w => !(w.type==='group' && w.level==='phase'));
    const base = visible.map(w => ({ kind: w.type === 'group' ? 'group' : 'item', data: w, key: (w.type==='group' ? 'g:' : 'i:') + (w.code || w.title) }));
    return worksHasMore ? [...base, { kind: 'loader', key: 'works_loader' }] : base;
  }, [works, collapsed, worksHasMore]);

  const materialsRows = useMemo(() => {
    const base = materials.map(m => ({ key: m._rowId, data: m }));
    return materialsHasMore ? [...base, { key: 'materials_loader', kind: 'loader' }] : base;
  }, [materials, materialsHasMore]);
  const [addBlockModal, setAddBlockModal] = useState(false);
  const [addBlockForm, setAddBlockForm] = useState({
    work_input:'', // пользователь вводит код или часть названия
    resolvedWork:null // {id,name,unit,unit_price}
  });
  const [addBlockError, setAddBlockError] = useState('');
  const [workSearchLoading, setWorkSearchLoading] = useState(false);
  const [workSuggestions, setWorkSuggestions] = useState([]); // [{id,name,unit,unit_price}]
  const workSuggestTimer = useRef(null);
  const [workSuggestIndex, setWorkSuggestIndex] = useState(-1); // текущая подсвеченная строка
  const suggestionListRef = useRef(null);
  // Автопрокрутка подсвеченного пункта
  useEffect(() => {
    if (!suggestionListRef.current) return;
    if (workSuggestIndex < 0) return;
    const children = suggestionListRef.current.querySelectorAll('[data-suggest-row="1"]');
    if (workSuggestIndex >= children.length) return;
    const el = children[workSuggestIndex];
    if (el && el.scrollIntoView) {
      const listRect = suggestionListRef.current.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (elRect.top < listRect.top || elRect.bottom > listRect.bottom) {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [workSuggestIndex]);
  const openAddBlockModal = () => { setAddBlockForm({ work_input:'', resolvedWork:null }); setWorkSuggestions([]); setAddBlockModal(true); };
  const [creatingBlock, setCreatingBlock] = useState(false);
  const createCalcBlock = async () => {
    if (creatingBlock) return;
    setAddBlockError('');
    if (!addBlockForm.resolvedWork) {
      setAddBlockError('Выберите работу из справочника');
      return;
    }
    setCreatingBlock(true);
    const w = addBlockForm.resolvedWork;
    let materials = [];
    let metaInfo = null;
    try {
      const r = await fetch(`/api/work-materials/${encodeURIComponent(w.id)}`);
      const j = await r.json().catch(()=>({}));
      if (r.ok && j.ok) {
        if (j.meta) metaInfo = j.meta;
        if (Array.isArray(j.items) && j.items.length) {
          materials = j.items.map(it => ({
            code: it.material_id,
            name: it.material_name || it.material_id,
            unit: it.material_unit || '',
            quantity: it.consumption_per_work_unit ? String(it.consumption_per_work_unit) : '',
            unit_price: it.material_unit_price!=null? String(it.material_unit_price):'',
            image_url: it.material_image_url || '',
            total:''
          }));
        } else {
          materials = [{ name:'', unit:'', quantity:'', unit_price:'', total:'' }];
        }
      } else {
        materials = [{ name:'', unit:'', quantity:'', unit_price:'', total:'' }];
      }
    } catch {
      materials = [{ name:'', unit:'', quantity:'', unit_price:'', total:'' }];
    }
    const id = Date.now() + '_' + Math.random().toString(36).slice(2);
    const block = {
      id,
      groupName: (metaInfo && (metaInfo.stage_name || metaInfo.substage_name)) || '',
  work: { code: w.id, name: w.name, unit: w.unit||'', quantity:'', unit_price:(w.unit_price??'')+'', labor_total:0, stage_id: metaInfo?.stage_id, substage_id: metaInfo?.substage_id, stage_name: metaInfo?.stage_name, substage_name: metaInfo?.substage_name },
      materials
    };
  const nextBlocks = [...calcBlocks, block];
  // Подавим ближайший автосейв (будет явное сохранение ниже)
  suppressNextAutosave.current = true;
  setCalcBlocks(nextBlocks);
  // Немедленное сохранение после добавления блока (без ожидания дебаунса)
  if (!LIVE_CALC_NO_SNAPSHOT) await saveEstimateSnapshot(nextBlocks);
    setAddBlockModal(false);
    setCreatingBlock(false);
  };
  const _addCalcBlockEmpty = () => { // запасной быстрый вариант (оставлено для отладки)
    setCalcBlocks(prev => [...prev, { id:Date.now()+'_'+Math.random().toString(36).slice(2), groupName:'', work:{ name:'', unit:'', quantity:'', unit_price:'', image:'', labor_total:0 }, materials:[{ name:'', unit:'', quantity:'', unit_price:'', total:'' }] }]);
  };
  const updateBlock = (id, updater) => {
    setCalcBlocks(prev => prev.map(b => b.id===id ? updater(b) : b));
  };

  // Защита от случайного дублирования блоков по одинаковому id (страховка на случай гонок)
  useEffect(() => {
    if (!calcBlocks || calcBlocks.length < 2) return;
    const seen = new Set();
    let hasDup = false;
    for (const b of calcBlocks) {
      if (seen.has(b.id)) { hasDup = true; break; }
      seen.add(b.id);
    }
    if (hasDup) {
      setCalcBlocks(prev => {
        const s = new Set();
        const filtered = prev.filter(b => {
          if (s.has(b.id)) return false;
          s.add(b.id);
          return true;
        });
        return filtered;
      });
    }
  }, [calcBlocks]);
  // ===== Ширины столбцов и drag-состояние (независимое расширение таблицы) =====
  // Фиксированные ширины колонок
  const colWidths = { code: 40, name: 600, unit: 100, price: 140, action: 48 }; // works
  const materialsColWidths = { id: 90, name: 600, unit: 70, price: 120, expenditure: 110, weight: 100, image: 120, item: 120, action: 60 };
  const [uploading, setUploading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState({ open:false, code:'', name:'' });
  const [_modalData, setModalData] = useState({
    stage_id: '', stage_name: '',
    substage_id: '', substage_name: '',
    work_id: '', work_name: '',
    unit: '', unit_price: ''
  });

  const openAddModal = () => { setModalOpen(true); };
  const _closeAddModal = () => { setModalOpen(false); };
  const _setMD = (k, v) => setModalData((prev) => ({ ...prev, [k]: v }));
  const modalBoxRef = useRef(null);
  useEffect(() => {
    if (!modalOpen) return;
    // автофокус на первое поле
    const t = setTimeout(() => {
      try { modalBoxRef.current?.querySelector('input')?.focus(); } catch { /* ignore focus errors */ }
    }, 0);
    return () => clearTimeout(t);
  }, [modalOpen]);
  // Авто-ресайз текстовых областей (перенос строк) для столбца "Наименование"
  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = 'left';
    el.style.height = (el.scrollHeight) + 'px';
  };


  const updateWork = (code, field, value) => {
    setWorks(prev => prev.map(it => (it.type !== 'group' && it.code === code ? { ...it, [field]: value, _dirty: true } : it)));
  };

  // Автосохранение (debounce 800ms) для изменённых строк
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!works.some(w => w._dirty)) return; // ничего не изменено
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const dirty = works.filter(w => w._dirty && w.type !== 'group');
      for (const row of dirty) {
        try {
          const payload = { name: row.name, unit: row.unit, unit_price: row.price };
          // code (id) изменение: если пользователь изменил поле code, row.code уже новое; старый был в _origCode
          const new_id = row.code !== row._origCode ? row.code : undefined;
          const r = await fetch(`/api/admin/work-ref/${encodeURIComponent(row._origCode || row.code)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, new_id })
          });
          const j = await r.json().catch(()=>({}));
          if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
          setWorks(prev => prev.map(it => (it === row ? { ...it, _dirty:false, _origCode: j.updated.id, code: j.updated.id, name:j.updated.name, unit:j.updated.unit, price:j.updated.unit_price } : it)));
        } catch (e) {
          console.warn('Автосохранение ошибки:', e);
        }
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [works]);
  const handleDeleteRow = (code) => {
    const row = works.find(w => w.type !== 'group' && w.code === code);
    if (!row) return;
    setConfirmDel({ open:true, code: row.code, name: row.name });
  };

  const confirmDelete = async () => {
    const { code } = confirmDel;
    if (!code) { setConfirmDel({ open:false, code:'', name:'' }); return; }
    try {
      const r = await fetch(`/api/admin/work-ref/${encodeURIComponent(code)}`, { method: 'DELETE' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
      setWorks(prev => prev.filter(it => !(it.type !== 'group' && it.code === code)));
      setConfirmDel({ open:false, code:'', name:'' });
    } catch (e) {
      alert('Ошибка удаления: ' + (e.message || e));
      setConfirmDel({ open:false, code:'', name:'' });
    }
  };
  // helper: try multiple URLs, first that succeeds
  async function fetchJsonTry(urls) {
    let lastErr;
    for (const u of urls) {
      try {
        const sep = u.includes('?') ? '&' : '?';
        const r = await fetch(`${u}${sep}_ts=${Date.now()}` , { cache: 'no-store', headers: { 'Accept': 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Network error');
  }

  // Load works rows from API when opening the Works tab (paginated)
  useEffect(() => {
    if (active !== 'works') return;
    if (!worksPageSize) return; // ждём вычисления размера страницы
    let aborted = false;
    (async () => {
      try {
        setWorksLoading(true); setWorksError('');
        const qParam = worksSearch ? `&q=${encodeURIComponent(worksSearch)}` : '';
        const params = `?page=${worksPage}&limit=${worksPageSize}${qParam}`;
        const data = await fetchJsonTry([
          `/api/works-rows${params}`,
          `http://localhost:4000/api/works-rows${params}`,
          `http://127.0.0.1:4000/api/works-rows${params}`,
        ]);
        if (!aborted) {
          if (worksPage === 1) {
            if (Array.isArray(data)) {
              setWorks(data);
              setWorksTotal(data.length);
              setWorksHasMore(false);
            } else {
              setWorks(data.items || []);
              setWorksTotal(data.total || 0);
              setWorksHasMore(!!data.hasMore);
            }
          } else {
            if (!Array.isArray(data)) {
              setWorks(prev => {
                // Если в процессе поиска изменилась строка, не мержим старые данные
                return [...prev, ...(data.items || [])];
              });
              setWorksTotal(data.total || 0);
              setWorksHasMore(!!data.hasMore);
            }
          }
        }
      } catch (e) {
        if (!aborted) setWorksError(e.message || 'Ошибка загрузки');
      } finally {
        if (!aborted) setWorksLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [active, worksPage, worksSearch, worksPageSize]);
  // Первичный расчёт до первого fetch (чтобы избежать стартовой загрузки 30)
  useLayoutEffect(() => {
    if (active !== 'works') return;
    const el = worksScrollRef.current;
    if (!el) return;
    const h = el.clientHeight || 0;
    const base = (_rowHeights.works?.item) || 52;
    const over = (overscanDefaults.refs || 6);
    setWorksPageSize(Math.min(70, Math.max(10, Math.ceil(h / base) + over)));
  }, [active]);

  // Debounce поиска: при изменении worksSearch сбрасываем страницу и перезагружаем список
  useEffect(() => {
    if (active !== 'works') return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      worksSearchRef.current = worksSearch;
      setWorksPage(1); // триггер загрузки
    }, 400);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [worksSearch, active]);
  // Динамический размер страницы для работ (по высоте внутреннего контейнера)
  useEffect(() => {
    if (active !== 'works') return;
    const el = worksScrollRef.current;
    if (!el) return;
    const compute = () => {
      const h = el.clientHeight || 0;
      const base = (_rowHeights.works?.item) || 52;
      const over = (overscanDefaults.refs || 6);
      // кап по серверу: /api/works-rows ограничит до 70
      const v = Math.min(70, Math.max(10, Math.ceil(h / base) + over));
      setWorksPageSize(v);
    };
    const ro = new ResizeObserver(() => compute());
    compute();
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  // Ограничим высоту справочника работ так, чтобы под заголовком помещалось не более 10 строк
  useLayoutEffect(() => {
    if (active !== 'works') return;
    const update = () => {
      const headH = (worksTheadRef.current?.offsetHeight) || 36;
      const base = (_rowHeights.works?.item) || 52;
      const maxH = headH + base * 13;
      setWorksMaxHeight(maxH);
    };
    update();
    let ro;
    if (worksTheadRef.current && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => update());
      ro.observe(worksTheadRef.current);
    }
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, [active]);
  // При изменении вычисленного размера — перезагрузим с 1-й страницы
  useEffect(() => {
    if (active !== 'works') return;
    setWorksPage(1);
  }, [worksPageSize, active]);
  const updateMaterial = (id, field, value) => {
    setMaterials(prev => prev.map(m => (m._rowId === id ? { ...m, [field]: value, _dirty: true } : m)));
  };
  
  // Суммарные ширины таблиц для горизонтального скролла
  const _worksTotalWidth = Object.values(colWidths).reduce((a,b)=>a+b,0);
  const _materialsTotalWidth = Object.values(materialsColWidths).reduce((a,b)=>a+b,0);
  // Создание новой строки материала (в конце списка, локально, потом сохранение)
  const addMaterialRow = () => {
    const tmpId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    setMaterials(prev => [...prev, { _rowId: tmpId, id: '', name: '', unit: '', unit_price: '', image_url: '', item_url: '', expenditure: '', weight: '', _isNew: true, _dirty: true }]);
  };
  // Сохранение (upsert) всех грязных материалов debounce
  const saveMaterialsTimer = useRef(null);
  useEffect(() => {
    if (!materials.some(m => m._dirty)) return;
    if (saveMaterialsTimer.current) clearTimeout(saveMaterialsTimer.current);
    saveMaterialsTimer.current = setTimeout(async () => {
      const dirty = materials.filter(m => m._dirty);
      for (const row of dirty) {
        try {
          if (!row.id || !row.name) continue; // минимальная валидация
          const payload = {
            id: row.id,
            name: row.name,
            unit: row.unit || null,
            unit_price: row.unit_price === '' ? null : row.unit_price,
            image_url: row.image_url || null,
            item_url: row.item_url || null,
            expenditure: row.expenditure === '' ? null : row.expenditure,
            weight: row.weight === '' ? null : row.weight
          };
          const r = await fetch('/api/materials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const j = await r.json().catch(()=>({}));
          if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
          setMaterials(prev => prev.map(m => (m === row ? { ...m, ...j.material, _dirty:false, _isNew:false, _rowId: j.material.id } : m)));
        } catch (e) {
          console.warn('Material save error:', e.message || e);
        }
      }
    }, 800);
    return () => { if (saveMaterialsTimer.current) clearTimeout(saveMaterialsTimer.current); };
  }, [materials]);

  const deleteMaterial = async (mat) => {
    if (!mat.id) { // локальная не сохранённая
      setMaterials(prev => prev.filter(m => m !== mat));
      return;
    }
    if (!confirm(`Удалить материал ${mat.id}?`)) return;
    try {
      const r = await fetch(`/api/materials/${encodeURIComponent(mat.id)}`, { method: 'DELETE' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
      setMaterials(prev => prev.filter(m => m !== mat));
    } catch (e) { alert('Ошибка удаления: ' + (e.message || e)); }
  };


  // Загрузка материалов при активации вкладки или смене страницы/поиска
  useEffect(() => {
    if (active !== 'materials') return;
    if (!materialsPageSize) return; // ждём вычисления размера страницы
    let aborted = false;
    (async () => {
      try {
        setMaterialsLoading(true); setMaterialsError('');
        const qParam = materialsSearch ? `&q=${encodeURIComponent(materialsSearch)}` : '';
        const params = `?page=${materialsPage}&limit=${materialsPageSize}${qParam}`;
        const data = await fetchJsonTry([
          `/api/materials${params}`,
          `http://localhost:4000/api/materials${params}`,
          `http://127.0.0.1:4000/api/materials${params}`,
        ]);
        if (!aborted) {
          if (materialsPage === 1) {
            setMaterials((data.items || []).map(it => ({ ...it, _rowId: it.id })));
          } else {
            setMaterials(prev => [...prev, ...(data.items || []).map(it => ({ ...it, _rowId: it.id }))]);
          }
          setMaterialsTotal(data.total || 0);
          setMaterialsHasMore(!!data.hasMore);
        }
      } catch (e) {
        if (!aborted) setMaterialsError(e.message || 'Ошибка загрузки материалов');
      } finally {
        if (!aborted) setMaterialsLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [active, materialsPage, materialsSearch, materialsPageSize]);
  // Первичный расчёт для материалов (до первого fetch)
  useLayoutEffect(() => {
    if (active !== 'materials') return;
    const el = materialsScrollRef.current;
    if (!el) return;
    const h = el.clientHeight || 0;
    const base = (_rowHeights.materials?.item) || 56;
    const over = (overscanDefaults.refs || 6);
    setMaterialsPageSize(Math.min(100, Math.max(10, Math.ceil(h / base) + over)));
  }, [active]);

  // Debounce поиска материалов
  useEffect(() => {
    if (active !== 'materials') return;
    if (materialsSearchDebounce.current) clearTimeout(materialsSearchDebounce.current);
    materialsSearchDebounce.current = setTimeout(() => {
      materialsSearchRef.current = materialsSearch;
      setMaterialsPage(1);
    }, 400);
    return () => { if (materialsSearchDebounce.current) clearTimeout(materialsSearchDebounce.current); };
  }, [materialsSearch, active]);
  // Динамический размер страницы для материалов (по высоте внутреннего контейнера)
  useEffect(() => {
    if (active !== 'materials') return;
    const el = materialsScrollRef.current;
    if (!el) return;
    const compute = () => {
      const h = el.clientHeight || 0;
      const base = (_rowHeights.materials?.item) || 56;
      const over = (overscanDefaults.refs || 6);
      // кап по серверу: /api/materials ограничит до ~100
      const v = Math.min(100, Math.max(10, Math.ceil(h / base) + over));
      setMaterialsPageSize(v);
    };
    const ro = new ResizeObserver(() => compute());
    compute();
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  // Ограничим высоту материалов так, чтобы помещалось не более 10 строк под заголовком
  useLayoutEffect(() => {
    if (active !== 'materials') return;
    const update = () => {
      const headH = (materialsTheadRef.current?.offsetHeight) || 36;
      const base = (_rowHeights.materials?.item) || 56;
      const maxH = headH + base * 13; // заголовок + 13 строк
      setMaterialsMaxHeight(maxH);
    };
    update();
    let ro;
    if (materialsTheadRef.current && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => update());
      ro.observe(materialsTheadRef.current);
    }
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, [active]);
  // Ограничим высоту таблицы расчёта сметы: заголовок + 13 условных строк по базовой высоте работы
  useLayoutEffect(() => {
    if (active !== 'calc') return;
    const update = () => {
      const headH = (calcTheadRef.current?.offsetHeight) || 36;
      const base = (calcRowHeights?.work) || 52; // базовая высота строки работы
      const maxH = headH + base * 13;
      setCalcMaxHeight(maxH);
    };
    update();
    let ro;
    if (calcTheadRef.current && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => update());
      ro.observe(calcTheadRef.current);
    }
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, [active]);
  useEffect(() => {
    if (active !== 'materials') return;
    setMaterialsPage(1);
  }, [materialsPageSize, active]);
  const [bulkLoading,setBulkLoading]=useState(false);
  // Панель управления ширинами колонок
  const [showWidthPanel, setShowWidthPanel] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false); // мобильное меню
  // Excel-like grid mode (visual borders)
  const [excelGrid, setExcelGrid] = useState(()=>{
    try { return localStorage.getItem('excelGrid') === '1'; } catch { return false; }
  });
  useEffect(()=>{ try { localStorage.setItem('excelGrid', excelGrid ? '1':'0'); } catch{} }, [excelGrid]);
  // Подгрузим справочник работ (только группы) при открытой вкладке calc для отображения названий разделов вместо кода
  useEffect(() => {
    if (active !== 'calc') return;
    let aborted = false;
    (async () => {
      try {
        const data = await fetch('/api/works-rows').then(r=> r.json()).catch(()=>null);
        if (!data) return;
        const items = Array.isArray(data) ? data : (data.items||[]);
        const map = {};
        for (const it of items) {
          if (it.type === 'group') map[it.code] = it.title || it.code;
        }
        if (!aborted) setGroupTitles(map);
  } catch { /* ignore mapping load errors */ }
    })();
    return () => { aborted = true; };
  }, [active]);
  const createBlocksFromAllBundles = async ()=>{
    if(bulkLoading) return; setBulkLoading(true);
    try {
      const r = await fetch('/api/work-materials-bundles');
      const j = await r.json().catch(()=>({}));
      if(!r.ok || !j.ok || !Array.isArray(j.items)) { alert('Ошибка загрузки связок'); return; }
      // Перезаписываем существующие блоки по work_id, чтобы не создавать дубликаты
      const existingByWork = new Map(calcBlocks.map(b => [b?.work?.code, b]));
      const incomingByWork = new Map();
      for (const it of j.items) {
        const prev = existingByWork.get(it.work.id);
        const block = {
          id: prev ? prev.id : ('bulk_'+it.work.id),
          groupName: it.work.stage_name || it.work.substage_name || '',
          work: { code: it.work.id, name: it.work.name, unit: it.work.unit||'', quantity:'', unit_price: it.work.unit_price!=null? String(it.work.unit_price):'', image:'', labor_total:0, stage_id: it.work.stage_id, substage_id: it.work.substage_id },
          materials: it.materials
        };
        incomingByWork.set(it.work.id, block);
      }
      const kept = calcBlocks.filter(b => !incomingByWork.has(b?.work?.code));
      const nextBlocks = [...kept, ...incomingByWork.values()];
  suppressNextAutosave.current = true;
  setCalcBlocks(nextBlocks);
  // Сохраним сразу после импорта, чтобы не потерять после перезагрузки
  const ok = await saveEstimateSnapshot(nextBlocks);
  if (!ok) {
    alert('Внимание: импорт выполнен локально, но сохранение снимка сметы на сервер не удалось. Не перезагружайте страницу и попробуйте ещё раз (или сократите объём).');
  }
    } finally { setBulkLoading(false);} };
  return (
    <div id="webcrumbs" className="app-root">
      <div className="min-h-screen bg-gray-50 font-sans flex">
        {/* Overlay for mobile sidebar */}
        <div
          className={"app-sidebar-overlay "+(mobileSidebarOpen? 'visible':'')}
          onClick={()=> setMobileSidebarOpen(false)}
        />
        {/* Sidebar (фиксирован / off-canvas) */}
        <aside className={"app-sidebar-fixed "+(mobileSidebarOpen? 'is-open':'')}>        
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <span className="material-symbols-outlined text-primary-600 text-2xl">construction</span>
              <h1 className="text-xl font-bold text-gray-800">СтройСмета</h1>
            </div>
          </div>
          <nav className="p-4">
            <div className="mb-6">
              <h2 className="text-xs uppercase font-semibold text-gray-500 mb-3 px-3">Справочники</h2>
              <ul className="space-y-1">
                <li>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setActive("works"); }}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg ${
                      active === "works"
                        ? "bg-primary-50 text-primary-700 font-medium"
                        : "hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors group"
                    }`}
                  >
                    <span className="material-symbols-outlined text-gray-400 group-hover:text-primary-500">engineering</span>
                    <span>Работы</span>
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setActive("materials"); }}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg ${
                      active === "materials"
                        ? "bg-primary-50 text-primary-700 font-medium"
                        : "hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors group"
                    }`}
                  >
                    <span className="material-symbols-outlined text-gray-400 group-hover:text-primary-500">inventory_2</span>
                    <span>Материалы</span>
                  </a>
                </li>
              </ul>
            </div>
            <div className="mb-6">
              <h2 className="text-xs uppercase font-semibold text-gray-500 mb-3 px-3">Расчет</h2>
              <ul className="space-y-1">
                <li>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setActive("calc"); }}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg ${
                      active === "calc" ? "bg-primary-50 text-primary-700 font-medium" : "hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors group"
                    }`}
                  >
                    <span className="material-symbols-outlined text-primary-500">calculate</span>
                    <span>Расчет сметы</span>
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setActive("project"); }}
                    className={`flex items-center space-x-3 px-3 py-2 rounded-lg ${
                      active === "project" ? "bg-primary-50 text-primary-700 font-medium" : "hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors group"
                    }`}
                  >
                    <span className="material-symbols-outlined text-gray-400 group-hover:text-primary-500">note_add</span>
                    <span>Создать проект</span>
                  </a>
                </li>
                <li>
                  <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors group">
                    <span className="material-symbols-outlined text-gray-400 group-hover:text-primary-500">description</span>
                    <span>Смета</span>
                  </a>
                </li>
              </ul>
            </div>
            <div className="mb-6">
              <h2 className="text-xs uppercase font-semibold text-gray-500 mb-3 px-3">Отчеты</h2>
              <ul className="space-y-1">
                <li>
                  <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors group">
                    <span className="material-symbols-outlined text-gray-400 group-hover:text-primary-500">summarize</span>
                    <span>Все сметы</span>
                  </a>
                </li>
                <li>
                  <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors group">
                    <span className="material-symbols-outlined text-gray-400 group-hover:text-primary-500">insights</span>
                    <span>Аналитика</span>
                  </a>
                </li>
              </ul>
            </div>
          </nav>
          <div className="p-4 mt-auto border-t border-gray-200">
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors">
              <span className="material-symbols-outlined">settings</span>
              <span>Настройки</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors">
              <span className="material-symbols-outlined">help</span>
              <span>Помощь</span>
            </a>
          </div>
        </aside>
  {/* Main Content (с отступом слева под фиксированный сайдбар) */}
  <div className="flex-1 flex flex-col app-main-with-sidebar">
          {/* Header */}
          <header className="bg-white shadow-sm z-20 sticky top-0">
            <div className="flex justify-between items-center px-4 py-3">
              <div className="flex items-center">
                <button className="md:hidden mr-2" onClick={()=> setMobileSidebarOpen(o=> !o)} aria-label="Меню">
                  <span className="material-symbols-outlined text-2xl">{mobileSidebarOpen? 'close' : 'menu'}</span>
                </button>
                <h1 className="text-xl font-semibold text-gray-800">{
                  active === "calc" ? "Расчет сметы" : active === "works" ? "Справочник работ" : active === 'project' ? 'Создать проект' : "Справочник материалов"
                }</h1>
              </div>
              <div className="flex items-center space-x-4">
                <button className="p-1 rounded-full hover:bg-gray-100 transition-colors">
                  <span className="material-symbols-outlined">notifications</span>
                </button>
                <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold">ИП</div>
              </div>
            </div>
          </header>
          {/* Main Content Area */}
          <div className="flex-1 min-h-0 overflow-hidden p-6 bg-gray-50 flex flex-col">
            {(active==='works' && worksLoading) || (active==='materials' && materialsLoading) ? (
              <LoaderOverlay />
            ) : null}
            {active === "calc" ? (
            <div className="flex flex-col min-h-0 gap-6">
            <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
              <div className="p-4 border-b border-gray-200">
                <h2 className="font-semibold text-lg">Основные параметры объекта</h2>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Тип объекта</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Тип объекта (например: Жилой дом)"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Площадь (м²)</label>
                  <input type="number" className="w-full rounded-lg border border-gray-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Адрес объекта</label>
                  <input type="text" className="w-full rounded-lg border border-gray-300 py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="Введите адрес" />
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <div
                className="bg-white rounded-xl shadow-sm overflow-hidden h-full flex flex-col mb-6 relative"
                style={calcWidthMode==='fixed' ? { width: calcCustomWidth, maxWidth:'100%' } : { width:'100%' }}
              >
                <div className="p-4 border-b border-gray-200 flex justify-between items-center sticky top-0 z-10 bg-white">
                <h2 className="font-semibold text-lg">Работы и материалы</h2>
                <div className="flex gap-2 items-center flex-wrap">
                  <button onClick={openAddBlockModal} className="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors">
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Добавить</span>
                  </button>
                  <button onClick={createBlocksFromAllBundles} disabled={bulkLoading} className="bg-white border border-primary-300 text-primary-600 hover:bg-primary-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors disabled:opacity-60">
                    <span className="material-symbols-outlined text-sm">playlist_add</span>
                    <span>{bulkLoading? 'Загружаю...' : 'Импорт всех связок'}</span>
                  </button>
                  <label className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors cursor-pointer">
                    <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e)=>{
                      const file = e.target.files && e.target.files[0];
                      if (!file) return;
                      setLinksUploading(true);
                      try {
                        const fd = new FormData();
                        fd.append('file', file);
                        const r = await fetch('/api/admin/import-work-materials', { method: 'POST', body: fd });
                        const j = await r.json().catch(()=>({}));
                        if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP '+r.status));
                        alert(`Импорт связей: добавлено ${j.inserted||0}, обновлено ${j.updated||0}, пропущено ${j.skipped||0}.`);
                      } catch (err) {
                        alert('Ошибка импорта связей: '+(err.message||err));
                      } finally {
                        setLinksUploading(false);
                        e.target.value='';
                      }
                    }} />
                    <span className="material-symbols-outlined text-sm">{linksUploading ? 'hourglass' : 'upload_file'}</span>
                    <span>{linksUploading ? 'Импорт…' : 'Импорт связей'}</span>
                  </label>
                  <button
                    className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    title="Экспорт связей работа-материал"
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        const r = await fetch('/api/admin/export-work-materials');
                        if (!r.ok) throw new Error('HTTP '+r.status);
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'work_materials_export.csv';
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(()=> URL.revokeObjectURL(url), 2000);
                      } catch (err) { alert('Ошибка экспорта связей: '+(err.message||err)); }
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">link</span>
                    <span>Экспорт связей</span>
                  </button>
                  <button
                    className="bg-white text-red-700 border border-red-200 hover:bg-red-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    title="Удалить все связи работа-материал"
                    onClick={async (e) => {
                      e.preventDefault();
                      if (!confirm('Удалить все связи работа-материал? Сами справочники работ и материалов останутся.')) return;
                      try {
                        const r = await fetch('/api/admin/clear-work-materials', { method: 'POST' });
                        const j = await r.json().catch(()=>({}));
                        if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP '+r.status));
                        // Очистим локальное состояние сметы и снимок, чтобы UI не показывал старые данные
                        setCalcBlocks([]);
                        setCalcVisibleBlocks(CALC_PAGE_BLOCKS);
                        await clearEstimateSnapshot();
                        // Попробуем получить свежие счётчики для подтверждения
                        try {
                          const rc = await fetch('/api/debug-counts');
                          const jc = await rc.json().catch(()=>({}));
                          if (rc.ok && !jc.error) {
                            alert(`Связи очищены (до: ${j.before ?? '—'}, после: ${j.after ?? '0'}).\nСейчас в БД: work_materials=${jc.work_materials}`);
                          } else {
                            alert('Связи очищены. Можно импортировать новые.');
                          }
                        } catch {
                          alert('Связи очищены. Можно импортировать новые.');
                        }
                      } catch (err) {
                        alert('Ошибка очистки связей: '+(err.message||err));
                      }
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">link_off</span>
                    <span>Очистить связи</span>
                  </button>
                  <div className="flex items-center text-xs text-gray-500 ml-2">
                    {LIVE_CALC_NO_SNAPSHOT ? (
                      <span className="flex items-center gap-1 text-blue-600"><span className="material-symbols-outlined text-base">visibility</span> Живой режим норм</span>
                    ) : estimateSaving ? (
                      <span className="flex items-center gap-1"><span className="material-symbols-outlined animate-spin-slow text-base">progress_activity</span> Сохраняю…</span>
                    ) : estimateSavedAt ? (
                      <span className="flex items-center gap-1 text-green-600"><span className="material-symbols-outlined text-base">check_circle</span> Сохранено {estimateSavedAt.toLocaleTimeString()}</span>
                    ) : (
                      <span className="flex items-center gap-1 opacity-70"><span className="material-symbols-outlined text-base">info</span> Нет изменений</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pl-2 ml-2 border-l border-gray-200">
                    <button
                      type="button"
                      onClick={()=> setCalcWidthMode(m=> m==='auto' ? 'fixed' : 'auto')}
                      className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-2 py-1 rounded text-xs flex items-center gap-1"
                      title="Переключить режим ширины таблицы"
                    >
                      <span className="material-symbols-outlined text-base">width</span>
                      <span>{calcWidthMode==='auto'? 'Авто' : 'Фикс'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={()=> setShowWidthPanel(p=> !p)}
                      className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-2 py-1 rounded text-xs flex items-center gap-1"
                      title="Ручная настройка ширин колонок"
                    >
                      <span className="material-symbols-outlined text-base">tune</span>
                      <span>Ширины</span>
                    </button>
                    <button
                      type="button"
                      onClick={()=> setExcelGrid(v=> !v)}
                      className={"bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-2 py-1 rounded text-xs flex items-center gap-1 "+(excelGrid? 'bg-green-50 border-green-400':'')}
                      title="Excel сетка (границы)"
                    >
                      <span className="material-symbols-outlined text-base">grid_on</span>
                      <span>Excel</span>
                    </button>
                    {calcWidthMode==='fixed' && (
                      <div className="flex items-center gap-1 text-xs">
                        <input
                          type="number"
                          value={calcCustomWidth}
                          onChange={(e)=> { const v = parseInt(e.target.value,10); if(!isNaN(v)) setCalcCustomWidth(Math.min(2400, Math.max(600, v))); }}
                          className="w-20 bg-white border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          title="Ширина контейнера, px"
                        />
                        <span>px</span>
                      </div>
                    )}
                  </div>
                </div>
                </div>
                {showWidthPanel && (
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-600">Ширины колонок (px)</span>
                      <div className="flex gap-2 items-center">
                        <button
                          type="button"
                          className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                          onClick={()=> setColWidthOverrides({})}
                          title="Сбросить все ручные ширины"
                        >Сброс</button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                          onClick={()=> setShowWidthPanel(false)}
                        >Закрыть</button>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-5 sm:grid-cols-3 grid-cols-2 gap-3">
                      {['idx','name','image','unit','qty','unitPrice','cpu','mats','labor','actions'].map(key => {
                        const labels = { idx:'№', name:'Наименование', image:'Изобр.', unit:'Ед.', qty:'Кол-во', unitPrice:'Цена ед.', cpu:'CPU', mats:'Мат-лы', labor:'Труд', actions:'Действия' };
                        const val = colWidthOverrides[key] ?? (calcHeaderWidths?.[key] || 0);
                        return (
                          <label key={key} className="flex flex-col gap-1">
                            <span className="text-[11px] text-gray-600 flex justify-between"><span>{labels[key]}</span><span>{val || '—'}</span></span>
                            <input
                              type="range"
                              min={Math.max(20, Math.min( (calcHeaderWidths?.[key]||20) - 40, 20 ))}
                              max={Math.max( (calcHeaderWidths?.[key]||200) + 600, 200 )}
                              value={val || (calcHeaderWidths?.[key]||0)}
                              onChange={(e)=> {
                                const v = parseInt(e.target.value,10);
                                setColWidthOverrides(prev => ({...prev, [key]: v}));
                              }}
                              className="w-full"
                            />
                            <input
                              type="number"
                              className="w-full border border-gray-300 rounded px-1 py-0.5 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                              value={val || ''}
                              placeholder={(calcHeaderWidths?.[key]||'')+''}
                              onChange={(e)=> {
                                const raw = e.target.value.trim();
                                if (!raw) { setColWidthOverrides(prev => { const n={...prev}; delete n[key]; return n; }); return; }
                                const v = parseInt(raw,10); if(isNaN(v)) return;
                                setColWidthOverrides(prev => ({...prev, [key]: v}));
                              }}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className={"flex-1 min-h-0 overflow-auto "+(excelGrid? 'app-excel-grid':'')} style={calcMaxHeight ? { maxHeight: calcMaxHeight } : undefined}>
                  <div className="overflow-x-auto overflow-y-visible h-full">
  <table
    className={"calc-table "+(effectiveCalcWidths?.__total? 'is-frozen-width':'')}
    style={{
      tableLayout: 'fixed',
      minWidth: (effectiveCalcWidths?.__total || (calcColWidths.nameMin + 520)),
      width: effectiveCalcWidths?.__total || undefined
    }}
  >
                  <colgroup>
                    {/* Используем финальные (обогащённые) calcHeaderWidths */}
                    <col className="col-idx" style={effectiveCalcWidths? { width: effectiveCalcWidths.idx } : undefined} />
                    <col className="col-name" style={effectiveCalcWidths? { width: effectiveCalcWidths.name } : { minWidth: calcColWidths.nameMin }} />
                    <col className="col-image" style={effectiveCalcWidths? { width: effectiveCalcWidths.image } : undefined} />
                    <col className="col-unit" style={effectiveCalcWidths? { width: effectiveCalcWidths.unit } : undefined} />
                    <col className="col-qty" style={effectiveCalcWidths? { width: effectiveCalcWidths.qty } : undefined} />
                    <col className="col-unitprice" style={effectiveCalcWidths? { width: effectiveCalcWidths.unitPrice } : undefined} />
                    <col className="col-cpu" style={effectiveCalcWidths? { width: effectiveCalcWidths.cpu } : undefined} />
                    <col className="col-mats" style={effectiveCalcWidths? { width: effectiveCalcWidths.mats } : undefined} />
                    <col className="col-labor" style={effectiveCalcWidths? { width: effectiveCalcWidths.labor } : undefined} />
                    <col className="col-actions" style={effectiveCalcWidths? { width: effectiveCalcWidths.actions } : undefined} />
                  </colgroup>
                  <thead ref={calcTheadRef} className="bg-gray-50 text-left sticky-thead">
                    <tr>
                      {['idx','name','image','unit','qty','unitPrice','cpu','mats','labor','actions'].map(key => {
                        const labels = { idx:'№', name:'Наименование работ', image:'Изображение', unit:'Ед. изм.', qty:'Кол-во', unitPrice:'На единицу', cpu:'Норматив (CPU)', mats:'Материалы', labor:'Оплата труда', actions:'Действия' };
                        return (
                          <th key={key} role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm">
                            <span ref={assignHeaderRef(key)} style={{display:'inline-block',maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{labels[key]}</span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <VirtualizedTBody
                    rows={calcRows}
                    colCount={10}
                    overscan={overscanDefaults.calc}
                    getRowKey={(row) => row.key}
                    estimateSize={(row) => {
                      if (row.kind === 'empty') return 60;
                      if (row.kind === 'stage-header' || row.kind === 'sub-header') return 36;
                      if (row.kind === 'loader') return 52;
                      if (row.kind === 'block') {
                        const m = row.block.materials?.length || 0;
                        return calcRowHeights.work + m*calcRowHeights.material + calcRowHeights.total;
                      }
                      return 44;
                    }}
                    renderRow={(row, i, { measureRef, ariaRowIndex }) => {
                      if (row.kind === 'empty') {
                        return (
                          <tr ref={measureRef} key="empty" role="row" aria-rowindex={ariaRowIndex}>
                            <td role="cell" colSpan={9} className="px-4 py-6 text-center text-sm text-gray-400">Нет блоков. Нажмите «Добавить».</td>
                          </tr>
                        );
                      }
                      if (row.kind === 'loader') {
                        return (
                          <EndSentinel key={row.key} onReachEnd={requestMoreCalc} colSpan={9} label={'Загрузить ещё'} />
                        );
                      }
                      if (row.kind === 'stage-header') {
                        return (
                          <tr ref={measureRef} key={row.key} className="bg-primary-50 font-bold text-gray-700" role="row" aria-rowindex={ariaRowIndex}>
                            <td role="cell" className="px-2 py-2 text-gray-800">{row.stId}</td>
                            <td role="cell" className="px-2 py-2 text-gray-800" colSpan={9}>{row.title}</td>
                          </tr>
                        );
                      }
                      if (row.kind === 'sub-header') {
                        return (
                          <tr ref={measureRef} key={row.key} className="bg-purple-50 font-semibold text-gray-700" role="row" aria-rowindex={ariaRowIndex}>
                            <td role="cell" className="px-2 py-2 text-gray-800">{row.ssId}</td>
                            <td role="cell" className="px-2 py-2 text-gray-800" colSpan={9}>{row.title}</td>
                          </tr>
                        );
                      }
                      if (row.kind === 'block') {
                        const wb = row.block;
                        const workQty = toNum(wb.work.quantity);
                        const workSum = workQty * toNum(wb.work.unit_price);
                        const matsTotal = (wb.materials||[]).reduce((s,m)=> {
                          // Кол-во материала = Норматив (CPU) × Кол-во работ
                          const cpu = (m?.cpu != null ? toNum(m.cpu) : toNum(m.quantity));
                          const effQty = workQty * cpu;
                          const roundedQty = Math.ceil(effQty);
                          // Суммы считаем по округленному количеству
                          return s + (roundedQty * toNum(m.unit_price));
                        },0);
                        const onUpd = (fn) => updateBlock(wb.id, fn);
                        const onRemove = async () => {
                          // При удалении блока чистим только те связи работа↔материал, которые присутствуют в этом блоке
                          const workId = wb?.work?.code;
                          try {
                            if (workId) {
                              const codes = Array.from(new Set((wb.materials || []).map(m => m && m.code).filter(Boolean)));
                              if (codes.length) {
                                const dels = codes.map(mid => fetch(`/api/work-materials/${encodeURIComponent(workId)}/${encodeURIComponent(mid)}`, { method: 'DELETE' }).catch(()=>{}));
                                await Promise.allSettled(dels);
                              }
                            }
                          } catch (e) {
                            // Логируем, но продолжаем удаление блока из UI
                            console.warn('Ошибка удаления связей для материалов блока', workId, e?.message || e);
                          }
                          // Удаляем блок из локального состояния
                          suppressNextAutosave.current = true;
                          const next = calcBlocks.filter(b => b.id !== wb.id);
                          setCalcBlocks(next);
                          if (!LIVE_CALC_NO_SNAPSHOT) {
                            try { await saveEstimateSnapshot(next); } catch { /* ignore snapshot error */ }
                          }
                        };
                        return (
                          <React.Fragment key={row.key}>
                            <tr role="row" aria-rowindex={ariaRowIndex}>
                              <td role="cell" className="px-2 py-2 text-gray-800 whitespace-nowrap">
                                <div className="calc-col calc-col-code flex items-start gap-1">
                                <button
                                  type="button"
                                  onClick={()=> toggleBlockMaterials(wb.id)}
                                  className="inline-flex items-center text-primary-600 hover:text-primary-700 mr-1"
                                  title={collapsedCalc[wb.id] ? 'Показать материалы' : 'Скрыть материалы'}
                                >
                                  <span className="material-symbols-outlined text-base align-middle">
                                    {collapsedCalc[wb.id] ? 'chevron_right' : 'expand_more'}
                                  </span>
                                </button>
                                  <span className="code-text">{wb.work.code}</span>
                                </div>
                              </td>
                              <td role="cell" className="px-2 py-2 text-gray-800" style={{ verticalAlign: 'top' }}>
                                <div className="calc-col calc-col-workname">
                                <textarea
                                  rows={1}
                                  value={wb.work.name}
                                  placeholder="Наименование работы"
                                  onChange={(e)=> onUpd(b=> ({...b, work:{...b.work, name:e.target.value}}))}
                                  onInput={(e)=> { const el=e.currentTarget; el.style.height='auto'; el.style.height = el.scrollHeight + 'px'; }}
                                  ref={(el)=> { if (el) { el.style.height='auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                  className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm resize-none"
                                  style={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowY: 'hidden', resize: 'none' }}
                                />
                                </div>
                              </td>
                              <td role="cell" className="px-2 py-2"><div className="calc-col calc-col-image"/></td>
                              <td role="cell" className="px-2 py-2 text-gray-800">
                                <div className="calc-col calc-col-unit">
                                  <input
                                    value={wb.work.unit}
                                    placeholder="ед"
                                    onChange={(e)=> onUpd(o=>({...o, work:{...o.work, unit:e.target.value}}))}
                                    style={{ width: calcCellInputWidths.work.unit }}
                                    className="bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
                                  />
                                </div>
                              </td>
                              <td role="cell" className="px-2 py-2 text-gray-800">
                                <div className="calc-col calc-col-workqty">
                                  <input
                                    value={wb.work.quantity||''}
                                    placeholder="0,00"
                                    onFocus={()=> setEditingWorkQtyBlockId(wb.id)}
                                    onChange={(e)=> {
                                      const raw = e.target.value;
                                      const cleaned = raw.replace(/[^0-9,\.]/g,'').replace('.',',');
                                      onUpd(o=>({...o, work:{...o.work, quantity: cleaned}}));
                                    }}
                                    onBlur={(e)=>{
                                      const norm = normalizeDecimalInput(e.target.value,2);
                                      onUpd(o=>({...o, work:{...o.work, quantity: norm}}));
                                      setEditingWorkQtyBlockId(id=> id===wb.id? null : id);
                                    }}
                                    onKeyDown={(e)=>{
                                      if(e.key==='Enter') { e.preventDefault(); e.currentTarget.blur(); }
                                      else if(e.key==='Escape') { e.preventDefault(); setEditingWorkQtyBlockId(null); e.currentTarget.blur(); }
                                    }}
                                    style={{ width: calcCellInputWidths.work.quantity, textAlign:'left' }}
                                    className="bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
                                  />
                                </div>
                              </td>
                              <td role="cell" className="px-2 py-2 text-gray-800">
                                <div className="calc-col calc-col-workprice">
                                  <input
                                    value={wb.work.unit_price}
                                    placeholder="0"
                                    onChange={(e)=> onUpd(o=>({...o, work:{...o.work, unit_price: normalizeDecimalInput(e.target.value,1)}}))}
                                    style={{ width: calcCellInputWidths.work.unit_price, textAlign:'left' }}
                                    className="bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
                                  />
                                </div>
                              </td>
                              <td role="cell" className="px-2 py-2 text-gray-800">
                                <div className="calc-col calc-col-mats-sum text-left">
                                  {collapsedCalc[wb.id] ? (matsTotal? formatDec2(matsTotal): '—') : '—'}
                                </div>
                              </td>
                              <td role="cell" className="px-2 py-2 font-semibold text-left text-gray-800">
                                <div className="calc-col calc-col-work-sum">{workSum ? formatDec2(workSum) : '—'}</div>
                              </td>
                              <td role="cell" className="px-2 py-2">
                                <div className="calc-col calc-col-actions" />
                              </td>
                            </tr>
                            {!collapsedCalc[wb.id] && (wb.materials||[]).map((m, mi) => {
                              const cpuVal = (m?.cpu != null ? toNum(m.cpu) : toNum(m.quantity));
                              const effQty = toNum(wb.work.quantity) * cpuVal; // Кол-во = CPU × Кол-во работ
                              const roundedQty = Math.round(effQty * 100)/100; // округляем до сотых
                              const matSum = roundedQty * toNum(m.unit_price);
                              // ref to control palette open (use createRef to avoid hooks-in-loop)
                              const matAutoRef = React.createRef();
                              const isInsertAfter = addMatInline && addMatInline.blockId===wb.id && addMatInline.afterIndex===mi;
                              return (
                                <React.Fragment key={row.key+':mfrag:'+mi}>
                                <tr role="row" aria-rowindex={ariaRowIndex+1+mi}>
                                  <td role="cell" className="px-2 py-2 text-gray-800 whitespace-nowrap">
                                    <div className="calc-col calc-col-m-actions flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1"
                                      title="Заменить материал"
                                      onClick={()=> matAutoRef.current?.openPalette('')}
                                    >
                                      <span className="material-symbols-outlined text-base align-middle">swap_horiz</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 ml-1"
                                      title="Добавить материал ниже"
                                      onClick={()=> startAddMaterialBelow(wb.id, mi)}
                                    >
                                      <span className="material-symbols-outlined text-base align-middle">add</span>
                                    </button>
                                    </div>
                                  </td>
                                  <td role="cell" className="px-2 py-2 text-gray-800" style={{ verticalAlign: 'bottom' }}>
                                    <div className="calc-col calc-col-m-name">
                                    <MaterialAutocomplete
                                      ref={matAutoRef}
                                      value={{ id: m.code, name: m.name }}
                                      currentId={m.code}
                                      onSelect={async (mat)=>{
                                        // Атомарно сформируем следующее состояние блоков и сохраним тот же снимок
                                        const prevBlocks = calcBlocks;
                                        const nextBlocks = prevBlocks.map(bb => {
                                          if (bb.id !== wb.id) return bb;
                                          const ms = [...(bb.materials||[])];
                                          ms[mi] = {
                                            ...ms[mi],
                                            code: mat.id,
                                            name: mat.name,
                                            unit: mat.unit || '',
                                            unit_price: mat.unit_price!=null? String(mat.unit_price):'',
                                            image_url: mat.image || '',
                                            sku: mat.sku || mat.id
                                          };
                                          return { ...bb, materials: ms };
                                        });
                                        // Доп. защита от внезапных дублей
                                        const seen = new Set();
                                        const deduped = nextBlocks.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));
                                        // Подавим ближайший автосейв — выполняем явное сохранение ниже
                                        suppressNextAutosave.current = true;
                                        setCalcBlocks(deduped);
                                        // Обновим нормативную связь в БД (work_materials): перезапишем всю строку
                                        // 1) считаем старые cpu/wc из БД (если были), чтобы не потерять коэффициент
                                        // 2) если id материала изменился — удалим старую пару
                                        // 3) всегда upsert новой пары с полями consumption_per_work_unit и waste_coeff
                                        try {
                                          const workId = wb?.work?.code;
                                          const oldMatId = m?.code || null;
                                          const newMatId = mat?.id;
                                          if (workId && newMatId) {
                                            // Получим старые значения cpu/wc
                                            let oldCpu = null;
                                            let oldWc = 1;
                                            try {
                                              const r0 = await fetch(`/api/work-materials/${encodeURIComponent(workId)}`);
                                              if (r0.ok) {
                                                const j0 = await r0.json().catch(()=>({}));
                                                const arr = Array.isArray(j0?.items) ? j0.items : [];
                                                const found = oldMatId ? arr.find(it => it.material_id === oldMatId) : null;
                                                if (found) {
                                                  if (found.consumption_per_work_unit != null) oldCpu = Number(found.consumption_per_work_unit);
                                                  if (found.waste_coeff != null) oldWc = Number(found.waste_coeff) || 1;
                                                }
                                              }
                                            } catch { /* ignore fetch of old cpu/wc */ }
                                            // Возьмём расход из текущей строки (если есть), иначе из старой связи; коэффициент отходов — из старой связи (или 1)
                                            const uiCpu = (m && m.quantity != null && m.quantity !== '') ? Number(String(m.quantity).replace(/\s+/g,'').replace(/,/g,'.')) : null;
                                            const cpu = (uiCpu!=null && !Number.isNaN(uiCpu)) ? uiCpu : (oldCpu!=null && !Number.isNaN(oldCpu) ? oldCpu : null);
                                            const wc = (oldWc!=null && !Number.isNaN(oldWc)) ? oldWc : 1;
                                            // Атомарная замена на сервере
                                            const upR = await fetch('/api/work-materials/replace', {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ work_id: workId, old_material_id: oldMatId, new_material_id: newMatId, consumption_per_work_unit: cpu, waste_coeff: wc })
                                            });
                                            if (!upR.ok) {
                                              let msg = 'HTTP ' + upR.status;
                                              try { const j = await upR.json(); if (j && j.error) msg = j.error; } catch { /* ignore json parse */ }
                                              console.warn('POST work-materials failed:', msg);
                                              alert('Не удалось обновить нормативную связь: ' + msg);
                                            } else {
                                              try {
                                                const j = await upR.json();
                                                if (!j?.row) {
                                                  console.warn('work-materials replace responded without row; server could not confirm insert');
                                                } else {
                                                  console.log('work-materials replace ok:', j.row);
                                                }
                                              } catch { console.log('work-materials upsert ok'); }
                                            }
                                          }
                                        } catch (e) {
                                          // Не блокируем сохранение сметы из‑за ошибки обновления нормативов
                                          console.warn('Не удалось обновить нормативную связь work-materials:', e?.message || e);
                                          alert('Ошибка обновления связи работа-материал: ' + (e?.message || e));
                                        }
                                        if (!LIVE_CALC_NO_SNAPSHOT) {
                                          try { await saveEstimateSnapshot(deduped); }
                                          catch (e) { setCalcBlocks(prevBlocks); alert('Не удалось применить материал: '+(e.message||e)); }
                                        }
                                      }}
                                    />
                                    </div>
                                  </td>
                                  <td role="cell" className="px-2 py-2">
                                    <div className="calc-col calc-col-m-image">
                                      {m.image_url ? (
                                        <div style={{ width: (previewSizes.calcMaterial?.w||36), height:(previewSizes.calcMaterial?.h||36), minWidth:(previewSizes.calcMaterial?.w||36), minHeight:(previewSizes.calcMaterial?.h||36), overflow:'hidden', borderRadius:4, border:'1px solid #e2e8f0', background:'#fafafa', display:'flex', alignItems:'center', justifyContent:'center' }}>
                                          <img src={m.image_url} alt="img" style={getPreviewStyle('calcMaterial')} onError={(e)=>{e.currentTarget.style.display='none';}} />
                                        </div>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td role="cell" className="px-2 py-2 text-gray-800">
                                    <div className="calc-col calc-col-m-unit">
                                    <input
                                      value={m.unit}
                                      placeholder="ед"
                                      onChange={(e)=> onUpd(o=>{ const ms=[...o.materials]; ms[mi]={...ms[mi], unit:e.target.value}; return {...o, materials:ms}; })}
                                      style={{ width: calcCellInputWidths.material.unit }}
                                      className="bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
                                    />
                                    </div>
                                  </td>
                                  <td role="cell" className="px-2 py-2 text-gray-800 text-right">
                                    <div className="calc-col calc-col-m-effqty text-left">{roundedQty ? formatDec2(roundedQty) : '—'}</div>
                                  </td>
                                  <td role="cell" className="px-2 py-2 text-gray-800">
                                    <div className="calc-col calc-col-m-unitprice">
                                    <input
                                      value={m.unit_price}
                                      placeholder="0"
                                      onChange={(e)=> onUpd(o=>{ const ms=[...o.materials]; ms[mi]={...ms[mi], unit_price: normalizeDecimalInput(e.target.value,1)}; return {...o, materials:ms}; })}
                                      style={{ width: calcCellInputWidths.material.unit_price, textAlign:'left' }}
                                      className="bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
                                    />
                                    </div>
                                  </td>
                                  {/* Норматив (CPU) — редактируемый, сохраняется как consumption_per_work_unit */}
                                  <td role="cell" className="px-2 py-2 text-gray-800">
                                    <div className="calc-col calc-col-m-cpu">
                                    <input
                                      value={m.quantity}
                                      placeholder="0"
                                      onChange={(e)=> onUpd(o=>{ const v = normalizeDecimalInput(e.target.value,1); const ms=[...o.materials]; ms[mi]={...ms[mi], quantity:v, cpu: (v===''? null : Number(v.replace(',','.'))) }; return {...o, materials:ms}; })}
                                      onBlur={async (e)=>{
                                        try {
                                          const workId = wb?.work?.code;
                                          const matId = m?.code;
                                          if (!workId || !matId) return;
                                          const v = e.currentTarget.value;
                                          const cpu = (v===''||v==null) ? null : Number(String(v).replace(/\s+/g,'').replace(/,/g,'.'));
                                          const wc = (m && m.wc != null) ? m.wc : 1;
                                          await fetch('/api/work-materials', {
                                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ work_id: workId, material_id: matId, consumption_per_work_unit: cpu, waste_coeff: wc })
                                          });
                                        } catch { /* ignore upsert error */ }
                                      }}
                                      style={{ width: calcCellInputWidths.material.cpu, textAlign:'left' }}
                                      className="bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
                                    />
                                    </div>
                                  </td>
                                  <td role="cell" className="px-2 py-2 text-gray-800"><div className="calc-col calc-col-m-sum text-left">{matSum? formatDec2(matSum): '—'}</div></td>
                                  <td role="cell" className="px-2 py-2 text-gray-800"><div className="calc-col calc-col-m-labor">—</div></td>
                                  <td role="cell" className="px-2 py-2 text-right">
                                    <div className="calc-col calc-col-m-row-actions">
                                    {wb.materials.length>1 && (
                                      <button
                                        onClick={async ()=>{
                                          // Удаление строки материала: чистим локально, синхронно удаляем связь в БД и сохраняем снимок
                                          const workId = wb?.work?.code;
                                          const matId = m?.code;
                                          const prev = calcBlocks;
                                          const next = prev.map(bb => {
                                            if (bb.id !== wb.id) return bb;
                                            return { ...bb, materials: bb.materials.filter((_, j) => j !== mi) };
                                          });
                                          // Подавим ближайший автосейв – сделаем явное сохранение ниже
                                          suppressNextAutosave.current = true;
                                          setCalcBlocks(next);
                                          // Удалим нормативную связь, если была выбрана (matId может быть пустым у новых строк)
                                          try {
                                            if (workId && matId) {
                                              const rDel = await fetch(`/api/work-materials/${encodeURIComponent(workId)}/${encodeURIComponent(matId)}`, { method: 'DELETE' });
                                              if (!rDel.ok) {
                                                try { const jj = await rDel.json(); console.warn('DELETE work-materials failed:', jj?.error || rDel.status); }
                                                catch { console.warn('DELETE work-materials failed: HTTP', rDel.status); }
                                              }
                                            }
                                          } catch (e) {
                                            console.warn('Ошибка удаления связи работа-материал:', e?.message || e);
                                          }
                                          // Сохраняем снимок только если режим слепка
                                          if (!LIVE_CALC_NO_SNAPSHOT) { try { await saveEstimateSnapshot(next); } catch { /* ignore snapshot error */ } }
                                        }}
                                        className="text-red-600 hover:text-red-700 p-1"
                                        title="Удалить"
                                        aria-label="Удалить"
                                      >
                                        <span className="material-symbols-outlined text-base align-middle">delete</span>
                                      </button>
                                    )}
                                    </div>
                                  </td>
                                </tr>
                                {isInsertAfter && (
                                  <tr className="bg-green-50" role="row">
                                    <td role="cell" className="px-2 py-2"><div className="calc-col calc-col-insert-spacer"/></td>
                                    <td role="cell" colSpan={2} className="px-2 py-2">
                                      <div className="calc-col calc-col-insert-autocomplete">
                                        <MaterialAutocomplete
                                          value={null}
                                          onSelect={(mat)=> handleSelectNewMaterial(wb.id, mi, mat)}
                                        />
                                      </div>
                                    </td>
                                    <td role="cell" className="px-2 py-2" colSpan={5}>
                                      <div className="calc-col calc-col-insert-hint flex items-center gap-2 text-xs text-gray-600">
                                        <span>Выберите материал для вставки</span>
                                        <button onClick={cancelAddMaterialInline} className="text-gray-500 hover:text-gray-700" type="button">Отмена</button>
                                      </div>
                                    </td>
                                    <td role="cell" className="px-2 py-2" colSpan={2}><div className="calc-col calc-col-insert-tail"/></td>
                                  </tr>
                                )}
                                </React.Fragment>
                              );
                            })}
                            {!collapsedCalc[wb.id] && (
                              <tr className="bg-gray-50 font-semibold" role="row" aria-rowindex={ariaRowIndex + 1 + (wb.materials?.length || 0)} style={{ height: calcRowHeights.total }}>
                                <td role="cell" className="px-2 py-2 text-gray-800" colSpan={7}><div className="calc-col calc-col-total-label">ИТОГО ПО ГРУППЕ:</div></td>
                                <td role="cell" className="px-2 py-2 text-gray-800"><div className="calc-col calc-col-total-mats text-left">{matsTotal? formatDec2(matsTotal): '—'}</div></td>
                                <td role="cell" className="px-2 py-2 text-primary-700"><div className="calc-col calc-col-total-work text-left">{workSum? formatDec2(workSum): '—'}</div></td>
                                <td role="cell" className="px-2 py-2 text-right">
                                  <div className="calc-col calc-col-total-actions">
                                    <button onClick={onRemove} className="text-red-600 hover:text-red-700 p-1" title="Удалить блок" aria-label="Удалить блок">
                                      <span className="material-symbols-outlined text-base align-middle">delete</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      }
                      return null;
                    }}
                  />
                </table>
                  </div>
                  {calcWidthMode==='fixed' && (
                    <div
                      onMouseDown={startCalcWidthResize}
                      title="Потяните чтобы изменить ширину блока"
                      style={{ position:'absolute', top:0, right:0, width:6, cursor:'col-resize', height:'100%', zIndex:30, background:'transparent' }}
                    />
                  )}
                </div>
              </div>
            </div>
            {/* Modal: add calc block */}
            <FloatingWindow
              open={addBlockModal}
              onClose={()=> setAddBlockModal(false)}
              title="Новый блок работ"
              width={880}
              center
              overlay
              persistKey="add-calc-block-modal"
              footer={<>
                <button onClick={()=> setAddBlockModal(false)} className="px-4 py-2 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50" disabled={creatingBlock}>Отмена</button>
                <button onClick={createCalcBlock} disabled={creatingBlock} className="px-4 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-default flex items-center gap-2">{creatingBlock && <span className="material-symbols-outlined animate-spin-slow text-base">progress_activity</span>}<span>{creatingBlock? 'Добавляю...' : 'Создать'}</span></button>
              </>}
            >
              <div className="fw-form">
                <div className="fw-block">
                  <div className="fw-block-title">Выбор работы</div>
                  <div className="space-y-3">
                    <div className="fw-grid">
                      <div className="fw-field fw-col-span-3">
                        <label className="fw-label">Работа (код или часть названия)</label>
                        <div className="fw-input-wrap relative">
                          <input
                            className="fw-input"
                            placeholder="Например: 12-05 или Демонтаж"
                            value={addBlockForm.work_input}
                            onChange={e=> {
                              const v = e.target.value;
                              setAddBlockForm(f=> ({...f, work_input:v, resolvedWork: null}));
                              setAddBlockError('');
                              if (workSuggestTimer.current) clearTimeout(workSuggestTimer.current);
                              if (v.trim().length < 2) { setWorkSuggestions([]); return; }
                              workSuggestTimer.current = setTimeout(async () => {
                                setWorkSearchLoading(true);
                                try {
                                  const data = await fetch(`/api/works-rows?q=${encodeURIComponent(v.trim())}`).then(r=> r.json());
                                  const items = Array.isArray(data)? data: (data.items||[]);
                                  const onlyWorks = items.filter(it => it.type==='item').slice(0,20).map(it => ({ id:it.code, name:it.name, unit:it.unit, unit_price:it.price }));
                                  setWorkSuggestions(onlyWorks);
                                  setWorkSuggestIndex(onlyWorks.length?0:-1);
                                  // auto-resolve if exact code match
                                  const exact = onlyWorks.find(w => w.id.toLowerCase() === v.trim().toLowerCase());
                                  if (exact) setAddBlockForm(f=> ({...f, resolvedWork: exact, work_input: `${exact.id} — ${exact.name}`}));
                                } catch { setWorkSuggestions([]); /* ignore search error */ } finally { setWorkSearchLoading(false); }
                              }, 300);
                            }}
                            onKeyDown={(e)=> {
                              if (!workSuggestions.length) return;
                              if (e.key==='ArrowDown') { e.preventDefault(); setWorkSuggestIndex(i=> (i+1)%workSuggestions.length); }
                              else if (e.key==='ArrowUp') { e.preventDefault(); setWorkSuggestIndex(i=> (i<=0? workSuggestions.length-1 : i-1)); }
                              else if (e.key==='Enter') {
                                if (workSuggestIndex>=0 && workSuggestIndex<workSuggestions.length) {
                                  const w = workSuggestions[workSuggestIndex];
                                  setAddBlockForm(f=> ({...f, resolvedWork:w, work_input:`${w.id} — ${w.name}`}));
                                  setWorkSuggestions([]);
                                  setWorkSuggestIndex(-1);
                                }
                              } else if (e.key==='Escape') { setWorkSuggestions([]); setWorkSuggestIndex(-1); }
                            }}
                            onBlur={() => {
                              // если пользователь ушёл и нет resolvedWork — не сбрасываем сразу, просто оставляем ввод
                            }}
                          />
                          {workSearchLoading && <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">поиск…</div>}
                          {(!addBlockForm.resolvedWork) && (
                            <div
                              ref={suggestionListRef}
                              className="absolute top-full left-0 right-0 mt-1 rounded-lg max-h-80 overflow-auto z-50"
                              style={{ background:'rgba(255,255,255,0.92)', backdropFilter:'blur(4px)', boxSizing:'border-box' }}
                            >
                              {workSuggestions.length === 0 && addBlockForm.work_input.trim().length >= 2 && (
                                <div className="fw-suggest-empty">Ничего не найдено</div>
                              )}
                              {workSuggestions.map((w, i) => {
                                const q = (addBlockForm.work_input||'').trim().toLowerCase();
                                const highlight = (txt) => {
                                  if (!q || q.length<2) return txt;
                                  const idx = txt.toLowerCase().indexOf(q);
                                  if (idx===-1) return txt;
                                  return (<>{txt.slice(0,idx)}<span className="bg-yellow-200 px-0.5 rounded-sm">{txt.slice(idx, idx+q.length)}</span>{txt.slice(idx+q.length)}</>);
                                };
                                return (
                                  <button
                                    key={w.id}
                                    type="button"
                                    data-suggest-row="1"
                                    onMouseEnter={()=> setWorkSuggestIndex(i)}
                                    onClick={()=> {
                                      setAddBlockForm(f=> ({...f, resolvedWork:w, work_input:w.name}));
                                      setWorkSuggestions([]); setWorkSuggestIndex(-1);
                                    }}
                                    className={"fw-suggest-item "+(i===workSuggestIndex? 'is-active':'')}
                                  >
                                    <span className="block text-gray-800">{highlight(w.name)}</span>
                                  </button>
                                );
                              })}
                              {/* Разделители между карточками (визуально одинаковая ширина) */}
                              <style>{`.fw-input-wrap > div[ref='suggestionListRef'] button + button {margin-top:0}`}</style>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {addBlockForm.resolvedWork && (
                      <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 inline-flex items-center gap-2">
                        <span className="material-symbols-outlined text-base">check_circle</span>
                        <span>Выбрана работа: {addBlockForm.resolvedWork.id}</span>
                        <button className="text-green-600 hover:underline" onClick={()=> setAddBlockForm(f=> ({...f, resolvedWork:null, work_input:''}))}>сменить</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="fw-block">
                  <div className="fw-block-title">Материалы (норматив подтянется автоматически)</div>
                  <div className="text-xs text-gray-500">После нажатия «Создать» материалы загрузятся из нормативной связки для выбранной работы. Если их нет — появится пустая строка.</div>
                </div>
                {addBlockError && <div className="fw-error fw-error-inline">{addBlockError}</div>}
              </div>
            </FloatingWindow>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="font-semibold text-lg">Распределение расходов</h2>
                </div>
                <div className="p-6 h-[300px]">
                  {/* Chart component would go here */}
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <span className="material-symbols-outlined text-5xl text-gray-300">donut_large</span>
                      <p className="text-sm text-gray-500 mt-2">Диаграмма распределения затрат</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="font-semibold text-lg">Итоги</h2>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    <div className="flex justify-between pb-2 border-b border-gray-200">
                      <span className="text-gray-600">Материалы</span>
                      <span className="font-medium">31,000 ₽</span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-gray-200">
                      <span className="text-gray-600">Работы</span>
                      <span className="font-medium">186,000 ₽</span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-gray-200">
                      <span className="text-gray-600">Доставка</span>
                      <span className="font-medium">5,000 ₽</span>
                    </div>
                    <div className="flex justify-between pt-2 font-semibold">
                      <span>Итого</span>
                      <span className="text-primary-700">222,000 ₽</span>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col space-y-3">
                    <button className="bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 px-4 rounded-lg shadow hover:shadow-md transition-all duration-300 flex items-center justify-center space-x-2">
                      <span className="material-symbols-outlined">save</span>
                      <span>Сохранить смету</span>
                    </button>
                    <button className="bg-white hover:bg-gray-50 text-gray-800 font-medium py-2 px-4 rounded-lg shadow hover:shadow-md transition-all duration-300 border border-gray-200 flex items-center justify-center space-x-2">
                      <span className="material-symbols-outlined">print</span>
                      <span>Печать</span>
                    </button>
                    <button className="bg-white hover:bg-gray-50 text-gray-800 font-medium py-2 px-4 rounded-lg shadow hover:shadow-md transition-all duration-300 border border-gray-200 flex items-center justify-center space-x-2">
                      <span className="material-symbols-outlined">share</span>
                      <span>Поделиться</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </div>
            ) : active === 'project' ? (
              <CreateProject />
            ) : active === "works" ? (
            <div className="flex-1 min-h-0">
              <div className="bg-white rounded-xl shadow-sm overflow-hidden h-full flex flex-col">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center sticky top-0 z-10 bg-white">
                <h2 className="font-semibold text-lg">Справочник работ</h2>
                <div className="flex gap-2 items-center flex-wrap">
                  <div className="relative">
                    <input
                      type="text"
                      value={worksSearch}
                      onChange={(e) => setWorksSearch(e.target.value)}
                      placeholder="Поиск (код / имя)"
                      className="pl-8 pr-2 py-1 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                      style={{ minWidth: 220 }}
                    />
                    <span className="material-symbols-outlined text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 text-base">search</span>
                    {worksSearch && (
                      <button
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setWorksSearch('')}
                        title="Очистить"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    )}
                  </div>
                  <label className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors cursor-pointer">
                    <input type="file" accept=".csv" className="hidden" disabled={uploading} onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const fd = new FormData();
                      fd.append('file', f);
                      try {
                        setUploading(true);
                        const r = await fetch('/api/admin/import', { method: 'POST', body: fd });
                        const j = await r.json();
                          if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
                          alert(`Импорт завершен: ${j.imported} строк\nПропущено: ${j.skippedRows || 0}\nРаботы: +${j.insertedWorks} / обновлено ${j.updatedWorks}\nФазы: +${j.insertedPhases} / обновлено ${j.updatedPhases}\nРазделы: +${j.insertedStages} / обновлено ${j.updatedStages}\nПодразделы: +${j.insertedSubstages} / обновлено ${j.updatedSubstages}`);
                        // перезагрузка текущей страницы работ
                        try {
              const qParam = worksSearch ? `&q=${encodeURIComponent(worksSearch)}` : '';
              const params = `?page=${worksPage}&limit=${worksPageSize}${qParam}`;
                          const data = await fetchJsonTry([
                            `/api/works-rows${params}`,
                            `http://localhost:4000/api/works-rows${params}`,
                            `http://127.0.0.1:4000/api/works-rows${params}`,
                          ]);
                          if (Array.isArray(data)) {
                setWorks(data); setWorksTotal(data.length);
                          } else {
                setWorks(data.items || []); setWorksTotal(data.total || (data.items?.length || 0));
                          }
                        } catch { /* ignore refresh error */ }
                      } catch (err) {
                        alert('Ошибка импорта: ' + (err.message || err));
                      } finally {
                        setUploading(false);
                        e.target.value = '';
                      }
                    }} />
                    <span className="material-symbols-outlined text-sm">{uploading ? 'hourglass' : 'upload_file'}</span>
                    <span>{uploading ? 'Импорт...' : 'Импорт CSV'}</span>
                  </label>
                  <button
                    className="bg-white text-red-700 border border-red-200 hover:bg-red-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    onClick={async (e) => {
                      e.preventDefault();
                      if (!confirm('Очистить базу данных? Данные будут удалены без возможности восстановления. Схема останется.')) return;
                      try {
                        const r = await fetch('/api/admin/clear', { method: 'POST' });
                        if (!r.ok) throw new Error('HTTP '+r.status);
                        // после очистки просто очищаем локальный список; по желанию можно вызвать повторную загрузку
                        setWorks([]);
                        // триггерим повторную загрузку
                        setTimeout(() => setActive('works'));
                      } catch (e) { alert('Ошибка очистки: '+(e.message || e)); }
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">delete_forever</span>
                    <span>Очистить БД</span>
                  </button>
                  <button
                    className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        const r = await fetch('/api/debug-counts');
                        const j = await r.json();
                        if (!r.ok) throw new Error(j.error || ('HTTP '+r.status));
                        alert(`Фазы: ${j.phases}, Стадии: ${j.stages}, Подстадии: ${j.substages}, Работы: ${j.works_ref}`);
                      } catch (err) { alert('Ошибка: '+(err.message||err)); }
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">insights</span>
                    <span>Проверить данные</span>
                  </button>
                  <button
                    className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        const r = await fetch('/api/admin/export-works-ref');
                        if (!r.ok) throw new Error('HTTP '+r.status);
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'works_ref_export.csv';
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(()=> URL.revokeObjectURL(url), 2000);
                      } catch (err) { alert('Ошибка экспорта: '+(err.message||err)); }
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    <span>Экспорт CSV</span>
                  </button>
                  
                  <button
                    className="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    onClick={(e) => { e.preventDefault(); openAddModal(); }}
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Добавить работу</span>
                  </button>
                </div>
                </div>
              <AddWorkModal
                open={modalOpen}
                onOpenChange={(v) => setModalOpen(v)}
                onSaveSuccess={() => {
                  setTimeout(() => setActive('works'));
                }}
              />
              {/* Confirm delete modal */}
              <FloatingWindow
                open={confirmDel.open}
                onClose={()=>setConfirmDel({ open:false, code:'', name:'' })}
                title="Удалить работу"
                width={420}
                center
                overlay
                footer={
                  <>
                    <button
                      className="px-4 py-2 text-sm rounded bg-white border border-gray-300 hover:bg-gray-50"
                      onClick={()=>setConfirmDel({ open:false, code:'', name:'' })}
                    >Отмена</button>
                    <button
                      className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                      onClick={confirmDelete}
                    >Удалить</button>
                  </>
                }
                persistKey="confirm-del-work"
              >
                <div style={{display:'flex', flexDirection:'column', gap:12}}>
                  <div style={{fontSize:14, lineHeight:'20px'}}>
                    Вы действительно хотите удалить работу <strong>{confirmDel.code}</strong>?
                  </div>
                  {confirmDel.name && (
                    <div style={{fontSize:12, color:'#555'}}>«{confirmDel.name}» будет удалена без возможности восстановления.</div>
                  )}
                </div>
              </FloatingWindow>
              <div className="flex-1 min-h-0 overflow-auto" ref={worksScrollRef} style={worksMaxHeight ? { maxHeight: worksMaxHeight } : undefined}>
                {worksLoading && (<div className="p-4 text-sm text-gray-500">Загрузка…</div>)}
                {worksError && (
                  <div className="p-4 text-sm text-red-600 flex items-center gap-3">
                    <span>{worksError}</span>
                    <button
                      className="px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100"
                      onClick={() => {
                        setWorks([]); // сбросим чтобы триггернуть повторную загрузку
                        setTimeout(() => setActive('works'));
                      }}
                    >Повторить</button>
                  </div>
                )}
                <div className="overflow-x-auto overflow-y-visible">
                <table className="w-full" style={{ tableLayout:'fixed' }}>
                  <colgroup>
                    <col style={{ width: colWidths.code }} />
                    <col style={{ width: colWidths.name }} />
                    <col style={{ width: colWidths.unit }} />
                    <col style={{ width: colWidths.price }} />
                    <col style={{ width: colWidths.action }} />
                  </colgroup>
                  <thead ref={worksTheadRef} className="bg-gray-50 text-left sticky-thead">
                    <tr>
                      <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Код</th>
                      <th role="columnheader" className="py-2 pl-1 pr-2 font-medium text-gray-500 text-sm select-none">Наименование</th>
                      <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Ед.изм.</th>
                      <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Цена руб.</th>
                      <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm text-right"></th>
                    </tr>
                  </thead>
                  <VirtualizedTBody
                    rows={worksRows}
                    colCount={5}
                    overscan={overscanDefaults.refs}
                    estimateSize={(row) => row.kind === 'group' ? 40 : 52}
                    getRowKey={(row) => row.key}
                    renderRow={(row, i, { measureRef }) => {
                      const w = row.data;
                      if (row.kind === 'loader') {
                        return (
                          <EndSentinel key={row.key} onReachEnd={requestMoreWorks} colSpan={5} label={worksLoading ? 'Загрузка…' : 'Загрузить ещё'} />
                        );
                      }
                      if (row.kind === 'group') {
                        return (
                          <tr ref={measureRef} key={row.key} className="bg-primary-50 font-bold text-gray-700" role="row" aria-rowindex={i+1}>
                            <td role="cell" className="px-2 py-2 text-gray-800" colSpan={5}>
                              <div className="flex items-center gap-2">
                                <button
                                  className={`group-toggle-btn ${collapsed[w.code] ? 'collapsed' : ''}`}
                                  title={collapsed[w.code] ? 'Развернуть' : 'Свернуть'}
                                  onClick={() => setCollapsed((prev) => ({ ...prev, [w.code]: !prev[w.code] }))}
                                >
                                  <span className="material-symbols-outlined text-[18px] align-middle">{collapsed[w.code] ? 'chevron_right' : 'expand_more'}</span>
                                </button>
                                <span className="group-title-text">{w.title}</span>
                                {w.code && <span className="text-xs font-normal text-gray-500">({w.code})</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr ref={measureRef} key={row.key} role="row" aria-rowindex={i+1}>
                          <td role="cell" className="px-2 py-2 text-gray-800">
                            <input
                              className="work-table-input w-full bg-transparent py-1 px-2 text-sm"
                              value={w.code}
                              placeholder="Код"
                              onChange={(e) => updateWork(w.code, 'code', e.target.value)}
                            />
                          </td>
                          <td role="cell" className="pl-1 pr-2 py-2 text-gray-800 align-top" style={{whiteSpace:'normal', wordBreak:'break-word'}}>
                            <textarea
                              className="w-full bg-transparent py-1 px-2 text-sm resize-none leading-snug"
                              value={w.name}
                              placeholder="Наименование"
                              onChange={(e) => { updateWork(w.code, 'name', e.target.value); autoGrow(e.target); }}
                              onInput={(e) => autoGrow(e.currentTarget)}
                              ref={(el)=> el && autoGrow(el)}
                              rows={1}
                              style={{ overflowY: 'hidden', resize: 'none' }}
                            />
                          </td>
                          <td role="cell" className="px-2 py-2 text-gray-800">
                            <input
                              className="work-table-input w-full bg-transparent py-1 px-2 text-sm"
                              value={w.unit}
                              placeholder="Ед.изм."
                              onChange={(e) => updateWork(w.code, 'unit', e.target.value)}
                            />
                          </td>
                          <td role="cell" className="px-2 py-2 text-gray-800">
                            <input
                              className="work-table-input w-full bg-transparent py-1 px-2 text-sm"
                              value={(w.price ?? '')}
                              placeholder="Цена руб."
                              onChange={(e) => updateWork(w.code, 'price', e.target.value)}
                            />
                          </td>
                          <td role="cell" className="px-2 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {w._dirty && (
                                <span className="material-symbols-outlined text-yellow-600 animate-pulse" title="Изменения сохраняются">hourglass_empty</span>
                              )}
                              <button
                                className="text-gray-500 hover:text-red-600 p-1"
                                title="Удалить"
                                onClick={() => handleDeleteRow(w.code)}
                              >
                                <span className="material-symbols-outlined">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }}
                  />
                </table>
                </div>
                {/* Кнопка догрузки заменена на автоподгрузку при скролле */}
              </div>
              </div>
            </div>
            ) : (
              <div className="flex-1 min-h-0">
                <div className="bg-white rounded-xl shadow-sm overflow-hidden h-full flex flex-col">
                  <div className="p-4 border-b border-gray-200 flex flex-wrap gap-2 items-center justify-between sticky top-0 z-10 bg-white">
                  <h2 className="font-semibold text-lg">Справочник материалов</h2>
                  <div className="flex gap-2 items-center flex-wrap ml-auto">
                    <div className="relative">
                      <input
                        type="text"
                        value={materialsSearch}
                        onChange={(e) => setMaterialsSearch(e.target.value)}
                        placeholder="Поиск (код / имя)"
                        className="pl-8 pr-2 py-1 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                        style={{ minWidth: 220 }}
                      />
                      <span className="material-symbols-outlined text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 text-base">search</span>
                      {materialsSearch && (
                        <button
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          onClick={() => setMaterialsSearch('')}
                          title="Очистить"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      )}
                    </div>
                    <label className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors cursor-pointer">
                      <input type="file" accept=".csv" className="hidden" onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const fd = new FormData();
                        fd.append('file', f);
                        try {
                          const r = await fetch('/api/admin/import-materials', { method: 'POST', body: fd });
                          const j = await r.json();
                          if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
                          alert(`Импорт материалов: ${j.imported} строк\nДобавлено: ${j.insertedMaterials}\nОбновлено: ${j.updatedMaterials}\nПропущено: ${j.skippedRows}`);
                          setMaterialsPage(1); // перезагрузим
                        } catch (err) { alert('Ошибка импорта: '+(err.message||err)); } finally { e.target.value=''; }
                      }} />
                      <span className="material-symbols-outlined text-sm">upload_file</span>
                      <span>Импорт CSV</span>
                    </label>
                    <button
                      className="bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                      onClick={async (e) => {
                        e.preventDefault();
                        try {
                          const r = await fetch('/api/admin/export-materials');
                          if (!r.ok) throw new Error('HTTP '+r.status);
                          const blob = await r.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = 'materials_export.csv';
                          document.body.appendChild(a); a.click(); a.remove();
                          setTimeout(()=>URL.revokeObjectURL(url), 2000);
                        } catch (err) { alert('Ошибка экспорта: '+(err.message||err)); }
                      }}
                    >
                      <span className="material-symbols-outlined text-sm">download</span>
                      <span>Экспорт CSV</span>
                    </button>
                    <button
                      className="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                      onClick={(e) => { e.preventDefault(); addMaterialRow(); }}
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                      <span>Добавить</span>
                    </button>
                  </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto" ref={materialsScrollRef} style={materialsMaxHeight ? { maxHeight: materialsMaxHeight } : undefined}>
                    {materialsLoading && materialsPage === 1 && (<div className="p-3 text-sm text-gray-500">Загрузка…</div>)}
                    {materialsError && (
                      <div className="p-3 text-sm text-red-600 flex items-center gap-3">
                        <span>{materialsError}</span>
                        <button
                          className="px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100"
                          onClick={() => { setMaterials([]); setTimeout(()=>setMaterialsPage(1)); }}
                        >Повторить</button>
                      </div>
                    )}
                    <div className="overflow-x-auto overflow-y-visible">
                  <table className="w-full" style={{ tableLayout:'fixed' }}>
                    <colgroup>
                      <col style={{ width: materialsColWidths.id }} />
                      <col style={{ width: materialsColWidths.name }} />
                      <col style={{ width: materialsColWidths.unit }} />
                      <col style={{ width: materialsColWidths.price }} />
                      <col style={{ width: materialsColWidths.expenditure }} />
                      <col style={{ width: materialsColWidths.weight }} />
                      <col style={{ width: materialsColWidths.image }} />
                      <col style={{ width: materialsColWidths.item }} />
                      <col style={{ width: materialsColWidths.action }} />
                    </colgroup>
                    <thead ref={materialsTheadRef} className="bg-gray-50 text-left sticky-thead">
                      <tr>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">ID</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Наименование</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Ед.</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Цена</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Расход</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Вес</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Изображение</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Item URL</th>
                        <th role="columnheader" className="py-2 px-2 font-medium text-gray-500 text-sm text-right"></th>
                      </tr>
                    </thead>
                    <VirtualizedTBody
                      rows={materialsRows}
                      colCount={9}
                      overscan={overscanDefaults.refs}
                      estimateSize={(row) => row?.kind === 'loader' ? 56 : 56}
                      getRowKey={(row) => row.key}
                      renderRow={(row, i, { measureRef }) => {
                        if (row.kind === 'loader') {
                          return (
                            <EndSentinel key={row.key} onReachEnd={requestMoreMaterials} colSpan={9} label={materialsLoading ? 'Загрузка…' : 'Загрузить ещё'} />
                          );
                        }
                        const m = row.data;
                        return (
                          <tr ref={measureRef} key={row.key} className={m._isNew ? 'bg-yellow-50' : ''} role="row" aria-rowindex={i+1}>
                            <td role="cell" className="px-2 py-2 text-gray-800">
                              <input
                                className="w-full bg-transparent py-1 px-2 text-sm"
                                value={m.id}
                                placeholder="ID"
                                onChange={(e)=> updateMaterial(m._rowId,'id', e.target.value)}
                                disabled={!m._isNew}
                              />
                            </td>
                            <td role="cell" className="px-2 py-2 text-gray-800 align-top" style={{whiteSpace:'normal', wordBreak:'break-word'}}>
                              <textarea
                                className="w-full bg-transparent py-1 px-2 text-sm resize-none leading-snug"
                                value={m.name||''}
                                placeholder="Наименование"
                                onChange={(e)=> { updateMaterial(m._rowId,'name', e.target.value); autoGrow(e.target); }}
                                onInput={(e)=> autoGrow(e.currentTarget)}
                                ref={(el)=> el && autoGrow(el)}
                                rows={1}
                                style={{ overflowY: 'hidden', resize: 'none' }}
                              />
                            </td>
                            <td role="cell" className="px-2 py-2 text-gray-800">
                              <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.unit||''} placeholder="Ед." onChange={(e)=> updateMaterial(m._rowId,'unit', e.target.value)} />
                            </td>
                            <td role="cell" className="px-2 py-2 text-gray-800">
                              <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.unit_price??''} placeholder="Цена" onChange={(e)=> updateMaterial(m._rowId,'unit_price', e.target.value)} />
                            </td>
                            <td role="cell" className="px-2 py-2 text-gray-800">
                              <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.expenditure??''} placeholder="Расход" onChange={(e)=> updateMaterial(m._rowId,'expenditure', e.target.value)} />
                            </td>
                            <td role="cell" className="px-2 py-2 text-gray-800">
                              <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.weight??''} placeholder="Вес" onChange={(e)=> updateMaterial(m._rowId,'weight', e.target.value)} />
                            </td>
                            <td role="cell" className="px-2 py-2 text-gray-800">
                              {m.image_url ? (
                                <div className="flex items-center gap-2">
                                  <a href={m.image_url} target="_blank" rel="noopener noreferrer" className="block group">
                                    <img
                                      src={m.image_url}
                                      alt="preview"
                                      className="object-cover rounded border border-gray-200 bg-white group-hover:shadow"
                                      style={getPreviewStyle('refMaterial')}
                                      onError={(e)=>{ e.currentTarget.style.display='none'; }}
                                    />
                                  </a>
                                </div>
                              ) : (
                                <button
                                  className="text-xs text-primary-600 hover:underline"
                                  onClick={()=> {
                                    const url = prompt('Вставьте URL изображения','');
                                    if (url != null) updateMaterial(m._rowId,'image_url', url.trim());
                                  }}
                                >+ изображение</button>
                              )}
                            </td>
                            <td role="cell" className="px-2 py-2 text-gray-800">
                              {m.item_url ? (
                                <div className="flex items-center gap-2">
                                  <a
                                    href={m.item_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-primary-50 text-primary-600 hover:text-primary-700 transition-colors"
                                    title={m.item_url}
                                  >
                                    <span className="material-symbols-outlined text-base">open_in_new</span>
                                  </a>
                                </div>
                              ) : (
                                <button
                                  className="text-xs text-primary-600 hover:underline"
                                  onClick={()=> { const v = prompt('Введите URL на товар',''); if (v) updateMaterial(m._rowId,'item_url', v.trim()); }}
                                >+ ссылка</button>
                              )}
                            </td>
                            <td role="cell" className="px-2 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {m._dirty && (<span className="material-symbols-outlined text-yellow-600 animate-pulse" title="Изменения сохраняются">hourglass_empty</span>)}
                                <button className="text-gray-500 hover:text-red-600 p-1" title="Удалить" onClick={()=> deleteMaterial(m)}>
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }}
                    />
                  </table>
                    </div>
                    {/* Кнопка догрузки заменена на автоподгрузку при скролле */}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// (пусто)
