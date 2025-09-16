// Simple weekly calendar using Google Apps Script backend
// Set your deployed Web App URL here
const API_URL = 'PUT_WEB_APP_URL_HERE';

// Locale/Timezone for display
const LOCALE = 'th-TH-u-ca-buddhist';
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

// ---------- Calendar UI ----------
function renderCalendar() {
  const container = document.getElementById('calendar');
  const weekStart = startOfWeekMonday(new Date());
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));

  let html = '<table class="cal-table"><thead><tr><th class="cal-time">Time</th>';
  days.forEach(d => {
    const label = d.toLocaleDateString(LOCALE, { weekday:'short', year:'numeric', month:'short', day:'numeric', timeZone: TIME_ZONE });
    html += `<th>${label}</th>`;
  });
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
  try {
    document.getElementById('modalDateThai').value = d.toLocaleDateString(LOCALE, { year:'numeric', month:'long', day:'numeric', timeZone: TIME_ZONE });
  } catch (_) {
    document.getElementById('modalDateThai').value = `${dd}/${mm}/${yyyy+543}`;
  }
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

    (schedule||[]).forEach(row => {
      const dateIso = String(row.Date || '');
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
renderCalendar();
loadSchedule();

