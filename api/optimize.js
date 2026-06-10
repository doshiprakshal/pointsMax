// POST /api/optimize
// Body: { cards, origin, destination, date, cabin, passengers, serpApiKey }
//
// serpApiKey comes from the user's own SerpAPI account (stored in their browser).
// It is used only for this one request and never stored on the server.

const { httpsGet, extractCarriers, getZone, buildOptions } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { cards, origin, destination, date, cabin = 'economy', passengers = 1, serpApiKey } = req.body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!cards?.length)   return res.status(400).json({ error: 'At least one card is required.' });
  if (!origin)          return res.status(400).json({ error: 'Origin airport is required.' });
  if (!destination)     return res.status(400).json({ error: 'Destination airport is required.' });
  if (!date)            return res.status(400).json({ error: 'Travel date is required.' });
  if (!serpApiKey)      return res.status(400).json({ error: 'SerpAPI key is required. Please add your free key in Settings.' });

  // ── Fetch live flights from SerpAPI (using the user's own key) ────────────
  const cabinCodeMap = { economy: 1, premium_economy: 2, business: 3, first: 4 };
  const url = `https://serpapi.com/search.json?engine=google_flights`
    + `&departure_id=${encodeURIComponent(origin)}`
    + `&arrival_id=${encodeURIComponent(destination)}`
    + `&outbound_date=${encodeURIComponent(date)}`
    + `&currency=USD&hl=en&type=2`
    + `&travel_class=${cabinCodeMap[cabin] || 1}`
    + `&adults=${passengers}`
    + `&api_key=${serpApiKey}`;        // ← user's own key, not ours

  let serpData;
  try {
    serpData = await httpsGet(url);
    if (serpData.error) return res.status(400).json({ error: `SerpAPI: ${serpData.error}` });
  } catch (err) {
    return res.status(500).json({ error: `Flight search failed: ${err.message}` });
  }

  // Attach zone info so buildOptions can use it without re-computing
  serpData._originZone = getZone(origin);
  serpData._destZone   = getZone(destination);

  const allFlights    = [...(serpData.best_flights || []), ...(serpData.other_flights || [])];
  const prices        = allFlights.map(f => f.price).filter(Boolean);
  const lowestCashPrice = prices.length ? Math.min(...prices) : null;
  const carriers      = extractCarriers(serpData);

  const result = buildOptions({ userCards: cards, serpData, cabin, passengers });

  res.json({
    ...result,
    lowestCashPrice,
    carriers,
    originZone: serpData._originZone,
    destZone:   serpData._destZone
  });
};
