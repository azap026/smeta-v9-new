import React, { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './components/ui/dialog';
import { Label, Input, Button } from './components/ui/form';

export default function App() {
  const [active, setActive] = useState("calc"); // calc | works | materials
  const [works, setWorks] = useState([]);
  const [worksPage, setWorksPage] = useState(1);
  const [worksPages, setWorksPages] = useState(1);
  const [worksTotal, setWorksTotal] = useState(0);
  const WORKS_PAGE_SIZE = 70;
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
  const [materials, setMaterials] = useState([
    {
      code: "M-001",
      name: "Гипсокартон лист 12.5 мм",
      price: "450.00",
      imageUrl: "https://example.com/img/gkl.jpg",
      productUrl: "https://example.com/product/gkl-125",
      unit: "лист",
      consumption: "1.00",
      weight: "12.5"
    }
  ]);
  const [colWidths, setColWidths] = useState({ code: 90, name: 600, unit: 100, price: 140, action: 48 });
  const [drag, setDrag] = useState(null); // { key, startX, startWidth }
  const [uploading, setUploading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState({
    phase_id: '', phase_name: '',
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
      // перезагрузка текущей страницы
      const params = `?page=${worksPage}&limit=${WORKS_PAGE_SIZE}`;
      const data = await fetchJsonTry([
        `/api/works-rows${params}`,
        `http://localhost:4000/api/works-rows${params}`,
        `http://127.0.0.1:4000/api/works-rows${params}`,
      ]);
      if (Array.isArray(data)) {
        setWorks(data); setWorksPages(1); setWorksTotal(data.length);
      } else {
        setWorks(data.items || []); setWorksPages(data.pages || 1); setWorksTotal(data.total || (data.items?.length || 0));
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

  const updateWork = (index, field, value) => {
  setWorks((prev) => prev.map((it, i) => (i === index && it.type !== 'group' ? { ...it, [field]: value } : it)));
  };

  const handleSaveRow = (index) => {
    // Здесь можно вызвать API/сохранение; пока просто логируем
    console.log('Save work row:', works[index]);
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
        const params = `?page=${worksPage}&limit=${WORKS_PAGE_SIZE}`;
        const data = await fetchJsonTry([
          `/api/works-rows${params}`,
          `http://localhost:4000/api/works-rows${params}`,
          `http://127.0.0.1:4000/api/works-rows${params}`,
        ]);
        if (!aborted) {
          // поддержка двух форматов ответа: массива (старый) и объекта с пагинацией (новый)
          if (Array.isArray(data)) {
            setWorks(data);
            setWorksPages(1);
            setWorksTotal(data.length);
          } else {
            setWorks(data.items || []);
            setWorksPages(data.pages || 1);
            setWorksTotal(data.total || (data.items?.length || 0));
          }
        }
      } catch (e) {
        if (!aborted) setWorksError(e.message || 'Ошибка загрузки');
      } finally {
        if (!aborted) setWorksLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [active, worksPage]);
  const updateMaterial = (index, field, value) => {
    setMaterials((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };
  const handleSaveMaterial = (index) => {
    console.log('Save material row:', materials[index]);
  };
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
                <div className="flex gap-2 items-center">
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
                        alert(`Импорт завершен: ${j.imported} строк`);
                        // перезагрузка текущей страницы работ
                        try {
                          const params = `?page=${worksPage}&limit=${WORKS_PAGE_SIZE}`;
                          const data = await fetchJsonTry([
                            `/api/works-rows${params}`,
                            `http://localhost:4000/api/works-rows${params}`,
                            `http://127.0.0.1:4000/api/works-rows${params}`,
                          ]);
                          if (Array.isArray(data)) {
                            setWorks(data);
                            setWorksPages(1);
                            setWorksTotal(data.length);
                          } else {
                            setWorks(data.items || []);
                            setWorksPages(data.pages || 1);
                            setWorksTotal(data.total || (data.items?.length || 0));
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
                    className="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    onClick={(e) => { e.preventDefault(); openAddModal(); }}
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Добавить работу</span>
                  </button>
                </div>
              </div>
              <Dialog open={modalOpen} onOpenChange={(v) => v ? setModalOpen(true) : setModalOpen(false)}>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Новая работа</DialogTitle>
                    <button
                      className="ml-auto p-1 rounded hover:bg-gray-100"
                      aria-label="Закрыть"
                      onClick={() => setModalOpen(false)}
                    >
                      <span className="material-symbols-outlined text-gray-500">close</span>
                    </button>
                  </DialogHeader>
                  <div className="p-4 space-y-6 text-sm overflow-auto" ref={modalBoxRef}>
                      <div>
                        <div className="text-sm font-medium text-gray-500 mb-2">Размещение</div>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label htmlFor="phase_id">phase_id</Label>
                            <Input id="phase_id" value={modalData.phase_id} onChange={(e)=>setMD('phase_id', e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="phase_name">phase_name</Label>
                            <Input id="phase_name" value={modalData.phase_name} onChange={(e)=>setMD('phase_name', e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="stage_id">stage_id</Label>
                            <Input id="stage_id" value={modalData.stage_id} onChange={(e)=>setMD('stage_id', e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="stage_name">stage_name</Label>
                            <Input id="stage_name" value={modalData.stage_name} onChange={(e)=>setMD('stage_name', e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="substage_id">substage_id</Label>
                            <Input id="substage_id" value={modalData.substage_id} onChange={(e)=>setMD('substage_id', e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="substage_name">substage_name</Label>
                            <Input id="substage_name" value={modalData.substage_name} onChange={(e)=>setMD('substage_name', e.target.value)} />
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-500 mb-2">Детали работы</div>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label htmlFor="work_id">work_id</Label>
                            <Input id="work_id" value={modalData.work_id} onChange={(e)=>setMD('work_id', e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="unit">unit</Label>
                            <Input id="unit" value={modalData.unit} onChange={(e)=>setMD('unit', e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="unit_price">unit_price</Label>
                            <Input id="unit_price" type="number" step="0.01" value={modalData.unit_price} onChange={(e)=>setMD('unit_price', e.target.value)} />
                          </div>
                          <div className="col-span-3">
                            <Label htmlFor="work_name">work_name</Label>
                            <Input id="work_name" value={modalData.work_name} onChange={(e)=>setMD('work_name', e.target.value)} />
                          </div>
                        </div>
                      </div>
                  </div>
                  <DialogFooter align="start">
                    <Button variant="outline" className="rounded-full px-4" onClick={() => setModalOpen(false)}>Отмена</Button>
                    <Button className="rounded-full px-4" onClick={submitAddModal}>Сохранить</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
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
                      .map((w, i) => (
                      w.type === 'group' ? (
                        <tr key={`g-${i}`} className="bg-primary-50 font-bold text-gray-700">
                          <td className="px-2 py-2 text-gray-800">
                            <button
                              className="inline-flex items-center justify-center w-6 h-6 mr-1 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
                              title={collapsed[w.code] ? 'Развернуть' : 'Свернуть'}
                              onClick={() => setCollapsed((prev) => ({ ...prev, [w.code]: !prev[w.code] }))}
                            >{collapsed[w.code] ? '+' : '−'}</button>
                            {w.code}
                          </td>
                          <td className="px-2 py-2 text-gray-800" colSpan={4}>{w.title}</td>
                        </tr>
                      ) : (
                        <tr key={`i-${i}`}>
                          <td className="px-2 py-2 text-gray-800">
                            <input
                              className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0"
                              value={w.code}
                              placeholder="Код"
                              onChange={(e) => updateWork(i, 'code', e.target.value)}
                            />
                          </td>
                          <td className="pl-1 pr-2 py-2 text-gray-800">
                            <input
                              className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0"
                              value={w.name}
                              placeholder="Наименование"
                              onChange={(e) => updateWork(i, 'name', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input
                              className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0"
                              value={w.unit}
                              placeholder="Ед.изм."
                              onChange={(e) => updateWork(i, 'unit', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input
                              className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0"
                              value={(w.price ?? '')}
                              placeholder="Цена руб."
                              onChange={(e) => updateWork(i, 'price', e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button
                              className="text-primary-600 hover:text-primary-700 p-1"
                              title="Сохранить"
                              onClick={() => handleSaveRow(i)}
                            >
                              <span className="material-symbols-outlined">check</span>
                            </button>
                          </td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Пагинация */}
              <div className="p-4 flex items-center justify-between text-sm text-gray-600 border-t border-gray-100">
                <div>
                  Строк: {worksTotal} · Стр.: {worksPage}/{worksPages}
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                    disabled={worksPage <= 1 || worksLoading}
                    onClick={() => setWorksPage(1)}
                  >« Первая</button>
                  <button
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                    disabled={worksPage <= 1 || worksLoading}
                    onClick={() => setWorksPage(p => Math.max(1, p - 1))}
                  >‹ Пред</button>
                  <button
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                    disabled={worksPage >= worksPages || worksLoading}
                    onClick={() => setWorksPage(p => Math.min(worksPages, p + 1))}
                  >След ›</button>
                  <button
                    className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                    disabled={worksPage >= worksPages || worksLoading}
                    onClick={() => setWorksPage(worksPages)}
                  >Последняя »</button>
                </div>
              </div>
            </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                  <h2 className="font-semibold text-lg">Справочник материалов</h2>
                  <button
                    className="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg flex items-center space-x-1 transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      setMaterials((prev) => [
                        ...prev,
                        { code: "", name: "", price: "", imageUrl: "", productUrl: "", unit: "", consumption: "", weight: "" }
                      ]);
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    <span>Добавить материал</span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 text-left">
                      <tr>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Код</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Наименование</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Цена</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">URL Изображения</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">URL на товар</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Ед. изм.</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Расход на ед.</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm">Вес</th>
                        <th className="py-2 px-2 font-medium text-gray-500 text-sm text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {materials.map((m, i) => (
                        <tr key={`m-${i}`}>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.code} placeholder="Код" onChange={(e) => updateMaterial(i, 'code', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.name} placeholder="Наименование" onChange={(e) => updateMaterial(i, 'name', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.price} placeholder="Цена" onChange={(e) => updateMaterial(i, 'price', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.imageUrl} placeholder="URL Изображения" onChange={(e) => updateMaterial(i, 'imageUrl', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.productUrl} placeholder="URL на товар" onChange={(e) => updateMaterial(i, 'productUrl', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.unit} placeholder="Ед. изм." onChange={(e) => updateMaterial(i, 'unit', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.consumption} placeholder="Расход на ед." onChange={(e) => updateMaterial(i, 'consumption', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-gray-800">
                            <input className="w-full bg-transparent py-1 px-2 text-sm focus:outline-none focus:ring-0" value={m.weight} placeholder="Вес" onChange={(e) => updateMaterial(i, 'weight', e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button className="text-primary-600 hover:text-primary-700 p-1" title="Сохранить" onClick={() => handleSaveMaterial(i)}>
                              <span className="material-symbols-outlined">check</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
