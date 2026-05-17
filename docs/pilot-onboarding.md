# WhatsApp Kit Tracker — Onboarding (Field Tech)

## What this does

You move kits by sending a WhatsApp message. The system logs every move. Your admin sees it on the web.

---

## 1. Join the sandbox

The pilot runs on the Twilio sandbox number: **+1 415 523 8886**

Open WhatsApp and send this message to that number:

```
join <code>
```

Your admin will share the exact code with you. After about 10 seconds you will receive:

> Twilio Sandbox: You are all set and can start sending messages.

**Important:** The sandbox connection expires after 3 days of inactivity. If the bot goes silent, send the join code again to reconnect.

---

## 2. Link your phone

Tell your admin your WhatsApp number in full international format (e.g. +972-50-123-4567). They must link it to your user account before the bot will accept your messages.

Until that link is set up, any message you send will receive:

> Your account isn't approved for WhatsApp access yet.

Once the admin confirms your number is linked, you are ready to go.

---

## 3. Move a kit

Send this message to log a kit transfer:

```
move <KIT-SERIAL> to <ENTITY-NAME>
```

Example:

```
move ACME-CAM-007 to ACME-LAB
```

The bot replies with a confirmation summary showing what will happen. Reply `YES` within 30 seconds to confirm the move. The bot will respond:

> Done — moved ACME-CAM-007 to ACME-LAB.

If you reply anything other than `YES`, or wait longer than 30 seconds, the move is cancelled. Nothing is logged. Re-send the original message to try again.

---

## 4. Return a kit to the warehouse

Send:

```
return <KIT-SERIAL>
```

Example:

```
return ACME-CAM-007
```

The bot moves the kit back to the default warehouse (configured by your admin). The same YES confirm flow applies.

Other phrasings that work the same way:

```
send back ACME-CAM-007
ACME-CAM-007 is back
```

---

## 5. Ask a question

Read-only queries do not require confirmation. The bot replies immediately.

Get current location: `where is ACME-CAM-007?`

List all open requests: `what open requests are there?`

Get the last 5 moves for a kit: `kit ACME-CAM-007 history`

---

## 6. Undo a move

After a move or return is confirmed, your admin has a 60-second window to undo it via the web app's chat sidebar. WhatsApp does not yet support `UNDO` replies directly.

If you need to undo a move, contact your admin immediately with the kit serial and destination. They can reverse it within 60 seconds of the original move.

---

## 7. Cheat-sheet

| You send | Bot does |
|---|---|
| `move KIT-X to LAB-Y` | Confirm prompt, then moves on YES |
| `return KIT-X` | Confirm prompt, then returns to warehouse on YES |
| `send back KIT-X` | Same as `return KIT-X` |
| `KIT-X is back` | Same as `return KIT-X` |
| `where is KIT-X?` | Replies with current location (no confirm needed) |
| `what open requests are there?` | Replies with list of pending requests |
| `kit KIT-X history` | Replies with last 5 moves for the kit |
| `YES` (within 30s of a confirm prompt) | Executes the pending operation |
| Any other reply after a confirm prompt | Cancels the pending operation |

---

## 8. FAQ

**I sent a move and got no confirm prompt.**
The bot only confirms write operations. If your message did not match the pattern, the system may have interpreted it as a question. Re-try using the exact format: `move <serial> to <entity>`.

**I missed the 30-second window.**
The pending operation was automatically cancelled. Re-send the original message to start again.

**The bot says "ambiguous — which X?"**
You have two kits or entities with similar names in the system. Use the full kit serial or the exact entity name as configured in the system.

**The bot says I am not authorized.**
Your phone number is not linked to a user account with `admin` or `technician` role. Contact your admin and give them your full WhatsApp number in international format.

**The bot is silent.**
The sandbox connection may have expired (it resets after 3 days without activity). Send the join code to +1 415 523 8886 again. If the bot is still silent after that, contact your admin.

**I sent the wrong kit or destination.**
Contact your admin immediately. They have a 60-second undo window in the web app. After 60 seconds, a corrective move will need to be logged manually.

---

## 9. Privacy

Your WhatsApp phone number is stored on your user record in the system, and is used only to match your incoming messages to your account. Your message content is sent to the Anthropic Claude API for intent parsing — please read the privacy notice provided by your admin. Your data is not used for marketing.
