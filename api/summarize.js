// ============================================================
//  api/summarize.js — Vercel Serverless Function
//
//  ملاحظة مهمة حول المكتبات:
//  • youtube-transcript-api  → مكتبة Python حصرياً
//  • youtube-transcript      → المكتبة الصحيحة لـ Node.js (نستخدمها هنا)
//
//  المسار على Vercel: /api/summarize
//  الطريقة: POST
//  Body:    { "url": "https://youtube.com/watch?v=..." }
//           أو { "videoId": "dQw4w9WgXcQ" }
// ============================================================

import { YoutubeTranscript } from 'youtube-transcript';

/* ─────────────────────────────────────────
   ثوابت
   ───────────────────────────────────────── */
const MAX_WORDS         = 500;   // عدد الكلمات للتلخيص حسب المطلوب
const MIN_SENTENCE_LEN  = 40;    // أقل طول جملة نعتبرها ذات معنى (حرف)
const MAX_KEY_POINTS    = 5;     // أقصى عدد نقاط رئيسية

/* ─────────────────────────────────────────
   نقطة الدخول الرئيسية — Vercel Handler
   ───────────────────────────────────────── */

/**
 * @param {import('@vercel/node').VercelRequest}  req
 * @param {import('@vercel/node').VercelResponse} res
 */
export default async function handler(req, res) {

  // ── CORS: السماح لجميع الأصول ──
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // معالجة طلبات OPTIONS (Preflight)
  if (req.method === 'OPTIONS') return res.status(204).end();

  // قبول POST فقط
  if (req.method !== 'POST') {
    return res.status(405).json(errorResponse('METHOD_NOT_ALLOWED', 'يُقبل POST فقط.'));
  }

  // ── استخراج المدخلات ──
  const { url, videoId: rawVideoId } = req.body ?? {};
  const videoId = rawVideoId ?? extractVideoId(url);

  if (!videoId) {
    return res.status(400).json(
      errorResponse('INVALID_INPUT', 'أرسل "url" أو "videoId" في جسم الطلب.')
    );
  }

  if (!isValidVideoId(videoId)) {
    return res.status(400).json(
      errorResponse('INVALID_VIDEO_ID', `معرّف الفيديو غير صالح: "${videoId}"`)
    );
  }

  // ── المعالجة الرئيسية ──
  try {

    // الخطوة 1: جلب نص الفيديو
    const transcript = await getTranscript(videoId);

    // الخطوة 2: اقتطاع أول 500 كلمة
    const clipped    = clipToWords(transcript.fullText, MAX_WORDS);

    // الخطوة 3: تلخيص النص
    const summary    = buildSummary(clipped);

    // الخطوة 4: بناء الاستجابة النهائية
    return res.status(200).json({
      success: true,
      videoId,
      url:     `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: {
        default:  `https://img.youtube.com/vi/${videoId}/default.jpg`,
        medium:   `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        high:     `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        maxres:   `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      },
      transcript: {
        language:   transcript.language,
        totalWords: transcript.totalWords,
        usedWords:  clipped.wordCount,
        wasTrimmed: transcript.totalWords > MAX_WORDS,
        sample:     clipped.text.slice(0, 200) + (clipped.text.length > 200 ? '...' : ''),
      },
      summary: {
        shortSummary: summary.shortSummary,
        keyPoints:    summary.keyPoints,
        topics:       summary.topics,
        stats: {
          sentences:   summary.sentenceCount,
          words:       clipped.wordCount,
          readSeconds: Math.ceil(clipped.wordCount / 3), // ~180 كلمة/دقيقة
        },
      },
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    return handleError(err, res);
  }
}

/* ─────────────────────────────────────────
   1. جلب نص الفيديو
   ───────────────────────────────────────── */

/**
 * يجلب نص الترجمة مجرباً اللغات بترتيب الأولوية
 *
 * @param {string} videoId
 * @returns {Promise<{fullText: string, language: string, totalWords: number}>}
 */
async function getTranscript(videoId) {
  // ترتيب اللغات: عربي أولاً ثم الأكثر شيوعاً
  const langPriority = ['ar', 'en', 'fr', 'de', 'es', 'tr', 'it', 'pt'];
  let segments = null;
  let usedLang = 'auto';

  // جرّب كل لغة بالترتيب
  for (const lang of langPriority) {
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      usedLang = lang;
      break;
    } catch {
      // هذه اللغة غير متاحة، جرّب التالية
    }
  }

  // إن فشلت كل اللغات، اترك يوتيوب يختار تلقائياً
  if (!segments) {
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
      usedLang = 'auto';
    } catch (err) {
      // خطأ يوتيوب المعروف عند غياب الترجمة
      const msg = err?.message ?? '';
      if (msg.includes('disabled') || msg.includes('Could not get'))
        throw { code: 'NO_TRANSCRIPT', videoId };
      throw err;
    }
  }

  if (!segments?.length)
    throw { code: 'NO_TRANSCRIPT', videoId };

  // تنظيف وتجميع الجمل
  const fullText = segments
    .map(s => cleanSegment(s.text))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!fullText)
    throw { code: 'EMPTY_TRANSCRIPT', videoId };

  return {
    fullText,
    language:   usedLang,
    totalWords: countWords(fullText),
  };
}

/* ─────────────────────────────────────────
   2. اقتطاع النص لأول N كلمة
   ───────────────────────────────────────── */

/**
 * يقتطع النص إلى أول N كلمة مع الحفاظ على نهاية جملة كاملة
 *
 * @param {string} text
 * @param {number} maxWords
 * @returns {{ text: string, wordCount: number }}
 */
function clipToWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length <= maxWords) {
    return { text, wordCount: words.length };
  }

  // اقتطع بدقة عند الكلمة رقم maxWords
  let clipped = words.slice(0, maxWords).join(' ');

  // حاول إنهاء عند آخر جملة كاملة (. أو ! أو ؟ أو ،)
  const lastPunct = Math.max(
    clipped.lastIndexOf('.'),
    clipped.lastIndexOf('!'),
    clipped.lastIndexOf('؟'),
    clipped.lastIndexOf('?'),
  );

  // إن وُجدت نقطة في النصف الأخير من النص، اقتطع عندها
  if (lastPunct > clipped.length * 0.6) {
    clipped = clipped.slice(0, lastPunct + 1);
  }

  return {
    text:      clipped,
    wordCount: countWords(clipped),
  };
}

/* ─────────────────────────────────────────
   3. دالة التلخيص (خوارزمية محلية)
   ───────────────────────────────────────── */

/**
 * يبني ملخصاً من النص باستخدام خوارزمية ترتيب الجمل
 *
 * الخوارزمية:
 *  1. تقسيم النص إلى جمل
 *  2. احتساب درجة كل جملة بناءً على تكرار الكلمات المهمة
 *  3. اختيار أعلى الجمل درجةً كـ"ملخص"
 *  4. استخراج النقاط الرئيسية من الجمل المميزة
 *  5. استنتاج المواضيع من الكلمات الأكثر تكراراً
 *
 * @param {{ text: string, wordCount: number }} clipped
 * @returns {{ shortSummary: string, keyPoints: string[], topics: string[], sentenceCount: number }}
 */
function buildSummary(clipped) {
  const { text } = clipped;

  // ── تقسيم الجمل ──
  const sentences = splitSentences(text).filter(s => s.length >= MIN_SENTENCE_LEN);

  if (!sentences.length) {
    return {
      shortSummary: text.slice(0, 300),
      keyPoints:    [],
      topics:       [],
      sentenceCount: 0,
    };
  }

  // ── احتساب تكرار الكلمات (TF بسيط) ──
  const wordFreq = computeWordFrequency(text);

  // ── درجة كل جملة = مجموع درجات كلماتها ──
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreSentence(sentence, wordFreq, index, sentences.length),
  }));

  // ── ترتيب تنازلي ──
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  // ── الملخص: أفضل 2-3 جمل مُرتَّبة بترتيبها الأصلي ──
  const summaryCount  = Math.min(3, Math.max(1, Math.floor(sentences.length / 4)));
  const topSentences  = sorted
    .slice(0, summaryCount)
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence);
  const shortSummary  = topSentences.join(' ').trim();

  // ── النقاط الرئيسية: الجمل التالية في الترتيب ──
  const keyPoints = sorted
    .slice(summaryCount, summaryCount + MAX_KEY_POINTS)
    .sort((a, b) => a.index - b.index)
    .map(s => formatKeyPoint(s.sentence));

  // ── المواضيع: أكثر الكلمات المهمة تكراراً ──
  const topics = extractTopics(wordFreq);

  return {
    shortSummary,
    keyPoints,
    topics,
    sentenceCount: sentences.length,
  };
}

/* ─────────────────────────────────────────
   دوال التلخيص المساعدة
   ───────────────────────────────────────── */

/**
 * يقسّم النص إلى جمل
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?؟])\s+|(?<=\n)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * يحسب تكرار الكلمات مع تصفية الكلمات الشائعة (stop words)
 * @param {string} text
 * @returns {Map<string, number>}
 */
function computeWordFrequency(text) {
  // كلمات عربية وإنجليزية شائعة بدون معنى مستقل
  const stopWords = new Set([
    // عربية
    'في','من','إلى','على','عن','مع','هذا','هذه','التي','الذي','كان','كانت',
    'هو','هي','هم','نحن','أنت','أنا','لا','ما','هل','إن','أن','كما','أو',
    'وكذلك','ولكن','لأن','حتى','قد','لقد','كل','جدا','فقط','أيضا','ثم',
    'لم','لن','ليس','عند','بعد','قبل','عندما','إذا','كيف','لماذا','ماذا',
    'يمكن','يجب','ذلك','تلك','الان','اليوم','وأن','وهو','وهي','وهم','وقد',
    // إنجليزية
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should',
    'may','might','shall','must','can','to','of','in','on','at','by',
    'for','with','about','as','this','that','these','those','it','its',
    'and','or','but','not','so','if','then','than','when','where',
    'how','what','which','who','just','also','very','more','some',
    'we','they','he','she','you','i','my','our','your','their','his','her',
  ]);

  const freq = new Map();
  const words = text
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return freq;
}

/**
 * يحسب درجة الجملة
 * @param {string} sentence
 * @param {Map<string,number>} wordFreq
 * @param {number} index      - موضع الجملة في النص
 * @param {number} total      - إجمالي الجمل
 * @returns {number}
 */
function scoreSentence(sentence, wordFreq, index, total) {
  const words = sentence
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  if (!words.length) return 0;

  // مجموع تكرار الكلمات المهمة
  const freqScore = words.reduce((sum, w) => sum + (wordFreq.get(w) ?? 0), 0) / words.length;

  // منح وزن إضافي للجملة الأولى والأخيرة (غالباً تحمل الفكرة)
  const positionBonus = (index === 0 || index === total - 1) ? 1.3
                      : (index < total * 0.2)               ? 1.15
                      : 1.0;

  // عقوبة الجمل القصيرة جداً أو الطويلة جداً
  const lenPenalty = sentence.length < 50 ? 0.7
                   : sentence.length > 300 ? 0.85
                   : 1.0;

  return freqScore * positionBonus * lenPenalty;
}

/**
 * يستخلص المواضيع الرئيسية من الكلمات الأكثر تكراراً
 * @param {Map<string,number>} wordFreq
 * @returns {string[]}
 */
function extractTopics(wordFreq) {
  return [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => capitalize(word));
}

/**
 * يُنسّق الجملة لتصبح نقطة رئيسية
 * @param {string} sentence
 * @returns {string}
 */
function formatKeyPoint(sentence) {
  // اقتطاع إن كانت الجملة طويلة جداً
  const trimmed = sentence.length > 150
    ? sentence.slice(0, 147) + '...'
    : sentence;

  // إضافة نقطة في النهاية إن لم تكن موجودة
  return /[.!?؟]$/.test(trimmed) ? trimmed : trimmed + '.';
}

/* ─────────────────────────────────────────
   دوال التحقق والمساعدة
   ───────────────────────────────────────── */

/**
 * يستخرج videoId من رابط YouTube بأشكاله المختلفة
 * @param {string} url
 * @returns {string|null}
 */
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const patterns = [
    /[?&]v=([\w-]{11})/,          // youtube.com/watch?v=ID
    /youtu\.be\/([\w-]{11})/,      // youtu.be/ID
    /shorts\/([\w-]{11})/,         // youtube.com/shorts/ID
    /embed\/([\w-]{11})/,          // youtube.com/embed/ID
    /live\/([\w-]{11})/,           // youtube.com/live/ID
    /^([\w-]{11})$/,               // ID مجرد
  ];
  for (const p of patterns) {
    const m = url.trim().match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * يتحقق من أن الـ videoId بالتنسيق الصحيح (11 حرف)
 * @param {string} id
 * @returns {boolean}
 */
function isValidVideoId(id) {
  return typeof id === 'string' && /^[\w-]{11}$/.test(id);
}

/**
 * ينظّف مقطع نص من الرموز الزائدة
 * @param {string} text
 * @returns {string}
 */
function cleanSegment(text) {
  return (text ?? '')
    .replace(/\[.*?\]/g, '')    // [موسيقى] [تصفيق] إلخ
    .replace(/\(.*?\)/g, '')    // (موسيقى)
    .replace(/&#\d+;/g, ' ')   // HTML entities
    .replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * يحسب عدد الكلمات
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * يجعل الحرف الأول كبيراً
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

/**
 * يبني كائن خطأ موحّد
 * @param {string} code
 * @param {string} message
 * @param {Object} [extra]
 * @returns {Object}
 */
function errorResponse(code, message, extra = {}) {
  return {
    success:   false,
    error:     { code, message },
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

/**
 * يعالج الأخطاء ويُعيد استجابة HTTP مناسبة
 * @param {Error|Object} err
 * @param {import('@vercel/node').VercelResponse} res
 */
function handleError(err, res) {
  // خريطة أكواد الأخطاء المعروفة
  const errorMap = {
    NO_TRANSCRIPT: {
      status:  404,
      message: 'لا تتوفر ترجمة لهذا الفيديو. تأكد أن الفيديو يحتوي على ترجمة (CC).',
    },
    EMPTY_TRANSCRIPT: {
      status:  422,
      message: 'الترجمة موجودة لكنها فارغة أو لا تحتوي على نص صالح.',
    },
    VIDEO_UNAVAILABLE: {
      status:  404,
      message: 'الفيديو غير متاح أو محذوف.',
    },
  };

  if (err?.code && errorMap[err.code]) {
    const { status, message } = errorMap[err.code];
    return res.status(status).json(errorResponse(err.code, message, { videoId: err.videoId }));
  }

  // رسائل خطأ يوتيوب النصية
  const msg = err?.message ?? '';
  if (msg.includes('disabled') || msg.includes('Could not get transcript')) {
    return res.status(404).json(
      errorResponse('NO_TRANSCRIPT', 'لا تتوفر ترجمة لهذا الفيديو.')
    );
  }
  if (msg.includes('not found') || msg.includes('unavailable')) {
    return res.status(404).json(
      errorResponse('VIDEO_UNAVAILABLE', 'الفيديو غير متاح.')
    );
  }

  // خطأ غير متوقع — لا نكشف التفاصيل الداخلية للمستخدم
  console.error('[summarize]', err);
  return res.status(500).json(
    errorResponse('INTERNAL_ERROR', 'حدث خطأ داخلي. يرجى المحاولة مجدداً.')
  );
}
