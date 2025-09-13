import React, { useState, useEffect, useRef } from 'react';
// Конфиг ширин/высот для вкладки "Расчет сметы" — меняйте цифры здесь
export const calcColWidths = {
  idx: 60,          // № / код работы
  name: 500,        // Наименование работ / материалов
  image: 70,        // Превью изображения материала
  unit: 80,         // Единица измерения
  qty: 90,          // Количество
  unitPrice: 110,   // Цена за единицу
  mats: 120,        // Сумма по материалу / столбец материалов (итог)
  labor: 130,       // Оплата труда / сумма по работе
  actions: 110      // Кнопки / действия
};
export const calcRowHeights = {
  work: 40,
  material: 40,
  total: 36,
};
// Централизованные размеры превью изображений материалов
// Меняйте здесь — обновятся все таблицы
export const previewSizes = {
  refMaterial:  { w: 28, h: 28, offsetX: 0,  offsetY: 0,  scale: 1 }, // Справочник материалов
  calcMaterial: { w: 36, h: 36, offsetX: 20,  offsetY: -12,  scale: 1 }, // Таблица расчета
  // Пример дополнительного профиля:
  // summary: { w: 48, h: 48, offsetX: 100, offsetY: 100, scale: 1 }
};
// Подвинуть: меняйте offsetX / offsetY (в пикселях, могут быть отрицательными)
// Масштаб: scale (например 0.9 или 1.2). Размер w/h задаёт контейнер, scale уменьшит/увеличит изображение внутри без ломки сетки.
// ВНИМАНИЕ: смещение реализовано через CSS transform: translate(x,y) чтобы не ломать поток верстки и избежать влияния margin-collapse.
export function getPreviewStyle(kind = 'refMaterial') {
  const cfg = previewSizes[kind] || previewSizes.refMaterial;
  const { w, h, offsetX = 40, offsetY = 10, scale = 1 } = cfg;
  return {
    width: w,
    height: h,
    minWidth: w,
    minHeight: h,
    maxWidth: w,
    maxHeight: h,
    display: 'block',
  position: 'relative',
  left: offsetX,
  top: offsetY,
  transform: scale !== 1 ? `scale(${scale})` : undefined,
  transformOrigin: 'top left'
  };
}
import AddWorkModal from './components/AddWorkModal.tsx';
import { Label, Input, Button } from './components/ui/form';
import FloatingWindow from './components/ui/FloatingWindow.jsx';

export default function App() {
  const [active, setActive] = useState("calc"); // calc | works | materials
  const [works, setWorks] = useState([]);
  const WORKS_PAGE_SIZE = 70;
  const [worksPage, setWorksPage] = useState(1); // текущая страница (для запроса)
  const [worksHasMore, setWorksHasMore] = useState(false);
  const [worksTotal, setWorksTotal] = useState(0);
  const [worksSearch, setWorksSearch] = useState(''); // строка поиска (UI)
  const worksSearchRef = useRef(''); // актуальная применённая строка (для отмены гонок)
  const searchDebounce = useRef(null);
  const [collapsed, setCollapsed] = useState({}); // { [groupCode]: boolean }

  // Persist collapsed state per user
  useEffect(() => {
    if (active !== 'works') return;
    try {
      const raw = localStorage.getItem('worksCollapsed');
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {}
  }, [active]);
  useEffect(() => {
    if (active !== 'works') return;
    try { localStorage.setItem('worksCollapsed', JSON.stringify(collapsed)); } catch {}
  }, [collapsed, active]);

  const toggleGroup = (code) => setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));
  const collapseAll = () => {
    const codes = works.filter(w => w.type === 'group').map(g => g.code);
    const next = {};
    for (const c of codes) next[c] = true;
    setCollapsed(next);
  };
  const expandAll = () => setCollapsed({});
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksError, setWorksError] = useState('');
  // ===== Materials state =====
  const MATERIALS_PAGE_SIZE = 70;
  const [materials, setMaterials] = useState([]);
  const [materialsPage, setMaterialsPage] = useState(1);
  const [materialsHasMore, setMaterialsHasMore] = useState(false);
  const [materialsTotal, setMaterialsTotal] = useState(0);
  const [materialsSearch, setMaterialsSearch] = useState('');
  const materialsSearchRef = useRef('');
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const materialsSearchDebounce = useRef(null);
  // ===== Calc template blocks (эталонные блоки) =====
  const [calcBlocks, setCalcBlocks] = useState([]); // [{id, groupName, work:{}, materials:[{}}]]
  // Состояние сохранения сметы
  const [estimateSaving, setEstimateSaving] = useState(false);
  const [estimateSavedAt, setEstimateSavedAt] = useState(null); // Date
  const estimateInitialLoad = useRef(false);
  const estimateSaveTimer = useRef(null);

  // Helper: преобразовать calcBlocks -> payload
  function buildEstimatePayload(blocksArg) {
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
  }

  async function saveEstimateSnapshot(blocksArg) {
    try {
      setEstimateSaving(true);
      const payload = buildEstimatePayload(blocksArg);
      const r = await fetch('/api/estimates/by-code/current/full', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
      setEstimateSavedAt(new Date());
    } catch (e) {
      console.warn('saveEstimateSnapshot error:', e?.message || e);
    } finally { setEstimateSaving(false); }
  }

  // Последняя попытка сохранить на выгрузке страницы
  function saveEstimateBeacon(blocksArg) {
    try {
      const payload = buildEstimatePayload(blocksArg);
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      // navigator.sendBeacon ограничен ~64KB; для больших данных может не пройти
      if (navigator.sendBeacon) {
        return navigator.sendBeacon('/api/estimates/by-code/current/full', blob);
      }
      return false;
    } catch { return false; }
  }

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
  }, [calcBlocks]);

  // Загрузка сохранённой сметы при входе во вкладку calc (однократно за сессию)
  useEffect(() => {
    if (active !== 'calc') return;
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
          estimateInitialLoad.current = true; // подавим автосейв ближайший цикл
          setCalcBlocks(blocks);
          setTimeout(()=> { estimateInitialLoad.current = false; }, 50);
        }
      } catch {}
    })();
    return () => { aborted = true; };
  }, [active]);

  // Автосохранение сметы (debounce 1000ms)
  useEffect(() => {
    if (estimateInitialLoad.current) return; // пропуск после загрузки
    if (active !== 'calc') return;
    if (estimateSaveTimer.current) clearTimeout(estimateSaveTimer.current);
    estimateSaveTimer.current = setTimeout(async () => {
      try {
        setEstimateSaving(true);
        const payload = buildEstimatePayload();
        const r = await fetch('/api/estimates/by-code/current/full', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const j = await r.json().catch(()=>({}));
        if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
        setEstimateSavedAt(new Date());
      } catch (e) {
        console.warn('Ошибка сохранения сметы:', e.message || e);
      } finally {
        setEstimateSaving(false);
      }
    }, 1000);
    return () => { if (estimateSaveTimer.current) clearTimeout(estimateSaveTimer.current); };
  }, [calcBlocks, active]);
  // Справочник названий для разделов/подразделов (по их id)
  const [groupTitles, setGroupTitles] = useState({}); // { stage_id: title }
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
  setCalcBlocks(nextBlocks);
  // Немедленное сохранение после добавления блока (без ожидания дебаунса)
  await saveEstimateSnapshot(nextBlocks);
    setAddBlockModal(false);
    setCreatingBlock(false);
  };
  const addCalcBlockEmpty = () => { // запасной быстрый вариант (не используется но можно оставить)
    setCalcBlocks(prev => [...prev, { id:Date.now()+'_'+Math.random().toString(36).slice(2), groupName:'', work:{ name:'', unit:'', quantity:'', unit_price:'', image:'', labor_total:0 }, materials:[{ name:'', unit:'', quantity:'', unit_price:'', total:'' }] }]);
  };
  const updateBlock = (id, updater) => {
    setCalcBlocks(prev => prev.map(b => b.id===id ? updater(b) : b));
  };
  // ===== Ширины столбцов и drag-состояние (независимое расширение таблицы) =====
  // Фиксированные ширины колонок
  const colWidths = { code: 40, name: 600, unit: 100, price: 140, action: 48 }; // works
  const materialsColWidths = { id: 90, name: 600, unit: 70, price: 120, expenditure: 110, weight: 100, image: 120, item: 120, action: 60 };
  const [uploading, setUploading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState({ open:false, code:'', name:'' });
  const [modalData, setModalData] = useState({
    stage_id: '', stage_name: '',
    substage_id: '', substage_name: '',
    work_id: '', work_name: '',
    unit: '', unit_price: ''
  });

  const openAddModal = () => { setModalOpen(true); };
  const closeAddModal = () => { setModalOpen(false); };
  const setMD = (k, v) => setModalData((prev) => ({ ...prev, [k]: v }));
  const modalBoxRef = useRef(null);
  useEffect(() => {
    if (!modalOpen) return;
    // автофокус на первое поле
    const t = setTimeout(() => {
      try { modalBoxRef.current?.querySelector('input')?.focus(); } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [modalOpen]);
  // Авто-ресайз текстовых областей (перенос строк) для столбца "Наименование"
  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
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
    let aborted = false;
    (async () => {
      try {
        setWorksLoading(true); setWorksError('');
        const qParam = worksSearch ? `&q=${encodeURIComponent(worksSearch)}` : '';
        const params = `?page=${worksPage}&limit=${WORKS_PAGE_SIZE}${qParam}`;
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
  }, [active, worksPage, worksSearch]);

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
  const updateMaterial = (id, field, value) => {
    setMaterials(prev => prev.map(m => (m._rowId === id ? { ...m, [field]: value, _dirty: true } : m)));
  };
  
  // Суммарные ширины таблиц для горизонтального скролла
  const worksTotalWidth = Object.values(colWidths).reduce((a,b)=>a+b,0);
  const materialsTotalWidth = Object.values(materialsColWidths).reduce((a,b)=>a+b,0);
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
    let aborted = false;
    (async () => {
      try {
        setMaterialsLoading(true); setMaterialsError('');
        const qParam = materialsSearch ? `&q=${encodeURIComponent(materialsSearch)}` : '';
        const params = `?page=${materialsPage}&limit=${MATERIALS_PAGE_SIZE}${qParam}`;
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
  }, [active, materialsPage, materialsSearch]);

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
  const [bulkLoading,setBulkLoading]=useState(false);
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
      } catch {}
    })();
    return () => { aborted = true; };
  }, [active]);
  const createBlocksFromAllBundles = async ()=>{
    if(bulkLoading) return; setBulkLoading(true);
    try {
      const r = await fetch('/api/work-materials-bundles');
      const j = await r.json().catch(()=>({}));
      if(!r.ok || !j.ok || !Array.isArray(j.items)) { alert('Ошибка загрузки связок'); return; }
      const newBlocks = j.items.map(it=>({
        id: 'bulk_'+it.work.id+'_'+Math.random().toString(36).slice(2),
        groupName: it.work.stage_name || it.work.substage_name || '',
        work: { code: it.work.id, name: it.work.name, unit: it.work.unit||'', quantity:'', unit_price: it.work.unit_price!=null? String(it.work.unit_price):'', image:'', labor_total:0, stage_id: it.work.stage_id, substage_id: it.work.substage_id },
        materials: it.materials
      }));
  const nextBlocks = [...calcBlocks, ...newBlocks];
  setCalcBlocks(nextBlocks);
  // Сохраним сразу после импорта, чтобы не потерять после перезагрузки
  await saveEstimateSnapshot(nextBlocks);
    } finally { setBulkLoading(false);} };
  return (
    <div id="webcrumbs"> 
      <div className="min-h-screen bg-gray-50 font-sans flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white shadow-md hidden md:block">
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
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <header className="bg-white shadow-sm z-10">
            <div className="flex justify-between items-center px-4 py-3">
              <div className="flex items-center">
                <button className="md:hidden mr-2">
                  <span className="material-symbols-outlined text-2xl">menu</span>
                </button>
                <h1 className="text-xl font-semibold text-gray-800">{
                  active === "calc" ? "Расчет сметы" : active === "works" ? "Справочник работ" : "Справочник материалов"
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
          <div className="flex-1 overflow-auto p-6 bg-gray-50">
            {active === "calc" ? (
            <div className="space-y-6">
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
            <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                <h2 className="font-semibold text-lg">Работы и материалы</h2>
                <div className="flex gap-2">
                  <button onClick={openAddBlockModal} className="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors">
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Добавить</span>
                  </button>
                  <button onClick={createBlocksFromAllBundles} disabled={bulkLoading} className="bg-white border border-primary-300 text-primary-600 hover:bg-primary-50 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors disabled:opacity-60">
                    <span className="material-symbols-outlined text-sm">playlist_add</span>
                    <span>{bulkLoading? 'Загружаю...' : 'Импорт всех связок'}</span>
                  </button>
                  <div className="flex items-center text-xs text-gray-500 ml-2">
                    {estimateSaving ? (
                      <span className="flex items-center gap-1"><span className="material-symbols-outlined animate-spin-slow text-base">progress_activity</span> Сохраняю…</span>
                    ) : estimateSavedAt ? (
                      <span className="flex items-center gap-1 text-green-600"><span className="material-symbols-outlined text-base">check_circle</span> Сохранено {estimateSavedAt.toLocaleTimeString()}</span>
                    ) : (
                      <span className="flex items-center gap-1 opacity-70"><span className="material-symbols-outlined text-base">info</span> Нет изменений</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
        <table className="w-full" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
          {/* Ширины столбцов берутся из calcColWidths (см. верх файла). Меняйте там числа — обновится таблица. */}
                    <col style={{ width: calcColWidths.idx }} />
                    <col style={{ width: calcColWidths.name }} />
                    <col style={{ width: calcColWidths.image }} />
                    <col style={{ width: calcColWidths.unit }} />
                    <col style={{ width: calcColWidths.qty }} />
                    <col style={{ width: calcColWidths.unitPrice }} />
                    <col style={{ width: calcColWidths.mats }} />
                    <col style={{ width: calcColWidths.labor }} />
                    <col style={{ width: calcColWidths.actions }} />
                  </colgroup>
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">№</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">Наименование работ</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">Изображение</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">Ед. изм.</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">Кол-во</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">На единицу</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">Материалы</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">Оплата труда</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcBlocks.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-sm text-gray-400">Нет блоков. Нажмите «Добавить».</td>
                      </tr>
                    )}
                    {(() => {
                      // Сортировка и группировка как в справочнике: stage -> (works без substage) -> substages -> works
                      const natural = (a,b)=> String(a||'').localeCompare(String(b||''),'ru',{numeric:true,sensitivity:'base'});
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
                      const stageKeys = Array.from(stagesMap.keys()).sort(natural);
                      let rowIndex = 0; // выдаём порядковые номера
                      const rows = [];
                      for (const stId of stageKeys) {
                        const stage = stagesMap.get(stId);
                        const stageTitle = groupTitles[stId] || stage.stage_name || stId;
                        rows.push(<tr key={'stage_'+stId} className="bg-primary-50 font-bold text-gray-700"><td className="px-2 py-2 text-gray-800">{stId}</td><td className="px-2 py-2 text-gray-800" colSpan={8}>{stageTitle}</td></tr>);
                        // works without substage
                        stage.works.sort((a,b)=> natural(a.work.code,b.work.code));
                        for (const wb of stage.works) {
                          const workSum = (parseFloat(wb.work.quantity)||0) * (parseFloat(wb.work.unit_price)||0);
                          const matsTotal = wb.materials.reduce((s,m)=> s + ((parseFloat(m.quantity)||0) * (parseFloat(m.unit_price)||0)),0);
                          rows.push(renderWorkRow(wb, rowIndex, workSum, matsTotal));
                        }
                        // substages
                        const subKeys = Array.from(stage.substages.keys()).sort(natural);
                        for (const ssId of subKeys) {
                          const ss = stage.substages.get(ssId);
                          const subTitle = groupTitles[ssId] || ss.substage_name || ssId;
                          rows.push(<tr key={'sub_'+stId+'_'+ssId} className="bg-purple-50 font-semibold text-gray-700"><td className="px-2 py-2 text-gray-800">{ssId}</td><td className="px-2 py-2 text-gray-800" colSpan={8}>{subTitle}</td></tr>);
                          ss.works.sort((a,b)=> natural(a.work.code,b.work.code));
                          for (const wb of ss.works) {
                            const workSum = (parseFloat(wb.work.quantity)||0) * (parseFloat(wb.work.unit_price)||0);
                            const matsTotal = wb.materials.reduce((s,m)=> s + ((parseFloat(m.quantity)||0) * (parseFloat(m.unit_price)||0)),0);
                            rows.push(renderWorkRow(wb, rowIndex, workSum, matsTotal));
                          }
                        }
                      }
                      if (orphan.length) {
                        orphan.sort((a,b)=> natural(a.work.code,b.work.code));
                        rows.push(<tr key='orph' className="bg-primary-50 font-bold text-gray-700"><td className="px-2 py-2 text-gray-800">—</td><td className="px-2 py-2 text-gray-800" colSpan={8}>Прочее</td></tr>);
                        for (const wb of orphan) {
                          const workSum = (parseFloat(wb.work.quantity)||0) * (parseFloat(wb.work.unit_price)||0);
                          const matsTotal = wb.materials.reduce((s,m)=> s + ((parseFloat(m.quantity)||0) * (parseFloat(m.unit_price)||0)),0);
                          rows.push(renderWorkRow(wb, rowIndex, workSum, matsTotal));
                        }
                      }
                      return rows;
                    })()}
                  </tbody>
                </table>
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
                                } catch { setWorkSuggestions([]);} finally { setWorkSearchLoading(false); }
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
            ) : active === "works" ? (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
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
              const params = `?page=${worksPage}&limit=${WORKS_PAGE_SIZE}${qParam}`;
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
                        } catch {}
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
              <div className="overflow-x-auto">
                <table className="w-full" style={{ tableLayout:'fixed' }}>
                  <colgroup>
                    <col style={{ width: colWidths.code }} />
                    <col style={{ width: colWidths.name }} />
                    <col style={{ width: colWidths.unit }} />
                    <col style={{ width: colWidths.price }} />
                    <col style={{ width: colWidths.action }} />
                  </colgroup>
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Код</th>
                      <th className="py-2 pl-1 pr-2 font-medium text-gray-500 text-sm select-none">Наименование</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Ед.изм.</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Цена руб.</th>
                      <th className="py-2 px-2 font-medium text-gray-500 text-sm text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {works
                      .filter((w) => {
                        // показываем строку, если все её родители не свернуты
                        if (!w.parents || w.parents.length === 0) return true;
                        for (const p of w.parents) {
                          if (collapsed[p]) return false;
                        }
                        return true;
                      })
                      .filter(w => !(w.type==='group' && w.level==='phase'))
                      .map((w, i) => (
                      w.type === 'group' ? (
                        <tr key={`g-${i}`} className="bg-primary-50 font-bold text-gray-700">
                          <td className="px-2 py-2 text-gray-800" colSpan={5}>
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
                      ) : (
                        <tr key={`i-${i}`}>
                          <td className="px-2 py-2 text-gray-800">
                            <input
                              className="work-table-input w-full bg-transparent py-1 px-2 text-sm"
                              value={w.code}
                              placeholder="Код"
                              onChange={(e) => updateWork(w.code, 'code', e.target.value)}
                            />
                          </td>
                          <td className="pl-1 pr-2 py-2 text-gray-800 align-top" style={{whiteSpace:'normal', wordBreak:'break-word'}}>
                            <textarea
                              className="w-full bg-transparent py-1 px-2 text-sm resize-none leading-snug"
                              value={w.name}
                              placeholder="Наименование"
                              onChange={(e) => { updateWork(w.code, 'name', e.target.value); autoGrow(e.target); }}
                              ref={(el)=> el && autoGrow(el)}
                            />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input
                              className="work-table-input w-full bg-transparent py-1 px-2 text-sm"
                              value={w.unit}
                              placeholder="Ед.изм."
                              onChange={(e) => updateWork(w.code, 'unit', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input
                              className="work-table-input w-full bg-transparent py-1 px-2 text-sm"
                              value={(w.price ?? '')}
                              placeholder="Цена руб."
                              onChange={(e) => updateWork(w.code, 'price', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {/* Индикатор сохранения */}
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
                      )
                    ))}
                  </tbody>
                </table>
              </div>
              {worksHasMore && (
                <div className="p-4 flex items-center justify-center border-t border-gray-100">
                  <button
                    className="px-6 py-2.5 rounded-lg text-sm font-medium bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 disabled:opacity-50 shadow-sm flex items-center justify-center gap-2 transition-colors"
                    style={{ minWidth: 240 }}
                    disabled={worksLoading}
                    onClick={() => setWorksPage(p => p + 1)}
                  >
                    {worksLoading && (
                      <span className="material-symbols-outlined text-base animate-spin-slow" style={{fontSize:16}}>progress_activity</span>
                    )}
                    <span>{worksLoading ? 'Загрузка…' : `Показать ещё ${WORKS_PAGE_SIZE} строк`}</span>
                  </button>
                </div>
              )}
            </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex flex-wrap gap-2 items-center justify-between">
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
                {materialsLoading && (<div className="p-3 text-sm text-gray-500">Загрузка…</div>)}
                {materialsError && (
                  <div className="p-3 text-sm text-red-600 flex items-center gap-3">
                    <span>{materialsError}</span>
                    <button
                      className="px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100"
                      onClick={() => { setMaterials([]); setTimeout(()=>setMaterialsPage(1)); }}
                    >Повторить</button>
                  </div>
                )}
                <div className="overflow-x-auto">
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
                    <thead className="bg-gray-50 text-left">
                      <tr>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">ID</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Наименование</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Ед.</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Цена</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Расход</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Вес</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Изображение</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm select-none">Item URL</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {materials.map(m => (
                        <tr key={m._rowId} className={m._isNew ? 'bg-yellow-50' : ''}>
                          <td className="px-2 py-2 text-gray-800">
                            <input
                              className="w-full bg-transparent py-1 px-2 text-sm"
                              value={m.id}
                              placeholder="ID"
                              onChange={(e)=> updateMaterial(m._rowId,'id', e.target.value)}
                              disabled={!m._isNew}
                            />
                          </td>
                          <td className="px-2 py-2 text-gray-800 align-top" style={{whiteSpace:'normal', wordBreak:'break-word'}}>
                            <textarea
                              className="w-full bg-transparent py-1 px-2 text-sm resize-none leading-snug"
                              value={m.name||''}
                              placeholder="Наименование"
                              onChange={(e)=> { updateMaterial(m._rowId,'name', e.target.value); autoGrow(e.target); }}
                              ref={(el)=> el && autoGrow(el)}
                            />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.unit||''} placeholder="Ед." onChange={(e)=> updateMaterial(m._rowId,'unit', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.unit_price??''} placeholder="Цена" onChange={(e)=> updateMaterial(m._rowId,'unit_price', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.expenditure??''} placeholder="Расход" onChange={(e)=> updateMaterial(m._rowId,'expenditure', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.weight??''} placeholder="Вес" onChange={(e)=> updateMaterial(m._rowId,'weight', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
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
                                <button
                                  className="text-xs text-gray-400 hover:text-red-600"
                                  title="Убрать изображение"
                                  onClick={()=> updateMaterial(m._rowId,'image_url','')}
                                >✕</button>
                                <button
                                  className="text-xs text-gray-500 hover:text-primary-600"
                                  title="Заменить URL"
                                  onClick={()=> {
                                    const url = prompt('Новый URL изображения', m.image_url || '');
                                    if (url != null) updateMaterial(m._rowId,'image_url', url.trim());
                                  }}
                                >изменить</button>
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
                          <td className="px-2 py-2 text-gray-800">
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
                                <button
                                  className="text-xs text-gray-400 hover:text-red-600"
                                  title="Убрать ссылку"
                                  onClick={()=> updateMaterial(m._rowId,'item_url','')}
                                >✕</button>
                                <button
                                  className="text-xs text-gray-500 hover:text-primary-600"
                                  title="Изменить ссылку"
                                  onClick={()=> { const v = prompt('Новый URL товара', m.item_url||''); if (v!=null) updateMaterial(m._rowId,'item_url', v.trim()); }}
                                >изменить</button>
                              </div>
                            ) : (
                              <button
                                className="text-xs text-primary-600 hover:underline"
                                onClick={()=> { const v = prompt('Введите URL на товар',''); if (v) updateMaterial(m._rowId,'item_url', v.trim()); }}
                              >+ ссылка</button>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {m._dirty && (<span className="material-symbols-outlined text-yellow-600 animate-pulse" title="Изменения сохраняются">hourglass_empty</span>)}
                              <button className="text-gray-500 hover:text-red-600 p-1" title="Удалить" onClick={()=> deleteMaterial(m)}>
                                <span className="material-symbols-outlined">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {materialsHasMore && (
                  <div className="p-4 flex items-center justify-center border-t border-gray-100">
                    <button
                      className="px-6 py-2.5 rounded-lg text-sm font-medium bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 disabled:opacity-50 shadow-sm flex items-center justify-center gap-2 transition-colors"
                      style={{ minWidth: 240 }}
                      disabled={materialsLoading}
                      onClick={() => setMaterialsPage(p => p + 1)}
                    >
                      {materialsLoading && (
                        <span className="material-symbols-outlined text-base animate-spin-slow" style={{fontSize:16}}>progress_activity</span>
                      )}
                      <span>{materialsLoading ? 'Загрузка…' : `Показать ещё ${MATERIALS_PAGE_SIZE} строк`}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Рендер строки работы + её материалов (без групп-заголовков)
function renderWorkRow(block, groupIndex, workSum, matsTotal) {
  return (
    <React.Fragment key={block.id}>
  <tr style={{ height: calcRowHeights.work }}>
  <td className="px-2 py-2 text-gray-800">{block.work.code}</td>
        <td className="px-2 py-2 text-gray-800">
          <input
            value={block.work.name}
            placeholder="Наименование работы"
            onChange={(e)=> block._update && block._update(b=> ({...b, work:{...b.work, name:e.target.value}}))}
            className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm"
          />
        </td>
  <td className="px-2 py-2"></td>
    <td className="px-2 py-2 text-gray-800">
          <input value={block.work.unit} placeholder="ед" onChange={(e)=> block._update && block._update(o=>({...o, work:{...o.work, unit:e.target.value}}))} className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" />
        </td>
    <td className="px-2 py-2 text-gray-800">
          <input value={block.work.quantity} placeholder="0" onChange={(e)=> block._update && block._update(o=>({...o, work:{...o.work, quantity:e.target.value}}))} className="w-full text-right bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" />
        </td>
    <td className="px-2 py-2 text-gray-800">
          <input value={block.work.unit_price} placeholder="0" onChange={(e)=> block._update && block._update(o=>({...o, work:{...o.work, unit_price:e.target.value}}))} className="w-full text-right bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" />
        </td>
        <td className="px-2 py-2 text-gray-800">—</td>
        <td className="px-2 py-2 font-semibold text-right text-gray-800">{workSum ? workSum.toFixed(2) : '—'}</td>
        <td className="px-2 py-2">
          <button onClick={()=> block._update && block._update(o=>({...o, materials:[...o.materials, { name:'', unit:'', quantity:'', unit_price:'', total:'' }]}))} className="bg-primary-50 text-primary-600 px-2 py-1 rounded text-xs mr-2">+ Материал</button>
        </td>
      </tr>
      {block.materials.map((m, mi) => {
        const matSum = (parseFloat(m.quantity)||0) * (parseFloat(m.unit_price)||0);
        return (
      <tr key={mi} style={{ height: calcRowHeights.material }}>
            <td className="px-2 py-2 text-gray-800"></td>
            <td className="px-2 py-2 text-gray-800">
              <input value={m.name} placeholder="Материал" onChange={(e)=> block._update && block._update(o=>{ const ms=[...o.materials]; ms[mi]={...ms[mi], name:e.target.value}; return {...o, materials:ms}; })} className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" />
            </td>
            <td className="px-2 py-2">
              {m.image_url ? (
                <img src={m.image_url} alt="img" className="rounded border object-cover" style={getPreviewStyle('calcMaterial')} onError={(e)=>{e.currentTarget.style.display='none';}} />
              ) : null}
            </td>
    <td className="px-2 py-2 text-gray-800">
              <input value={m.unit} placeholder="ед" onChange={(e)=> block._update && block._update(o=>{ const ms=[...o.materials]; ms[mi]={...ms[mi], unit:e.target.value}; return {...o, materials:ms}; })} className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" />
            </td>
    <td className="px-2 py-2 text-gray-800">
              <input value={m.quantity} placeholder="0" onChange={(e)=> block._update && block._update(o=>{ const ms=[...o.materials]; ms[mi]={...ms[mi], quantity:e.target.value}; return {...o, materials:ms}; })} className="w-full text-right bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" />
            </td>
    <td className="px-2 py-2 text-gray-800">
              <input value={m.unit_price} placeholder="0" onChange={(e)=> block._update && block._update(o=>{ const ms=[...o.materials]; ms[mi]={...ms[mi], unit_price:e.target.value}; return {...o, materials:ms}; })} className="w-full text-right bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" />
            </td>
            <td className="px-2 py-2 text-gray-800">{matSum? matSum.toFixed(2): '—'}</td>
            <td className="px-2 py-2 text-gray-800">—</td>
            <td className="px-2 py-2 text-right">
              {block.materials.length>1 && (
                <button onClick={()=> block._update && block._update(o=>({...o, materials: o.materials.filter((_,j)=> j!==mi)}))} className="text-gray-400 hover:text-red-600 text-xs">Удалить</button>
              )}
            </td>
          </tr>
        );
      })}
  <tr className="bg-gray-50 font-semibold" style={{ height: calcRowHeights.total }}>
        <td className="px-2 py-2 text-gray-800" colSpan={6}>ИТОГО ПО ГРУППЕ:</td>
        <td className="px-2 py-2 text-gray-800">{matsTotal? matsTotal.toFixed(2): '—'}</td>
        <td className="px-2 py-2 text-primary-700">{workSum? workSum.toFixed(2): '—'}</td>
        <td className="px-2 py-2 text-right">
          <button onClick={()=> block._remove && block._remove(block.id)} className="text-gray-400 hover:text-red-600 text-xs">Удалить блок</button>
        </td>
      </tr>
    </React.Fragment>
  );
}
