/* ============================================================
   script.js — ملخّص يوتيوب
   المنطق الكامل: تحقق الرابط | تحميل | عرض النتيجة
   ============================================================ */

'use strict';

/* ─────────────────────────────────────────
   1. الحالة العامة للتطبيق — App State
   ───────────────────────────────────────── */
const AppState = {
  currentMode:    'detailed',   // نوع الملخص المختار
  isLoading:      false,        // هل التطبيق في حالة تحميل؟
  lastVideoId:    null,         // آخر معرّف فيديو تمت معالجته
  isDarkTheme:    true,         // هل الوضع الداكن مفعّل؟
  history:        [],           // سجل الملخصات السابقة (حد أقصى 10)
};

/* ─────────────────────────────────────────
   2. مراجع عناصر DOM
   ───────────────────────────────────────── */
const DOM = {
  urlInput:       () => document.getElementById('urlInput'),
  summarizeBtn:   () => document.getElementById('summarizeBtn'),
  errorMsg:       () => document.getElementById('errorMsg'),
  errorText:      () => document.getElementById('errorText'),
  skeletonWrap:   () => document.getElementById('skeletonWrap'),
  resultCard:     () => document.getElementById('resultCard'),
  resultBody:     () => document.getElementById('resultBody'),
  modeBadge:      () => document.getElementById('modeBadge'),
  themeBtn:       () => document.getElementById('themeBtn'),
  chips:          () => document.querySelectorAll('.chip'),
  copyBtn:        () => document.querySelector('.btn-copy'),
};

/* ─────────────────────────────────────────
   3. ثوابت
   ───────────────────────────────────────── */
const CONFIG = {
  MOCK_DELAY_MIN:  1800,   // أقل وقت تحميل وهمي (ms)
  MOCK_DELAY_MAX:  3200,   // أكبر وقت تحميل وهمي (ms)
  MAX_HISTORY:     10,     // أقصى عدد ملخصات في السجل
  COPY_FEEDBACK_MS: 2000,  // مدة ظهور رسالة "تم النسخ"
};

const LABELS = {
  mode: {
    detailed: 'تفصيلي',
    brief:    'مختصر',
    bullets:  'نقاط رئيسية',
  },
  errors: {
    empty:   'يرجى إدخال رابط الفيديو أولاً.',
    invalid: 'الرابط غير صحيح. يرجى إدخال رابط يوتيوب صالح.',
    failed:  'حدث خطأ أثناء التلخيص. يرجى المحاولة مجدداً.',
  },
};

/* ─────────────────────────────────────────
   4. التحقق من رابط YouTube
   ───────────────────────────────────────── */

/**
 * يتحقق من أن الرابط رابط يوتيوب صالح
 * يدعم: youtube.com/watch, youtu.be, youtube.com/shorts
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

  return patterns.some(pattern => pattern.test(url.trim()));
}

/**
 * يستخرج معرّف الفيديو (videoId) من الرابط
 * @param {string} url
 * @returns {string|null}
 */
function extractVideoId(url) {
  if (!url) return null;

  const patterns = [
    /[?&]v=([\w-]{11})/,           // youtube.com/watch?v=XXX
    /youtu\.be\/([\w-]{11})/,       // youtu.be/XXX
    /shorts\/([\w-]{11})/,          // youtube.com/shorts/XXX
    /embed\/([\w-]{11})/,           // youtube.com/embed/XXX
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/* ─────────────────────────────────────────
   5. الدالة الوهمية — Mock API
   ───────────────────────────────────────── */

/**
 * محاكاة استجابة API التلخيص
 * في البيئة الحقيقية: استبدل بـ fetch() لنقطة نهاية الخادم
 * @param {string} videoId
 * @param {string} mode  - 'detailed' | 'brief' | 'bullets'
 * @returns {Promise<Object>}
 */
async function mockSummary(videoId, mode = 'detailed') {
  // محاكاة تأخير الشبكة
  const delay = CONFIG.MOCK_DELAY_MIN
    + Math.random() * (CONFIG.MOCK_DELAY_MAX - CONFIG.MOCK_DELAY_MIN);
  await sleep(delay);

  // بيانات تجريبية مختلفة بحسب نوع الملخص
  const base = {
    videoId,
    title:    'كيف يغيّر الذكاء الاصطناعي مستقبل التعليم',
    channel:  'قناة المعرفة العربية',
    duration: '18:42',
    language: 'ar',
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  };

  const content = {
    detailed: {
      summary: `يستعرض هذا الفيديو بعمق كيف يُعيد الذكاء الاصطناعي تشكيل منظومة التعليم
        العالمية، بدءاً من الفصول الافتراضية الذكية وصولاً إلى مناهج مخصّصة لكل متعلم.
        يرصد المقدم تجارب حقيقية من مدارس في فنلندا وكوريا الجنوبية والإمارات،
        ويحلل البيانات التي تثبت ارتفاع معدلات الاستيعاب بنسبة تصل إلى 40%
        حين يُدمج الذكاء الاصطناعي في العملية التعليمية.`,
      keyPoints: [
        'الذكاء الاصطناعي يتيح تجربة تعلّم مخصّصة لكل طالب بحسب مستواه ووتيرته',
        'نماذج GPT التعليمية تُساعد المعلمين على توليد محتوى تفاعلي في دقائق',
        'تجربة فنلندا أثبتت ارتفاع التحصيل الدراسي 37% بعد دمج أدوات الذكاء الاصطناعي',
        'التحدي الأكبر يكمن في الفجوة الرقمية بين المناطق الحضرية والريفية',
        'التقييم الآلي اللحظي يمنح المعلم وقتاً أكبر للتركيز على التفكير النقدي',
      ],
      topics: ['الذكاء الاصطناعي', 'التعليم الرقمي', 'التعلم الشخصي', 'مستقبل المناهج'],
      verdict: 'محتوى تعليمي عالي الجودة — مناسب للمعلمين وصانعي القرار في التعليم',
    },

    brief: {
      summary: `الذكاء الاصطناعي يُحوّل التعليم من نموذج موحّد إلى تجربة مخصّصة لكل متعلم.
        الأدلة الدولية تدعم هذا التوجه، والتحدي الرئيسي هو ضمان وصوله للجميع.`,
      keyPoints: [
        'التعلم الشخصي عبر الذكاء الاصطناعي يرفع التحصيل بنسب موثّقة',
        'الفجوة الرقمية تهدد عدالة توزيع الفرص التعليمية',
        'دور المعلم يتحوّل من ناقل معلومات إلى مرشد وميسّر',
      ],
      topics: ['الذكاء الاصطناعي', 'التعليم'],
      verdict: 'ملخص مكثّف — مثالي لمن يريد الفكرة الجوهرية بسرعة',
    },

    bullets: {
      summary: null,
      keyPoints: [
        'المقدمة: إشكالية نموذج التعليم التقليدي الذي لا يُراعي الفروق الفردية',
        'الحل: أنظمة ذكاء اصطناعي تتكيّف مع مستوى وأسلوب تعلّم كل طالب',
        'الدليل: دراسات من 12 دولة تُثبت فعالية المناهج المدعومة بالذكاء الاصطناعي',
        'التحدي الأول: تكلفة البنية التحتية التقنية في الدول النامية',
        'التحدي الثاني: تأهيل المعلمين للتعامل مع الأدوات الجديدة',
        'الرؤية المستقبلية: فصول دراسية هجينة تجمع التعليم الإنساني والذكاء الاصطناعي',
        'الخلاصة: الذكاء الاصطناعي أداة تُعزز المعلم ولا تستبدله',
      ],
      topics: ['الذكاء الاصطناعي', 'التعليم الرقمي', 'إصلاح التعليم', 'التكنولوجيا'],
      verdict: 'تغطية شاملة للنقاط — مثالي للباحثين وصانعي المحتوى',
    },
  };

  return { ...base, ...content[mode] };
}

/* ─────────────────────────────────────────
   6. بناء HTML النتيجة
   ───────────────────────────────────────── */

/**
 * يبني HTML منسقاً من بيانات الملخص
 * @param {Object} data - بيانات الملخص من mockSummary()
 * @param {string} mode - نوع الملخص
 * @returns {string} HTML string
 */
function buildResultHTML(data, mode) {
  const parts = [];

  // ── معلومات الفيديو ──
  parts.push(`
    <div class="video-meta">
      <div class="video-thumbnail">
        <img
          src="${sanitize(data.thumbnail)}"
          alt="صورة مصغرة"
          onerror="this.style.display='none'"
          loading="lazy"
        />
        <span class="duration-badge">${sanitize(data.duration)}</span>
      </div>
      <div class="video-info">
        <div class="video-title">${sanitize(data.title)}</div>
        <div class="video-channel">
          <span class="channel-icon">📺</span>
          ${sanitize(data.channel)}
        </div>
        <div class="video-topics">
          ${data.topics.map(t => `<span class="topic-tag">${sanitize(t)}</span>`).join('')}
        </div>
      </div>
    </div>
  `);

  // ── الملخص النصي (للتفصيلي والمختصر) ──
  if (data.summary) {
    parts.push(`
      <div class="section-title">📝 الملخص</div>
      <p class="summary-text">${sanitize(data.summary)}</p>
    `);
  }

  // ── النقاط الرئيسية ──
  if (data.keyPoints && data.keyPoints.length) {
    const heading = mode === 'bullets' ? '📌 النقاط التفصيلية' : '✅ أبرز النقاط';
    parts.push(`
      <div class="section-title">${heading}</div>
      <ul class="key-points">
        ${data.keyPoints.map((point, i) => `
          <li class="key-point" style="animation-delay:${i * 60}ms">
            ${sanitize(point)}
          </li>
        `).join('')}
      </ul>
    `);
  }

  // ── حكم وتوصية ──
  if (data.verdict) {
    parts.push(`
      <div class="highlight-box">
        💡 <strong>التقييم:</strong> ${sanitize(data.verdict)}
      </div>
    `);
  }

  // ── إجراءات إضافية ──
  parts.push(`
    <div class="result-actions">
      <button class="btn-action" onclick="changeMode('detailed')" title="تفصيلي">
        📄 تفصيلي
      </button>
      <button class="btn-action" onclick="changeMode('brief')" title="مختصر">
        ⚡ مختصر
      </button>
      <button class="btn-action" onclick="changeMode('bullets')" title="نقاط">
        📋 نقاط
      </button>
    </div>
  `);

  return parts.join('\n');
}

/* ─────────────────────────────────────────
   7. الوظيفة الرئيسية — summarize()
   ───────────────────────────────────────── */

/**
 * الوظيفة الرئيسية: تُشغَّل عند الضغط على زر التلخيص
 */
async function summarize() {
  // منع التشغيل المتكرر
  if (AppState.isLoading) return;

  const url = DOM.urlInput().value.trim();

  // ── التحقق من الإدخال ──
  clearError();
  DOM.resultCard().classList.remove('visible');

  if (!url) {
    return showError(LABELS.errors.empty);
  }

  if (!isValidYouTubeUrl(url)) {
    shakeInput();
    return showError(LABELS.errors.invalid);
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return showError(LABELS.errors.invalid);
  }

  // ── بدء حالة التحميل ──
  setLoadingState(true);

  try {
    // استدعاء الدالة الوهمية (استبدلها بـ API حقيقي لاحقاً)
    const data = await mockSummary(videoId, AppState.currentMode);

    // حفظ في السجل
    saveToHistory({ videoId, url, mode: AppState.currentMode, timestamp: Date.now(), title: data.title });

    // بناء وعرض النتيجة
    AppState.lastVideoId = videoId;
    renderResult(data, AppState.currentMode);

  } catch (error) {
    console.error('[Summarizer] خطأ في التلخيص:', error);
    showError(LABELS.errors.failed);
  } finally {
    setLoadingState(false);
  }
}

/* ─────────────────────────────────────────
   8. تغيير نوع الملخص مع إعادة المعالجة
   ───────────────────────────────────────── */

/**
 * يُغيّر نوع الملخص ويُعيد الجلب إن كان هناك فيديو سابق
 * @param {string} mode
 */
async function changeMode(mode) {
  if (mode === AppState.currentMode) return;

  // تحديث واجهة الشرائح
  AppState.currentMode = mode;
  updateChipsUI(mode);
  DOM.modeBadge().textContent = LABELS.mode[mode];

  // إن كان هناك فيديو سبق تلخيصه، أعد التلخيص بالنوع الجديد
  if (AppState.lastVideoId && !AppState.isLoading) {
    setLoadingState(true);
    try {
      const data = await mockSummary(AppState.lastVideoId, mode);
      renderResult(data, mode);
    } catch {
      showError(LABELS.errors.failed);
    } finally {
      setLoadingState(false);
    }
  }
}

/**
 * يُفعَّل عند الضغط على شرائح نوع الملخص في الواجهة
 * @param {HTMLElement} el
 */
function selectMode(el) {
  const mode = el.dataset.mode;
  if (!mode) return;
  changeMode(mode);
}

/* ─────────────────────────────────────────
   9. عرض النتيجة — renderResult()
   ───────────────────────────────────────── */

/**
 * يعرض بيانات الملخص في الواجهة
 * @param {Object} data
 * @param {string} mode
 */
function renderResult(data, mode) {
  const resultCard = DOM.resultCard();
  const resultBody = DOM.resultBody();

  // إخفاء مؤقت قبل التحديث لضمان إعادة الأنيميشن
  resultCard.classList.remove('visible');

  requestAnimationFrame(() => {
    DOM.modeBadge().textContent = LABELS.mode[mode];
    resultBody.innerHTML = buildResultHTML(data, mode);

    // إضافة ستايل مُدرَج للنقاط
    animateKeyPoints();

    // إظهار البطاقة بأنيميشن
    requestAnimationFrame(() => {
      resultCard.classList.add('visible');
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

/**
 * يُفعّل أنيميشن دخول متتالي لنقاط القائمة
 */
function animateKeyPoints() {
  const points = DOM.resultBody().querySelectorAll('.key-point');
  points.forEach((point, i) => {
    point.style.opacity = '0';
    point.style.transform = 'translateY(8px)';
    setTimeout(() => {
      point.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      point.style.opacity = '1';
      point.style.transform = 'translateY(0)';
    }, 80 + i * 65);
  });
}

/* ─────────────────────────────────────────
   10. حالة التحميل — Loading State
   ───────────────────────────────────────── */

/**
 * يُفعّل أو يُوقف حالة التحميل في الواجهة
 * @param {boolean} isLoading
 */
function setLoadingState(isLoading) {
  AppState.isLoading = isLoading;
  const btn = DOM.summarizeBtn();
  const skeleton = DOM.skeletonWrap();

  btn.disabled = isLoading;

  if (isLoading) {
    btn.innerHTML = `
      <span class="btn-spinner"></span>
      جارٍ التلخيص...
    `;
    skeleton.classList.add('visible');
    DOM.resultCard().classList.remove('visible');
  } else {
    btn.innerHTML = '✨ تلخيص';
    skeleton.classList.remove('visible');
  }
}

/* ─────────────────────────────────────────
   11. إدارة رسائل الخطأ
   ───────────────────────────────────────── */

/**
 * يعرض رسالة خطأ
 * @param {string} message
 */
function showError(message) {
  const errorMsg  = DOM.errorMsg();
  const errorText = DOM.errorText();

  errorText.textContent = message;

  // إعادة تشغيل الأنيميشن
  errorMsg.classList.remove('visible');
  void errorMsg.offsetWidth; // force reflow
  errorMsg.classList.add('visible');
}

/**
 * يُخفي رسالة الخطأ
 */
function clearError() {
  DOM.errorMsg().classList.remove('visible');
}

/**
 * يُضيف تأثير اهتزاز لحقل الإدخال عند الخطأ
 */
function shakeInput() {
  const input = DOM.urlInput();
  input.classList.add('shake');
  input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
}

/* ─────────────────────────────────────────
   12. وظيفة النسخ — Copy
   ───────────────────────────────────────── */

/**
 * ينسخ النص الكامل للملخص إلى الحافظة
 */
async function copyResult() {
  const resultBody = DOM.resultBody();
  if (!resultBody || !resultBody.innerText.trim()) return;

  const text = resultBody.innerText.trim();
  const btn  = DOM.copyBtn();

  try {
    await navigator.clipboard.writeText(text);

    // تغذية راجعة بصرية
    btn.innerHTML = '✅ تم النسخ!';
    btn.style.color = 'var(--accent)';
    btn.style.borderColor = 'var(--accent)';

    setTimeout(() => {
      btn.innerHTML = '📋 نسخ';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, CONFIG.COPY_FEEDBACK_MS);

  } catch {
    // Fallback لبيئات بدون clipboard API
    fallbackCopy(text);
  }
}

/**
 * نسخ احتياطي للمتصفحات القديمة
 * @param {string} text
 */
function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);

  const btn = DOM.copyBtn();
  btn.innerHTML = '✅ تم النسخ!';
  setTimeout(() => { btn.innerHTML = '📋 نسخ'; }, CONFIG.COPY_FEEDBACK_MS);
}

/* ─────────────────────────────────────────
   13. تبديل المظهر — Theme Toggle
   ───────────────────────────────────────── */

/**
 * يُبدّل بين الوضع الداكن والفاتح ويحفظ التفضيل
 */
function toggleTheme() {
  AppState.isDarkTheme = !AppState.isDarkTheme;
  const theme = AppState.isDarkTheme ? '' : 'light';

  document.documentElement.setAttribute('data-theme', theme);
  DOM.themeBtn().textContent = AppState.isDarkTheme ? '🌙' : '☀️';

  // حفظ التفضيل في localStorage
  try {
    localStorage.setItem('yt-summarizer-theme', theme);
  } catch { /* صامت في البيئات المقيدة */ }
}

/**
 * يُحمّل تفضيل المظهر المحفوظ
 */
function loadSavedTheme() {
  try {
    const saved = localStorage.getItem('yt-summarizer-theme');
    if (saved === 'light') {
      AppState.isDarkTheme = false;
      document.documentElement.setAttribute('data-theme', 'light');
      const btn = DOM.themeBtn();
      if (btn) btn.textContent = '☀️';
    }
  } catch { /* صامت */ }
}

/* ─────────────────────────────────────────
   14. تحديث واجهة الشرائح
   ───────────────────────────────────────── */

/**
 * يُحدّث حالة الشرائح لتعكس الوضع الحالي
 * @param {string} activeMode
 */
function updateChipsUI(activeMode) {
  DOM.chips().forEach(chip => {
    const isActive = chip.dataset.mode === activeMode;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/* ─────────────────────────────────────────
   15. السجل — History
   ───────────────────────────────────────── */

/**
 * يحفظ ملخصاً في السجل المحلي
 * @param {Object} entry
 */
function saveToHistory(entry) {
  AppState.history.unshift(entry);
  if (AppState.history.length > CONFIG.MAX_HISTORY) {
    AppState.history.pop();
  }

  try {
    localStorage.setItem('yt-summarizer-history', JSON.stringify(AppState.history));
  } catch { /* صامت */ }
}

/**
 * يُحمّل السجل من التخزين المحلي
 */
function loadHistory() {
  try {
    const saved = localStorage.getItem('yt-summarizer-history');
    if (saved) AppState.history = JSON.parse(saved);
  } catch { /* صامت */ }
}

/* ─────────────────────────────────────────
   16. أدوات مساعدة — Utilities
   ───────────────────────────────────────── */

/**
 * تأخير غير متزامن
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * يُؤمّن النص ضد XSS قبل الإدراج في HTML
 * @param {string} str
 * @returns {string}
 */
function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * إلغاء تأخير تنفيذ الدالة (Debounce)
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ─────────────────────────────────────────
   17. التحقق المباشر أثناء الكتابة
   ───────────────────────────────────────── */

/**
 * يتحقق من صحة الرابط أثناء الكتابة ويُعطي تغذية راجعة فورية
 */
const liveValidate = debounce(() => {
  const url = DOM.urlInput()?.value.trim();
  const input = DOM.urlInput();
  if (!input) return;

  if (!url) {
    input.style.borderColor = '';
    clearError();
    return;
  }

  if (isValidYouTubeUrl(url)) {
    input.style.borderColor = '#3dbb85'; // أخضر
    clearError();
  } else if (url.length > 15) {
    input.style.borderColor = 'var(--accent)'; // أحمر تحذيري
  }
}, 400);

/* ─────────────────────────────────────────
   18. أنماط CSS المُضافة ديناميكياً
   ───────────────────────────────────────── */

/**
 * يُضيف CSS إضافي لعناصر يتم إنشاؤها ديناميكياً
 */
function injectDynamicStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ── معلومات الفيديو ── */
    .video-meta {
      display: flex;
      gap: 16px;
      margin-bottom: 20px;
      padding: 16px;
      background: var(--surface2);
      border-radius: var(--radius);
      border: 1px solid var(--border-soft);
      align-items: flex-start;
    }
    .video-thumbnail {
      position: relative;
      flex-shrink: 0;
      width: 120px;
    }
    .video-thumbnail img {
      width: 120px;
      height: 68px;
      object-fit: cover;
      border-radius: 8px;
      display: block;
      background: var(--surface3);
    }
    .duration-badge {
      position: absolute;
      bottom: 4px;
      left: 4px;
      background: rgba(0,0,0,0.78);
      color: #fff;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      direction: ltr;
      font-family: monospace;
    }
    .video-info { flex: 1; min-width: 0; }
    .video-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1.4;
      margin-bottom: 6px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .video-channel {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .channel-icon { font-size: 0.9em; }
    .video-topics {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .topic-tag {
      background: var(--accent-pale);
      color: var(--accent);
      border: 1px solid rgba(232,66,58,0.18);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 0.7rem;
      font-weight: 700;
    }

    /* ── النص الملخص ── */
    .summary-text {
      color: var(--text-soft);
      line-height: 2;
      margin-bottom: 4px;
    }

    /* ── إجراءات التبديل ── */
    .result-actions {
      display: flex;
      gap: 8px;
      margin-top: 22px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .btn-action {
      flex: 1;
      min-width: 80px;
      background: var(--surface2);
      border: 1.5px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 9px 12px;
      font-family: 'Cairo', sans-serif;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 150ms ease;
      text-align: center;
    }
    .btn-action:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-pale);
      transform: translateY(-1px);
    }
    .btn-action:active { transform: scale(0.95); }

    /* ── دوّار التحميل ── */
    .btn-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      vertical-align: middle;
      margin-left: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── اهتزاز حقل الإدخال ── */
    @keyframes inputShake {
      0%, 100% { transform: translateX(0); }
      20%       { transform: translateX(-7px); }
      40%       { transform: translateX(6px); }
      60%       { transform: translateX(-4px); }
      80%       { transform: translateX(3px); }
    }
    .url-input.shake {
      animation: inputShake 0.4s ease both;
    }

    /* ── متجاوب ── */
    @media (max-width: 480px) {
      .video-meta { flex-direction: column; }
      .video-thumbnail { width: 100%; }
      .video-thumbnail img { width: 100%; height: 160px; }
      .result-actions { gap: 6px; }
      .btn-action { font-size: 0.76rem; padding: 8px; }
    }
  `;
  document.head.appendChild(style);
}

/* ─────────────────────────────────────────
   19. مستمعو الأحداث — Event Listeners
   ───────────────────────────────────────── */

function initEventListeners() {
  // زر التلخيص
  DOM.summarizeBtn()?.addEventListener('click', summarize);

  // إدخال الرابط: Enter للتلخيص
  DOM.urlInput()?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') summarize();
  });

  // تحقق مباشر أثناء الكتابة
  DOM.urlInput()?.addEventListener('input', liveValidate);

  // مسح الخطأ عند بدء الكتابة
  DOM.urlInput()?.addEventListener('focus', clearError);

  // تبديل المظهر
  DOM.themeBtn()?.addEventListener('click', toggleTheme);

  // الشرائح (chips)
  DOM.chips()?.forEach(chip => {
    chip.addEventListener('click', () => selectMode(chip));
  });

  // زر النسخ
  DOM.copyBtn()?.addEventListener('click', copyResult);

  // دعم لصق الرابط مباشرة
  DOM.urlInput()?.addEventListener('paste', () => {
    setTimeout(liveValidate, 50);
  });
}

/* ─────────────────────────────────────────
   20. تهيئة التطبيق — init()
   ───────────────────────────────────────── */

/**
 * نقطة دخول التطبيق: تُستدعى عند تحميل الصفحة
 */
function init() {
  injectDynamicStyles();
  loadSavedTheme();
  loadHistory();
  initEventListeners();
  updateChipsUI(AppState.currentMode);

  // تعيين نسمات ARIA
  DOM.chips()?.forEach(chip => {
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-pressed', chip.classList.contains('active') ? 'true' : 'false');
  });

  console.info('[Summarizer] ✅ التطبيق جاهز');
}

/* ─────────────────────────────────────────
   21. التشغيل عند اكتمال DOM
   ───────────────────────────────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init(); // DOM جاهز بالفعل
}

/* ─────────────────────────────────────────
   22. تصدير للاستخدام الخارجي (اختياري)
   ───────────────────────────────────────── */
window.YTSummarizer = {
  summarize,
  changeMode,
  copyResult,
  toggleTheme,
  extractVideoId,
  isValidYouTubeUrl,
};
