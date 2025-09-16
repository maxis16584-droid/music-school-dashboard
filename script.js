// 👉 ใส่ URL Apps Script Web App ของคุณตรงนี้
const API_URL = "https://script.google.com/macros/s/AKfycbzR8TqOsVqE-26l8PIqFdZmK-gxUPbX_BOvmYGqbQaJ3lmy8IWpL7Zp8ES2WYFM9JpA/exec";

// ------------------
// Theme: Light/Dark
// ------------------
const THEME_KEY = "theme"; // 'light' | 'dark'

function applyTheme(theme) {
  const root = document.documentElement;
  const isDark = theme === "dark";
  root.classList.toggle("dark", isDark);
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = isDark ? "Light" : "Dark";
}

function initTheme() {
  let theme = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch (_) {}
  if (!theme) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }
  applyTheme(theme);
}

document.getElementById("themeToggle")?.addEventListener("click", () => {
  const isDark = document.documentElement.classList.contains("dark");
  applyTheme(isDark ? "light" : "dark");
});

// Initialize theme ASAP
initTheme();

// Warn if running from file:// which often breaks CORS
(() => {
  if (window.location.protocol === 'file:') {
    const el = document.getElementById('envWarning');
    if (el) {
      el.hidden = false;
      el.textContent = 'You are opening this page via file://. Many APIs (like Google Apps Script) reject requests from a null origin. Please run a local server (e.g., VS Code Live Server or: python3 -m http.server) and access via http://localhost.';
    }
  }
})();

// โหลดตารางและเรนเดอร์ลงปฏิทิน (React calendar)
async function loadSchedule() {
  try {
    const [scheduleRes, studentsRes] = await Promise.all([
      fetch(API_URL + "?sheet=schedule", { cache: "no-store" }),
      fetch(API_URL + "?sheet=students", { cache: "no-store" })
    ]);
    const [schedule, students] = await Promise.all([
      scheduleRes.json(),
      studentsRes.json()
    ]);

    const nameByCode = new Map((Array.isArray(students)?students:[]).map(s => [String(s.Code), String(s.Name || '')]));

    const parseTimeRange = (s) => {
      const str = String(s || '').trim();
      const m = str.match(/^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/);
      if (!m) return { sh: 0, sm: 0, eh: null, em: null };
      const sh = Number(m[1]);
      const sm = Number(m[2]);
      const eh = m[3] != null ? Number(m[3]) : null;
      const em = m[4] != null ? Number(m[4]) : null;
      return { sh, sm, eh, em };
    };
    const toDateRange = (dateStr, timeStr) => {
      const d = parseDate(dateStr);
      if (!d) return { start: null, end: null, dateIso: null, timeHH: null };
      const { sh, sm, eh, em } = parseTimeRange(timeStr);
      const start = new Date(d); start.setHours(sh, sm, 0, 0);
      const end = new Date(start);
      if (eh != null && em != null) end.setHours(eh, em, 0, 0); else end.setHours(start.getHours() + 1);
      const yyyy = d.getFullYear(); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
      const dateIso = `${yyyy}-${mm}-${dd}`;
      const timeHH = String(sh).padStart(2,'0') + ':' + String(sm).padStart(2,'0');
      return { start, end, dateIso, timeHH };
    };

    const events = (Array.isArray(schedule) ? schedule : []).map((r, i) => {
      const { start, end, dateIso, timeHH } = toDateRange(r.Date, r.Time);
      if (!start) return null;
      const code = String(r.StudentCode || '');
      const name = nameByCode.get(code) || '';
      const teacher = String(r.Teacher || '');
      return {
        id: String(i + 1),
        title: `(${code}, ${name}, ${teacher})`,
        start,
        end,
        _dateIso: dateIso,
        _timeHH: timeHH,
        _rawTime: String(r.Time || '')
      };
    }).filter(Boolean);

    if (window.renderWeeklyCalendar) {
      window.renderWeeklyCalendar(events, { startHour: 13, endHour: 20 });
    }

    // Ensure React calendar has rendered, then inject text into cells
    await nextFrame();
    await nextFrame();
    injectEventsIntoCells(events);
  } catch (err) {
    console.error('loadSchedule error:', err);
  }
}

function injectEventsIntoCells(events) {
  // Clear previous injected text
  document.querySelectorAll('.wc-cell [data-injected]').forEach(n => n.remove());
  (events || []).forEach(ev => {
    const sel = `.wc-cell[data-date="${ev._dateIso}"][data-time="${ev._timeHH}"]`;
    const cell = document.querySelector(sel);
    if (!cell) return;
    const wrap = document.createElement('div');
    wrap.setAttribute('data-injected','1');
    wrap.className = 'wc-inline';
    const label = document.createElement('span');
    label.textContent = ev.title; // format: (Code, Name, Teacher)
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wc-leave';
    btn.textContent = 'Leave';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await postFormStrict({ action: 'leave', date: ev._dateIso, time: ev._rawTime || ev._timeHH, teacher: extractTeacherFromTitle(ev.title), studentCode: extractCodeFromTitle(ev.title) });
        loadSchedule();
      } catch (err) {
        alert(`❌ Leave error: ${err?.message || err}`);
      }
    });
    wrap.appendChild(label);
    wrap.appendChild(btn);
    cell.appendChild(wrap);
  });
}

function extractCodeFromTitle(title) {
  // Title format: (Code, Name, Teacher)
  const m = String(title).match(/^\(([^,]+),/);
  return m ? m[1].trim() : '';
}
function extractTeacherFromTitle(title) {
  const m = String(title).match(/,\s*[^,]+,\s*([^\)]+)\)$/);
  return m ? m[1].trim() : '';
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

// ฟังก์ชันเพิ่มนักเรียนใหม่
async function addStudent(e) {
  e.preventDefault();

  const body = {
    action: "addStudent",
    id: document.getElementById("studentId").value,
    code: document.getElementById("studentCode").value,
    name: document.getElementById("studentName").value,
    course_total: parseInt(document.getElementById("courseTotal").value),
    day_of_week: document.getElementById("weekday").value,
    time: document.getElementById("weeklyTime").value,
    teacher: document.getElementById("teacherStudent").value
  };

  try {
    console.debug("addStudent payload:", body);
    await postFormStrict(body);
    alert("เพิ่มนักเรียนเรียบร้อย ✅");
    document.getElementById("addStudentForm").reset();
    const panel = document.getElementById("addStudentPanel");
    if (panel) panel.hidden = true;
    // Refresh calendar after adding
    loadSchedule();
  } catch (err) {
    console.error("addStudent error:", err);
    alert(`❌ เกิดข้อผิดพลาด: ${err?.message || err}`);
    console.error(err);
  }
}

// ฟังก์ชันเพิ่มตารางเรียนใหม่
async function addSchedule(e) {
  e.preventDefault();

  const body = {
    action: "addSchedule",
    date: document.getElementById("classDate").value,
    time: document.getElementById("classTime").value,
    teacher: document.getElementById("teacher").value,
    studentCode: document.getElementById("studentCodeForSchedule").value
  };

  try {
    console.debug("addSchedule payload:", body);
    await postFormStrict(body);
    alert("เพิ่มตารางเรียนเรียบร้อย ✅");
    document.getElementById("addScheduleForm").reset();
    loadSchedule();
  } catch (err) {
    console.error("addSchedule error:", err);
    alert(`❌ เกิดข้อผิดพลาด: ${err?.message || err}`);
    console.error(err);
  }
}

// ฟังก์ชันลา
async function leave(date, time, teacher, studentCode) {
  try {
    const payload = {
      action: "leave",
      date, time, teacher, studentCode
    };
    console.debug("leave payload:", payload);
    await postFormStrict(payload);
    alert("บันทึกการลาแล้ว ✅");
    renderCalendarFromAPI();
  } catch (err) {
    console.error("leave error:", err);
    alert(`❌ เกิดข้อผิดพลาด: ${err?.message || err}`);
    console.error(err);
  }
}

// Modal controls for adding from calendar
const modalEl = document.getElementById('addModal');
const modalForm = document.getElementById('modalForm');
const modalClose = document.getElementById('modalClose');
function openAddModal(date, hour) {
  if (!modalEl) return;
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  const start = String(hour).padStart(2,'0') + ':00';
  const end = String((hour+1)).padStart(2,'0') + ':00';
  document.getElementById('modalDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('modalTime').value = `${start} - ${end}`;
  modalEl.hidden = false;
}
modalClose?.addEventListener('click', ()=> modalEl.hidden = true);
// Close when clicking the backdrop
modalEl?.addEventListener('click', (e) => {
  if (e.target === modalEl) modalEl.hidden = true;
});

// Expose handler for calendar cell click
window.__onCalendarCellClick = ({date, hour}) => openAddModal(date, hour);

// Submit from modal: add booking (backend handles student creation + repeats)
modalForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const code = document.getElementById('modalCode').value.trim();
    const name = document.getElementById('modalName').value.trim();
    const total = parseInt(document.getElementById('modalCourseTotal').value || '0', 10);
    const teacher = document.getElementById('modalTeacher').value;
    const dateStr = (document.getElementById('modalDate').value || '').trim();
    const timeSlot = (document.getElementById('modalTime').value || '').trim();

    if (!code || !name || !total || !teacher || !dateStr || !timeSlot) {
      alert('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    // Unified booking endpoint
    await postFormStrict({
      action: 'addBooking',
      studentCode: code,
      studentName: name,
      teacher,
      courseHours: total,
      date: dateStr,
      time: timeSlot
    });

    modalEl.hidden = true;
    modalForm.reset();
    loadSchedule();
    alert('เพิ่มนักเรียนและตารางเรียนเรียบร้อย ✅');
  } catch (err) {
    console.error('modal submit error:', err);
    alert(`❌ เกิดข้อผิดพลาด: ${err?.message || err}`);
  }
});

function computeNextId(students) {
  let max = 0;
  (Array.isArray(students) ? students : []).forEach(s => {
    const n = parseInt(String(s.ID || '').replace(/\D/g,''), 10);
    if (!isNaN(n)) max = Math.max(max, n);
  });
  const next = max + 1;
  return String(next).padStart(3,'0');
}

// First load: calendar only
loadSchedule();

// แสดงตาราง จันทร์-อาทิตย์ จาก schedule sheet พร้อมปุ่มลา
async function loadWeekSchedule() {
  try {
    const [scheduleRes, studentsRes] = await Promise.all([
      fetch(API_URL + "?sheet=schedule", { cache: "no-store" }),
      fetch(API_URL + "?sheet=students", { cache: "no-store" })
    ]);
    const [items, students] = await Promise.all([
      scheduleRes.json(),
      studentsRes.json()
    ]);
    const nameByCode = new Map(students.map(s => [String(s.Code), String(s.Name || '')]));
    const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const dayTH = { Mon:"จันทร์", Tue:"อังคาร", Wed:"พุธ", Thu:"พฤหัส", Fri:"ศุกร์", Sat:"เสาร์", Sun:"อาทิตย์" };

    // Determine view mode
    const mode = document.getElementById('viewMode')?.value || 'week';
    const now = new Date();
    const start = startOfWeekMon(now);
    const end = addDays(start, 6);

    let rows = items
      .map(r => ({...r, _date: parseDate(r.Date)}))
      .filter(r => r._date);

    if (mode === 'week') {
      rows = rows.filter(r => r._date >= start && r._date <= end);
    } else {
      // all upcoming: today or future only
      const today = new Date(); today.setHours(0,0,0,0);
      rows = rows.filter(r => r._date >= today);
    }

    rows.sort((a,b) => (a._date - b._date) || String(a.Time).localeCompare(String(b.Time)));

    // Auto-switch to 'all' if week has no items
    if (rows.length === 0 && mode === 'week') {
      const sel = document.getElementById('viewMode');
      if (sel) {
        sel.value = 'all';
        return loadWeekSchedule();
      }
    }

    let html = "<table>";
    html += "<tr><th>วัน</th><th>วันที่</th><th>เวลา</th><th>Student Code</th><th>Student Name</th><th>ครูผู้สอน</th><th>Status</th><th>Action</th></tr>";
    for (const r of rows) {
      const d = r._date;
      const dow = days[d.getDay() === 0 ? 6 : d.getDay()-1];
      const name = nameByCode.get(String(r.StudentCode)) || '';
      html += `
        <tr>
          <td>${dayTH[dow]}</td>
          <td>${r.Date}</td>
          <td>${r.Time}</td>
          <td>${r.StudentCode}</td>
          <td>${name}</td>
          <td>${r.Teacher}</td>
          <td>${r.Status || ''}</td>
          <td><button onclick="leave('${r.Date}','${r.Time}','${r.Teacher}','${r.StudentCode}')">ลา</button></td>
        </tr>`;
    }
    html += "</table>";
    document.getElementById("schedule").innerHTML = html;
  } catch (err) {
    document.getElementById("schedule").innerText = "❌ โหลดข้อมูลไม่สำเร็จ";
    console.error(err);
  }
}

// date utils on client
function startOfWeekMon(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay(); // 0..6, Sun=0
  const diff = (day === 0 ? -6 : 1 - day); // move to Monday
  date.setDate(date.getDate() + diff);
  date.setHours(0,0,0,0);
  return date;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(23,59,59,999);
  return x;
}
function parseDate(str) {
  const [y,m,dd] = String(str).split('-').map(Number);
  if (!y || !m || !dd) return null;
  return new Date(y, m-1, dd);
}

// Format possible ISO date-time or plain strings to HH:mm
function formatTimeCell(val) {
  if (val == null || val === "") return "";
  const s = String(val);
  // Already HH:mm
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    try {
      return d.toLocaleTimeString('th-TH', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'
      });
    } catch (_) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
  }
  return s;
}

// Show Thai weekday with (dd/MM) in current week
function formatDayWithDate(dayKey, dayTH) {
  const start = startOfWeekMon(new Date());
  // Map 3-letter day to offset from Monday start
  const offsetMap = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };
  const offset = offsetMap[dayKey] ?? 0;
  const d = new Date(start);
  d.setDate(start.getDate() + offset);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const label = dayTH[dayKey] || dayKey;
  return `${label} (${dd}/${mm})`;
}

// Students-only view: list Mon–Sun from students sheet
async function loadStudentsView() {
  try {
    const res = await fetch(API_URL + "?sheet=students", { cache: "no-store" });
    const students = await res.json();
    const order = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const dayTH = { Sun:"อาทิตย์", Mon:"จันทร์", Tue:"อังคาร", Wed:"พุธ", Thu:"พฤหัส", Fri:"ศุกร์", Sat:"เสาร์" };

    const rows = students
      .filter(s => s.DayOfWeek && s.Time)
      .map(s => ({
        day: String(s.DayOfWeek).slice(0,3),
        time: String(s.Time),
        code: String(s.Code || ''),
        name: String(s.Name || ''),
        teacher: String(s.Teacher || '')
      }))
      .sort((a,b) => (order[a.day] - order[b.day]) || a.time.localeCompare(b.time) || a.code.localeCompare(b.code));

    let html = "<table>";
    html += "<tr><th>วัน</th><th>เวลา</th><th>Student Code</th><th>Student Name</th><th>ครูผู้สอน</th></tr>";
    for (const r of rows) {
      html += `
        <tr>
          <td>${formatDayWithDate(r.day, dayTH)}</td>
          <td>${formatTimeCell(r.time)}</td>
          <td>${r.code}</td>
          <td>${r.name}</td>
          <td>${r.teacher}</td>
        </tr>`;
    }
    html += "</table>";
    document.getElementById("schedule").innerHTML = html;

    // Render Weekly Calendar from schedule + students mapping
    renderCalendarFromAPI();
  } catch (err) {
    document.getElementById("schedule").innerText = "❌ โหลดข้อมูลไม่สำเร็จ";
    console.error(err);
  }
}

// Build events from schedule + students and render in calendar
async function renderCalendarFromAPI() {
  try {
    const [scheduleRes, studentsRes] = await Promise.all([
      fetch(API_URL + "?sheet=schedule", { cache: "no-store" }),
      fetch(API_URL + "?sheet=students", { cache: "no-store" })
    ]);
    const [schedule, students] = await Promise.all([
      scheduleRes.json(),
      studentsRes.json()
    ]);
    const nameByCode = new Map(students.map(s => [String(s.Code), String(s.Name || '')]));

    const parseTimeRange = (s) => {
      const str = String(s || '').trim();
      // Supports: "13:00" or "13:00 - 14:00"
      const m = str.match(/^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/);
      if (!m) return { sh: 0, sm: 0, eh: null, em: null };
      const sh = Number(m[1]);
      const sm = Number(m[2]);
      const eh = m[3] != null ? Number(m[3]) : null;
      const em = m[4] != null ? Number(m[4]) : null;
      return { sh, sm, eh, em };
    };
    const toDateRange = (dateStr, timeStr) => {
      const d = parseDate(dateStr);
      if (!d) return { start: null, end: null };
      const { sh, sm, eh, em } = parseTimeRange(timeStr);
      const start = new Date(d);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(start);
      if (eh != null && em != null) {
        end.setHours(eh, em, 0, 0);
      } else {
        end.setHours(start.getHours() + 1, start.getMinutes(), 0, 0);
      }
      return { start, end };
    };

    const events = (Array.isArray(schedule) ? schedule : []).map((r, i) => {
      const { start: s, end: e } = toDateRange(r.Date, r.Time);
      if (!s) return null;
      const code = String(r.StudentCode || '');
      const name = nameByCode.get(code) || '';
      const teacher = String(r.Teacher || '');
      return {
        id: String(i + 1),
        title: `(${code}, ${name}, ${teacher})`,
        start: s,
        end: e,
        color: undefined
      };
    }).filter(Boolean);

    if (window.renderWeeklyCalendar) {
      window.renderWeeklyCalendar(events, { startHour: 13, endHour: 20 });
    } else {
      window.__pendingCalendarEvents = events;
    }
  } catch (e) {
    console.warn('Calendar API fetch failed:', e);
  }
}

function initScheduleView() {
  const sel = document.getElementById('viewMode');
  if (sel) sel.addEventListener('change', () => loadWeekSchedule());
  loadWeekSchedule();
}

// ---------- Helpers ----------
async function postForm(data) {
  // Use URL-encoded form to avoid CORS preflight with Apps Script
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    form.append(k, v == null ? "" : String(v));
  }
  const res = await fetch(API_URL, { method: "POST", body: form });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const snippet = text ? ` - ${text.slice(0, 200)}` : "";
    throw new Error(`HTTP ${res.status}${snippet}`);
  }
  try { return JSON.parse(text); } catch (_) { return text; }
}

// Strict write: require readable JSON ok:true; no opaque fallbacks
async function postFormStrict(data) {
  const res = await postForm(data);
  if (typeof res === 'string') {
    // Try to parse if server returned text JSON-like
    try {
      const parsed = JSON.parse(res);
      if (parsed && parsed.ok) return parsed;
      throw new Error(parsed && parsed.error ? parsed.error : 'Unexpected response');
    } catch (_) {
      throw new Error('No JSON response from server');
    }
  }
  if (!res || res.ok === false) {
    throw new Error((res && res.error) || 'Server returned failure');
  }
  return res;
}
