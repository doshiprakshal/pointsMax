const express = require('express');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

const SERP_API_KEY = '8dd3f40ca8e0d4ecc5238f8ef6f4b1c08aa4bc09a47a645c0ca9ae5e8099f8ba';

// Load data
const creditCards  = require('./data/credit-cards.json');
const awardCharts  = require('./data/award-charts.json');
const airportZones = require('./data/airport-zones.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse response')); }
      });
    }).on('error', reject);
  });
}

function getZone(airportCode) {
  for (const [zone, codes] of Object.entries(airportZones)) {
    if (zone.startsWith('_')) continue;
    if (codes.includes(airportCode.toUpperCase())) return zone;
  }
  return null;
}

function getRouteKey(zone1, zone2) {
  // Try both orderings against actual chart keys
  return `${zone1}-${zone2}`;
}

function findAwardEntry(program, zone1, zone2) {
  const awards = program.awards || {};
  return awards[`${zone1}-${zone2}`]
      || awards[`${zone2}-${zone1}`]
      || null;
}

function extractCarriers(serpFlights) {
  const carriers = new Map();
  const allFlights = [
    ...(serpFlights.best_flights   || []),
    ...(serpFlights.other_flights  || [])
  ];

  allFlights.forEach(option => {
    (option.flights || []).forEach(segment => {
      const name = segment.airline;
      if (!name) return;
      if (!carriers.has(name) || option.price < carriers.get(name).bestPrice) {
        carriers.set(name, {
          name,
          bestPrice: option.price || 0,
          logo: segment.airline_logo || null,
          flightNumber: segment.flight_number || '',
          duration: option.total_duration || 0,
          stops: (option.layovers || []).length
        });
      }
    });
  });

  return [...carriers.values()];
}

function matchCarrierToProgram(carrierName, program) {
  const cn = carrierName.toLowerCase();
  return (program.airlines || []).some(a => {
    const an = a.toLowerCase();
    return cn.includes(an) || an.includes(cn) ||
           cn.split(' ')[0] === an.split(' ')[0]; // e.g. "United Airlines" vs "United"
  });
}

// ─── Main optimization logic ─────────────────────────────────────────────────

function buildOptions({ userCards, serpData, origin, destination, cabin, passengers }) {
  const originZone = getZone(origin);
  const destZone   = getZone(destination);
  const routeKey   = (originZone && destZone) ? getRouteKey(originZone, destZone) : null;

  const allFlights = [
    ...(serpData.best_flights  || []),
    ...(serpData.other_flights || [])
  ];
  const prices = allFlights.map(f => f.price).filter(Boolean);
  const lowestCashPrice = prices.length ? Math.min(...prices) * passengers : null;
  const carriers = extractCarriers(serpData);

  const options = [];
  const seen    = new Set(); // deduplicate (card × program)

  userCards.forEach(userCard => {
    const cardDef   = creditCards[userCard.id];
    if (!cardDef) return;

    const userPoints = Number(userCard.points) || 0;
    if (userPoints <= 0) return;

    const totalPassengers = passengers || 1;

    // ── Option A: Use the card's own travel portal ──────────────────────────
    if (lowestCashPrice) {
      const cpp             = cardDef.portalValue;            // cents per point
      const totalCost       = lowestCashPrice;
      const pointsNeeded    = Math.ceil((totalCost * 100) / cpp) * totalPassengers;
      const pointsUsed      = Math.min(pointsNeeded, userPoints);
      const cashNeeded      = pointsNeeded > userPoints
        ? Math.ceil((pointsNeeded - userPoints) * cpp / 100)
        : 0;
      const actualCpp       = totalCost > 0 && pointsUsed > 0
        ? (totalCost * 100) / pointsUsed
        : cpp;

      options.push({
        type:           'portal',
        card:           cardDef.name,
        cardId:         userCard.id,
        program:        `${cardDef.name} Travel Portal`,
        programId:      'portal',
        description:    `Book via ${cardDef.name} Travel Portal`,
        pointsNeeded,
        pointsAvailable: userPoints,
        pointsUsed,
        cashNeeded,
        centsPerPoint:  Math.round(actualCpp * 100) / 100,
        cashValue:      totalCost,
        savings:        totalCost - cashNeeded - (pointsUsed * cpp / 100),
        canFullyCover:  userPoints >= pointsNeeded,
        howTo:          `Log in to your ${cardDef.name} account → Travel portal → Search flights → Pay with points at ${cpp}¢/pt`,
        bookingUrl:     '#',
        sweetSpot:      false,
        note:           `${cpp}¢ per point fixed rate. Simple but often not the best value.`,
        passengers:     totalPassengers,
        carriers:       carriers.map(c => c.name),
        flightType:     carriers.some(c => c.stops === 0) ? (carriers.some(c => c.stops > 0) ? 'Nonstop & Connecting' : 'Nonstop available') : 'Connecting only',
        bestDuration:   (() => { const d = carriers.filter(c=>c.stops===0).map(c=>c.duration).filter(Boolean); return d.length ? Math.min(...d) : (carriers.map(c=>c.duration).filter(Boolean).length ? Math.min(...carriers.map(c=>c.duration).filter(Boolean)) : null); })()
      });
    }

    // ── Option B: Transfer to loyalty programs ───────────────────────────────
    Object.entries(cardDef.transferPartners || {}).forEach(([programId, transferInfo]) => {
      const key = `${userCard.id}::${programId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const program = awardCharts[programId];
      if (!program) return;

      // Check if award chart has this route (try both zone orderings)
      const awardEntry = (originZone && destZone)
        ? findAwardEntry(program, originZone, destZone)
        : null;
      const cabinKey   = cabin === 'premium_economy' ? 'business' : cabin; // fallback
      const awardCostPerPax = awardEntry?.[cabinKey] || awardEntry?.['economy'];
      if (!awardCostPerPax) return;

      const totalAwardCost       = awardCostPerPax * passengers;
      const ratio                = transferInfo.ratio || 1;
      const cardPointsNeeded     = Math.ceil(totalAwardCost / ratio);
      const pointsUsed           = Math.min(cardPointsNeeded, userPoints);
      const canFullyCover        = userPoints >= cardPointsNeeded;

      // Estimated cash value = lowest cash price (what you'd otherwise pay)
      const cashValue = lowestCashPrice || (totalAwardCost * program.cppEstimate / 100);
      const centsPerPoint = cashValue > 0 && totalAwardCost > 0
        ? (cashValue * 100) / totalAwardCost
        : program.cppEstimate;

      // Which carriers on this route does this program cover?
      const matchedCarriers = carriers.filter(c => matchCarrierToProgram(c.name, program));
      const hasNonstop  = matchedCarriers.some(c => c.stops === 0);
      const hasLayover  = matchedCarriers.some(c => c.stops > 0);
      const flightType  = matchedCarriers.length === 0 ? null
        : hasNonstop && hasLayover ? 'Nonstop & Connecting'
        : hasNonstop ? 'Nonstop available'
        : 'Connecting only';
      // Shortest flight duration among matched carriers (prefer nonstop)
      const nonstopCarriers = matchedCarriers.filter(c => c.stops === 0);
      const durationPool    = (nonstopCarriers.length ? nonstopCarriers : matchedCarriers)
                                .map(c => c.duration).filter(Boolean);
      const bestDuration    = durationPool.length ? Math.min(...durationPool) : null;

      options.push({
        type:           'transfer',
        card:           cardDef.name,
        cardId:         userCard.id,
        program:        program.name,
        programId,
        alliance:       program.alliance || null,
        description:    `Transfer ${cardDef.currencyShort} → ${program.name}`,
        pointsNeeded:   totalAwardCost,          // points in the loyalty program
        cardPointsNeeded,                         // points from the card
        pointsAvailable: userPoints,
        pointsUsed,
        cashNeeded:     0,                        // awards are all-or-nothing
        centsPerPoint:  Math.round(centsPerPoint * 100) / 100,
        cashValue,
        canFullyCover,
        transferRatio:  ratio,
        howTo: canFullyCover
          ? `Transfer ${cardPointsNeeded.toLocaleString()} pts from ${cardDef.name} → ${program.name} (${ratio}:1), then book ${cabin} award on ${program.airlines?.[0] || 'partner airline'}`
          : `You need ${cardPointsNeeded.toLocaleString()} pts but only have ${userPoints.toLocaleString()}. Earn ${(cardPointsNeeded - userPoints).toLocaleString()} more, or combine cards.`,
        bookingUrl:     program.bookingUrl || '#',
        sweetSpot:      centsPerPoint >= 2.0,
        note:           program.note || null,
        matchedCarriers: matchedCarriers.map(c => c.name),
        flightType,
        bestDuration,
        airlines:       program.airlines,
        passengers:     totalPassengers,
        cabin:          cabinKey
      });
    });
  });

  // ── Option C: Multi-card pooling into a shared loyalty program ──────────────
  // Find every loyalty program that accepts transfers from 2+ of the user's cards.
  // If the pooled miles cover an award AND that beats using any single card's portal,
  // surface it as a combined option.

  // Build a map: programId → list of { cardDef, userPoints, ratio, milesContributable }
  const programContributors = {};
  userCards.forEach(userCard => {
    const cardDef   = creditCards[userCard.id];
    if (!cardDef) return;
    const userPoints = Number(userCard.points) || 0;
    if (userPoints <= 0) return;

    Object.entries(cardDef.transferPartners || {}).forEach(([programId, transferInfo]) => {
      if (!programContributors[programId]) programContributors[programId] = [];
      programContributors[programId].push({
        cardId:   userCard.id,
        cardName: cardDef.name,
        currency: cardDef.currencyShort,
        userPoints,
        ratio:    transferInfo.ratio || 1,
        milesContributable: Math.floor(userPoints * (transferInfo.ratio || 1))
      });
    });
  });

  // Only consider programs where 2+ different cards can contribute
  Object.entries(programContributors).forEach(([programId, contributors]) => {
    if (contributors.length < 2) return;

    const program = awardCharts[programId];
    if (!program) return;

    const awardEntry = (originZone && destZone)
      ? findAwardEntry(program, originZone, destZone)
      : null;
    const cabinKey = cabin === 'premium_economy' ? 'business' : cabin;
    const awardCostPerPax = awardEntry?.[cabinKey] || awardEntry?.['economy'];
    if (!awardCostPerPax) return;

    const totalAwardCost  = awardCostPerPax * passengers;
    const totalPooledMiles = contributors.reduce((sum, c) => sum + c.milesContributable, 0);
    const canFullyCover    = totalPooledMiles >= totalAwardCost;

    // Only proceed if pooling makes a meaningful difference:
    // i.e., no single card alone could fully cover it, but together they can
    const singleCardCanCover = contributors.some(c => c.milesContributable >= totalAwardCost);
    if (singleCardCanCover && canFullyCover) return; // already captured in single-card options

    if (!canFullyCover && totalPooledMiles < totalAwardCost * 0.85) return; // too far off, skip

    // Figure out how much each card actually needs to contribute
    // Greedy: fill from the card with the most miles first, minimising leftover
    const sorted      = [...contributors].sort((a, b) => b.milesContributable - a.milesContributable);
    let remaining     = totalAwardCost;
    const breakdown   = [];
    for (const c of sorted) {
      if (remaining <= 0) break;
      const milesUsed     = Math.min(c.milesContributable, remaining);
      const cardPointsUsed = Math.ceil(milesUsed / c.ratio);
      breakdown.push({ ...c, milesUsed, cardPointsUsed });
      remaining -= milesUsed;
    }

    const cashValue     = lowestCashPrice || (totalAwardCost * program.cppEstimate / 100);
    const totalCardPts  = breakdown.reduce((s, b) => s + b.cardPointsUsed, 0);
    const centsPerPoint = cashValue > 0 && totalCardPts > 0
      ? (cashValue * 100) / totalCardPts
      : program.cppEstimate;

    const matchedCarriers = carriers.filter(c => matchCarrierToProgram(c.name, program));

    const breakdownSummary = breakdown
      .map(b => `${b.cardPointsUsed.toLocaleString()} pts from ${b.cardName} → ${b.milesUsed.toLocaleString()} miles`)
      .join(' + ');

    const cardNames = breakdown.map(b => b.cardName).join(' + ');

    options.push({
      type:            'multi_transfer',
      card:            cardNames,
      cardIds:         breakdown.map(b => b.cardId),
      program:         program.name,
      programId,
      alliance:        program.alliance || null,
      description:     `Pool ${contributors.map(c => c.currency).join(' + ')} → ${program.name}`,
      pointsNeeded:    totalAwardCost,
      cardPointsNeeded: totalCardPts,
      pointsAvailable: totalPooledMiles,
      pointsUsed:      Math.min(totalPooledMiles, totalAwardCost),
      cashNeeded:      0,
      centsPerPoint:   Math.round(centsPerPoint * 100) / 100,
      cashValue,
      canFullyCover,
      breakdown,
      breakdownSummary,
      howTo:           canFullyCover
        ? `Combine points from multiple cards into ${program.name}: ${breakdownSummary}`
        : `Almost there! You have ${totalPooledMiles.toLocaleString()} of the ${totalAwardCost.toLocaleString()} miles needed.`,
      bookingUrl:      program.bookingUrl || '#',
      sweetSpot:       centsPerPoint >= 2.0,
      note:            `Combined transfer from ${contributors.length} cards. ${program.note || ''}`.trim(),
      matchedCarriers: matchedCarriers.map(c => c.name),
      flightType:      matchedCarriers.length === 0 ? null
        : matchedCarriers.some(c => c.stops === 0) && matchedCarriers.some(c => c.stops > 0) ? 'Nonstop & Connecting'
        : matchedCarriers.some(c => c.stops === 0) ? 'Nonstop available'
        : 'Connecting only',
      bestDuration:    (() => { const ns = matchedCarriers.filter(c=>c.stops===0).map(c=>c.duration).filter(Boolean); return ns.length ? Math.min(...ns) : (matchedCarriers.map(c=>c.duration).filter(Boolean).length ? Math.min(...matchedCarriers.map(c=>c.duration).filter(Boolean)) : null); })(),
      airlines:        program.airlines,
      passengers,
      cabin:           cabinKey
    });
  });

  // ── Score & rank ────────────────────────────────────────────────────────────
  const scored = options.map(opt => {
    let score = 0;

    // 1. Cents per point (higher = better) — 35 pts
    const cppScore = Math.min((opt.centsPerPoint / 3.0), 1) * 35;
    score += cppScore;

    // 2. Can fully cover with available points — 30 pts
    if (opt.canFullyCover) score += 30;

    // 3. Zero extra cash needed — 20 pts
    score += opt.cashNeeded === 0 ? 20 : Math.max(0, 20 * (1 - opt.cashNeeded / (opt.cashValue || 1)));

    // 4. Fewest points used (efficiency vs cash value) — 15 pts
    const ptEfficiency = opt.cashValue > 0 && opt.pointsUsed > 0
      ? opt.cashValue / (opt.pointsUsed / 1000)
      : 0;
    score += Math.min(ptEfficiency / 10, 1) * 15;

    return { ...opt, score: Math.round(score) };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    lowestCashPrice,
    carriers,
    originZone,
    destZone,
    routeKey,
    options: scored,
    bestOption: scored[0] || null
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Fetch available credit cards list (for the UI dropdown)
app.get('/api/cards', (req, res) => {
  const list = Object.entries(creditCards).map(([id, c]) => ({
    id,
    name:     c.name,
    currency: c.currencyShort,
    color:    c.color
  }));
  res.json(list);
});

// Search flights
app.get('/api/flights', async (req, res) => {
  const { origin, destination, date, cabin, passengers = 1 } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'origin, destination and date are required' });
  }

  const cabinCodeMap = { economy: 1, premium_economy: 2, business: 3, first: 4 };
  const cabinCode    = cabinCodeMap[cabin] || 1;

  const url = `https://serpapi.com/search.json?engine=google_flights`
    + `&departure_id=${encodeURIComponent(origin)}`
    + `&arrival_id=${encodeURIComponent(destination)}`
    + `&outbound_date=${encodeURIComponent(date)}`
    + `&currency=USD&hl=en&type=2`
    + `&travel_class=${cabinCode}`
    + `&adults=${passengers}`
    + `&api_key=${SERP_API_KEY}`;

  try {
    const data = await httpsGet(url);
    if (data.error) return res.status(400).json({ error: data.error });
    const carriers = extractCarriers(data);
    const allFlights = [...(data.best_flights || []), ...(data.other_flights || [])];
    res.json({ carriers, flights: allFlights.slice(0, 8) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Main optimization endpoint
app.post('/api/optimize', async (req, res) => {
  const { cards, origin, destination, date, cabin = 'economy', passengers = 1 } = req.body;

  if (!cards?.length || !origin || !destination || !date) {
    return res.status(400).json({ error: 'cards, origin, destination and date are required' });
  }

  const cabinCodeMap = { economy: 1, premium_economy: 2, business: 3, first: 4 };
  const cabinCode    = cabinCodeMap[cabin] || 1;

  const url = `https://serpapi.com/search.json?engine=google_flights`
    + `&departure_id=${encodeURIComponent(origin)}`
    + `&arrival_id=${encodeURIComponent(destination)}`
    + `&outbound_date=${encodeURIComponent(date)}`
    + `&currency=USD&hl=en&type=2`
    + `&travel_class=${cabinCode}`
    + `&adults=${passengers}`
    + `&api_key=${SERP_API_KEY}`;

  try {
    const serpData = await httpsGet(url);
    if (serpData.error) return res.status(400).json({ error: serpData.error });

    const result = buildOptions({
      userCards:   cards,
      serpData,
      origin,
      destination,
      cabin,
      passengers:  Number(passengers)
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀  Credit Points Optimizer running at http://localhost:${PORT}\n`);
});
