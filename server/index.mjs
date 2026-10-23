import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";

const appRoot = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATABASE_PATH || join(appRoot, "..", "data", "fikalista.sqlite");
mkdirSync(dirname(dataPath), { recursive: true });

const db = new Database(dataPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS fikas (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    host TEXT NOT NULL,
    treat TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ratings (
    fika_id TEXT NOT NULL REFERENCES fikas(id) ON DELETE CASCADE,
    voter_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (fika_id, voter_id)
  );
`);

const countFikas = db.prepare("SELECT COUNT(*) AS count FROM fikas").get().count;
if (countFikas === 0) {
  const samples = [
    [-18, "Maja", "Kardemummabullar", 5],
    [-13, "Oskar", "Kladdkaka deluxe", 4],
    [-8, "Fatima", "Citronmarängpaj", 5],
    [-3, "Viktor", "Chokladbollar", 3],
    [2, "Linnea", "Hemligt", 0],
    [5, "Amir", "Kanelbullar", 0],
    [9, "Elsa", "Morotskaka", 0],
    [12, "Noah", "Hemligt", 0],
  ];
  const insertFika = db.prepare("INSERT INTO fikas (id, date, host, treat) VALUES (?, ?, ?, ?)");
  const insertRating = db.prepare("INSERT INTO ratings (fika_id, voter_id, score) VALUES (?, ?, ?)");
  const seed = db.transaction(() => {
    for (const [offset, host, treat, score] of samples) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const id = randomUUID();
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      insertFika.run(id, key, host, treat);
      if (score) insertRating.run(id, `seed-${id}`, score);
    }
  });
  seed();
}

const app = express();
const port = Number(process.env.PORT || 8080);
const distPath = join(appRoot, "..", "dist");

app.disable("x-powered-by");
app.use(express.json({ limit: "4kb" }));

const listFikas = db.prepare(`
  SELECT f.id, f.date, f.host, f.treat,
    COALESCE(ROUND(AVG(r.score), 1), 0) AS rating,
    COUNT(r.score) AS ratingCount,
    COALESCE(MAX(CASE WHEN r.voter_id = ? THEN r.score END), 0) AS myRating
  FROM fikas f
  LEFT JOIN ratings r ON r.fika_id = f.id
  GROUP BY f.id
  ORDER BY f.date, f.created_at
`);

function getFikas(voterId = "") {
  return listFikas.all(voterId);
}

function getFika(id, voterId) {
  return getFikas(voterId).find((fika) => fika.id === id);
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/fikas", (req, res) => {
  const voterId = typeof req.query.voterId === "string" ? req.query.voterId.slice(0, 100) : "";
  res.json(getFikas(voterId));
});

app.post("/api/fikas", (req, res) => {
  const { date, host, treat } = req.body ?? {};
  if (!validDate(date) || !validText(host, 40) || (treat !== undefined && (typeof treat !== "string" || treat.length > 60))) {
    res.status(400).json({ error: "Kontrollera datum, namn och fikabeskrivning." });
    return;
  }
  const fika = {
    id: randomUUID(),
    date,
    host: host.trim(),
    treat: treat?.trim() || "Hemligt fika",
  };
  db.prepare("INSERT INTO fikas (id, date, host, treat) VALUES (@id, @date, @host, @treat)").run(fika);
  res.status(201).json({ ...fika, rating: 0, ratingCount: 0, myRating: 0 });
});

app.post("/api/fikas/:id/ratings", (req, res) => {
  const { voterId, rating } = req.body ?? {};
  if (!validText(voterId, 100) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Ange ett betyg mellan 1 och 5 stjärnor." });
    return;
  }
  if (!db.prepare("SELECT 1 FROM fikas WHERE id = ?").get(req.params.id)) {
    res.status(404).json({ error: "Fikan hittades inte." });
    return;
  }
  db.prepare(`
    INSERT INTO ratings (fika_id, voter_id, score) VALUES (?, ?, ?)
    ON CONFLICT(fika_id, voter_id) DO UPDATE SET score = excluded.score, created_at = CURRENT_TIMESTAMP
  `).run(req.params.id, voterId.trim(), rating);
  res.json(getFika(req.params.id, voterId.trim()));
});

app.use(express.static(distPath, { etag: true, maxAge: "1h" }));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    res.sendFile(join(distPath, "index.html"));
    return;
  }
  next();
});

app.use((error, _req, res, _next) => {
  console.error("API request failed.", error);
  res.status(500).json({ error: "Ett oväntat serverfel inträffade." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Tant Ellens Fikalista lyssnar på port ${port}.`);
});
