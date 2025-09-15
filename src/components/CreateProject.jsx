import React, { useEffect, useState } from 'react';

export default function CreateProject() {
  const [form, setForm] = useState({
    name: '', customer: '', address: '', currency: 'RUB', vat: '20',
    start_date: '', end_date: '', notes: ''
  });
  const [savedSig, setSavedSig] = useState('');
  const [submitState, setSubmitState] = useState({ loading: false, ok: null, msg: '' });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('project:create:form');
      if (raw) setForm(prev => ({ ...prev, ...JSON.parse(raw) }));
  } catch { /* ignore localStorage */ }
  }, []);

  const onChange = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const onSave = () => {
    try {
      localStorage.setItem('project:create:form', JSON.stringify(form));
      setSavedSig('saved:' + Date.now());
  } catch { /* ignore localStorage */ }
  };

  const onCreate = async () => {
    if (!form.name.trim()) {
      setSubmitState({ loading: false, ok: false, msg: 'Укажите название проекта' });
      return;
    }
    setSubmitState({ loading: true, ok: null, msg: '' });
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          customer: form.customer || null,
          address: form.address || null,
          currency: form.currency || 'RUB',
          vat: form.vat === '' ? 0 : Number(form.vat),
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          notes: form.notes || null,
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data && data.error ? data.error : 'Ошибка создания');
      // success
      setSubmitState({ loading: false, ok: true, msg: 'Проект создан' });
      try {
        localStorage.removeItem('project:create:form');
      } catch { /* ignore */ }
      setForm({ name: '', customer: '', address: '', currency: 'RUB', vat: '20', start_date: '', end_date: '', notes: '' });
    } catch (e) {
      setSubmitState({ loading: false, ok: false, msg: e.message || 'Ошибка' });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-lg">Создать проект</h2>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Название проекта</label>
          <input className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" placeholder="Например: Коттедж 250 м²" value={form.name} onChange={e=> onChange('name', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Заказчик</label>
          <input className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" placeholder="ФИО или компания" value={form.customer} onChange={e=> onChange('customer', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Адрес объекта</label>
          <input className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" placeholder="Город, улица, дом" value={form.address} onChange={e=> onChange('address', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Валюта</label>
          <select className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" value={form.currency} onChange={e=> onChange('currency', e.target.value)}>
            <option value="RUB">RUB — ₽</option>
            <option value="USD">USD — $</option>
            <option value="EUR">EUR — €</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">НДС, %</label>
          <input type="number" className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" value={form.vat} onChange={e=> onChange('vat', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Дата начала</label>
          <input type="date" className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" value={form.start_date} onChange={e=> onChange('start_date', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Дата завершения</label>
          <input type="date" className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" value={form.end_date} onChange={e=> onChange('end_date', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Заметки</label>
          <textarea rows={3} className="w-full bg-transparent focus:outline-none border-b border-dashed border-gray-300 focus:border-primary-400 text-sm" placeholder="Любая дополнительная информация" value={form.notes} onChange={e=> onChange('notes', e.target.value)} />
        </div>
      </div>
      <div className="p-4 border-t border-gray-200 flex items-center gap-3">
        <button className="px-4 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700" onClick={onSave}>Сохранить черновик</button>
        {savedSig && <span className="text-xs text-gray-500">Сохранено</span>}
        <div className="flex-1" />
        <button
          className="px-4 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          onClick={onCreate}
          disabled={submitState.loading}
        >{submitState.loading ? 'Создание…' : 'Создать проект'}</button>
        {submitState.msg && (
          <span className={"text-xs " + (submitState.ok ? 'text-emerald-600' : 'text-red-600')}>{submitState.msg}</span>
        )}
      </div>
    </div>
  );
}
