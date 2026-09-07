// ============================================================
//  GET /api/predict?lat=<lat>&lon=<lon>   (Vercel)
//  ฝาแฝดของ netlify/functions/predict.mjs — ตรรกะเดียวกันทุกอย่าง
//  ต่างกันแค่รูปแบบ handler และวิธีอ่าน env ของแต่ละแพลตฟอร์ม
//
//  อ่านผลที่ precompute_forecasts.py คำนวณไว้ล่วงหน้าใน MongoDB
//  ไม่ได้รันโมเดลสดๆ เพราะ .pkl รวมกันราว 450 MB เกินขีดจำกัด serverless ทุกเจ้า
// ============================================================

import { MongoClient } from 'mongodb';

const COORD_TOLERANCE = 0.01;

// เก็บ client ไว้ใช้ซ้ำข้าม invocation ที่ตกอยู่ใน container เดิม
// ถ้าต่อใหม่ทุก request จะชนเพดาน 500 connections ของ Atlas free tier
let clientPromise;

function getClient() {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('ไม่ได้ตั้งค่า MONGODB_URI');
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

export default async function handler(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'ต้องระบุ lat และ lon เป็นตัวเลข' });
  }

  try {
    const client = await getClient();
    const db = client.db(process.env.MONGODB_DB || 'reefalert');

    const doc = await db.collection('forecasts').findOne({
      lat: { $gte: lat - COORD_TOLERANCE, $lte: lat + COORD_TOLERANCE },
      lon: { $gte: lon - COORD_TOLERANCE, $lte: lon + COORD_TOLERANCE },
    });

    if (!doc) {
      return res.status(404).json({ error: `ยังไม่มีผลพยากรณ์ของพิกัด ${lat}, ${lon}` });
    }

    const { _id, ...payload } = doc;
    return res.status(200).json(payload);
  } catch (err) {
    // ไม่ปั้นข้อมูลพยากรณ์ปลอมส่งกลับเด็ดขาด ให้ frontend รู้ว่าพังจริง
    console.error('อ่านผลพยากรณ์จาก MongoDB ไม่สำเร็จ:', err);
    return res.status(500).json({ error: 'พยากรณ์ไม่สำเร็จ (database error)' });
  }
}
