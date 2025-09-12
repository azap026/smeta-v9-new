import React, { useState, useEffect, useRef } from 'react';
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
  const [colWidths, setColWidths] = useState({ code: 90, name: 600, unit: 100, price: 140, action: 48 });
  const [drag, setDrag] = useState(null); // { key, startX, startWidth }
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
  const submitAddModal = async () => {
    // простая валидация
    if (!modalData.work_id?.trim() || !modalData.work_name?.trim()) {
      alert('Укажите work_id и work_name');
      return;
    }
    try {
      const r = await fetch('/api/admin/upsert-work-ref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modalData)
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP '+r.status));
      closeAddModal();
      // перезагрузка текущей страницы (учитываем поиск)
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
    } catch (e) {
      alert('Ошибка сохранения: '+(e.message||e));
    }
  };

  useEffect(() => {
    if (!drag) return;
    const min = { code: 60, name: 200, unit: 70, price: 100 };
    const onMove = (e) => {
      const dx = e.clientX - drag.startX;
      setColWidths((prev) => {
        const next = { ...prev };
        const base = drag.startWidth;
        const w = Math.max(min[drag.key] ?? 60, base + dx);
        next[drag.key] = w;
        return next;
      });
    };
    const onUp = () => {
      setDrag(null);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  const startResize = (key) => (e) => {
    e.preventDefault();
    setDrag({ key, startX: e.clientX, startWidth: colWidths[key] });
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
                <button className="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors">
                  <span className="material-symbols-outlined text-sm">add</span>
                  <span>Добавить</span>
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ tableLayout: 'fixed' }}>
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
                    <>
                      {/* Группа работ: Демонтаж и вложенные строки */}
                      <tr className="bg-primary-50 font-bold text-gray-700">
                        <td className="px-2 py-2 text-gray-800">2</td>
                        <td className="px-2 py-2 text-gray-800" colSpan="8">2. Работы по стенам (Демонтаж)</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-800">2.1</td>
                        <td className="px-2 py-2 text-gray-800">Демонтаж стен из ПГП</td>
                        <td className="px-2 py-2"><span className="bg-gray-100 rounded px-2 py-1 text-xs text-gray-800">40×24</span></td>
                        <td className="px-2 py-2 text-gray-800">м2</td>
                        <td className="px-2 py-2 text-gray-800">27,32</td>
                        <td className="px-2 py-2 text-gray-800">325,00</td>
                        <td className="px-2 py-2 text-gray-800">—</td>
                        <td className="px-2 py-2 font-semibold text-right text-gray-800">8 878,35</td>
                        <td className="px-2 py-2">
                          <button className="bg-primary-50 text-primary-600 px-2 py-1 rounded text-xs mr-2">+ Материал</button>
                          <button className="bg-primary-100 text-primary-700 px-2 py-1 rounded text-xs">В смету</button>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-800">2.1</td>
                        <td className="px-2 py-2 text-gray-800">Мешок для мусора 50 л 500×900 мм, зелёный</td>
                        <td className="px-2 py-2"><span className="bg-green-100 rounded px-2 py-1 text-xs text-green-800">60×24</span></td>
                        <td className="px-2 py-2 text-gray-800">шт</td>
                        <td className="px-2 py-2 text-gray-800">76,18</td>
                        <td className="px-2 py-2 text-gray-800">13,00</td>
                        <td className="px-2 py-2 text-gray-800">990,29</td>
                        <td className="px-2 py-2 text-gray-800">—</td>
                        <td className="px-2 py-2"></td>
                      </tr>
                      <tr className="bg-gray-50 font-semibold">
                        <td className="px-2 py-2 text-gray-800" colSpan="6">ИТОГО ЗА ДЕМОНТАЖНЫЕ РАБОТЫ ПО СТЕНАМ:</td>
                        <td className="px-2 py-2 text-gray-800">990,29</td>
                        <td className="px-2 py-2 text-primary-700">8 878,35</td>
                        <td className="px-2 py-2 text-gray-800"></td>
                      </tr>
                      {/* Группа работ: Отделочные работы и вложенные строки */}
                      <tr className="bg-primary-50 font-bold text-gray-700">
                        <td className="px-2 py-2 text-gray-800">6</td>
                        <td className="px-2 py-2 text-gray-800" colSpan="8">6. Работы по потолкам (Отделочные работы)</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-800">6.3</td>
                        <td className="px-2 py-2 text-gray-800">ГКЛ потолок</td>
                        <td className="px-2 py-2 text-gray-800">—</td>
                        <td className="px-2 py-2 text-gray-800">м2</td>
                        <td className="px-2 py-2 text-gray-800">122,99</td>
                        <td className="px-2 py-2 text-gray-800">1 300,00</td>
                        <td className="px-2 py-2 text-gray-800">—</td>
                        <td className="px-2 py-2 font-semibold text-right text-gray-800">159 887,00</td>
                        <td className="px-2 py-2">
                          <button className="bg-primary-50 text-primary-600 px-2 py-1 rounded text-xs mr-2">+ Материал</button>
                          <button className="bg-primary-100 text-primary-700 px-2 py-1 rounded text-xs">В смету</button>
                        </td>
                      </tr>
                    </>
                  </tbody>
                </table>
              </div>
            </div>
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
                <table className="w-full">
                  <colgroup>
                    <col style={{ width: colWidths.code }} />
                    <col style={{ width: colWidths.name }} />
                    <col style={{ width: colWidths.unit }} />
                    <col style={{ width: colWidths.price }} />
                    <col style={{ width: colWidths.action }} />
                  </colgroup>
                  <thead className="bg-gray-50 text-left">
                    <tr>
            <th className="relative py-2 px-2 font-medium text-gray-500 text-sm select-none">
                        Код
                        <span
              onMouseDown={startResize('code')}
              onMouseEnter={() => setDrag((d) => d ? d : d)}
              style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 6, cursor: 'col-resize', borderRight: '1px solid rgba(0,0,0,0.08)', backgroundColor: drag?.key==='code' ? 'rgba(115,65,255,0.2)' : 'transparent' }}
                        />
                      </th>
            <th className="relative py-2 pl-1 pr-2 font-medium text-gray-500 text-sm select-none">
                        Наименование
                        <span
              onMouseDown={startResize('name')}
              style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 6, cursor: 'col-resize', borderRight: '1px solid rgba(0,0,0,0.08)', backgroundColor: drag?.key==='name' ? 'rgba(115,65,255,0.2)' : 'transparent' }}
                        />
                      </th>
            <th className="relative py-2 px-2 font-medium text-gray-500 text-sm select-none">
                        Ед.изм.
                        <span
              onMouseDown={startResize('unit')}
              style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 6, cursor: 'col-resize', borderRight: '1px solid rgba(0,0,0,0.08)', backgroundColor: drag?.key==='unit' ? 'rgba(115,65,255,0.2)' : 'transparent' }}
                        />
                      </th>
            <th className="relative py-2 px-2 font-medium text-gray-500 text-sm select-none">
                        Цена руб.
                        <span
              onMouseDown={startResize('price')}
              style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 6, cursor: 'col-resize', borderRight: '1px solid rgba(0,0,0,0.08)', backgroundColor: drag?.key==='price' ? 'rgba(115,65,255,0.2)' : 'transparent' }}
                        />
                      </th>
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
                          <td className="px-2 py-2 text-gray-800">
                            <div className="flex items-center">
                              <button
                                className={`group-toggle-btn ${collapsed[w.code] ? 'collapsed' : ''}`}
                                title={collapsed[w.code] ? 'Развернуть' : 'Свернуть'}
                                onClick={() => setCollapsed((prev) => ({ ...prev, [w.code]: !prev[w.code] }))}
                              >
                                <span className="material-symbols-outlined text-[18px] align-middle">{collapsed[w.code] ? 'chevron_right' : 'expand_more'}</span>
                              </button>
                              <span>{w.code}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-gray-800" colSpan={4}>
                            <span className="group-title-text">{w.title}</span>
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
                          <td className="pl-1 pr-2 py-2 text-gray-800">
                            <input
                              className="work-table-input w-full bg-transparent py-1 px-2 text-sm"
                              value={w.name}
                              placeholder="Наименование"
                              onChange={(e) => updateWork(w.code, 'name', e.target.value)}
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
                  <table className="w-full">
                    <thead className="bg-gray-50 text-left">
                      <tr>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">ID</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Наименование</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Ед.</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Цена</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Расход</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Вес</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Image URL</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Item URL</th>
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
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.name||''} placeholder="Наименование" onChange={(e)=> updateMaterial(m._rowId,'name', e.target.value)} />
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
                            <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.image_url||''} placeholder="Image URL" onChange={(e)=> updateMaterial(m._rowId,'image_url', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm" value={m.item_url||''} placeholder="Item URL" onChange={(e)=> updateMaterial(m._rowId,'item_url', e.target.value)} />
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
