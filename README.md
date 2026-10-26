# Tant Ellens Fikalista

En responsiv React + TypeScript + Vite-PWA för fikaanmälningar och topplistan "Mest bjudsamma". Appen har en Express/SQLite-API så anmälningar och topplista delas mellan användare. SQLite-filen ligger i en persistent Docker-volym.

## Kom igång

```sh
npm install
npm run dev
```

Bygg produktionsversionen med `npm run build` och kör servern med `npm start`.

## Allergener

Vid bokning kan värden ange allergener från 30 ingrediensval. Valen visas med ikon och namn på översikten och i kalenderns dagsvy. Ej angivna allergener betyder inte allergenfritt. Listan finns i `server/allergens.json` och används av både klienten och API:et. Den utgår från [Livsmedelsverkets 14 allergengrupper](https://www.livsmedelsverket.se/livsmedel-och-innehall/text-pa-forpackning-markning/allergimarkning), med spannmål och nötter separat samt fyra [fruktallergener](https://www.livsmedelsverket.se/matvanor-halsa--miljo/sjukdomar-allergier-och-halsa/allergi-och-overkanslighet/frukt-och-gronsaker1/). Det är ingen rangordning över de 30 vanligaste allergenerna.

Servern lägger automatiskt till allergenfältet i befintliga databaser utan att ändra bokningarna. Äldre bokningar visas som ”Allergener ej angivna”.

## Oracle

Deployfilerna finns i `deploy/oracle`. Deployscriptet bygger och skickar en Docker-container till Oracle, lägger till Caddy-routen och verifierar hälsokontrollen:

```powershell
.\deploy\oracle\deploy-oracle.ps1
```

Standardadressen är `https://tantellensfikalista.mrcheng.se/`. Kalendern har lokalt cacheläge för offlinevisning, men bokningar och topplista blir gemensamma när servern är tillgänglig. Topplistan räknar fikabjudningar vars datum har passerat.
