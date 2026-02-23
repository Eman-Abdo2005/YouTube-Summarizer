// api/summarize.js — Vercel Serverless Function
// CommonJS فقط (require / module.exports) — لا import / export

const { YoutubeTranscript } = require('youtube-transcript');

const MAX_WORDS        = 500;
const MIN_SENTENCE_LEN = 40;
const MAX_KEY_POINTS   = 5;

// ─── نقطة الدخول ────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json(err('METHOD_NOT_ALLOWED', 'يُقبل POST فقط.'));
  }

  const body      = req.body || {};
  const videoId   = body.videoId || extractVideoId(body.url);

  if (!videoId) {
    return res.status(400).json(err('INVALID_INPUT', 'أرسل "url" أو "videoId" في جسم الطلب.'));
  }
  if (!isValidVideoId(videoId)) {
    return res.status(400).json(err('INVALID_VIDEO_ID', 'معرّف الفيديو غير صالح.'));
  }

  try {
    const transcript = await getTranscript(videoId);
    const clipped    = clipToWords(transcript.fullText, MAX_WORDS);
    const summary    = buildSummary(clipped);

    return res.status(200).json({
      success:  true,
      videoId,
      thumbnail: {
        high:   'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg',
        maxres: 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg',
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
};

// ─── جلب نص الفيديو ─────────────────────────────────────────
async function getTranscript(videoId) {
  const langs = ['ar', 'en', 'fr', 'de', 'es', 'tr'];
  let segments = null;
  let usedLang = 'auto';

  for (const lang of langs) {
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      usedLang = lang;
      break;
    } catch (_) { /* جرّب اللغة التالية */ }
  }

  if (!segments) {
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e) {
      const msg = (e && e.message) || '';
      if (msg.includes('disabled') || msg.includes('Could not get')) {
        throw { code: 'NO_TRANSCRIPT', videoId };
      }
      throw e;
    }
  }

  if (!segments || !segments.length) throw { code: 'NO_TRANSCRIPT', videoId };

  const fullText = segments
    .map(function(s) { return cleanSegment(s.text); })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!fullText) throw { code: 'EMPTY_TRANSCRIPT', videoId };

  return { fullText, language: usedLang, totalWords: countWords(fullText) };
}

// ─── اقتطاع أول N كلمة ──────────────────────────────────────
function clipToWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return { text: text, wordCount: words.length };

  let clipped = words.slice(0, maxWords).join(' ');
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

// ─── بناء الملخص بخوارزمية TF ───────────────────────────────
function buildSummary(clipped) {
  const text      = clipped.text;
  const sentences = splitSentences(text).filter(function(s) {
    return s.length >= MIN_SENTENCE_LEN;
  });

  if (!sentences.length) {
    return { shortSummary: text.slice(0, 300), keyPoints: [], topics: [], sentenceCount: 0 };
  }

  const wordFreq = computeWordFreq(text);

  const scored = sentences.map(function(sentence, index) {
    return {
      sentence: sentence,
      index:    index,
      score:    scoreSentence(sentence, wordFreq, index, sentences.length),
    };
  });

  const sorted = scored.slice().sort(function(a, b) { return b.score - a.score; });

  const topN = Math.min(3, Math.max(1, Math.floor(sentences.length / 4)));
  const shortSummary = sorted
    .slice(0, topN)
    .sort(function(a, b) { return a.index - b.index; })
    .map(function(s) { return s.sentence; })
    .join(' ')
    .trim();

  const keyPoints = sorted
    .slice(topN, topN + MAX_KEY_POINTS)
    .sort(function(a, b) { return a.index - b.index; })
    .map(function(s) { return formatPoint(s.sentence); });

  return {
    shortSummary:  shortSummary,
    keyPoints:     keyPoints,
    topics:        extractTopics(wordFreq),
    sentenceCount: sentences.length,
  };
}

// ─── دوال مساعدة للتلخيص ────────────────────────────────────
function splitSentences(text) {
  return text.split(/[.!?؟]\s+/).map(function(s) { return s.trim(); }).filter(Boolean);
}

function computeWordFreq(text) {
  const stopWords = new Set([
    'في','من','إلى','على','عن','مع','هذا','هذه','التي','الذي','كان','كانت',
    'هو','هي','هم','نحن','أنت','أنا','لا','ما','هل','إن','أن','كما','أو',
    'قد','لقد','كل','فقط','أيضا','ثم','لم','لن','ليس','عند','بعد','قبل',
    'the','a','an','is','are','was','were','be','have','has','had','do',
    'does','did','will','would','could','should','can','to','of','in','on',
    'at','by','for','with','and','or','but','not','it','its','this','that',
    'we','they','he','she','you','i','my','our','your','their'
  ]);

  const freq = {};
  text
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) { return w.length > 3 && !stopWords.has(w); })
    .forEach(function(w) { freq[w] = (freq[w] || 0) + 1; });

  return freq;
}

function scoreSentence(sentence, wordFreq, index, total) {
  const words = sentence
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) { return w.length > 3; });

  if (!words.length) return 0;

  const freqScore = words.reduce(function(sum, w) {
    return sum + (wordFreq[w] || 0);
  }, 0) / words.length;

  const posBonus  = (index === 0 || index === total - 1) ? 1.3
                  : (index < total * 0.2) ? 1.15 : 1.0;
  const lenPenal  = sentence.length < 50 ? 0.7 : sentence.length > 300 ? 0.85 : 1.0;

  return freqScore * posBonus * lenPenal;
}

function extractTopics(wordFreq) {
  return Object.entries(wordFreq)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5)
    .map(function(e) { return e[0].charAt(0).toUpperCase() + e[0].slice(1); });
}

function formatPoint(sentence) {
  const t = sentence.length > 150 ? sentence.slice(0, 147) + '...' : sentence;
  return /[.!?؟]$/.test(t) ? t : t + '.';
}

// ─── دوال التحقق والمساعدة العامة ───────────────────────────
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
  for (var i = 0; i < patterns.length; i++) {
    var m = url.trim().match(patterns[i]);
    if (m) return m[1];
  }
  return null;
}

function isValidVideoId(id) {
  return typeof id === 'string' && /^[\w-]{11}$/.test(id);
}

function cleanSegment(text) {
  return (text || '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/&#\d+;/g, ' ')
    .replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function err(code, message) {
  return { success: false, error: { code: code, message: message }, timestamp: new Date().toISOString() };
}

function handleError(e, res) {
  const map = {
    NO_TRANSCRIPT:    { status: 404, message: 'لا تتوفر ترجمة لهذا الفيديو. تأكد أن الفيديو يحتوي على ترجمة (CC).' },
    EMPTY_TRANSCRIPT: { status: 422, message: 'الترجمة فارغة أو لا تحتوي على نص.' },
    VIDEO_UNAVAILABLE:{ status: 404, message: 'الفيديو غير متاح أو محذوف.' },
  };

  if (e && e.code && map[e.code]) {
    return res.status(map[e.code].status).json(err(e.code, map[e.code].message));
  }

  const msg = (e && e.message) || '';
  if (msg.includes('disabled') || msg.includes('Could not get transcript')) {
    return res.status(404).json(err('NO_TRANSCRIPT', 'لا تتوفر ترجمة لهذا الفيديو.'));
  }
  if (msg.includes('not found') || msg.includes('unavailable')) {
    return res.status(404).json(err('VIDEO_UNAVAILABLE', 'الفيديو غير متاح.'));
  }

  console.error('[summarize]', e);
  return res.status(500).json(err('INTERNAL_ERROR', 'حدث خطأ داخلي. يرجى المحاولة مجدداً.'));
}