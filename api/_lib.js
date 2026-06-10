// ─── Shared logic for all Vercel API functions ───────────────────────────────
// This file is imported by /api/optimize.js and /api/flights.js

const https        = require('https');
const creditCards  = require('../data/credit-cards.json');
const awardCharts  = require('../data/award-charts.json');
const airportZones = require('../data/airport-zones.json');

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse SerpAPI response')); }
      });
    }).on('error', reject);
  });
}

// ── Zone lookup ───────────────────────────────────────────────────────────────
function getZone(airportCode) {
  for (const [zone, codes] of Object.entries(airportZones)) {
    if (zone.startsWith('_')) continue;
    if (codes.includes(airportCode.toUpperCase())) return zone;
  }
  return null;
}

function findAwardEntry(program, zone1, zone2) {
  const awards = program.awards || {};
  return awards[`${zone1}-${zone2}`] || awards[`${zone2}-${zone1}`] || null;
}

// ── Extract carriers from SerpAPI response ────────────────────────────────────
function extractCarriers(serpData) {
  const carriers  = new Map();
  const allFlights = [
    ...(serpData.best_flights  || []),
    ...(serpData.other_flights || [])
  ];
  allFlights.forEach(option => {
    (option.flights || []).forEach(segment => {
      const name = segment.airline;
      if (!name) return;
      if (!carriers.has(name) || option.price < carriers.get(name).bestPrice) {
        carriers.set(name, {
          name,
          bestPrice: option.price || 0,
          logo:      segment.airline_logo || null,
          duration:  option.total_duration || 0,
          stops:     (option.layovers || []).length
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
           cn.split(' ')[0] === an.split(' ')[0];
  });
}

function bestDurationFor(matchedCarriers) {
  const ns = matchedCarriers.filter(c => c.stops === 0).map(c => c.duration).filter(Boolean);
  const all = matchedCarriers.map(c => c.duration).filter(Boolean);
  const pool = ns.length ? ns : all;
  return pool.length ? Math.min(...pool) : null;
}

function flightTypeFor(matchedCarriers) {
  if (!matchedCarriers.length) return null;
  const hasNonstop  = matchedCarriers.some(c => c.stops === 0);
  const hasLayover  = matchedCarriers.some(c => c.stops > 0);
  if (hasNonstop && hasLayover) return 'Nonstop & Connecting';
  if (hasNonstop) return 'Nonstop available';
  return 'Connecting only';
}

// ── Main optimization logic ───────────────────────────────────────────────────
function buildOptions({ userCards, serpData, cabin, passengers }) {
  const allFlights = [
    ...(serpData.best_flights  || []),
    ...(serpData.other_flights || [])
  ];
  const prices          = allFlights.map(f => f.price).filter(Boolean);
  const lowestCashPrice = prices.length ? Math.min(...prices) * passengers : null;
  const carriers        = extractCarriers(serpData);
  const options         = [];
  const seen            = new Set();

  userCards.forEach(userCard => {
    const cardDef    = creditCards[userCard.id];
    if (!cardDef) return;
    const userPoints = Number(userCard.points) || 0;
    if (userPoints <= 0) return;

    // ── Option A: Travel Portal ───────────────────────────────────────────────
    if (lowestCashPrice) {
      const cpp          = cardDef.portalValue;
      const pointsNeeded = Math.ceil((lowestCashPrice * 100) / cpp) * passengers;
      const pointsUsed   = Math.min(pointsNeeded, userPoints);
      const cashNeeded   = pointsNeeded > userPoints
        ? Math.ceil((pointsNeeded - userPoints) * cpp / 100) : 0;
      const actualCpp    = lowestCashPrice > 0 && pointsUsed > 0
        ? (lowestCashPrice * 100) / pointsUsed : cpp;

      options.push({
        type:            'portal',
        card:            cardDef.name,
        cardId:          userCard.id,
        program:         `${cardDef.name} Travel Portal`,
        pointsNeeded,
        pointsAvailable: userPoints,
        pointsUsed,
        cashNeeded,
        centsPerPoint:   Math.round(actualCpp * 100) / 100,
        cashValue:       lowestCashPrice,
        canFullyCover:   userPoints >= pointsNeeded,
        howTo:           `Log in to ${cardDef.name} → Travel portal → Search & pay with points at ${cpp}¢/pt`,
        bookingUrl:      '#',
        sweetSpot:       false,
        note:            `${cpp}¢ per point fixed rate. Simple but often not the best value.`,
        passengers,
        flightType:      flightTypeFor(carriers),
        bestDuration:    bestDurationFor(carriers.filter(c => c.stops === 0).length ? carriers.filter(c => c.stops === 0) : carriers)
      });
    }

    // ── Option B: Single-card transfer ───────────────────────────────────────
    Object.entries(cardDef.transferPartners || {}).forEach(([programId, transferInfo]) => {
      const key = `${userCard.id}::${programId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const program = awardCharts[programId];
      if (!program) return;

      // Look up award cost via zone chart
      const originZone = serpData._originZone;
      const destZone   = serpData._destZone;
      const awardEntry = (originZone && destZone) ? findAwardEntry(program, originZone, destZone) : null;
      const cabinKey   = cabin === 'premium_economy' ? 'business' : cabin;
      const costPerPax = awardEntry?.[cabinKey] || awardEntry?.['economy'];
      if (!costPerPax) return;

      const totalCost        = costPerPax * passengers;
      const ratio            = transferInfo.ratio || 1;
      const cardPointsNeeded = Math.ceil(totalCost / ratio);
      const canFullyCover    = userPoints >= cardPointsNeeded;
      const cashValue        = lowestCashPrice || (totalCost * program.cppEstimate / 100);
      const centsPerPoint    = cashValue > 0 ? (cashValue * 100) / totalCost : program.cppEstimate;
      const matched          = carriers.filter(c => matchCarrierToProgram(c.name, program));

      options.push({
        type:             'transfer',
        card:             cardDef.name,
        cardId:           userCard.id,
        program:          program.name,
        programId,
        alliance:         program.alliance || null,
        pointsNeeded:     totalCost,
        cardPointsNeeded,
        pointsAvailable:  userPoints,
        pointsUsed:       Math.min(cardPointsNeeded, userPoints),
        cashNeeded:       0,
        centsPerPoint:    Math.round(centsPerPoint * 100) / 100,
        cashValue,
        canFullyCover,
        transferRatio:    ratio,
        howTo: canFullyCover
          ? `Transfer ${cardPointsNeeded.toLocaleString()} pts from ${cardDef.name} → ${program.name} (${ratio}:1), then book ${cabinKey} award`
          : `Need ${cardPointsNeeded.toLocaleString()} pts — ${(cardPointsNeeded - userPoints).toLocaleString()} more needed.`,
        bookingUrl:       program.bookingUrl || '#',
        sweetSpot:        centsPerPoint >= 2.0,
        note:             program.note || null,
        matchedCarriers:  matched.map(c => c.name),
        flightType:       flightTypeFor(matched),
        bestDuration:     bestDurationFor(matched),
        airlines:         program.airlines,
        passengers,
        cabin:            cabinKey
      });
    });
  });

  // ── Option C: Multi-card pooling ─────────────────────────────────────────────
  const programContributors = {};
  userCards.forEach(userCard => {
    const cardDef    = creditCards[userCard.id];
    if (!cardDef) return;
    const userPoints = Number(userCard.points) || 0;
    if (userPoints <= 0) return;
    Object.entries(cardDef.transferPartners || {}).forEach(([programId, transferInfo]) => {
      if (!programContributors[programId]) programContributors[programId] = [];
      programContributors[programId].push({
        cardId:             userCard.id,
        cardName:           cardDef.name,
        currency:           cardDef.currencyShort,
        userPoints,
        ratio:              transferInfo.ratio || 1,
        milesContributable: Math.floor(userPoints * (transferInfo.ratio || 1))
      });
    });
  });

  Object.entries(programContributors).forEach(([programId, contributors]) => {
    if (contributors.length < 2) return;
    const program = awardCharts[programId];
    if (!program) return;

    const originZone = serpData._originZone;
    const destZone   = serpData._destZone;
    const awardEntry = (originZone && destZone) ? findAwardEntry(program, originZone, destZone) : null;
    const cabinKey   = cabin === 'premium_economy' ? 'business' : cabin;
    const costPerPax = awardEntry?.[cabinKey] || awardEntry?.['economy'];
    if (!costPerPax) return;

    const totalCost        = costPerPax * passengers;
    const totalPooled      = contributors.reduce((s, c) => s + c.milesContributable, 0);
    const canFullyCover    = totalPooled >= totalCost;
    const singleCanCover   = contributors.some(c => c.milesContributable >= totalCost);
    if (singleCanCover && canFullyCover) return; // single-card option already covers it
    if (!canFullyCover && totalPooled < totalCost * 0.85) return; // too far short

    const sorted    = [...contributors].sort((a, b) => b.milesContributable - a.milesContributable);
    let remaining   = totalCost;
    const breakdown = [];
    for (const c of sorted) {
      if (remaining <= 0) break;
      const milesUsed      = Math.min(c.milesContributable, remaining);
      const cardPointsUsed = Math.ceil(milesUsed / c.ratio);
      breakdown.push({ ...c, milesUsed, cardPointsUsed });
      remaining -= milesUsed;
    }

    const cashValue     = lowestCashPrice || (totalCost * program.cppEstimate / 100);
    const totalCardPts  = breakdown.reduce((s, b) => s + b.cardPointsUsed, 0);
    const centsPerPoint = cashValue > 0 && totalCardPts > 0
      ? (cashValue * 100) / totalCardPts : program.cppEstimate;
    const matched       = carriers.filter(c => matchCarrierToProgram(c.name, program));

    options.push({
      type:             'multi_transfer',
      card:             breakdown.map(b => b.cardName).join(' + '),
      cardIds:          breakdown.map(b => b.cardId),
      program:          program.name,
      programId,
      alliance:         program.alliance || null,
      pointsNeeded:     totalCost,
      cardPointsNeeded: totalCardPts,
      pointsAvailable:  totalPooled,
      pointsUsed:       Math.min(totalPooled, totalCost),
      cashNeeded:       0,
      centsPerPoint:    Math.round(centsPerPoint * 100) / 100,
      cashValue,
      canFullyCover,
      breakdown,
      howTo:            canFullyCover
        ? breakdown.map(b => `Transfer ${b.cardPointsUsed.toLocaleString()} pts from ${b.cardName} → ${program.name}`).join(', then ')
        : `Almost there — ${(totalCost - totalPooled).toLocaleString()} miles short combined.`,
      bookingUrl:       program.bookingUrl || '#',
      sweetSpot:        centsPerPoint >= 2.0,
      note:             `Combined transfer from ${contributors.length} cards. ${program.note || ''}`.trim(),
      matchedCarriers:  matched.map(c => c.name),
      flightType:       flightTypeFor(matched),
      bestDuration:     bestDurationFor(matched),
      airlines:         program.airlines,
      passengers,
      cabin:            cabinKey
    });
  });

  // ── Score & rank ─────────────────────────────────────────────────────────────
  const scored = options.map(opt => {
    let score = 0;
    score += Math.min((opt.centsPerPoint / 3.0), 1) * 35;
    if (opt.canFullyCover) score += 30;
    score += opt.cashNeeded === 0 ? 20 : Math.max(0, 20 * (1 - opt.cashNeeded / (opt.cashValue || 1)));
    const eff = opt.cashValue > 0 && opt.pointsUsed > 0 ? opt.cashValue / (opt.pointsUsed / 1000) : 0;
    score += Math.min(eff / 10, 1) * 15;
    return { ...opt, score: Math.round(score) };
  });

  scored.sort((a, b) => b.score - a.score);
  return { options: scored, bestOption: scored[0] || null };
}

module.exports = { httpsGet, extractCarriers, getZone, buildOptions, creditCards };
