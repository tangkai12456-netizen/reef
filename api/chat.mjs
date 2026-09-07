// ============================================================
//  POST /api/chat   (Vercel)
//  ฝาแฝดของ netlify/functions/chat.mjs
//  ตรรกะจริงอยู่ใน lib/reefbot.js ที่ใช้ร่วมกันทั้ง Express, Netlify และ Vercel
// ============================================================

// lib/reefbot.js เป็น CommonJS — import แบบ default แล้วค่อยดึงฟังก์ชันออกมา
// ปลอดภัยกว่า named import เพราะไม่ต้องพึ่งการวิเคราะห์ CJS ของ Node
import reefbot from '../lib/reefbot.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'ต้องเรียกด้วย POST' });
  }

  const { chatHistory } = req.body || {};

  if (!chatHistory || !Array.isArray(chatHistory)) {
    return res.status(400).json({ error: 'Invalid chat history' });
  }

  const lastMessage = chatHistory[chatHistory.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return res.status(400).json({ error: 'No user message found' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const reply = await reefbot.askGemini(chatHistory, apiKey);
      return res.status(200).json({ reply, source: 'gemini' });
    } catch (err) {
      console.warn('Gemini ใช้งานไม่ได้ ใช้ local knowledge base แทน:', err.message);
    }
  }

  // Fallback: local knowledge base — บอทต้องไม่เงียบแม้ Gemini ล่ม
  const userText = lastMessage.parts?.[0]?.text || '';
  return res.status(200).json({ reply: reefbot.findResponse(userText), source: 'local' });
}
