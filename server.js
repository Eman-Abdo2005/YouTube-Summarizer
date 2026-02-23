// ============================================================
//  server.js — خادم ملخّص يوتيوب
//  Node.js + Express | youtube-transcript + Claude API
// ============================================================

import express      from 'express';
import cors         from 'cors';
import Anthropic    from '@anthropic-ai/sdk';
import { YoutubeTranscript } from 'youtube-transcript';
import * as dotenv  from 'dotenv';

dotenv.config();

/* ─────────────────────────────────────────
   إعدادات
   ───────────────────────────────────────── */
const PORT      = process.env.PORT || 3000;
const API_KEY   = process.env.CLAUDE_API_KEY;
const MAX_WORDS = 12_000; // حد الكلمات لتجنب تجاوز نافذة السياق

if (!API_KEY) {
  console.error('\n❌ خطأ: CLAUDE_API_KEY غير موجود في ملف .env\n');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: API_KEY });
const app       = express();

/* ─────────────────────────────────────────
   Middleware
   ───────────────────────────────────────── */
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('.'));                 // يخدم ملفات HTML/CSS/JS

// تسجيل الطلبات
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleTimeString('ar')}] ${req.method} ${req.path}`);
  next();
});

/* ─────────────────────────────────────────
   نقطة الفحص الصحي
   ───────────────────────────────────────── */
app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    model:     'claude-3-haiku-20240307',
  });
});

/* ─────────────────────────────────────────
   نقطة التلخيص الرئيسية
   ───────────────────────────────────────── */
app.post('/api/summarize', async (req, res) => {
  const { videoId, mode = 'detailed' } = req.body;

  // ── التحقق من المدخلات ──
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ code: 'INVALID_ID', message: 'معرّف الفيديو غير صالح.' });
  }

  if (!['detailed', 'brief', 'bullets'].includes(mode)) {
    return res.status(400).json({ code: 'INVALID_MODE', message: 'نوع الملخص غير مدعوم.' });
  }

  try {
    // ── الخطوة 1: جلب نص الفيديو ──
    console.log(`📥 جلب نص الفيديو: ${videoId}`);
    const transcript = await fetchTranscript(videoId);

    // ── الخطوة 2: تلخيص بـ Claude ──
    console.log(`🤖 إرسال لـ Claude (${transcript.wordCount} كلمة | النوع: ${mode})`);
    const summary = await summarizeWithClaude(transcript.text, mode, videoId);

    // ── الخطوة 3: إعادة النتيجة ──
    res.json({
      videoId,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      ...summary,
      stats: {
        wordCount:   transcript.wordCount,
        charCount:   transcript.text.length,
        readMinutes: Math.ceil(transcript.wordCount / 200),
      },
    });

  } catch (err) {
    handleServerError(err, res);
  }
});

/* ─────────────────────────────────────────
   جلب نص الفيديو
   ───────────────────────────────────────── */

/**
 * يجلب نص الترجمة/الكلام من الفيديو
 * يجرب العربية أولاً، ثم الإنجليزية، ثم أي لغة متاحة
 *
 * @param {string} videoId
 * @returns {Promise<{text: string, language: string, wordCount: number}>}
 */
async function fetchTranscript(videoId) {
  const langPriority = ['ar', 'en', 'fr', 'tr', 'de', 'es'];
  let rawSegments = null;
  let detectedLang = 'unknown';

  // جرّب اللغات بالترتيب
  for (const lang of langPriority) {
    try {
      rawSegments  = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      detectedLang = lang;
      console.log(`✅ وُجدت ترجمة بالـ ${lang}`);
      break;
    } catch {
      // لا توجد ترجمة بهذه اللغة، جرّب التالية
    }
  }

  // إن فشلت كل اللغات، جرّب بدون تحديد لغة (تلقائي)
  if (!rawSegments) {
    try {
      rawSegments  = await YoutubeTranscript.fetchTranscript(videoId);
      detectedLang = 'auto';
      console.log('✅ وُجدت ترجمة تلقائية');
    } catch {
      throw { code: 'NO_TRANSCRIPT' };
    }
  }

  // تنظيف وتجميع النص
  const fullText = rawSegments
    .map(s => s.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!fullText) throw { code: 'NO_TRANSCRIPT' };

  const words = fullText.split(/\s+/);

  // اقتطاع إن كان النص طويلاً جداً
  const truncated = words.length > MAX_WORDS
    ? words.slice(0, MAX_WORDS).join(' ') + '...'
    : fullText;

  if (words.length > MAX_WORDS * 2) throw { code: 'VIDEO_TOO_LONG' };

  return {
    text:      truncated,
    language:  detectedLang,
    wordCount: words.length,
  };
}

/* ─────────────────────────────────────────
   التلخيص بـ Claude
   ───────────────────────────────────────── */

/**
 * يرسل النص لـ Claude ويعيد ملخصاً منظماً
 *
 * @param {string} transcriptText
 * @param {'detailed'|'brief'|'bullets'} mode
 * @param {string} videoId
 * @returns {Promise<Object>}
 */
async function summarizeWithClaude(transcriptText, mode, videoId) {
  const systemPrompt = buildSystemPrompt(mode);
  const userPrompt   = buildUserPrompt(transcriptText, mode);

  const message = await anthropic.messages.create({
    model:      'claude-3-haiku-20240307',  // الأسرع والأرخص للتلخيص
    max_tokens: 1500,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  const rawText = message.content[0].text;

  // استخراج JSON من الرد
  return parseClaudeResponse(rawText, videoId);
}

/* ─────────────────────────────────────────
   بناء الـ Prompts
   ───────────────────────────────────────── */

function buildSystemPrompt(mode) {
  const modeInstructions = {
    detailed: `
- اكتب ملخصاً شاملاً يغطي الفكرة الرئيسية والأفكار الفرعية.
- استخرج 4-6 نقاط رئيسية واضحة.
- أضف تقييماً مختصراً لجودة المحتوى.`,

    brief: `
- اكتب ملخصاً مكثفاً في 2-3 جمل تعطي الفكرة الجوهرية فقط.
- استخرج 2-3 نقاط أساسية لا غنى عنها.
- كن موجزاً ودقيقاً.`,

    bullets: `
- ركّز على النقاط والحقائق فقط، لا ملخص نصي.
- استخرج 6-8 نقاط تفصيلية تغطي كامل المحتوى.
- رتّب النقاط بترتيب منطقي (مقدمة → تفاصيل → خلاصة).`,
  };

  return `أنت مساعد متخصص في تلخيص محتوى الفيديوهات باللغة العربية.
مهمتك: تحليل نص الفيديو وإنتاج ملخص منظم.

نوع الملخص المطلوب: ${mode}
${modeInstructions[mode]}

يجب أن تردّ بـ JSON صالح فقط بهذا الشكل بالضبط، بدون أي نص خارجه:
{
  "title": "عنوان الفيديو المستنتج (عربي، 5-10 كلمات)",
  "channel": "اسم القناة إن ذُكر أو null",
  "duration": null,
  "language": "اللغة الأصلية للفيديو (مثال: عربي | إنجليزي)",
  "summary": "النص الملخص (أو null لنوع bullets)",
  "keyPoints": ["نقطة 1", "نقطة 2", ...],
  "topics": ["موضوع 1", "موضوع 2", "موضوع 3"],
  "verdict": "تقييم مختصر جداً للمحتوى (جملة واحدة)"
}`;
}

function buildUserPrompt(transcriptText, mode) {
  return `فيما يلي نص الفيديو المستخرج من الترجمة. لخّصه بنوع "${mode}":

---
${transcriptText}
---

ردّ بـ JSON فقط.`;
}

/* ─────────────────────────────────────────
   تحليل رد Claude
   ───────────────────────────────────────── */

/**
 * يستخرج كائن JSON من رد Claude
 * @param {string} rawText
 * @param {string} videoId
 * @returns {Object}
 */
function parseClaudeResponse(rawText, videoId) {
  // أحياناً Claude يضيف ```json ... ``` — نزيلها
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    // التحقق من الحقول الضرورية
    return {
      videoId,
      title:     parsed.title     || 'فيديو يوتيوب',
      channel:   parsed.channel   || null,
      duration:  parsed.duration  || null,
      language:  parsed.language  || null,
      summary:   parsed.summary   || null,
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      topics:    Array.isArray(parsed.topics)    ? parsed.topics.slice(0, 5) : [],
      verdict:   parsed.verdict   || null,
    };

  } catch {
    // إن فشل JSON.parse، نُرجع بيانات أساسية مع النص الخام
    console.warn('[Claude] تعذّر تحليل JSON، إرجاع النص الخام');
    return {
      videoId,
      title:     'ملخص الفيديو',
      channel:   null,
      duration:  null,
      language:  null,
      summary:   rawText,
      keyPoints: [],
      topics:    [],
      verdict:   null,
    };
  }
}

/* ─────────────────────────────────────────
   معالجة الأخطاء
   ───────────────────────────────────────── */

/**
 * يحوّل الأخطاء إلى استجابات HTTP مناسبة
 * @param {Error|Object} err
 * @param {import('express').Response} res
 */
function handleServerError(err, res) {
  console.error('[Error]', err.code || err.message || err);

  // أخطاء مُعرَّفة مسبقاً
  const knownErrors = {
    NO_TRANSCRIPT:  { status: 404, code: 'NO_TRANSCRIPT',  message: 'لا توجد ترجمة لهذا الفيديو.' },
    VIDEO_TOO_LONG: { status: 422, code: 'VIDEO_TOO_LONG', message: 'الفيديو طويل جداً.' },
    INVALID_ID:     { status: 400, code: 'INVALID_ID',     message: 'معرّف الفيديو غير صالح.' },
  };

  if (err.code && knownErrors[err.code]) {
    const { status, code, message } = knownErrors[err.code];
    return res.status(status).json({ code, message });
  }

  // خطأ Claude API
  if (err?.status === 401 || err?.error?.type === 'authentication_error') {
    return res.status(401).json({ code: 'INVALID_API_KEY', message: 'مفتاح API غير صالح.' });
  }

  if (err?.status === 429) {
    return res.status(429).json({ code: 'RATE_LIMITED', message: 'تجاوزت الحد المسموح به.' });
  }

  if (err?.status === 529 || err?.status === 503) {
    return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'خدمة Claude غير متاحة مؤقتاً.' });
  }

  // خطأ عام
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'خطأ داخلي في الخادم.' });
}

/* ─────────────────────────────────────────
   تشغيل الخادم
   ───────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\n🚀 الخادم يعمل على http://localhost:${PORT}`);
  console.log(`📄 افتح: http://localhost:${PORT}/youtube-summarizer.html\n`);
});

export default app;
