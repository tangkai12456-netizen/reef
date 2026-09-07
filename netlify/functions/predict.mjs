// ============================================================
//  GET /api/predict?lat=<lat>&lon=<lon>
//  แทนที่ของเดิมใน server.js ที่ spawn predict.py ทุกครั้งที่มีคนเรียก
//
//  บน Netlify รันแบบนั้นไม่ได้ — ไม่มี Python runtime, Functions จำกัด 50 MB
//  (โมเดลรวมกัน 450 MB) และ timeout 10 วินาที (ของเดิมตั้งไว้ 50 วินาที)
//  จึงเปลี่ยนเป็นอ่านผลที่ precompute_forecasts.py คำนวณไว้ล่วงหน้าใน MongoDB
//
//  รูปแบบ JSON ที่คืนเหมือนเดิมทุกฟิลด์ frontend (app.js) ไม่ต้องแก้อะไรเลย
// ============================================================

import { MongoClient } from 'mongodb';

// พิกัดที่ frontend ส่งมาเป็นค่าคงที่จาก REEFS ใน app.js ซึ่งตรงกับที่เก็บไว้อยู่แล้ว
// เผื่อ tolerance ไว้กันปัญหาปัดเศษของ float ตอนวิ่งผ่าน query string
const COORD_TOLERANCE = 0.01;

// เก็บ client ไว้ใช้ซ้ำข้าม invocation ที่ตกอยู่ใน container เดิม
// ถ้า new MongoClient() ใหม่ทุกครั้งที่มีคนเรียก จะเปิด connection ใหม่เรื่อยๆ
// จนชนเพดาน 500 connections ของ Atlas free tier ภายในไม่กี่นาที
let clientPromise;

function getClient() {
  if (!clientPromise) {
    const uri = Netlify.env.get('MONGODB_URI');
    if (!uri) throw new Error('MONGODB_URI_MISSING');
    clientPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
      .connect()
      .catch((err) => {
        // ถ้าไม่ล้าง promise ที่ reject ทิ้ง container นี้จะใช้ตัวเดิมซ้ำตลอด
        clientPromise = undefined;
        throw err;
      });
  }
  return clientPromise;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'ต้องระบุ lat และ lon เป็นตัวเลข' }, 400);
  }

  try {
    const client = await getClient();
    const db = client.db(Netlify.env.get('MONGODB_DB') || 'reefalert');

    const doc = await db.collection('forecasts').findOne({
      lat: { $gte: lat - COORD_TOLERANCE, $lte: lat + COORD_TOLERANCE },
      lon: { $gte: lon - COORD_TOLERANCE, $lte: lon + COORD_TOLERANCE },
    });

    if (!doc) {
      return json({ error: `ยังไม่มีผลพยากรณ์ของพิกัด ${lat}, ${lon}` }, 404);
    }

    // ไม่ส่ง _id ออกไป — เป็นรายละเอียดภายในของ DB ที่ frontend ไม่ได้ใช้
    const { _id, ...payload } = doc;
    return json(payload);
  } catch (err) {
    // ไม่ปั้นข้อมูลพยากรณ์ปลอมส่งกลับเด็ดขาด ให้ frontend รู้ว่าพังจริง
    console.error('อ่านผลพยากรณ์จาก MongoDB ไม่สำเร็จ:', err);
    const detail =
      err.message === 'MONGODB_URI_MISSING'
        ? 'ยังไม่ได้ตั้งค่า MONGODB_URI'
        : err.name === 'MongoServerSelectionError'
          ? 'ต่อ MongoDB ไม่ได้ (มักเกิดจาก IP ไม่อยู่ใน Network Access ของ Atlas)'
          : err.name === 'MongoServerError'
            ? 'MongoDB ปฏิเสธ (ตรวจ user/รหัสผ่านใน MONGODB_URI)'
            : err.name;
    return json({ error: 'พยากรณ์ไม่สำเร็จ', detail }, 500);
  }
};

export const config = {
  path: '/api/predict',
};
