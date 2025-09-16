// Simple weekly calendar using Google Apps Script backend
// Set your deployed Web App URL here
const API_URL = 'https://script.google.com/macros/s/AKfycbw2zEnWPR-XtRDTp0Nm27z_bMwXY-1ccjlMctTa8qL5jGhv3MoS_KILNoRxjem-LKelCg/exec';

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
const DEFAULT_LABEL_LOCALE = 'th-TH-u-ca-gregory';
function gregLabel(d){
  const loc = (typeof LABEL_LOCALE !== 'undefined' && LABEL_LOCALE) ? LABEL_LOCALE : DEFAULT_LABEL_LOCALE;
  return d.toLocaleDateString(loc, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}

// ---------- Calendar UI ----------
let currentWeekStart = startOfWeekMonday(new Date());
let hasAutoJumped = false;
let _activeScheduleAbort = null;
let _scheduleCache = null; // raw schedule array from API
let _normalizedCache = null; // normalized events for fast re-render
let _scheduleFetchedAt = 0;
let _cacheFrom = null;
let _cacheTo = null;

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
    // Instant render from cache, then refresh from server
    renderVisibleFromCache();
    await loadSchedule();
  });
  container.querySelector('#btnNext')?.addEventListener('click', async () => {
    currentWeekStart = addDays(currentWeekStart, 7);
    renderCalendar();
    renderVisibleFromCache();
    await loadSchedule();
  });
  container.querySelector('#btnToday')?.addEventListener('click', async () => {
    currentWeekStart = startOfWeekMonday(new Date());
    renderCalendar();
    renderVisibleFromCache();
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
    const teacherRaw = document.getElementById('modalTeacher').value.trim();
    const teacher = normalizeTeacherLabelClient(teacherRaw);
    const total = parseInt(document.getElementById('modalCourseTotal').value || '0', 10);
    const dateStr = document.getElementById('modalDate').value;
    const timeStr = document.getElementById('modalTime').value;
    if (!code || !name || !teacher || !total || !dateStr || !timeStr) { alert('Please complete all fields'); return; }

    // Send both courseHours and courseTotal for compatibility with backend variants
    await postFormStrict({ action:'addBooking', studentCode: code, studentName: name, teacher, courseHours: total, courseTotal: total, date: dateStr, time: timeStr });
    modalEl.hidden = true; modalForm.reset();
    showToast('บันทึกสำเร็จ');
    await loadSchedule();
  } catch (err) { alert(`❌ Error: ${err?.message || err}`); }
});

// ---------- Data rendering ----------
async function loadSchedule() {
  try {
    // Abort any in-flight schedule request to keep UI snappy on fast nav
    if (_activeScheduleAbort) { try { _activeScheduleAbort.abort(); } catch {} }
    const ac = new AbortController();
    _activeScheduleAbort = ac;

    // Compute visible week range (YYYY-MM-DD)
    const visStart = currentWeekStart;
    const visEnd = addDays(visStart, 6);
    const startY = ymd(visStart);
    const endY = ymd(visEnd);

    // No students sheet anymore; all data comes from schedule

    // If cache covers current range, render immediately (still refresh in background)
    if (_normalizedCache && _cacheFrom && _cacheTo && startY >= _cacheFrom && endY <= _cacheTo) {
      renderVisibleFromCache();
    }

    // Prefetch one week before and after for instant nav
    const preFrom = ymd(addDays(visStart, -7));
    const preTo = ymd(addDays(visEnd, 7));
    let schedule = [];
    try {
      const scheduleRes = await fetch(`${API_URL}?sheet=schedule&from=${encodeURIComponent(preFrom)}&to=${encodeURIComponent(preTo)}`, { cache:'no-store', signal: ac.signal });
      let json = await scheduleRes.json();
      schedule = (json && json.ok && Array.isArray(json.result)) ? json.result : json;
      if (!Array.isArray(schedule)) throw new Error('unexpected schedule shape');
    } catch (e) {
      // Fallback to full fetch if backend does not support range
      const scheduleRes2 = await fetch(`${API_URL}?sheet=schedule`, { cache:'no-store', signal: ac.signal });
      let json2 = await scheduleRes2.json();
      schedule = (json2 && json2.ok && Array.isArray(json2.result)) ? json2.result : json2;
      if (!Array.isArray(schedule)) throw e;
    }

    // Clear only booking containers, keep the "+ Add" buttons and structure
    document.querySelectorAll('.cal-cell .slot-bookings').forEach(box => box.innerHTML = '');

    const normalized = [];
    (schedule||[]).forEach(row => {
      const dateIso = normalizeDateIso(row.Date);
      if (!dateIso) { console.warn('Skip row (bad date):', row); return; }

      const rawTime = normalizeRawTime(row.Time);
      const timeHH = extractStartTimeHH(rawTime);
      if (!timeHH) { console.warn('Skip row (bad time):', row); return; }
      const code = String(row.StudentCode || '');
      const teacher = String(row.Teacher || '');
      const name = String(row.StudentName || '');
      const used = Number(row.CourseUsed || 0) || 0;
      const total = Number((row.CourseTotal != null ? row.CourseTotal : row.CourseHours) || 0) || 0;
      normalized.push({ dateIso, timeHH, rawTime, code, teacher, name, used, total, row });
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

    // Cache latest data and render
    _scheduleCache = schedule || [];
    _normalizedCache = normalized;
    _scheduleFetchedAt = Date.now();
    _cacheFrom = preFrom;
    _cacheTo = preTo;

    // Render only events within current visible week
    normalized
      .filter(ev => ev.dateIso >= startY && ev.dateIso <= endY)
      .forEach((ev) => {
        const { dateIso, timeHH } = ev;
        const cell = document.querySelector(`.cal-cell[data-date="${dateIso}"][data-time="${timeHH}"] .slot-bookings`);
        if (!cell) { console.warn('No matching cell for', dateIso, timeHH, ev.row); return; }
        const el = buildBookingEl(ev);
        cell.appendChild(el);
      });
  } catch (err) {
    if (err?.name === 'AbortError') return; // ignore aborted fetches
    console.error('loadSchedule error', err);
  }
}

// ---------- Fetch helper ----------
async function postFormStrict(data) {
  const form = new URLSearchParams();
  Object.entries(data).forEach(([k,v]) => form.append(k, v == null ? '' : String(v)));
  const res = await fetch(API_URL, {
    method:'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: form.toString()
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ` - ${text.slice(0,150)}` : ''}`);
  try {
    const json = JSON.parse(text);
    if (json && (json.ok === true || json.ok === undefined)) return json;
    throw new Error(json?.error || 'Server returned failure');
  } catch (e) {
    throw new Error(`Invalid response from server: ${text.slice(0,150)}`);
  }
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

// removed +1/-1 booking pop menu
// removed helper for +1/-1
function positionTooltip(el,x,y){ el.style.left = (x+12)+'px'; el.style.top = (y+12)+'px'; }

// removed closeBookingMenu

// No external students cache anymore

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  try { renderCalendar(); } catch (e) { console.error('renderCalendar error', e); }
  try { renderVisibleFromCache(); } catch (e) { /* ignore */ }
  try { loadSchedule(); } catch (e) { console.error('loadSchedule error', e); }
});

// ---------- Presentation helpers ----------
function normalizeTeacherKey(t){
  const s = String(t || '').trim();
  if (!s) return 'others';
  if (s.includes('ครูโทน')) return 'ton';
  if (s.includes('ครูบอย')) return 'boy';
  if (s.includes('ครูหนึ่ง')) return 'nueng';
  if (s.includes('ครูเอก')) return 'ek';
  if (/others/i.test(s) || s.includes('อื่น')) return 'others';
  return 'others';
}

function normalizeTeacherLabelClient(t){
  const s = String(t || '').trim();
  if (!s) return 'Others';
  if (s.indexOf('ครูโทน') !== -1) return 'ครูโทน';
  if (s.indexOf('ครูบอย') !== -1) return 'ครูบอย';
  if (s.indexOf('ครูหนึ่ง') !== -1) return 'ครูหนึ่ง';
  if (s.indexOf('ครูเอก') !== -1) return 'ครูเอก';
  if (/others/i.test(s) || s.indexOf('อื่น') !== -1) return 'Others';
  return 'Others';
}

// Quick client-side render from cached normalized data
function renderVisibleFromCache(){
  if (!_normalizedCache) return;
  // Clear containers
  document.querySelectorAll('.cal-cell .slot-bookings').forEach(box => box.innerHTML = '');
  const start = currentWeekStart; const end = addDays(start, 6);
  const startY = ymd(start); const endY = ymd(end);
  _normalizedCache
    .filter(ev => ev.dateIso >= startY && ev.dateIso <= endY)
    .forEach((ev) => {
      const cell = document.querySelector(`.cal-cell[data-date="${ev.dateIso}"][data-time="${ev.timeHH}"] .slot-bookings`);
      if (!cell) return;
      cell.appendChild(buildBookingEl(ev));
    });
}

// ---------- Notes modal ----------
const notesBtn = document.getElementById('notesBtn');
const notesModal = document.getElementById('notesModal');
const notesClose = document.getElementById('notesClose');
const notesSave = document.getElementById('notesSave');
const notesArea = document.getElementById('notesArea');

function openNotes(){
  if (!notesModal) return;
  try { notesArea.value = localStorage.getItem('notes') || ''; } catch { notesArea.value = ''; }
  notesModal.hidden = false;
}
function closeNotes(){ if (notesModal) notesModal.hidden = true; }
function saveNotes(){ try { localStorage.setItem('notes', notesArea.value || ''); } catch {} closeNotes(); }

notesBtn?.addEventListener('click', openNotes);
notesClose?.addEventListener('click', closeNotes);
notesModal?.addEventListener('click', (e)=>{ if (e.target === notesModal) closeNotes(); });
notesSave?.addEventListener('click', saveNotes);

// ---------- Booking element factory (shared) ----------
function buildBookingEl({ dateIso, timeHH, rawTime, code, teacher, name, used = 0, total = 0 }){
  const el = document.createElement('div');
  const tKey = normalizeTeacherKey(teacher);
  el.className = `booking teacher-${tKey}`;
  el.innerHTML = `<span>(${code}, ${name || ''}, ${teacher})</span>`;

  // Leave button
  const btn = document.createElement('button');
  btn.className = 'leave';
  btn.textContent = 'Leave';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    openLeaveConfirm(async () => {
      btn.disabled = true;
      try {
        // Optimistic: remove the booking box immediately
        const parent = el.parentNode; if (parent) parent.removeChild(el);
        const res = await postFormStrict({ action:'leave', date: dateIso, time: rawTime, teacher: normalizeTeacherLabelClient(teacher), studentCode: code });
        showToast('ทำการลาแล้ว ลบกล่อง และเพิ่มรอบใหม่แล้ว');
        await loadSchedule();
      } catch (err) {
        btn.disabled = false;
        // Restore element if needed
        try { const cell = document.querySelector(`.cal-cell[data-date="${dateIso}"][data-time="${timeHH}"] .slot-bookings`); if (cell) cell.appendChild(el); } catch {}
        alert(`❌ Leave error: ${err?.message || err}`);
      }
    });
  });
  el.appendChild(btn);

  // Move button
  const moveBtn = document.createElement('button');
  moveBtn.className = 'move';
  moveBtn.textContent = 'Move';
  moveBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openMoveModal({ dateIso, timeHH, rawTime, code, teacher, name });
  });
  el.appendChild(moveBtn);

  // Tooltip
  el.addEventListener('mouseenter', (ev) => {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    const remaining = Math.max(0, Number(total||0) - Number(used||0));
    tip.textContent = `Remaining: ${remaining}, Used: ${used}`;
    document.body.appendChild(tip);
    positionTooltip(tip, ev.clientX, ev.clientY);
    el._tip = tip;
  });
  el.addEventListener('mousemove', (ev) => { if (el._tip) positionTooltip(el._tip, ev.clientX, ev.clientY); });
  el.addEventListener('mouseleave', () => { if (el._tip) { el._tip.remove(); el._tip = null; } });

  return el;
}

// ---------- Move modal logic ----------
const moveModal = document.getElementById('moveModal');
const moveForm = document.getElementById('moveForm');
const moveClose = document.getElementById('moveClose');
const moveCode = document.getElementById('moveCode');
const moveTeacher = document.getElementById('moveTeacher');
const moveDate = document.getElementById('moveDate');
const moveTime = document.getElementById('moveTime');
const moveRawTime = document.getElementById('moveRawTime');
let _moveCtx = null;

function openMoveModal(ctx){
  _moveCtx = ctx;
  if (!moveModal) return;
  moveCode.value = ctx.code;
  moveTeacher.value = ctx.teacher;
  moveDate.value = ctx.dateIso;
  moveTime.value = (ctx.timeHH || '00:00');
  moveRawTime.value = ctx.rawTime;
  moveModal.hidden = false;
}
function closeMoveModal(){ if (moveModal) moveModal.hidden = true; _moveCtx = null; }
moveClose?.addEventListener('click', closeMoveModal);
moveModal?.addEventListener('click', (e)=>{ if (e.target === moveModal) closeMoveModal(); });
moveForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!_moveCtx) return closeMoveModal();
  const newTime = moveTime.value;
  if (!newTime) { alert('กรุณาเลือกเวลาใหม่'); return; }
  const { dateIso, rawTime, teacher, code } = _moveCtx;
  try {
    // Optimistic: remove old, add placeholder at new slot
    const oldCell = document.querySelector(`.cal-cell[data-date="${dateIso}"][data-time="${_moveCtx.timeHH}"] .slot-bookings`);
    if (oldCell) {
      const node = [...oldCell.children].find(n => n.classList.contains('booking') && n.textContent.includes(code) && n.textContent.includes(teacher));
      if (node) oldCell.removeChild(node);
    }
    await postFormStrict({ action:'moveBooking', date: dateIso, time: rawTime, newTime, teacher: normalizeTeacherLabelClient(teacher), studentCode: code });
    showToast('ย้ายเวลาเรียบร้อย');
    closeMoveModal();
    await loadSchedule();
  } catch (err) {
    alert(`❌ Move error: ${err?.message || err}`);
  }
});

// ---------- Toast ----------
function showToast(message){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.classList.add('show'); });
  setTimeout(()=>{
    el.classList.remove('show');
    setTimeout(()=>{ try{ el.remove(); }catch{} }, 200);
  }, 2000);
}
