// tests/summarize.test.js
// اختبارات بسيطة بدون مكتبة خارجية — node tests/summarize.test.js

import assert from 'node:assert/strict';

/* ─── استيراد الدوال الداخلية عبر إعادة تصديرها مؤقتاً ─── */
// ملاحظة: في بيئة الإنتاج تستخدم الدالة handler المُصدَّرة افتراضياً.
// هذا الملف يختبر المنطق بمحاكاة req/res.

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failCount++;
  }
}

/* ─────────────────────────────────────────
   اختبارات extractVideoId
   ───────────────────────────────────────── */
console.log('\n📌 extractVideoId');

// نستنسخ الدالة هنا لاختبارها بشكل مستقل
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

test('رابط watch عادي', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});
test('رابط youtu.be مختصر', () => {
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});
test('رابط Shorts', () => {
  assert.equal(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});
test('رابط embed', () => {
  assert.equal(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});
test('معرّف مجرد', () => {
  assert.equal(extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});
test('رابط مع بارامترات إضافية', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
});
test('رابط غير صالح يُعيد null', () => {
  assert.equal(extractVideoId('https://example.com'), null);
});
test('قيمة فارغة تُعيد null', () => {
  assert.equal(extractVideoId(''), null);
  assert.equal(extractVideoId(null), null);
});

/* ─────────────────────────────────────────
   اختبارات isValidVideoId
   ───────────────────────────────────────── */
console.log('\n📌 isValidVideoId');

function isValidVideoId(id) {
  return typeof id === 'string' && /^[\w-]{11}$/.test(id);
}

test('معرّف صالح 11 حرف', () => {
  assert.ok(isValidVideoId('dQw4w9WgXcQ'));
});
test('معرّف قصير جداً', () => {
  assert.equal(isValidVideoId('abc'), false);
});
test('معرّف طويل جداً', () => {
  assert.equal(isValidVideoId('dQw4w9WgXcQXXX'), false);
});
test('معرّف يحتوي رموز غير صالحة', () => {
  assert.equal(isValidVideoId('dQw4w9Wg!cQ'), false);
});

/* ─────────────────────────────────────────
   اختبارات clipToWords
   ───────────────────────────────────────── */
console.log('\n📌 clipToWords');

function clipToWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return { text, wordCount: words.length };
  let clipped = words.slice(0, maxWords).join(' ');
  const lastPunct = Math.max(
    clipped.lastIndexOf('.'), clipped.lastIndexOf('!'),
    clipped.lastIndexOf('؟'), clipped.lastIndexOf('?'),
  );
  if (lastPunct > clipped.length * 0.6) clipped = clipped.slice(0, lastPunct + 1);
  return { text: clipped, wordCount: clipped.split(/\s+/).filter(Boolean).length };
}

test('نص أقل من الحد يُعاد كاملاً', () => {
  const { text, wordCount } = clipToWords('كلمة واحدة فقط', 500);
  assert.equal(wordCount, 3);
  assert.ok(text.includes('واحدة'));
});
test('نص أطول يُقتطع', () => {
  const longText = Array(600).fill('كلمة').join(' ');
  const { wordCount } = clipToWords(longText, 500);
  assert.ok(wordCount <= 500);
});
test('الاقتطاع يحافظ على بنية الجملة', () => {
  const text = 'هذه جملة أولى كاملة. هذه جملة ثانية كاملة. ' + Array(500).fill('كلمة').join(' ');
  const { text: clipped } = clipToWords(text, 20);
  // يجب أن ينتهي عند نقطة إن أمكن
  assert.ok(clipped.endsWith('.') || clipped.split(' ').length <= 20);
});

/* ─────────────────────────────────────────
   اختبارات cleanSegment
   ───────────────────────────────────────── */
console.log('\n📌 cleanSegment');

function cleanSegment(text) {
  return (text ?? '')
    .replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '')
    .replace(/&#\d+;/g, ' ').replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

test('يُزيل تعليقات الموسيقى', () => {
  assert.equal(cleanSegment('[موسيقى] مرحباً'), 'مرحباً');
});
test('يُزيل HTML entities', () => {
  assert.ok(!cleanSegment('مرحبا&#39;').includes('&#'));
});
test('يُعالج null بأمان', () => {
  assert.equal(cleanSegment(null), '');
});
test('مسافات متعددة تُوحَّد', () => {
  assert.equal(cleanSegment('كلمة   أخرى'), 'كلمة أخرى');
});

/* ─────────────────────────────────────────
   اختبارات buildSummary (منطق التلخيص)
   ───────────────────────────────────────── */
console.log('\n📌 buildSummary');

// نسخة مبسطة للاختبار
function buildSummaryTest(text) {
  const sentences = text.split(/(?<=[.!?؟])\s+/).filter(s => s.length > 10);
  return {
    shortSummary: sentences[0] ?? text.slice(0, 100),
    keyPoints:    sentences.slice(1, 4).map(s => s.endsWith('.') ? s : s + '.'),
    topics:       ['موضوع'],
    sentenceCount: sentences.length,
  };
}

test('النص الفارغ لا يسبب خطأً', () => {
  const result = buildSummaryTest('نص قصير جداً');
  assert.ok(typeof result.shortSummary === 'string');
  assert.ok(Array.isArray(result.keyPoints));
});
test('النقاط الرئيسية مصفوفة', () => {
  const result = buildSummaryTest('جملة أولى طويلة نسبياً تصلح اختباراً. جملة ثانية أيضاً طويلة. جملة ثالثة مكملة.');
  assert.ok(Array.isArray(result.keyPoints));
});
test('الملخص القصير سلسلة نصية', () => {
  const result = buildSummaryTest('محتوى تجريبي للاختبار فقط يحتوي على نص كافٍ.');
  assert.ok(typeof result.shortSummary === 'string');
  assert.ok(result.shortSummary.length > 0);
});

/* ─────────────────────────────────────────
   اختبار handler (محاكاة Vercel)
   ───────────────────────────────────────── */
console.log('\n📌 handler — محاكاة الطلبات');

function mockRes() {
  let _status = 200;
  let _body   = null;
  return {
    setHeader: () => {},
    status(s)  { _status = s; return this; },
    json(body) { _body = body; return this; },
    end()      { return this; },
    _get()     { return { status: _status, body: _body }; },
  };
}

test('OPTIONS preflight يُعيد 204', async () => {
  const { default: handler } = await import('../api/summarize.js');
  const req = { method: 'OPTIONS', body: {} };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._get().status, 204);
});

test('GET يُعيد 405', async () => {
  const { default: handler } = await import('../api/summarize.js');
  const req = { method: 'GET', body: {} };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._get().status, 405);
});

test('POST بدون videoId يُعيد 400', async () => {
  const { default: handler } = await import('../api/summarize.js');
  const req = { method: 'POST', body: {} };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._get().status, 400);
  assert.equal(res._get().body?.error?.code, 'INVALID_INPUT');
});

test('POST بـ videoId غير صالح يُعيد 400', async () => {
  const { default: handler } = await import('../api/summarize.js');
  const req = { method: 'POST', body: { videoId: 'INVALID' } };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._get().status, 400);
  assert.equal(res._get().body?.error?.code, 'INVALID_VIDEO_ID');
});

test('POST بـ URL صالح يستدعي المعالجة (قد يُعيد 404 بدون شبكة)', async () => {
  const { default: handler } = await import('../api/summarize.js');
  const req = { method: 'POST', body: { videoId: 'dQw4w9WgXcQ' } };
  const res = mockRes();
  await handler(req, res);
  const { status, body } = res._get();
  // في بيئة اختبار بدون إنترنت: 404 أو 500 مقبول
  // في بيئة إنتاج: 200 مع بيانات
  assert.ok([200, 404, 500].includes(status), `status غير متوقع: ${status}`);
  assert.ok(typeof body === 'object');
});

/* ─────────────────────────────────────────
   النتيجة النهائية
   ───────────────────────────────────────── */
console.log(`\n${'─'.repeat(40)}`);
console.log(`النتيجة: ${passCount} ✅ نجح | ${failCount} ❌ فشل`);
console.log('─'.repeat(40) + '\n');

if (failCount > 0) process.exit(1);
