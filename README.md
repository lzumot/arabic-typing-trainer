# Arabic Typing Trainer

Offline Arabic typing trainer. Plain HTML/CSS/JS in front, one SQLite file behind it,
a Python stdlib server in between. No network, no accounts, no analytics.

## Open it

Double-click `Start Trainer.command`. The browser opens on `http://127.0.0.1:8765/`.

Double-click `Stop Trainer.command` to stop the server.

The first keypress is already play. Blocks fall; type the letter or the short word on screen.
Each game shows its own instruction card the first time you open it, and the `?` in the
top-left corner brings it back.

## The games

| Game | What you do | Length |
| --- | --- | --- |
| Pop | Type the falling block. The ramp is one letter, then 2-letter, 3-letter, 4-letter words, then mixed | 30 s |
| Twins | Fill the gap with the right look-alike letter (ة/ه, أ/إ, ذ/ز/ظ …) | 10 words |
| Ghost race | Type a passage against the ghost of your own best run | 60 s cap |
| Duel | You type first, the tutor types second; faster clean run wins | one text |
| Boss text | Type a homework answer in 5–8 word chunks | one text |
| Writer | Free writing, timed, nothing can be wrong | until Esc |

All built-in content is written at MYP year 3 / language acquisition phase 3–4 level:
connected paragraphs of 45–60 words with past, present and future, connectors (لكن، لذلك،
لأن، بينما) and opinion phrases (في رأيي …).

## Daily score

The number top-right is today's score, not a session score: 1 point per correct key,
5 per fully correct word. A wrong key scores 0 and ends the streak — nothing ever
subtracts. It sits in the `meta` table under `score:YYYY-MM-DD` and resets at midnight.
Pop's rung is stored under `pop:stage` (0 letters, 1 two-letter words, 2 three-letter,
3 four-letter, 4 mixed).

| Key | Does |
| --- | --- |
| any Arabic letter | pops the falling letter / types in the current mode |
| `Esc` | leaves the round (never recorded as a failure) |
| `Ctrl+Option+T` | opens the tutor view |
| tray (appears after ~20 s) | Pop · Twins · Ghost race · Duel · Boss text · Writer · My records |

## Where the data lives

`data/trainer.db` — sessions, rounds, raw keystrokes, texts, handwriting baselines,
signals, personal bests. Clearing the browser cannot touch it. Backup and CSV export
are buttons in the tutor view, under **Data**.

## Tutor view

- **Speed** — WPM/CPM per session, weekly medians, the pen baseline as a flat line.
- **Letters** — median reaction time per key for any week, with a compare toggle, plus hunts (>1.5 s).
- **Errors** — the four error classes per session and the spelling confusion table.
- **Engagement** — sessions per week, median length, continuation rate, modes picked.
- **Frustration** — automatic signals per session next to the 1–5 rating and notes.
- **Data** — clock toggle, handwriting baseline form, text list, CSV export, database backup.

Raw events are the source of truth; every metric is recomputed from them, so changing a
definition later re-reads old data.

## Files

```
server.py                  stdlib HTTP + SQLite, api under /api
web/index.html             shell
web/styles.css             all styling
web/js/app.js              session, rounds, tray, key routing, Latin-keyboard detection
web/js/keymap.js           Arabic-PC layout, neighbours, confusable sets, error classes
web/js/tracker.js          writes one round + its raw keystrokes
web/js/metrics.js          reaction times, hunts, WPM, error classes, weekly medians
web/js/tutor.js            tutor dashboard
web/js/records.js          "My records" (personal bests only, nothing can go down)
web/js/modes/*.js          pop, twins, ghost, boss, duel, writer, shared text runner
web/js/textbank.js         passages, twins word bank, pop words, letter pool
data/trainer.db            all history
```

## Things that are deliberately configurable facts, not magic

- `web/js/keymap.js` holds the macOS **Arabic – PC** key map. If a key produces a
  different character on this Mac, edit the `LAYOUT` table there. Raw `event.key` and
  `event.code` are always stored, so old data stays usable after a fix.
- Vowel-mark positions on the shift layer are best-effort (tashkeel is out of scope);
  the hamza forms (أ إ ء ئ ؤ) are the ones used for error classification.
- `HUNT_MS` (1.5 s) and the 2× self-median factor are in `web/js/metrics.js`.
- Round length for Pop (`ROUND_MS`), the 60 s Ghost cap, and the 45 s ease-off window
  are constants at the top of their modules.

## If it says "Address already in use"

That means a trainer server is already running. `Start Trainer.command` detects it and just
opens the browser, and a second `python3 server.py` now exits quietly with
`The trainer is already running`. To force a clean start, double-click
`Stop Trainer.command` first.

## Reset all progress

Quit with `Stop Trainer.command`, delete `data/trainer.db`, then start again. Backup first
from the tutor view (Data → Backup database) if the history should be kept.

## Updating

Double-click `Stop Trainer.command`, replace files, start again. The database is never
touched by an update.
