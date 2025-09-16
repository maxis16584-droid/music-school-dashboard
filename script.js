// Simple weekly calendar using Google Apps Script backend
// Set your deployed Web App URL here
const API_URL = 'https://script.google.com/macros/s/AKfycbxRJOcKdTcv8Sae6HSuUTcySlNlZu-UmDE6DjvuSKuBhyZAFk_I-0jsibJnTyuAo-p3/exec';

// Timezone for display (dates rendered manually in Gregorian)
const TIME_ZONE = 'Asia/Bangkok';
const START_HOUR = 13;
const END_HOUR = 20;

// ---------- Date helpers ----------
function startOfWeekMonday(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay(); // 0..6 (Sun..Sat)
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d) { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
// Use Thai labels with Gregorian year (or swap to 'en-GB'/'en-US' as desired)
const LABEL_LOCALE = 'th-TH-u-ca-gregory';
function gregLabel(d){
  return d.toLocaleDateString(LABEL_LOCALE, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}

// ---------- Calendar UI ----------
let currentWeekStart = startOfWeekMonday(new Date());

function renderCalendar() {
  const container = document.getElementById('calendar');
  const weekStart = currentWeekStart;
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));

  // Week range label in Gregorian, e.g., Mon, 15 Sep 2025 – Sun, 21 Sep 2025
  const startLabel = gregLabel(days[0]);
  const endLabel = gregLabel(days[6]);

  let html = '';
  html += `<div class="cal-nav" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0 8px;">
    <div style="display:flex;gap:6px;">
      <button id="btnPrev" class="btn-primary" type="button">◀ Prev</button>
      <button id="btnToday" class="btn-primary" type="button">This week</button>
      <button id="btnNext" class="btn-primary" type="button">Next ▶</button>
    </div>
    <div style="font-weight:600;">${startLabel} – ${endLabel}</div>
  </div>`;

  html += '<table class="cal-table"><thead><tr><th class="cal-time">Time</th>';
  days.forEach(d => { html += `<th>${gregLabel(d)}</th>`; });
  html += '</tr></thead><tbody>';

  for (let h = START_HOUR; h <= END_HOUR; h++) {
    html += '<tr>';
    html += `<td class="cal-time">${String(h).padStart(2,'0')}:00</td>`;
    days.forEach(d => {
      const dateIso = ymd(d);
      const timeHH = `${String(h).padStart(2,'0')}:00`;
      html += `<td class="cal-cell" data-date="${dateIso}" data-time="${timeHH}"></td>`;
    });
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  // Clicking a cell opens modal with prefilled date/time
  container.querySelectorAll('.cal-cell').forEach(cell => {
    cell.addEventListener('click', () => openAddModal(cell.getAttribute('data-date'), cell.getAttribute('data-time')));
  });

  // Week navigation
  container.querySelector('#btnPrev')?.addEventListener('click', async () => {
    currentWeekStart = addDays(currentWeekStart, -7);
    renderCalendar();
    await loadSchedule();
  });
  container.querySelector('#btnNext')?.addEventListener('click', async () => {
    currentWeekStart = addDays(currentWeekStart, 7);
    renderCalendar();
    await loadSchedule();
  });
  container.querySelector('#btnToday')?.addEventListener('click', async () => {
    currentWeekStart = startOfWeekMonday(new Date());
    renderCalendar();
    await loadSchedule();
  });
}

// ---------- Modal logic ----------
const modalEl = document.getElementById('addModal');
const modalForm = document.getElementById('modalForm');
const modalClose = document.getElementById('modalClose');

function openAddModal(dateIso, timeHH) {
  if (!modalEl) return;
  const d = new Date(dateIso);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  document.getElementById('modalDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('modalTime').value = timeHH;
  // Show Gregorian YYYY-MM-DD in the visible field as well
  document.getElementById('modalDateThai').value = ymd(d);
  modalEl.hidden = false;
}
modalClose?.addEventListener('click', () => modalEl.hidden = true);
modalEl?.addEventListener('click', (e) => { if (e.target === modalEl) modalEl.hidden = true; });

modalForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const code = document.getElementById('modalCode').value.trim();
    const name = document.getElementById('modalName').value.trim();
    const teacher = document.getElementById('modalTeacher').value.trim();
    const total = parseInt(document.getElementById('modalCourseTotal').value || '0', 10);
    const dateStr = document.getElementById('modalDate').value;
    const timeStr = document.getElementById('modalTime').value;
    if (!code || !name || !teacher || !total || !dateStr || !timeStr) { alert('Please complete all fields'); return; }

    await postFormStrict({ action:'addBooking', studentCode: code, studentName: name, teacher, courseHours: total, date: dateStr, time: timeStr });
    modalEl.hidden = true; modalForm.reset();
    await loadSchedule();
  } catch (err) { alert(`❌ Error: ${err?.message || err}`); }
});

// ---------- Data rendering ----------
async function loadSchedule() {
  try {
    const [scheduleRes, studentsRes] = await Promise.all([
      fetch(`${API_URL}?sheet=schedule`, { cache:'no-store' }),
      fetch(`${API_URL}?sheet=students`, { cache:'no-store' }),
    ]);
    const [schedule, students] = await Promise.all([scheduleRes.json(), studentsRes.json()]);
    const nameByCode = new Map((students||[]).map(s => [String(s.Code), String(s.Name||'')]));

    // Clear cells
    document.querySelectorAll('.cal-cell').forEach(cell => cell.innerHTML = '');

    // Compute current visible week range (YYYY-MM-DD)
    const start = currentWeekStart;
    const end = addDays(start, 6);
    const startY = ymd(start);
    const endY = ymd(end);

    (schedule||[]).forEach(row => {
      const dateIso = String(row.Date || '');
      // Filter only rows within the visible week
      if (dateIso < startY || dateIso > endY) return;
      const rawTime = String(row.Time || '');
      const timeHH = rawTime.split('-')[0].trim();
      const code = String(row.StudentCode || '');
      const teacher = String(row.Teacher || '');
      const name = nameByCode.get(code) || '';

      const cell = document.querySelector(`.cal-cell[data-date="${dateIso}"][data-time="${timeHH}"]`);
      if (!cell) return;
      const el = document.createElement('div');
      el.className = 'booking';
      el.innerHTML = `<span>(${code}, ${name}, ${teacher})</span>`;
      const btn = document.createElement('button');
      btn.className = 'leave';
      btn.textContent = 'Leave';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await postFormStrict({ action:'leave', date: dateIso, time: rawTime, teacher, studentCode: code }); await loadSchedule(); }
        catch (err) { alert(`❌ Leave error: ${err?.message || err}`); }
      });
      el.appendChild(btn);
      cell.appendChild(el);
    });
  } catch (err) { console.error('loadSchedule error', err); }
}

// ---------- Fetch helper ----------
async function postFormStrict(data) {
  const form = new URLSearchParams();
  Object.entries(data).forEach(([k,v]) => form.append(k, v == null ? '' : String(v)));
  const res = await fetch(API_URL, { method:'POST', body: form });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ` - ${text.slice(0,150)}` : ''}`);
  try { const json = JSON.parse(text); if (json && json.ok !== false) return json; throw new Error(json?.error || 'Server returned failure'); }
  catch { return text; }
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  try { renderCalendar(); } catch (e) { console.error('renderCalendar error', e); }
  try { loadSchedule(); } catch (e) { console.error('loadSchedule error', e); }
});
