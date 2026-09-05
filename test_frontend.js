// ============================================================
//  test_frontend.js — ทดสอบ logic ฝั่งหน้าเว็บ (app.js) โดยไม่ต้องเปิดเบราว์เซอร์
//  จำลอง DOM / Leaflet / Chart.js / fetch แบบง่ายๆ แล้วโหลด app.js เข้า sandbox
//
//  รัน:  node test_frontend.js
//  เน้นตรวจ 3 เรื่องที่เพิ่งแก้:
//    1) API ล่ม → ต้องขึ้น "ไม่มีข้อมูล" ไม่ใช่สุ่มตัวเลขอุณหภูมิปลอม
//    2) API พลาดชั่วคราว → ต้อง retry แล้วผ่าน
//    3) โหลดทุกเกาะขนานกัน ไม่ใช่ทีละเกาะ
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// ---------- DOM stub ----------
function makeEl(id = '') {
  const el = {
    id,
    style: { cssText: '', display: '' },
    dataset: {},
    children: [],
    textContent: '',
    innerHTML: '',
    title: '',
    className: '',
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    after() {},
    before() {},
    addEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    getContext() { return {}; },
    focus() {},
    setAttribute() {},
  };
  return el;
}

const elements = new Map();
const document = {
  head: makeEl('head'),
  body: makeEl('body'),
  createElement: () => makeEl(),
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener() {},
};

// ---------- Leaflet stub ----------
const leafletMarker = () => ({
  addTo() { return this; },
  bindPopup() { return this; },
  setStyle() { return this; },
  setPopupContent() { return this; },
  openPopup() { return this; },
  on() { return this; },
});
// เก็บ tile layer ที่ถูกสร้างไว้ ให้เทสยิง event 'tileerror' จำลอง basemap ล่มได้
let tileLayers = [];
const makeTileLayer = (url, options) => {
  const handlers = {};
  const layer = {
    url, options, removed: false,
    addTo() { return this; },
    on(evt, fn) { (handlers[evt] ||= []).push(fn); return this; },
    off(evt) { delete handlers[evt]; return this; },
    fire(evt) { (handlers[evt] || []).forEach(fn => fn()); },
  };
  tileLayers.push(layer);
  return layer;
};

// layer แบบ vector (MapLibre) — เก็บ handler 'error' ของ maplibre map ข้างในไว้ให้เทสยิงได้
const makeGLLayer = (opts) => {
  const glHandlers = {};
  const glMap = {
    on(evt, fn) { (glHandlers[evt] ||= []).push(fn); return this; },
    fire(evt) { (glHandlers[evt] || []).forEach(fn => fn()); },
  };
  const layer = {
    styleUrl: opts.style, options: opts, isVector: true, removed: false,
    addTo() { return this; },
    getMaplibreMap() { return glMap; },
    fireGlError() { glMap.fire('error'); },
  };
  tileLayers.push(layer);
  return layer;
};

const attributions = new Set();

const L = {
  map: () => ({
    setView() { return this; },
    on() { return this; },
    addLayer() { return this; },
    removeLayer(l) { if (l) l.removed = true; return this; },
    setMaxZoom() { return this; },
    attributionControl: {
      addAttribution(a) { attributions.add(a); },
      removeAttribution(a) { attributions.delete(a); },
    },
  }),
  tileLayer: makeTileLayer,
  maplibreGL: makeGLLayer,
  circleMarker: leafletMarker,
  marker: leafletMarker,
  control: { layers: () => ({ addTo() {} }) },
};

// ---------- ตัวนับสถานะการทดสอบ ----------
let fetchLog = [];
let inFlight = 0;
let maxConcurrent = 0;

function makeSandbox(fetchImpl) {
  const sandbox = {
    document, L,
    Chart: function () { return { destroy() {} }; },
    console: { log() {}, warn() {}, error() {} },   // เงียบไว้ ไม่ให้ log รก
    setTimeout, clearTimeout,
    // startLiveClock() ตั้ง setInterval ทุก 1 วิ ถ้าปล่อยจริงจะค้าง process ไม่ยอมจบ
    // นาฬิกาไม่เกี่ยวกับสิ่งที่ทดสอบ จึงทำให้เป็น no-op
    setInterval: () => 0,
    clearInterval: () => {},
    Math, Date, JSON, Number, Array, Object, String, Promise, Error, isNaN,
    AbortController,
    // MapLibre โหลดจาก CDN ในหน้าเว็บจริง — จำลองว่ามีให้ครบ
    // (มีเทสแยกที่ลบตัวนี้ออกเพื่อดูว่าโค้ดข้ามไป raster ได้จริงไหม)
    maplibregl: fetchImpl.__noMapLibre ? undefined : {},
    async fetch(url, opts) {
      fetchLog.push(url);
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      try {
        return await fetchImpl(url, opts);
      } finally {
        inFlight--;
      }
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox);
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const bad = (status) => ({ ok: false, status, json: async () => ({}) });

function marineBody() {
  const temps = Array.from({ length: 336 }, (_, i) => 29 + Math.sin(i / 24) * 0.5);
  const times = Array.from({ length: 336 }, (_, i) => {
    const d = new Date('2026-09-05T00:00:00Z');
    d.setUTCHours(d.getUTCHours() + i);
    return d.toISOString().slice(0, 16);
  });
  return { hourly: { sea_surface_temperature: temps, time: times } };
}
const uvBody = () => ({ hourly: { uv_index: [7.5] } });
const dhwBody = (v) => ({
  table: {
    columnNames: ['time', 'latitude', 'longitude', 'CRW_DHW'],
    rows: [['2026-09-03T12:00:00Z', 8.657, 97.649, v]],
  },
});

function route(url, { marine = ok(marineBody()), uv = ok(uvBody()), dhw = ok(dhwBody(0.5)) } = {}) {
  if (url.includes('marine-api')) return marine;
  if (url.includes('api.open-meteo.com')) return uv;
  if (url.includes('pacioos')) return dhw;
  return bad(404);
}

// รอให้ promise ที่ค้างอยู่ (fetchAndApplyDHW ที่ไม่ได้ await) ทำงานจนจบ
// ต้องเผื่อเวลา retry เต็มรอบ: 3 ครั้ง เว้น 600ms + 1200ms = ~1.8 วิ ต่อหนึ่ง endpoint
const settle = () => new Promise(r => setTimeout(r, 5000));

async function runCase(name, fetchImpl, checks) {
  fetchLog = []; inFlight = 0; maxConcurrent = 0;
  elements.clear(); tileLayers = []; attributions.clear();
  const ctx = makeSandbox(fetchImpl);
  vm.runInContext(SRC, ctx, { filename: 'app.js' });
  await settle();
  // ตัวแปร let/const ที่ประกาศระดับบนสุดอยู่ใน lexical scope ของ context
  // เข้าถึงจากนอกด้วย ctx.xxx ไม่ได้ ต้อง eval ในบริบทเดียวกัน
  const evalIn = (expr) => vm.runInContext(expr, ctx);
  checks(evalIn);
  console.log(`  ✅ ${name}`);
}

(async () => {
  console.log('\n🧪 ทดสอบ logic ฝั่งหน้าเว็บ (app.js)\n');

  // --- 1. ทุก API ปกติ ---
  await runCase('ทุก API ปกติ → 8 เกาะมีค่า SST จริง + สถานะเขียว',
    async (url) => route(url),
    (evalIn) => {
      const markers = Object.values(evalIn('markers'));
      assert.strictEqual(markers.length, 8, 'ต้องมี marker ครบ 8 เกาะ');
      markers.forEach(m => {
        assert.strictEqual(typeof m.sst, 'number', `${m.reef.name}: SST ต้องเป็นตัวเลข`);
        assert.ok(m.sst > 28 && m.sst < 30, `${m.reef.name}: SST ต้องมาจากข้อมูลที่ mock ไว้`);
      });
      assert.strictEqual(elements.get('status-text').textContent,
        'พร้อมเฝ้าระวังจากข้อมูล Open-Meteo');
    });

  // --- 2. Open-Meteo ล่มทั้งหมด → ต้องไม่มีข้อมูลปลอม ---
  await runCase('Open-Meteo ล่ม → ขึ้น "ไม่มีข้อมูล" ไม่ใช่ตัวเลขสุ่ม',
    async (url) => route(url, { marine: bad(503), uv: bad(503) }),
    (evalIn) => {
      const markers = Object.values(evalIn('markers'));
      assert.strictEqual(markers.length, 8, 'ต้องยังสร้าง marker ครบ 8 เกาะ');
      markers.forEach(m => {
        assert.strictEqual(m.sst, null, `${m.reef.name}: SST ต้องเป็น null ไม่ใช่ค่าที่ปั้นขึ้นมา`);
        assert.strictEqual(m.temps, null, `${m.reef.name}: ห้ามมี array อุณหภูมิปลอม`);
      });
      assert.strictEqual(elements.get('status-text').textContent, 'เชื่อมต่อแหล่งข้อมูลไม่ได้');
      assert.strictEqual(elements.get('status-badge').className, 'badge warning');
    });

  // --- 3. Open-Meteo พลาดครั้งแรกแล้วหายดี → retry ต้องช่วยได้ ---
  let marineHits = 0;
  await runCase('Open-Meteo พลาดครั้งแรก → retry แล้วได้ข้อมูลจริง',
    async (url) => {
      if (url.includes('marine-api')) {
        marineHits++;
        return marineHits <= 8 ? bad(503) : ok(marineBody()); // ล้มรอบแรกของทุกเกาะ
      }
      return route(url);
    },
    (evalIn) => {
      const markers = Object.values(evalIn('markers'));
      markers.forEach(m => {
        assert.strictEqual(typeof m.sst, 'number',
          `${m.reef.name}: retry ต้องกู้ข้อมูลกลับมาได้`);
      });
      assert.ok(marineHits > 8, 'ต้องมีการยิงซ้ำจริง');
    });

  // --- 4. โหลดขนานกัน ไม่ใช่ทีละเกาะ ---
  await runCase('โหลด 8 เกาะขนานกัน (ไม่ใช่ทีละเกาะ)',
    async (url) => {
      await new Promise(r => setTimeout(r, 30));
      return route(url);
    },
    () => {
      assert.ok(maxConcurrent >= 8,
        `ต้องยิงขนานกันอย่างน้อย 8 request พร้อมกัน (วัดได้ ${maxConcurrent})`);
    });

  // --- 5. DHW ล่ม แต่ SST ยังมา → เกาะยังใช้งานได้ ---
  await runCase('ERDDAP ล่ม แต่ SST ปกติ → ยังโชว์เกาะได้ ความเสี่ยงประมาณจาก SST',
    async (url) => route(url, { dhw: bad(500) }),
    (evalIn) => {
      const markers = Object.values(evalIn('markers'));
      markers.forEach(m => {
        assert.strictEqual(typeof m.sst, 'number', `${m.reef.name}: SST ต้องยังมา`);
        assert.strictEqual(m.dhw, null, `${m.reef.name}: DHW ต้องเป็น null`);
        assert.ok(m.risk.label !== 'ไม่มีข้อมูล', `${m.reef.name}: ยังประเมินจาก SST ได้`);
      });
    });

  // --- 6. getRisk: DHW เป็นตัวตัดสินหลัก และ null ต้องไม่กลายเป็นเขียว ---
  await runCase('getRisk จัดระดับถูกต้อง และไม่มีข้อมูล ≠ ความเสี่ยงต่ำ',
    async (url) => route(url),
    (evalIn) => {
      const getRisk = evalIn('getRisk');
      assert.strictEqual(getRisk(28, 0.2).level, 0, 'DHW 0.2 → ต่ำ');
      assert.strictEqual(getRisk(28, 2).level, 1, 'DHW 2 → ปานกลาง');
      assert.strictEqual(getRisk(28, 5).level, 2, 'DHW 5 → สูง');
      assert.strictEqual(getRisk(28, 9).level, 3, 'DHW 9 → วิกฤต');
      // DHW ต้องชนะ SST เมื่อมีทั้งคู่
      assert.strictEqual(getRisk(31.5, 0).level, 0, 'มี DHW แล้วต้องใช้ DHW ไม่ใช่ SST');
      // ไม่มีข้อมูลเลย
      const unknown = getRisk(null);
      assert.strictEqual(unknown.level, null, 'ไม่มีข้อมูล → level ต้องเป็น null');
      assert.strictEqual(unknown.label, 'ไม่มีข้อมูล');
      assert.notStrictEqual(unknown.color, '#22c55e', 'ห้ามแสดงเป็นสีเขียว');
    });

  // --- 7. เปิดกราฟของเกาะที่ไม่มีข้อมูล → ต้องไม่ crash และต้องบอกผู้ใช้ว่าไม่มีข้อมูล ---
  await runCase('เปิดกราฟเกาะที่ดึงข้อมูลไม่ได้ → ไม่ crash + แจ้งว่าไม่มีข้อมูล',
    async (url) => route(url, { marine: bad(503), uv: bad(503), dhw: bad(503) }),
    (evalIn) => {
      // ต้องไม่โยน exception ทั้ง 3 แท็บ
      for (const tab of ['24h', '7d', '14d']) {
        evalIn(`currentTab = '${tab}'; showChart(1);`);
      }
      assert.strictEqual(elements.get('chart-sst').textContent, 'ไม่มีข้อมูล',
        'ช่อง SST บนกราฟต้องขึ้นว่าไม่มีข้อมูล');
      assert.ok(elements.get('forecast-list').innerHTML.includes('ยังไม่มีข้อมูลสำหรับเกาะนี้'),
        'ต้องมีข้อความอธิบายแทนกราฟเปล่า');
      assert.strictEqual(elements.get('chart-wrap-outer').style.display, 'none',
        'ต้องซ่อนพื้นที่กราฟ');
    });

  // --- 8. popupHTML ต้องไม่พังเมื่อ SST/UV เป็น null ---
  await runCase('popup ของเกาะที่ไม่มีข้อมูล render ได้ ไม่พัง',
    async (url) => route(url, { marine: bad(503), uv: bad(503), dhw: bad(503) }),
    (evalIn) => {
      const html = evalIn(`popupHTML(REEFS[0], null, getRisk(null), null, null, null)`);
      assert.ok(html.includes('ไม่มีข้อมูล'), 'popup ต้องบอกว่าไม่มีข้อมูล');
      assert.ok(!html.includes('NaN') && !html.includes('undefined'),
        'popup ต้องไม่มี NaN/undefined โผล่ให้ผู้ใช้เห็น');
    });

  // --- 9. ต้องมีแผนที่ที่ใช้ได้โดยไม่ต้องมี API key เสมอ (สำคัญตอน deploy) ---
  await runCase('มี basemap ที่ใช้ได้โดยไม่ต้องมี key และไม่พึ่ง CARTO',
    async (url) => route(url),
    (evalIn) => {
      const sources = evalIn('BASEMAPS');
      assert.ok(sources.length >= 2, 'ต้องมี basemap สำรองอย่างน้อย 1 เจ้า');

      sources.forEach(s => {
        [s.url, s.labelsUrl, s.styleUrl].filter(Boolean).forEach(u => {
          assert.ok(!/cartocdn|basemaps\.carto/i.test(u),
            `${s.name}: ห้ามใช้ CARTO ซึ่งพิมพ์ลายน้ำ API KEY REQUIRED ทับแผนที่`);
        });
        assert.ok(s.options.attribution, `${s.name}: ต้องมี attribution ตามเงื่อนไขผู้ให้บริการ`);
        assert.ok(s.labelsIncluded || s.labelsUrl,
          `${s.name}: ต้องมีป้ายชื่อ ไม่งั้นแผนที่จะโล่ง`);
        assert.ok(['raster', 'vector'].includes(s.type), `${s.name}: ต้องระบุ type`);
      });

      // เจ้าที่ต้องใช้ key ห้ามอยู่ในลิสต์ถ้ายังไม่ได้ใส่ key จริง
      // (ไม่งั้นตอน deploy จะได้ 401 ทุกไทล์แล้วผู้ใช้เห็นแผนที่ว่างชั่วขณะ)
      const key = evalIn('STADIA_API_KEY');
      sources.filter(s => s.requiresKey).forEach(s => {
        assert.ok(key, `${s.name}: อยู่ในลิสต์ทั้งที่ยังไม่ได้ตั้ง STADIA_API_KEY`);
        assert.ok(s.url.includes(key), `${s.name}: ต้องแนบ key ที่ตั้งไว้ลงใน URL`);
      });

      // ต้องมีอย่างน้อยหนึ่งเจ้าที่ไม่ต้องใช้ key — หลักประกันว่าแผนที่ขึ้นแน่นอนตอน deploy
      assert.ok(sources.some(s => !s.requiresKey),
        'ต้องมี basemap ที่ใช้ได้โดยไม่ต้องมี key อย่างน้อย 1 เจ้า');
      assert.ok(!sources[sources.length - 1].requiresKey,
        'basemap ตัวสุดท้าย (ตัวกันเหนียว) ต้องไม่ต้องใช้ key');
    });

  // --- 9b. เจ้าแรกต้องถูกต้องตามว่าตั้ง STADIA_API_KEY ไว้หรือยัง ---
  //   ยังไม่ใส่ key → OpenFreeMap (vector, ฟรี, deploy ได้ทุกโดเมน)
  //   ใส่ key แล้ว  → Stadia (raster, สวยที่สุด)
  //   เทสต้องผ่านทั้งสองแบบ ไม่งั้นพอผู้ใช้ใส่ key จริงแล้ว npm test จะพังทั้งที่ตั้งค่าถูก
  await runCase('เจ้าแรกตรงกับการตั้งค่า STADIA_API_KEY',
    async (url) => route(url),
    (evalIn) => {
      const sources = evalIn('BASEMAPS');
      const key = evalIn('STADIA_API_KEY');
      const first = sources[0];

      if (key) {
        assert.strictEqual(first.type, 'raster', 'ใส่ key แล้วเจ้าแรกต้องเป็น Stadia (raster)');
        assert.ok(/stadiamaps/i.test(first.url), 'เจ้าแรกต้องเป็น Stadia');
        assert.ok(first.url.includes(key), 'ต้องแนบ key ลงใน URL');
        assert.strictEqual(tileLayers.length, 1, 'Stadia ป้ายฝังมาแล้ว ต่อ layer เดียว');
        assert.strictEqual(tileLayers[0].url, first.url);
      } else {
        assert.strictEqual(first.type, 'vector', 'ยังไม่ใส่ key ต้องได้ OpenFreeMap (vector)');
        assert.ok(/openfreemap/i.test(first.styleUrl), 'เจ้าแรกต้องเป็น OpenFreeMap');
        assert.strictEqual(tileLayers.length, 1, 'vector ต่อ layer เดียว');
        assert.strictEqual(tileLayers[0].isVector, true, 'ต้องต่อผ่าน L.maplibreGL');
        assert.strictEqual(tileLayers[0].styleUrl, first.styleUrl);
        assert.ok(attributions.has(first.options.attribution),
          'ต้องใส่เครดิตผ่าน Leaflet เพราะ plugin ปิด attribution ของ MapLibre ไว้');
      }
    });

  // --- 9c. โหลด MapLibre ไม่ได้ → ต้องข้ามไปใช้ raster ---
  await runCase('โหลด MapLibre ไม่สำเร็จ → ข้ามไปใช้แผนที่ raster แทน',
    Object.assign(async (url) => route(url), { __noMapLibre: true }),
    (evalIn) => {
      const sources = evalIn('BASEMAPS');
      const firstRaster = sources.find(s => s.type === 'raster');
      assert.ok(tileLayers.length >= 1, 'ต้องต่อ basemap สำรองแทน');
      assert.notStrictEqual(tileLayers[0].isVector, true, 'ต้องไม่ใช่ vector');
      assert.strictEqual(tileLayers[0].url, firstRaster.url, 'ต้องข้ามไปใช้ raster เจ้าแรก');
    });

  // --- 9d. เจ้าที่ป้ายชื่อแยก layer ต้องซ้อนถูกลำดับ ---
  await runCase('basemap ที่ป้ายชื่อแยก layer ต้องซ้อนเหนือแผนที่ฐาน',
    async (url) => route(url),
    (evalIn) => {
      const sources = evalIn('BASEMAPS');
      const withLabels = sources.findIndex(s => s.labelsUrl);
      assert.ok(withLabels >= 0, 'ต้องมีอย่างน้อยหนึ่งเจ้าที่ป้ายชื่อแยก layer');

      tileLayers.length = 0;               // ล้างของเจ้าแรกที่ต่อไว้ตอนโหลด
      evalIn(`addBasemap(${withLabels})`); // ต่อเจ้าที่ป้ายแยก layer โดยตรง

      assert.strictEqual(tileLayers.length, 2, 'ต้องต่อทั้งแผนที่ฐานและชั้นป้ายชื่อ');
      assert.strictEqual(tileLayers[0].url, sources[withLabels].url);
      assert.strictEqual(tileLayers[1].url, sources[withLabels].labelsUrl);
      assert.ok(tileLayers[1].options.zIndex > tileLayers[0].options.zIndex,
        'ชั้นป้ายชื่อต้องมี zIndex สูงกว่าแผนที่ฐาน ไม่งั้นจะถูกบัง');
    });

  // --- 10. vector ล่ม → สลับไป raster และถอด attribution เก่าออก ---
  await runCase('แผนที่ vector ล่ม → สลับไปเจ้าถัดไป + ถอดเครดิตเก่าออก',
    async (url) => route(url),
    (evalIn) => {
      const sources = evalIn('BASEMAPS');
      const vi = sources.findIndex(s => s.type === 'vector');
      assert.ok(vi >= 0, 'ต้องมี basemap แบบ vector อย่างน้อยหนึ่งเจ้า');
      const next = sources[vi + 1];
      assert.ok(next, 'เจ้า vector ต้องมีตัวสำรองต่อท้าย');

      tileLayers.length = 0; attributions.clear();
      evalIn(`addBasemap(${vi})`);   // ต่อเจ้า vector โดยตรง ไม่อิงว่ามันอยู่ลำดับไหน

      const gl = tileLayers[0];
      assert.strictEqual(gl.isVector, true);
      // MapLibre แจ้ง error ผ่าน map ข้างในของมัน — 3 ครั้งแรกยังไม่ควรสลับ
      gl.fireGlError(); gl.fireGlError(); gl.fireGlError();
      assert.strictEqual(tileLayers.length, 1, 'error 3 ครั้งยังไม่ควรสลับ');
      assert.strictEqual(gl.removed, false);

      // ครั้งที่ 4 ต้องสลับไปเจ้าถัดไป (Esri) ซึ่งป้ายชื่อแยก layer จึงเพิ่มมา 2 layer
      gl.fireGlError();
      assert.strictEqual(gl.removed, true, 'ต้องถอดแผนที่ vector ที่ล่มออก');
      assert.ok(!attributions.has(sources[vi].options.attribution),
        'ต้องถอดเครดิตของเจ้าที่ล่มออก ไม่งั้นจะค้างบนแผนที่ทั้งที่ไม่ได้ใช้แล้ว');
      assert.strictEqual(tileLayers.length, 3, 'ต้องต่อ basemap สำรอง (ฐาน + ป้ายชื่อ)');
      assert.strictEqual(tileLayers[1].url, next.url);
      assert.strictEqual(tileLayers[2].url, next.labelsUrl);

      // เจ้าถัดไปล่มอีก ต้องถอดทั้งสอง layer แล้วไปเจ้าถัดถัดไป
      const [, esriBase, esriLabels] = tileLayers;
      for (let i = 0; i < 4; i++) esriBase.fire('tileerror');
      assert.strictEqual(esriBase.removed, true, 'ต้องถอดแผนที่ฐานของเจ้าที่ล่ม');
      assert.strictEqual(esriLabels.removed, true, 'ต้องถอดชั้นป้ายชื่อของเจ้าที่ล่มด้วย');
      assert.strictEqual(tileLayers[3].url, sources[vi + 2].url);
    });

  console.log('\n✅ ผ่านทั้งหมด\n');
})().catch(err => {
  console.error('\n❌ ทดสอบไม่ผ่าน:', err.message, '\n');
  process.exit(1);
})


