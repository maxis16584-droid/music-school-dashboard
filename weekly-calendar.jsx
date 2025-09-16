/* global React, ReactDOM */
const { useMemo, useState } = React;

function wcStartOfWeekMonday(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // Sun=0..Sat=6
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function wcAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function wcIsSameYMD(a, b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function wcToDate(val) { return val instanceof Date ? val : new Date(val); }
function wcHHMM(date) { const h=String(date.getHours()).padStart(2,'0'); const m=String(date.getMinutes()).padStart(2,'0'); return `${h}:${m}`; }

function WeeklyCalendar({
  events = [],
  initialDate = new Date(),
  startHour = 13,
  endHour = 20,
  onEventClick,
  onWeekChange,
}) {
  const [weekStart, setWeekStart] = useState(() => wcStartOfWeekMonday(initialDate));
  const days = useMemo(() => [...Array(7)].map((_, i) => wcAddDays(weekStart, i)), [weekStart]);
  const hours = useMemo(() => [...Array(endHour - startHour + 1)].map((_, i) => startHour + i), [startHour, endHour]);

  const eventsByDayHour = useMemo(() => {
    const map = new Map(); // key `${dayIndex}-${hour}` -> events[]
    for (const ev of events) {
      const s = wcToDate(ev.start);
      const e = ev.end ? wcToDate(ev.end) : s;
      days.forEach((dayDate, dayIdx) => {
        if (!wcIsSameYMD(s, dayDate) && !wcIsSameYMD(e, dayDate)) return;
        const sameDay = wcIsSameYMD(s, dayDate);
        const sameDayEnd = wcIsSameYMD(e, dayDate);
        const startH = sameDay ? s.getHours() : startHour;
        const endH = sameDayEnd ? Math.max(startH, e.getHours()) : endHour;
        for (let h = startH; h <= endH; h++) {
          if (h < startHour || h > endHour) continue;
          const key = `${dayIdx}-${h}`;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(ev);
        }
      });
    }
    return map;
  }, [events, days, startHour, endHour]);

  function navigate(deltaDays) {
    const next = wcAddDays(weekStart, deltaDays);
    next.setHours(0, 0, 0, 0);
    setWeekStart(next);
    onWeekChange && onWeekChange(next);
  }

  const weekLabel = (() => {
    const start = days[0];
    const end = days[6];
    const opts = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
  })();

  const weekdayHeader = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="wc-container">
      <div className="wc-toolbar">
        <div className="wc-left">
          <button className="wc-btn" onClick={() => navigate(-7)}>&lt;</button>
          <button className="wc-btn" onClick={() => { const t = wcStartOfWeekMonday(new Date()); setWeekStart(t); onWeekChange && onWeekChange(t); }}>This week</button>
          <button className="wc-btn" onClick={() => navigate(7)}>&gt;</button>
        </div>
        <div className="wc-title">{weekLabel}</div>
        <div className="wc-right"></div>
      </div>

      <div className="wc-grid">
        <div className="wc-header wc-corner" />
        {days.map((d, i) => (
          <div key={i} className="wc-header wc-day">{weekdayHeader(d)}</div>
        ))}

        {hours.map((h) => (
          <React.Fragment key={h}>
            <div className="wc-hour">{String(h).padStart(2, '0')}:00</div>
            {days.map((_, dayIdx) => {
              const key = `${dayIdx}-${h}`;
              const cellEvents = eventsByDayHour.get(key) || [];
              return (
                <div key={key} className="wc-cell" data-hour={h}>
                  {cellEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="wc-event"
                      title={`${ev.title}\n${wcHHMM(wcToDate(ev.start))}${ev.end ? ' – ' + wcHHMM(wcToDate(ev.end)) : ''}`}
                      style={{ background: ev.color || 'var(--wc-event)' }}
                      onClick={() => onEventClick && onEventClick(ev)}
                    >
                      <span className="wc-event-title">{ev.title}</span>
                      <span className="wc-event-time">
                        {wcHHMM(wcToDate(ev.start))}{ev.end ? `–${wcHHMM(wcToDate(ev.end))}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Expose a simple renderer wired to the #calendar-root
window.renderWeeklyCalendar = function(events, opts = {}) {
  const rootEl = document.getElementById('calendar-root');
  if (!rootEl) return;
  const root = (rootEl.__root ||= ReactDOM.createRoot(rootEl));
  root.render(<WeeklyCalendar events={events} onEventClick={(ev)=>console.log('Event', ev)} {...opts} />);
};

// If there were pending events queued before this script loaded
if (Array.isArray(window.__pendingCalendarEvents)) {
  window.renderWeeklyCalendar(window.__pendingCalendarEvents);
}
