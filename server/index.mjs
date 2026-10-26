import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import express from "express";
import allergenOptions from "./allergens.json" with { type: "json" };

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
  DROP TABLE IF EXISTS ratings;
`);
if (!db.prepare("PRAGMA table_info(fikas)").all().some((column) => column.name === "allergens")) {
  db.exec("ALTER TABLE fikas ADD COLUMN allergens TEXT NOT NULL DEFAULT '[]'");
}
const allergenIds = new Set(allergenOptions.map((allergen) => allergen.id));

const app = express();
const port = Number(process.env.PORT || 8080);
const distPath = join(appRoot, "..", "dist");

app.disable("x-powered-by");
app.use(express.json({ limit: "4kb" }));

const listFikas = db.prepare(`
  SELECT id, date, host, treat, allergens
  FROM fikas
  ORDER BY date, created_at
`);

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/fikas", (req, res) => {
  res.json(listFikas.all().map((fika) => ({ ...fika, allergens: JSON.parse(fika.allergens) })));
});

app.post("/api/fikas", (req, res) => {
  const { date, host, treat, allergens = [] } = req.body ?? {};
  if (!validDate(date) || !validText(host, 40) || (treat !== undefined && (typeof treat !== "string" || treat.length > 60))) {
    res.status(400).json({ error: "Kontrollera datum, namn och fikabeskrivning." });
    return;
  }
  if (!Array.isArray(allergens) || allergens.length > allergenOptions.length || !allergens.every((id) => typeof id === "string" && allergenIds.has(id))) {
    res.status(400).json({ error: "Välj allergener från listan." });
    return;
  }
  const fika = {
    id: randomUUID(),
    date,
    host: host.trim(),
    treat: treat?.trim() || "Hemligt fika",
    allergens: [...new Set(allergens)],
  };
  db.prepare("INSERT INTO fikas (id, date, host, treat, allergens) VALUES (@id, @date, @host, @treat, @allergens)").run({ ...fika, allergens: JSON.stringify(fika.allergens) });
  res.status(201).json(fika);
});

app.delete("/api/fikas/:id", (req, res) => {
  db.prepare("DELETE FROM fikas WHERE id = ?").run(req.params.id);
  res.json({ id: req.params.id });
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
