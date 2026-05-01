# Web Frontend (apps/web)

React 18 + TypeScript + Vite with IBM Carbon Design System for UI components.

## Structure

- `App.tsx` — Top-level layout with tab switching (managed / unmanaged / TFE migration)
- `components/WizardCards.tsx` — Multi-step scan setup wizard (5 steps)
- `components/Dashboard.tsx` — RUM metrics, charts, scan history, resource table
- `components/UnmanagedEstimatorTab.tsx` — Cloud resource discovery and classification
- `components/TfeMigrationTab.tsx` — TFE-to-TFC migration estimator
- `components/DeployActions.tsx` — Deployment guidance with copy-to-clipboard
- `components/TerminalPanel.tsx` — Restricted terminal bridge (stub)
- `lib/api.ts` — API client functions that mirror backend endpoints

## Patterns

- **Polling**: Components poll async job status via `setInterval` every 1s, up to 120 iterations. Extract to shared hook when adding more polling consumers.
- **Carbon imports**: `import { Button, TextInput, ... } from "@carbon/react"`
- **Tab layout**: Tabs are Button components with `kind="primary"` (active) or `kind="tertiary"` (inactive)
- **State**: Local `useState` hooks per component. No global state management.

## API Client (`lib/api.ts`)

All backend calls go through typed functions in `api.ts`. When adding new endpoints:
1. Add the client function to `api.ts`
2. Mirror the backend types locally (until shared-types package exists)
3. Use the same error handling pattern: `response.ok` check → throw on failure

## Dev Server

```bash
npm run dev  # Vite dev server on http://localhost:5173, proxied to API at :8080
```
