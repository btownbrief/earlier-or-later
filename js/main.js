// EARLIER or LATER: BTV — a local-history streak game for Btown Games.
import {
  lbEnabled, getName, submitScore, renamePlayer, fetchTop, monthLabel, playerId,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);

const FLOOR_GAP = 3;      // never pair two events within 3 years (too unfair)
const BEST_KEY = 'btown-eol-best';
const SEEN_KEY = 'btown-eol-seen';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let events = [];
let anchor = null, challenger = null;
let streak = 0;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let usedThisRun = new Set();   // event objects already shown this run
let seen = loadSeen();         // event text seen across all runs (freshness)
let phase = 'intro';           // intro | guessing | revealing | over
let scoreSubmitted = false;
let runId = 0;
let roundTimer = null;
let handoffTimer = null;
let milestoneTimer = null;

$('best').textContent = best;

// ------------------------------------------------------------ data
const res = await fetch('data/events.json');
events = await res.json();
$('pool-flex').textContent =
  `${events.length} dated events · ${Math.min(...events.map((e) => e.year))}–${Math.max(...events.map((e) => e.year))}`;

// ------------------------------------------------------------ helpers
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function persistSeen() {
  // let the archive breathe: once most events have been seen, wipe the slate
  if (seen.size > events.length * 0.8) seen = new Set();
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}
function markSeen(e) { seen.add(e.event); }

// pick from a candidate list, preferring events the player hasn't seen before
function preferUnseen(candidates) {
  const unseen = candidates.filter((e) => !seen.has(e.event));
  return rand(unseen.length ? unseen : candidates);
}

// The difficulty ramp: early streaks pair events decades apart (easy), and the
// year gap tightens toward the 3-year floor as the streak grows.
function targetGap() {
  return Math.max(FLOOR_GAP, Math.round(60 * Math.pow(0.86, streak)));
}

// pick a challenger for `from`, honoring the floor and the streak's target gap
function pickChallenger(from) {
  const pool = events.filter(
    (e) => !usedThisRun.has(e) && Math.abs(e.year - from.year) >= FLOOR_GAP,
  );
  if (!pool.length) return null;
  const t = targetGap();
  const lo = Math.max(FLOOR_GAP, t * 0.6);
  const hi = t * 1.8;
  let band = pool.filter((e) => {
    const g = Math.abs(e.year - from.year);
    return g >= lo && g <= hi;
  });
  if (!band.length) band = pool; // pool too thin for the ideal window — relax
  return preferUnseen(band);
}

function claim(e) { usedThisRun.add(e); markSeen(e); }
const sourceLink = (e) => `<a href="${e.sourceUrl}" target="_blank" rel="noopener">source ↗</a>`;

// ------------------------------------------------------------ rendering
function renderAnchor() {
  $('cardA').classList.remove('handoff-out');
  $('eraA').textContent = anchor.year;
  $('eventA').textContent = anchor.event;
  $('blurbA').innerHTML = `${anchor.blurb} ${sourceLink(anchor)}`;
}

function renderChallenger(deal = false) {
  const cardB = $('cardB');
  cardB.classList.add('mystery');
  cardB.classList.remove('reveal-good', 'reveal-bad', 'handoff-in', 'deal-in');
  cardB.style.removeProperty('--handoff-x');
  cardB.style.removeProperty('--handoff-y');
  $('eraB').textContent = '????';
  $('eraB').classList.remove('slotting');
  $('eventB').textContent = challenger.event;
  $('blurbB').classList.add('hidden');
  $('blurbB').innerHTML = `${challenger.blurb} ${sourceLink(challenger)}`;
  $('prompt').classList.remove('hidden');
  $('guessRow').classList.remove('hidden');
  $('revealStatus').classList.add('hidden');
  $('verdict').className = '';
  $('verdict').textContent = '';
  $('gapNote').textContent = '';
  $('link').classList.remove('drawing');
  if (deal && !reducedMotion.matches) {
    void cardB.offsetWidth;
    cardB.classList.add('deal-in');
  }
}

// A short slot-machine reveal: digits scramble, then lock left-to-right.
function countUp(el, target, ms = 650, activeRun = runId) {
  const digits = String(target);
  const t0 = performance.now();
  return new Promise((resolve) => {
    let done = false;
    let frame = null;
    let fallback = null;
    let lastStep = -1;
    const finish = (showTarget = true) => {
      if (done) return;
      done = true;
      if (frame) cancelAnimationFrame(frame);
      if (fallback) clearTimeout(fallback);
      if (showTarget && activeRun === runId) el.textContent = digits;
      el.classList.remove('slotting');
      resolve();
    };
    if (reducedMotion.matches || ms === 0) {
      finish();
      return;
    }
    el.classList.add('slotting');
    function tick(t) {
      if (done) return;
      if (activeRun !== runId) { finish(false); return; }
      const elapsed = t - t0;
      const progress = Math.min(elapsed / ms, 1);
      const step = Math.floor(elapsed / 45);
      if (step !== lastStep) {
        lastStep = step;
        el.textContent = [...digits].map((digit, index) => {
          const settleAt = 0.34 + (index / Math.max(digits.length - 1, 1)) * 0.56;
          return progress >= settleAt ? digit : Math.floor(Math.random() * 10);
        }).join('');
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
      else finish();
    }
    frame = requestAnimationFrame(tick);
    // Background tabs pause rAF; the answer must still land.
    fallback = setTimeout(finish, ms + 300);
  });
}

function updateStreakDisplay(animate = false) {
  const isHot = streak >= 5;
  const badge = $('streakBadge');
  $('streak').textContent = streak;
  $('streakFlame').textContent = isHot ? '🔥' : '';
  badge.classList.toggle('streak-hot', isHot);
  badge.classList.remove('streak-tick');
  if (animate && !reducedMotion.matches) {
    void badge.offsetWidth;
    badge.classList.add('streak-tick');
  }
}

function showMilestone(activeRun) {
  const messages = {
    5: 'HEATING UP',
    10: 'DOUBLE DIGITS',
    20: 'QUEEN CITY LEGEND',
  };
  if (!messages[streak] || activeRun !== runId) return;
  clearTimeout(milestoneTimer);
  const pop = $('milestonePop');
  $('milestoneLabel').textContent = messages[streak];
  $('milestoneValue').textContent = `🔥 ${streak} STREAK 🔥`;
  pop.classList.remove('hidden', 'show');
  if (!reducedMotion.matches) void pop.offsetWidth;
  pop.classList.add('show');
  milestoneTimer = setTimeout(() => {
    if (activeRun !== runId) return;
    pop.classList.add('hidden');
    pop.classList.remove('show');
  }, 1100);
}

function scheduleRound(next, delay, activeRun) {
  clearTimeout(roundTimer);
  roundTimer = setTimeout(() => {
    roundTimer = null;
    if (activeRun === runId) next();
  }, delay);
}

function resetEffects() {
  clearTimeout(roundTimer);
  clearTimeout(handoffTimer);
  clearTimeout(milestoneTimer);
  roundTimer = null;
  handoffTimer = null;
  milestoneTimer = null;
  $('milestonePop').classList.add('hidden');
  $('milestonePop').classList.remove('show');
  $('cardA').classList.remove('handoff-out');
  $('cardB').classList.remove('handoff-in', 'deal-in');
  $('link').classList.remove('drawing');
}

// ------------------------------------------------------------ game flow
function startRun() {
  runId += 1;
  resetEffects();
  streak = 0;
  usedThisRun = new Set();
  scoreSubmitted = false;
  updateStreakDisplay();
  $('intro').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('game').classList.remove('hidden');

  anchor = preferUnseen(events);
  claim(anchor);
  challenger = pickChallenger(anchor);
  claim(challenger);
  renderAnchor();
  renderChallenger();
  phase = 'guessing';
}

async function guess(dir) {
  if (phase !== 'guessing') return;
  phase = 'revealing';
  const activeRun = runId;
  const revealedAnchor = anchor;
  const revealedChallenger = challenger;
  $('guessRow').classList.add('hidden');
  $('prompt').classList.add('hidden');

  const isLater = revealedChallenger.year > revealedAnchor.year;
  const correct = (dir === 'later') === isLater;

  const cardB = $('cardB');
  cardB.classList.remove('mystery');
  $('link').classList.add('drawing');
  const eraB = $('eraB');
  await countUp(eraB, revealedChallenger.year, 650, activeRun);
  if (activeRun !== runId) return;
  $('blurbB').classList.remove('hidden');

  const verdict = $('verdict');
  const gap = Math.abs(revealedChallenger.year - revealedAnchor.year);
  $('gapNote').textContent = `Just ${gap} years apart!`;
  verdict.classList.remove('good', 'bad');
  if (correct) {
    cardB.classList.add('reveal-good');
    verdict.classList.add('good');
    streak += 1;
    updateStreakDisplay(true);
    verdict.textContent = `✓ ${isLater ? 'LATER' : 'EARLIER'} — streak ${streak}`;
    $('revealStatus').classList.remove('hidden');
    showMilestone(activeRun);
    scheduleRound(() => advance(activeRun), 1150, activeRun);
  } else {
    cardB.classList.add('reveal-bad');
    verdict.classList.add('bad');
    verdict.textContent = `✗ It was ${isLater ? 'LATER' : 'EARLIER'}`;
    $('revealStatus').classList.remove('hidden');
    scheduleRound(() => endRun(false), 1400, activeRun);
  }
}

function advance(activeRun) {
  if (activeRun !== runId) return;
  // The revealed card visibly becomes the anchor before its next opponent arrives.
  const nextAnchor = challenger;
  const nextChallenger = pickChallenger(nextAnchor);
  if (!nextChallenger) { endRun(true); return; } // ran the whole archive dry — a legend
  claim(nextChallenger);

  const finishHandoff = () => {
    if (activeRun !== runId) return;
    handoffTimer = null;
    anchor = nextAnchor;
    challenger = nextChallenger;
    renderAnchor();
    renderChallenger(true);
    phase = 'guessing';
  };

  if (reducedMotion.matches) {
    finishHandoff();
    return;
  }
  const anchorRect = $('cardA').getBoundingClientRect();
  const revealedRect = $('cardB').getBoundingClientRect();
  $('cardB').style.setProperty('--handoff-x', `${anchorRect.left - revealedRect.left}px`);
  $('cardB').style.setProperty('--handoff-y', `${anchorRect.top - revealedRect.top}px`);
  $('cardA').classList.add('handoff-out');
  $('cardB').classList.add('handoff-in');
  handoffTimer = setTimeout(finishHandoff, 420);
}

function endRun(exhausted) {
  phase = 'over';
  clearTimeout(roundTimer);
  clearTimeout(handoffTimer);
  roundTimer = null;
  handoffTimer = null;
  const activeRun = runId;
  persistSeen();
  const isBest = streak > best;
  if (isBest) { best = streak; localStorage.setItem(BEST_KEY, String(best)); }
  $('best').textContent = best;
  $('overTitle').textContent = exhausted ? 'YOU BEAT THE ARCHIVE!' : 'STREAK OVER';
  $('finalStreak').textContent = '0';
  const bl = $('bestLine');
  bl.textContent = isBest ? 'NEW BEST!' : `Best: ${best}`;
  bl.className = isBest ? 'best-line new-best' : 'best-line';
  $('finalSources').innerHTML =
    `<b>${anchor.year}</b> — ${anchor.event}. ${sourceLink(anchor)}<br>` +
    `<b>${challenger.year}</b> — ${challenger.event}. ${sourceLink(challenger)}`;
  $('game').classList.add('hidden');
  $('gameover').classList.remove('hidden');
  void countUp($('finalStreak'), streak, streak === 0 ? 0 : 550, activeRun);
  requestAnimationFrame(() => {
    if (phase === 'over' && activeRun === runId) $('restartBtn').focus({ preventScroll: true });
  });
  updateLeaderboard(streak);
}

// ------------------------------------------------------------ share
$('shareBtn').addEventListener('click', async () => {
  const clocks = '🕰️'.repeat(Math.min(streak, 10)) || '🫥';
  const text = `EARLIER or LATER: BTV ${clocks}\nI strung together ${streak} in a row on Burlington history. Beat it:`;
  const url = 'https://btownbrief.github.io/earlier-or-later/';
  try {
    if (navigator.share) await navigator.share({ text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      $('shareBtn').textContent = '✅ COPIED';
      setTimeout(() => { $('shareBtn').textContent = '📤 SHARE'; }, 1500);
    }
  } catch { /* user cancelled */ }
});

// ------------------------------------------------------------ input
$('startBtn').addEventListener('click', startRun);
$('restartBtn').addEventListener('click', startRun);
$('earlierBtn').addEventListener('click', () => guess('earlier'));
$('laterBtn').addEventListener('click', () => guess('later'));

document.addEventListener('keydown', (e) => {
  // never let keystrokes in the leaderboard name box drive the game
  if (e.target.tagName === 'INPUT') return;
  // focused buttons already handle Enter/Space natively
  if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button, a')) return;
  if (phase === 'guessing') {
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'e') { e.preventDefault(); guess('earlier'); }
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'l') { e.preventDefault(); guess('later'); }
  } else if ((phase === 'over' || phase === 'intro') && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault(); startRun();
  }
});

// ------------------------------------------------------------ leaderboard
const lbBox = $('lb'), lbList = $('lbList'), lbStatus = $('lbStatus');
const lbForm = $('lbForm'), lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn'), lbLastBtn = $('lbLastBtn'), lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbBox.classList.remove('hidden');
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

async function updateLeaderboard(s) {
  if (!lbEnabled()) return;
  if (!getName()) {
    // first run: ask for a name before joining the board
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatus.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    lbForm.dataset.pendingScore = String(s);
    return;
  }
  try {
    if (!scoreSubmitted) { scoreSubmitted = true; await submitScore(s); }
  } catch { /* offline — still try to show the board */ }
  renderBoard();
}

async function renderBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatus.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = playerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      li.innerHTML = `<span class="rank">${medal || i + 1}</span><span class="nm"></span><span class="sc"></span>`;
      li.querySelector('.nm').textContent = r.name;
      li.querySelector('.sc').textContent = r.score;
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((r) => r.player_id === me);
    lbStatus.textContent = rows.length === 0
      ? 'No streaks yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatus.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name); // saves locally + updates any existing rows
    if (pending > 0 && !scoreSubmitted) { scoreSubmitted = true; await submitScore(pending); }
  } catch { /* offline */ }
  renderBoard();
});
lbNameInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = getName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderBoard();
});
