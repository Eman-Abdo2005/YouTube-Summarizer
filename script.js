/* ============================================================
   script.js — ملخّص يوتيوب (نسخة API الحقيقي)
   الواجهة الأمامية تتواصل مع خادم Node.js أو Vercel Function
   ============================================================ */

'use strict';

/* ─────────────────────────────────────────
   1. الإعدادات — Config
   ───────────────────────────────────────── */
const CONFIG = {
  // عنوان الخادم — غيّره عند النشر على Vercel أو أي منصة أخرى
  // محلي:   'http://localhost:3000'
  // Vercel: '' (فارغ يعني نفس النطاق — /api/summarize)
  API_BASE_URL: 'https://youtube-summarizer.vercel.app,

  // مهلة الطلب بالمللي ثانية (60 ثانية)
  REQUEST_TIMEOUT_MS: 60_000,

  MAX_HISTORY:      10,
  COPY_FEEDBACK_MS: 2000,
};

const LABELS = {
  mode: {
    detailed: 'تفصيلي',
    brief:    'مختصر',
    bullets:  'نقاط رئيسية',
  },
  errors: {
    empty:        'يرجى إدخال رابط الفيديو أولاً.',
    invalid:      'الرابط غير صحيح. يرجى إدخال رابط يوتيوب صالح.',
    no_subtitle:  'هذا الفيديو لا يحتوي على ترجمة أو نصوص. جرّب فيديواً آخر.',
    too_long:     'الفيديو طويل جداً. جرّب مقطعاً أقصر.',
    server_down:  'لا يمكن الاتصال بالخادم. تأكد من تشغيل server.js أو نشر الـ Function.',
    rate_limit:   'تجاوزت الحد المسموح به. انتظر دقيقة ثم حاول مجدداً.',
    api_key:      'مفتاح API غير صحيح أو منتهي الصلاحية.',
    generic:      'حدث خطأ غير متوقع. يرجى المحاولة مجدداً.',
  },
};

/* ─────────────────────────────────────────
   2. الحالة العامة — App State
   ───────────────────────────────────────── */
const AppState = {
  currentMode:  'detailed',
  isLoading:    false,
  lastVideoId:  null,
  lastData:     null,
  isDarkTheme:  true,
  history:      [],
  abortCtrl:    null,
};

/* ─────────────────────────────────────────
   3. مراجع DOM
   ───────────────────────────────────────── */
const DOM = {
  urlInput:     () => document.getElementById('urlInput'),
  summarizeBtn: () => document.getElementById('summarizeBtn'),
  errorMsg:     () => document.getElementById('errorMsg'),
  errorText:    () => document.getElementById('errorText'),
  skeletonWrap: () => document.getElementById('skeletonWrap'),
  resultCard:   () => document.getElementById('resultCard'),
  resultBody:   () => document.getElementById('resultBody'),
  modeBadge:    () => document.getElementById('modeBadge'),
  themeBtn:     () => document.getElementById('themeBtn'),
  chips:        () => document.querySelectorAll('.chip'),
  copyBtn:      () => document.querySelector('.btn-copy'),
};

/* ─────────────────────────────────────────
   4. التحقق من رابط YouTube
   ───────────────────────────────────────── */

/**
 * يتحقق من أن الرابط رابط يوتيوب صالح
 * @param {string} url
 * @returns {boolean}
 */
function isValidYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?.*v=[\w-]{11}/,
    /^https?:\/\/youtu\.be\/[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]{11}/,
    /^https?:\/\/m\.youtube\.com\/watch\?.*v=[\w-]{11}/,
  ];
  return patterns.some(p => p.test(url.trim()));
}

/**
 * يستخرج videoId من الرابط
 * @param {string} url
 * @returns {string|null}
 */
function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /shorts\/([\w-]{11})/,
    /embed\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/* ─────────────────────────────────────────
   5. كلاس الخطأ المخصص
   ───────────────────────────────────────── */
class ApiError extends Error {
  constructor(message, status = 500, code = 'UNKNOWN') {
    super(message);
    this.name   = 'ApiError';
    this.status = status;
    this.code   = code;
  }
}

/**
 * يحوّل كود الخطأ إلى رسالة عربية مناسبة للمستخدم
 * @param {ApiError} err
 * @returns {string}
 */
function resolveErrorMessage(err) {
  const codeMap = {
    NO_TRANSCRIPT:    LABELS.errors.no_subtitle,
    EMPTY_TRANSCRIPT: LABELS.errors.no_subtitle,
    VIDEO_TOO_LONG:   LABELS.errors.too_long,
    SERVER_DOWN:      LABELS.errors.server_down,
    RATE_LIMITED:     LABELS.errors.rate_limit,
    INVALID_API_KEY:  LABELS.errors.api_key,
    TIMEOUT:          'انتهت مهلة الطلب. حاول مع فيديو أقصر.',
  };
  if (err.code && codeMap[err.code]) return codeMap[err.code];

  const statusMap = {
    429: LABELS.errors.rate_limit,
    401: LABELS.errors.api_key,
    503: 'الخادم مشغول حالياً. حاول بعد لحظات.',
    504: 'انتهت مهلة الخادم. الفيديو طويل جداً.',
  };
  if (statusMap[err.status]) return statusMap[err.status];

  return err.message || LABELS.errors.generic;
}

/* ─────────────────────────────────────────
   6. طبقة API — الاتصال بالخادم
   ───────────────────────────────────────── */

/**
 * يرسل طلب التلخيص إلى /api/summarize
 * @param {string} videoId
 * @param {string} mode - 'detailed' | 'brief' | 'bullets'
 * @returns {Promise<Object>}
 */
async function fetchSummary(videoId, mode) {
  // إلغاء أي طلب سابق لم ينته بعد
  if (AppState.abortCtrl) AppState.abortCtrl.abort();
  AppState.abortCtrl = new AbortController();

  const timeoutId = setTimeout(
    () => AppState.abortCtrl.abort(),
    CONFIG.REQUEST_TIMEOUT_MS
  );

  try {
    const endpoint = `${CONFIG.API_BASE_URL}/api/summarize`;
    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ videoId, mode }),
      signal:  AppState.abortCtrl.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new ApiError(
        errBody.error?.message || errBody.message || 'خطأ من الخادم',
        response.status,
        errBody.error?.code || errBody.code
      );
    }

    const data = await response.json();

    // توحيد شكل الاستجابة — يدعم كلا الخادمين
    return normalizeResponse(data, videoId);

  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof ApiError) throw err;

    if (err.name === 'TypeError' && err.message.toLowerCase().includes('fetch'))
      throw new ApiError(LABELS.errors.server_down, 0, 'SERVER_DOWN');

    if (err.name === 'AbortError')
      throw new ApiError('انتهت مهلة الطلب. الفيديو قد يكون طويلاً جداً.', 408, 'TIMEOUT');

    throw new ApiError(LABELS.errors.generic, 500, 'UNKNOWN');
  }
}

/**
 * يوحّد شكل الاستجابة بغض النظر عن الخادم المستخدم
 * — يدعم api/summarize.js (Vercel) و server.js (Express + Claude)
 * @param {Object} raw
 * @param {string} videoId
 * @returns {Object}
 */
function normalizeResponse(raw, videoId) {
  // استجابة api/summarize.js حيث summary كائن فرعي
  if (raw.summary && typeof raw.summary === 'object') {
    return {
      videoId,
      title:     raw.title    || 'فيديو يوتيوب',
      channel:   raw.channel  || null,
      duration:  raw.duration || null,
      language:  raw.transcript?.language || null,
      thumbnail: typeof raw.thumbnail === 'object'
        ? raw.thumbnail.high
        : raw.thumbnail || null,
      summary:   raw.summary.shortSummary || null,
      keyPoints: raw.summary.keyPoints   || [],
      topics:    raw.summary.topics      || [],
      verdict:   null,
      stats: {
        wordCount:   raw.transcript?.totalWords || null,
        charCount:   null,
        readMinutes: raw.summary.stats?.readSeconds
          ? Math.ceil(raw.summary.stats.readSeconds / 60)
          : null,
      },
    };
  }

  // استجابة server.js حيث summary نص مباشر
  return {
    videoId:   raw.videoId   || videoId,
    title:     raw.title     || 'فيديو يوتيوب',
    channel:   raw.channel   || null,
    duration:  raw.duration  || null,
    language:  raw.language  || null,
    thumbnail: raw.thumbnail || null,
    summary:   raw.summary   || null,
    keyPoints: raw.keyPoints || [],
    topics:    raw.topics    || [],
    verdict:   raw.verdict   || null,
    stats:     raw.stats     || null,
  };
}

/* ─────────────────────────────────────────
   7. الدالة الرئيسية — summarize()
   ───────────────────────────────────────── */

/**
 * تُشغَّل عند الضغط على زر "تلخيص"
 * الضغط مرة ثانية أثناء التحميل يلغي الطلب
 */
async function summarize() {
  if (AppState.isLoading) {
    cancelRequest();
    return;
  }

  const url = DOM.urlInput().value.trim();

  clearError();
  DOM.resultCard().classList.remove('visible');

  if (!url)                    return showError(LABELS.errors.empty);
  if (!isValidYouTubeUrl(url)) { shakeInput(); return showError(LABELS.errors.invalid); }

  const videoId = extractVideoId(url);
  if (!videoId) return showError(LABELS.errors.invalid);

  setLoadingState(true);
  AppState.lastVideoId = videoId;

  try {
    const data = await fetchSummary(videoId, AppState.currentMode);
    AppState.lastData = data;

    saveToHistory({
      videoId,
      url,
      mode:      AppState.currentMode,
      timestamp: Date.now(),
      title:     data.title || 'فيديو يوتيوب',
    });

    renderResult(data, AppState.currentMode);

  } catch (err) {
    console.error('[Summarizer]', err);
    showError(resolveErrorMessage(err));
  } finally {
    setLoadingState(false);
  }
}

/* ─────────────────────────────────────────
   8. تغيير نوع الملخص
   ───────────────────────────────────────── */

/**
 * يغيّر نوع الملخص ويُعيد الجلب تلقائياً إن كان هناك فيديو سابق
 * @param {string} mode
 */
async function changeMode(mode) {
  if (mode === AppState.currentMode || AppState.isLoading) return;

  AppState.currentMode = mode;
  updateChipsUI(mode);
  DOM.modeBadge().textContent = LABELS.mode[mode];

  if (!AppState.lastVideoId) return;

  setLoadingState(true);
  try {
    const data = await fetchSummary(AppState.lastVideoId, mode);
    AppState.lastData = data;
    renderResult(data, mode);
  } catch (err) {
    showError(resolveErrorMessage(err));
  } finally {
    setLoadingState(false);
  }
}

/** يُفعَّل من onclick على شرائح نوع الملخص */
function selectMode(el) {
  const mode = el.dataset?.mode;
  if (mode) changeMode(mode);
}

/** يلغي الطلب الحالي */
function cancelRequest() {
  if (AppState.abortCtrl) {
    AppState.abortCtrl.abort();
    AppState.abortCtrl = null;
  }
  setLoadingState(false);
  showError('تم إلغاء الطلب.');
}

/* ─────────────────────────────────────────
   9. بناء HTML النتيجة
   ───────────────────────────────────────── */

/**
 * يبني HTML منسّقاً من بيانات الملخص
 * @param {Object} data
 * @param {string} mode
 * @returns {string}
 */
function buildResultHTML(data, mode) {
  const parts = [];
  const thumb = typeof data.thumbnail === 'string'
    ? data.thumbnail
    : `https://img.youtube.com/vi/${sanitize(data.videoId)}/hqdefault.jpg`;

  // ── معلومات الفيديو ──
  parts.push(`
    <div class="video-meta">
      <div class="video-thumbnail">
        <img src="${sanitize(thumb)}"
             alt="صورة مصغرة"
             onerror="this.style.display='none'"
             loading="lazy" />
        ${data.duration
          ? `<span class="duration-badge">${sanitize(data.duration)}</span>`
          : ''}
      </div>
      <div class="video-info">
        <div class="video-title">${sanitize(data.title || 'فيديو يوتيوب')}</div>
        ${data.channel
          ? `<div class="video-channel">
               <span class="channel-icon">📺</span>
               ${sanitize(data.channel)}
             </div>`
          : ''}
        ${data.language
          ? `<div class="video-channel" style="margin-top:4px">
               <span class="channel-icon">🌐</span>
               لغة الفيديو: ${sanitize(data.language)}
             </div>`
          : ''}
        ${data.topics?.length
          ? `<div class="video-topics">
               ${data.topics.map(t => `<span class="topic-tag">${sanitize(t)}</span>`).join('')}
             </div>`
          : ''}
      </div>
    </div>
  `);

  // ── الملخص النصي ──
  if (data.summary) {
    parts.push(`
      <div class="section-title">📝 الملخص</div>
      <p class="summary-text">${sanitize(data.summary)}</p>
    `);
  }

  // ── النقاط الرئيسية ──
  if (data.keyPoints?.length) {
    const heading = mode === 'bullets' ? '📌 النقاط التفصيلية' : '✅ أبرز النقاط';
    parts.push(`
      <div class="section-title">${heading}</div>
      <ul class="key-points">
        ${data.keyPoints.map((pt, i) => `
          <li class="key-point" style="animation-delay:${i * 60}ms">
            ${sanitize(pt)}
          </li>`).join('')}
      </ul>
    `);
  }

  // ── التقييم / الخلاصة ──
  if (data.verdict) {
    parts.push(`
      <div class="highlight-box">
        💡 <strong>التقييم:</strong> ${sanitize(data.verdict)}
      </div>
    `);
  }

  // ── إحصائيات ──
  if (data.stats) {
    const { wordCount, charCount, readMinutes } = data.stats;
    if (wordCount || charCount || readMinutes) {
      parts.push(`
        <div class="stats-row">
          ${wordCount   ? `<span class="stat-chip">📄 ${wordCount} كلمة</span>` : ''}
          ${charCount   ? `<span class="stat-chip">🔤 ${charCount} حرف</span>` : ''}
          ${readMinutes ? `<span class="stat-chip">⏱️ ${readMinutes} د قراءة</span>` : ''}
        </div>
      `);
    }
  }

  // ── أزرار تبديل نوع الملخص ──
  parts.push(`
    <div class="result-actions">
      <button class="btn-action ${mode === 'detailed' ? 'active' : ''}"
              onclick="window.YTSummarizer.changeMode('detailed')">📄 تفصيلي</button>
      <button class="btn-action ${mode === 'brief' ? 'active' : ''}"
              onclick="window.YTSummarizer.changeMode('brief')">⚡ مختصر</button>
      <button class="btn-action ${mode === 'bullets' ? 'active' : ''}"
              onclick="window.YTSummarizer.changeMode('bullets')">📋 نقاط</button>
    </div>
  `);

  return parts.join('\n');
}

/* ─────────────────────────────────────────
   10. عرض النتيجة
   ───────────────────────────────────────── */

/**
 * يعرض بيانات الملخص في الواجهة مع أنيميشن
 * @param {Object} data
 * @param {string} mode
 */
function renderResult(data, mode) {
  const resultCard = DOM.resultCard();
  resultCard.classList.remove('visible');

  requestAnimationFrame(() => {
    DOM.modeBadge().textContent = LABELS.mode[mode];
    DOM.resultBody().innerHTML  = buildResultHTML(data, mode);
    animateKeyPoints();

    requestAnimationFrame(() => {
      resultCard.classList.add('visible');
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

/** أنيميشن دخول متتالٍ لنقاط القائمة */
function animateKeyPoints() {
  DOM.resultBody().querySelectorAll('.key-point').forEach((el, i) => {
    el.style.cssText = 'opacity:0;transform:translateY(8px)';
    setTimeout(() => {
      el.style.cssText =
        'transition:opacity .3s ease,transform .3s ease;opacity:1;transform:translateY(0)';
    }, 80 + i * 65);
  });
}

/* ─────────────────────────────────────────
   11. حالة التحميل
   ───────────────────────────────────────── */

/**
 * يُفعّل أو يُوقف حالة التحميل في الواجهة
 * @param {boolean} isLoading
 */
function setLoadingState(isLoading) {
  AppState.isLoading = isLoading;
  const btn      = DOM.summarizeBtn();
  const skeleton = DOM.skeletonWrap();

  btn.disabled = false; // يبقى قابلاً للضغط (للإلغاء)

  if (isLoading) {
    btn.innerHTML = `
      <span class="btn-spinner"></span> جارٍ التلخيص...
      <small style="opacity:.65;font-size:.78em;display:block;margin-top:2px">
        (اضغط للإلغاء)
      </small>`;
    btn.style.background = 'linear-gradient(135deg,#555,#333)';
    skeleton.classList.add('visible');
    DOM.resultCard().classList.remove('visible');
  } else {
    btn.innerHTML        = '✨ تلخيص';
    btn.style.background = '';
    skeleton.classList.remove('visible');
  }
}

/* ─────────────────────────────────────────
   12. رسائل الخطأ
   ───────────────────────────────────────── */

function showError(message) {
  const errorMsg  = DOM.errorMsg();
  const errorText = DOM.errorText();
  errorText.textContent = message;
  errorMsg.classList.remove('visible');
  void errorMsg.offsetWidth; // force reflow لإعادة الأنيميشن
  errorMsg.classList.add('visible');
}

function clearError() {
  DOM.errorMsg().classList.remove('visible');
}

function shakeInput() {
  const input = DOM.urlInput();
  input.classList.add('shake');
  input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
}

/* ─────────────────────────────────────────
   13. النسخ إلى الحافظة
   ───────────────────────────────────────── */

async function copyResult() {
  const text = DOM.resultBody()?.innerText?.trim();
  if (!text) return;

  const btn = DOM.copyBtn();
  const feedback = (ok) => {
    btn.innerHTML         = ok ? '✅ تم النسخ!' : '❌ فشل النسخ';
    btn.style.color       = ok ? 'var(--accent)' : '#e55';
    btn.style.borderColor = ok ? 'var(--accent)' : '#e55';
    setTimeout(() => {
      btn.innerHTML         = '📋 نسخ';
      btn.style.color       = '';
      btn.style.borderColor = '';
    }, CONFIG.COPY_FEEDBACK_MS);
  };

  try {
    await navigator.clipboard.writeText(text);
    feedback(true);
  } catch {
    // Fallback للمتصفحات التي لا تدعم Clipboard API
    const ta = Object.assign(document.createElement('textarea'), {
      value: text,
      style: 'position:fixed;opacity:0;pointer-events:none',
    });
    document.body.appendChild(ta);
    ta.select();
    feedback(document.execCommand('copy'));
    document.body.removeChild(ta);
  }
}

/* ─────────────────────────────────────────
   14. المظهر الداكن / الفاتح
   ───────────────────────────────────────── */

function toggleTheme() {
  AppState.isDarkTheme = !AppState.isDarkTheme;
  const theme = AppState.isDarkTheme ? '' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  DOM.themeBtn().textContent = AppState.isDarkTheme ? '🌙' : '☀️';
  try { localStorage.setItem('yt-summarizer-theme', theme); } catch { /* صامت */ }
}

function loadSavedTheme() {
  try {
    if (localStorage.getItem('yt-summarizer-theme') === 'light') {
      AppState.isDarkTheme = false;
      document.documentElement.setAttribute('data-theme', 'light');
      if (DOM.themeBtn()) DOM.themeBtn().textContent = '☀️';
    }
  } catch { /* صامت */ }
}

/* ─────────────────────────────────────────
   15. الشرائح والسجل
   ───────────────────────────────────────── */

function updateChipsUI(activeMode) {
  DOM.chips().forEach(chip => {
    const active = chip.dataset.mode === activeMode;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
}

function saveToHistory(entry) {
  AppState.history.unshift(entry);
  if (AppState.history.length > CONFIG.MAX_HISTORY) AppState.history.pop();
  try {
    localStorage.setItem('yt-summarizer-history', JSON.stringify(AppState.history));
  } catch { /* صامت */ }
}

function loadHistory() {
  try {
    const saved = localStorage.getItem('yt-summarizer-history');
    if (saved) AppState.history = JSON.parse(saved);
  } catch { /* صامت */ }
}

/* ─────────────────────────────────────────
   16. فحص اتصال الخادم عند التحميل
   ───────────────────────────────────────── */

async function checkServerHealth() {
  // لا حاجة للفحص على Vercel (نفس النطاق)
  if (!CONFIG.API_BASE_URL) return;

  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      console.info('[Summarizer] ✅ الخادم متصل');
    } else {
      showServerBanner('error');
    }
  } catch {
    console.warn('[Summarizer] ⚠️ الخادم غير متصل');
    showServerBanner('disconnected');
  }
}

function showServerBanner(status) {
  document.getElementById('serverBanner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'serverBanner';
  banner.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:9999;
    padding:10px 20px;font-family:Cairo,sans-serif;font-size:.85rem;
    font-weight:700;text-align:center;direction:rtl;color:#fff;
    box-shadow:0 2px 12px rgba(0,0,0,.3);animation:slideDown .3s ease;
    background:${status === 'disconnected' ? '#c0392b' : '#e67e22'};
  `;

  const message = status === 'disconnected'
    ? `⚠️ الخادم غير متصل — شغّل: <code style="background:rgba(0,0,0,.2);padding:2px 8px;border-radius:4px">node server.js</code>`
    : `⚠️ الخادم يعمل لكن ثمة خطأ — تحقق من إعدادات API`;

  banner.innerHTML = `${message}
    <button onclick="this.parentElement.remove()"
            style="margin-right:12px;background:rgba(255,255,255,.25);border:none;
                   color:#fff;cursor:pointer;border-radius:4px;padding:2px 10px;
                   font-family:Cairo,sans-serif">✕</button>`;

  document.body.prepend(banner);
}

/* ─────────────────────────────────────────
   17. أدوات مساعدة
   ───────────────────────────────────────── */

/** يؤمّن النص ضد XSS قبل إدراجه في innerHTML */
function sanitize(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;');
}

/** يؤخّر تنفيذ الدالة لتجنب الاستدعاء الزائد (Debounce) */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ─────────────────────────────────────────
   18. التحقق المباشر أثناء الكتابة
   ───────────────────────────────────────── */
const liveValidate = debounce(() => {
  const url   = DOM.urlInput()?.value.trim();
  const input = DOM.urlInput();
  if (!input) return;

  if (!url) {
    input.style.borderColor = '';
    clearError();
    return;
  }

  if (isValidYouTubeUrl(url)) {
    input.style.borderColor = '#3dbb85'; // أخضر = صالح
    clearError();
  } else if (url.length > 15) {
    input.style.borderColor = 'var(--accent)'; // أحمر = خطأ
  }
}, 350);

/* ─────────────────────────────────────────
   19. CSS الديناميكي للعناصر المُنشأة برمجياً
   ───────────────────────────────────────── */
function injectDynamicStyles() {
  if (document.getElementById('yt-dynamic-styles')) return;

  const style = document.createElement('style');
  style.id = 'yt-dynamic-styles';
  style.textContent = `
    @keyframes slideDown {
      from { transform:translateY(-100%); opacity:0; }
      to   { transform:translateY(0);     opacity:1; }
    }
    @keyframes inputShake {
      0%,100% { transform:translateX(0); }
      20%     { transform:translateX(-7px); }
      40%     { transform:translateX(6px); }
      60%     { transform:translateX(-4px); }
      80%     { transform:translateX(3px); }
    }
    @keyframes spin { to { transform:rotate(360deg); } }

    .url-input.shake { animation: inputShake .4s ease; }

    .btn-spinner {
      display:inline-block; width:13px; height:13px;
      border:2px solid rgba(255,255,255,.3); border-top-color:#fff;
      border-radius:50%; animation:spin .7s linear infinite;
      vertical-align:middle; margin-left:6px;
    }

    .video-meta {
      display:flex; gap:16px; margin-bottom:20px; padding:16px;
      background:var(--surface2); border-radius:var(--radius);
      border:1px solid var(--border-soft); align-items:flex-start;
    }
    .video-thumbnail { position:relative; flex-shrink:0; width:130px; }
    .video-thumbnail img {
      width:130px; height:73px; object-fit:cover;
      border-radius:8px; background:var(--surface3); display:block;
    }
    .duration-badge {
      position:absolute; bottom:4px; left:4px;
      background:rgba(0,0,0,.8); color:#fff;
      font-size:.68rem; font-weight:700; padding:2px 7px;
      border-radius:4px; direction:ltr; font-family:monospace;
    }
    .video-info { flex:1; min-width:0; }
    .video-title {
      font-size:.95rem; font-weight:700; color:var(--text);
      line-height:1.45; margin-bottom:6px;
      display:-webkit-box; -webkit-line-clamp:2;
      -webkit-box-orient:vertical; overflow:hidden;
    }
    .video-channel {
      font-size:.8rem; color:var(--text-muted);
      margin-bottom:6px; display:flex; align-items:center; gap:5px;
    }
    .video-topics { display:flex; flex-wrap:wrap; gap:5px; }
    .topic-tag {
      background:var(--accent-pale); color:var(--accent);
      border:1px solid rgba(232,66,58,.18);
      border-radius:999px; padding:2px 10px;
      font-size:.7rem; font-weight:700;
    }
    .summary-text { color:var(--text-soft); line-height:2; margin-bottom:4px; }
    .stats-row {
      display:flex; flex-wrap:wrap; gap:8px;
      margin:14px 0 4px; padding-top:14px;
      border-top:1px solid var(--border);
    }
    .stat-chip {
      background:var(--surface2); border:1px solid var(--border);
      border-radius:999px; padding:3px 12px;
      font-size:.75rem; font-weight:600; color:var(--text-muted);
    }
    .result-actions {
      display:flex; gap:8px; margin-top:20px;
      padding-top:16px; border-top:1px solid var(--border); flex-wrap:wrap;
    }
    .btn-action {
      flex:1; min-width:80px; background:var(--surface2);
      border:1.5px solid var(--border); border-radius:var(--radius-sm);
      padding:9px 12px; font-family:Cairo,sans-serif;
      font-size:.8rem; font-weight:700; color:var(--text-muted);
      cursor:pointer; transition:all .15s ease; text-align:center;
    }
    .btn-action:hover, .btn-action.active {
      border-color:var(--accent); color:var(--accent); background:var(--accent-pale);
    }
    .btn-action:active { transform:scale(.95); }

    @media (max-width:480px) {
      .video-meta { flex-direction:column; }
      .video-thumbnail, .video-thumbnail img { width:100%; }
      .video-thumbnail img { height:150px; }
      .result-actions { gap:6px; }
      .btn-action { font-size:.76rem; padding:8px; }
    }
  `;

  document.head.appendChild(style);
}

/* ─────────────────────────────────────────
   20. مستمعو الأحداث
   ───────────────────────────────────────── */
function initEventListeners() {
  DOM.summarizeBtn()?.addEventListener('click',   summarize);
  DOM.urlInput()?.addEventListener('keydown', e => { if (e.key === 'Enter') summarize(); });
  DOM.urlInput()?.addEventListener('input',   liveValidate);
  DOM.urlInput()?.addEventListener('paste',   () => setTimeout(liveValidate, 50));
  DOM.urlInput()?.addEventListener('focus',   clearError);
  DOM.themeBtn()?.addEventListener('click',   toggleTheme);
  DOM.chips()?.forEach(chip => chip.addEventListener('click', () => selectMode(chip)));
  DOM.copyBtn()?.addEventListener('click',    copyResult);
}

/* ─────────────────────────────────────────
   21. تهيئة التطبيق — نقطة الدخول
   ───────────────────────────────────────── */
function init() {
  injectDynamicStyles();
  loadSavedTheme();
  loadHistory();
  initEventListeners();
  updateChipsUI(AppState.currentMode);

  // تعيين ARIA attributes للشرائح
  DOM.chips()?.forEach(chip => {
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-pressed',
      chip.classList.contains('active') ? 'true' : 'false'
    );
  });

  // فحص اتصال الخادم (في الوضع المحلي فقط)
  checkServerHealth();

  console.info('[Summarizer] ✅ جاهز للعمل');
}

// تشغيل عند اكتمال تحميل DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ─────────────────────────────────────────
   22. API العامة — للاستخدام من HTML وملفات أخرى
   ───────────────────────────────────────── */
window.YTSummarizer = {
  summarize,
  changeMode,
  selectMode,
  copyResult,
  toggleTheme,
  extractVideoId,
  isValidYouTubeUrl,
};
