// Простые утилиты экспорта данных в CSV с BOM (UTF-8)
// Используйте exportToCSV(data, { headers, filename })

function toCSVRow(values, delimiter = ';') {
  return values.map((v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Экранируем кавычки и оборачиваем, если есть разделитель/перевод строки
    const mustQuote = s.includes(delimiter) || s.includes('\n') || s.includes('"');
    if (mustQuote) {
      s = '"' + s.replaceAll('"', '""') + '"';
    }
    return s;
  }).join(delimiter);
}

export function exportToCSV(rows, options = {}) {
  const {
    headers = [], // массив строк заголовков столбцов
    filename = 'export.csv',
    delimiter = ';',
  } = options;

  const BOM = '\ufeff';
  const lines = [];
  if (headers.length) lines.push(toCSVRow(headers, delimiter));
  for (const r of rows || []) lines.push(toCSVRow(r, delimiter));
  const csv = BOM + lines.join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Пример хелперов формирования строк под конкретные таблицы
export function buildWorksCSVRows(works) {
  // Возвращает массив массивов, готовых для exportToCSV
  // Заголовки в вызывающем месте: ['Код','Наименование','Ед.изм.','Цена']
  return (works || []).filter(w => w.type !== 'group').map(w => [
    w.code ?? '',
    w.name ?? '',
    w.unit ?? '',
    w.price ?? ''
  ]);
}

export function buildMaterialsCSVRows(materials) {
  // Заголовки в вызывающем месте: ['ID','Наименование','Ед.','Цена','Расход','Вес','Изображение','Item URL']
  return (materials || []).map(m => [
    m.id ?? '',
    m.name ?? '',
    m.unit ?? '',
    m.unit_price ?? '',
    m.expenditure ?? '',
    m.weight ?? '',
    m.image_url ?? '',
    m.item_url ?? ''
  ]);
}
