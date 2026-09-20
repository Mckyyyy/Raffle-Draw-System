# Prompt: Fair at Hindi Madayang Raffle System (React + Express + MySQL/WAMP)

Gamitin mo ito bilang buong prompt/spec kapag nagpapagawa ka ng system (kay Claude, ChatGPT, o sa developer mo). I-paste mo lang ito nang buo.

---

## PROMPT

Gumawa ka ng isang **Raffle Draw System** para sa isang LGU (Local Government Unit) event. Simple lang ang mekanismo: may listahan ng mga pangalan (participants), at ang system ay random na magdo-draw ng isang pangalan bawat pindot. Ang pinakaimportanteng requirement ay dapat **100% fair at hindi madaya ang pag-draw ng pangalan** — hindi dapat paulit-ulit lumabas ang parehong pangalan sa buong event, at dapat may paraan para ma-verify ng publiko na hindi ito niloko.

### Tech Stack
- **Frontend:** React (Vite o Create React App)
- **Backend:** Node.js + Express.js
- **Database:** MySQL sa WAMPServer (phpMyAdmin access)
- **Random draw logic:** dapat nasa **backend / database lang**, hindi sa frontend, para hindi ma-manipulate.

---

### 1. Database Design (MySQL)

Gumawa ng mga table na ganito:

**`participants`**
- `id` (INT, AUTO_INCREMENT, PRIMARY KEY)
- `full_name` (VARCHAR)
- `entry_code` (VARCHAR, UNIQUE) — hal. raffle stub number o QR code
- `barangay` o `department` (VARCHAR, optional)
- `is_winner` (BOOLEAN, DEFAULT FALSE)
- `created_at` (TIMESTAMP)

**`winners`** (ito na rin ang draw log)
- `id` (INT, AUTO_INCREMENT, PRIMARY KEY)
- `participant_id` (FK to participants)
- `draw_order` (INT) — ika-ilang draw ito sa buong event (1st, 2nd, 3rd...)
- `drawn_at` (TIMESTAMP)
- `draw_seed` (VARCHAR) — para sa audit trail (paliwanag sa ibaba)

> Note: Wala nang `prizes` table. Isang listahan lang ng pangalan, at ang bawat pindot ng "Draw" ay pumipili ng **isang natitirang pangalan** mula sa mga hindi pa nanalo.

### 2. Core Anti-Cheat / Fairness Rules

Isama sa backend logic ang mga sumusunod:

1. **Exclude na winners sa query.** Bago mag-draw, ang SQL query ay dapat:
   ```sql
   SELECT * FROM participants WHERE is_winner = FALSE;
   ```
   Kung gusto ninyong pwedeng manalo ulit ang isang tao pero sa ibang prize category lang, gumawa ng separate `is_winner_per_category` logic sa halip na isang global flag.

2. **Random selection sa server side gamit ang cryptographically secure random function**, hindi yung basic `Math.random()` ng JavaScript dahil predictable/manipulable ito. Gamitin ang Node's built-in `crypto` module:
   ```js
   const crypto = require('crypto');
   function secureRandomIndex(max) {
     return crypto.randomInt(0, max);
   }
   ```

3. **Isang beses lang tatawagin ang draw endpoint per click**, at dapat naka-lock (disable button / debounce) ang frontend habang nagpo-process para walang double-submit.

4. **Transaction-based na pag-update.** Gamitin ang MySQL transaction (`START TRANSACTION` ... `COMMIT`) kapag nagma-mark ng winner, para walang race condition kung sabay-sabay may nagpindot.

5. **Audit trail / Draw Log.** Bawat draw, i-log ang:
   - Timestamp
   - Random seed/value na ginamit
   - Listahan ng mga pangalan na kasama sa pool bago mag-draw (snapshot)
   
   Ito ang magpapatunay sa publiko na walang "pinili" — makikita sa log kung sino talaga ang laman ng pool bago pumili ang sistema.

6. **Public/Live Draw Display.** Gawan ng UI na nagpapakita ng animation ng pag-shuffle ng mga pangalan bago mag-stop sa winner (parang slot machine), at dapat **live** itong ipapakita sa event mismo — hindi pre-recorded — para makita ng mga tao mismo na real-time ang proseso.

7. **Optional pero recommended: Export ng buong participant list bago ang event** (CSV/Excel) at ipa-publish o ipakita sa entrance ng venue, para malaman ng lahat kung sino-sino talaga ang nasa pool — konting extra transparency layer.

8. **No manual override sa production/live mode.** Kung kailangan ng admin override (hal. may disqualified entry), dapat may hiwalay na "Remove Participant" action **bago** magsimula ang draw, hindi habang or pagkatapos ng draw.

### 3. Backend (Express.js) — Suggested Endpoints

```
GET   /api/participants          -> list ng lahat, non-winners lang by default
POST  /api/draw                  -> nagra-random draw gamit ang crypto module,
                                     nagma-mark ng winner, nagre-record ng audit log
GET   /api/winners                -> listahan ng lahat ng nanalo (public view, ayon sa draw_order)
GET   /api/audit-log/:drawId     -> para sa transparency/verification
```

Sample logic ng `/api/draw`:
```js
app.post('/api/draw', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [pool_of_participants] = await conn.query(
      'SELECT id, full_name FROM participants WHERE is_winner = FALSE'
    );

    if (pool_of_participants.length === 0) {
      return res.status(400).json({ error: 'Walang natitirang participant.' });
    }

    const randomIndex = crypto.randomInt(0, pool_of_participants.length);
    const winner = pool_of_participants[randomIndex];

    const [[{ nextOrder }]] = await conn.query(
      'SELECT COUNT(*) + 1 AS nextOrder FROM winners'
    );

    await conn.query('UPDATE participants SET is_winner = TRUE WHERE id = ?', [winner.id]);
    await conn.query(
      'INSERT INTO winners (participant_id, draw_order, drawn_at, draw_seed) VALUES (?, ?, NOW(), ?)',
      [winner.id, nextOrder, randomIndex.toString()]
    );

    await conn.commit();
    res.json({ winner });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Draw failed', details: err.message });
  } finally {
    conn.release();
  }
});
```

### 4. Frontend (React) — Suggested Features

- Page na nagpapakita ng "Live Draw" na may:
  - Button na "Simulan ang Draw" (isang beses lang pwede pindutin, magdi-disable habang nagpoproseso)
  - Shuffling animation ng mga pangalan (2-4 seconds) bago ipakita ang winner — pwede mo itong gawin sa CSS animation o library, basta ang **actual result ay galing na sa backend bago pa man mag-animate**, hindi ginagawa sa frontend.
  - Malinaw na display ng winner name pagkatapos, kasama ang numero ng draw (hal. "Winner #5").
- Public "Winners List" page na naka-real time update (pwede gamit ng polling o WebSocket) para makita agad ng lahat.
- Admin panel na naka-separate login, para lang sa pag-manage ng participant list at prizes — hindi puwedeng baguhin ang resulta ng draw dito.

### 5. Deployment Note (WAMPServer)
- I-configure ang MySQL sa WAMPServer, gumawa ng database (hal. `lgu_raffle`), at gamitin ang `mysql2` package sa Node.js para kumonekta.
- Siguraduhing naka-restrict ang access sa phpMyAdmin (may password) para walang makapag-edit ng records nang direkta habang may ongoing event.

---

## Paalala
Ipaliwanag mo rin sa AI o developer na priority ang **transparency at auditability** — mas importante ito kaysa sa ganda ng UI, dahil ang layunin talaga ay maiwasan ang alegasyon ng pandaraya sa LGU, mayor, at bise mayor.
