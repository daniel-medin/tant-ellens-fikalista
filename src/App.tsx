import { useEffect, useMemo, useState } from "react";

type Fika = {
  id: string;
  date: string;
  host: string;
  treat: string;
};

type View = "calendar" | "leaderboard";

const storageKey = "tant-ellens-fikalista-v2";
const weekdayNames = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const monthNames = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];
function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function loadFikas(): Fika[] {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!isFikaList(parsed)) {
    throw new Error("Fikalistans sparade data har ett oväntat format.");
  }
  return parsed;
}

function isFikaList(value: unknown): value is Fika[] {
  return Array.isArray(value) && value.every(isFika);
}

function isFika(value: unknown): value is Fika {
  return typeof value === "object" &&
    value !== null &&
    "id" in value && typeof value.id === "string" &&
    "date" in value && typeof value.date === "string" &&
    "host" in value && typeof value.host === "string" &&
    "treat" in value && typeof value.treat === "string";
}

async function apiRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Servern svarade med ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function formatShortDate(key: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(fromDateKey(key));
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function App() {
  const [initialData] = useState(() => {
    try {
      return { fikas: loadFikas(), error: "" };
    } catch (error) {
      console.error("Kunde inte läsa fikalistan från lokal lagring.", error);
      return { fikas: [], error: "Kunde inte läsa sparad data." };
    }
  });
  const [fikas, setFikas] = useState<Fika[]>(initialData.fikas);
  const [activeView, setActiveView] = useState<View>("calendar");
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hostName, setHostName] = useState("");
  const [treatName, setTreatName] = useState("");
  const [saveError, setSaveError] = useState(initialData.error);
  const [apiMessage, setApiMessage] = useState("");
  const todayKey = dateKey(new Date());

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(fikas));
      setSaveError("");
    } catch (error) {
      console.error("Kunde inte spara fikalistan lokalt.", error);
      setSaveError("Kunde inte spara ändringen på den här enheten.");
    }
  }, [fikas]);

  useEffect(() => {
    let active = true;
    void apiRequest("/api/fikas")
      .then((data) => {
        if (!isFikaList(data)) throw new Error("Servern skickade en ogiltig fikalista.");
        if (active) {
          setFikas(data);
          setApiMessage("");
        }
      })
      .catch((error: unknown) => {
        console.error("Kunde inte hämta den delade fikalistan.", error);
        if (active) setApiMessage("Offline – ändringar sparas bara på den här enheten.");
      });
    return () => {
      active = false;
    };
  }, []);

  const upcoming = useMemo(
    () => fikas.filter((fika) => fika.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date)),
    [fikas, todayKey],
  );

  const leaderboard = useMemo(() => {
    const hostedCount = new Map<string, { host: string; count: number }>();
    fikas
      .filter((fika) => fika.date <= todayKey)
      .forEach((fika) => {
        const host = fika.host.trim();
        const key = host.toLocaleLowerCase("sv-SE");
        const current = hostedCount.get(key);
        hostedCount.set(key, { host: current?.host ?? host, count: (current?.count ?? 0) + 1 });
    });
    return [...hostedCount.values()]
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host, "sv"))
      .slice(0, 5);
  }, [fikas, todayKey]);

  const monthDays = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -startOffset);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [visibleMonth]);

  const selectedFikas = selectedDate
    ? fikas.filter((fika) => fika.date === selectedDate)
    : [];

  function openDay(key: string) {
    setSelectedDate(key);
    setHostName("");
    setTreatName("");
  }

  async function addFika(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDate || !hostName.trim()) return;
    const localId = crypto.randomUUID();
    const newFika: Fika = {
      id: localId,
      date: selectedDate,
      host: hostName.trim(),
      treat: treatName.trim() || "Hemligt fika",
    };
    setFikas((current) => [...current, newFika]);
    setHostName("");
    setTreatName("");
    try {
      const created = await apiRequest("/api/fikas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newFika.date, host: newFika.host, treat: newFika.treat }),
      });
      if (!isFika(created)) throw new Error("Servern skickade tillbaka en ogiltig fika.");
      setFikas((current) => [...current.filter((fika) => fika.id !== localId), created]);
      setApiMessage("");
    } catch (error) {
      console.error("Kunde inte dela fikaanmälan med servern.", error);
      setApiMessage("Anmälan sparades bara på den här enheten. Försök igen när du är online.");
    }
  }

  function changeMonth(amount: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setActiveView("calendar")}>
          <img className="brand-mark" src="/ellen-yarn.svg" alt="Ellen som garnfigur" />
          <span className="brand-copy">
            <span className="brand-name">Tant Ellens</span>
            <span className="brand-subtitle"><img className="chalmers-mark" src="/chalmers-mark.svg" alt="Chalmers logotyp" /> FIKALISTA · CHALMERS</span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Huvudmeny">
          <button
            className={activeView === "calendar" ? "nav-link active" : "nav-link"}
            onClick={() => setActiveView("calendar")}
          >
            Kalender
          </button>
          <button
            className={activeView === "leaderboard" ? "nav-link active" : "nav-link"}
            onClick={() => setActiveView("leaderboard")}
          >
            Topplista <span className="nav-sparkle">✳</span>
          </button>
        </nav>
        <div className="campus-tag"><span className="campus-dot" /> Fika förenar</div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span>☕</span> CHALMERS FIKAKLUBB</span>
          <h1>En riktigt bra fika</h1>
          <p>Boka en dag, bjud på något gott och hjälp oss hitta Chalmers godaste fika.</p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => openDay(todayKey)}>
              <span>＋</span> Boka fika
            </button>
            <button className="button button-quiet" onClick={() => setActiveView("leaderboard")}>
              Se topplistan <span>↗</span>
            </button>
          </div>
        </div>
      </section>

      <section className="main-content">
        {activeView === "calendar" ? (
          <>
            <section className="next-fika-card">
              <div className="card-topline"><span>NÄSTA FIKA</span><span className="tiny-star">✳</span></div>
              {upcoming.length ? (
                <>
                  <p className="next-date">{formatShortDate(upcoming[0].date)}</p>
                  <h3>{upcoming[0].treat === "Hemligt fika" ? "Något gott är på gång…" : upcoming[0].treat}</h3>
                  <div className="next-host"><span className="avatar">{upcoming[0].host.slice(0, 1).toUpperCase()}</span> {upcoming[0].host} fixar fikat</div>
                </>
              ) : (
                <>
                  <p className="next-date">Kalendern är tom</p>
                  <h3>Dags att rädda fikapausen!</h3>
                  <div className="next-host">Klicka på en dag och bli fikasuperhjälte.</div>
                </>
              )}
              <button className="text-button" onClick={() => openDay(upcoming[0]?.date ?? todayKey)}>
                {upcoming.length ? "Visa fikadagen" : "Boka första fikat"} <span>→</span>
              </button>
              <span className="card-cookie" aria-hidden="true">🍪</span>
            </section>
            <div className="dashboard-grid">
            <section className="calendar-panel panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">PLANERA NÅGOT GOTT</span>
                  <h2>Fikakalendern</h2>
                </div>
                <div className="month-switcher">
                  <button aria-label="Föregående månad" onClick={() => changeMonth(-1)}>‹</button>
                  <strong>{monthNames[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</strong>
                  <button aria-label="Nästa månad" onClick={() => changeMonth(1)}>›</button>
                </div>
              </div>
              <div className="calendar-grid" role="grid" aria-label="Fikakalender">
                {weekdayNames.map((day) => <div className="weekday" key={day}>{day}</div>)}
                {monthDays.map((day) => {
                  const key = dateKey(day);
                  const dayFikas = fikas.filter((fika) => fika.date === key);
                  const isToday = key === todayKey;
                  return (
                    <button
                      className={[
                        "calendar-day",
                        sameMonth(day, visibleMonth) ? "" : "outside-month",
                        isToday ? "today" : "",
                        selectedDate === key ? "selected" : "",
                      ].filter(Boolean).join(" ")}
                      key={key}
                      onClick={() => openDay(key)}
                      aria-label={`${formatShortDate(key)}${dayFikas.length ? `, ${dayFikas.length} fika${dayFikas.length > 1 ? "n" : ""}` : ""}`}
                    >
                      <span className="day-number">{day.getDate()}</span>
                      {dayFikas.length > 0 && (
                        <span className="day-events">
                          {dayFikas.slice(0, 2).map((fika) => (
                            <span className="day-event" key={fika.id}>
                              <span className="event-dot" /> {fika.host}
                            </span>
                          ))}
                          {dayFikas.length > 2 && <span className="more-events">+{dayFikas.length - 2} till</span>}
                        </span>
                      )}
                      {isToday && <span className="today-label">IDAG</span>}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-legend">
                <span><i className="legend-dot" /> Någon fixar fika</span>
                <span>Klicka på en dag för att vara med <b>↗</b></span>
              </div>
            </section>

            <aside className="sidebar">
              <section className="mini-leaderboard panel">
                <div className="mini-heading">
                  <div><span className="eyebrow">TACK FÖR FIKAT</span><h3>Mest bjussiga</h3></div>
                  <span className="trophy">🏆</span>
                </div>
                {leaderboard.slice(0, 3).map((person, index) => (
                  <div className="leader-row" key={person.host}>
                    <span className={`leader-rank rank-${index + 1}`}>{index + 1}</span>
                    <span className="leader-name">{person.host}<small>{person.count} {person.count === 1 ? "fikabjudning" : "fikabjudningar"}</small></span>
                    <span className="leader-score">☕ {person.count}</span>
                  </div>
                ))}
                {!leaderboard.length && <p className="empty-hint">Tacka någon genom att bjuda på fika – topplistan börjar efter första fikadagen.</p>}
                <button className="text-button leaderboard-link" onClick={() => setActiveView("leaderboard")}>Hela listan <span>→</span></button>
              </section>
            </aside>
          </div>
          </>
        ) : (
          <section className="leaderboard-page panel">
            <div className="leaderboard-intro">
              <span className="eyebrow">TACK FÖR FIKAT</span>
              <h2>Chalmers mest bjussiga</h2>
              <p>En liten topplista över alla som gjort fikapausen lite godare.</p>
            </div>
            <div className="leaderboard-list">
              {leaderboard.map((person, index) => (
                <div className="full-leader-row" key={person.host}>
                  <span className={`large-rank rank-${index + 1}`}>{index === 0 ? "✦" : index + 1}</span>
                  <span className="leader-avatar">{person.host.slice(0, 1).toUpperCase()}</span>
                  <span className="full-leader-name">{person.host}<small>{person.count} {person.count === 1 ? "fikabjudning" : "fikabjudningar"}</small></span>
                  <strong className="big-score">{person.count} ☕</strong>
                </div>
              ))}
              {!leaderboard.length && <p className="empty-hint">Topplistan fylls automatiskt efter att någon bjudit på sin första fika.</p>}
            </div>
            <div className="leaderboard-footer"><span>☕</span> Fika är bäst när man delar den. <button className="text-button" onClick={() => setActiveView("calendar")}>Till kalendern →</button></div>
          </section>
        )}
        <footer className="page-footer">
          <span>En liten fikapaus gör stor skillnad.</span>
          <span className="footer-brand">TANT ELLENS <b>✳</b> CHALMERS</span>
        </footer>
      </section>

      {saveError && <div className="save-warning" role="alert">{saveError}</div>}
      {apiMessage && <div className="save-warning" role="status">{apiMessage}</div>}

      {selectedDate && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedDate(null);
        }}>
          <section className="day-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" aria-label="Stäng" onClick={() => setSelectedDate(null)}>×</button>
            <span className="eyebrow">{selectedDate === todayKey ? "IDAG" : "FIKADAG"}</span>
            <h2 id="modal-title">{formatShortDate(selectedDate)}</h2>
            <div className="modal-divider" />
            <h3>Vilka fixar fikat?</h3>
            {selectedFikas.length ? (
              <div className="day-signups">
                {selectedFikas.map((fika) => (
                  <article className="signup-card" key={fika.id}>
                    <div className="signup-details">
                      <span className="avatar">{fika.host.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{fika.host}</strong><small>{fika.treat}</small></span>
                    </div>
                    {selectedDate > todayKey && <span className="coming-soon">På gång ✦</span>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-day">Ingen fika bokad än. Bli dagens fikasuperhjälte!</p>
            )}
            {selectedDate >= todayKey && (
              <form className="signup-form" onSubmit={addFika}>
                <label>
                  Ditt namn
                  <input value={hostName} onChange={(event) => setHostName(event.target.value)} placeholder="Vad ska vi kalla dig?" required maxLength={40} />
                </label>
                <label>
                  Vad bjuder du på? <span className="optional">(valfritt)</span>
                  <input value={treatName} onChange={(event) => setTreatName(event.target.value)} placeholder="Hemligt fika funkar också…" maxLength={60} />
                </label>
                <button className="button button-primary modal-submit" type="submit">Jag fixar fika <span>✦</span></button>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
