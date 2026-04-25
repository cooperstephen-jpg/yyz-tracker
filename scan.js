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

async function fetchCalendarPrice(route, month) {
  const params = new URLSearchParams({
    engine:         'google_flights',
    departure_id:   route.from,
    arrival_id:     route.to,
    outbound_date:  month.outbound,
    return_date:    month.return,
    currency:       'CAD',
    hl:             'en',
    api_key:        SERPAPI_KEY
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
        const price = await fetchCalendarPrice(route, month);
        if (price) {
          if (!log[route.id][month.label]) log[route.id][month.label] = [];
          log[route.id][month.label].push({ date: today, price });
          // Keep last 20 readings per month
          if (log[route.id][month.label].length > 20) {
            log[route.id][month.label].shift();
          }
          console.log(`  ${route.name} · ${month.label}: $${price} CAD`);
        } else {
          console.log(`  ${route.name} · ${month.label}: no price found`);
        }
      } catch(e) {
        console.log(`  ${route.name} · ${month.label}: error — ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  fs.writeFileSync('price-log.json', JSON.stringify(log, null, 2));
  console.log(`\nDone. Scan complete — ${today}`);
}

main();
