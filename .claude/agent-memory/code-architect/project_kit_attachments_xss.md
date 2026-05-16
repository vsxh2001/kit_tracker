---
name: Kit attachments XSS surface
description: kits.attachments file field accepts any MIME type and is served public+same-origin, enabling stored XSS via HTML/SVG uploads (admin-only upload, so insider/compromised-admin threat)
type: project
---

The `kits.attachments` file field (added in pb/pb_migrations/1778497192_add_attachments_to_kits.js) has:
- `mimeTypes: []` — empty allowlist = accept any type, including text/html and image/svg+xml
- `protected: false` — files served by anonymous URL (no signed tokens)
- `maxSize: 5242880` (5MB), `maxSelect: 10`

Files are served at `${pb.baseUrl}/api/files/kits/${kit.id}/${filename}` (see services/kits.ts:142). In production the PB origin and SPA origin are the same (https://kit-tracker.fly.dev). The PB SDK stores its auth token in `localStorage["pocketbase_auth"]` on that origin. An admin uploading `evil.html` containing a script that reads `localStorage["pocketbase_auth"]` and posts it to an external server obtains a full-power admin session token for any user that clicks the link.

**Why:** Upload is admin-only, but the attack vector still matters for: (a) compromised admin accounts, (b) one admin exfiltrating another admin's session, (c) future scope creep that lets technicians upload. The same-origin serving is the load-bearing weakness.

**How to apply:** When reviewing the attachments flow or proposing similar file-upload features, surface this as HIGH. Fixes: (a) restrict mimeTypes to an allowlist (image/pdf/doc only), (b) set `protected: true` so files require a signed token, (c) serve files from a sandbox subdomain (e.g. `files.kit-tracker.fly.dev`), or (d) force `Content-Disposition: attachment` via a hook to prevent inline rendering. Same considerations apply for any future user-uploadable file fields (component photos, request attachments, etc.).
