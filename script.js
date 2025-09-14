// 👉 ใส่ URL Apps Script Web App ของคุณตรงนี้
const API_URL = "https://script.google.com/macros/s/AKfycbyCO66YlJZK1up1dvUfKVTTYaZfky74ZWWL-qiTIH-d_zYWP49SmZRroTa8oYZAGBg9/exec";

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
    course_total: parseInt(document.getElementById("courseTotal").value)
  };

  try {
    console.debug("addStudent payload:", body);
    await postForm(body);
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
    await postForm(body);
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
    await postForm(payload);
    alert("บันทึกการลาแล้ว ✅");
    loadSchedule();
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
loadSchedule();

// ---------- Helpers ----------
async function postForm(data) {
  // Use URL-encoded form to avoid CORS preflight with Apps Script
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    form.append(k, v == null ? "" : String(v));
  }
  try {
    const res = await fetch(API_URL, { method: "POST", body: form });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const snippet = text ? ` - ${text.slice(0, 200)}` : "";
      throw new Error(`HTTP ${res.status}${snippet}`);
    }
    try { return JSON.parse(text); } catch (_) { return text; }
  } catch (err) {
    console.warn("Primary POST failed, trying GET fallback", err);
    // Fallback 1: try GET with query params (works if server handles doGet)
    try {
      const url = `${API_URL}?${form.toString()}`;
      const res2 = await fetch(url, { cache: "no-store" });
      const text2 = await res2.text().catch(() => "");
      if (!res2.ok) {
        const snippet2 = text2 ? ` - ${text2.slice(0, 200)}` : "";
        throw new Error(`HTTP ${res2.status}${snippet2}`);
      }
      try { return JSON.parse(text2); } catch (_) { return text2; }
    } catch (err2) {
      console.warn("GET fallback failed, trying no-cors POST as last resort", err2);
      // Fallback 2: no-cors POST (opaque). We cannot read response, assume success.
      await fetch(API_URL, { method: "POST", body: form, mode: "no-cors" });
      return { opaque: true };
    }
  }
}
