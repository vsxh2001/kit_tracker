# WA flow demo GIF — capture guide

Target: `docs/screenshots/wa-flow.gif` referenced from `docs/pilot-pitch.md`.
~30 seconds, 6-10 MB, GIF.

## Sequence

1. **Phone screen** (Twilio sandbox conversation in WhatsApp):
   - Tech sends: `move DEMO-KIT-005 to DEMO-Customer-Alpha`
   - Bot replies (~3s): confirmation prompt with kit + entity details
   - Tech sends: `YES`
   - Bot replies (~3s): "Done — kit moved to DEMO-Customer-Alpha"
2. **Web screen** (admin desktop):
   - Open `/kits/<DEMO-KIT-005 id>` — pause 2s on timeline showing latest
     transaction with "via WhatsApp" badge
   - Click `/audit` — filter Source = "WhatsApp" — pause 2s on the filtered
     result showing the same row

## Tools

- **macOS:** `Cmd+Shift+5` for screen recording; convert via:
  ```bash
  ffmpeg -i in.mov -vf "fps=12,scale=720:-1:flags=lanczos" -loop 0 out.gif
  ```
- **Linux:** `peek` or `wf-recorder` + `ffmpeg` for conversion
- **Phone segment:** native iOS/Android screen recorder; splice with the desktop
  segment in iMovie, Kdenlive, or `ffmpeg concat`

## Embed in pitch

Already referenced in `docs/pilot-pitch.md` section 3:

```markdown
![WA flow](docs/screenshots/wa-flow.gif)
```

Place the finished `wa-flow.gif` at `docs/screenshots/wa-flow.gif`.

## Size

Target ≤10 MB to fit in email attachments and GitHub README rendering.
If larger: reduce fps to 8 (`fps=8`) or scale to 600px (`scale=600:-1`).
