/* Birdie Finder — shared app layer
 * Loads real repo data (data/courses.csv, data/all_discs.csv), renders the
 * global header/footer/cart drawer, and exposes helpers used by every page.
 */
(function () {
  'use strict';

  const BF = (window.BF = {});

  /* ---------- small utils ---------- */
  BF.fmt = (n) => Number(n).toLocaleString('en-US');
  BF.money = (n) => '$' + Number(n).toFixed(2);
  BF.qs = (k) => new URLSearchParams(location.search).get(k);
  BF.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Deterministic PRNG seeded from a string — gives each course/disc stable
  // "detail" data (holes, reviews, price) until real backend data exists.
  BF.seeded = function (str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 10000) / 10000;
    };
  };

  BF.haversineMi = function (lat1, lon1, lat2, lon2) {
    const R = 3958.8, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  BF.haversineFt = (a, b, c, d) => BF.haversineMi(a, b, c, d) * 5280;

  /* ---------- localStorage cache with TTL ---------- */
  function cacheGet(key, ttlMs) {
    try {
      const raw = JSON.parse(localStorage.getItem(key));
      if (!raw || !('v' in raw)) return null;
      if (ttlMs && Date.now() - raw.ts > ttlMs) return null;
      return raw.v;
    } catch (e) { return null; }
  }
  function cacheSet(key, v) {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v })); } catch (e) { /* quota */ }
    return v;
  }
  // fetch with a hard timeout so a slow third party never hangs a page
  async function fetchT(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 8000);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }

  /* ---------- location ----------
   * Precedence: manual override (sticky) → cached fix (30 min) → GPS → IP → default.
   * Every page shares one resolution, so we never prompt or re-query per page.
   */
  const LOC_KEY = 'bf_loc_v2', LOC_MANUAL = 'bf_loc_manual_v2', LOC_TTL = 30 * 60 * 1000;
  const DEFAULT_LOC = { lat: 42.2459, lng: -71.9087, label: 'Leicester, MA', source: 'default' };

  BF.LOC_SOURCE_TEXT = {
    gps: 'from your device',
    ip: 'estimated from your network',
    manual: 'you set this',
    default: 'default — set your location for real distances',
  };

  function gpsFix(fresh) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('geolocation unsupported'));
      // Browsers only expose geolocation on https:// or localhost.
      if (!window.isSecureContext) return reject(new Error('insecure context'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({
          lat: p.coords.latitude, lng: p.coords.longitude,
          accuracy: p.coords.accuracy, label: 'your location', source: 'gps',
        }),
        reject,
        { enableHighAccuracy: true, timeout: 12000, maximumAge: fresh ? 0 : 5 * 60 * 1000 }
      );
    });
  }

  async function ipFix() {
    const r = await fetchT('https://ipwho.is/', { cache: 'no-store' }, 6000);
    const j = await r.json();
    if (!j || j.success === false || typeof j.latitude !== 'number') throw new Error('ip lookup failed');
    return {
      lat: j.latitude, lng: j.longitude, source: 'ip', accuracy: 25000,
      label: [j.city, j.region_code || j.region].filter(Boolean).join(', ') || 'your area',
    };
  }

  // Turn a GPS fix into "Leicester, MA" rather than "your location".
  async function reverseLabel(lat, lng) {
    try {
      const r = await fetchT(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`, {}, 6000);
      const j = await r.json();
      const city = j.city || j.locality;
      const st = j.principalSubdivisionCode ? j.principalSubdivisionCode.split('-').pop() : j.principalSubdivision;
      return [city, st].filter(Boolean).join(', ') || null;
    } catch (e) { return null; }
  }

  async function resolveLocation(fresh) {
    if (!fresh) {
      const manual = cacheGet(LOC_MANUAL, 0);
      if (manual) return manual;
      const cached = cacheGet(LOC_KEY, LOC_TTL);
      if (cached) return cached;
    }
    let loc = null;
    try { loc = await gpsFix(fresh); } catch (e) { /* denied, insecure, or timed out */ }
    if (!loc) { try { loc = await ipFix(); } catch (e) { /* offline */ } }
    if (!loc) return { ...DEFAULT_LOC };
    if (loc.source === 'gps') loc.label = (await reverseLabel(loc.lat, loc.lng)) || 'your location';
    return cacheSet(LOC_KEY, loc);
  }

  let _locPromise = null;
  // Resolves to {lat,lng,label,source,accuracy?}. `source` is never a lie —
  // callers use it to tell the user how trustworthy the distances are.
  BF.getLocation = function (opts) {
    opts = opts || {};
    if (opts.fresh) _locPromise = null;
    if (!_locPromise) _locPromise = resolveLocation(!!opts.fresh);
    return _locPromise;
  };

  function announce(loc) {
    window.dispatchEvent(new CustomEvent('bf:location', { detail: loc }));
    return loc;
  }

  BF.setLocation = function (loc) {
    const v = { lat: Number(loc.lat), lng: Number(loc.lng), label: loc.label, source: 'manual' };
    cacheSet(LOC_MANUAL, v); cacheSet(LOC_KEY, v);
    _locPromise = Promise.resolve(v);
    return announce(v);
  };

  // Drop the manual pin and re-ask the device. Rejects nothing — worst case
  // you get the IP or default fix back, with `source` saying so.
  BF.useMyLocation = async function () {
    try { localStorage.removeItem(LOC_MANUAL); localStorage.removeItem(LOC_KEY); } catch (e) {}
    return announce(await BF.getLocation({ fresh: true }));
  };

  BF.isGeolocationBlocked = () => !navigator.geolocation || !window.isSecureContext;

  /* ---------- place search (ZIP / city) ----------
   * The course CSV already carries a city/state/ZIP for 7k US courses, so we
   * resolve against it first: instant, exact, works offline. Only fall through
   * to a geocoder for places with no course in them.
   */
  const STATE_ABBR = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC' };
  BF.stateAbbr = (s) => STATE_ABBR[String(s || '').trim().toLowerCase()] || String(s || '').trim();

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  BF.searchPlace = async function (text) {
    const q = String(text || '').trim();
    if (!q) return null;
    const courses = await BF.loadCourses();

    if (/^\d{5}$/.test(q)) {
      const hits = courses.filter((c) => c.zip === q);
      if (hits.length) return { lat: mean(hits.map((c) => c.lat)), lng: mean(hits.map((c) => c.lng)), label: `${hits[0].city}, ${BF.stateAbbr(hits[0].state)} ${q}` };
    }

    const [cityRaw, stRaw] = q.split(',').map((s) => s.trim());
    const city = cityRaw.toLowerCase();
    const st = (stRaw || '').toLowerCase();
    const hits = courses.filter((c) => {
      if (c.city.toLowerCase() !== city) return false;
      if (!st) return true;
      const full = c.state.toLowerCase();
      return full === st || BF.stateAbbr(c.state).toLowerCase() === st;
    });
    if (hits.length) return { lat: mean(hits.map((c) => c.lat)), lng: mean(hits.map((c) => c.lng)), label: `${hits[0].city}, ${BF.stateAbbr(hits[0].state)}` };

    try {
      const r = await fetchT(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityRaw)}&count=5&language=en&format=json`, {}, 6000);
      const j = await r.json();
      const res = j.results || [];
      const inState = st ? res.filter((x) => String(x.admin1 || '').toLowerCase().startsWith(st)) : [];
      const hit = inState[0] || res[0];
      if (hit) return { lat: hit.latitude, lng: hit.longitude, label: [hit.name, hit.admin1, hit.country_code].filter(Boolean).slice(0, 2).join(', ') };
    } catch (e) { /* offline */ }
    return null;
  };

  BF.toast = function (msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2200);
  };

  /* ---------- disc rendering (SVG stand-in until product photos exist) ---------- */
  const DISC_COLORS = ['#c2703d', '#2f5c3f', '#3a5a8c', '#7a3b52', '#a08a5f', '#6b8c5a'];
  BF.discColor = (d) => DISC_COLORS[(Number(d.id) || 0) % DISC_COLORS.length];
  BF.discSVG = function (d, size) {
    size = size || 130;
    const c = BF.discColor(d);
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${BF.esc(d.name)} disc">
      <circle cx="50" cy="50" r="48" fill="${c}"/>
      <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="14" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2"/>
      <text x="50" y="55" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="11" fill="rgba(255,255,255,.9)" font-weight="600">${BF.esc(String(d.speed))}</text>
    </svg>`;
  };

  /* ---------- CSV data layer ---------- */
  function parseCSV(text) {
    return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  }

  // Minimal built-in samples so pages still render if the CSVs aren't present
  // (e.g. the data files haven't been copied in yet, or fetch is blocked on file://).
  const SAMPLE_COURSES = [
    { id: 'maple-hill', name: 'Maple Hill', city: 'Leicester', state: 'Massachusetts', zip: '01524', holeCount: 18, rating: 4.8, latitude: 42.2459, longitude: -71.9087 },
    { id: 'idlewild', name: 'Idlewild', city: 'Burlington', state: 'Kentucky', zip: '41005', holeCount: 18, rating: 4.9, latitude: 39.0209, longitude: -84.7524 },
    { id: 'blue-ribbon-pines', name: 'Blue Ribbon Pines', city: 'East Bethel', state: 'Minnesota', zip: '55011', holeCount: 18, rating: 4.7, latitude: 45.3872, longitude: -93.2277 },
    { id: 'the-pyramids', name: 'The Pyramids', city: 'Kansas City', state: 'Missouri', zip: '64119', holeCount: 18, rating: 4.5, latitude: 39.1858, longitude: -94.5225 },
    { id: 'flip-city', name: 'Flip City', city: 'Shelby', state: 'Michigan', zip: '49455', holeCount: 24, rating: 4.9, latitude: 43.6389, longitude: -86.3273 },
    { id: 'milo-mciver', name: 'Milo McIver', city: 'Estacada', state: 'Oregon', zip: '97023', holeCount: 18, rating: 4.6, latitude: 45.3021, longitude: -122.3562 },
  ];
  const SAMPLE_DISCS = [
    { id: 214, name: 'Destroyer', manufacturer: 'Innova', primary_use: 'Distance Driver', stability: 2, speed: 12, glide: 5, turn: -1, fade: 3, diameter: 21.1, height: 1.4, rim_depth: 1.2, rim_thickness: 2.3, inside_rim_diameter: 16.5, rim_diameter_ratio: 5.7, rim_configuration: 28.25, bead: 'Beadless' },
    { id: 44, name: 'Buzzz', manufacturer: 'Discraft', primary_use: 'Midrange', stability: 0.5, speed: 5, glide: 4, turn: -1, fade: 1, diameter: 21.7, height: 1.9, rim_depth: 1.3, rim_thickness: 1.2, inside_rim_diameter: 19.2, rim_diameter_ratio: 5.7, rim_configuration: 49.75, bead: 'Beadless' },
    { id: 119, name: 'Judge', manufacturer: 'Dynamic Discs', primary_use: 'Putt & Approach', stability: 1, speed: 2, glide: 4, turn: 0, fade: 1, diameter: 21.2, height: 2.1, rim_depth: 1.5, rim_thickness: 1.0, inside_rim_diameter: 19.1, rim_diameter_ratio: 7.1, rim_configuration: 60, bead: 'Beaded' },
    { id: 412, name: 'Wave', manufacturer: 'MVP', primary_use: 'Distance Driver', stability: 0, speed: 11, glide: 5, turn: -2, fade: 2, diameter: 21.1, height: 1.6, rim_depth: 1.1, rim_thickness: 2.2, inside_rim_diameter: 16.7, rim_diameter_ratio: 5.2, rim_configuration: 28, bead: 'Beadless' },
    { id: 8, name: 'FD', manufacturer: 'Discmania', primary_use: 'Control Driver', stability: 0, speed: 7, glide: 6, turn: -1, fade: 1, diameter: 21.1, height: 1.9, rim_depth: 1.2, rim_thickness: 1.7, inside_rim_diameter: 17.6, rim_diameter_ratio: 5.7, rim_configuration: 34, bead: 'Beadless' },
    { id: 341, name: 'Ballista', manufacturer: 'Latitude 64', primary_use: 'Distance Driver', stability: 2, speed: 14, glide: 5, turn: 0, fade: 3, diameter: 21.2, height: 1.8, rim_depth: 1.1, rim_thickness: 2.5, inside_rim_diameter: 16.2, rim_diameter_ratio: 5.2, rim_configuration: 26, bead: 'Beadless' },
  ];

  let _courses = null, _discs = null;

  BF.loadCourses = async function () {
    if (_courses) return _courses;
    try {
      const txt = await fetch(BF.dataBase + 'courses.csv').then((r) => { if (!r.ok) throw 0; return r.text(); });
      _courses = parseCSV(txt);
    } catch (e) {
      console.warn('courses.csv not found — using built-in sample data');
      _courses = SAMPLE_COURSES;
    }
    _courses = _courses
      .map((r, i) => ({
        id: r.id || String(r.name || i).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: r.name || 'Unnamed course',
        city: (r.city || '').trim(),
        state: (r.state || '').trim(),
        zip: (r.zip || '').trim(),
        holes: Number(r.holeCount) || 18,
        rating: r.rating !== '' && r.rating != null ? Number(r.rating) : null,
        lat: Number(r.latitude),
        lng: Number(r.longitude),
      }))
      .filter((c) => !Number.isNaN(c.lat) && !Number.isNaN(c.lng));
    return _courses;
  };

  BF.loadDiscs = async function () {
    if (_discs) return _discs;
    try {
      const txt = await fetch(BF.dataBase + 'all_discs.csv').then((r) => { if (!r.ok) throw 0; return r.text(); });
      _discs = parseCSV(txt);
    } catch (e) {
      console.warn('all_discs.csv not found — using built-in sample data');
      _discs = SAMPLE_DISCS;
    }
    _discs = _discs.map((r) => {
      const d = {
        id: Number(r.id),
        name: r.name,
        manufacturer: r.manufacturer || '',
        primaryUse: r.primary_use || '',
        stability: r.stability !== '' && r.stability != null ? Number(r.stability) : null,
        speed: r.speed !== '' && r.speed != null ? Number(r.speed) : null,
        glide: r.glide !== '' && r.glide != null ? Number(r.glide) : null,
        turn: r.turn !== '' && r.turn != null ? Number(r.turn) : null,
        fade: r.fade !== '' && r.fade != null ? Number(r.fade) : null,
        diameter: Number(r.diameter), height: Number(r.height),
        rimDepth: Number(r.rim_depth), rimThickness: Number(r.rim_thickness),
        insideRimDiameter: Number(r.inside_rim_diameter),
        rimDiameterRatio: Number(r.rim_diameter_ratio),
        rimConfig: Number(r.rim_configuration),
        bead: r.bead || '',
      };
      // Deterministic prototype price ($11–$21 by speed) until commerce exists.
      d.price = 11 + Math.min(10, Math.round((d.speed || 2) * 0.7 + (Number(d.id) % 3)));
      d.stabilityLabel = d.stability == null ? '—' : d.stability <= -1 ? 'Understable' : d.stability >= 2 ? 'Overstable' : 'Stable';
      return d;
    }).filter((d) => d.name);
    return _discs;
  };

  /* ---------- derived course detail (deterministic per course id) ---------- */
  const TERRAINS = [['Wooded', 'Hilly'], ['Open / Field'], ['Wooded'], ['Pine forest'], ['Open / Field', 'Elevation'], ['Wooded', 'Elevation']];
  const AMENS = ['Restrooms', 'Parking', 'Dog OK', 'Pro shop', 'Camping', 'Water on course'];

  // Difficulty from geometry, not from a coin flip: average feet per hole is
  // the single strongest predictor of how a disc golf layout plays.
  BF.difficultyFor = function (length, holeCount) {
    const per = length / Math.max(1, holeCount);
    return per < 250 ? 'Beginner' : per < 310 ? 'Intermediate' : per < 375 ? 'Advanced' : 'Pro';
  };

  BF.courseDetail = function (c) {
    const rnd = BF.seeded(c.id);
    const holes = [];
    for (let i = 0; i < c.holes; i++) {
      // Real disc golf is overwhelmingly par 3 — an 18-hole course lands near
      // par 54–58, not the ~60 a flatter distribution produces.
      const par = rnd() < 0.86 ? 3 : rnd() < 0.97 ? 4 : 5;
      const dist = Math.round((par === 3 ? 220 + rnd() * 180 : par === 4 ? 420 + rnd() * 220 : 640 + rnd() * 260) / 5) * 5;
      const elev = Math.round((rnd() - 0.45) * 50);
      holes.push({ n: i + 1, par, dist, elev, diff: Math.round(25 + rnd() * 70) });
    }
    const par = holes.reduce((a, h) => a + h.par, 0);
    const length = holes.reduce((a, h) => a + h.dist, 0);
    const diff = BF.difficultyFor(length, holes.length);
    const rating = c.rating != null && c.rating > 0 ? Math.min(5, c.rating + 1.4).toFixed(1) : (3.9 + rnd()).toFixed(1);
    const reviews = 40 + Math.floor(rnd() * 300);
    const terrain = TERRAINS[Math.floor(rnd() * TERRAINS.length)];
    const amens = AMENS.filter(() => rnd() < 0.55).slice(0, 4);
    if (!amens.length) amens.push('Parking');
    const layouts = [
      { name: 'Blue', par: par },
      { name: 'White', par: Math.max(27, par - 3) },
      { name: 'Red', par: Math.max(27, par - 6) },
    ];
    return { holes, par, length, diff, rating, reviews, terrain, amens, layouts, source: 'estimated', coverage: 0,
      cats: { Design: 80 + rnd() * 18, Scenery: 78 + rnd() * 20, Upkeep: 75 + rnd() * 23, Signage: 70 + rnd() * 25, Amenities: 65 + rnd() * 28, 'Tee pads': 74 + rnd() * 24 } };
  };

  /* ---------- real course data from OpenStreetMap (Overpass) ----------
   * OSM tags disc golf holes as `disc_golf=hole` with `par` and `ref` (hole
   * number). Coverage is thin — a few thousand holes worldwide against the 7k
   * courses in our CSV — so this is strictly opportunistic: when OSM knows a
   * hole we show its real par, otherwise we keep the estimate and SAY SO.
   */
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const OSM_TTL = 7 * 24 * 3600 * 1000;   // pars don't churn
  const OSM_MISS_TTL = 24 * 3600 * 1000;  // don't re-ask all day for a course OSM doesn't have
  const OSM_RADIUS_M = 1000;
  const AMENITY_MAP = { toilets: 'Restrooms', parking: 'Parking', drinking_water: 'Water on course' };

  async function overpass(query) {
    let lastErr;
    for (const ep of OVERPASS) {
      try {
        const r = await fetchT(ep, { method: 'POST', body: new URLSearchParams({ data: query }) }, 15000);
        if (!r.ok) throw new Error('overpass ' + r.status);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // `Hole 6, Par 3, length 240',elevation 4'` — common free-text description tag.
  function parseDescription(desc) {
    if (!desc) return {};
    const len = /length\s*([\d,]+)\s*'/i.exec(desc);
    const elev = /elevation\s*(-?[\d.]+)\s*'/i.exec(desc);
    return {
      dist: len ? Number(len[1].replace(/,/g, '')) : undefined,
      elev: elev ? Math.round(Number(elev[1])) : undefined,
    };
  }

  BF.osmCourseData = async function (c, opts) {
    const key = 'bf_osm_' + c.id;
    if (!(opts && opts.fresh)) {
      const hit = cacheGet(key, OSM_TTL);
      if (hit) return hit;
      if (cacheGet(key + '_miss', OSM_MISS_TTL)) return null;
    }
    const q = `[out:json][timeout:25];
(nwr(around:${OSM_RADIUS_M},${c.lat},${c.lng})["disc_golf"="hole"];);out tags geom;
(nwr(around:${OSM_RADIUS_M},${c.lat},${c.lng})["amenity"~"^(toilets|parking|drinking_water)$"];);out tags center;`;

    let json;
    try { json = await overpass(q); } catch (e) { console.warn('Overpass unavailable:', e.message); return null; }

    const byRef = new Map();
    const amens = new Set();
    for (const el of json.elements || []) {
      const t = el.tags || {};
      if (t.amenity) { if (AMENITY_MAP[t.amenity]) amens.add(AMENITY_MAP[t.amenity]); continue; }
      if (t.disc_golf !== 'hole') continue;

      const geom = el.geometry || [];
      const anchor = geom[0] || (el.center ? { lat: el.center.lat, lon: el.center.lon } : (el.lat != null ? { lat: el.lat, lon: el.lon } : null));
      if (!anchor) continue;

      const n = /^\d+$/.test(t.ref || '') ? Number(t.ref) : null;
      if (!n || n > 36) continue;  // a stray ref shouldn't invent a 900-hole course

      const fromDesc = parseDescription(t.description);
      // Only take a distance OSM actually states. The drawn fairway is often a
      // partial centreline — measuring it gave 90 ft for a hole the mapper
      // described as 268 ft — so geometry locates the hole, it doesn't size it.
      const tagged = Number(t.dist || t.length);
      const dist = Number.isFinite(tagged) && tagged > 0 ? Math.round(tagged)
        : fromDesc.dist != null ? fromDesc.dist
        : null;

      const away = BF.haversineFt(c.lat, c.lng, anchor.lat, anchor.lon);
      const rec = {
        n,
        par: /^\d+$/.test(t.par || '') ? Number(t.par) : null,
        dist, elev: fromDesc.elev != null ? fromDesc.elev : null,
        _away: away, _lat: anchor.lat, _lon: anchor.lon,
      };

      const prev = byRef.get(n);
      if (!prev) { byRef.set(n, rec); continue; }
      // A hole number can repeat for two reasons. Mapped twice on the same
      // course (a basket node *and* a fairway way — only one carries `par`):
      // merge them. Or it belongs to a different nearby course: keep ours.
      const apart = BF.haversineFt(prev._lat, prev._lon, rec._lat, rec._lon);
      if (apart < 1300) {
        byRef.set(n, {
          n,
          par: prev.par != null ? prev.par : rec.par,
          dist: prev.dist != null ? prev.dist : rec.dist,
          elev: prev.elev != null ? prev.elev : rec.elev,
          _away: Math.min(prev._away, rec._away),
          _lat: prev._lat, _lon: prev._lon,
        });
      } else if (away < prev._away) {
        byRef.set(n, rec);
      }
    }

    const holes = [...byRef.values()].sort((a, b) => a.n - b.n).map(({ _away, _lat, _lon, ...h }) => h);
    if (!holes.length) { cacheSet(key + '_miss', 1); return null; }

    const withPar = holes.filter((h) => h.par != null).length;
    const data = {
      holes, amens: [...amens], withPar,
      coverage: Math.min(1, withPar / Math.max(1, c.holes)),
      attribution: '© OpenStreetMap contributors',
      fetchedAt: Date.now(),
    };
    return cacheSet(key, data);
  };

  /* ---------- course detail merged with whatever OSM actually knows ---------- */
  BF.courseDetailLive = async function (c) {
    let base = BF.courseDetail(c);
    let osm = null;
    try { osm = await BF.osmCourseData(c); } catch (e) { /* keep the estimate */ }
    if (!osm || !osm.holes.length) return base;

    // If OSM has surveyed hole 18 but the CSV claims 9, the CSV is stale —
    // grow the layout so real holes are never dropped off the end.
    const maxN = Math.max(c.holes, ...osm.holes.map((h) => h.n));
    if (maxN > c.holes) base = BF.courseDetail({ ...c, holes: maxN });

    const real = new Map(osm.holes.map((h) => [h.n, h]));
    const holes = base.holes.map((h) => {
      const r = real.get(h.n);
      if (!r) return h;
      return {
        ...h,
        par: r.par != null ? r.par : h.par,
        dist: r.dist != null ? r.dist : h.dist,
        elev: r.elev != null ? r.elev : h.elev,
        realPar: r.par != null,
        realDist: r.dist != null,
      };
    });

    const realPars = holes.filter((h) => h.realPar).length;
    if (!realPars) return { ...base, amens: osm.amens.length ? osm.amens : base.amens };

    const par = holes.reduce((a, h) => a + h.par, 0);
    const length = holes.reduce((a, h) => a + h.dist, 0);
    const coverage = realPars / holes.length;
    return {
      ...base, holes, par, length,
      diff: BF.difficultyFor(length, holes.length),
      // A course is only "real" if OSM knows every hole; anything less is a
      // blend, and the totals below are part estimate. Callers must show this.
      source: coverage >= 1 ? 'osm' : 'osm-partial',
      coverage, realPars,
      amens: osm.amens.length ? osm.amens : base.amens,
      attribution: osm.attribution,
    };
  };

  BF.sourceNote = function (d) {
    if (d.source === 'osm') return { text: 'Hole data from OpenStreetMap', tone: 'real' };
    if (d.source === 'osm-partial') return { text: `${d.realPars} of ${d.holes.length} holes from OpenStreetMap · rest estimated`, tone: 'mixed' };
    return { text: 'Estimated layout — no hole data mapped yet', tone: 'est' };
  };

  /* ---------- live conditions (Open-Meteo, no key) ---------- */
  const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };

  BF.weather = async function (lat, lng) {
    const key = `bf_wx_${lat.toFixed(2)}_${lng.toFixed(2)}`;
    const hit = cacheGet(key, 15 * 60 * 1000);
    if (hit) return hit;
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lng}`
      + '&current=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,weather_code'
      + '&daily=precipitation_sum&past_days=1&forecast_days=1'
      + '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto';
    let j;
    try {
      const r = await fetchT(url, {}, 8000);
      if (!r.ok) throw new Error('weather ' + r.status);
      j = await r.json();
    } catch (e) { console.warn('Weather unavailable:', e.message); return null; }

    const cur = j.current || {};
    const rain24 = (j.daily && j.daily.precipitation_sum ? j.daily.precipitation_sum[0] : 0) || 0;
    const wx = {
      tempF: Math.round(cur.temperature_2m),
      windMph: Math.round(cur.wind_speed_10m),
      gustMph: Math.round(cur.wind_gusts_10m),
      precipIn: cur.precipitation || 0,
      rain24In: rain24,
      sky: WMO[cur.weather_code] || '—',
      time: cur.time,
    };
    // Playing conditions, disc-golfer's version.
    if (wx.precipIn > 0.01) wx.condition = { label: 'Open · Wet — playing in rain', tone: 'warn' };
    else if (wx.windMph >= 15) wx.condition = { label: `Open · Windy ${wx.windMph} mph — expect flex lines`, tone: 'warn' };
    else if (rain24 > 0.4) wx.condition = { label: 'Open · Soft ground after rain', tone: 'warn' };
    else wx.condition = { label: 'Open · Good conditions', tone: 'good' };
    return cacheSet(key, wx);
  };

  /* ---------- producers / brands ---------- */
  BF.PRODUCERS = {
    'Innova': { founded: 1983, hq: 'Ontario, CA', molds: '300+', blurb: 'Founded in 1983, Innova produced the first disc specifically designed for disc golf. Today they make the sport\u2019s most iconic molds and sponsor many of its top touring pros.' },
    'Discraft': { founded: 1978, hq: 'Wixom, MI', molds: '80+', blurb: 'Discraft has been shaping flight since 1978 — home of the Buzzz, the Zone, and the pro rosters of Paul McBeth and Paige Pierce.' },
    'Dynamic Discs': { founded: 2005, hq: 'Emporia, KS', molds: '60+', blurb: 'Born from a college business plan in Emporia, Kansas, Dynamic Discs grew into one of the sport\u2019s biggest retailers and a full Trilogy manufacturer.' },
    'MVP': { founded: 2010, hq: 'Marlette, MI', molds: '70+', blurb: 'MVP Disc Sports pioneered GYRO® overmold technology — two-material discs engineered for stability and glide.' },
    'Discmania': { founded: 2006, hq: 'Espoo, Finland', molds: '90+', blurb: 'A Finnish brand with global reach, Discmania blends Scandinavian design with tour-proven molds thrown by Eagle McMahon and more.' },
    'Latitude 64': { founded: 2005, hq: 'Skellefteå, Sweden', molds: '75+', blurb: 'Made just below the Arctic Circle, Latitude 64 discs are famous for premium Gold Line plastic and glidey, workable flights.' },
    'Kastaplast': { founded: 2013, hq: 'Stockholm, Sweden', molds: '20+', blurb: 'A small Swedish shop with a cult following — the Berg and Kaxe prove that fewer, better molds is a winning formula.' },
    'Prodigy': { founded: 2013, hq: 'Sugar Hill, GA', molds: '60+', blurb: 'Prodigy Disc built its line on a lettered-and-numbered system so players can find the exact flight they need.' },
  };
  BF.producerFor = function (brand) {
    if (BF.PRODUCERS[brand]) return BF.PRODUCERS[brand];
    const rnd = BF.seeded(brand);
    return { founded: 1990 + Math.floor(rnd() * 30), hq: 'USA', molds: (5 + Math.floor(rnd() * 40)) + '+', blurb: brand + ' is an independent disc maker crafting molds for players who like flying off the beaten fairway.' };
  };

  /* ---------- cart (localStorage) ---------- */
  const CART_KEY = 'bf_cart_v1';
  BF.cart = {
    items() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { return []; } },
    save(items) { localStorage.setItem(CART_KEY, JSON.stringify(items)); BF.renderCart(); },
    add(item) {
      const items = this.items();
      const key = item.id + '|' + (item.plastic || '') + '|' + (item.color || '');
      const found = items.find((i) => i.key === key);
      if (found) found.qty += item.qty || 1;
      else items.push({ key, qty: item.qty || 1, ...item });
      this.save(items);
      BF.toast(item.name + ' added to bag');
    },
    remove(key) { this.save(this.items().filter((i) => i.key !== key)); },
    count() { return this.items().reduce((a, i) => a + i.qty, 0); },
    subtotal() { return this.items().reduce((a, i) => a + i.qty * i.price, 0); },
  };

  /* ---------- saved rounds (localStorage) ---------- */
  const ROUNDS_KEY = 'bf_rounds_v1';
  BF.rounds = {
    all() { try { return JSON.parse(localStorage.getItem(ROUNDS_KEY)) || []; } catch (e) { return []; } },
    save(round) { const r = this.all(); r.unshift(round); localStorage.setItem(ROUNDS_KEY, JSON.stringify(r.slice(0, 50))); },
  };

  /* ---------- global chrome ---------- */
  BF.renderHeader = function (active) {
    const links = [['index.html', 'home', 'Home'], ['courses.html', 'courses', 'Courses'], ['shop.html', 'shop', 'Shop'], ['players.html', 'players', 'Players'], ['events.html', 'events', 'Events']];
    const el = document.createElement('header');
    el.className = 'site-header';
    el.innerHTML =
      `<a class="wm" href="index.html"><span class="mark"><i></i></span>Birdie Finder</a>` +
      `<nav class="nav">${links.map(([h, k, t]) => `<a class="navlink${k === active ? ' on' : ''}" href="${h}">${t}</a>`).join('')}</nav>` +
      `<div class="navr"><span class="hsearch" onclick="location.href='courses.html'">⌕ &nbsp;Search…</span>` +
      `<button class="bagbtn" data-cart="open" aria-label="Open bag">⛢<span class="bagbadge" id="bf-bag-count">0</span></button>` +
      `<a class="av" href="players.html" title="Your profile">EW</a></div>`;
    document.body.prepend(el);
  };

  /* ---------- location bar ----------
   * Shows where distances are measured from, how we know, and lets the user
   * correct it. Pages listen for `bf:location` and re-render.
   */
  BF.renderLocationBar = function (mount) {
    const el = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!el) return;
    el.classList.add('locbar');

    const paint = (loc) => {
      const tone = loc.source === 'gps' || loc.source === 'manual' ? 'ok' : 'weak';
      const acc = loc.source === 'gps' && loc.accuracy ? ` · ±${Math.round(loc.accuracy)} m` : '';
      el.innerHTML =
        `<span class="loc-pin" aria-hidden="true">◎</span>` +
        `<span class="loc-main">Distances from <b>${BF.esc(loc.label)}</b></span>` +
        `<span class="loc-src ${tone}">${BF.esc(BF.LOC_SOURCE_TEXT[loc.source] || '')}${acc}</span>` +
        `<button class="loc-btn" data-loc="edit">Change</button>` +
        (loc.source === 'manual' || loc.source === 'default' || loc.source === 'ip'
          ? `<button class="loc-btn" data-loc="gps">Use my location</button>` : '') +
        `<form class="loc-form" hidden>
           <input type="search" name="q" placeholder="ZIP code or city, state" aria-label="ZIP code or city">
           <button class="btn-primary loc-go" type="submit">Go</button>
         </form>
         <span class="loc-msg" role="status"></span>`;

      if (BF.isGeolocationBlocked()) {
        const m = el.querySelector('.loc-msg');
        m.textContent = window.isSecureContext ? '' : 'Tip: serve over https:// or localhost to use GPS.';
      }
    };

    BF.getLocation().then(paint);
    window.addEventListener('bf:location', (e) => paint(e.detail));

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-loc]');
      if (!b) return;
      if (b.dataset.loc === 'edit') {
        const f = el.querySelector('.loc-form');
        f.hidden = !f.hidden;
        if (!f.hidden) f.querySelector('input').focus();
      } else if (b.dataset.loc === 'gps') {
        el.querySelector('.loc-msg').textContent = 'Locating…';
        const loc = await BF.useMyLocation();
        if (loc.source !== 'gps') BF.toast('Couldn’t get a GPS fix — using ' + loc.label);
      }
    });

    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = el.querySelector('.loc-form input').value;
      const msg = el.querySelector('.loc-msg');
      msg.textContent = 'Searching…';
      const place = await BF.searchPlace(q);
      if (!place) { msg.textContent = 'No match for “' + q + '”.'; return; }
      msg.textContent = '';
      BF.setLocation(place);
    });
  };

  BF.renderFooter = function () {
    const el = document.createElement('div');
    el.className = 'foot';
    el.innerHTML = `<a class="wm" href="index.html"><span class="mark"><i></i></span>Birdie Finder</a>
      <span><a href="courses.html">Courses</a> · <a href="shop.html">Shop</a> · <a href="players.html">Players</a> · <a href="events.html">Events</a> · <a href="login.html">Log in</a></span>
      <span>© 2026 Birdie Finder</span>`;
    document.body.appendChild(el);
  };

  BF.renderCart = function () {
    let drawer = document.querySelector('.cart');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.className = 'cart';
      drawer.innerHTML = `<div class="cart-scrim" data-cart="close"></div>
        <div class="cart-panel">
          <div class="cart-head"><span class="cart-title" id="bf-cart-title">Your bag</span><button class="cart-close" data-cart="close" aria-label="Close bag">✕</button></div>
          <div class="cart-body" id="bf-cart-body"></div>
          <div class="cart-foot" id="bf-cart-foot"></div>
        </div>`;
      document.body.appendChild(drawer);
    }
    const items = BF.cart.items();
    const n = BF.cart.count();
    const badge = document.getElementById('bf-bag-count');
    if (badge) badge.textContent = n;
    document.getElementById('bf-cart-title').textContent = 'Your bag · ' + n;
    const body = document.getElementById('bf-cart-body');
    if (!items.length) {
      body.innerHTML = `<div class="cart-empty">Your bag is empty.<br><br><a href="shop.html" class="a-more">Browse the shop →</a></div>`;
      document.getElementById('bf-cart-foot').innerHTML = '';
      return;
    }
    body.innerHTML = items.map((i) => `
      <div class="cart-item">
        <div class="cart-thumb" style="display:flex;align-items:center;justify-content:center">${BF.discSVG({ id: i.id, name: i.name, speed: i.speed ?? '' }, 60)}</div>
        <div><div class="cart-ibrand">${BF.esc(i.brand)}</div><div class="cart-iname">${BF.esc(i.name)}</div>
          <div class="cart-iopt">${BF.esc(i.plastic || 'Stock')} · ${BF.esc(i.color || 'Assorted')} · Qty ${i.qty}</div></div>
        <div class="cart-iprice">${BF.money(i.price * i.qty)}<br><button class="cart-remove" data-remove="${BF.esc(i.key)}">Remove</button></div>
      </div>`).join('');
    const sub = BF.cart.subtotal(), ship = 5.99;
    document.getElementById('bf-cart-foot').innerHTML = `
      <div class="cart-sub"><span>Subtotal</span><span>${BF.money(sub)}</span></div>
      <div class="cart-sub"><span>Shipping</span><span>${BF.money(ship)}</span></div>
      <div class="cart-total"><span>Total</span><span>${BF.money(sub + ship)}</span></div>
      <button class="btn-primary btn-block" onclick="BF.toast('Checkout is UI-only in this build — hook up Stripe per the Build Spec.')">Checkout</button>`;
  };

  /* ---------- global click wiring ---------- */
  document.addEventListener('click', (e) => {
    const cartBtn = e.target.closest('[data-cart]');
    if (cartBtn) {
      const d = document.querySelector('.cart');
      if (d) d.classList.toggle('open', cartBtn.dataset.cart === 'open');
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) BF.cart.remove(rm.dataset.remove);
  });

  /* ---------- boot ---------- */
  BF.init = function (opts) {
    opts = opts || {};
    BF.dataBase = opts.dataBase || 'data/';
    if (!opts.noChrome) {
      BF.renderHeader(opts.active || '');
      BF.renderCart();
    }
    if (opts.footer !== false && !opts.noChrome) {
      window.addEventListener('DOMContentLoaded', BF.renderFooter);
      if (document.readyState !== 'loading') BF.renderFooter();
    }
  };
})();
