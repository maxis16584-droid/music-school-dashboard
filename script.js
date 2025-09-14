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
    await postForm(body);
    alert("เพิ่มนักเรียนเรียบร้อย ✅");
    document.getElementById("addStudentForm").reset();
  } catch (err) {
    console.error("addStudent error:", err);
    alert("❌ เกิดข้อผิดพลาด (ตรวจสอบการตั้งค่า Web App/CORS)");
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
    await postForm(body);
    alert("เพิ่มตารางเรียนเรียบร้อย ✅");
    document.getElementById("addScheduleForm").reset();
    loadSchedule();
  } catch (err) {
    console.error("addSchedule error:", err);
    alert("❌ เกิดข้อผิดพลาด (ตรวจสอบการตั้งค่า Web App/CORS)");
    console.error(err);
  }
}

// ฟังก์ชันลา
async function leave(date, time, teacher, studentCode) {
  try {
    await postForm({
      action: "leave",
      date, time, teacher, studentCode
    });
    alert("บันทึกการลาแล้ว ✅");
    loadSchedule();
  } catch (err) {
    console.error("leave error:", err);
    alert("❌ เกิดข้อผิดพลาด (ตรวจสอบการตั้งค่า Web App/CORS)");
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
  const res = await fetch(API_URL, {
    method: "POST",
    body: form
  });
  // Even if server returns non-JSON, this prevents silent failures
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let text;
  try {
    text = await res.text();
  } catch (_) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}
