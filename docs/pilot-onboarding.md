# Kit Tracker — Onboarding (Field Tech)

## What this does

You move kits and check inventory by sending slash commands to the Kit Tracker Telegram bot.
The system logs every move with a full audit trail. Your admin sees it on the web.

---

## 1. Get access

Your admin creates your user account and sets your role. You will receive an email with login
instructions (or your admin sets your password manually via the admin panel).

You cannot use the bot until your account has an approved role. If you send a command and receive:

> Your account is awaiting approval — an admin needs to set your role.

Contact your admin and confirm they have set your role to `technician` or `user`.

---

## 2. Link your Telegram account

1. Open the web app and log in.
2. Click your name or avatar in the sidebar → **Profile**.
3. Click **Link Telegram**.
4. A one-time code is minted (valid for 10 minutes). Click the **deep link** to open the bot in
   Telegram, or copy the code and send `/start <code>` directly in the bot chat.
5. The bot replies: "Linked!"

Your Telegram account is now bound to your Kit Tracker user. The link persists — you do not
need to repeat this step unless you switch Telegram accounts.

---

## 3. Move a kit

Send this command to the bot:

```
/move <KIT-SERIAL> <ENTITY-NAME>
```

Example:

```
/move ACME-CAM-007 ACME-LAB
```

The bot executes the move immediately and replies with a confirmation. No `YES` prompt — the
command is the confirmation. If you move to the wrong entity, log a corrective move or contact
your admin.

> `/move` requires `admin` or `technician` role.

---

## 4. Check a kit

Get current holder and tracked contents:

```
/kit ACME-CAM-007
```

Full contents (all components):

```
/kit ACME-CAM-007 all
```

---

## 5. List kits

```
/kits
```

Returns up to 20 active kits with their current holders.

---

## 6. Search

```
/find lab
```

Searches kit serials and entity names for the given text.

---

## 7. Open a request

Request that a kit be moved to your site (routed to admin/technician for approval):

```
/request <KIT-SERIAL> <ENTITY-NAME> [YYYY-MM-DD]
```

Example (with optional target date):

```
/request ACME-CAM-007 ACME-LAB 2026-06-15
```

> `/request` requires `user` role or higher (viewer excluded).

---

## 8. Check open requests

```
/requests
```

Lists all open requests visible to your account.

---

## 9. Command reference

| Command | What it does | Role required |
|---|---|---|
| `/help` | Show available commands | any approved |
| `/me` | Your account info + role | any approved |
| `/kits` | List active kits with holders (up to 20) | any approved |
| `/kit <serial>` | Kit details + tracked products | any approved |
| `/kit <serial> all` | Full kit contents | any approved |
| `/find <text>` | Search kits and entities | any approved |
| `/requests` | List open requests | any approved |
| `/request <kit> <entity> [YYYY-MM-DD]` | Open a kit request | user+ |
| `/move <kit> <entity>` | Move kit to entity (immediate) | admin/technician |
| `/approve <handle> [notes]` | Approve a request | admin/technician |
| `/reject <handle> [notes]` | Reject a request | admin/technician |

---

## 10. FAQ

**I sent `/move` and got "not authorized".**
Your role is `viewer` or `user`. Only `admin` and `technician` roles can move kits directly.
Use `/request` to submit a move request for admin approval.

**The bot says "Your Telegram isn't linked".**
Complete the linking step: web app → Profile → Link Telegram → `/start <code>`.

**I moved to the wrong entity.**
Log a corrective move in the opposite direction: `/move <serial> <correct-entity>`. Transactions
are append-only — no delete. Contact your admin if you need the record annotated.

**The bot says "Kit not found".**
Check the exact serial with `/kits` or `/find <text>`. Serials are case-sensitive.

**The bot says "ambiguous — which X?"**
Two kits or entities have similar names. Use the full exact serial or entity name.

**I can't find the bot.**
Ask your admin for the bot username (starts with `@`). Search for it in Telegram directly.

---

## 11. Privacy

Your Telegram chat ID is stored on your user record and used only to route bot messages to your
account. Message content is processed server-side to execute commands — no third-party AI API
is called on the command path. Your data is not used for marketing.
