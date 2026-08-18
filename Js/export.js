/**
 * ═══════════════════════════════════════════════════════════════
 *  export.js — تصدير البيانات | نظام الشكاوى الإلكتروني
 *  مركز القلب والقسطرة القلبية — الجمهورية اليمنية
 *  استشاري التصميم والتطوير الطبي: د/ صلاح الأهدل
 *  الإصدار: 2.0 — 2026
 * ═══════════════════════════════════════════════════════════════
 * 
 *  الوظائف:
 *  • تصدير الشكاوى إلى Excel (.xlsx) باستخدام SheetJS
 *  • تصدير الشكاوى إلى PDF باستخدام jsPDF + autoTable
 *  • تصدير JSON للنسخ الاحتياطي
 *  • طباعة الجدول مباشرة
 *  • تصفية الأعمدة قبل التصدير
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ── مكتبات خارجية (CDN) ───────────────────────
   أضف هذه الأسطر في <head>:
   <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js"></script>
   ────────────────────────────────────────────── */

const Exporter = (() => {

  /* ═══════════════════════════════════════════════
     1. دوال مساعدة
     ═══════════════════════════════════════════════ */

  const STATUS_LABELS = {
    pending: 'قيد الانتظار',
    'in-progress': 'قيد المعالجة',
    resolved: 'تم الحل',
    closed: 'مغلقة',
    rejected: 'مرفوضة'
  };

  const PRIORITY_LABELS = {
    urgent: 'عاجلة',
    high: 'عالية',
    medium: 'متوسطة',
    low: 'منخفضة'
  };

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
  }
function escapeCSV(str) {
  if (str == null || str === undefined) return '';
  const s = String(str).replace(/"/g, '""');
  // نضع بين علامتي اقتباس إذا احتوى على: فاصلة، اقتباس، سطر جديد، أو تاب
  if (/[",\n\r\t]/.test(s)) return `"${s}"`;
  return s;
}

// ── دوال مساعدة للتصدير ──
function arrayToCSV(rows) {
  return rows.map(row => row.map(escapeCSV).join(',')).join('\r\n');
}

function downloadCSV(filename, rows) {
  const bom = '\uFEFF'; // لدعم العربية في Excel
  const csv = bom + arrayToCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
  
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ═══════════════════════════════════════════════
     2. تصدير CSV (بدون مكتبات خارجية)
     ═══════════════════════════════════════════════ */

  function toCSV(complaints, columns = null) {
    const cols = columns || [
      { key: 'id', label: 'رقم الشكوى' },
      { key: 'title', label: 'العنوان' },
      { key: 'category', label: 'الفئة' },
      { key: 'priority', label: 'الأولوية', transform: v => PRIORITY_LABELS[v] || v },
      { key: 'status', label: 'الحالة', transform: v => STATUS_LABELS[v] || v },
      { key: 'submitter', label: 'المرسل' },
      { key: 'email', label: 'البريد الإلكتروني' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'location', label: 'الموقع' },
      { key: 'date', label: 'التاريخ', transform: formatDate },
      { key: 'description', label: 'الوصف' },
      { key: 'repliesCount', label: 'عدد الردود', transform: (_, c) => (c.replies || []).length }
    ];

    // BOM for Arabic Excel
    let csv = '﻿';
    // Header
    csv += cols.map(c => escapeCSV(c.label)).join(',') + '
';
    // Rows
    complaints.forEach(c => {
      csv += cols.map(col => {
        let val = col.key === 'repliesCount' ? (c.replies || []).length : c[col.key];
        if (col.transform) val = col.transform(val, c);
        return escapeCSV(val);
      }).join(',') + '
';
    });

    return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  }

  /* ═══════════════════════════════════════════════
     3. تصدير Excel (.xlsx) باستخدام SheetJS
     ═══════════════════════════════════════════════ */

  function toExcel(complaints, filename = 'شكاوى_مركز_القلب.xlsx') {
    if (typeof XLSX === 'undefined') {
      console.error('❌ مكتبة SheetJS غير محملة. أضف: <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>');
      return false;
    }

    const data = complaints.map(c => ({
      'رقم الشكوى': c.id,
      'العنوان': c.title || '',
      'الفئة': c.category || '',
      'الأولوية': PRIORITY_LABELS[c.priority] || c.priority || '',
      'الحالة': STATUS_LABELS[c.status] || c.status || '',
      'المرسل': c.submitter || '',
      'البريد الإلكتروني': c.email || '',
      'الهاتف': c.phone || '',
      'الموقع': c.location || '',
      'التاريخ': formatDate(c.date),
      'الوصف': c.description || '',
      'عدد الردود': (c.replies || []).length,
      'تاريخ الإنشاء': c.createdAt ? new Date(c.createdAt).toLocaleString('ar-SA') : ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الشكاوى');

    // تنسيق الأعمدة
    const wscols = [
      { wch: 10 }, { wch: 35 }, { wch: 15 }, { wch: 12 },
      { wch: 14 }, { wch: 18 }, { wch: 25 }, { wch: 14 },
      { wch: 20 }, { wch: 16 }, { wch: 50 }, { wch: 12 }, { wch: 20 }
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, filename);
    return true;
  }

  /* ═══════════════════════════════════════════════
     4. تصدير PDF باستخدام jsPDF + autoTable
     ═══════════════════════════════════════════════ */

  function toPDF(complaints, options = {}) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF || !jspdf.jsPDF) {
      console.error('❌ مكتبة jsPDF غير محملة. أضف: <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>');
      return false;
    }

    const doc = new jspdf.jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
      putOnlyUsedFonts: true,
      floatPrecision: 16
    });

    // RTL support
    doc.setR2L(true);

    const title = options.title || 'تقرير الشكاوى — مركز القلب والقسطرة القلبية';
    const subtitle = options.subtitle || `تاريخ التقرير: ${new Date().toLocaleDateString('ar-SA')}`;

    // Header
    doc.setFillColor(139, 0, 0); // crimson
    doc.rect(0, 0, 297, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 148.5, 15, { align: 'center' });

    doc.setTextColor(212, 175, 55); // gold
    doc.setFontSize(10);
    doc.text(subtitle, 148.5, 22, { align: 'center' });

    // Stats summary
    const stats = {
      total: complaints.length,
      pending: complaints.filter(c => c.status === 'pending').length,
      inProgress: complaints.filter(c => c.status === 'in-progress').length,
      resolved: complaints.filter(c => c.status === 'resolved').length
    };

    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    doc.text(`إجمالي: ${stats.total} | معلقة: ${stats.pending} | قيد المعالجة: ${stats.inProgress} | تم الحل: ${stats.resolved}`, 148.5, 32, { align: 'center' });

    // Table
    const headers = [['رقم', 'العنوان', 'الفئة', 'الأولوية', 'الحالة', 'المرسل', 'التاريخ', 'الردود']];
    const body = complaints.map(c => [
      c.id,
      c.title || '',
      c.category || '',
      PRIORITY_LABELS[c.priority] || c.priority || '',
      STATUS_LABELS[c.status] || c.status || '',
      c.submitter || '',
      formatDate(c.date),
      (c.replies || []).length
    ]);

    doc.autoTable({
      head: headers,
      body: body,
      startY: 38,
      theme: 'grid',
      headStyles: {
        fillColor: [139, 0, 0],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        fontSize: 9
      },
      bodyStyles: {
        fontSize: 8,
        halign: 'right',
        textColor: [40, 40, 40]
      },
      alternateRowStyles: {
        fillColor: [250, 248, 245]
      },
      styles: {
        cellPadding: 2,
        overflow: 'linebreak',
        font: 'helvetica'
      },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 55 },
        2: { cellWidth: 22 },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 22, halign: 'center' },
        5: { cellWidth: 28 },
        6: { cellWidth: 22, halign: 'center' },
        7: { cellWidth: 12, halign: 'center' }
      },
      didDrawPage: (data) => {
        // Footer
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `© 2026 وزارة الصحة والبيئة — هيئة مستشفى الثورة العام | صفحة ${data.pageNumber}`,
          148.5, 200, { align: 'center' }
        );
      }
    });

    doc.save(options.filename || `شكاوى_${new Date().toISOString().split('T')[0]}.pdf`);
    return true;
  }

  /* ═══════════════════════════════════════════════
     5. تصدير JSON (نسخ احتياطي)
     ═══════════════════════════════════════════════ */

  function toJSON(complaints, filename = 'backup_complaints.json') {
    const data = {
      exportedAt: new Date().toISOString(),
      version: '2.0',
      app: 'نظام الشكاوى — مركز القلب والقسطرة',
      total: complaints.length,
      complaints: complaints
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
    return true;
  }

  /* ═══════════════════════════════════════════════
     6. طباعة الجدول
     ═══════════════════════════════════════════════ */

  function printTable(complaints, containerSelector = '#complaintsBody') {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('يرجى السماح بفتح النوافذ المنبثقة للطباعة');
      return false;
    }

    const rows = complaints.map(c => `
      <tr>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${c.id}</td>
        <td style="border:1px solid #ddd;padding:8px">${c.title || ''}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${c.category || ''}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${PRIORITY_LABELS[c.priority] || ''}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${STATUS_LABELS[c.status] || ''}</td>
        <td style="border:1px solid #ddd;padding:8px">${c.submitter || ''}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center">${formatDate(c.date)}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>طباعة الشكاوى</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
          body{font-family:'Cairo',sans-serif;margin:20px;color:#333}
          h1{color:#8B0000;text-align:center;font-size:22px;margin-bottom:5px}
          .subtitle{text-align:center;color:#666;font-size:12px;margin-bottom:20px}
          table{width:100%;border-collapse:collapse;font-size:11px}
          th{background:#8B0000;color:#fff;padding:10px;text-align:center;font-weight:700}
          td{border:1px solid #ddd;padding:8px}
          tr:nth-child(even){background:#f9f9f9}
          .footer{text-align:center;margin-top:20px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:10px}
        </style>
      </head>
      <body>
        <h1>تقرير الشكاوى — مركز القلب والقسطرة القلبية</h1>
        <div class="subtitle">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA')}</div>
        <table>
          <thead>
            <tr>
              <th>رقم</th><th>العنوان</th><th>الفئة</th><th>الأولوية</th><th>الحالة</th><th>المرسل</th><th>التاريخ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="footer">© 2026 وزارة الصحة والبيئة — هيئة مستشفى الثورة العام</div>
        <script>window.onload=function(){setTimeout(function(){window.print();},500);}<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
    return true;
  }

  /* ═══════════════════════════════════════════════
     7. واجهة برمجية موحدة
     ═══════════════════════════════════════════════ */

  return {
    // التصدير
    toCSV,
    toExcel,
    toPDF,
    toJSON,
    printTable,

    // دوال مساعدة
    formatDate,
    STATUS_LABELS,
    PRIORITY_LABELS,

    // تصدير سريع (مع complaints من DB)
    async exportExcel(complaints = null, filename) {
      const data = complaints || (await DB.getAllComplaints());
      return toExcel(data, filename);
    },
    async exportPDF(complaints = null, options) {
      const data = complaints || (await DB.getAllComplaints());
      return toPDF(data, options);
    },
    async exportJSON(complaints = null, filename) {
      const data = complaints || (await DB.getAllComplaints());
      return toJSON(data, filename);
    },
    async exportCSV(complaints = null, filename = 'shakawa.csv') {
      const data = complaints || (await DB.getAllComplaints());
      const blob = toCSV(data);
      downloadBlob(blob, filename);
      return true;
    }
  };

})();

// Global access
if (typeof window !== 'undefined') {
  window.Exporter = Exporter;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Exporter };
}