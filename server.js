// ============================================================
//  ReefAlert Backend Server
//  ReefBot ตอบด้วย Gemini API (จริง) โดยมี Local Knowledge Base เป็นตัวสำรอง
//  อัตโนมัติเมื่อ Gemini เรียกไม่ได้ (โควต้าหมด/เน็ตล่ม) กันบอทเงียบไปเฉยๆ
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');
require('dotenv').config();

// สมองของ ReefBot แยกไปอยู่ lib/reefbot.js เพื่อให้ Netlify Function ใช้ชุดเดียวกันได้
const { askGemini, findResponse } = require('./lib/reefbot');

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS)
// หมายเหตุ: dhw_model_meta.json / dhw_models_multi_meta.json ถูกเสิร์ฟแบบ static ไปด้วย
// หน้า /methodology ใช้ fetch() ดึงไฟล์เหล่านี้ตรงๆ เพื่อโชว์ค่าจริงจากการเทรน ไม่ hardcode
app.use(express.static(__dirname));

// หน้าอธิบายวิธีการทำงานของระบบ
app.get(['/methodology', '/about'], (req, res) => {
  res.sendFile(path.join(__dirname, 'methodology.html'));
});

// ศูนย์ความรู้ปะการังฟอกขาว — แยกออกมาจากแถบข้างของหน้าแผนที่
app.get(['/knowledge', '/kb'], (req, res) => {
  res.sendFile(path.join(__dirname, 'knowledge.html'));
});


// ===== Chat Endpoint (Gemini + Local KB fallback) =====
app.post('/api/chat', async (req, res) => {
  try {
    const { chatHistory } = req.body;

    if (!chatHistory || !Array.isArray(chatHistory)) {
      return res.status(400).json({ error: 'Invalid chat history' });
    }

    // Get the last user message
    const lastMessage = chatHistory[chatHistory.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return res.status(400).json({ error: 'No user message found' });
    }

    if (GEMINI_API_KEY) {
      try {
        const reply = await askGemini(chatHistory, GEMINI_API_KEY);
        return res.json({ reply, source: 'gemini' });
      } catch (err) {
        console.warn('⚠️ Gemini ใช้งานไม่ได้ ใช้ local knowledge base แทน:', err.message);
      }
    }

    // Fallback: local keyword-matching knowledge base
    const userText = lastMessage.parts[0]?.text || '';
    const reply = findResponse(userText);
    res.json({ reply, source: 'local' });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ===== DHW Forecast Endpoint (พยากรณ์ล่วงหน้า 14 วันด้วยโมเดล ML ที่เทรนไว้ใน train_model.py) =====
// เรียก predict.py เป็น subprocess เพราะ Node.js รันโมเดล scikit-learn (.pkl) เองตรงๆ ไม่ได้
app.get('/api/predict', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'ต้องระบุ lat และ lon เป็นตัวเลข' });
  }

  execFile(
    'python',
    ['predict.py', String(lat), String(lon)],
    { cwd: __dirname, timeout: 50000 }, // เผื่อเวลาให้ requests.get ใน predict.py (timeout 25 วิ) บวก overhead โหลดโมเดล/inference
    (err, stdout, stderr) => {
      // predict.py พิมพ์ JSON ออก stdout เสมอ ทั้งตอนสำเร็จและตอน error (exit code 1)
      // ไม่ปั้นข้อมูลพยากรณ์ปลอมส่งกลับเด็ดขาด — ถ้าพังให้ frontend รู้ว่าพังจริง
      if (err) {
        try {
          return res.status(422).json(JSON.parse(stdout));
        } catch {
          console.error('❌ predict.py subprocess ล้มเหลว:', err.message, stderr);
          return res.status(500).json({ error: 'พยากรณ์ไม่สำเร็จ (subprocess error)' });
        }
      }
      try {
        res.json(JSON.parse(stdout));
      } catch {
        console.error('❌ predict.py ส่งค่ากลับมาไม่ใช่ JSON ที่ถูกต้อง:', stdout);
        res.status(500).json({ error: 'พยากรณ์ไม่สำเร็จ (invalid response)' });
      }
    }
  );
});

// Favicon endpoint (avoid 404 errors)
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🪸 ReefAlert server running on port ${PORT}`);
  console.log(`📍 Open http://localhost:${PORT} in your browser`);
});
