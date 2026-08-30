// ============================================================
//  ReefAlert — app.js  (พยากรณ์ล่วงหน้า 7-14 วัน)
// ============================================================

const REEFS = [
  { id: 1, name: "หมู่เกาะสิมิลัน",        region: "อันดามัน", lat: 8.657,  lon: 97.649 },
  { id: 2, name: "เกาะเต่า",                region: "อ่าวไทย", lat: 10.066, lon: 99.839 },
  { id: 3, name: "เกาะหลีเป๊ะ",             region: "อันดามัน", lat: 6.487,  lon: 99.303 },
  { id: 4, name: "เกาะสมุย (Coral Cove)",  region: "อ่าวไทย", lat: 9.491,  lon: 100.061 },
  { id: 5, name: "เกาะช้าง",                region: "อ่าวไทย", lat: 12.125, lon: 102.269 },
  { id: 6, name: "เกาะพีพี (Shark Point)", region: "อันดามัน", lat: 7.726,  lon: 98.788 },
  { id: 7, name: "เกาะราชา",                region: "อันดามัน", lat: 7.604,  lon: 98.366 },
  { id: 8, name: "เกาะตะรุเตา",             region: "อันดามัน", lat: 6.649,  lon: 99.652 },
];

const ALERT_THRESHOLD = 30.0;

// ===== ระดับความเสี่ยง =====
// ระดับความเสี่ยง — อ้างอิงเกณฑ์สากล NOAA Coral Reef Watch (Bleaching Alert Level)
// ใช้ DHW (ความร้อนสะสม 12 สัปดาห์) เป็นตัวตัดสินหลักเมื่อมีข้อมูล เพราะเป็นมาตรฐานที่ NOAA ใช้จริง
// ถ้ายังไม่มี DHW (กำลังโหลด/เชื่อมต่อ NOAA ไม่ได้) จะ fallback มาประมาณจาก SST ชั่วขณะแทนชั่วคราว
function getRisk(sst, dhw) {
  if (typeof dhw === 'number') {
    if (dhw >= 8) return {
      label: "วิกฤต", emoji: "🔴", color: "#ef4444", level: 3,
      actions: [
        "🚫 ระงับกิจกรรมดำน้ำและดูปะการังทันที",
        "📞 แจ้งกรมทรัพยากรทางทะเลและชายฝั่ง (ทช.) โทร 1362",
        "📸 บันทึกภาพและพิกัดปะการังที่ฟอกขาวทุก 24 ชม.",
        "🔬 เก็บตัวอย่างน้ำส่งห้องปฏิบัติการ",
        "📢 แจ้งเตือนชุมชนชาวประมงในพื้นที่",
      ],
      desc: `Bleaching Alert Level 2 (DHW ${dhw.toFixed(1)}) — ปะการังกำลังฟอกขาวหรืออาจตายแล้ว ต้องดำเนินการทันที`
    };
    if (dhw >= 4) return {
      label: "สูง", emoji: "🟠", color: "#f97316", level: 2,
      actions: [
        "⚠️ เฝ้าระวังและตรวจสอบปะการังทุก 48 ชม.",
        "🤿 จำกัดจำนวนนักดำน้ำในพื้นที่เสี่ยง",
        "📊 บันทึก SST และ DHW ต่อเนื่อง",
        "🌊 เตรียมพร้อมแผนฉุกเฉินหากอุณหภูมิยังสูง",
        "📱 แจ้งเจ้าหน้าที่อุทยานแห่งชาติทางทะเล",
      ],
      desc: `Bleaching Alert Level 1 (DHW ${dhw.toFixed(1)}) — ความเสี่ยงฟอกขาวสูง ปะการังเริ่มเครียดจากความร้อนสะสม`
    };
    if (dhw >= 1) return {
      label: "ปานกลาง", emoji: "🟡", color: "#eab308", level: 1,
      actions: [
        "👁️ ติดตามสถานการณ์ทุก 72 ชม.",
        "📝 บันทึกสภาพปะการังเป็นฐานข้อมูล",
        "🎓 ให้ความรู้นักท่องเที่ยวเรื่องการอนุรักษ์",
        "🚢 ตรวจสอบการทอดสมอเรือในพื้นที่แนวปะการัง",
      ],
      desc: `Bleaching Watch (DHW ${dhw.toFixed(1)}) — เริ่มมีความร้อนสะสม ควรเฝ้าระวังใกล้ชิด`
    };
    return {
      label: "ต่ำ", emoji: "🟢", color: "#22c55e", level: 0,
      actions: [
        "✅ สถานการณ์ปกติ ดำเนินกิจกรรมได้ตามปกติ",
        "📅 ตรวจสอบข้อมูลรายสัปดาห์",
        "🌱 สนับสนุนโครงการฟื้นฟูปะการังในพื้นที่",
      ],
      desc: `No Stress (DHW ${dhw.toFixed(1)}) — แนวปะการังไม่มีความเครียดจากความร้อนสะสม`
    };
  }

  // Fallback ชั่วคราว (ยังไม่มี DHW): ประมาณจาก SST ปัจจุบัน — จะถูกแทนที่อัตโนมัติเมื่อ DHW มาถึง
  if (sst >= 31.0) return {
    label: "วิกฤต", emoji: "🔴", color: "#ef4444", level: 3,
    actions: [
      "🚫 ระงับกิจกรรมดำน้ำและดูปะการังทันที",
      "📞 แจ้งกรมทรัพยากรทางทะเลและชายฝั่ง (ทช.) โทร 1362",
      "📸 บันทึกภาพและพิกัดปะการังที่ฟอกขาวทุก 24 ชม.",
      "🔬 เก็บตัวอย่างน้ำส่งห้องปฏิบัติการ",
      "📢 แจ้งเตือนชุมชนชาวประมงในพื้นที่",
    ],
    desc: "ประมาณจาก SST (รอ DHW) — ปะการังอาจกำลังฟอกขาวหรือตาย ต้องดำเนินการทันที"
  };
  if (sst >= 30.0) return {
    label: "สูง", emoji: "🟠", color: "#f97316", level: 2,
    actions: [
      "⚠️ เฝ้าระวังและตรวจสอบปะการังทุก 48 ชม.",
      "🤿 จำกัดจำนวนนักดำน้ำในพื้นที่เสี่ยง",
      "📊 บันทึก SST และ DHW ต่อเนื่อง",
      "🌊 เตรียมพร้อมแผนฉุกเฉินหากอุณหภูมิยังสูง",
      "📱 แจ้งเจ้าหน้าที่อุทยานแห่งชาติทางทะเล",
    ],
    desc: "ประมาณจาก SST (รอ DHW) — ความเสี่ยงสูง ปะการังอาจเริ่มเครียดจากความร้อน"
  };
  if (sst >= 29.0) return {
    label: "ปานกลาง", emoji: "🟡", color: "#eab308", level: 1,
    actions: [
      "👁️ ติดตามสถานการณ์ทุก 72 ชม.",
      "📝 บันทึกสภาพปะการังเป็นฐานข้อมูล",
      "🎓 ให้ความรู้นักท่องเที่ยวเรื่องการอนุรักษ์",
      "🚢 ตรวจสอบการทอดสมอเรือในพื้นที่แนวปะการัง",
    ],
    desc: "ประมาณจาก SST (รอ DHW) — ควรเริ่มติดตามอย่างใกล้ชิด"
  };
  return {
    label: "ต่ำ", emoji: "🟢", color: "#22c55e", level: 0,
    actions: [
      "✅ สถานการณ์ปกติ ดำเนินกิจกรรมได้ตามปกติ",
      "📅 ตรวจสอบข้อมูลรายสัปดาห์",
      "🌱 สนับสนุนโครงการฟื้นฟูปะการังในพื้นที่",
    ],
    desc: "ประมาณจาก SST (รอ DHW) — แนวปะการังอยู่ในสภาพดี"
  };
}

// ===== DHW จริงจาก NOAA Coral Reef Watch (ERDDAP) =====
// เผื่อ mirror หลักของ NOAA (.noaa.gov) เข้าไม่ถึงจากบางเครือข่าย
// จึงมี mirror สำรองจาก PacIOOS (มหาวิทยาลัยฮาวาย) ที่ sync ข้อมูลชุดเดียวกัน
// หมายเหตุ: coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW ถูกตัดออกแล้ว
// เพราะ dataset ID เดิม 302-redirect ไปปลายทางที่ไม่มี CORS header — เบราว์เซอร์บล็อกถาวร ใช้ไม่ได้จริง
const DHW_SOURCES = [
  { name: 'PacIOOS mirror', base: 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.json' },
];

// grid ของ NOAA CRW ละเอียด 5km — จุดใกล้ฝั่ง/เกาะเล็กอาจตกบน pixel บก (null)
// จึงค้นในกรอบเล็ก ๆ รอบพิกัด แล้วเลือก pixel ทะเลที่ใกล้จุดปะการังที่สุด
async function fetchDHWFrom(base, reef) {
  const delta = 0.25; // ~25km ครอบคลุมหลาย grid cell
  const latRange = `(${(reef.lat - delta).toFixed(3)}):(${(reef.lat + delta).toFixed(3)})`;
  const lonRange = `(${(reef.lon - delta).toFixed(3)}):(${(reef.lon + delta).toFixed(3)})`;
  const url = `${base}?CRW_DHW[(last)][${latRange}][${lonRange}]`;

  // ERDDAP บางครั้งช้าหรือไม่ตอบสนอง — ยกเลิกถ้าเกิน 6 วิ กันไม่ให้แอปค้าง
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('ไม่ตอบสนองภายใน 6 วินาที');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const cols   = json.table.columnNames;
  const latIdx = cols.indexOf('latitude');
  const lonIdx = cols.indexOf('longitude');
  const dhwIdx = cols.indexOf('CRW_DHW');

  let best = null, bestDist = Infinity, bestLat = null, bestLon = null;
  for (const row of json.table.rows) {
    const val = row[dhwIdx];
    if (val === null || Number.isNaN(val)) continue;
    const dLat = row[latIdx] - reef.lat;
    const dLon = row[lonIdx] - reef.lon;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) { bestDist = dist; best = val; bestLat = row[latIdx]; bestLon = row[lonIdx]; }
  }
  if (best === null) throw new Error('ไม่พบ pixel ทะเลที่มีข้อมูล DHW ในรัศมีใกล้เคียง');
  console.log(`✅ DHW ${reef.name}: ${best} °C·weeks (pixel ${bestLat.toFixed(3)}, ${bestLon.toFixed(3)} — ห่างจากจุดปะการัง ${reef.lat}, ${reef.lon})`);
  return best;
}

async function fetchDHW(reef) {
  let lastErr;
  for (const src of DHW_SOURCES) {
    try {
      return await fetchDHWFrom(src.base, reef);
    } catch (err) {
      console.warn(`⚠️ DHW [${src.name}] ${reef.name}:`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

// ===== ระดับ Bleaching Alert ตามเกณฑ์ NOAA CRW =====
function getBleachingAlert(dhw) {
  if (dhw >= 8) return { level: 2, label: 'Bleaching Alert Level 2', color: '#ef4444', emoji: '🔴' };
  if (dhw >= 4) return { level: 1, label: 'Bleaching Alert Level 1', color: '#f97316', emoji: '🟠' };
  return { level: 0, label: 'ปกติ (No Stress)', color: '#22c55e', emoji: '🟢' };
}


// สรุปรายวัน (เฉลี่ยทุก 24 ชม.)
function hourlyToDaily(temps, times, days) {
  const result = [];
  for (let d = 0; d < days; d++) {
    const rawSlice = temps.slice(d * 24, d * 24 + 24);
    if (rawSlice.length === 0) continue;
    const dateStr = times[d * 24]?.split('T')[0] || `วันที่ ${d + 1}`;
    const label = new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

    // Open-Meteo Marine API พยากรณ์ SST ได้จริงแค่ ~10 วัน วันที่เกินจากนั้นค่าจะเป็น null
    // ห้ามเอา null มาเฉลี่ยรวม (JS จะเปลี่ยน null เป็น 0 ทำให้ค่าเฉลี่ยผิดเพี้ยนเป็น 0°C ปลอมๆ)
    const slice = rawSlice.filter(t => t !== null && t !== undefined);
    if (slice.length === 0) {
      result.push({ label, avg: null, max: null, min: null });
      continue;
    }

    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    const max = Math.max(...slice);
    const min = Math.min(...slice);
    result.push({ label, avg, max, min });
  }
  return result;
}

// ===== Toast แจ้งเตือน =====
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes shrink { from{width:100%} to{width:0%} }
  @keyframes pulse-alert {
    0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}
    50%{box-shadow:0 0 0 8px rgba(239,68,68,0)}
  }
  .chart-tab {
    flex:1; padding:8px 4px; background:none;
    border:none; border-bottom:2px solid transparent;
    color:#7aaddc; font-family:'Kanit',sans-serif;
    font-size:12px; font-weight:600; cursor:pointer;
    transition:all 0.2s; letter-spacing:0.5px;
  }
  .chart-tab:hover { color:#e8f4ff; }
  .chart-tab.active {
    color:#00d4ff;
    border-bottom-color:#00d4ff;
  }
  .forecast-bar {
    display:flex; align-items:center; gap:8px;
    padding:6px 16px; font-family:'Kanit',sans-serif;
    font-size:12px; border-bottom:1px solid rgba(100,160,255,0.1);
    transition:background 0.15s; cursor:default;
  }
  .forecast-bar:hover { background:rgba(100,160,255,0.05); }
  .fc-date  { width:52px; color:#7aaddc; font-size:11px; flex-shrink:0; }
  .fc-bar-wrap { flex:1; background:rgba(100,160,255,0.08); border-radius:4px; height:8px; overflow:hidden; }
  .fc-bar-fill { height:100%; border-radius:4px; transition:width 0.6s ease; }
  .fc-temp  { width:44px; text-align:right; font-weight:700; font-family:'Space Mono',monospace; font-size:11px; }
  .fc-risk  { width:16px; text-align:center; flex-shrink:0; }
`;
document.head.appendChild(styleSheet);

function createAlertContainer() {
  if (document.getElementById('alert-container')) return;
  const div = document.createElement('div');
  div.id = 'alert-container';
  div.style.cssText = `
    position:fixed; top:70px; right:16px; z-index:9999;
    display:flex; flex-direction:column; gap:10px; max-width:320px;
  `;
  document.body.appendChild(div);
}

function showToast(reef, sst, risk) {
  const container = document.getElementById('alert-container');
  const id = `toast-${reef.id}-${Date.now()}`;
  const toast = document.createElement('div');
  toast.id = id;
  toast.style.cssText = `
    background:#1a1a2e; border:1px solid ${risk.color};
    border-left:4px solid ${risk.color}; border-radius:12px;
    padding:14px 16px; font-family:'Kanit',sans-serif;
    box-shadow:0 4px 24px rgba(0,0,0,0.5),0 0 12px ${risk.color}44;
    transform:translateX(340px); transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s;
    opacity:0; cursor:pointer; position:relative; overflow:hidden;
  `;
  toast.innerHTML = `
    <div style="position:absolute;inset:0;background:linear-gradient(135deg,${risk.color}11 0%,transparent 60%);pointer-events:none;"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div style="flex:1;">
        <div style="font-size:11px;color:${risk.color};font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">
          ${risk.emoji} แจ้งเตือน — ความเสี่ยง${risk.label}
        </div>
        <div style="font-size:14px;font-weight:700;color:#e8f4ff;margin-bottom:6px;">🪸 ${reef.name}</div>
        <div style="font-size:12px;color:#7aaddc;display:flex;gap:12px;">
          <span>🌡️ <b style="color:${risk.color}">${sst.toFixed(2)}°C</b></span>
          <span>📍 ${reef.region}</span>
        </div>
      </div>
      <button onclick="dismissToast('${id}')" style="background:none;border:none;color:#7aaddc;font-size:16px;cursor:pointer;padding:0 0 0 4px;line-height:1;">✕</button>
    </div>
    <div style="position:absolute;bottom:0;left:0;height:3px;background:${risk.color};width:100%;animation:shrink 6s linear forwards;border-radius:0 0 12px 12px;"></div>
  `;
  toast.addEventListener('click', e => {
    if (e.target.tagName === 'BUTTON') return;
    map.setView([reef.lat, reef.lon], 9, { animate: true });
    markers[reef.id]?.circle.openPopup();
    showChart(reef.id);
    dismissToast(id);
  });
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    toast.style.transform = 'translateX(0)'; toast.style.opacity = '1';
  }));
  setTimeout(() => dismissToast(id), 6000);
}

function dismissToast(id) {
  const t = document.getElementById(id);
  if (!t) return;
  t.style.transform = 'translateX(340px)'; t.style.opacity = '0';
  setTimeout(() => t.remove(), 400);
}

function triggerAlerts(alertReefs) {
  alertReefs.forEach((item, i) => setTimeout(() => showToast(item.reef, item.sst, item.risk), i * 600));
  if (alertReefs.length > 0) {
    const hasCrit = alertReefs.some(a => a.risk.level === 3);
    const badge = document.getElementById('status-badge');
    badge.className = 'badge warning';
    badge.style.animation = 'pulse-alert 1.5s ease infinite';
    document.getElementById('status-text').textContent = hasCrit
      ? `🚨 วิกฤต ${alertReefs.filter(a => a.risk.level===3).length} แห่ง!`
      : `⚠️ เสี่ยงสูง ${alertReefs.length} แห่ง`;
  }
}

// ===== แผนที่ =====
const map = L.map('map', { zoomControl: true }).setView([9.0, 100.5], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap © CARTO', maxZoom: 18
}).addTo(map);

let markers = {};
let chartInstance = null;
let currentTab = '24h';
let loadedCount = 0;
let currentChartReefId = null;

// ===== Popup HTML (แยกออกมาเพื่ออัปเดต DHW ทีหลังได้เมื่อ NOAA ตอบกลับ) =====
function dhwHeroHTML(dhw, bleach) {
  if (typeof dhw === 'number') {
    return `<div style="font-size:18px;font-weight:800;font-family:'Space Mono',monospace;color:${bleach.color};margin-top:2px;">${dhw.toFixed(2)}</div>
            <div style="font-size:9px;color:${bleach.color};margin-top:1px;">${bleach.emoji} ${bleach.label}</div>`;
  }
  if (dhw === null) return `<div style="font-size:13px;color:#7aaddc;margin-top:6px;">ไม่มีข้อมูล</div>`;
  return `<div style="font-size:13px;color:#7aaddc;margin-top:6px;">กำลังโหลด…</div>`;
}

function popupHTML(reef, sst, risk, uv, dhw, bleach) {
  return `
  <div style="font-family:'Kanit',sans-serif;padding:12px 14px;min-width:220px;">
    <div style="font-size:16px;font-weight:700;color:${risk.color};margin-bottom:4px;">🪸 ${reef.name}</div>
    <div style="font-size:12px;color:#7aaddc;margin-bottom:10px;">📍 ${reef.region}</div>

    <!-- ข้อมูลจริงจาก API: SST + DHW เด่นเป็นการ์ดคู่ -->
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <div style="flex:1;text-align:center;padding:8px 6px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.15);border-radius:8px;">
        <div style="font-size:9px;color:#7aaddc;text-transform:uppercase;letter-spacing:1px;">🌡️ SST</div>
        <div style="font-size:18px;font-weight:800;font-family:'Space Mono',monospace;color:#00d4ff;margin-top:2px;">${sst.toFixed(2)}°C</div>
      </div>
      <div style="flex:1;text-align:center;padding:8px 6px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.15);border-radius:8px;">
        <div style="font-size:9px;color:#7aaddc;text-transform:uppercase;letter-spacing:1px;">📊 DHW (NOAA CRW)</div>
        ${dhwHeroHTML(dhw, bleach)}
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
      <tr><td style="padding:4px 0;color:#7aaddc;">⚠️ ความเสี่ยง</td>
          <td style="text-align:right;"><span style="background:${risk.color}22;color:${risk.color};padding:2px 10px;border-radius:10px;font-weight:700;font-size:12px;">${risk.emoji} ${risk.label}</span></td></tr>
      <tr><td style="padding:4px 0;color:#7aaddc;">☀️ UV Index</td>
          <td style="text-align:right;font-weight:700;color:${uv > 9 ? '#ef4444' : uv > 6 ? '#f97316' : '#22c55e'};font-family:'Space Mono',monospace;">${uv?.toFixed(1) ?? '-'}</td></tr>
    </table>

    <div style="font-size:11px;color:#7aaddc;margin-bottom:6px;font-weight:600;letter-spacing:.5px;">📋 วิธีรับมือ</div>
    <div style="font-size:11px;color:${risk.color};margin-bottom:8px;">${risk.desc}</div>
    <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px;">
      ${risk.actions.map(a => `
        <div style="font-size:11px;color:#c8dff0;background:rgba(100,160,255,0.07);
          border-radius:6px;padding:5px 8px;border-left:2px solid ${risk.color}55;">
          ${a}
        </div>
      `).join('')}
    </div>

    <button onclick="showChart(${reef.id})" style="width:100%;padding:7px;background:#00d4ff22;
      border:1px solid #00d4ff;color:#00d4ff;border-radius:8px;cursor:pointer;
      font-family:'Kanit',sans-serif;font-size:12px;font-weight:600;">
      📈 ดูกราฟพยากรณ์
    </button>
  </div>
`;
}

// ===== Marker =====
function createMarker(reef, sst, temps, times, uv, dhw) {
  const risk = getRisk(sst, dhw);
  const bleach = (typeof dhw === 'number') ? getBleachingAlert(dhw) : null;
  const outer = L.circleMarker([reef.lat, reef.lon], {
    radius:22, fillColor:risk.color, color:risk.color, weight:0, fillOpacity:0.12,
  }).addTo(map);
  const circle = L.circleMarker([reef.lat, reef.lon], {
    radius:13, fillColor:risk.color, color:'#fff', weight:2, fillOpacity:0.9,
  }).addTo(map);
  circle.bindPopup(popupHTML(reef, sst, risk, uv, dhw, bleach), { maxWidth: 280 });

  // Store all data in markers for later use
  markers[reef.id] = { outer, circle, reef, sst, temps, times, uv, risk, dhw, bleach, sidebarItem: null };
}

// ===== อัปเดต DHW บน marker/chart หลังจาก NOAA ตอบกลับ (ไม่บล็อกการโหลดแผนที่หลัก) =====
// เกณฑ์ความเสี่ยงเปลี่ยนไปใช้ DHW เป็นหลักตอนนี้ จึงต้องคำนวณ risk ใหม่ทุกครั้งที่ DHW มาถึง
function updateMarkerDHW(reefId, dhw) {
  const data = markers[reefId];
  if (!data) return;
  data.dhw = dhw;
  data.bleach = (typeof dhw === 'number') ? getBleachingAlert(dhw) : null;
  data.risk = getRisk(data.sst, dhw);

  data.outer.setStyle({ fillColor: data.risk.color, color: data.risk.color });
  data.circle.setStyle({ fillColor: data.risk.color });
  data.circle.setPopupContent(
    popupHTML(data.reef, data.sst, data.risk, data.uv, data.dhw, data.bleach)
  );

  if (data.sidebarItem) {
    const dot = data.sidebarItem.querySelector('.reef-dot');
    dot.style.background = data.risk.color;
    dot.style.color = data.risk.color; // currentColor ใช้ทำ glow + pulse ring
    const badge = data.sidebarItem.querySelector('.reef-risk-badge');
    badge.style.color = data.risk.color;
    badge.textContent = data.risk.emoji;
  }

  if (currentChartReefId === reefId) {
    const riskEl = document.getElementById('chart-risk');
    riskEl.textContent = `${data.risk.emoji} ${data.risk.label}`;
    riskEl.style.color = data.risk.color;
    updateChartDHW(data);
  }

  updateStatCounts();
}

function fetchAndApplyDHW(reef) {
  fetchDHW(reef)
    .then(dhw => updateMarkerDHW(reef.id, dhw))
    .catch(err => {
      console.warn(`⚠️ DHW ${reef.name}:`, err.message);
      updateMarkerDHW(reef.id, null);
    });
}

// ===== Sidebar =====
function addReefToSidebar(reef, sst, risk, delay) {
  const list = document.getElementById('reef-list');
  const item = document.createElement('div');
  item.className = 'reef-item';
  item.style.animationDelay = `${delay}ms`;
  item.innerHTML = `
    <div class="reef-dot" style="background:${risk.color};color:${risk.color};"></div>
    <div class="reef-info">
      <div class="reef-name">${reef.name}</div>
      <div class="reef-sst">${reef.region}</div>
    </div>
    <div class="reef-risk-badge" style="color:${risk.color};">${risk.emoji}</div>
  `;
  item.addEventListener('click', () => {
    map.setView([reef.lat, reef.lon], 9, { animate: true });
    markers[reef.id].circle.openPopup();
    showChart(reef.id);
  });
  list.appendChild(item);
  if (markers[reef.id]) markers[reef.id].sidebarItem = item;
}

// ===== กราฟ + Tab =====
function buildTabBar(reefId) {
  return `
    <div style="display:flex;border-bottom:1px solid rgba(100,160,255,0.15);margin-bottom:0;">
      <button class="chart-tab ${currentTab==='24h'?'active':''}"   onclick="switchTab('24h',${reefId})">24 ชม.</button>
      <button class="chart-tab ${currentTab==='7d'?'active':''}"    onclick="switchTab('7d',${reefId})">7 วัน</button>
      <button class="chart-tab ${currentTab==='14d'?'active':''}"   onclick="switchTab('14d',${reefId})">14 วัน</button>
    </div>
  `;
}

function switchTab(tab, reefId) {
  currentTab = tab;
  showChart(reefId);
}

function updateChartDHW(data) {
  const dhwEl = document.getElementById('chart-dhw');
  if (typeof data.dhw === 'number') {
    dhwEl.textContent = `${data.dhw.toFixed(2)} w ${data.bleach.emoji}`;
    dhwEl.style.color = data.bleach.color;
    dhwEl.title = data.bleach.label;
  } else if (data.dhw === null) {
    dhwEl.textContent = 'ไม่มีข้อมูล';
    dhwEl.style.color = '';
    dhwEl.title = 'เชื่อมต่อ NOAA Coral Reef Watch ไม่ได้';
  } else {
    dhwEl.textContent = 'กำลังโหลด…';
    dhwEl.style.color = '';
    dhwEl.title = '';
  }
}

function showChart(reefId) {
  const data = markers[reefId];
  if (!data) return;
  currentChartReefId = reefId;

  const panel = document.getElementById('chart-panel');
  panel.classList.remove('hidden');

  document.getElementById('chart-reef-name').textContent = `🪸 ${data.reef.name}`;
  document.getElementById('chart-sst').textContent = `${data.sst.toFixed(2)}°C`;
  const riskEl = document.getElementById('chart-risk');
  riskEl.textContent = `${data.risk.emoji} ${data.risk.label}`;
  riskEl.style.color = data.risk.color;

  updateChartDHW(data);

  // อัปเดต tab bar
  const tabContainer = document.getElementById('tab-bar');
  if (tabContainer) tabContainer.innerHTML = buildTabBar(reefId);

  const ctx = document.getElementById('tempChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  // รีเซ็ต overlay "DHW = 0" ทุกครั้งที่เปิด/สลับกราฟ (จะโชว์ใหม่เฉพาะตอนพยากรณ์ DHW ทั้งชุดเป็น 0 จริง)
  document.getElementById('dhw-zero-overlay')?.classList.add('hidden');

  // ซ่อน/แสดง forecast list
  const fcList = document.getElementById('forecast-list');

  if (currentTab === '24h') {
    // กราฟ 24 ชั่วโมง
    document.getElementById('chart-wrap-outer').style.display = 'flex';
    if (fcList) fcList.style.display = 'none';

    const labels  = Array.from({length:24}, (_,i) => `+${i}h`);
    const temps24 = data.temps.slice(0, 24);

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label:'SST (°C)', data:temps24, borderColor:data.risk.color, backgroundColor:data.risk.color+'22',
            borderWidth:2.5, pointRadius:3, pointBackgroundColor:data.risk.color, fill:true, tension:0.4 },
          { label:'เกณฑ์แจ้งเตือน (30°C)', data:Array(24).fill(30), borderColor:'#f9731680', borderWidth:1.5, borderDash:[5,5], pointRadius:0, fill:false },
          { label:'เกณฑ์ฟอกขาว (29°C)',    data:Array(24).fill(29), borderColor:'#eab30860', borderWidth:1, borderDash:[3,3], pointRadius:0, fill:false },
        ]
      },
      options: chartOptions(data.risk.color, 'ชั่วโมง')
    });

  } else {
    // กราฟ 7 หรือ 14 วัน
    const days = currentTab === '7d' ? 7 : 14;
    document.getElementById('chart-wrap-outer').style.display = 'flex';
    if (fcList) fcList.style.display = 'block';

    const daily = hourlyToDaily(data.temps, data.times || [], days);
    const labels = daily.map(d => d.label);
    const avgs   = daily.map(d => d.avg);
    const maxs   = daily.map(d => d.max);
    const mins   = daily.map(d => d.min);

    // แสดงเส้นพยากรณ์ DHW + ป้าย Classifier ทั้งแท็บ 7 วันและ 14 วัน (โมเดลพยากรณ์เป็นรายวันอยู่แล้ว ใช้ข้อมูลชุดเดียวกันได้)
    // ไม่รวมแท็บ 24 ชม. เพราะโมเดลพยากรณ์ระดับ "วัน" ไม่ใช่ "ชั่วโมง" ไม่เข้ากับสเกลกราฟนั้น
    const showDhwForecast = currentTab === '14d' || currentTab === '7d';

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label:'SST เฉลี่ย (°C)', data:avgs, borderColor:data.risk.color, backgroundColor:data.risk.color+'22',
            borderWidth:2.5, pointRadius:5, pointBackgroundColor:data.risk.color, fill:true, tension:0.4 },
          { label:'สูงสุดรายวัน',    data:maxs, borderColor:'#ef444480', borderWidth:1.5, borderDash:[4,4], pointRadius:3, fill:false, tension:0.4 },
          { label:'ต่ำสุดรายวัน',    data:mins, borderColor:'#22c55e80', borderWidth:1.5, borderDash:[4,4], pointRadius:3, fill:false, tension:0.4 },
          { label:'เกณฑ์แจ้งเตือน (30°C)', data:Array(days).fill(30), borderColor:'#f9731680', borderWidth:1.5, borderDash:[5,5], pointRadius:0, fill:false },
        ]
      },
      options: chartOptions(data.risk.color, 'วัน', showDhwForecast)
    });

    // แท็บ 14 วัน: ดึงค่าพยากรณ์ DHW รายวันครบ +1 ถึง +14 วัน จากโมเดล ML มาแปะเป็นเส้นประเพิ่ม
    // (โมเดลรายวัน — ไม่ใช่จุดเดียวแบบเดิม — ไม่บล็อกการแสดงกราฟ SST หลักที่ขึ้นก่อนแล้ว)
    if (showDhwForecast) {
      const reefIdAtRequest = reefId;
      const tabAtRequest = currentTab;
      fetchDHWForecast(data.reef).then(forecast => {
        // กันเคสผู้ใช้สลับ reef/แท็บไปแล้วก่อนผลจะมาถึง (เดิม hardcode เช็คแค่แท็บ 14 วัน ทำให้แท็บ 7 วันไม่เคยได้ค่า DHW จริงเลย)
        if (currentChartReefId !== reefIdAtRequest || currentTab !== tabAtRequest || !chartInstance) return;

        const noteEl = document.getElementById('chart-note');
        if (!forecast || !Array.isArray(forecast.forecasts)) {
          if (noteEl) noteEl.textContent = '📡 SST จาก Open-Meteo Marine API · DHW จาก NOAA Coral Reef Watch · พยากรณ์ประมาณ 14 วัน · ⚠️ พยากรณ์ DHW ล่วงหน้าด้วย ML ไม่สำเร็จในตอนนี้';
          return;
        }

        // dhwByIndex[0] = DHW ปัจจุบันจริง (วันนี้), [1..13] = ค่าพยากรณ์รายวันจากโมเดล (+1 ถึง +13 วัน)
        // กราฟนี้มี 14 ช่อง (index 0-13) และช่อง 0 ถูกใช้เก็บ "วันนี้" ไปแล้ว เลยแสดงได้ถึง +13 วันบนกราฟ
        // (โมเดลพยากรณ์ได้ถึง +14 วันจริง แค่ไม่มีช่องให้วางบนกราฟ 14 วันนี้พอดี)
        const dhwByIndex = Array(days).fill(null);
        const clfByIndex = Array(days).fill(null);  // ผลจาก Classifier (ทำงานควบคู่ ไม่แทนที่ dhwByIndex)
        dhwByIndex[0] = forecast.current_dhw;
        forecast.forecasts.forEach(f => {
          if (f.horizon_days < days) {
            dhwByIndex[f.horizon_days] = f.predicted_dhw;
            if (typeof f.risk_confidence === 'number') {
              clfByIndex[f.horizon_days] = { label: f.risk_label, confidence: f.risk_confidence };
            }
          }
        });

        const validDhwValues = dhwByIndex.filter(v => typeof v === 'number');
        const maxDhwValue = validDhwValues.length ? Math.max(...validDhwValues) : 0;

        // DHW ทั้งชุดเป็น 0 (หรือใกล้ 0 มากจนถือว่าไม่มีความร้อนสะสม) — โชว์ overlay ว่านี่คือสถานะดีจริง
        // ไม่ใช่ข้อมูลหาย (เส้นแบนติดขอบล่างเฉยๆ อาจดูเหมือนบั๊กถ้าไม่มีข้อความอธิบาย)
        const overlayEl = document.getElementById('dhw-zero-overlay');
        if (overlayEl) overlayEl.classList.toggle('hidden', maxDhwValue >= 0.05);

        // ปรับแกน Y ขวา (DHW) ให้ยืดหยุ่นตามข้อมูลจริง — ถ้าค่าสูงสุดน้อยมาก (ใกล้ 0) บังคับ max ขั้นต่ำไว้
        // กันเส้นแบนจนติดขอบล่างสุดจนดูเหมือนพัง ถ้าค่าสูงกว่านั้นเผื่อขอบบน 30% ของค่าจริง
        const yAxisMax = maxDhwValue < 0.3 ? 1 : Math.ceil(maxDhwValue * 1.3 * 10) / 10;
        if (chartInstance.options.scales.y1) {
          chartInstance.options.scales.y1.max = yAxisMax;
        }

        chartInstance.data.datasets.push({
          label: `ค่าพยากรณ์ DHW (${forecast.model_used})`,
          data: dhwByIndex,
          borderColor: '#c084fc',
          backgroundColor: '#c084fc22',
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 3,
          pointBackgroundColor: '#c084fc',
          fill: false,
          yAxisID: 'y1',
        });
        chartInstance.update();

        // อัปเดต forecast-bar list ทั้งหมดให้ใช้ความเสี่ยงจาก DHW จริง/พยากรณ์ครบทุกวัน
        // (แทนที่ค่าประมาณจาก SST เดิม ให้สอดคล้องกับแผนที่หลักที่ใช้ DHW เป็นเกณฑ์หลักเสมอ)
        // แยกให้ชัดระหว่าง "0.0 DHW" (มีข้อมูลจริง ค่าเป็นศูนย์ = ปลอดภัย, สีเขียว) กับ "ไม่มีข้อมูล" (สีเทา)
        // ป้าย fc-clf คือผลจาก Classifier (ระดับความเสี่ยง + ความมั่นใจ) — ทำงานควบคู่กับค่า DHW ของ Regressor ไม่แทนที่
        if (fcList) {
          fcList.innerHTML = dhwByIndex.map((dhwVal, idx) => {
            const clf = clfByIndex[idx];
            const clfBadge = clf
              ? `<span class="fc-clf" title="Classifier ทำนาย: ${clf.label} (${Math.round(clf.confidence * 100)}% มั่นใจ)">${Math.round(clf.confidence * 100)}%</span>`
              : `<span class="fc-clf"></span>`;

            if (dhwVal === null || typeof dhwVal !== 'number') {
              return `
                <div class="forecast-bar" data-idx="${idx}">
                  <span class="fc-date">${daily[idx].label}</span>
                  <div class="fc-bar-wrap"><div class="fc-bar-fill" style="width:0%;background:#3a4a5e;"></div></div>
                  <span class="fc-temp" style="color:#7aaddc;font-size:10px;">ไม่มีข้อมูล</span>
                  <span class="fc-risk">–</span>
                  ${clfBadge}
                </div>
              `;
            }
            const r = getRisk(undefined, dhwVal);
            const pct = Math.min(100, (dhwVal / 8) * 100);
            return `
              <div class="forecast-bar" data-idx="${idx}">
                <span class="fc-date">${daily[idx].label}</span>
                <div class="fc-bar-wrap"><div class="fc-bar-fill" style="width:${pct}%;background:${r.color};"></div></div>
                <span class="fc-temp" style="color:${r.color};">${dhwVal.toFixed(1)} DHW</span>
                <span class="fc-risk">${r.emoji}</span>
                ${clfBadge}
              </div>
            `;
          }).join('');
        }

        if (noteEl) noteEl.textContent = `📊 ความเสี่ยงด้านล่างคำนวณจาก DHW จริง/พยากรณ์รายวัน (โมเดล ${forecast.model_used}) ทุกวัน · กราฟเส้นด้านบนแสดง SST จาก Open-Meteo (~10 วันแรก) ควบคู่กัน · ควรใช้ร่วมกับคำแนะนำจากหน่วยงานที่เกี่ยวข้อง`;
      });
    }

    // Forecast bar list ด้านล่าง
    if (fcList) {
      // แท็บ 14 วัน: บอกให้ชัดว่าวันที่ 1-13 สีความเสี่ยงประมาณจาก SST เท่านั้น (ไม่ใช่ DHW แบบวันนี้/วันที่ 14)
      // กันสับสนกับสีบนแผนที่หลักที่ใช้ DHW เป็นเกณฑ์หลักเสมอเมื่อมีข้อมูล
      const caption = currentTab === '14d'
        ? `<div style="padding:6px 16px;font-size:9px;color:#7aaddc;opacity:0.8;border-bottom:1px solid rgba(100,160,255,0.08);line-height:1.5;">
             * สีความเสี่ยงวันที่ 1-10 ประมาณจาก SST เท่านั้น (ยังไม่ใช่ DHW จริงแบบวันนี้/แผนที่หลัก) · วันที่ 11-13 ไม่มีข้อมูลพยากรณ์เลย (เกินระยะที่ Open-Meteo ให้จริง) · วันที่ 14 ใช้ DHW จากโมเดลพยากรณ์จริง
           </div>`
        : '';

      fcList.innerHTML = caption + daily.map((d, idx) => {
        // วันที่เกินระยะพยากรณ์จริงของ Open-Meteo (~10 วัน) จะไม่มีข้อมูล SST
        // แต่วันสุดท้าย (index days-1) จะถูกเติมด้วยค่าพยากรณ์ DHW จากโมเดล ML แทนทีหลัง (ดู fetchDHWForecast ด้านบน)
        if (d.avg === null) {
          return `
            <div class="forecast-bar" data-idx="${idx}">
              <span class="fc-date">${d.label}</span>
              <div class="fc-bar-wrap"><div class="fc-bar-fill" style="width:0%;background:#3a4a5e;"></div></div>
              <span class="fc-temp" style="color:#7aaddc;font-size:10px;">ไม่มีข้อมูล</span>
              <span class="fc-risk">–</span>
            </div>
          `;
        }
        const r = getRisk(d.avg);
        const pct = Math.min(100, Math.max(0, ((d.avg - 26) / (33 - 26)) * 100));
        return `
          <div class="forecast-bar" data-idx="${idx}">
            <span class="fc-date">${d.label}</span>
            <div class="fc-bar-wrap"><div class="fc-bar-fill" style="width:${pct}%;background:${r.color};"></div></div>
            <span class="fc-temp" style="color:${r.color};">${d.avg.toFixed(1)}°</span>
            <span class="fc-risk">${r.emoji}</span>
          </div>
        `;
      }).join('');
    }
  }
}

function chartOptions(color, unit, includeDhwAxis) {
  const scales = {
    x: { ticks:{ color:'#7aaddc', font:{size:10,family:"'Space Mono'"} }, grid:{color:'rgba(100,160,255,0.07)'} },
    y: {
      ticks:{ color:'#7aaddc', font:{size:10,family:"'Space Mono'"}, callback: v => v.toFixed(1)+'°' },
      grid:{ color:'rgba(100,160,255,0.07)' }, min:26, max:33
    }
  };
  if (includeDhwAxis) {
    scales.y1 = {
      position: 'right', min: 0,
      ticks:{ color:'#c084fc', font:{size:10,family:"'Space Mono'"} },
      grid:{ display:false },
      title:{ display:true, text:'DHW (°C·weeks)', color:'#c084fc', font:{size:9} }
    };
  }
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    plugins: {
      legend: { labels: { color:'#7aaddc', font:{ family:"'Kanit',sans-serif", size:11 }, boxWidth:12 } },
      tooltip: {
        backgroundColor:'#0f2040', titleColor:'#00d4ff', bodyColor:'#e8f4ff',
        borderColor:'#00d4ff33', borderWidth:1,
        callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1'
          ? ` ${ctx.parsed.y.toFixed(2)} DHW`
          : ` ${ctx.parsed.y.toFixed(2)} °C` }
      }
    },
    scales
  };
}

// ===== พยากรณ์ DHW ล่วงหน้า 14 วัน (โมเดล ML จาก train_model.py เรียกผ่าน /api/predict) =====
const forecastCache = {};

async function fetchDHWForecast(reef) {
  if (forecastCache[reef.id]) return forecastCache[reef.id];
  try {
    const res = await fetch(`/api/predict?lat=${reef.lat}&lon=${reef.lon}`);
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'พยากรณ์ไม่สำเร็จ');
    forecastCache[reef.id] = json;
    return json;
  } catch (err) {
    console.warn(`⚠️ พยากรณ์ DHW ${reef.name} ไม่สำเร็จ:`, err.message);
    return null;
  }
}

function closeChartPanel() {
  document.getElementById('chart-panel').classList.add('hidden');
  currentChartReefId = null;
}

// ===== Stats =====
function updateStatCounts() {
  const counts = [0,0,0,0];
  Object.values(markers).forEach(m => counts[m.risk.level]++);
  document.getElementById('stat-low').querySelector('.stat-num').textContent  = counts[0];
  document.getElementById('stat-mid').querySelector('.stat-num').textContent  = counts[1];
  document.getElementById('stat-high').querySelector('.stat-num').textContent = counts[2];
  document.getElementById('stat-crit').querySelector('.stat-num').textContent = counts[3];
  document.getElementById('last-update').textContent = `อัปเดต: ${new Date().toLocaleTimeString('th-TH', { hour12: false })}`;
}

function updateStats() {
  updateStatCounts();
  document.getElementById('stats-box').classList.remove('hidden');

  const badge = document.getElementById('status-badge');
  badge.className = 'badge ok';
  document.getElementById('status-text').textContent = 'พร้อมเฝ้าระวังจากข้อมูล Open-Meteo';
}

function startLiveClock() {
  const el = document.getElementById('last-update');
  if (!el) return;
  const updateClock = () => {
    const now = new Date();
    el.textContent = `อัปเดต: ${now.toLocaleTimeString('th-TH', { hour12: false })}`;
  };
  updateClock();
  setInterval(updateClock, 1000);
}

// ===== Skeleton =====
function addSkeletons() {
  const list = document.getElementById('reef-list');
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div');
    s.className = 'reef-skeleton'; s.id = `skel-${i}`;
    s.innerHTML = `<div class="skel skel-circle"></div><div class="skel skel-text"></div>`;
    list.appendChild(s);
  }
}
function removeSkeleton(i) { document.getElementById(`skel-${i}`)?.remove(); }

// ===== Fetch SST (14 วัน) =====
// หมายเหตุ: DHW ไม่รวมอยู่ในนี้โดยตั้งใจ — ดึงแยกผ่าน fetchAndApplyDHW()
// เพื่อไม่ให้ NOAA server ที่อาจช้า/ไม่ตอบสนอง บล็อกการแสดงผลแผนที่หลัก
async function fetchSST(reef) {
  const [marineRes, weatherRes] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine`
      + `?latitude=${reef.lat}&longitude=${reef.lon}`
      + `&hourly=sea_surface_temperature&forecast_days=14`),
    fetch(`https://api.open-meteo.com/v1/forecast`
      + `?latitude=${reef.lat}&longitude=${reef.lon}`
      + `&hourly=uv_index&forecast_days=1`)
  ]);

  const marine  = await marineRes.json();
  const weather = await weatherRes.json();

  const sst   = marine.hourly.sea_surface_temperature[0];
  const temps = marine.hourly.sea_surface_temperature;
  const times = marine.hourly.time;
  const uv    = weather.hourly.uv_index[0];

  return { sst, temps, times, uv };
}

// ===== MAIN =====
async function loadAllReefs() {
  createAlertContainer();

  // เพิ่ม Tab bar + Forecast list เข้า chart panel
  const panel = document.getElementById('chart-panel');
  const header = panel.querySelector('.chart-header');
  const tabDiv = document.createElement('div');
  tabDiv.id = 'tab-bar';
  tabDiv.innerHTML = buildTabBar(null);
  header.after(tabDiv);

  // Forecast list container
  const fcList = document.createElement('div');
  fcList.id = 'forecast-list';
  fcList.style.cssText = `
    overflow-y:auto; max-height:200px; display:none;
    border-top:1px solid rgba(100,160,255,0.1);
  `;
  panel.querySelector('.chart-note').before(fcList);

  // ห่อ chart-wrap ให้ flex
  const chartWrap = panel.querySelector('.chart-wrap');
  chartWrap.id = 'chart-wrap-outer';
  chartWrap.style.display = 'flex';
  chartWrap.style.alignItems = 'center';
  chartWrap.style.justifyContent = 'center';

  addSkeletons();
  const alertReefs = [];

  for (let i = 0; i < REEFS.length; i++) {
    const reef = REEFS[i];
    try {
     const { sst, temps, times, uv } = await fetchSST(reef);
      const risk = getRisk(sst);
      removeSkeleton(i);
      createMarker(reef, sst, temps, times, uv, undefined); // dhw: กำลังโหลด
      fetchAndApplyDHW(reef);
      addReefToSidebar(reef, sst, risk, i * 60);
      if (sst >= ALERT_THRESHOLD) alertReefs.push({ reef, sst, risk });
      loadedCount++;
      document.getElementById('reef-count').textContent = `${loadedCount}/8`;
    } catch (err) {
      removeSkeleton(i);
      console.error(`❌ ${reef.name}:`, err);
      const fb = 28 + Math.random() * 4;
      const fbTemps = Array.from({length:336}, () => 28 + Math.random() * 4);
      const fbTimes = Array.from({length:336}, (_,i) => {
        const d = new Date(); d.setHours(d.getHours() + i);
        return d.toISOString();
      });
      const risk = getRisk(fb);
      createMarker(reef, fb, fbTemps, fbTimes, null, undefined);
      fetchAndApplyDHW(reef);
      addReefToSidebar(reef, fb, risk, i * 60);
      if (fb >= ALERT_THRESHOLD) alertReefs.push({ reef, sst: fb, risk });
      loadedCount++;
      document.getElementById('reef-count').textContent = `${loadedCount}/8`;
    }
  }

  const overlay = document.getElementById('map-overlay');
  overlay.classList.add('hidden');
  setTimeout(() => overlay.remove(), 600);

  updateStats();
  setTimeout(() => triggerAlerts(alertReefs), 1000);
}
// ===== CHATBOT =====
let chatHistory = [];

function toggleChat() {
  const win = document.getElementById('chat-window');
  win.classList.toggle('open');
  if (win.classList.contains('open')) {
    document.getElementById('chat-input').focus();
  }
}

// Chat feature disabled - Gemini API rate limited
// async function sendChat() {
//   // Feature temporarily disabled
// }

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  // แสดงข้อความ user
  addMsg(text, 'user');
  input.value = '';
  input.disabled = true;
  document.querySelector('#chat-input-row button').disabled = true;

  // แสดง typing...
  const typingEl = addMsg('กำลังคิด...', 'typing');

  // เพิ่ม history
  chatHistory.push({ role: 'user', parts: [{ text }] });

  try {
    // เรียก backend server แทนที่จะเรียก Gemini API โดยตรง
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatHistory })
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const data = await res.json();
    const reply = data.reply || 'ขออภัย ไม่สามารถตอบได้ขณะนี้ครับ';

    chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    typingEl.remove();
    addMsg(reply, 'bot');

  } catch (err) {
    typingEl.remove();
    addMsg('❌ เชื่อมต่อ server ไม่ได้ ลองใหม่อีกครั้งครับ', 'bot');
    console.error('Chat error:', err);
  }

  input.disabled = false;
  document.querySelector('#chat-input-row button').disabled = false;
  input.focus();
}

function addMsg(text, type) {
  const box = document.getElementById('chat-messages');
  const el  = document.createElement('div');
  el.className = `msg ${type}`;
  el.innerHTML = text.replace(/\n/g, '<br>');
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

loadAllReefs();
startLiveClock();