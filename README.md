# Closing Tool

Eine React-Web-App für den kompletten monatlichen Abrechnungszyklus in Projekten mit externen Mitarbeiter:innen: Zeiterfassung importieren, Rollen und Tagessätze zuordnen, Budgets überwachen und Leistungsnachweise sowie Berichte als PDF ausgeben — als **einzelne HTML-Datei**, ohne Server, ohne Backend, ohne Installation für die Endnutzer:innen.

## Funktionsüberblick

### 📥 Import
Excel-Export der Zeiterfassung hochladen. Der Import validiert die Datei, erkennt bereits verarbeitete Zeilen anhand ihrer Zeit-Id (kein versehentlicher Doppel-Import eines Monats), klassifiziert Zeiten automatisch als produktiv/unproduktiv/PM/Training anhand von WBS-Nummer und Tätigkeit, und legt neue Mitarbeiter:innen sowie Projekte automatisch an.

### 📦 Projekte & Bundles
Mehrere Projekte lassen sich zu einem **Bundle** (z. B. ein Kunde oder Vertrag) zusammenfassen. Projekte können mehrere Alias-Namen tragen, damit unterschiedliche Schreibweisen aus der Zeiterfassung demselben Projekt zugeordnet werden, und einzeln als nicht fakturierbar markiert werden.

### 💰 Rate Cards
Tagessätze je Rolle, Erfahrungslevel (Junior/Intermediate/Senior/Expert) und Standort verwalten — inklusive Excel-Import über eine herunterladbare Vorlage. Die Zuordnung Standort → Rate Card unterscheidet z. B. Deutschland von Nearshore-Standorten.

### 🎯 Projekt-Rollen-Zuordnung
Mitarbeiter:innen werden Rollen aus den Rate Cards zugeordnet. Zuordnungen ohne passende Rate Card oder ganz ohne Rolle werden im Reiter direkt als Zähler sichtbar gemacht, statt still mit Tagessatz 0 durchzurechnen.

### 💶 Budget-Tracking
Purchase Orders (POs) je Projekt anlegen, verlängern und historisch nachvollziehen. Der Budgetverbrauch lässt sich wahlweise manuell nachtragen oder automatisch aus den erstellten Leistungsnachweisen fortschreiben, inklusive Verbrauchskurve im Zeitverlauf und PDF-Budgetbericht über alle Projekte.

### 📊 Abrechnung & Leistungsnachweis
Aus den importierten Zeiten wird je Projekt und Monat automatisch die Abrechnung nach Rolle berechnet (Stunden → Tage → Betrag), inklusive nicht berechenbarer Zeiten. Eine abgeschlossene Abrechnung wird als unveränderliche Fassung eingefroren; nachträgliche Korrekturen erzeugen eine neue Fassung mit automatischem Diff gegen die vorherige. Export als PDF-Leistungsnachweis pro Projekt oder gebündelt als ZIP für ein ganzes Bundle.

### 📈 Dashboard
Umsatz nach Bundle und nach Rolle, Entwicklung der Blended Rate über die Zeit, nicht fakturierbare Zeiten und offene (Zeiterfassung ohne Rollen-Zuordnung) Stunden auf einen Blick — mit farbenblindsicherer Farbgebung.

### 💾 Daten & Ablage
Der gesamte Stand (Abrechnungen, Mitarbeiter, Rate Cards, Bundles) lässt sich als JSON-Datei exportieren und wieder importieren. Ein Prüfpfad protokolliert Importe, Änderungen an Rollen/Rate Cards, Freigaben und Exporte je Arbeitsplatz. Solange der Browser es unterstützt, speichert die App direkt in eine lokale Datei (File System Access API) inklusive Autosave und Warnung, falls die Datei zwischenzeitlich von anderer Stelle überschrieben wurde.

## Warum Single-File?

`npm run build` erzeugt eine einzelne `dist/*.html`, die komplett eigenständig läuft — z. B. aus einem geteilten Ordner heraus per Doppelklick, ohne Webserver, Login oder Installation. Alle Daten bleiben lokal beim jeweiligen Arbeitsplatz (Browser-Storage bzw. die gewählte lokale Datei).

## Tech-Stack

- **React** + **TypeScript**, gebaut mit **Vite** (`vite-plugin-singlefile` für den Single-File-Build)
- **xlsx** (SheetJS) für den Excel-Import/-Export der Rate-Card-Vorlage
- **jsPDF** + **jspdf-autotable** für alle PDF-Berichte
- **jszip** für den Sammel-Export mehrerer Leistungsnachweise
- **IndexedDB** für Autosave/Wiederherstellung im Browser
- **Vitest** für Unit-Tests der Geschäftslogik (Import, Klassifizierung, Aggregation, Rundung)

## Setup

Der Code liegt in [`app/`](./app):

```bash
cd app
npm install
npm run dev      # Entwicklung, http://localhost:5173
npm test         # Unit-Tests
npm run build    # Erzeugt dist/*.html
```

Weitere Details zur Architektur stehen in [`app/README.md`](./app/README.md).

## Hinweis

Dies ist eine bereinigte, öffentliche Version eines intern entwickelten Tools: Firmen-, Kunden- und Personennamen sowie das Corporate Design des Originals wurden durch generische Platzhalter ersetzt.
