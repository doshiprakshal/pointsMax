# ✦ PointsMax

**Stop leaving thousands of dollars of travel on the table.**

Most people redeem credit card points through their card's travel portal and get 1¢ per point. PointsMax finds the transfers, sweet spots, and multi-card combinations that can get you **3–6¢ per point** — on the exact same flights.

🔗 **Live site:** [pointsmax.vercel.app](https://pointsmax.vercel.app) *(update once deployed)*

---

## What is PointsMax?

PointsMax is a free, browser-based tool that helps you get the maximum value out of your credit card reward points when booking flights.

It solves a real problem: most people don't know that transferring points to an airline loyalty program — instead of booking through the card's portal — can double or triple the value of their points. And even fewer know that two cards can be combined into a single loyalty program to cover flights that neither card could afford alone.

PointsMax compares every available redemption option and ranks them by real value, then gives you step-by-step instructions on exactly how to book.

---

## Features

### 🔀 Multi-Card Pooling
Have a Chase Sapphire Reserve and an Amex Platinum? PointsMax finds loyalty programs that accept transfers from **both cards simultaneously** — so your combined points cover premium seats that no single card could fund alone.

### ⚖️ Portal vs. Transfer — All Options Compared
Every search surfaces three types of redemption options side-by-side:
- **Card Travel Portal** — simple fixed-rate redemption
- **Loyalty Transfer** — transfer points to an airline program and book an award ticket
- **Multi-Card Pool** — combine points from multiple cards into one program

### 💎 Sweet Spot Detection
Some programs offer outsized value on specific routes (e.g. Business Class to Europe for 34,000 Avios). PointsMax automatically flags these so you never miss a high-value redemption.

### ✈️ Live Flight Data
Searches are powered by real-time Google Flights data via SerpAPI. You see actual carriers, nonstop vs. connecting options, flight durations, and cash prices — not guesses or cached data.

### 📋 Step-by-Step Booking Guide
Every result includes exact instructions: which card to transfer from, how many points, what ratio, which website to book on, and what award availability to look for.

### 🔗 Flight Duration Per Option
Each redemption option shows the best flight duration for matched carriers — so you can weigh value against travel time.

### 🔒 Private by Design
No account required. No sign-up. Your card data and points balance are never stored or sent to any server — everything lives in your browser session only.

---

## How to Use

### Step 1 — Add Your API Key
PointsMax uses your own free [SerpAPI](https://serpapi.com) key to search live flights. When you first visit the site, a setup modal will appear:

1. Go to [serpapi.com/users/sign_up](https://serpapi.com/users/sign_up) and create a free account
2. Copy your API key from the dashboard
3. Paste it into the modal and click **Save Key**

Your key is saved in your browser's `localStorage` — it is never transmitted to any server.  
Free tier: **100 searches/month**.

### Step 2 — Enter Your Cards & Points
Select each credit card you own from the dropdown and enter your current point balance. You can add multiple cards. Supported cards include:

- Chase Sapphire Reserve / Preferred
- Amex Platinum / Gold
- Citi Premier
- Capital One Venture X
- Delta SkyMiles Gold
- United Explorer
- Southwest Rapid Rewards
- British Airways Visa Signature
- *(more added regularly)*

### Step 3 — Enter Your Flight Details
- **Origin & Destination** — IATA airport codes (e.g. `JFK`, `LHR`)
- **Departure Date**
- **Cabin Class** — Economy, Premium Economy, Business, First Class
- **Passengers**

### Step 4 — Get Ranked Results
Click **Find Best Redemption**. Within seconds you'll see:

- All available redemption options ranked by value (cents per point)
- Each card shows: points needed, points you have, award miles, extra cash required, flight duration, airlines covered, and nonstop/connecting status
- A **🏆 Best Value** badge on the top-ranked option
- A **💎 Sweet Spot** badge on high-value transfers (≥ 2¢/pt)
- A **🔗 Multi-Card Pool** badge when combining cards beats using either alone

### Step 5 — Click "How to Book"
Every result has a **How to Book →** button that opens a step-by-step drawer with exact instructions tailored to that specific option — including transfer links and what to search for on the airline's award site.

---

## Scoring Logic

Each option is scored out of 100 across four factors:

| Factor | Weight | Description |
|---|---|---|
| Cents per point | 35% | Higher value per point = higher score |
| Can fully cover | 30% | Whether your current points fully cover the trip |
| Zero extra cash | 20% | Prefer options that need no out-of-pocket spend |
| Point efficiency | 15% | Fewer points used relative to trip value |

---

## Loyalty Programs Covered

| Program | Alliance | Cards That Transfer |
|---|---|---|
| United MileagePlus | Star Alliance | Chase |
| British Airways Avios | Oneworld | Chase, Amex, Capital One |
| Air France/KLM Flying Blue | SkyTeam | Chase, Amex, Citi, Capital One |
| Singapore KrisFlyer | Star Alliance | Chase, Amex, Citi, Capital One |
| Air Canada Aeroplan | Star Alliance | Chase, Amex, Citi, Capital One |
| Virgin Atlantic Flying Club | SkyTeam (partial) | Chase, Amex, Citi, Capital One |
| Iberia Plus (Avios) | Oneworld | Chase, Amex, Capital One |
| Turkish Miles&Smiles | Star Alliance | Citi, Capital One |
| Emirates Skywards | Independent | Amex, Capital One |
| ANA Mileage Club | Star Alliance | Amex |
| Cathay Pacific Asia Miles | Oneworld | Amex, Citi |
| Delta SkyMiles | SkyTeam | Amex |
| Southwest Rapid Rewards | Independent | Chase |
| JetBlue TrueBlue | Independent | Amex, Citi |
| Avianca LifeMiles | Star Alliance | Citi, Capital One |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Backend | Node.js + Express (Vercel Serverless Functions) |
| Flight Data | SerpAPI — Google Flights engine |
| Award Data | Public airline award charts (JSON) |
| Hosting | Vercel (free tier) |
| Auth | None — no accounts, no sign-up |

---

## Project Structure

```
pointsMax/
├── api/
│   ├── _lib.js              # Shared optimization logic (award charts, scoring, pooling)
│   ├── cards.js             # GET /api/cards — returns supported card list
│   └── optimize.js          # POST /api/optimize — main optimization endpoint
├── data/
│   ├── credit-cards.json    # Card definitions, transfer partners, portal values
│   ├── award-charts.json    # Airline award charts by zone and cabin
│   └── airport-zones.json   # IATA airport → geographic zone mapping
├── public/
│   ├── index.html           # Landing page + app UI
│   ├── style.css            # All styles
│   └── app.js               # Frontend logic
├── server.js                # Express server (local dev)
├── vercel.json              # Vercel deployment config
└── package.json
```

---

## Running Locally

```bash
# Clone the repo
git clone https://github.com/doshiprakshal/pointsMax.git
cd pointsMax

# Install dependencies
npm install

# Start the server
npm start

# Open in browser
open http://localhost:3000
```

You'll need a free [SerpAPI key](https://serpapi.com) to run live flight searches. Enter it via the ⚙ API Key button when the app loads.

---

## Future Scope

### 🏨 Hotel Optimizer
Extend the same logic to hotel loyalty programs — Marriott Bonvoy, Hilton Honors, Hyatt, IHG. Enter your destination and dates, compare cash vs. points redemptions across all your cards' hotel transfer partners.

### 🗓️ Multi-City & Round-Trip
Currently supports one-way searches. Future versions will handle round-trip itineraries and multi-city routing — comparing open-jaw and stopover award options.

### 📅 Flexible Date Search
Show the best award value across a date range (e.g. ±3 days) so users can find the cheapest award window for their trip.

### 🔔 Award Availability Alerts
Notify users when award space opens up on specific routes — especially useful for premium cabin seats that are released close to departure.

### 💳 Expanded Card Support
Add more credit cards including regional and co-branded cards (e.g. Alaska Airlines Visa, Marriott Bonvoy Boundless, Hilton Honors Amex Surpass).

### 📊 Points Portfolio Dashboard
A summary view showing all your cards, total points value at portal rate vs. best transfer rate, and suggestions for which cards to prioritize spending on based on your travel goals.

### 🤝 Transfer Bonus Tracker
Surface active transfer bonus promotions (e.g. "Transfer Chase → Virgin Atlantic now and get 30% bonus miles") so users can time their transfers strategically.

### 🌍 International Card Support
Extend beyond US credit cards to support UK, Canada, Australia, and EU loyalty programs (e.g. Amex UK, HSBC, Scotiabank Passport).

---

## Contributing

Pull requests are welcome. If you'd like to add a new credit card, loyalty program, or airport zone, please update the relevant JSON file in `/data` and open a PR.

---

## License

MIT — free to use, modify, and distribute.
