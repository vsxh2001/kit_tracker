# Pilot Screenshots

Three screenshots referenced from the root `README.md`. Capture manually before sending the pitch.

## wa-move.png

WhatsApp conversation: tech sends `move DEMO-KIT-005 to DEMO-Customer-Alpha`, bot replies with the confirmation prompt, tech replies `YES`, bot replies done.

Suggested size: 9:16 phone screenshot, ~600px wide PNG.

## web-timeline.png

Web `/kits/<id>` view showing a kit's timeline with the latest transaction including the "via WhatsApp +972…" origin badge.

Suggested size: 16:10 desktop screenshot, ~1200px wide PNG. Crop to the timeline card + page header.

## audit-filter.png

Web `/audit` view with the Source dropdown set to "WhatsApp" and at least one wa-bot row visible.

Suggested size: same as web-timeline.png. Highlight the Source column with a subtle red box (optional).

## How to capture

Local dev: run seed (`scripts/seed_demo_data.mjs`), trigger a WA move via `scripts/wa_e2e_test.sh`, then take the three screenshots from the running app.

Pilot deploy: deploy per `docs/pilot-runbook.md`, run seed against the deployed instance, capture from there.
