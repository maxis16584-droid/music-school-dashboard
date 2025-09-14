// 👉 ใส่ URL Apps Script Web App ของคุณตรงนี้
const API_URL = "https://script.google.com/macros/s/AKfycbyUeoWYVo42aenxEVaR1ajp8iY_9n42qBFzo-oO_RhweZxYJ4AAxcXIbHcakhXN_T-e/exec";

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
  if (btn) btn.textContent = isDark ? "☀️ Light" : "🌙 Dark";
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

// โหลดตารางเรียนจาก schedule sheet
async function loadSchedule() {
  try {
    const res = await fetch(API_URL + "?sheet=schedule");
    const data = await res.json();

    let html = "<table>";
    html += "<tr><th>Date</th><th>Time</th><th>Teacher</th><th>StudentCode</th><th>Status</th><th>Action</th></tr>";

    data.forEach(row => {
      html += `
        <tr>
          <td>${row.Date}</td>
          <td>${row.Time}</td>
          <td>${row.Teacher}</td>
          <td>${row.StudentCode}</td>
          <td>${row.Status}</td>
          <td>
            <button onclick="leave('${row.Date}','${row.Time}','${row.Teacher}','${row.StudentCode}')">
              ลา
            </button>
          </td>
        </tr>
      `;
    });

    html += "</table>";
    document.getElementById("schedule").innerHTML = html;
  } catch (err) {
    document.getElementById("schedule").innerText = "❌ โหลดข้อมูลไม่สำเร็จ";
    console.error(err);
  }
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
    day_of_week: document.getElementById("weekday")?.value,
    time: document.getElementById("weeklyTime")?.value,
    teacher: document.getElementById("teacherStudent")?.value
  };

  try {
    console.debug("addStudent payload:", body);
    await postFormStrict(body);
    alert("เพิ่มนักเรียนเรียบร้อย ✅");
    document.getElementById("addStudentForm").reset();
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
    loadWeeklyGrid();
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
    loadWeeklyGrid();
  } catch (err) {
    console.error("leave error:", err);
    alert(`❌ เกิดข้อผิดพลาด: ${err?.message || err}`);
    console.error(err);
  }
}

// ผูก event กับ form
document.getElementById("addStudentForm").addEventListener("submit", addStudent);
document.getElementById("addScheduleForm").addEventListener("submit", addSchedule);

// โหลดตารางครั้งแรก
loadWeeklyGrid();

// แสดงตาราง จันทร์-ศุกร์ ตามเวลาที่เด็กลงไว้ จาก students sheet
async function loadWeeklyGrid() {
  try {
    const res = await fetch(API_URL + "?sheet=students", { cache: "no-store" });
    const students = await res.json();
    const days = ["Mon","Tue","Wed","Thu","Fri"];
    const dayTH = { Mon:"จันทร์", Tue:"อังคาร", Wed:"พุธ", Thu:"พฤหัส", Fri:"ศุกร์" };

    const timesSet = new Set();
    students.forEach(s => {
      if (days.includes(s.DayOfWeek) && s.Time) timesSet.add(s.Time);
    });
    const times = Array.from(timesSet).sort();

    if (times.length === 0) {
      document.getElementById("schedule").innerHTML = "<p>ยังไม่มีข้อมูลตาราง</p>";
      return;
    }

    let html = "<table>";
    html += "<tr><th>Time</th>" + days.map(d => `<th>${dayTH[d]}</th>`).join("") + "</tr>";

    times.forEach(t => {
      html += `<tr><th>${t}</th>`;
      days.forEach(d => {
        const entries = students.filter(s => s.DayOfWeek === d && s.Time === t);
        const cell = entries.map(s => `${s.ID || s.Code} - ${s.Teacher || ''}`).join('<br/>');
        html += `<td>${cell || ''}</td>`;
      });
      html += "</tr>";
    });

    html += "</table>";
    document.getElementById("schedule").innerHTML = html;
  } catch (err) {
    document.getElementById("schedule").innerText = "❌ โหลดข้อมูลไม่สำเร็จ";
    console.error(err);
  }
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
