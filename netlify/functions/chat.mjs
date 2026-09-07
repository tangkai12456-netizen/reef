// ============================================================
//  POST /api/chat
//  ย้ายมาจาก server.js — ตรรกะทั้งหมดอยู่ใน lib/reefbot.js ที่ใช้ร่วมกัน
//  ระหว่าง Express (ตอน dev) กับ Function ตัวนี้ (ตอน production)
//  ต่างกันแค่วิธีอ่าน API key และรูปแบบ request/response
// ============================================================

import { askGemini, findResponse } from '../../lib/reefbot.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'ต้องเรียกด้วย POST' }, 405);
  }

  let chatHistory;
  try {
    ({ chatHistory } = await req.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!chatHistory || !Array.isArray(chatHistory)) {
    return json({ error: 'Invalid chat history' }, 400);
  }

  const lastMessage = chatHistory[chatHistory.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return json({ error: 'No user message found' }, 400);
  }

  const apiKey = Netlify.env.get('GEMINI_API_KEY');
  if (apiKey) {
    try {
      const reply = await askGemini(chatHistory, apiKey);
      return json({ reply, source: 'gemini' });
    } catch (err) {
      console.warn('Gemini ใช้งานไม่ได้ ใช้ local knowledge base แทน:', err.message);
    }
  }

  // Fallback: local keyword-matching knowledge base — บอทต้องไม่เงียบแม้ Gemini ล่ม
  const userText = lastMessage.parts?.[0]?.text || '';
  return json({ reply: findResponse(userText), source: 'local' });
};

export const config = {
  path: '/api/chat',
};
