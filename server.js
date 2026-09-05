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

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ไล่ลองทีละรุ่นถ้ารุ่นแรกไม่ว่าง — flash-latest เป็นรุ่นหลัก ที่เหลือเป็นตัวสำรอง
// (เจอจริงว่า flash-latest คืน 503 "overloaded" เป็นช่วงๆ ราว 1 ใน 4 ครั้ง)
// ทั้ง 3 รุ่นนี้ทดสอบแล้วว่า key ปัจจุบันเรียกได้จริงและรับ thinkingBudget:0
// (อย่าใส่ gemini-2.5-* / gemini-flash-lite-latest / gemini-3.6-flash — คืน 404 หรือ 400 กับ config นี้)
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const GEMINI_SYSTEM_INSTRUCTION = `คุณคือ ReefBot ผู้ช่วย AI ของแอป ReefAlert ระบบเฝ้าระวังปะการังฟอกขาวในน่านน้ำไทย
ตอบเป็นภาษาไทย น้ำเสียงเป็นมิตร กระชับ ไม่ยาวเกินไป
เชี่ยวชาญเรื่อง: ปะการังฟอกขาว, DHW (Degree Heating Weeks), SST (อุณหภูมิผิวน้ำทะเล), ระดับความเสี่ยงตามเกณฑ์ NOAA Coral Reef Watch, แนวปะการังในไทย, การอนุรักษ์ปะการัง, ผลกระทบจากโลกร้อน
ถ้าถูกถามเรื่องนอกเหนือจากปะการัง/ทะเล/สิ่งแวดล้อม ให้ตอบสุภาพว่าคุณเชี่ยวชาญเฉพาะด้านนี้ แล้วชวนกลับมาคุยเรื่องปะการังแทน`;

// สถานะที่ "ลองซ้ำโมเดลเดิมแล้วมีโอกาสสำเร็จ" — ฝั่ง Google ขัดข้อง/คิวเต็มชั่วคราว
// 400/401/403 ไม่รวมอยู่ในนี้เพราะลองกี่ครั้งก็ได้ผลเดิม (key ผิด/หมดอายุ) ต้องรีบ fallback ทันที
const GEMINI_RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ยิง Gemini หนึ่งครั้งด้วยโมเดลที่ระบุ — โยน error ที่ติด .status ไว้ให้ตัวเรียกตัดสินใจว่าจะ retry ไหม
// ปิด thinking (ไม่จำเป็นกับแชทบอทตอบคำถามทั่วไป ช่วยให้เร็วขึ้นมาก)
// timeout 20 วิ กันค้างถ้า Google ไม่ตอบ (พบว่า latency จริงบางครั้งขึ้นถึง ~15-18 วิ)
async function callGeminiOnce(model, chatHistory) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }] },
          contents: chatHistory,
          generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      const err = new Error(`Gemini API status ${res.status} (${model})`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Gemini ไม่ส่งข้อความกลับมา (${model})`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// เรียก Gemini แบบทนต่อความขัดข้องชั่วคราว — แยกจัดการ error เป็น 4 กลุ่ม:
//   • 500/502/503/504 + timeout → Google ขัดข้องชั่วคราว ลองซ้ำโมเดลเดิมได้ (backoff 0.4s → 0.8s)
//   • 429 → โควต้าต่อนาทีของ "โมเดลนั้น" เต็ม ยิงซ้ำในนาทีเดียวกันยังไงก็ไม่ผ่าน
//     ข้ามไปโมเดลถัดไปทันที (แต่ละโมเดลมีโควต้าแยกกัน) แทนการยิงซ้ำให้โควต้าแย่ลง
//   • 400/404 → เป็นปัญหาเฉพาะโมเดลนั้น (รุ่นถูกถอด/ไม่รับ config นี้) ข้ามไปรุ่นถัดไป
//   • 401/403 → key ผิดหรือสิทธิ์ไม่พอ ทุกรุ่นก็พังเหมือนกัน เลิกทันทีไปใช้ local KB
async function askGemini(chatHistory) {
  const ATTEMPTS_PER_MODEL = 3;
  let lastErr;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      try {
        return await callGeminiOnce(model, chatHistory);
      } catch (err) {
        lastErr = err;

        // key ใช้ไม่ได้ — ลองรุ่นอื่นก็ไม่ช่วย ออกทันที
        if (err.status === 401 || err.status === 403) throw err;

        // โควต้าเต็ม / รุ่นนี้มีปัญหาเฉพาะตัว — เลิกกับรุ่นนี้ ไปลองรุ่นถัดไป
        if (err.status === 429 || err.status === 400 || err.status === 404) break;

        // timeout/เน็ตหลุด (ไม่มี .status) ถือว่าเป็นเรื่องชั่วคราว ลองใหม่ได้
        const isTransient = err.status === undefined || GEMINI_RETRYABLE_STATUS.has(err.status);
        if (!isTransient) break;

        // ครั้งสุดท้ายของรุ่นนี้แล้ว — ไม่ต้องหน่วง ข้ามไปรุ่นถัดไปเลย
        if (attempt < ATTEMPTS_PER_MODEL - 1) {
          await sleep(400 * 2 ** attempt);
        }
      }
    }
    console.warn(`⚠️ Gemini รุ่น ${model} ใช้ไม่ได้ (${lastErr.message}) ลองรุ่นถัดไป`);
  }

  throw lastErr;
}

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

// ===== Local Knowledge Base for ReefBot =====
// จัดเป็นหัวข้อ + คีย์เวิร์ดหลายคำต่อหัวข้อ แล้วให้คะแนนตามจำนวนคีย์เวิร์ดที่ตรงกับข้อความ
// (แม่นกว่าการ "เจอคำแรกแล้วตอบเลย" แบบเดิม เพราะข้อความที่พูดถึงหลายเรื่องจะได้คำตอบตามหัวข้อที่เกี่ยวข้องที่สุด)
const REEFBOT_KB = [
  {
    id: 'greeting',
    keywords: ['สวัสดี', 'หวัดดี', 'หวัดดีครับ', 'หวัดดีค่ะ', 'hello', 'hi', 'เริ่มยังไง'],
    reply: `สวัสดีครับ! 🪸 ผม ReefBot ผู้ช่วยเรื่องปะการังของ ReefAlert

ถามผมได้เลยเรื่อง:
• ปะการังฟอกขาวคืออะไร เกิดจากอะไร
• DHW / SST คืออะไร วัดยังไง
• แนวปะการังไทยที่ไหนน่าไปดำน้ำ
• วิธีอนุรักษ์และช่วยเหลือปะการัง
• ระดับความเสี่ยงตอนนี้อ่านยังไง
• เจอปะการังฟอกขาวควรแจ้งใคร`
  },
  {
    id: 'thanks',
    keywords: ['ขอบคุณ', 'ขอบใจ', 'thank', 'thx', 'เยี่ยมเลย', 'เจ๋ง', 'สุดยอด'],
    reply: `ยินดีครับ! 🪸 มีคำถามอื่นเกี่ยวกับปะการังหรือทะเลไทยถามมาได้เลยนะครับ`
  },
  {
    id: 'bleaching',
    keywords: ['ฟอกขาว', 'bleaching', 'ปะการังตาย', 'ปะการังขาว', 'ปะการังซีด', 'ทำไมปะการังขาว'],
    reply: `🌡️ **ปะการังฟอกขาว (Coral Bleaching)**

เกิดขึ้นเมื่ออุณหภูมิน้ำทะเลสูงผิดปกติต่อเนื่องเป็นเวลานาน ทำให้ปะการังเครียดและขับสาหร่ายซูแซนเทลลี (zooxanthellae) ที่อาศัยอยู่ร่วมกันแบบพึ่งพาออกไป

**ทำไมถึงกลายเป็นสีขาว?** สาหร่ายกลุ่มนี้ให้ทั้งสีสันและอาหารแก่ปะการังถึงราว 90% เมื่อถูกขับออก จะเหลือแต่โครงหินปูนสีขาวโปร่งแสงให้เห็น

**ผลที่ตามมา:**
- ถ้าอุณหภูมิลดลงเร็วพอ ปะการังรับสาหร่ายกลับมาและฟื้นตัวได้ ✅
- ถ้าความร้อนสะสมนานเกินไป (ดูค่า DHW) ปะการังจะอดอาหารและตายในที่สุด ❌
- แม้รอดชีวิต ปะการังที่ฟอกขาวก็อ่อนแอลง เสี่ยงต่อโรคและถูกสาหร่ายอื่นปกคลุมง่ายขึ้น

ลองถาม "DHW คืออะไร" เพื่อดูวิธีวัดความเสี่ยงต่อได้เลยครับ`
  },
  {
    id: 'dhw',
    keywords: ['dhw', 'degree heating', 'ความร้อนสะสม', 'noaa'],
    reply: `📊 **DHW (Degree Heating Weeks)**

คือค่าวัด "ความร้อนสะสม" ของน้ำทะเลย้อนหลัง 12 สัปดาห์ เทียบกับอุณหภูมิสูงสุดเฉลี่ยรายเดือนปกติของพื้นที่นั้น (Maximum Monthly Mean) — เป็นมาตรฐานที่ NOAA Coral Reef Watch ใช้ประเมินความเสี่ยงฟอกขาวจริง แม่นยำกว่าดูอุณหภูมิ ณ ขณะเดียวมาก เพราะปะการังจะเครียดก็ต่อเมื่อร้อน "ต่อเนื่อง" ไม่ใช่ร้อนวันเดียว

**เกณฑ์ Bleaching Alert:**
🟢 DHW < 1 — ปกติ (No Stress)
🟡 DHW 1–3.9 — เฝ้าระวัง (Bleaching Watch)
🟠 DHW 4–7.9 — เสี่ยงฟอกขาวสูง (Alert Level 1)
🔴 DHW ≥ 8 — วิกฤต ปะการังฟอกขาว/ตายเป็นวงกว้าง (Alert Level 2)

ในแอป ReefAlert ตัวเลข DHW ที่โชว์แต่ละเกาะดึงมาจากดาวเทียม NOAA Coral Reef Watch โดยตรงครับ`
  },
  {
    id: 'sst',
    keywords: ['อุณหภูมิ', 'temperature', 'sst', 'น้ำทะเลร้อน', 'น้ำอุ่น'],
    reply: `🌊 **SST (Sea Surface Temperature)**

คืออุณหภูมิผิวน้ำทะเล ตัวแปรสำคัญที่สุดต่อสุขภาพปะการัง โดยทั่วไปในทะเลไทย:

- 28–29°C: ปกติ ปะการังสบายดี ✅
- 29–30°C: เริ่มเครียด ควรเริ่มติดตาม 🟡
- 30–30.9°C: เสี่ยงสูง เริ่มมีการฟอกขาว 🟠
- 31°C ขึ้นไป: วิกฤต ปะการังฟอกขาว/ตายเป็นวงกว้าง 🔴

ข้อควรรู้: SST เป็นค่า ณ ขณะนั้น ต่างจาก **DHW** ที่วัดความร้อนสะสมย้อนหลัง — บางครั้ง SST อาจสูงชั่วคราวแต่ DHW ยังต่ำได้ ถ้ายังไม่ร้อนต่อเนื่องนานพอ ลองถาม "DHW คืออะไร" เพื่อดูรายละเอียดเพิ่มครับ`
  },
  {
    id: 'risk_level',
    keywords: ['ความเสี่ยง', 'risk', 'ระดับความเสี่ยง', 'สีเขียว', 'สีแดง', 'สีส้ม', 'สีเหลือง'],
    reply: `⚠️ **ระดับความเสี่ยงในแอป ReefAlert**

ตอนนี้ระบบใช้ **DHW เป็นเกณฑ์หลัก** (มาตรฐานสากลของ NOAA) และใช้ SST เป็นตัวประมาณชั่วคราวถ้ายังไม่มีข้อมูล DHW:

🟢 ต่ำ — DHW < 1 (ไม่มีความเครียดจากความร้อน)
🟡 ปานกลาง — DHW 1–3.9 (เริ่มสะสมความร้อน ควรเฝ้าระวัง)
🟠 สูง — DHW 4–7.9 (เสี่ยงฟอกขาวจริง)
🔴 วิกฤต — DHW ≥ 8 (ฟอกขาว/ตายเป็นวงกว้าง)

คลิกที่จุดสีบนแผนที่เพื่อดูรายละเอียดของแต่ละเกาะ พร้อมคำแนะนำการรับมือที่เหมาะกับระดับนั้นๆ ได้เลยครับ`
  },
  {
    id: 'reefs_thailand',
    keywords: ['สิมิลัน', 'เต่า', 'หลีเป๊ะ', 'สมุย', 'ช้าง', 'พีพี', 'ราชา', 'ตะรุเตา', 'แนวปะการัง', 'ดำน้ำ', 'อันดามัน', 'อ่าวไทย'],
    reply: `🪸 **แนวปะการังในไทย**

**ฝั่งอันดามัน:** สิมิลัน, หลีเป๊ะ, พีพี (Shark Point), ราชา, ตะรุเตา
**ฝั่งอ่าวไทย:** เต่า, สมุย (Coral Cove), ช้าง

**แนะนำแต่ละที่:**
- 🏝️ **หมู่เกาะสิมิลัน** — ปะการังสวยงามที่สุดแห่งหนึ่งของไทย สวนปะการังชั้นดี น้ำใสมาก
- 🤿 **เกาะเต่า** — จุด snorkeling/ดำน้ำยอดนิยม ความลึก 20–30m เหมาะกับนักดำน้ำมีประสบการณ์
- 🐢 **เกาะช้าง** — น้ำตื้น เหมาะกับมือใหม่และครอบครัว
- 🦈 **เกาะพีพี (Shark Point)** — จุดดำน้ำขึ้นชื่อ มีโอกาสเจอปลาฉลาม
- 🌊 **เกาะหลีเป๊ะ, ราชา, ตะรุเตา** — ปะการังน้ำใส เหมาะกับทริปดำน้ำหลากระดับ

ลองคลิกที่แต่ละเกาะบนแผนที่เพื่อดูข้อมูล SST/DHW/ความเสี่ยงแบบเรียลไทม์ได้เลยครับ`
  },
  {
    id: 'conservation',
    keywords: ['อนุรักษ์', 'conservation', 'ปกป้อง', 'ช่วยปะการัง', 'ช่วยเหลือ'],
    reply: `💚 **วิธีช่วยเหลือ/อนุรักษ์แนวปะการัง**

- 🧴 ใช้ครีมกันแดดสูตรปลอดภัยต่อปะการัง (ไม่มี oxybenzone / octinoxate)
- 🚫 หลีกเลี่ยงการเดิน จับ หรือยืนบนปะการัง แม้จะดูเหมือนหินก็ตาม
- 🎣 ไม่เก็บปะการัง เปลือกหอย หรือสิ่งมีชีวิตในแนวปะการังกลับบ้าน
- ⚓ เลือกผู้ให้บริการทัวร์ที่ทอดสมอในจุดที่กำหนด ไม่ทอดสมอทับแนวปะการัง
- 🔇 ลดเสียงและการรบกวนใต้น้ำขณะดำน้ำ/ดำผิวน้ำ
- 🤝 สนับสนุนมูลนิธิและศูนย์ฟื้นฟูปะการังในพื้นที่
- 📢 แจ้งเจ้าหน้าที่ทันทีถ้าเจอปะการังฟอกขาวหรือถูกทำลาย (ลองถามผมว่า "เจอปะการังฟอกขาวแจ้งใคร")`
  },
  {
    id: 'report_hotline',
    keywords: ['แจ้ง', 'สายด่วน', 'hotline', 'ร้องเรียน', 'เจอปะการังฟอกขาว', 'ทำยังไงดี'],
    reply: `📞 **เจอปะการังฟอกขาวหรือถูกทำลาย แจ้งใครดี?**

- โทรแจ้ง **กรมทรัพยากรทางทะเลและชายฝั่ง (ทช.)** สายด่วน **1362**
- 📸 ถ่ายภาพและบันทึกพิกัด (GPS) ของจุดที่พบไว้เป็นหลักฐาน
- แจ้งเจ้าหน้าที่อุทยานแห่งชาติทางทะเลในพื้นที่นั้นๆ ด้วยถ้าอยู่ในเขตอุทยาน
- ถ้าเป็นไปได้ ลองสังเกตว่าปะการังฟอกขาวเป็นวงกว้างแค่ไหน จะช่วยให้เจ้าหน้าที่ประเมินสถานการณ์ได้เร็วขึ้น`
  },
  {
    id: 'why_important',
    keywords: ['ทำไมปะการังสำคัญ', 'ประโยชน์ปะการัง', 'ปะการังสำคัญยังไง', 'ปะการังมีประโยชน์'],
    reply: `🐠 **ทำไมปะการังถึงสำคัญ**

- เป็นบ้านของสิ่งมีชีวิตทางทะเลกว่า 25% ของทั้งหมด ทั้งที่ปะการังครอบคลุมพื้นที่มหาสมุทรไม่ถึง 1%
- ช่วยป้องกันคลื่นและการกัดเซาะชายฝั่ง เป็นเกราะธรรมชาติให้ชุมชนชายฝั่ง
- เป็นแหล่งอาหารและรายได้ให้ชาวประมงหลายล้านคนทั่วโลก
- ดึงดูดนักท่องเที่ยว สร้างรายได้มหาศาลให้เศรษฐกิจท่องเที่ยวไทย
- เป็นแหล่งค้นคว้ายาและสารชีวภาพใหม่ๆ ทางการแพทย์

การฟอกขาวของปะการังจึงไม่ใช่แค่เรื่องความสวยงาม แต่กระทบทั้งระบบนิเวศและเศรษฐกิจครับ`
  },
  {
    id: 'climate_change',
    keywords: ['โลกร้อน', 'climate change', 'ภาวะโลกร้อน', 'น้ำทะเลร้อนขึ้น', 'สาเหตุ'],
    reply: `🌍 **ทำไมน้ำทะเลถึงร้อนขึ้น**

สาเหตุหลักคือ**ภาวะโลกร้อน (Climate Change)** จากการปล่อยก๊าซเรือนกระจกสะสมในชั้นบรรยากาศ มหาสมุทรดูดซับความร้อนส่วนเกินไว้กว่า 90% ทำให้อุณหภูมิน้ำทะเลเฉลี่ยสูงขึ้นเรื่อยๆ

ปรากฏการณ์เช่น **El Niño** ยังซ้ำเติมให้บางปีน้ำทะเลร้อนผิดปกติเป็นพิเศษ ทำให้เกิดเหตุการณ์ปะการังฟอกขาวครั้งใหญ่ (mass bleaching) เป็นระลอกทั่วโลก

นี่คือเหตุผลที่ ReefAlert ติดตามค่า SST และ DHW แบบต่อเนื่อง เพื่อแจ้งเตือนล่วงหน้าก่อนสถานการณ์จะรุนแรงครับ`
  },
  {
    id: 'app_howto',
    keywords: ['แอปนี้', 'reefalert', 'ใช้งานยังไง', 'ระบบนี้คืออะไร', 'ข้อมูลมาจากไหน'],
    reply: `🪸 **ReefAlert คืออะไร**

ระบบพยากรณ์และเฝ้าระวังความเสี่ยงปะการังฟอกขาวในน่านน้ำไทย รวบรวมข้อมูล:

- 🌡️ **SST** จาก Open-Meteo Marine API (พยากรณ์ล่วงหน้า 14 วัน)
- 📊 **DHW** จาก NOAA Coral Reef Watch (ดาวเทียม)
- ☀️ **UV Index** จาก Open-Meteo

คลิกจุดบนแผนที่เพื่อดูรายละเอียดแต่ละเกาะ พร้อมกราฟพยากรณ์ 24 ชม./7 วัน/14 วัน และคำแนะนำการรับมือตามระดับความเสี่ยง ระบบจะแจ้งเตือนอัตโนมัติเมื่อพบพื้นที่เสี่ยงสูงด้วยครับ`
  },
];

const REEFBOT_DEFAULT_REPLY = `ขอโทษครับ 🙏 ผมยังไม่แน่ใจคำถามนี้ ลองถามเรื่องพวกนี้ดูนะครับ:
- ปะการังฟอกขาวคืออะไร
- DHW / SST คืออะไร
- แนวปะการังไหนน่าไปดำน้ำ
- วิธีอนุรักษ์ปะการัง
- ระดับความเสี่ยงอ่านยังไง
- เจอปะการังฟอกขาวแจ้งใคร`;

// จับคู่ข้อความกับหัวข้อที่มีคีย์เวิร์ดตรงมากที่สุด (แม่นกว่าการเจอคำแรกแล้วตอบทันที)
function findResponse(userMessage) {
  const msg = (userMessage || '').toLowerCase();
  if (!msg.trim()) return REEFBOT_DEFAULT_REPLY;

  let bestTopic = null;
  let bestScore = 0;

  for (const topic of REEFBOT_KB) {
    let score = 0;
    for (const keyword of topic.keywords) {
      if (msg.includes(keyword.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestTopic ? bestTopic.reply : REEFBOT_DEFAULT_REPLY;
}

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
        const reply = await askGemini(chatHistory);
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
