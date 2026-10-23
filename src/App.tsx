import { useEffect, useMemo, useState } from "react";

type Fika = {
  id: string;
  date: string;
  host: string;
  treat: string;
  rating: number;
  ratingCount?: number;
  myRating?: number;
};

type View = "calendar" | "leaderboard";

const storageKey = "tant-ellens-fikalista-v1";
const weekdayNames = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const monthNames = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];
const sampleFikas = [
  { offset: -18, host: "Maja", treat: "Kardemummabullar", rating: 5 },
  { offset: -13, host: "Oskar", treat: "Kladdkaka deluxe", rating: 4 },
  { offset: -8, host: "Fatima", treat: "Citronmarängpaj", rating: 5 },
  { offset: -3, host: "Viktor", treat: "Chokladbollar", rating: 3 },
  { offset: 2, host: "Linnea", treat: "Hemligt", rating: 0 },
  { offset: 5, host: "Amir", treat: "Kanelbullar", rating: 0 },
  { offset: 9, host: "Elsa", treat: "Morotskaka", rating: 0 },
  { offset: 12, host: "Noah", treat: "Hemligt", rating: 0 },
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

function createSamples(): Fika[] {
  const today = new Date();
  return sampleFikas.map((fika, index) => ({
    id: `sample-${index}`,
    date: dateKey(addDays(today, fika.offset)),
    host: fika.host,
    treat: fika.treat,
    rating: fika.rating,
  }));
}

function loadFikas(): Fika[] {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return createSamples();

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
    "treat" in value && typeof value.treat === "string" &&
    "rating" in value && typeof value.rating === "number" &&
    Number.isFinite(value.rating) && value.rating >= 0 && value.rating <= 5;
}

function getOrCreateVoterId(): string {
  try {
    const existing = localStorage.getItem("tant-ellens-voter");
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem("tant-ellens-voter", created);
    return created;
  } catch (error) {
    console.error("Kunde inte spara röstnings-ID lokalt.", error);
    return crypto.randomUUID();
  }
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
      return { fikas: createSamples(), error: "Kunde inte läsa sparad data. En exempellista visas." };
    }
  });
  const [fikas, setFikas] = useState<Fika[]>(initialData.fikas);
  const [voterId] = useState(getOrCreateVoterId);
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
    void apiRequest(`/api/fikas?voterId=${encodeURIComponent(voterId)}`)
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
  }, [voterId]);

  const upcoming = useMemo(
    () => fikas.filter((fika) => fika.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date)),
    [fikas, todayKey],
  );

  const leaderboard = useMemo(() => {
    const ratings = new Map<string, { total: number; count: number }>();
    fikas.forEach((fika) => {
      if (!fika.rating) return;
      const current = ratings.get(fika.host) ?? { total: 0, count: 0 };
      ratings.set(fika.host, { total: current.total + fika.rating, count: current.count + 1 });
    });
    return [...ratings.entries()]
      .map(([host, score]) => ({ host, average: score.total / score.count, count: score.count }))
      .sort((a, b) => b.average - a.average || b.count - a.count)
      .slice(0, 5);
  }, [fikas]);

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
      rating: 0,
      ratingCount: 0,
      myRating: 0,
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

  async function rateFika(id: string, rating: number) {
    setFikas((current) =>
      current.map((fika) => (fika.id === id ? { ...fika, myRating: rating, rating: fika.rating || rating } : fika)),
    );
    try {
      const updated = await apiRequest(`/api/fikas/${encodeURIComponent(id)}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId, rating }),
      });
      if (!isFika(updated)) throw new Error("Servern skickade tillbaka ett ogiltigt betyg.");
      setFikas((current) => current.map((fika) => (fika.id === id ? updated : fika)));
      setApiMessage("");
    } catch (error) {
      console.error("Kunde inte dela fikabetyget med servern.", error);
      setApiMessage("Betyget sparades bara på den här enheten. Försök igen när du är online.");
    }
  }

  function changeMonth(amount: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setActiveView("calendar")}>
          <img className="brand-mark" src="/fika-donut.svg" alt="" />
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
          <h1>En kopp kaffe.<br /><em>En riktigt bra</em> fika.</h1>
          <p>Boka en dag, bjud på något gott och hjälp oss hitta Chalmers godaste fika.</p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => openDay(todayKey)}>
              <span>＋</span> Boka fika
            </button>
            <button className="button button-quiet" onClick={() => setActiveView("leaderboard")}>
              Se topplistan <span>↗</span>
            </button>
          </div>
          <div className="hero-note"><span className="note-icon">✦</span> Bra fika. Bra folk. Bättre måndagar.</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="art-sun" />
          <span className="art-sprinkle sprinkle-one">✦</span>
          <span className="art-sprinkle sprinkle-two">✳</span>
          <span className="art-sprinkle sprinkle-three">•</span>
          <img src="/fika-donut.svg" alt="" />
          <img className="ellen-yarn" src="/ellen-yarn.svg" alt="Ellen som en liten garnfigur med långt brunt hår och stickad tröja" />
          <span className="art-caption">BAKAD MED<br />KÄRLEK ♡</span>
        </div>
        <div className="hero-bottom-sprinkles" aria-hidden="true">✦　•　✳　•　✦　•　✳</div>
      </section>

      <section className="main-content">
        {activeView === "calendar" ? (
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
              <section className="next-fika-card">
                <div className="card-topline"><span>NÄSTA FIKA</span><span className="tiny-star">✳</span></div>
                {upcoming.length ? (
                  <>
                    <p className="next-date">{formatShortDate(upcoming[0].date)}</p>
                    <h3>{upcoming[0].treat === "Hemligt" ? "Något gott är på gång…" : upcoming[0].treat}</h3>
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

              <section className="mini-leaderboard panel">
                <div className="mini-heading">
                  <div><span className="eyebrow">FIKAKÄRLEK</span><h3>Veckans favoriter</h3></div>
                  <span className="trophy">🏆</span>
                </div>
                {leaderboard.slice(0, 3).map((person, index) => (
                  <div className="leader-row" key={person.host}>
                    <span className={`leader-rank rank-${index + 1}`}>{index + 1}</span>
                    <span className="leader-name">{person.host}<small>{person.count} {person.count === 1 ? "betyg" : "betyg"}</small></span>
                    <span className="leader-score">★ {person.average.toFixed(1)}</span>
                  </div>
                ))}
                {!leaderboard.length && <p className="empty-hint">Rösta på en fika så dyker favoriterna upp här.</p>}
                <button className="text-button leaderboard-link" onClick={() => setActiveView("leaderboard")}>Hela topplistan <span>→</span></button>
              </section>
            </aside>
          </div>
        ) : (
          <section className="leaderboard-page panel">
            <div className="leaderboard-intro">
              <span className="eyebrow">ÄRA, BERÖMMELSE & SMULOR</span>
              <h2>Chalmers fikalegender</h2>
              <p>Stjärnorna avgör. Smulorna är ett kvalitetsmärke.</p>
            </div>
            <div className="leaderboard-list">
              {leaderboard.map((person, index) => (
                <div className="full-leader-row" key={person.host}>
                  <span className={`large-rank rank-${index + 1}`}>{index === 0 ? "✦" : index + 1}</span>
                  <span className="leader-avatar">{person.host.slice(0, 1).toUpperCase()}</span>
                  <span className="full-leader-name">{person.host}<small>{person.count} fika{person.count === 1 ? "" : "r"} betygsatt{person.count === 1 ? "" : "a"}</small></span>
                  <span className="big-stars" aria-label={`${person.average.toFixed(1)} av 5 stjärnor`}>{"★".repeat(Math.round(person.average))}<span>{"★".repeat(5 - Math.round(person.average))}</span></span>
                  <strong className="big-score">{person.average.toFixed(1)}</strong>
                </div>
              ))}
              {!leaderboard.length && <p className="empty-hint">Ingen fika har fått betyg ännu. Bli den första att rösta!</p>}
            </div>
            <div className="leaderboard-footer"><span>🍩</span> Nästa stjärna kan vara din fika. <button className="text-button" onClick={() => setActiveView("calendar")}>Till kalendern →</button></div>
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
                    {selectedDate <= todayKey ? (
                      <div className="rating-control" aria-label={`Betygsätt ${fika.treat}`}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            className={star <= (fika.myRating || Math.round(fika.rating)) ? "star-button filled" : "star-button"}
                            onClick={() => rateFika(fika.id, star)}
                            aria-label={`${star} stjärnor`}
                            title={`${star} stjärnor`}
                          >★</button>
                        ))}
                        {fika.ratingCount ? <span className="rating-count">{fika.rating.toFixed(1)} · {fika.ratingCount} röster</span> : null}
                      </div>
                    ) : <span className="coming-soon">På gång ✦</span>}
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
            {selectedDate < todayKey && selectedFikas.length > 0 && (
              <p className="rating-hint">Tryck på stjärnorna och rösta på fikat ⭐</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
