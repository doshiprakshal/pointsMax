/* ── State ──────────────────────────────────────────────────────────────── */
let allCards      = [];
let cardRowCount  = 0;

/* ── SerpAPI key helpers (stored in localStorage, never on server) ───────── */
const SERP_KEY_STORAGE = 'pointsmax_serp_key';

function getSerpKey() {
  return localStorage.getItem(SERP_KEY_STORAGE) || '';
}
function setSerpKey(key) {
  localStorage.setItem(SERP_KEY_STORAGE, key.trim());
}

/* ── Modal ───────────────────────────────────────────────────────────────── */
function openModal() {
  const modal = document.getElementById('modal-overlay');
  modal.classList.remove('hidden');
  const existing = getSerpKey();
  document.getElementById('input-serp-key').value = existing;
  document.getElementById('modal-key-status').textContent =
    existing ? '✓ Key saved. You can update it anytime.' : '';
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

/* ── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Set default date to 30 days from now
  const d = new Date();
  d.setDate(d.getDate() + 30);
  document.getElementById('travel-date').value = d.toISOString().split('T')[0];

  // Fetch available cards
  try {
    const res = await fetch('/api/cards');
    allCards  = await res.json();
  } catch {
    allCards = [];
  }

  addCardRow();   // start with one row

  document.getElementById('btn-add-card').addEventListener('click', addCardRow);
  document.getElementById('btn-search').addEventListener('click', doSearch);
  document.getElementById('btn-swap').addEventListener('click', swapAirports);
  document.getElementById('howto-close').addEventListener('click', closeHowTo);

  // Modal wiring
  document.getElementById('btn-settings').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.getElementById('btn-save-key').addEventListener('click', () => {
    const val = document.getElementById('input-serp-key').value.trim();
    if (!val) {
      document.getElementById('modal-key-status').textContent = '⚠ Please enter a key first.';
      return;
    }
    setSerpKey(val);
    document.getElementById('modal-key-status').textContent = '✓ Key saved successfully!';
    setTimeout(closeModal, 800);
  });

  // Show modal automatically if no key is saved yet
  if (!getSerpKey()) openModal();

  // Auto-uppercase airport inputs
  ['origin','destination'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });
  });
});

/* ── Card rows ──────────────────────────────────────────────────────────── */
function addCardRow() {
  cardRowCount++;
  const container = document.getElementById('cards-container');

  const row = document.createElement('div');
  row.className    = 'card-row';
  row.dataset.rowId = cardRowCount;

  const select = document.createElement('select');
  select.innerHTML = `<option value="">— Select a credit card —</option>`
    + allCards.map(c =>
        `<option value="${c.id}">${c.name} (${c.currency})</option>`
      ).join('');

  const input = document.createElement('input');
  input.type        = 'number';
  input.placeholder = 'Points balance';
  input.min         = '0';

  const removeBtn = document.createElement('button');
  removeBtn.className   = 'btn-remove';
  removeBtn.textContent = '✕';
  removeBtn.title       = 'Remove';
  removeBtn.addEventListener('click', () => {
    if (container.querySelectorAll('.card-row').length > 1) row.remove();
  });

  row.append(select, input, removeBtn);
  container.appendChild(row);
}

function getSelectedCards() {
  const rows = document.querySelectorAll('.card-row');
  const cards = [];
  rows.forEach(row => {
    const id     = row.querySelector('select').value;
    const points = parseInt(row.querySelector('input').value, 10);
    if (id && points > 0) cards.push({ id, points });
  });
  return cards;
}

/* ── Swap airports ──────────────────────────────────────────────────────── */
function swapAirports() {
  const o = document.getElementById('origin');
  const d = document.getElementById('destination');
  [o.value, d.value] = [d.value, o.value];
}

/* ── Search ─────────────────────────────────────────────────────────────── */
async function doSearch() {
  clearError();
  const cards = getSelectedCards();
  if (!cards.length) return showError('Please add at least one card with a point balance.');

  const origin      = document.getElementById('origin').value.trim().toUpperCase();
  const destination = document.getElementById('destination').value.trim().toUpperCase();
  const date        = document.getElementById('travel-date').value;
  const cabin       = document.getElementById('cabin').value;
  const passengers  = parseInt(document.getElementById('passengers').value, 10) || 1;

  if (!origin || origin.length < 3)           return showError('Please enter a valid origin airport code (e.g. JFK).');
  if (!destination || destination.length < 3) return showError('Please enter a valid destination airport code (e.g. LHR).');
  if (!date) return showError('Please select a departure date.');

  const serpApiKey = getSerpKey();
  if (!serpApiKey) {
    openModal();
    return showError('Please add your free SerpAPI key first — click "⚙ API Key" at the top.');
  }

  setLoading(true);

  try {
    const res  = await fetch('/api/optimize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards, origin, destination, date, cabin, passengers, serpApiKey })
    });
    const data = await res.json();

    if (data.error) { showError(data.error); return; }

    renderResults(data, { origin, destination, date, cabin, passengers });
  } catch (err) {
    showError('Network error. Please try again.');
  } finally {
    setLoading(false);
  }
}

/* ── Render results ─────────────────────────────────────────────────────── */
function renderResults(data, meta) {
  const section = document.getElementById('results');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  renderSummary(data, meta);
  renderCarriers(data.carriers || []);
  renderOptions(data.options || [], data);
}

function renderSummary(data, meta) {
  const el       = document.getElementById('results-summary');
  const best     = data.bestOption;
  const cabinMap = { economy: 'Economy', premium_economy: 'Prem. Economy', business: 'Business', first: 'First Class' };

  el.innerHTML = `
    <div class="summary-stat">
      <span class="label">Route</span>
      <span class="value">${meta.origin} → ${meta.destination}</span>
    </div>
    <div class="summary-divider"></div>
    <div class="summary-stat">
      <span class="label">Cabin</span>
      <span class="value">${cabinMap[meta.cabin]}</span>
    </div>
    <div class="summary-divider"></div>
    <div class="summary-stat">
      <span class="label">Cash Price</span>
      <span class="value">${data.lowestCashPrice ? '$' + data.lowestCashPrice.toLocaleString() : 'N/A'}</span>
    </div>
    <div class="summary-divider"></div>
    <div class="summary-stat">
      <span class="label">Options Found</span>
      <span class="value">${(data.options || []).length}</span>
    </div>
    ${best ? `
    <div class="summary-divider"></div>
    <div class="summary-stat">
      <span class="label">Best Value</span>
      <span class="value">${best.centsPerPoint}¢/pt — ${best.program}</span>
    </div>` : ''}
  `;
}

function renderCarriers(carriers) {
  const el = document.getElementById('carriers-row');
  if (!carriers.length) { el.innerHTML = ''; return; }

  el.innerHTML = `<span style="font-size:.82rem;font-weight:700;color:var(--muted);align-self:center;">FLIGHTS FOUND:</span>`
    + carriers.map(c => `
      <div class="carrier-chip">
        ${c.logo ? `<img src="${c.logo}" alt="${c.name}" onerror="this.style.display='none'"/>` : '✈'}
        ${c.name}
        ${c.bestPrice ? `<span class="carrier-price">from $${c.bestPrice.toLocaleString()}</span>` : ''}
        ${c.stops === 0 ? `<span style="color:var(--accent);font-size:.75rem;"> Nonstop</span>` : ''}
      </div>
    `).join('');
}

function renderOptions(options, data) {
  const grid = document.getElementById('options-grid');
  if (!options.length) {
    grid.innerHTML = `<div class="error-msg">No redemption options found for this route with your cards. Try adding more cards or adjusting the route.</div>`;
    return;
  }

  grid.innerHTML = options.map((opt, i) => buildOptionCard(opt, i, options.length)).join('');

  // Attach how-to listeners
  grid.querySelectorAll('.btn-howto').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      openHowTo(options[idx]);
    });
  });
}

function buildOptionCard(opt, idx, total) {
  const isFirst = idx === 0;
  const isSweet = opt.sweetSpot && !isFirst;

  const borderClass = isFirst ? 'best' : isSweet ? 'sweet' : '';
  const badge = isFirst
    ? `<div class="option-badge badge-best">🏆 Best Value</div>`
    : isSweet
      ? `<div class="option-badge badge-sweet">💎 Sweet Spot</div>`
      : '';

  const typeLabel = opt.type === 'portal' ? 'Travel Portal'
    : opt.type === 'multi_transfer' ? '🔗 Multi-Card Pool'
    : 'Loyalty Transfer';

  const coverPill = `<span class="cover-pill ${opt.canFullyCover ? 'cover-yes' : 'cover-no'}">${opt.canFullyCover ? '✓ Points covered' : '✗ Need more points'}</span>`;

  const cppColor   = opt.centsPerPoint >= 2 ? '#16a34a' : opt.centsPerPoint >= 1.5 ? '#1a56db' : '#d97706';
  const scoreWidth = Math.min(100, Math.round((opt.score / 100) * 100));

  // Unified points needed — always means "points you take from your card(s)"
  const cardPtsNeeded = (opt.type === 'transfer' || opt.type === 'multi_transfer')
    ? (opt.cardPointsNeeded || opt.pointsNeeded)
    : opt.pointsNeeded;

  // What the points convert into (only meaningful for transfers)
  const awardMilesLine = (opt.type === 'transfer' || opt.type === 'multi_transfer')
    ? `<div class="stat-item">
         <span class="stat-label">Award Miles</span>
         <span class="stat-value">${opt.pointsNeeded.toLocaleString()} mi</span>
       </div>`
    : '';

  // Airlines: prefer matched carriers (actual flights found); fallback to program partners
  const airlineNames = opt.matchedCarriers?.length
    ? opt.matchedCarriers
    : opt.type === 'portal'
      ? ['All carriers']
      : (opt.airlines || []).slice(0, 3);

  // Flight type badge
  const flightTypeBadge = opt.flightType
    ? `<span class="flight-type-badge ${opt.flightType === 'Nonstop available' || opt.flightType === 'Nonstop & Connecting' ? 'nonstop' : 'connecting'}">${
        opt.flightType === 'Nonstop available' ? '✈ Nonstop'
        : opt.flightType === 'Nonstop & Connecting' ? '✈ Nonstop + Connecting'
        : '↔ Connecting only'
      }</span>`
    : '';

  return `
    <div class="option-card ${borderClass}">
      ${badge}

      <div class="score-bar">
        <div class="score-fill" style="width:${scoreWidth}%"></div>
      </div>

      <!-- Header row: type + program name + cpp -->
      <div class="option-top">
        <div class="option-title">
          <span class="option-type-label">${typeLabel}</span>
          <span class="option-name">${opt.card}</span>
          <span class="option-program">${opt.program}${opt.alliance ? ` · ${opt.alliance}` : ''}</span>
        </div>
        <div class="option-cpp">
          <div class="cpp-value" style="color:${cppColor}">${opt.centsPerPoint}¢</div>
          <div class="cpp-label">per point</div>
        </div>
      </div>

      <!-- Unified stats — same fields on every card -->
      <div class="option-stats">
        <div class="stat-item">
          <span class="stat-label">Your Points Used</span>
          <span class="stat-value">${cardPtsNeeded.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">You Have</span>
          <span class="stat-value ${opt.canFullyCover ? 'good' : 'bad'}">${opt.pointsAvailable.toLocaleString()}</span>
        </div>
        ${awardMilesLine}
        <div class="stat-item">
          <span class="stat-label">Extra Cash</span>
          <span class="stat-value ${opt.cashNeeded > 0 ? 'warn' : 'good'}">${opt.cashNeeded > 0 ? '$' + opt.cashNeeded.toLocaleString() : '$0'}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Cash Equivalent</span>
          <span class="stat-value">$${(opt.cashValue || 0).toLocaleString()}</span>
        </div>
        ${opt.bestDuration ? `
        <div class="stat-item">
          <span class="stat-label">Flight Duration</span>
          <span class="stat-value">⏱ ${fmtDuration(opt.bestDuration)}</span>
        </div>` : ''}
      </div>

      <!-- Airlines + flight type + coverage pill -->
      <div class="option-airlines-row">
        <div class="airlines-chips">
          ${airlineNames.map(a => `<span class="airline-chip">${a}</span>`).join('')}
          ${flightTypeBadge}
        </div>
        ${coverPill}
      </div>

      <div class="option-bottom">
        <div></div>
        <button class="btn-howto" data-idx="${idx}">How to Book →</button>
      </div>

      ${opt.breakdown ? `
        <div class="breakdown-box">
          <div class="breakdown-label">Card Breakdown</div>
          ${opt.breakdown.map(b => `
            <div class="breakdown-row">
              <span class="breakdown-card">${b.cardName}</span>
              <span class="breakdown-arrow">→</span>
              <span class="breakdown-pts">${b.cardPointsUsed.toLocaleString()} pts</span>
              <span class="breakdown-arrow">→</span>
              <span class="breakdown-miles">${b.milesUsed.toLocaleString()} miles</span>
            </div>
          `).join('')}
        </div>` : ''}
      ${opt.note ? `<div class="option-note">ℹ ${opt.note}</div>` : ''}
    </div>
  `;
}

/* ── How-to drawer ──────────────────────────────────────────────────────── */
function openHowTo(opt) {
  const drawer = document.getElementById('howto-drawer');
  const title  = document.getElementById('howto-title');
  const body   = document.getElementById('howto-body');

  title.textContent = `How to Book: ${opt.program}`;

  let steps = [];

  if (opt.type === 'multi_transfer') {
    steps = [
      `You're combining points from <strong>${opt.breakdown.length} credit cards</strong> into <strong>${opt.program}</strong>. This gives you more miles than any single card alone.`,
      ...opt.breakdown.map((b, i) =>
        `<strong>Card ${i+1} — ${b.cardName}:</strong> Transfer <strong>${b.cardPointsUsed.toLocaleString()} points</strong> (${b.ratio}:1 ratio) → you receive <strong>${b.milesUsed.toLocaleString()} ${opt.program} miles</strong>.`
      ),
      `⚠️ <strong>Important:</strong> Do all transfers before booking. Transfers are <strong>irreversible</strong> and usually instant to 24 hours.`,
      `Once all miles land in your <strong>${opt.program}</strong> account (total: <strong>${opt.pointsNeeded.toLocaleString()} miles</strong>), go to their website and search for award seats.`,
      `Look for <strong>${opt.cabin || 'economy'} class</strong> award availability (Saver/Advantage rates). Taxes & fees are paid separately.`,
      canFullyCoverText(opt)
    ].filter(Boolean);
  } else if (opt.type === 'portal') {
    steps = [
      `Log in to your <strong>${opt.card}</strong> account at your card issuer's website.`,
      `Navigate to the <strong>Travel Portal</strong> section (usually under "Rewards" or "Benefits").`,
      `Search for flights from <strong>${document.getElementById('origin').value}</strong> to <strong>${document.getElementById('destination').value}</strong>.`,
      `Select your preferred flight. You'll see the option to pay with points at <strong>${opt.centsPerPoint}¢ per point</strong>.`,
      `You need <strong>${(opt.pointsNeeded).toLocaleString()} points</strong> to fully cover this trip.${opt.cashNeeded > 0 ? ` You'll need an additional <strong>$${opt.cashNeeded.toLocaleString()}</strong> in cash.` : ' You have enough points to fully cover it! ✓'}`,
      `Confirm your booking and enjoy your trip!`
    ];
  } else {
    steps = [
      `Log in to your <strong>${opt.card}</strong> account at your card issuer's website.`,
      `Go to <strong>Rewards → Transfer Points</strong> and select <strong>${opt.program}</strong> as the transfer partner.`,
      `Transfer <strong>${(opt.cardPointsNeeded).toLocaleString()} points</strong> at a <strong>${opt.transferRatio}:1 ratio</strong> → you'll receive <strong>${opt.pointsNeeded.toLocaleString()} ${opt.program} miles/points</strong>.`,
      `⚠️ <strong>Important:</strong> Transfers are usually instant to 24 hrs but are <strong>irreversible</strong>. Only transfer what you need.`,
      `Go to <a href="${opt.bookingUrl}" target="_blank" style="color:var(--primary)">${opt.program}'s website</a> and search for award flights.`,
      `Look for <strong>${opt.cabin || 'economy'} class</strong> award seats (Saver/Advantage rates, not full rates).`,
      `Complete the booking using your transferred miles. Taxes & fees are usually paid separately (often $5–$200 depending on airline).`,
      !opt.canFullyCover
        ? `You currently have <strong>${opt.pointsAvailable.toLocaleString()} points</strong> but need <strong>${opt.cardPointsNeeded.toLocaleString()}</strong>. Consider combining with another card or earning more points first.`
        : `You have enough points! ✓ You'll have <strong>${(opt.pointsAvailable - opt.cardPointsNeeded).toLocaleString()} points</strong> left over.`
    ].filter(Boolean);
  }

  body.innerHTML = steps.map((s, i) => `
    <div class="howto-step">
      <div class="howto-step-num">${i + 1}</div>
      <div class="howto-step-text">${s}</div>
    </div>
  `).join('') + (opt.bookingUrl && opt.bookingUrl !== '#' ? `
    <a href="${opt.bookingUrl}" target="_blank" class="howto-link">
      🔗 Go to ${opt.program} →
    </a>
  ` : '');

  drawer.classList.remove('hidden');
}

function fmtDuration(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function canFullyCoverText(opt) {
  if (opt.canFullyCover) {
    const leftover = opt.pointsAvailable - opt.pointsNeeded;
    return `You have enough combined miles! ✓ You'll have <strong>${leftover.toLocaleString()} miles</strong> left over after this redemption.`;
  }
  const shortfall = opt.pointsNeeded - opt.pointsAvailable;
  return `You're <strong>${shortfall.toLocaleString()} miles short</strong>. Earn more points on either card, or wait for a transfer bonus promotion.`;
}

function closeHowTo() {
  document.getElementById('howto-drawer').classList.add('hidden');
}

/* ── UI helpers ─────────────────────────────────────────────────────────── */
function setLoading(on) {
  const label   = document.getElementById('search-label');
  const spinner = document.getElementById('search-spinner');
  const btn     = document.getElementById('btn-search');
  label.textContent = on ? 'Searching...' : '🔍 Find Best Redemption';
  spinner.classList.toggle('hidden', !on);
  btn.disabled = on;
}

function showError(msg) {
  clearError();
  const err = document.createElement('div');
  err.className = 'error-msg';
  err.id        = 'global-error';
  err.textContent = msg;
  document.querySelector('.search-bar').after(err);
}

function clearError() {
  document.getElementById('global-error')?.remove();
}
