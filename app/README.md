# Closing Tool

Single-File React Web-App zur Kostenrechnung und Leistungsnachweis-Generierung für Projekt-Bundles.

## Setup

### 1. npm Dependencies installieren

```bash
cd app
npm install
```

Falls npm-Cache-Probleme auftreten:
```bash
npm config set cache "/private/tmp/npm-cache"
npm install
```

### 2. Entwicklung starten

```bash
npm run dev
```

Öffnet http://localhost:5173 im Browser.

### 3. Build für Production

```bash
npm run build
```

Erstellt `dist/index.html` — diese Datei in SharePoint speichern und öffnen.

## Architektur

```
app/
├── package.json          # Dependencies
├── vite.config.ts        # Vite-Konfiguration (mit vite-plugin-singlefile)
├── tsconfig.json         # TypeScript-Konfiguration
├── index.html            # HTML-Entry-Point
├── src/
│   ├── main.tsx          # React-Root
│   ├── App.tsx           # Hauptkomponente
│   ├── App.css           # Styling
│   ├── index.css         # Global styles
│   ├── types/            # TypeScript Interfaces (Datenmodell)
│   │   ├── bundle.ts
│   │   ├── project.ts
│   │   ├── employee.ts
│   │   ├── role.ts
│   │   ├── rateCard.ts
│   │   ├── timeEntry.ts
│   │   ├── leistungsnachweis.ts
│   │   └── projectState.ts
│   ├── lib/              # Geschäftslogik (noch zu implementieren)
│   │   ├── smartImport.ts
│   │   ├── classify.ts
│   │   ├── rateCardLookup.ts
│   │   ├── calculation.ts
│   │   ├── pdfExport.ts
│   │   ├── csvExport.ts
│   │   ├── projectFile.ts
│   │   └── storage.ts
│   └── components/       # React-Komponenten (noch zu implementieren)
│       ├── ImportPanel.tsx
│       ├── RateCardEditor.tsx
│       ├── EmployeeRoleMapping.tsx
│       ├── ProjectList.tsx
│       ├── ProjectDetail.tsx
│       ├── BundleUebersicht.tsx
│       └── ProjectFileBar.tsx
└── dist/                 # Build-Output (nach `npm run build`)
    └── index.html        # Single-File-Output zum Deployment
```

## MVP-Roadmap

1. **SMART-Import** (`lib/smartImport.ts`) — Excel-Datei hochladen, Validierung
2. **Klassifizierung** (`lib/classify.ts`) — WBS-Splitting, Projekt-Erkennung
3. **Rate Card Lookup** (`lib/rateCardLookup.ts`) — Rolle → Tagessatz
4. **Kostenrechnung** (`lib/calculation.ts`) — Stunden → Tage → Betrag
5. **Leistungsnachweis** (`lib/pdfExport.ts`) — PDF-Export
6. **UI-Komponenten** — schrittweise aufbauen

## Nächste Schritte

1. ✅ Projektstruktur & Type-Definitionen done
2. ⏳ `smartImport.ts` implementieren (SheetJS-Integration, Excel-Parsing)
3. ⏳ Unit-Tests gegen die echte Excel-Fixture
4. ⏳ Komponenten (Import, Rate Cards, etc.)

## Deployment

Nach dem Build:
1. `dist/index.html` in SharePoint-Folder speichern
2. Von dort herunterladen
3. Lokal doppelklick → Browser öffnet es
4. Excel hochladen (Drag & Drop)
5. Ergebnisse als PDF/CSV exportieren

---

## Implementation Progress ✅

### Core Modules (Done)
- ✅ **smartImport.ts** — SMART-Excel import, validation, dedup
  - Tests included: `smartImport.test.ts`
  - Handles missing/invalid data, duplicate detection
  - Extracts project names from WBS paths

- ✅ **classify.ts** — WBS classification, project auto-detection
  - Classify productive (WBS 2.x) vs non-productive (WBS 1.x)
  - Auto-detect projects from time entries
  - Task type classification

- ✅ **calculation.ts** — Kostenrechnung, aggregation
  - Tests included: `calculation.test.ts`
  - Role-based cost calculation with rate card lookups
  - Chargeable vs non-chargeable line separation
  - Budget tracking and blended rate calculation

### Next Steps (TODO)
- ⏳ **rateCardLookup.ts** — Active rate card resolution
- ⏳ **pdfExport.ts** — PDF generation for Leistungsnachweise
- ⏳ **csvExport.ts** — CSV export for bulk data
- ⏳ **projectFile.ts** — JSON save/load for configurations
- ⏳ **storage.ts** — localStorage wrapper
- ⏳ **React UI Components** — Import, RateCards, Results panels

## Running Tests

```bash
npm run test
```

(requires `npm install` with working npm cache)
