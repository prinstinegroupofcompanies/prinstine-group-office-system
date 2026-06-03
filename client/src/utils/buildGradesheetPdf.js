import { jsPDF } from 'jspdf';

const COMPONENT_HEADERS = [
  { key: 'assignment', label: 'Assignment', max: 10 },
  { key: 'attendance', label: 'Attendance', max: 10 },
  { key: 'presentation', label: 'Presentation', max: 10 },
  { key: 'assessment', label: 'Assessment', max: 20 },
  { key: 'project', label: 'Project', max: 20 },
  { key: 'final_exam', label: 'Final Exam', max: 30 }
];

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function componentValue(grade, key) {
  if (grade.components && grade.components[key] != null) return grade.components[key];
  const map = {
    assignment: grade.score_assignment,
    attendance: grade.score_attendance,
    presentation: grade.score_presentation,
    assessment: grade.score_assessment,
    project: grade.score_project,
    final_exam: grade.score_final_exam
  };
  return map[key] ?? '—';
}

function renderGradeRowHtml(g) {
  const hasBreakdown = g.components || g.score_assignment != null;
  if (!hasBreakdown) {
    return `<tr><td>${escapeHtml(g.course_code)} — ${escapeHtml(g.course_title)}</td><td colspan="8"><strong>${escapeHtml(String(g.grade || g.letter_grade || ''))}</strong></td></tr>`;
  }
  const cells = COMPONENT_HEADERS.map((c) => `<td class="text-center">${escapeHtml(String(componentValue(g, c.key)))}</td>`).join('');
  return `<tr>
    <td>${escapeHtml(g.course_code)} — ${escapeHtml(g.course_title)}</td>
    ${cells}
    <td class="text-center"><strong>${escapeHtml(String(g.average ?? '—'))}</strong></td>
    <td class="text-center"><strong>${escapeHtml(String(g.letter_grade || g.grade || ''))}</strong></td>
  </tr>`;
}

/**
 * Download official Prinstine Academy gradesheet as PDF.
 * @param {Object} payload — from GET /academy/students/.../gradesheet
 */
export function downloadGradesheetPdf(payload) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const margin = 14;
  let y = 16;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(String(payload.academyName || 'Prinstine Academy'), margin, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const dateStr = payload.issuedDate
    ? new Date(payload.issuedDate).toLocaleDateString(undefined, { dateStyle: 'long' })
    : new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
  doc.text(`Date: ${dateStr}`, margin, y);
  y += 5;
  doc.text(`Student: ${payload.studentName || ''}`, margin, y);
  y += 5;
  doc.text(`Student ID: ${payload.studentCode || ''}`, margin, y);
  y += 5;
  const cohort = [payload.cohortName, payload.cohortCode].filter(Boolean).join(' — ');
  doc.text(`Cohort: ${cohort || '—'}`, margin, y);
  y += 8;

  const headers = ['Course', ...COMPONENT_HEADERS.map((c) => c.label), 'Average', 'Letter'];
  const colWidths = [52, 18, 18, 18, 22, 18, 22, 18, 18];
  let x = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  headers.forEach((h, i) => {
    doc.text(h, x, y);
    x += colWidths[i];
  });
  y += 5;
  doc.setFont('helvetica', 'normal');

  (payload.grades || []).forEach((g) => {
    x = margin;
    const row = [
      `${g.course_code || ''} — ${g.course_title || ''}`,
      ...COMPONENT_HEADERS.map((c) => String(componentValue(g, c.key))),
      String(g.average ?? '—'),
      String(g.letter_grade || g.grade || '')
    ];
    row.forEach((cell, i) => {
      const lines = doc.splitTextToSize(String(cell), colWidths[i] - 2);
      doc.text(lines, x, y);
      x += colWidths[i];
    });
    y += 8;
    if (y > 190) {
      doc.addPage();
      y = 16;
    }
  });

  y += 10;
  doc.text('_________________________________', margin, y);
  y += 8;
  doc.text(payload.ceoName || 'Prince S. Cooper', margin, y);
  y += 5;
  doc.text(payload.ceoTitle || 'Chief Executive Officer, Prinstine Academy', margin, y);
  const fname = `gradesheet-${(payload.studentCode || 'student').replace(/[^a-z0-9-_]/gi, '_')}.pdf`;
  doc.save(fname);
}

/**
 * Open a printable HTML view (user can use browser Print to PDF).
 * @param {boolean} autoPrint — if true, opens print dialog
 */
export function openGradesheetPrintWindow(payload, autoPrint = false) {
  const w = window.open('', '_blank');
  if (!w) return;
  const headerCells = COMPONENT_HEADERS.map((c) => `<th>${escapeHtml(c.label)}<br/><small>(${c.max})</small></th>`).join('');
  const rows = (payload.grades || []).map(renderGradeRowHtml).join('');
  const cohort = [payload.cohortName, payload.cohortCode].filter(Boolean).join(' — ') || '—';
  const dateStr = payload.issuedDate
    ? new Date(payload.issuedDate).toLocaleDateString(undefined, { dateStyle: 'long' })
    : new Date().toLocaleDateString(undefined, { dateStyle: 'long' });
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Gradesheet — ${escapeHtml(payload.studentCode)}</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;padding:24px;max-width:960px;margin:0 auto;color:#111;}
    h1{font-size:1.35rem;margin:0 0 8px;}
    .meta{margin:16px 0;line-height:1.6;}
    table{border-collapse:collapse;width:100%;margin-top:16px;font-size:0.85rem;}
    th,td{border:1px solid #ccc;padding:8px;text-align:left;}
    th{background:#f5f5f5;text-align:center;}
    td.text-center{text-align:center;}
    .sig{margin-top:48px;}
    .line{border-top:1px solid #333;width:240px;margin-bottom:8px;}
    @media print { body { padding: 16px; } }
  </style></head><body>
  <h1>${escapeHtml(payload.academyName || 'Prinstine Academy')}</h1>
  <p class="meta"><strong>Date:</strong> ${escapeHtml(dateStr)}<br/>
  <strong>Name:</strong> ${escapeHtml(payload.studentName)}<br/>
  <strong>ID:</strong> ${escapeHtml(payload.studentCode)}<br/>
  <strong>Cohort:</strong> ${escapeHtml(cohort)}</p>
  <table><thead><tr><th>Course</th>${headerCells}<th>Average<br/><small>(100)</small></th><th>Letter Grade</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="sig"><div class="line"></div>
  <p><strong>${escapeHtml(payload.ceoName || 'Prince S. Cooper')}</strong><br/>
  <small>${escapeHtml(payload.ceoTitle || 'Chief Executive Officer, Prinstine Academy')}</small></p></div>
  ${autoPrint ? '<script>window.onload=function(){window.print();}</script>' : ''}
  </body></html>`);
  w.document.close();
}
