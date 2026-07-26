# Desktop runtime check — 2026-07-08

Scope: verify that the character-source import entry and picker are reachable in the Electron renderer after the review fixes.

## Observed results

- The AIRI Card settings route rendered the localized “从角色设定文档创建角色卡” entry.
- Opening the entry rendered the source-file picker, configured Provider selector, model selector, per-upload privacy confirmation, cancel action, and disabled start action.
- The configured DeepSeek Provider loaded its available models after the asynchronous model-list request.
- The dialog emitted no Reka UI title/description accessibility warning after the fix.
- No character card was created or activated by opening, reloading, or cancelling the picker.

Evidence:

- `screenshots/direct-settings-route.png`
- `screenshots/import-dialog.png`
- `screenshots/settings-after-a11y-fix.png`

## Not claimed by this check

The native Windows file dialog and a billable Provider extraction were not submitted during this run. Their deterministic boundaries are covered by the Electron file-adapter and extraction-store tests.

## Automated browser follow-up

The Stage Pages Playwright/Vitest browser suite now covers source selection, pre-upload redaction disclosure, multi-character pause and selection, cancellation, stable failure rendering, escaped evidence, conflict resolution, field/world-book edits, final confirmation, and the invariant that preview paths do not initialize or modify the Card store.

Environment preparation and command:

```powershell
corepack pnpm exec playwright install chromium
corepack pnpm --filter @proj-airi/stage-pages test:browser
```

The billable integration suite remains environment-guarded and is not part of the offline default run. Set `AIRI_CHARACTER_EXTRACTOR_BASE_URL`, `AIRI_CHARACTER_EXTRACTOR_MODEL`, and `AIRI_CHARACTER_EXTRACTOR_API_KEY` only when intentionally testing a configured target Provider.
