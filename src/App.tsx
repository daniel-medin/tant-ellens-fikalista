import { useEffect, useMemo, useState } from "react";
import allergenOptions from "../server/allergens.json";

type Fika = {
  id: string;
  date: string;
  host: string;
  treat: string;
  allergens?: string[];
};

type View = "overview" | "calendar" | "leaderboard";

const storageKey = "tant-ellens-fikalista-v2";
const allergenIds = new Set(allergenOptions.map((allergen) => allergen.id));
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
    "treat" in value && typeof value.treat === "string" &&
    (!("allergens" in value) || (Array.isArray(value.allergens) && value.allergens.every((id) => typeof id === "string" && allergenIds.has(id))));
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

function AllergenBadges({ allergens = [] }: { allergens?: string[] }) {
  const selected = allergenOptions.filter((allergen) => allergens.includes(allergen.id));
  if (!selected.length) return <p className="allergen-unknown">Allergener ej angivna</p>;
  return (
    <div className="allergen-notice">
      <span className="allergen-caption">Innehåller</span>
      <ul className="allergen-badges" aria-label="Angivna allergener">
        {selected.map((allergen) => (
          <li className="allergen-badge" key={allergen.id}><span aria-hidden="true">{allergen.icon}</span>{allergen.label}</li>
        ))}
      </ul>
    </div>
  );
}

function FikaSummary({ fikas }: { fikas: Fika[] }) {
  return (
    <>
      <p className="next-date">{formatShortDate(fikas[0].date)}</p>
      {fikas.map((fika) => (
        <div className="fika-summary-entry" key={fika.id}>
          <p className="next-treat">{fika.treat === "Hemligt fika" ? "Något gott är på gång…" : fika.treat}</p>
          <div className="next-host"><span className="avatar">{fika.host.slice(0, 1).toUpperCase()}</span> {fika.host} fixar fikat</div>
          <AllergenBadges allergens={fika.allergens} />
        </div>
      ))}
    </>
  );
}

function UpcomingFikaSummary({ fikas }: { fikas: Fika[] }) {
  return (
    <div className="upcoming-fika-row">
      <time className="upcoming-date" dateTime={fikas[0].date}>{formatShortDate(fikas[0].date)}</time>
      <p className="upcoming-hosts">{fikas.map((fika) => fika.host).join(", ")}</p>
    </div>
  );
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
  const [activeView, setActiveView] = useState<View>("overview");
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hostName, setHostName] = useState("");
  const [treatName, setTreatName] = useState("");
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<{ host?: string; treat?: string }>({});
  const [saveError, setSaveError] = useState(initialData.error);
  const [apiMessage, setApiMessage] = useState("");
  const [pendingFikaIds, setPendingFikaIds] = useState<Set<string>>(() => new Set());
  const [additionalFikaCount, setAdditionalFikaCount] = useState(0);
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
  const todayFikas = upcoming.filter((fika) => fika.date === todayKey);
  const futureFikaGroups = useMemo(() => {
    const groups = new Map<string, Fika[]>();
    upcoming.filter((fika) => fika.date > todayKey).forEach((fika) => {
      const group = groups.get(fika.date) ?? [];
      group.push(fika);
      groups.set(fika.date, group);
    });
    return [...groups.values()];
  }, [upcoming, todayKey]);
  const nextFikas = futureFikaGroups[0] ?? [];
  const featuredFikas = todayFikas.length ? todayFikas : nextFikas;
  const followingFikaGroups = futureFikaGroups.slice(todayFikas.length ? 0 : 1, 1 + additionalFikaCount);
  const hasMoreFikas = futureFikaGroups.length > 1 + additionalFikaCount;

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
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
    const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => addDays(gridStart, index));
  }, [visibleMonth]);

  const selectedFikas = selectedDate
    ? fikas.filter((fika) => fika.date === selectedDate)
    : [];

  function openDay(key: string) {
    setSelectedDate(key);
    setHostName("");
    setTreatName("");
    setFormErrors({});
    setSelectedAllergens([]);
  }

  async function addFika(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDate) return;
    const errors: { host?: string; treat?: string } = {};
    if (!hostName.trim()) errors.host = "Skriv ditt namn så att vi vet vem som fixar fikat.";
    else if (hostName.trim().length > 40) errors.host = "Namnet får vara högst 40 tecken.";
    if (treatName.length > 60) errors.treat = "Fikabeskrivningen får vara högst 60 tecken.";
    setFormErrors(errors);
    if (errors.host || errors.treat) {
      const field = event.currentTarget.elements.namedItem(errors.host ? "host" : "treat");
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }
    const localId = crypto.randomUUID();
    const newFika: Fika = {
      id: localId,
      date: selectedDate,
      host: hostName.trim(),
      treat: treatName.trim() || "Hemligt fika",
      allergens: selectedAllergens,
    };
    setFikas((current) => [...current, newFika]);
    setPendingFikaIds((current) => new Set(current).add(localId));
    setHostName("");
    setTreatName("");
    setSelectedAllergens([]);
    setSelectedDate(null);
    try {
      const created = await apiRequest("/api/fikas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newFika.date, host: newFika.host, treat: newFika.treat, allergens: newFika.allergens }),
      });
      if (!isFika(created)) throw new Error("Servern skickade tillbaka en ogiltig fika.");
      setFikas((current) => [...current.filter((fika) => fika.id !== localId), created]);
      setApiMessage("");
    } catch (error) {
      console.error("Kunde inte dela fikaanmälan med servern.", error);
      setApiMessage("Anmälan sparades bara på den här enheten. Försök igen när du är online.");
    } finally {
      setPendingFikaIds((current) => {
        const next = new Set(current);
        next.delete(localId);
        return next;
      });
    }
  }

  async function removeFika(fika: Fika) {
    if (pendingFikaIds.has(fika.id)) return;
    if (!window.confirm(`Är du säker? Det blir ju inte kul utan fika!\n\nTa bort fikat som ${fika.host} fixar ${formatShortDate(fika.date)}?`)) return;

    setPendingFikaIds((current) => new Set(current).add(fika.id));
    try {
      await apiRequest(`/api/fikas/${encodeURIComponent(fika.id)}`, { method: "DELETE" });
      setFikas((current) => current.filter((item) => item.id !== fika.id));
      setSelectedDate((current) => current === fika.date ? null : current);
      setApiMessage("");
    } catch (error) {
      console.error("Kunde inte ta bort fikat.", error);
      setApiMessage("Kunde inte ta bort fikat. Försök igen.");
    } finally {
      setPendingFikaIds((current) => {
        const next = new Set(current);
        next.delete(fika.id);
        return next;
      });
    }
  }

  function changeMonth(amount: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setActiveView("overview")}>
          <img className="brand-mark" src="/ellen-yarn.svg" alt="Ellen som garnfigur" />
          <span className="brand-name">Tant Ellens</span>
        </a>
        <button className="button book-fika-button" onClick={() => setActiveView("calendar")}>
          <span aria-hidden="true">＋</span> Boka fika
        </button>
        <nav className="main-nav" aria-label="Huvudmeny">
          <button
            className={activeView === "overview" ? "nav-link active" : "nav-link"}
            aria-current={activeView === "overview" ? "page" : undefined}
            onClick={() => setActiveView("overview")}
          >
            Översikt
          </button>
          <button
            className={activeView === "calendar" ? "nav-link active" : "nav-link"}
            aria-current={activeView === "calendar" ? "page" : undefined}
            onClick={() => setActiveView("calendar")}
          >
            Kalender
          </button>
          <button
            className={activeView === "leaderboard" ? "nav-link active" : "nav-link"}
            aria-current={activeView === "leaderboard" ? "page" : undefined}
            onClick={() => setActiveView("leaderboard")}
          >
            Topplista <span className="nav-sparkle">✳</span>
          </button>
        </nav>
      </header>

      <section className="main-content" aria-label={activeView === "overview" ? "Översikt" : activeView === "calendar" ? "Kalender" : "Topplista"}>
        {activeView === "overview" ? (
          <div className="overview-grid">
            <div className="fika-overview">
              <section className="next-fika-card" aria-labelledby="next-fika-title">
                <div className="card-topline"><h2 id="next-fika-title">{todayFikas.length ? "Fika idag" : "Nästa fika"}</h2><span className="tiny-star" aria-hidden="true">✳</span></div>
                {featuredFikas.length ? (
                  <FikaSummary fikas={featuredFikas} />
                ) : (
                  <>
                    <p className="next-treat">Dags att rädda fikapausen!</p>
                    <div className="next-host">Välj en dag i kalendern och bli fikasuperhjälte.</div>
                  </>
                )}
                {!featuredFikas.length && <button className="text-button" onClick={() => setActiveView("calendar")}>Boka första fikat <span>→</span></button>}
                <span className="card-cookie" aria-hidden="true">🍪</span>
              </section>
              <div className="following-fikas">
                {followingFikaGroups.map((group, index) => (
                  <section className="following-fika" key={group[0].date} aria-labelledby={`following-fika-${group[0].date}`}>
                    {index > 0 && <hr className="fika-divider" />}
                    <h3 id={`following-fika-${group[0].date}`}>{todayFikas.length && index === 0 ? "Nästa fika:" : "Kommande fika:"}</h3>
                    <UpcomingFikaSummary fikas={group} />
                  </section>
                ))}
                {todayFikas.length > 0 && !nextFikas.length && (
                  <section className="following-fika" aria-labelledby="following-fika-title">
                    <h3 id="following-fika-title">Nästa fika:</h3>
                    <p className="next-host">Inget mer fika är bokat än.</p>
                  </section>
                )}
                {hasMoreFikas && (
                  <button className="text-button show-next-fika" onClick={() => setAdditionalFikaCount((current) => current + 1)}>
                    Visa nästa <span aria-hidden="true">↓</span>
                  </button>
                )}
              </div>
            </div>
            <section className="mini-leaderboard panel">
              <div className="mini-heading">
                <div><span className="eyebrow">TACK FÖR FIKAT</span><h2>Mest bjussiga</h2></div>
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
          </div>
        ) : activeView === "calendar" ? (
          <section className="calendar-panel panel" aria-labelledby="calendar-month">
            <div className="calendar-toolbar">
              <h2 id="calendar-month" aria-live="polite">{monthNames[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</h2>
              <div className="month-switcher">
                <button aria-label="Föregående månad" onClick={() => changeMonth(-1)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
                </button>
                <button aria-label="Nästa månad" onClick={() => changeMonth(1)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
                </button>
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
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${formatShortDate(key)}${dayFikas.length ? `, ${dayFikas.length} fika${dayFikas.length > 1 ? "n" : ""}: ${dayFikas.map((fika) => fika.host).join(", ")}` : ""}`}
                  >
                    <span className="day-number">{day.getDate()}</span>
                    {dayFikas.length > 0 && (
                      <span className="day-events">
                        {dayFikas.slice(0, 2).map((fika) => (
                          <span className="day-event" key={fika.id}>
                            <span className="event-dot" /><span className="event-host">{fika.host}</span>
                          </span>
                        ))}
                        {dayFikas.length > 2 && <span className="more-events">+{dayFikas.length - 2} till</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="calendar-legend">
              <span><i className="legend-dot" /> Någon fixar fika</span>
              <span>Klicka på en dag för att vara med <b>↗</b></span>
            </div>
          </section>
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
            <h3>{selectedDate < todayKey ? "Vilka fixade fikat?" : "Vilka fixar fikat?"}</h3>
            {selectedFikas.length ? (
              <div className="day-signups">
                {selectedFikas.map((fika) => (
                  <article className="signup-card" key={fika.id}>
                    <div className="signup-content">
                      <div className="signup-details">
                        <span className="avatar">{fika.host.slice(0, 1).toUpperCase()}</span>
                        <span><strong>{fika.host}</strong><small>{fika.treat}</small></span>
                      </div>
                      <AllergenBadges allergens={fika.allergens} />
                    </div>
                    <div className="signup-actions">
                      {selectedDate > todayKey && <span className="coming-soon">På gång ✦</span>}
                      <button
                        className="delete-fika"
                        type="button"
                        aria-label={`Ta bort fika för ${fika.host}`}
                        title="Ta bort fika"
                        disabled={pendingFikaIds.has(fika.id)}
                        aria-busy={pendingFikaIds.has(fika.id)}
                        onClick={() => void removeFika(fika)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" />
                        </svg>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-day">{selectedDate < todayKey ? "Ingen fika var bokad den här dagen." : "Ingen fika bokad än. Bli dagens fikasuperhjälte!"}</p>
            )}
            {selectedDate < todayKey && <p className="empty-day">Det går inte att boka fika retroaktivt.</p>}
            {selectedDate >= todayKey && (
              <form className="signup-form" onSubmit={addFika} noValidate>
                <label>
                  Ditt namn
                  <input name="host" value={hostName} onChange={(event) => {
                    setHostName(event.target.value);
                    setFormErrors((current) => ({ ...current, host: undefined }));
                  }} placeholder="Vad ska vi kalla dig?" required maxLength={40} aria-invalid={!!formErrors.host} aria-describedby={formErrors.host ? "host-error" : undefined} />
                  {formErrors.host && <span className="field-error" id="host-error" role="alert">{formErrors.host}</span>}
                </label>
                <label>
                  Vad bjuder du på? <span className="optional">(valfritt)</span>
                  <input name="treat" value={treatName} onChange={(event) => {
                    setTreatName(event.target.value);
                    setFormErrors((current) => ({ ...current, treat: undefined }));
                  }} placeholder="Hemligt fika funkar också…" maxLength={60} aria-invalid={!!formErrors.treat} aria-describedby={formErrors.treat ? "treat-error" : undefined} />
                  {formErrors.treat && <span className="field-error" id="treat-error" role="alert">{formErrors.treat}</span>}
                </label>
                <fieldset className="allergen-field">
                  <legend>Allergener <span className="optional">(valfritt)</span></legend>
                  <p className="allergen-help" id="allergen-help">Markera det fikat innehåller.</p>
                  <details className="allergen-picker">
                    <summary>Välj allergener <span>{selectedAllergens.length ? `${selectedAllergens.length} valda` : "30 val"}</span></summary>
                    <div className="allergen-options" role="group" aria-label="Allergener i fikat" aria-describedby="allergen-help">
                      {allergenOptions.map((allergen) => (
                        <label className="allergen-option" key={allergen.id}>
                          <input type="checkbox" name="allergens" value={allergen.id} checked={selectedAllergens.includes(allergen.id)} onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setSelectedAllergens((current) => checked ? [...current, allergen.id] : current.filter((id) => id !== allergen.id));
                          }} />
                          <span aria-hidden="true">{allergen.icon}</span><span>{allergen.label}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                  {selectedAllergens.length > 0 && <AllergenBadges allergens={selectedAllergens} />}
                </fieldset>
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
