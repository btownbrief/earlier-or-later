# EARLIER or LATER: BTV

Four centuries of Burlington, one card at a time. A local-history streak game for [Btown Games](https://btownbrief.github.io/) — two Burlington & Vermont moments, one with its date showing and one hidden. Did the mystery event happen **earlier** or **later**? Keep the chain alive.

**Play it:** https://btownbrief.github.io/earlier-or-later/

## How it works

- `data/events.json` holds the archive: `{event, year, blurb, sourceUrl, category}`, every date verified against its source (a wrong date would be fatal to the game's credibility).
- The known card shows its year; the challenger's is hidden. Guess EARLIER / LATER; a correct call flips the challenger's date + blurb, it becomes the new anchor, and the streak grows.
- **Difficulty ramp:** early pairs sit decades apart (easy), and the year gap tightens toward a 3-year floor as your streak climbs. Two events are never paired within 3 years.
- No repeats within a run; seen events are tracked in `localStorage` so regulars keep meeting fresh history across runs (the slate wipes once most of the archive has been seen).
- Streak = score. Monthly Supabase leaderboard shared across Btown Games (slug `earlier-or-later`).

Plain static site — no build step. `index.html` + `style.css` + `js/` ES modules. Every push to `main` auto-deploys via `.github/workflows/deploy.yml`.
