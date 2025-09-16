// Simple weekly calendar using Google Apps Script backend
// Set your deployed Web App URL here
const API_URL = 'https://script.google.com/macros/s/AKfycbwo976Quil2jt7jRj2VjfGr0lbxXhyqbGsfU5oC3AsaphHUK8ZI_S0__5ImII1sEF8/exec';

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
let hasAutoJumped = false;

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
      html += `<td class="cal-cell" data-date="${dateIso}" data-time="${timeHH}">`
           +  `<div class="cell-actions"><button class="add-btn" data-date="${dateIso}" data-time="${timeHH}">+ Add</button></div>`
           +  `<div class="slot-bookings"></div>`
           +  `</td>`;
    });
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  // Add booking buttons
  container.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddModal(btn.getAttribute('data-date'), btn.getAttribute('data-time'));
    });
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
    // Cache full students map for tooltips
    _studentsCache = new Map((students||[]).map(s => [String(s.Code), s]));

    // Clear cells
    document.querySelectorAll('.cal-cell').forEach(cell => cell.innerHTML = '');

    // Compute current visible week range (YYYY-MM-DD)
    const start = currentWeekStart;
    const end = addDays(start, 6);
    const startY = ymd(start);
    const endY = ymd(end);

    const normalized = [];
    (schedule||[]).forEach(row => {
      const dateIso = normalizeDateIso(row.Date);
      if (!dateIso) { console.warn('Skip row (bad date):', row); return; }

      const rawTime = normalizeRawTime(row.Time);
      const timeHH = extractStartTimeHH(rawTime);
      if (!timeHH) { console.warn('Skip row (bad time):', row); return; }
      const code = String(row.StudentCode || '');
      const teacher = String(row.Teacher || '');
      const name = nameByCode.get(code) || '';
      normalized.push({ dateIso, timeHH, rawTime, code, teacher, name, row });
    });

    // Auto-jump to week that has data if current week has none
    const hasInCurrentWeek = normalized.some(ev => ev.dateIso >= startY && ev.dateIso <= endY);
    if (!hasInCurrentWeek && normalized.length > 0 && !hasAutoJumped) {
      // Prefer nearest upcoming date; otherwise use earliest
      const todayIso = ymd(new Date());
      let targetDateIso = normalized
        .filter(ev => ev.dateIso >= todayIso)
        .map(ev => ev.dateIso)
        .sort()[0];
      if (!targetDateIso) {
        targetDateIso = normalized.map(ev => ev.dateIso).sort()[0];
      }
      const targetDate = new Date(targetDateIso);
      if (!isNaN(targetDate.getTime())) {
        currentWeekStart = startOfWeekMonday(targetDate);
        hasAutoJumped = true;
        renderCalendar();
        await loadSchedule();
        return;
      }
    }

    // Render only events within current visible week
    normalized
      .filter(ev => ev.dateIso >= startY && ev.dateIso <= endY)
      .forEach(({ dateIso, timeHH, rawTime, code, teacher, name, row }) => {
        const cell = document.querySelector(`.cal-cell[data-date="${dateIso}"][data-time="${timeHH}"] .slot-bookings`);
        if (!cell) { console.warn('No matching cell for', dateIso, timeHH, row); return; }
        const el = document.createElement('div');
        el.className = 'booking';
        el.innerHTML = `<span>(${code}, ${name}, ${teacher})</span>`;
        const btn = document.createElement('button');
        btn.className = 'leave';
        btn.textContent = 'Leave';
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // Confirm leave once per booking
          openLeaveConfirm(async () => {
            btn.disabled = true;
            try { await postFormStrict({ action:'leave', date: dateIso, time: rawTime, teacher, studentCode: code }); await loadSchedule(); }
            catch (err) { btn.disabled = false; alert(`❌ Leave error: ${err?.message || err}`); }
          });
          catch (err) { alert(`❌ Leave error: ${err?.message || err}`); }
        });
        el.appendChild(btn);

        // Booking time adjust menu on click (popover)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          showBookingMenu(ev.clientX, ev.clientY, async (delta) => {
            const newStart = shiftHour(timeHH, delta);
            if (!newStart) return;
            try {
              // Requires server support: action=moveBooking
              await postFormStrict({ action:'moveBooking', date: dateIso, time: rawTime, newTime: newStart, teacher, studentCode: code });
              await loadSchedule();
            } catch (err) {
              alert('Server does not support moveBooking yet. Please update Apps Script.');
            }
          });
        });

        // Tooltip on hover
        el.addEventListener('mouseenter', (ev) => {
          const tip = document.createElement('div');
          tip.className = 'tooltip';
          const info = getStudentInfo(code);
          const used = (info && Number(info.CourseUsed)) || 0;
          const total = (info && Number(info.CourseTotal)) || 0;
          const remaining = total ? Math.max(0, total - used) : 'N/A';
          tip.textContent = `Used: ${used} | Remaining: ${remaining}`;
          document.body.appendChild(tip);
          positionTooltip(tip, ev.clientX, ev.clientY);
          el._tip = tip;
        });
        el.addEventListener('mousemove', (ev) => {
          if (el._tip) positionTooltip(el._tip, ev.clientX, ev.clientY);
        });
        el.addEventListener('mouseleave', () => {
          if (el._tip) { el._tip.remove(); el._tip = null; }
        });
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

// ---------- Normalizers ----------
function normalizeDateIso(val) {
  if (val == null) return '';
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : ymd(val);
  const s = String(val).trim();
  if (!s) return '';
  // ISO with time
  if (s.includes('T')) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? '' : ymd(d);
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try YYYY/MM/DD
  let m = s.match(/^(\d{4})[\/](\d{1,2})[\/](\d{1,2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    return isNaN(d.getTime()) ? '' : ymd(d);
  }
  // Try DD/MM/YYYY
  m = s.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));
    return isNaN(d.getTime()) ? '' : ymd(d);
  }
  // Fallback parse
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : ymd(d);
}

function normalizeRawTime(val) {
  if (val == null) return '';
  if (val instanceof Date) {
    const hh = String(val.getHours()).padStart(2,'0');
    const mm = String(val.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }
  // Strip common Thai suffixes and spaces
  return String(val).replace(/น\.|น|โมง|\s+/g,' ').trim();
}

function extractStartTimeHH(rawTime) {
  if (!rawTime) return '';
  const s = rawTime.replace(/[–—]/g, '-');
  // Extract first HH:mm or HH.mm or HHmm
  let m = s.match(/(\d{1,2})[:\.](\d{2})/);
  if (!m) {
    m = s.match(/\b(\d{1,2})(\d{2})\b/); // e.g., 1700 => 17:00
  }
  if (!m) return '';
  let hh = Number(m[1]);
  let mm = Number(m[2] || 0);
  if (isNaN(hh) || isNaN(mm)) return '';
  // Align to top of the hour since rows are hourly
  hh = Math.max(0, Math.min(23, hh));
  const hhStr = String(hh).padStart(2,'0');
  return `${hhStr}:00`;
}

// ---------- Leave confirm + booking menu + tooltip helpers ----------
const leaveModal = document.getElementById('leaveModal');
const leaveConfirmBtn = document.getElementById('leaveConfirm');
const leaveCancelBtn = document.getElementById('leaveCancel');
const leaveCloseBtn = document.getElementById('leaveClose');
let leaveCallback = null;
function openLeaveConfirm(cb){ leaveCallback = cb; if (leaveModal) leaveModal.hidden = false; }
leaveConfirmBtn?.addEventListener('click', async ()=>{ if (leaveModal) leaveModal.hidden = true; const cb = leaveCallback; leaveCallback = null; if (cb) await cb(); });
leaveCancelBtn?.addEventListener('click', ()=>{ if (leaveModal) leaveModal.hidden = true; leaveCallback = null; });
leaveCloseBtn?.addEventListener('click', ()=>{ if (leaveModal) leaveModal.hidden = true; leaveCallback = null; });

function showBookingMenu(x,y,onChoose){
  const menu = document.createElement('div');
  menu.className = 'booking-menu';
  const plus = document.createElement('button'); plus.textContent = '+1 hour';
  const minus = document.createElement('button'); minus.textContent = '-1 hour';
  plus.addEventListener('click', ()=>{ document.body.removeChild(menu); onChoose(+1); });
  minus.addEventListener('click', ()=>{ document.body.removeChild(menu); onChoose(-1); });
  menu.appendChild(minus); menu.appendChild(plus);
  document.body.appendChild(menu);
  menu.style.left = (x+10)+'px'; menu.style.top = (y+10)+'px';
}
function shiftHour(timeHH, delta){
  const m = String(timeHH).match(/^(\d{1,2}):(\d{2})$/); if (!m) return '';
  let h = Number(m[1]) + delta; if (h<0||h>23) return '';
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}
function positionTooltip(el,x,y){ el.style.left = (x+12)+'px'; el.style.top = (y+12)+'px'; }

// Keep reference to student info for tooltip
let _studentsCache = null;
function getStudentInfo(code){
  if (!_studentsCache) return null;
  return _studentsCache.get(String(code)) || null;
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  try { renderCalendar(); } catch (e) { console.error('renderCalendar error', e); }
  try { loadSchedule(); } catch (e) { console.error('loadSchedule error', e); }
});
