# LGU Raffle Draw System

Fair, publicly verifiable raffle draw for LGU events. React (Vite) + Express + MySQL/MariaDB (WAMPServer).

```
database/schema.sql          MySQL schema + sample data
backend/                     Express API (all randomness and rules live here)
  src/fairness.js            The complete draw / verification algorithm
  src/routes/draw.js         POST /api/draw (transaction + row locks, 1–10 names per call)
  src/routes/admin.js        Archive & Reset
  scripts/verify-draw.js     Standalone verifier anyone can run
frontend/                    React app (Live Draw, Winners, Audit / Verify, Admin)
  src/components/Sidebar.jsx Collapsible animated sidebar (Live Draw · Winners · Audit / Verify · Admin)
  src/assets/LGU_LOGO.png    Municipal seal (sidebar header + Live Draw hero via Brand.jsx)
```

## Setup

### 1. Database (WAMP)
- Open phpMyAdmin and import `database/schema.sql`, **or** from a terminal (existing databases: also run
  `database/migrations/002_provably_fair.sql` and `003_beacon.sql`):
  ```
  cd backend
  node -e "const m=require('mysql2/promise'),f=require('fs');m.createConnection({host:'127.0.0.1',port:3307,user:'root',password:'',multipleStatements:true}).then(async c=>{await c.query(f.readFileSync('../database/schema.sql','utf8'));await c.end();console.log('ok')})"
  ```
- WAMP runs two servers: MySQL 9 on **3306** and MariaDB on **3307**. Either works; `DB_PORT`/`DB_NAME` in `.env` decide which one the app uses — make sure phpMyAdmin is pointed at the **same** server, or the tables will look empty.
- Set a root password and restrict phpMyAdmin before the event.

Tables:
- `participants` — `id, full_name, entry_code, is_winner, created_at`
- `winners` — the live draw log (one row per drawn name, with seed, pool snapshot and hashes)
- `draw_sessions` + `winners_archive` — previous runs, filled by the Admin reset; kept until an admin clears them
- `admin_account` — single row: display name + bcrypt password hash (seeded from `ADMIN_PASSWORD` on first login)

### 2. Backend
```
cd backend
npm install
copy .env.example .env      # edit ADMIN_PASSWORD, JWT_SECRET, DRAW_KEY, DB_*
npm start                   # http://localhost:4000
```
`.env` keys:
| Key | Purpose |
|---|---|
| `ADMIN_PASSWORD` | **Initial** admin password — used only to seed the `admin_account` table on first login. After that, change it from the Admin page (Profile → Change password); the .env value is no longer consulted. |
| `DRAW_KEY` | Must be typed into the Live Draw page before the Draw button works |
| `JWT_SECRET` | Signs the admin session |
| `BEACON` | `on` (default) mixes the drand public randomness beacon into every draw; `off` for venues without internet |

### 3. Frontend
```
cd frontend
npm install
npm run dev                 # http://localhost:5173 (/api is proxied to :4000)
```
For production: `npm run build` and serve `frontend/dist` (e.g. from WAMP's Apache) with a reverse proxy of `/api` to Node.

## Sidebar / pages
| Tab | Route | Who | What |
|---|---|---|---|
| Live Draw | `/` | Emcee / projector | "Number of winners" (1–10), Start Draw, shuffle animation, winners revealed one by one; Fairness side panel with server commitment, chain head and audit trail |
| Winners | `/winners` | Public | All winners ordered by draw_order, auto-refresh every 3 s |
| Audit / Verify | `/audit` | Public | Draw log: timestamp, seed, pool snapshot before each draw, server check; `/audit/:id` re-verifies in the browser; archived sessions at the bottom |
| Admin | `/admin` | Admin (login) | Add / import names (CSV, Excel, Word, PDF) / CSV export / remove (locked once the first draw happens) · **Archive & Reset** |

## API
```
GET  /api/participants              non-winners (?all=1 for everyone)
GET  /api/participants/export.csv   public CSV of the full pool
POST /api/draw/commit               header x-draw-key — publishes the server commitment (hash) for the next draw
POST /api/draw                      header x-draw-key, body {count: 1..10, commit_id?, client_seed?} — draws N names in ONE transaction
GET  /api/draw/status               total / remaining / draws_done / archived_sessions / max_count / chain_head / beacon_enabled
GET  /api/winners                   ordered by draw_order
GET  /api/winners/audit             full draw log + verification of every draw
GET  /api/winners/audit/:drawId     one record + verification   (alias: /api/audit-log/:drawId)
GET  /api/winners/archive           archived sessions with their draw logs + verification
GET  /api/winners/archive/:id       one archived record + verification
POST /api/auth/login                admin JWT
GET  /api/auth/me                   admin profile (display name, last password change)
PATCH /api/auth/me                  admin — { display_name }
POST /api/auth/change-password      admin — { current_password, new_password, confirm_password }; old sessions are invalidated
POST /api/participants              admin — { full_name, entry_code? } (code generated when omitted)
POST /api/participants/import       admin — multipart file (.csv .txt .xlsx .xls .docx .doc .pdf), one name per row
POST /api/participants/bulk         admin — { names: [] }
DELETE /api/participants/:id        admin (before the draw starts only)
POST /api/admin/reset               admin, body {note?} — archives the session, clears winners, resets is_winner
DELETE /api/admin/archive           admin — permanently deletes ALL archived sessions
DELETE /api/admin/archive/:id       admin — permanently deletes one archived session
```

## Importing participants
Upload a CSV, TXT, Excel (.xlsx/.xls), Word (.docx/.doc) or PDF from the Admin page. No header or layout is
required — the parser (`backend/src/importParser.js`) detects the names itself:
- **Tables (CSV/Excel):** a header cell such as *Name*, *Full Name*, *Participant* or *full_name* selects the
  column; without one, every column is scored and the one that looks most like people's names is used. Every
  sheet of a workbook is scanned and the sheet with the most names wins.
- **Text (Word/PDF/TXT):** every line is a candidate. Numbering (`1.`, `1)`, `(1)`), bullets, quotes and extra
  spaces are stripped; titles ("Raffle Participants"), labels ("Prepared by:"), page markers, emails, phone
  numbers and codes are ignored. "Dela Cruz, Juan" and ALL-CAPS names are kept as written.
- Entry codes are never required — the server generates a unique `GL-XXXXXX` code for every participant.
- If nothing name-like is found the upload is rejected with **No participant names found** plus a hint.

## How fairness is proven (provably fair)
The weakness of a plain "server picks a random seed" design is that whoever runs the server could quietly
generate seeds until one lands on a chosen person — and the audit would still say VALID. This system closes that
gap with **commit–reveal** plus a **hash chain** (`backend/src/fairness.js`):

1. **Commit (before the button is pressed).** The server generates a secret `server_seed` and the Live Draw
   screen shows only `server_seed_hash = SHA-256(server_seed)`. Once shown, the server can no longer change it.
2. **Client seed (when the button is pressed).** The browser sends `client_seed = "#<16 random browser bytes>"`
   generated by the browser's own CSPRNG. The server did not know this value when it committed.
3. **Public beacon (when the button is pressed).** The server waits for the **first [drand](https://drand.love)
   round published *after* the request arrived** (a new round every 3 s, produced jointly by Cloudflare, EPFL,
   Kudelski and others) and mixes its randomness into the seed. Nobody in the room — not even someone who runs
   both the server and the laptop — can know that value when they press the button, and anyone can fetch the
   same round from drand afterwards to confirm it. If there is no internet the draw still runs and the record is
   marked "local randomness only" (`BEACON=off` in `.env` disables it deliberately).
4. **Per pick:** `draw_seed = SHA-256(server_seed | client_seed | prev_hash | pick_index | beacon_round:beacon_randomness)`, then
   `random_index = SHA-256(draw_seed) mod pool_size` over the locked pool snapshot. `prev_hash` is the previous
   draw's `verification_hash` (64 zeros for the first), so every draw is chained to the one before it.
5. **Reveal.** The record stores `server_seed`, `server_seed_hash`, `client_seed`, `prev_hash`, `pick_index`,
   `beacon_round`, `beacon_randomness`, `draw_seed`, the pool snapshot and all hashes.

Why it is fair: the server cannot steer the result (its seed was fixed before it saw the client seed); the
browser/operator cannot steer it either (they never know the server seed); an insider who controls **both** still
cannot, because the beacon value did not exist yet when the button was pressed; and nobody can quietly re-roll or
delete a past draw without breaking the chain for every later draw. Anyone can recompute every step:
- in the browser (`/audit/:id` — Web Crypto, no trust in the server), including the chain link and a direct
  check of the beacon round against drand.sh,
- or offline: `node backend/scripts/verify-draw.js --url http://<server>/api/winners/audit/1`
  (archived records too: `/api/winners/archive/1`).

The Winners page shows the current **chain head**; anyone can note it during the event — any later alteration of
past results changes it. Draws recorded before this scheme (no `server_seed`) still verify with the original
single-seed checks and are labelled "legacy".

Other protections:
- One person = one ticket: imports skip duplicate names (case/space-insensitive) and report them; manual add
  refuses a duplicate unless `allow_duplicate` is set.
- Login and draw endpoints are rate-limited (10 login attempts / 15 min; 30 draw requests / min, per IP).
- A winner is set `is_winner = TRUE` and leaves the pool; a double win is impossible
  (`UPDATE ... WHERE is_winner = FALSE` + UNIQUE constraints).
- `SELECT ... FOR UPDATE` inside a transaction + an in-process lock → no race condition even with simultaneous clicks.
- The result comes from the backend **before** the frontend animates; the animation is display only.
- Once one draw exists, the participant list is locked (no add/remove/import) — no manual override during or after the event.
- `DRAW_KEY` prevents anyone on the network from triggering a draw or a commitment.

### Drawing several winners at once
`POST /api/draw` with `{ "count": 5 }` picks 5 names inside one transaction. It is **not** one random pick of 5:
each name is its own draw — its own pool snapshot (the pool shrinks by one after every pick), its own seed,
its own `draw_order` and its own audit row. That keeps every pick individually verifiable and makes a repeat
impossible within the batch or against earlier draws. The count is validated (whole number 1–10, and not more
than the remaining pool) before anything is written. The frontend receives all winners at once and reveals
them one by one.

### Reset (Admin)
The Admin page's **Archive & Reset** button (type `RESET` to confirm, optional session note) copies every row of
`winners` into `winners_archive` under a new `draw_sessions` row (with the winner's name/code denormalized),
then empties `winners` and sets every `is_winner` back to FALSE so the raffle can run again from a full pool.
Archived sessions appear on the Audit / Verify page and are re-verified the same way. The only permanent deletion in
the system is clearing the archive: Admin page → **Clear archived sessions** (type CLEAR), or per-session **Delete**
buttons on the Audit / Verify page while logged in as admin (two clicks to confirm).


## Pre-event checklist
- [ ] Change the admin password from the Admin page (Profile card); set `DRAW_KEY` and `JWT_SECRET` in `.env`
- [ ] Set a MySQL root password; restrict phpMyAdmin
- [ ] Import the final list (file with a `full_name` header, one name per line); download and print `participants.csv` to display at the venue
- [ ] If a test run was done, use **Archive & Reset** so `draws_done` is 0 at `/api/draw/status`
- [ ] Project `/` on the main screen; show `/winners` on a second screen or the audience's phones
