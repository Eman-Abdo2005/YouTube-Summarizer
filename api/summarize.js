// api/summarize.js — Vercel Serverless Function
// ESM (import/export) — مطلوب لأن youtube-transcript مكتبة ESM-only

import { YoutubeTranscript } from 'youtube-transcript';

const MAX_WORDS        = 500;
const MIN_SENTENCE_LEN = 40;
const MAX_KEY_POINTS   = 5;

// ─── نقطة الدخول ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json(makeError('METHOD_NOT_ALLOWED', 'يُقبل POST فقط.'));
  }

  // ── استخراج المدخلات ──
  const body    = req.body || {};
  const videoId = body.videoId || extractVideoId(body.url || '');

  if (!videoId) {
    return res.status(400).json(
      makeError('INVALID_INPUT', 'أرسل "url" أو "videoId" في جسم الطلب.')
    );
  }
  if (!isValidVideoId(videoId)) {
    return res.status(400).json(
      makeError('INVALID_VIDEO_ID', `معرّف الفيديو غير صالح: "${videoId}"`)
    );
  }

  // ── المعالجة الرئيسية ──
  try {
    const transcript = await getTranscript(videoId);
    const clipped    = clipToWords(transcript.fullText, MAX_WORDS);
    const summary    = buildSummary(clipped);

    return res.status(200).json({
      success: true,
      videoId,
      thumbnail: {
        high:   `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        maxres: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      },
      transcript: {
        language:   transcript.language,
        totalWords: transcript.totalWords,
        usedWords:  clipped.wordCount,
        wasTrimmed: transcript.totalWords > MAX_WORDS,
      },
      summary: {
        shortSummary: summary.shortSummary,
        keyPoints:    summary.keyPoints,
        topics:       summary.topics,
        stats: {
          words:       clipped.wordCount,
          readSeconds: Math.ceil(clipped.wordCount / 3),
        },
      },
      generatedAt: new Date().toISOString(),
    });

  } catch (e) {
    return handleError(e, res);
  }
}

// ─── 1. جلب نص الفيديو ───────────────────────────────────────────────────────
async function getTranscript(videoId) {
  // جرّب اللغات بالترتيب: عربي أولاً ثم إنجليزي ثم غيرهم
  const langs = ['ar', 'en', 'fr', 'de', 'es', 'tr'];
  let segments = null;
  let usedLang = 'auto';

  for (const lang of langs) {
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      usedLang = lang;
      break;
    } catch {
      // هذه اللغة غير متاحة، جرّب التالية
    }
  }

  // إن فشلت كل اللغات — دع يوتيوب يختار تلقائياً
  if (!segments) {
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
      usedLang = 'auto';
    } catch (e) {
      const msg = e?.message ?? '';
      if (msg.includes('disabled') || msg.includes('Could not get')) {
        throw { code: 'NO_TRANSCRIPT', videoId };
      }
      throw e;
    }
  }

  if (!segments?.length) throw { code: 'NO_TRANSCRIPT', videoId };

  // تنظيف وتجميع النص
  const fullText = segments
    .map(s => cleanSegment(s.text))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!fullText) throw { code: 'EMPTY_TRANSCRIPT', videoId };

  return {
    fullText,
    language:   usedLang,
    totalWords: countWords(fullText),
  };
}

// ─── 2. اقتطاع أول N كلمة ────────────────────────────────────────────────────
function clipToWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length <= maxWords) {
    return { text, wordCount: words.length };
  }

  let clipped = words.slice(0, maxWords).join(' ');

  // أنهِ عند آخر جملة كاملة إن أمكن
  const lastPunct = Math.max(
    clipped.lastIndexOf('.'),
    clipped.lastIndexOf('!'),
    clipped.lastIndexOf('؟'),
    clipped.lastIndexOf('?')
  );
  if (lastPunct > clipped.length * 0.6) {
    clipped = clipped.slice(0, lastPunct + 1);
  }

  return { text: clipped, wordCount: countWords(clipped) };
}

// ─── 3. بناء الملخص (خوارزمية TF) ───────────────────────────────────────────
function buildSummary(clipped) {
  const { text } = clipped;
  const sentences = splitSentences(text).filter(s => s.length >= MIN_SENTENCE_LEN);

  // إن لم توجد جمل كافية — أرجع النص مباشرة
  if (!sentences.length) {
    return { shortSummary: text.slice(0, 300), keyPoints: [], topics: [], sentenceCount: 0 };
  }

  const wordFreq = computeWordFreq(text);

  // احسب درجة كل جملة
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreSentence(sentence, wordFreq, index, sentences.length),
  }));

  const sorted = [...scored].sort((a, b) => b.score - a.score);

  // أفضل N جملة = الملخص (مرتبة بترتيبها الأصلي)
  const topN = Math.min(3, Math.max(1, Math.floor(sentences.length / 4)));
  const shortSummary = sorted
    .slice(0, topN)
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence)
    .join(' ')
    .trim();

  // الجمل التالية = النقاط الرئيسية
  const keyPoints = sorted
    .slice(topN, topN + MAX_KEY_POINTS)
    .sort((a, b) => a.index - b.index)
    .map(s => formatPoint(s.sentence));

  return {
    shortSummary,
    keyPoints,
    topics:        extractTopics(wordFreq),
    sentenceCount: sentences.length,
  };
}

// ─── دوال مساعدة للتلخيص ─────────────────────────────────────────────────────
function splitSentences(text) {
  return text
    .split(/[.!?؟]\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function computeWordFreq(text) {
  const stop = new Set([
    // عربية
    'في','من','إلى','على','عن','مع','هذا','هذه','التي','الذي','كان','كانت',
    'هو','هي','هم','نحن','أنت','أنا','لا','ما','هل','إن','أن','كما','أو',
    'قد','لقد','كل','فقط','أيضا','ثم','لم','لن','ليس','عند','بعد','قبل',
    // إنجليزية
    'the','a','an','is','are','was','were','be','have','has','had',
    'do','does','did','will','would','could','should','can','to','of',
    'in','on','at','by','for','with','and','or','but','not','it','its',
    'this','that','we','they','he','she','you','i','my','our','your','their',
  ]);

  const freq = {};
  text
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stop.has(w))
    .forEach(w => { freq[w] = (freq[w] || 0) + 1; });

  return freq;
}

function scoreSentence(sentence, freq, index, total) {
  const words = sentence
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  if (!words.length) return 0;

  const freqScore    = words.reduce((s, w) => s + (freq[w] || 0), 0) / words.length;
  const posBonus     = (index === 0 || index === total - 1) ? 1.3
                     : index < total * 0.2 ? 1.15 : 1.0;
  const lenPenalty   = sentence.length < 50 ? 0.7 : sentence.length > 300 ? 0.85 : 1.0;

  return freqScore * posBonus * lenPenalty;
}

function extractTopics(freq) {
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
}

function formatPoint(s) {
  const t = s.length > 150 ? s.slice(0, 147) + '...' : s;
  return /[.!?؟]$/.test(t) ? t : t + '.';
}

// ─── دوال مساعدة عامة ────────────────────────────────────────────────────────
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /shorts\/([\w-]{11})/,
    /embed\/([\w-]{11})/,
    /live\/([\w-]{11})/,
    /^([\w-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.trim().match(p);
    if (m) return m[1];
  }
  return null;
}

function isValidVideoId(id) {
  return typeof id === 'string' && /^[\w-]{11}$/.test(id);
}

function cleanSegment(text) {
  return (text ?? '')
    .replace(/\[.*?\]/g, '')   // يزيل [موسيقى] [تصفيق]
    .replace(/\(.*?\)/g, '')
    .replace(/&#\d+;/g, ' ')
    .replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function makeError(code, message) {
  return {
    success:   false,
    error:     { code, message },
    timestamp: new Date().toISOString(),
  };
}

function handleError(e, res) {
  // أخطاء معروفة من getTranscript
  const knownErrors = {
    NO_TRANSCRIPT:    { status: 404, message: 'لا تتوفر ترجمة لهذا الفيديو. تأكد أن الفيديو يحتوي على ترجمة (CC).' },
    EMPTY_TRANSCRIPT: { status: 422, message: 'الترجمة فارغة أو لا تحتوي على نص صالح.' },
    VIDEO_UNAVAILABLE:{ status: 404, message: 'الفيديو غير متاح أو محذوف.' },
  };

  if (e?.code && knownErrors[e.code]) {
    const { status, message } = knownErrors[e.code];
    return res.status(status).json(makeError(e.code, message));
  }

  // أخطاء نصية من مكتبة youtube-transcript
  const msg = e?.message ?? '';
  if (msg.includes('disabled') || msg.includes('Could not get transcript')) {
    return res.status(404).json(makeError('NO_TRANSCRIPT', 'لا تتوفر ترجمة لهذا الفيديو.'));
  }
  if (msg.includes('not found') || msg.includes('unavailable')) {
    return res.status(404).json(makeError('VIDEO_UNAVAILABLE', 'الفيديو غير متاح.'));
  }

  // خطأ غير متوقع
  console.error('[/api/summarize]', e);
  return res.status(500).json(makeError('INTERNAL_ERROR', 'حدث خطأ داخلي. يرجى المحاولة مجدداً.'));
}
