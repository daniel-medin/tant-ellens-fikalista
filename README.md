# Tant Ellens Fikalista

En responsiv React + TypeScript + Vite-PWA för fikaanmälningar och topplistan "Mest bjudsamma". Appen har en Express/SQLite-API så anmälningar och topplista delas mellan användare. SQLite-filen ligger i en persistent Docker-volym.

## Kom igång

```sh
npm install
npm run dev
```

Bygg produktionsversionen med `npm run build` och kör servern med `npm start`.

## Oracle

Deployfilerna finns i `deploy/oracle`. Deployscriptet bygger och skickar en Docker-container till Oracle, lägger till Caddy-routen och verifierar hälsokontrollen:

```powershell
.\deploy\oracle\deploy-oracle.ps1
```

Standardadressen är `https://tantellensfikalista.mrcheng.se/`. Kalendern har lokalt cacheläge för offlinevisning, men bokningar och topplista blir gemensamma när servern är tillgänglig. Topplistan räknar fikabjudningar vars datum har passerat.
