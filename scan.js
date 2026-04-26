const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

const WATCHLIST = [
  { id: 'yyz-tpe', from: 'YYZ', to: 'TPE', name: 'Toronto → Taipei' },
  { id: 'yyz-nrt', from: 'YYZ', to: 'NRT', name: 'Toronto → Tokyo (Narita)' },
  { id: 'yyz-kix', from: 'YYZ', to: 'KIX', name: 'Toronto → Osaka' },
  { id: 'yyz-yvr', from: 'YYZ', to: 'YVR', name: 'Toronto → Vancouver' },
  { id: 'yyz-sea', from: 'YYZ', to: 'SEA', name: 'Toronto → Seattle' },
  { id: 'buf-sea', from: 'BUF', to: 'SEA', name: 'Buffalo → Seattle' },
];

// Rolling 6-month window, skipping current month
function getMonthsToScan() {
  const months = [];
  const now = new Date();
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      outbound: d.toISOString().split('T')[0],
      return:   new Date(d.getFullYear(), d.getMonth(), 15).toISOString().split('T')[0],
      label:    d.toLocaleString('en-CA', { month: 'long', year: 'numeric' })
    });
  }
  return months;
}

// Try calendar view first, fall back to regular search
async function fetchCalendarPrices(route, month) {
  // First try: Google Flights calendar view (returns daily prices)
  const calParams = new URLSearchParams({
    engine:         'google_flights',
    departure_id:   route.from,
    arrival_id:     route.to,
    outbound_date:  month.outbound,
    return_date:    month.return,
    currency:       'CAD',
    hl:             'en',
    type:           '1',  // round trip
    show_hidden:    'true',
    api_key:        SERPAPI_KEY
  });

  const res  = await fetch(`https://serpapi.com/search.json?${calParams}`);
  const data = await res.json();

  if (data.error) throw new Error(data.error);

  // Try to extract calendar/date grid prices if available
  let dailyPrices = [];

  // Check for price_insights calendar data
  if (data.price_insights?.price_history) {
    dailyPrices = data.price_insights.price_history.map(([date, price]) => ({ date, price }));
  }

  // Check for calendar_mode data
  if (!dailyPrices.length && data.calendar_mode) {
    data.calendar_mode.forEach(entry => {
      if (entry.date && entry.price) dailyPrices.push({ date: entry.date, price: entry.price });
    });
  }

  // Fall back to best/other flights — extract lowest + date
  if (!dailyPrices.length) {
    const flights = [...(data.best_flights || []), ...(data.other_flights || [])];
    flights.forEach(f => {
      if (f.price && f.flights?.[0]?.departure_airport?.time) {
        const dateStr = f.flights[0].departure_airport.time.split(' ')[0];
        dailyPrices.push({ date: dateStr, price: f.price });
      } else if (f.price) {
        // No date available — store with month start date
        dailyPrices.push({ date: month.outbound, price: f.price });
      }
    });
  }

  // Also check price_insights lowest
  if (data.price_insights?.lowest_price && !dailyPrices.length) {
    dailyPrices.push({ date: month.outbound, price: data.price_insights.lowest_price });
  }

  return dailyPrices;
}

async function main() {
  const today  = new Date().toISOString().split('T')[0];
  const months = getMonthsToScan();
  let log = {};

  if (fs.existsSync('price-log.json')) {
    log = JSON.parse(fs.readFileSync('price-log.json', 'utf8'));
  }

  console.log(`Scanning ${WATCHLIST.length} routes × ${months.length} months — ${today}`);

  for (const route of WATCHLIST) {
    if (!log[route.id]) log[route.id] = {};

    for (const month of months) {
      try {
        const dailyPrices = await fetchCalendarPrices(route, month);

        if (dailyPrices.length) {
          // Find cheapest day this scan
          const cheapest = dailyPrices.reduce((a, b) => a.price <= b.price ? a : b);
          const avg      = Math.round(dailyPrices.reduce((a, b) => a + b.price, 0) / dailyPrices.length);

          if (!log[route.id][month.label]) {
            log[route.id][month.label] = [];
          }

          // Each scan entry now stores: scan date, cheapest price + its date, scan average
          log[route.id][month.label].push({
            scanDate:      today,
            latestPrice:   cheapest.price,
            cheapestDate:  cheapest.date,
            scanAvg:       avg,
            dataPoints:    dailyPrices.length
          });

          // Keep last 20 scans per month
          if (log[route.id][month.label].length > 20) {
            log[route.id][month.label].shift();
          }

          console.log(`  ${route.name} · ${month.label}: $${cheapest.price} (cheapest day: ${cheapest.date}, scan avg: $${avg}, ${dailyPrices.length} prices)`);
        } else {
          console.log(`  ${route.name} · ${month.label}: no price data returned`);
        }
      } catch(e) {
        console.log(`  ${route.name} · ${month.label}: error — ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }
  }

  fs.writeFileSync('price-log.json', JSON.stringify(log, null, 2));
  console.log(`\nDone — ${today}`);
}

main();
