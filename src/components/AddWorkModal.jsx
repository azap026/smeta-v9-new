import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Label, Input, Button } from './ui/form';

// Создаем портал для модальных окон, если он еще не существует
let modalRoot = document.getElementById('modal-root');
if (!modalRoot) {
  modalRoot = document.createElement('div');
  modalRoot.setAttribute('id', 'modal-root');
  document.body.appendChild(modalRoot);
}

const AddWorkModal = ({ isOpen, onClose, onSave }) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const modalRef = useRef(null);
  const [hasCentered, setHasCentered] = useState(false);

  // Состояние формы
  const [workId, setWorkId] = useState('');
  const [workName, setWorkName] = useState('');
  const [unit, setUnit] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [stageId, setStageId] = useState('');
  const [substageId, setSubstageId] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Центрирование окна при первом открытии
  useEffect(() => {
    if (isOpen && modalRef.current && !hasCentered) {
      const { width, height } = modalRef.current.getBoundingClientRect();
      setPosition({
        x: window.innerWidth / 2 - width / 2,
        y: window.innerHeight / 2 - height / 2,
      });
      setHasCentered(true);
    }
    if (!isOpen) {
      setHasCentered(false); // Сбрасываем при закрытии
    }
  }, [isOpen, hasCentered]);


  const handleMouseDown = (e) => {
    // Перетаскивание только за заголовок
    if (e.target.dataset.dragHandle) {
      setIsDragging(true);
      dragStartPos.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStartPos.current.x,
        y: e.clientY - dragStartPos.current.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!workId || !workName) {
      setError('Код работы и Наименование обязательны.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/upsert-work-ref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_id: workId,
          work_name: workName,
          unit,
          unit_price: unitPrice || null,
          phase_id: phaseId || null,
          stage_id: stageId || null,
          substage_id: substageId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Ошибка сервера');
      }
      onSave(); // Вызываем колбэк для обновления данных в App
      onClose(); // Закрываем окно
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={modalRef}
      className="fixed top-0 left-0 bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col"
      style={{
        transform: hasCentered ? `translate(${position.x}px, ${position.y}px)` : 'translate(-100%, -100%)', // Скрываем до центрирования
        width: '500px',
        zIndex: 1000,
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className="px-4 py-3 border-b border-gray-200 flex items-center justify-between cursor-move"
        data-drag-handle="true"
      >
        <h3 className="text-base font-semibold" data-drag-handle="true">Добавить новую работу</h3>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100">
          <span className="material-symbols-outlined text-xl">close</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
        <div>
          <Label htmlFor="work_id">Код работы (ID)</Label>
          <Input id="work_id" value={workId} onChange={(e) => setWorkId(e.target.value)} placeholder="например, 1.1.1" required />
        </div>
        <div>
          <Label htmlFor="work_name">Наименование работы</Label>
          <Input id="work_name" value={workName} onChange={(e) => setWorkName(e.target.value)} placeholder="например, Устройство стяжки" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="unit">Ед. изм.</Label>
            <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="м2" />
          </div>
          <div>
            <Label htmlFor="unit_price">Цена за ед.</Label>
            <Input id="unit_price" type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="1000" />
          </div>
        </div>
        <hr/>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="phase_id">ID Фазы</Label>
            <Input id="phase_id" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} placeholder="Фаза (необязательно)" />
          </div>
          <div>
            <Label htmlFor="stage_id">ID Стадии</Label>
            <Input id="stage_id" value={stageId} onChange={(e) => setStageId(e.target.value)} placeholder="Стадия (необязательно)" />
          </div>
          <div>
            <Label htmlFor="substage_id">ID Подстадии</Label>
            <Input id="substage_id" value={substageId} onChange={(e) => setSubstageId(e.target.value)} placeholder="Подстадия (необязательно)" />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={isSaving}>Отмена</Button>
        <Button onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </div>,
    modalRoot
  );
};

export default AddWorkModal;
