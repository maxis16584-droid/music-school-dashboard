// Simple weekly calendar using Google Apps Script backend
// Set your deployed Web App URL here
const API_URL = 'https://script.google.com/macros/s/AKfycbyA9UvKbpmOIWi0JGrf2cU8ut8y7RML5slfaycvUZ418GuXSNcsl5CKpjV0WbAZqJHqaQ/exec';

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
// Fast lookup for calendar cells (key: `${dateIso}|${timeHH}` -> `.slot-bookings` element)
let _cellMap = null; // key -> array of `.slot-bookings` containers for that slot
let _loadingCount = 0;
let _cacheDirty = true;

function beginLoading(){
  _loadingCount += 1;
  updateSpinnerVisibility();
}
function endLoading(){
  if (_loadingCount > 0) _loadingCount -= 1;
  updateSpinnerVisibility();
}
function updateSpinnerVisibility(){
  const spinner = document.getElementById('loadingSpinner');
  if (!spinner) return;
  spinner.hidden = _loadingCount <= 0;
}

function markCacheDirty(){ _cacheDirty = true; }

function renderCalendar() {
  const container = document.getElementById('calendar');
  if (!container) return;
  const weekStart = currentWeekStart;
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
  const todayIso = ymd(new Date());

  // Week range label in Gregorian, e.g., Mon, 15 Sep 2025 – Sun, 21 Sep 2025
  const startLabel = gregLabel(days[0]);
  const endLabel = gregLabel(days[6]);

  const dayMeta = days.map(d => {
    const iso = ymd(d);
    const isToday = (iso === todayIso);
    const weekdayShort = d.toLocaleDateString(DEFAULT_LABEL_LOCALE, { weekday: 'short' });
    const weekdayLong = d.toLocaleDateString(DEFAULT_LABEL_LOCALE, { weekday: 'long' });
    const dayNumber = d.toLocaleDateString(DEFAULT_LABEL_LOCALE, { day: 'numeric' });
    const monthShort = d.toLocaleDateString(DEFAULT_LABEL_LOCALE, { month: 'short' });
    const headerDate = `${dayNumber} ${monthShort}`;
    const year = d.getFullYear();
    return { iso, isToday, weekdayShort, weekdayLong, headerDate, year };
  });

  let html = '';
  html += `<div class="cal-nav">
    <div class="cal-nav__buttons">
      <button id="btnPrev" class="btn-primary" type="button">◀ Prev</button>
      <button id="btnToday" class="btn-primary" type="button">This week</button>
      <button id="btnNext" class="btn-primary" type="button">Next ▶</button>
    </div>
    <div class="cal-nav__range" aria-live="polite">${startLabel} – ${endLabel}</div>
  </div>`;

  html += '<div class="cal-table-wrap"><table class="cal-table"><thead><tr><th class="cal-time">Time</th>';
  dayMeta.forEach(meta => {
    const cls = meta.isToday ? ' class="is-today"' : '';
    const aria = `${meta.weekdayLong} ${meta.headerDate} ${meta.year}`;
    html += `<th data-date="${meta.iso}" data-day="${meta.weekdayLong}"${cls} aria-label="${aria}">`
         +  `<span class="cal-header__dow">${meta.weekdayShort}</span>`
         +  `<span class="cal-header__date">${meta.headerDate}</span>`
         +  `<span class="cal-header__year">${meta.year}</span>`
         +  `</th>`;
  });
  html += '</tr></thead><tbody>';

  for (let h = START_HOUR; h <= END_HOUR; h++) {
    html += '<tr>';
    html += `<td class="cal-time">${String(h).padStart(2,'0')}:00</td>`;
    dayMeta.forEach(meta => {
      const timeHH = `${String(h).padStart(2,'0')}:00`;
      html += `<td class="cal-cell${meta.isToday ? ' is-today' : ''}" data-date="${meta.iso}" data-time="${timeHH}" data-day="${meta.weekdayLong}" data-day-short="${meta.weekdayShort}" data-date-label="${meta.headerDate}">`
           +  `<div class="cell-actions"><button class="add-btn" data-date="${meta.iso}" data-time="${timeHH}">+ Add</button></div>`
           +  `<div class="slot-bookings"></div>`
           +  `</td>`;
    });
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  html += '<div class="cal-stack" aria-live="polite">';
  dayMeta.forEach(meta => {
    const todayClass = meta.isToday ? ' is-today' : '';
    html += `<section class="cal-stack__day${todayClass}" data-date="${meta.iso}" data-day="${meta.weekdayLong}" aria-label="${meta.weekdayLong} ${meta.headerDate} ${meta.year}">`
         +  `<header class="cal-stack__header">`
         +    `<div class="cal-stack__heading">`
         +      `<span class="cal-stack__dow">${meta.weekdayShort}</span>`
         +      `<span class="cal-stack__date">${meta.headerDate}</span>`
         +    `</div>`
         +    `<span class="cal-stack__year">${meta.year}</span>`
         +  `</header>`
         +  `<div class="cal-stack__slots">`;
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const timeHH = `${String(h).padStart(2,'0')}:00`;
      html += `<article class="cal-stack__slot" data-date="${meta.iso}" data-time="${timeHH}">`
           +    `<div class="cal-stack__slot-head">`
           +      `<span class="cal-stack__time">${timeHH}</span>`
           +      `<button class="add-btn" data-date="${meta.iso}" data-time="${timeHH}">+ Add</button>`
           +    `</div>`
           +    `<div class="slot-bookings"></div>`
           +  `</article>`;
    }
    html +=   `</div>`
         + `</section>`;
  });
  html += '</div>';

  container.innerHTML = html;

  // Index cells for O(1) lookup during rendering
  _cellMap = new Map();
  const registerCell = (dateIso, timeHH, box) => {
    if (!dateIso || !timeHH || !box) return;
    const key = `${dateIso}|${timeHH}`;
    if (!_cellMap.has(key)) _cellMap.set(key, []);
    _cellMap.get(key).push(box);
  };
  container.querySelectorAll('.cal-cell').forEach(cell => {
    registerCell(
      cell.getAttribute('data-date'),
      cell.getAttribute('data-time'),
      cell.querySelector('.slot-bookings')
    );
  });
  container.querySelectorAll('.cal-stack__slot').forEach(slot => {
    registerCell(
      slot.getAttribute('data-date'),
      slot.getAttribute('data-time'),
      slot.querySelector('.slot-bookings')
    );
  });

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
    markCacheDirty();
    await loadSchedule();
  } catch (err) { alert(`❌ Error: ${err?.message || err}`); }
});

// ---------- Data rendering ----------
async function loadSchedule() {
  let spinnerStarted = false;
  try {
    // Abort any in-flight schedule request to keep UI snappy on fast nav
    if (_activeScheduleAbort) { try { _activeScheduleAbort.abort(); } catch {} }
    _activeScheduleAbort = null;

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

    // Prefetch 5 days before and 15 days after for instant nav
    const preFrom = ymd(addDays(visStart, -5));
    const preTo = ymd(addDays(visEnd, 15));

    const needsFetch =
      _cacheDirty ||
      !_normalizedCache ||
      !_cacheFrom || !_cacheTo ||
      preFrom < _cacheFrom ||
      preTo > _cacheTo;

    if (!needsFetch) {
      return;
    }

    beginLoading();
    spinnerStarted = true;

    const ac = new AbortController();
    _activeScheduleAbort = ac;
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

    // Clear only booking containers using the indexed map
    if (_cellMap) {
      _cellMap.forEach(list => {
        list.forEach(box => { box.textContent = ''; });
      });
    }

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
    const prevCache = Array.isArray(_normalizedCache) ? _normalizedCache : [];
    const preserved = prevCache.filter(ev => ev.dateIso < preFrom || ev.dateIso > preTo);
    _normalizedCache = preserved.concat(normalized);
    _scheduleFetchedAt = Date.now();
    _cacheFrom = (!_cacheFrom || preFrom < _cacheFrom) ? preFrom : _cacheFrom;
    _cacheTo = (!_cacheTo || preTo > _cacheTo) ? preTo : _cacheTo;
    _cacheDirty = false;

    // Render only events within current visible week (batch by cell to reduce reflows)
    const groups = new Map(); // key -> array of events
    for (const ev of normalized) {
      if (ev.dateIso < startY || ev.dateIso > endY) continue;
      const key = `${ev.dateIso}|${ev.timeHH}`;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(ev);
    }
    groups.forEach((list, key) => {
      const cells = _cellMap ? _cellMap.get(key) : null;
      if (!cells) return;
      cells.forEach(box => {
        const frag = document.createDocumentFragment();
        for (const ev of list) frag.appendChild(buildBookingEl(ev));
        box.appendChild(frag);
      });
    });
    refreshDataModals();
  } catch (err) {
    if (err?.name === 'AbortError') return; // ignore aborted fetches
    console.error('loadSchedule error', err);
  } finally {
    _activeScheduleAbort = null;
    if (spinnerStarted) endLoading();
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
  // Clear containers via indexed map
  if (_cellMap) {
    _cellMap.forEach(list => {
      list.forEach(box => { box.textContent = ''; });
    });
  }
  const start = currentWeekStart; const end = addDays(start, 6);
  const startY = ymd(start); const endY = ymd(end);
  // Batch DOM appends per cell
  const groups = new Map();
  for (const ev of _normalizedCache) {
    if (ev.dateIso < startY || ev.dateIso > endY) continue;
    const key = `${ev.dateIso}|${ev.timeHH}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(ev);
  }
  groups.forEach((list, key) => {
    const cells = _cellMap ? _cellMap.get(key) : null;
    if (!cells) return;
    cells.forEach(box => {
      const frag = document.createDocumentFragment();
      for (const ev of list) frag.appendChild(buildBookingEl(ev));
      box.appendChild(frag);
    });
  });
  refreshDataModals();
}

// ---------- Overview modals ----------
const studentsBtn = document.getElementById('studentsBtn');
const studentsModal = document.getElementById('studentsModal');
const studentsClose = document.getElementById('studentsClose');
const studentsContent = document.getElementById('studentsContent');
const teachersBtn = document.getElementById('teachersBtn');
const teachersModal = document.getElementById('teachersModal');
const teachersClose = document.getElementById('teachersClose');
const teachersContent = document.getElementById('teachersContent');
let _statsPriming = null;

studentsBtn?.addEventListener('click', async () => {
  await openStudentsModal();
});
teachersBtn?.addEventListener('click', async () => {
  await openTeachersModal();
});

studentsClose?.addEventListener('click', closeStudentsModal);
studentsModal?.addEventListener('click', (e) => { if (e.target === studentsModal) closeStudentsModal(); });
teachersClose?.addEventListener('click', closeTeachersModal);
teachersModal?.addEventListener('click', (e) => { if (e.target === teachersModal) closeTeachersModal(); });

async function openStudentsModal(){
  if (!studentsModal || !studentsContent) return;
  studentsModal.hidden = false;
  if (_normalizedCache && _normalizedCache.length) {
    populateStudentsModal();
    return;
  }
  studentsContent.textContent = '';
  studentsContent.appendChild(makeInfoParagraph('กำลังโหลดข้อมูลจากตาราง...'));
  const hasData = await ensureSchedulePrimed();
  if (!hasData) {
    studentsContent.textContent = '';
    studentsContent.appendChild(makeInfoParagraph('ยังไม่มีข้อมูลนักเรียนในช่วงนี้'));
    return;
  }
  populateStudentsModal();
}

async function openTeachersModal(){
  if (!teachersModal || !teachersContent) return;
  teachersModal.hidden = false;
  if (_normalizedCache && _normalizedCache.length) {
    populateTeachersModal();
    return;
  }
  teachersContent.textContent = '';
  teachersContent.appendChild(makeInfoParagraph('กำลังโหลดข้อมูลจากตาราง...'));
  const hasData = await ensureSchedulePrimed();
  if (!hasData) {
    teachersContent.textContent = '';
    teachersContent.appendChild(makeInfoParagraph('ยังไม่มีข้อมูลการสอนในช่วงนี้'));
    return;
  }
  populateTeachersModal();
}

function closeStudentsModal(){ if (studentsModal) studentsModal.hidden = true; }
function closeTeachersModal(){ if (teachersModal) teachersModal.hidden = true; }

function populateStudentsModal(){
  if (!studentsContent) return;
  const summaries = collectStudentSummaries();
  studentsContent.textContent = '';
  if (!summaries.length) {
    studentsContent.appendChild(makeInfoParagraph('ยังไม่มีข้อมูลนักเรียนในช่วงนี้'));
    return;
  }
  const list = document.createElement('ul');
  list.className = 'student-list';
  summaries.forEach((student, idx) => {
    const item = document.createElement('li');
    item.className = 'student-item';
    const header = document.createElement('div');
    header.className = 'student-item__header';

    const title = document.createElement('div');
    title.className = 'student-item__title';
    title.textContent = student.code
      ? `${student.name || 'ไม่ระบุชื่อ'} (${student.code})`
      : (student.name || 'ไม่ระบุชื่อ');
    header.appendChild(title);

    let details = null;
    let toggleBtn = null;
    if (student.completedDates && student.completedDates.length) {
      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'student-item__toggle';
      toggleBtn.textContent = 'ดูวันที่เรียน';
      toggleBtn.setAttribute('aria-expanded', 'false');
      const detailsId = `student-details-${idx}`;
      toggleBtn.setAttribute('data-target', detailsId);
      header.appendChild(toggleBtn);

      details = document.createElement('div');
      details.className = 'student-item__details';
      details.id = detailsId;

      const label = document.createElement('span');
      label.className = 'student-item__details-label';
      label.textContent = 'วันที่เรียนที่ผ่านมา';
      details.appendChild(label);

      const datesList = document.createElement('ul');
      datesList.className = 'student-item__dates';
      student.completedDates.forEach(dateLabel => {
        const li = document.createElement('li');
        li.textContent = dateLabel || '-';
        datesList.appendChild(li);
      });
      details.appendChild(datesList);
    }

    item.appendChild(header);

    const pills = document.createElement('div');
    pills.className = 'student-item__pills';

    const usedSpan = document.createElement('span');
    usedSpan.className = 'student-item__pill student-item__pill--used';
    usedSpan.textContent = `เรียนแล้ว ${student.progressLabel}`;
    pills.appendChild(usedSpan);

    if (student.remainingLabel && student.remainingLabel !== 'ไม่ระบุ') {
      const remainingSpan = document.createElement('span');
      remainingSpan.className = 'student-item__pill student-item__pill--remaining';
      remainingSpan.textContent = `เหลือ ${student.remainingLabel}`;
      pills.appendChild(remainingSpan);
    }

    if (student.totalLabel) {
      const totalSpan = document.createElement('span');
      totalSpan.className = 'student-item__pill student-item__pill--total';
      totalSpan.textContent = `รวม ${student.totalLabel}`;
      pills.appendChild(totalSpan);
    }
    item.appendChild(pills);

    const teachersRow = document.createElement('div');
    teachersRow.className = 'student-item__teachers';
    const teacherLabel = document.createElement('span');
    teacherLabel.className = 'student-item__teachers-label';
    teacherLabel.textContent = 'ครูผู้สอน:';
    teachersRow.appendChild(teacherLabel);

    if (student.teachers.length) {
      student.teachers.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'student-item__teacher-chip';
        chip.textContent = name;
        teachersRow.appendChild(chip);
      });
    } else {
      const chip = document.createElement('span');
      chip.className = 'student-item__teacher-chip is-empty';
      chip.textContent = 'ไม่ระบุ';
      teachersRow.appendChild(chip);
    }

    item.appendChild(teachersRow);

    if (toggleBtn && details) {
      item.appendChild(details);
      toggleBtn.addEventListener('click', () => {
        const isOpen = details.classList.toggle('is-open');
        toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        toggleBtn.textContent = isOpen ? 'ซ่อนวันที่เรียน' : 'ดูวันที่เรียน';
      });
    }

    list.appendChild(item);
  });
  studentsContent.appendChild(list);
}

function populateTeachersModal(){
  if (!teachersContent) return;
  const referenceDate = new Date();
  const summaries = collectTeacherSummaries(referenceDate);
  teachersContent.textContent = '';
  const caption = document.createElement('p');
  caption.className = 'teacher-month-caption';
  caption.textContent = `ข้อมูลประจำเดือน ${formatMonthLabel(referenceDate)}`;
  teachersContent.appendChild(caption);

  if (!summaries.length) {
    teachersContent.appendChild(makeInfoParagraph('ยังไม่มีข้อมูลการสอนในเดือนนี้'));
    return;
  }

  const list = document.createElement('ul');
  list.className = 'teacher-list';

  summaries.forEach((teacher, idx) => {
    const row = document.createElement('li');
    row.className = 'teacher-row';

    const head = document.createElement('div');
    head.className = 'teacher-row__head';

    const nameEl = document.createElement('span');
    nameEl.className = 'teacher-name';
    nameEl.textContent = teacher.name;

    const countBtn = document.createElement('button');
    countBtn.className = 'teacher-count';
    countBtn.type = 'button';
    countBtn.textContent = `${teacher.count} ครั้ง`;
    const detailsId = `teacher-details-${teacher.key}-${idx}`;
    countBtn.setAttribute('data-target', detailsId);
    countBtn.setAttribute('aria-expanded', 'false');

    head.appendChild(nameEl);
    head.appendChild(countBtn);
    row.appendChild(head);

    const details = document.createElement('div');
    details.className = 'teacher-details';
    details.id = detailsId;

    if (teacher.students.length) {
      const studentsList = document.createElement('ul');
      studentsList.className = 'teacher-students';
      teacher.students.forEach(student => {
        const li = document.createElement('li');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = student.code ? `${student.name} (${student.code})` : student.name;
        const countSpan = document.createElement('span');
        countSpan.className = 'teacher-student__count';
        countSpan.textContent = `${student.count} ครั้ง`;
        li.appendChild(nameSpan);
        li.appendChild(document.createTextNode(' – '));
        li.appendChild(countSpan);
        if (student.instruments.length) {
          const instSpan = document.createElement('span');
          instSpan.className = 'teacher-student__instrument';
          instSpan.textContent = student.instruments.join(', ');
          li.appendChild(document.createTextNode(' – '));
          li.appendChild(instSpan);
        }
        studentsList.appendChild(li);
      });
      details.appendChild(studentsList);
    } else {
      const empty = document.createElement('span');
      empty.className = 'teacher-details__empty';
      empty.textContent = 'ยังไม่มีข้อมูลผู้เรียนในเดือนนี้';
      details.appendChild(empty);
    }

    row.appendChild(details);
    list.appendChild(row);
  });

  teachersContent.appendChild(list);

  teachersContent.querySelectorAll('.teacher-count').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const panel = targetId ? document.getElementById(targetId) : null;
      if (!panel) return;
      const isOpen = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  });
}

function collectStudentSummaries(){
  if (!_normalizedCache || !_normalizedCache.length) return [];
  const map = new Map();
  const remainingKeys = ['CourseRemaining','Remaining','RemainingSessions','RemainingHours'];
  const collator = new Intl.Collator(DEFAULT_LABEL_LOCALE, { sensitivity:'base', numeric:true });
  const now = new Date();
  for (const ev of _normalizedCache) {
    const codeRaw = String(ev.code || '').trim();
    const nameRaw = String(ev.name || '').trim();
    const key = (codeRaw && codeRaw.toUpperCase()) || nameRaw;
    if (!key) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        code: codeRaw,
        name: nameRaw || 'ไม่ระบุชื่อ',
        teachers: new Set(),
        used: 0,
        total: 0,
        remainingHint: Number.POSITIVE_INFINITY,
        completedCount: 0,
        completedDates: []
      };
      map.set(key, entry);
    }
    if (codeRaw && !entry.code) entry.code = codeRaw;
    if (nameRaw && entry.name === 'ไม่ระบุชื่อ') entry.name = nameRaw;
    entry.teachers.add(teacherDisplayName(ev.teacher));
    const usedVal = toNumber(ev.used);
    if (usedVal != null) entry.used = Math.max(entry.used, usedVal);
    const totalVal = toNumber(ev.total);
    if (totalVal != null) entry.total = Math.max(entry.total, totalVal);
    const remainingVal = pickNumericFromRow(ev.row, remainingKeys);
    if (remainingVal != null) entry.remainingHint = Math.min(entry.remainingHint, remainingVal);
    const eventDateTime = (() => {
      if (!ev.dateIso) return null;
      const stamp = `${ev.dateIso}T${ev.timeHH || '00:00'}`;
      const d = new Date(stamp);
      return isNaN(d.getTime()) ? null : d;
    })();
    if (eventDateTime && eventDateTime <= now) {
      entry.completedCount += 1;
      entry.completedDates.push(eventDateTime);
    }
  }
  const result = [];
  map.forEach(entry => {
    const sortedDates = entry.completedDates
      .filter(d => d instanceof Date && !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    let completed = sortedDates.length > 0 ? sortedDates.length : entry.completedCount;
    if (!completed && entry.used > 0) completed = entry.used;

    let remaining = Number.isFinite(entry.remainingHint)
      ? Math.max(entry.remainingHint, 0)
      : null;
    let total = entry.total > 0 ? entry.total : null;

    if (total == null && entry.used > 0 && remaining != null) {
      total = entry.used + remaining;
    }
    if (total == null && remaining != null) {
      total = remaining + completed;
    }
    if (total != null && completed > total) {
      completed = total;
    }
    if (total != null) {
      remaining = Math.max(total - completed, 0);
    } else if (remaining != null && remaining < 0) {
      remaining = 0;
    }

    const teachers = Array.from(entry.teachers);
    teachers.sort((a, b) => collator.compare(a, b));

    const progressLabel = total != null ? `${completed} / ${total} ครั้ง` : `${completed} ครั้ง`;
    const remainingLabel = remaining != null ? `${remaining} ครั้ง` : 'ไม่ระบุ';
    const totalLabel = total != null ? `${total} ครั้ง` : '';
    const completedDates = sortedDates.map(formatDateDDMM);

    result.push({
      code: entry.code,
      name: entry.name,
      teachers,
      used: completed,
      completedCount: completed,
      progressLabel,
      remaining,
      remainingLabel,
      total,
      totalLabel,
      completedDates
    });
  });
  result.sort((a, b) => collator.compare(a.name, b.name));
  return result;
}

function collectTeacherSummaries(referenceDate = new Date()){
  if (!_normalizedCache || !_normalizedCache.length) return [];
  const targetYear = referenceDate.getFullYear();
  const targetMonth = referenceDate.getMonth() + 1; // 1-based
  const map = new Map();
  const collator = new Intl.Collator(DEFAULT_LABEL_LOCALE, { sensitivity:'base', numeric:true });
  _normalizedCache.forEach(ev => {
    const iso = ev.dateIso;
    if (!iso) return;
    const year = Number(iso.slice(0,4));
    const month = Number(iso.slice(5,7));
    if (year !== targetYear || month !== targetMonth) return;
    const teacherKey = normalizeTeacherKey(ev.teacher);
    const teacherName = teacherDisplayName(ev.teacher);
    let entry = map.get(teacherKey);
    if (!entry) {
      entry = { key: teacherKey, name: teacherName, count: 0, students: new Map() };
      map.set(teacherKey, entry);
    }
    entry.count += 1;
    const studentCode = String(ev.code || '').trim().toUpperCase();
    const studentName = String(ev.name || '').trim() || 'ไม่ระบุชื่อ';
    const studentKey = studentCode || studentName;
    let student = entry.students.get(studentKey);
    if (!student) {
      student = { name: studentName, code: studentCode, count: 0, instruments: new Set() };
      entry.students.set(studentKey, student);
    }
    student.count += 1;
    const instrument = extractInstrument(ev.row);
    if (instrument) student.instruments.add(instrument);
  });

  const summaries = [];
  map.forEach(entry => {
    const students = Array.from(entry.students.values()).map(student => {
      const instruments = Array.from(student.instruments);
      instruments.sort((a, b) => collator.compare(a, b));
      return {
        name: student.name,
        code: student.code,
        count: student.count,
        instruments
      };
    });
    students.sort((a, b) => {
      const byCount = b.count - a.count;
      if (byCount !== 0) return byCount;
      return collator.compare(a.name, b.name);
    });
    summaries.push({
      key: entry.key,
      name: entry.name,
      count: entry.count,
      students
    });
  });

  summaries.sort((a, b) => {
    const byCount = b.count - a.count;
    if (byCount !== 0) return byCount;
    return collator.compare(a.name, b.name);
  });

  return summaries;
}

function teacherDisplayName(raw){
  const s = String(raw || '').trim();
  if (s) return s;
  return 'Others';
}

function extractInstrument(row){
  if (!row || typeof row !== 'object') return '';
  const preferredKeys = ['Instrument','CourseName','Course','Course Label','CourseLabel','CourseTitle','InstrumentName','Instrument Name','Lesson','Subject'];
  const keys = Object.keys(row);
  for (const pref of preferredKeys) {
    const match = keys.find(k => k === pref || k.toLowerCase() === pref.toLowerCase());
    if (!match) continue;
    const value = row[match];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function pickNumericFromRow(row, keys){
  if (!row || typeof row !== 'object') return null;
  const rowKeys = Object.keys(row);
  for (const target of keys) {
    const match = rowKeys.find(k => k === target || k.toLowerCase() === target.toLowerCase());
    if (!match) continue;
    const val = toNumber(row[match]);
    if (val != null) return val;
  }
  return null;
}

function toNumber(val){
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchedulePrimed(){
  if (_normalizedCache && _normalizedCache.length) return true;
  if (_statsPriming) {
    try { await _statsPriming; } catch {}
    return !!(_normalizedCache && _normalizedCache.length);
  }
  _statsPriming = (async () => {
    try { await loadSchedule(); } catch (err) { console.error('ensureSchedulePrimed error', err); }
  })();
  try {
    await _statsPriming;
  } finally {
    _statsPriming = null;
  }
  return !!(_normalizedCache && _normalizedCache.length);
}

function formatMonthLabel(d){
  try {
    return d.toLocaleDateString(DEFAULT_LABEL_LOCALE, { month:'long', year:'numeric' });
  } catch {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
}

function makeInfoParagraph(text){
  const p = document.createElement('p');
  p.className = 'data-empty';
  p.textContent = text;
  return p;
}

function refreshDataModals(){
  if (studentsModal && !studentsModal.hidden) populateStudentsModal();
  if (teachersModal && !teachersModal.hidden) populateTeachersModal();
}

function formatDateDDMM(input){
  let d = null;
  if (input instanceof Date) {
    d = input;
  } else if (typeof input === 'string' && input) {
    if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
      const parts = input.split('-');
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      const parsed = new Date(input);
      if (!isNaN(parsed.getTime())) d = parsed;
    }
  }
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2,'0');
  const month = String(d.getMonth() + 1).padStart(2,'0');
  return `${day}/${month}`;
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
  el.innerHTML = `<div class="info"><span>(${code}, ${name || ''}, ${teacher})</span></div><div class="actions"></div>`;

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
        if (el._tip) { try { el._tip.remove(); } catch {} el._tip = null; }
        const parent = el.parentNode; if (parent) parent.removeChild(el);
        const res = await postFormStrict({ action:'leave', date: dateIso, time: rawTime, teacher: normalizeTeacherLabelClient(teacher), studentCode: code });
        showToast('ทำการลาแล้ว ลบกล่อง และเพิ่มรอบใหม่แล้ว');
        markCacheDirty();
        await loadSchedule();
      } catch (err) {
        btn.disabled = false;
        // Restore element if needed
        try { const cell = document.querySelector(`.cal-cell[data-date="${dateIso}"][data-time="${timeHH}"] .slot-bookings`); if (cell) cell.appendChild(el); } catch {}
        alert(`❌ Leave error: ${err?.message || err}`);
      }
    });
  });
  el.querySelector('.actions').appendChild(btn);

  // Move button
  const moveBtn = document.createElement('button');
  moveBtn.className = 'move';
  moveBtn.textContent = 'Move';
  moveBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openMoveModal({ dateIso, timeHH, rawTime, code, teacher, name });
  });
  el.querySelector('.actions').appendChild(moveBtn);

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
  // Robust cleanup on leave and mouseout to avoid lingering tooltips
  el.addEventListener('mouseleave', () => { if (el._tip) { try { el._tip.remove(); } catch {} el._tip = null; } });
  el.addEventListener('mouseout', (ev) => { if (!el.contains(ev.relatedTarget)) { if (el._tip) { try { el._tip.remove(); } catch {} el._tip = null; } } });

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
    markCacheDirty();
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

// Global click/scroll cleanup for any orphan tooltips
document.addEventListener('click', () => {
  document.querySelectorAll('.tooltip').forEach(t => { try { t.remove(); } catch {} });
});
window.addEventListener('scroll', () => {
  document.querySelectorAll('.tooltip').forEach(t => { try { t.remove(); } catch {} });
}, { passive: true });
