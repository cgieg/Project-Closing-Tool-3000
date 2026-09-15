# Implementation Checklist

## ✅ Phase 1: Core Business Logic (100% DONE)

### Data Parsing & Validation
- ✅ `smartImport.ts` — SMART-Export Excel parsing with SheetJS
  - ✅ File upload & sheet detection
  - ✅ Column validation (9 required fields)
  - ✅ Row-by-row parsing with error/warning collection
  - ✅ Duplicate detection via TimeId (GUID)
  - ✅ WBS-based classification (2.x = productive, 1.x = non-productive)
  - ✅ Project auto-detection from WBS Parents path
  - ✅ Unit tests (8 test cases)

### Classification & Aggregation
- ✅ `classify.ts` — WBS and project classification
  - ✅ Productivity classification (WBS patterns)
  - ✅ Task type classification (PM/Training/Overhead)
  - ✅ Project auto-discovery
  - ✅ Project validation

### Cost Calculation
- ✅ `calculation.ts` — Kostenrechnung engine
  - ✅ Role-based aggregation (NOT person-based) ⭐
  - ✅ Rate card lookup with validation
  - ✅ Hours → Days → Amount calculation
  - ✅ Chargeable vs non-chargeable separation
  - ✅ Budget tracking & blended rate
  - ✅ Bundle overview aggregation
  - ✅ Unit tests (7 test cases)

### Export Formats
- ✅ `pdfExport.ts` — PDF generation with jsPDF
  - ✅ Single project Leistungsnachweis as PDF
  - ✅ Multi-project bundle PDF (cover + detail pages)
  - ✅ Formatted tables with corporate design
  - ✅ Budget tracking in PDF

- ✅ `csvExport.ts` — CSV export for Excel
  - ✅ Project-level CSV
  - ✅ Bundle overview CSV
  - ✅ Proper escaping & formatting
  - ✅ Browser download handler

### Persistence
- ✅ `projectFile.ts` — JSON project state save/load
  - ✅ Export ProjectState as JSON
  - ✅ Import ProjectState from JSON
  - ✅ Schema validation
  - ✅ Version management

- ✅ `storage.ts` — localStorage integration
  - ✅ Auto-save with debounce
  - ✅ Load/save/clear functions
  - ✅ Availability check

---

## ⏳ Phase 2: React UI Components (0% DONE)

### Import & Setup
- ⏳ `components/ImportPanel.tsx`
  - File upload (Excel)
  - Progress feedback
  - Validation errors/warnings display

### Configuration UI
- ⏳ `components/RateCardEditor.tsx`
  - Add/edit rate cards
  - Organisation + Level grid view
  - Import/export rate cards

- ⏳ `components/EmployeeRoleMapping.tsx`
  - Map employees to roles
  - Bulk import from SMART
  - Role assignment

### Results & Export
- ⏳ `components/ProjectList.tsx`
  - List all detected projects
  - Summary per project

- ⏳ `components/ProjectDetail.tsx`
  - Full Leistungsnachweis preview
  - PDF/CSV export buttons

- ⏳ `components/BundleUebersicht.tsx`
  - Bundle summary overview
  - Blended rate, totals
  - Multi-project comparison

- ⏳ `components/ProjectFileBar.tsx`
  - Save/load project JSON
  - Auto-save indicator

---

## 📊 Testing Status

- ✅ **smartImport.test.ts** — 8 tests (Excel parsing, validation)
- ✅ **calculation.test.ts** — 7 tests (Cost calculation, rate cards)
- ⏳ **Integration tests** — E2E flow (Excel → PDF/CSV)
- ⏳ **UI component tests** — React component rendering

---

## 🚀 Next Steps (in order)

1. **UI Phase 1: Import + Results Display**
   - Build ImportPanel component
   - Wire up smartImport function
   - Display results in ProjectList + ProjectDetail

2. **UI Phase 2: Configuration**
   - Build RateCardEditor
   - Build EmployeeRoleMapping
   - Add ProjectFileBar for save/load

3. **Integration Testing**
   - E2E test flow (Excel → Leistungsnachweis PDF)
   - Test against real fixture Excel
   - Test PDF/CSV quality

4. **Styling & Polish**
   - Responsive design
   - Error state styling
   - Loading indicators
   - Corporate design throughout

5. **MVP Release**
   - Build production HTML
   - Test in SharePoint
   - Document usage

---

## 📦 Dependencies Already Installed

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "@vitejs/plugin-react": "^4.2.0",
    "vite-plugin-singlefile": "^0.13.0",
    "xlsx": "^0.18.5",
    "jspdf": "^2.5.1",
    "jspdf-autotable": "^3.5.31"
  }
}
```

---

## 📋 Git Commands (if needed later)

```bash
npm run build     # Build single-file HTML
npm run dev       # Dev server
npm run test      # Unit tests with Vitest
```

**Note**: Currently NOT using git — all work in `/Closing Tool/app/` folder.
