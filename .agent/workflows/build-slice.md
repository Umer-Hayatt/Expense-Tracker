# Workflow: build-slice
Trigger: `/build-slice` (next unchecked slice) or `/build-slice <number>`

1. Read `AGENTS.md` and `PLAN.md`; pick the slice.
2. Plan in a few lines: DB change, endpoints, UI changes, edge cases. Wait for my OK.
3. Implement the whole slice end to end (DB → API → UI). No work outside the slice.
4. Add API tests for the slice; run `npm test` and fix failures.
5. Run `npm start`, open the app in the browser, and walk through the slice's demo; take a screenshot.
6. Tick the slice in PLAN.md and report: what works, how to demo it, anything left for later.
