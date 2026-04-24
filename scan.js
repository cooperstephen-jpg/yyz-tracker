const fetch = require('node-fetch');
const fs = require('fs');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

const WATCHLIST = [
  { id: 'yyz-tpe', from: 'YYZ', to: 'TPE', name: 'Toronto → Taipei' },
  { id: 'yyz-tyo', from: 'YYZ', to: 'TYO', name: 'Toronto → Tokyo' },
  { id: 'yyz-kix', from: 'YYZ', to: 'KIX', name: 'Toronto → Osaka' },
  { id: 'yyz-yvr', from: 'YYZ', to: 'YVR', name: 'Toronto → Vancouver' },
  { id: 'yyz-sea', from: 'YYZ', to: 'SEA', name: 'Toronto → Seattle' },
  { id: 'buf-sea', from: 'BUF', to: 'SEA', name: 'Buffalo → Seattle' },
];

function getDate(offsetMonths) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().split('T')[0];
}

async function fetchPrice(route) {
  const params = new URLSearchParams({
    engine:        'google_flights',
    departure_id:  route.from,
    arrival_id:    route.to,
    outbound_date: getDate(1),
    return_date:   getDate(2),
    currency:      'CAD',
    hl:            'en',
    api_key:       SERPAPI_KEY
  });

  const res  = await fetch(`https://serpapi.com/search.json?${params}`);
  const data = await res.json();

  if (data.error) throw new Error(data.error);

  const flights = [...(data.best_flights || []), ...(data.other_flights || [])];
  let lowest = null;
  for (const f of flights) {
    if (f.price && (!lowest || f.price < lowest)) lowest = f.price;
  }
  if (data.price_insights?.lowest_price) {
    const pi = data.price_insights.lowest_price;
    if (!lowest || pi < lowest) lowest = pi;
  }
  return lowest;
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  let log = {};

  if (fs.existsSync('price-log.json')) {
    log = JSON.parse(fs.readFileSync('price-log.json', 'utf8'));
  }

  console.log(`Scanning ${WATCHLIST.length} routes — ${today}`);

  for (const route of WATCHLIST) {
    try {
      const price = await fetchPrice(route);
      if (price) {
        if (!log[route.id]) log[route.id] = [];
        // Don't double-log same day
        const last = log[route.id][log[route.id].length - 1];
        if (last && last.date === today) {
          last.price = price;
        } else {
          log[route.id].push({ date: today, price });
        }
        // Keep last 90 days
        if (log[route.id].length > 90) log[route.id].shift();
        console.log(`  ${route.name}: $${price} CAD`);
      } else {
        console.log(`  ${route.name}: no price found`);
      }
    } catch(e) {
      console.log(`  ${route.name}: error — ${e.message}`);
    }

    // Pause between requests
    await new Promise(r => setTimeout(r, 800));
  }

  fs.writeFileSync('price-log.json', JSON.stringify(log, null, 2));
  console.log('Price log saved.');
}

main();
