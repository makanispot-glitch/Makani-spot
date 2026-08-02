#!/usr/bin/env node
/**
 * build-content.js — مركز المعرفة | Build Step
 * ──────────────────────────────────────────────────────────────
 * يحوّل content/articles/*.md إلى صفحات HTML ثابتة وقت البناء.
 *
 * التشغيل:  node build-content.js
 * في Cloudflare Pages:  Build command = node build-content.js
 *                       Build output directory = /
 *
 * صفر تبعيات npm — marked مُنزَّل محليًا في vendor/marked/.
 * (package.json مستبعد في .gitignore عمدًا، فلا نضيفه.)
 *
 * المخرجات:
 *   articles/{slug}/index.html
 *   articles/_index.json
 *   sitemap.xml
 *
 * قاعدة ذهبية: لا يُسقط البناء أبدًا بسبب مقال معطوب.
 * كل مقال داخل try/catch، والخروج دائمًا بـ 0 إلا في كارثة.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const SRC_DIR  = path.join(ROOT, 'content', 'articles');
const OUT_DIR  = path.join(ROOT, 'articles');
const SITE     = 'https://makanispot.com';
const BRAND    = 'مكاني Spot';
const NOW      = new Date();

/* الصفحات العامة الثابتة — تدخل sitemap.xml */
const STATIC_PAGES = [
  { loc: '/',          priority: '1.0', changefreq: 'daily'   },
  { loc: '/spaces/',   priority: '0.9', changefreq: 'daily'   },
  { loc: '/bazaars/',  priority: '0.9', changefreq: 'daily'   },
  { loc: '/market/',   priority: '0.8', changefreq: 'daily'   },
  { loc: '/catalog/',  priority: '0.6', changefreq: 'weekly'  },
  { loc: '/articles/', priority: '0.8', changefreq: 'daily'   },
  { loc: '/post-ad/',  priority: '0.5', changefreq: 'monthly' },
  { loc: '/policies/', priority: '0.3', changefreq: 'yearly'  },
];

const log  = (...a) => console.log('  ', ...a);
const warn = (...a) => console.warn('  ⚠️ ', ...a);

/* ══════════════════════════════════════════════════════════════
   1) الإصدار — لختم ?v= على CSS/JS تمامًا مثل bump-version.ps1
   (السكربت هو من يختم الصفحات المولّدة لأنها غير مُتتبَّعة في git)
   ══════════════════════════════════════════════════════════════ */
function readVersion() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'version.js'), 'utf8');
    const m   = raw.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  } catch { /* تجاهل */ }
  return 'dev';
}

/* ══════════════════════════════════════════════════════════════
   1.5) إعدادات القسم — تُدمج داخل _index.json كي تكتفي صفحة القسم
   بطلب شبكة واحد بدل اثنين
   ══════════════════════════════════════════════════════════════ */
const DEFAULT_SETTINGS = {
  sectionTitle: 'مركز المعرفة',
  sectionDescription: '',
  perPage: 9,
  featuredMode: 'hero',
  featuredCount: 3,
  relatedCount: 3,
  showAuthor: true,
  showReadingTime: true,
  showUpdatedDate: true,
};

function readSettings() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'content', 'settings.json'), 'utf8');
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {
    if (e.code !== 'ENOENT') warn(`content/settings.json غير صالح — استخدام الافتراضي (${e.message})`);
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

/* ══════════════════════════════════════════════════════════════
   2) محلّل Front Matter — صغير ومقصود، لا نحتاج YAML كاملًا
   يدعم:  key: value  |  key:  |  key: [a, b]  |  "قيمة مقتبسة"
   ══════════════════════════════════════════════════════════════ */
function parseFrontMatter(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) {
    return { data: {}, body: text };
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text };

  const head = text.slice(3, end).replace(/^\n/, '');
  const body = text.slice(end + 4).replace(/^\n/, '');
  const data = {};

  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const key = line.slice(0, colon).trim();
    if (!key) continue;

    /* القيمة = ما بعد أول ":" فقط — يحفظ الروابط https://... سليمة. */
    let val = line.slice(colon + 1).trim();

    if (val === '') { data[key] = ''; continue; }

    /* نص مقتبس — يُقرأ قبل قصّ التعليقات.
       الترتيب حرج: لو قصصنا " # ..." أولًا لفقد عنوانٌ مقتبس مثل
       «دليل # الجزء الأول» نصفه بصمت. */
    if (val.startsWith('"')) {
      const end = val.lastIndexOf('"');
      if (end > 0) {
        try { data[key] = JSON.parse(val.slice(0, end + 1)); continue; } catch { /* اسقط للتحليل العادي */ }
      }
    }
    if (val.startsWith("'")) {
      const end = val.lastIndexOf("'");
      if (end > 0) { data[key] = val.slice(1, end); continue; }
    }

    /* غير مقتبس: اقصّ التعليق المتأخر (  # ...) */
    val = val.replace(/\s+#\s.*$/, '').trim();
    if (val === '') { data[key] = ''; continue; }

    /* مصفوفة: [a, b, c] */
    if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = val.slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      continue;
    }

    if (val === 'true')  { data[key] = true;  continue; }
    if (val === 'false') { data[key] = false; continue; }

    data[key] = val;
  }

  return { data, body };
}

/* ══════════════════════════════════════════════════════════════
   3) Markdown → HTML مع منع HTML الخام كليًا
   لماذا لا DOMPurify: يحتاج DOM (jsdom) أي حزمة npm. منع HTML
   الخام من الأساس آمن إثباتًا وبصفر تبعيات — والأدمن يكتب Markdown.

   تحميل marked داخل try: لو غاب vendor/marked/ (لم يُضَف لـ git
   مثلًا) لا يُسقط ديبلوي المنصة كلها — mdToHtml يعود دالة عاجزة
   آمنة ويُبنى الموقع بلا مركز المعرفة بدل أن يفشل البناء بالكامل.
   ══════════════════════════════════════════════════════════════ */
let marked = null;
try {
  ({ marked } = require('./vendor/marked/marked.cjs'));
} catch (e) {
  console.error('❌ تعذّر تحميل vendor/marked/marked.cjs — سيُبنى الموقع بلا مركز المعرفة:', e.message);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* روابط آمنة فقط.
   //evil.com تبدأ بـ "/" فكانت تمرّ من الشرط التالي وتُعامَل كرابط
   داخلي — بلا rel="noopener nofollow" رغم كونها بروتوكولًا نسبيًا
   لمضيف خارجي مموَّه. نرفضها صراحةً بدل معالجتها كحالة خاصة. */
function safeUrl(href) {
  const h = String(href || '').trim();
  if (h.startsWith('//')) return '#';
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(h)) return h;
  return '#';
}

let mdToHtml = () => '';

if (marked) {
  const renderer = new marked.Renderer();

  /* أ) إسقاط أي HTML خام (block أو inline) — يُعرض كنص مهروب لا كوسم */
  renderer.html = (token) => escapeHtml(typeof token === 'string' ? token : (token && token.text) || '');

  /* ب) الروابط: بروتوكول آمن + فتح الخارجي بأمان.
     حرج: نمرّر token.tokens عبر parseInline لا token.text الخام —
     token.text هو مقطع Markdown كما كُتب، لم يمرّ على أي محلّل بعد،
     فأي HTML خام داخل نص الرابط (مثال: [<img onerror=..>](x)) كان
     يتسرّب دون تهريب لأن renderer.html لا يرى نص الرابط إطلاقًا.
     يجب أن تكون function عادية لا arrow — marked يضبط
     renderer.parser = this عند إنشاء الـ Parser (marked.cjs)، وarrow
     function لا تربط this بالـ renderer فيفشل this.parser. */
  renderer.link = function (token) {
    const href  = safeUrl(token.href);
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
    const ext   = /^https?:\/\//i.test(href) && !href.startsWith(SITE);
    const attrs = ext ? ' target="_blank" rel="noopener nofollow"' : '';
    const body  = this.parser.parseInline(token.tokens);
    return `<a href="${escapeHtml(href)}"${title}${attrs}>${body}</a>`;
  };

  /* ج) الصور: lazy + async decoding (مكسب Core Web Vitals).
     alt لا يقبل وسومًا في HTML أصلًا، فـ escapeHtml(token.text) هنا
     صحيح ولا يحتاج parseInline — القيمة نص خالص داخل سمة سليمة. */
  renderer.image = (token) => {
    const src   = safeUrl(token.href);
    const alt   = escapeHtml(token.text || '');
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
    return `<img src="${escapeHtml(src)}" alt="${alt}"${title} loading="lazy" decoding="async">`;
  };

  marked.setOptions({ renderer, gfm: true, breaks: false });

  /* د) شبكة أمان أخيرة — تجريد الوسوم الخطرة فقط لو وُلدت رغم ما
     سبق (مثال: ترقية مستقبلية لـ marked تغيّر سلوك التوكينز).
     لا تحذف نصًا مشروعًا بعد الآن: القاعدتان المحذوفتان (معالج
     الأحداث العام + "javascript:") كانتا تقتطعان كتل كود تحوي سمات
     HTML وتحذفان كلمة "JavaScript:" من النثر — دفاع زائد صار عديم
     الفائدة أمنيًا بعد إصلاح renderer.link (كل HTML خام يمرّ عليه
     الآن)، وكان يُفسد محتوى حقيقيًا (راجع تقرير المراجعة).
     verified: مُختبَر بمتصفح حقيقي (DOM) على 8 حالات هجوم + 8 حالات
     محتوى مشروع، صفر عناصر/معالِجات حيّة، صفر محتوى مشروع مفقود. */
  function scrubHtml(html) {
    return String(html)
      .replace(/<\s*(script|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi, '')
      .replace(/<\s*\/\s*(script|iframe|object|embed|form)\s*>/gi, '');
  }

  mdToHtml = (md) => scrubHtml(marked.parse(md || ''));
}

/* ══════════════════════════════════════════════════════════════
   4) أدوات مساعدة
   ══════════════════════════════════════════════════════════════ */
function countWords(md) {
  const plain = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]/g, ' ');
  const words = plain.split(/\s+/).filter(Boolean);
  return words.length;
}

/* ١٨٠ كلمة/دقيقة — أنسب للعربية من ٢٠٠ الإنجليزية */
const readingMinutes = (words) => Math.max(1, Math.round(words / 180));

/* تصريف عربي صحيح — بدونه "1 دقائق قراءة" يُشحَن فعليًا لكل مقال
   قصير. نفس الدالة مكرَّرة بقصد في articles/app.js (لا وحدة مشتركة
   في هذا الكود الخالي من أي أداة بناء). */
function arMinutes(n) {
  n = Math.max(1, Math.round(n));
  if (n === 1) return 'دقيقة واحدة';
  if (n === 2) return 'دقيقتان';
  if (n >= 3 && n <= 10) return `${n} دقائق`;
  return `${n} دقيقة`;
}

function fmtDateAr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* تاريخ صارم: يشترط بادئة YYYY-MM-DD قبل تمريره لـ Date. بدونه
   new Date(true) ينجح ويعطي ١٩٧٠، وnew Date('01/08/2026') يُفسَّر
   أمريكيًا (٨ يناير) لا مصريًا — كلاهما ينشر بتاريخ خاطئ بصمت. */
const isoOrNull = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
};

/* نسخة أصغر من صورة R2 — نفس عُرف المنصة: _f ↔ _d ↔ _c */
const variant = (url, v) =>
  (url && url.includes('_f.webp')) ? url.replace('_f.webp', `_${v}.webp`) : url;

/* ══════════════════════════════════════════════════════════════
   5) كتل القالب المشتركة
   ══════════════════════════════════════════════════════════════ */
function navHtml() {
  /* ناف ثابت: كل الروابط href حقيقية — لا showPage() (دالة SPA
     موجودة في index.html فقط وستكون undefined هنا) */
  return `
<nav class="kc-nav">
  <a class="kc-logo" href="/">
    <span class="kc-logo-ar">مكاني</span><span class="kc-logo-en">Spot</span>
  </a>
  <div class="kc-nav-links">
    <a href="/">الرئيسية</a>
    <a href="/spaces/">المساحات</a>
    <a href="/bazaars/">البازارات</a>
    <a href="/market/">مشاريع للبيع</a>
    <a href="/articles/" class="active">مركز المعرفة</a>
  </div>
  <a class="kc-nav-cta" href="/spaces/">ابحث عن مساحة</a>
</nav>`;
}

function footerHtml() {
  /* منسوخ من index.html:3017 مع فارق واحد: رابط الباقات كان
     onclick="showPage('pricing')" وهو غير متاح خارج الصفحة الرئيسية */
  return `
<footer class="site-footer">
  <div class="sf-inner">
    <div class="sf-col sf-col--brand">
      <div class="sf-logo">
        <span class="sf-logo-ar">مكاني</span>
        <span class="sf-logo-sep" aria-hidden="true"></span>
        <span class="sf-logo-en">Spot</span>
      </div>
      <p class="sf-about">مكاني Spot هي المنصة الرقمية الأولى للاستغلال الأمثل للمساحات التجارية الصغيرة وغير المستغلة في مصر، وتسهيل تأجيرها لأصحاب المشاريع وصغار التجار.</p>
      <div class="sf-paths">
        <span class="sf-path">مساحات تجارية</span>
        <span class="sf-path">بازارات ومعارض</span>
        <span class="sf-path">مشاريع للبيع</span>
      </div>
    </div>
    <div class="sf-col sf-col--links">
      <h4 class="sf-col-title">تصفح المنصة</h4>
      <a class="sf-link" href="/">الرئيسية</a>
      <a class="sf-link" href="/spaces/">المساحات التجارية</a>
      <a class="sf-link" href="/bazaars/">البازارات والمعارض</a>
      <a class="sf-link" href="/market/">مشاريع كاملة للبيع</a>
      <a class="sf-link" href="/catalog/">كتالوج الأنشطة</a>
      <a class="sf-link" href="/post-ad/">نشر إعلانك</a>
      <a class="sf-link" href="/articles/">مركز المعرفة</a>
      <a class="sf-link" href="/?p=pricing">باقات أصحاب المساحات</a>
    </div>
    <div class="sf-col sf-col--contact">
      <h4 class="sf-col-title">تواصل معنا</h4>
      <a class="sf-social-btn sf-wa" href="https://wa.me/201103467711" target="_blank" rel="noopener">
        <span dir="ltr">011 0346 7711</span>
      </a>
      <a class="sf-social-btn sf-fb" href="https://www.facebook.com/profile.php?id=100069918048151" target="_blank" rel="noopener">Makani Spot</a>
      <div class="sf-col-divider"></div>
      <a class="sf-policies-link" href="/policies/">السياسات والشروط القانونية</a>
    </div>
  </div>
  <div class="sf-bottom">
    <div class="sf-bottom-inner">
      <span class="sf-legal">شركة كيوسك سبوت هب &nbsp;·&nbsp; KIOSQ SpotHub</span>
      <span class="sf-copy">© ٢٠٢٦ مكاني Spot · جميع الحقوق محفوظة</span>
    </div>
  </div>
</footer>`;
}

const CTA_PRESETS = {
  spaces: {
    title: 'هل تبحث عن مكان مناسب لبدء مشروعك؟',
    body:  'تصفّح المساحات التجارية المتاحة على مكاني Spot واعثر على المكان المناسب لنشاطك.',
    btn:   'ابدأ البحث عن مساحة',
    href:  '/spaces/',
  },
  bazaars: {
    title: 'هل تبحث عن بازار للمشاركة فيه؟',
    body:  'تصفّح البازارات والمعارض القادمة واحجز مكانك قبل نفاد الأماكن.',
    btn:   'تصفّح البازارات',
    href:  '/bazaars/',
  },
};

function ctaHtml(kind) {
  const c = CTA_PRESETS[kind];
  if (!c) return '';
  return `
<aside class="kc-cta">
  <h2 class="kc-cta-title">${escapeHtml(c.title)}</h2>
  <p class="kc-cta-body">${escapeHtml(c.body)}</p>
  <a class="kc-cta-btn" href="${c.href}">${escapeHtml(c.btn)}</a>
</aside>`;
}

function relatedHtml(list) {
  if (!list.length) return '';
  const cards = list.map(a => `
    <a class="kc-rel-card" href="/articles/${encodeURIComponent(a.slug)}/">
      ${a.cover ? `<img src="${escapeHtml(variant(a.cover, 'c'))}" alt="${escapeHtml(a.coverAlt || a.title)}" loading="lazy" decoding="async">` : '<div class="kc-rel-noimg"></div>'}
      <div class="kc-rel-body">
        ${a.category ? `<span class="kc-rel-cat">${escapeHtml(a.category)}</span>` : ''}
        <h3>${escapeHtml(a.title)}</h3>
        <span class="kc-rel-meta">⏱ ${arMinutes(a.readingMinutes)} قراءة</span>
      </div>
    </a>`).join('');
  return `
<section class="kc-related">
  <h2 class="kc-related-title">مقالات ذات صلة</h2>
  <div class="kc-related-grid">${cards}</div>
</section>`;
}

/* ══════════════════════════════════════════════════════════════
   6) قالب صفحة المقال — HTML كامل، بلا أي <script> inline
   (نمنع inline عمدًا؛ ولا نضع سنيبت منع وميض اللغة لأن الصفحة
    تصدر lang/dir مباشرة، ونسخه سيقلب مقالًا عربيًا إلى LTR لمن
    لغته المحفوظة en)
   ══════════════════════════════════════════════════════════════ */
function renderArticle(a, related, ver) {
  const url       = `${SITE}/articles/${encodeURIComponent(a.slug)}/`;
  const title     = a.seoTitle || a.title;
  const desc      = a.seoDescription || a.description || '';
  const canonical = a.canonical || url;
  const ogImg     = a.ogImage || a.cover || `${SITE}/favicon.jpg`;
  /* الأبعاد 1200×630 صحيحة فقط لصورة OG المخصَّصة (تُقصّ بهذا المقاس
     تحديدًا وقت الرفع). الاحتياطيان — الغلاف 4:3 أو favicon — نسبتهما
     مختلفة، فالتصريح بأبعاد خاطئة يجعل فيسبوك/واتساب يقصّان الصورة
     بشكل عشوائي بدل تركها تُحسَب تلقائيًا. */
  const ogDims    = a.ogImage
    ? '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">'
    : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: desc,
    image: ogImg ? [ogImg] : undefined,
    datePublished: a.publishedAt,
    dateModified: a.updatedAt || a.publishedAt,
    author: { '@type': 'Organization', name: a.author || BRAND },
    publisher: {
      '@type': 'Organization',
      name: BRAND,
      logo: { '@type': 'ImageObject', url: `${SITE}/icons/icon-512.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    inLanguage: a.locale === 'en' ? 'en' : 'ar',
    articleSection: a.category || undefined,
    keywords: (a.tags && a.tags.length) ? a.tags.join(', ') : undefined,
    wordCount: a.wordCount,
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'الرئيسية',      item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'مركز المعرفة',  item: `${SITE}/articles/` },
      { '@type': 'ListItem', position: 3, name: a.title,          item: url },
    ],
  };

  /* JSON داخل <script type="application/ld+json"> — نحمي من كسر الوسم */
  const ld = (o) => JSON.stringify(o, (k, v) => v === undefined ? undefined : v)
    .replace(/</g, '\\u003c');

  const coverBlock = a.cover ? `
      <figure class="kc-cover">
        <img src="${escapeHtml(a.cover)}"
             srcset="${escapeHtml(variant(a.cover, 'c'))} 384w, ${escapeHtml(variant(a.cover, 'd'))} 880w, ${escapeHtml(a.cover)} 1280w"
             sizes="(max-width: 780px) 100vw, 780px"
             alt="${escapeHtml(a.coverAlt || a.title)}" width="1280" height="960" decoding="async">
        ${a.coverAlt ? `<figcaption>${escapeHtml(a.coverAlt)}</figcaption>` : ''}
      </figure>` : '';

  const tagsBlock = (a.tags && a.tags.length) ? `
      <div class="kc-tags">
        ${a.tags.map(t => `<a class="kc-tag" href="/articles/?tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join('')}
      </div>` : '';

  const updatedBlock = (a.showUpdatedDate !== false && a.updatedAt && a.updatedAt !== a.publishedAt)
    ? `<span class="kc-meta-item">آخر تحديث: ${escapeHtml(fmtDateAr(a.updatedAt))}</span>` : '';

  return `<!DOCTYPE html>
<html lang="${a.locale === 'en' ? 'en' : 'ar'}" dir="${a.locale === 'en' ? 'ltr' : 'rtl'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escapeHtml(title)} — ${BRAND}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="theme-color" content="#F36418">
<link rel="icon" type="image/jpeg" href="/favicon.jpg">

<meta property="og:type" content="article">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(ogImg)}">
${ogDims}
<meta property="og:locale" content="${a.locale === 'en' ? 'en_US' : 'ar_EG'}">
<meta property="article:published_time" content="${escapeHtml(a.publishedAt || '')}">
<meta property="article:modified_time" content="${escapeHtml(a.updatedAt || a.publishedAt || '')}">
${a.category ? `<meta property="article:section" content="${escapeHtml(a.category)}">` : ''}
${(a.tags || []).map(t => `<meta property="article:tag" content="${escapeHtml(t)}">`).join('\n')}

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(ogImg)}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/articles/article.css?v=${ver}">

<script type="application/ld+json">${ld(jsonLd)}</script>
<script type="application/ld+json">${ld(breadcrumb)}</script>
</head>
<body>
${navHtml()}

<main class="kc-main">
  <article class="kc-article">

    <nav class="kc-crumb" aria-label="مسار التنقل">
      <a href="/">الرئيسية</a><span>/</span>
      <a href="/articles/">مركز المعرفة</a><span>/</span>
      <span class="kc-crumb-current">${escapeHtml(a.title)}</span>
    </nav>

    ${a.category ? `<a class="kc-cat" href="/articles/?category=${encodeURIComponent(a.category)}">${escapeHtml(a.category)}</a>` : ''}

    <h1 class="kc-title">${escapeHtml(a.title)}</h1>
    ${desc ? `<p class="kc-lede">${escapeHtml(desc)}</p>` : ''}

    <div class="kc-meta">
      <span class="kc-meta-author">${escapeHtml(a.author || BRAND)}</span>
      <span class="kc-meta-item">${escapeHtml(fmtDateAr(a.publishedAt))}</span>
      ${updatedBlock}
      <span class="kc-meta-item">⏱ ${arMinutes(a.readingMinutes)} قراءة</span>
    </div>

    ${coverBlock}

    <div class="kc-prose" dir="${a.locale === 'en' ? 'ltr' : 'rtl'}">
${a.contentHtml}
    </div>

    ${tagsBlock}
    ${ctaHtml(a.cta)}

    <div class="kc-share">
      <span class="kc-share-label">شارك المقال</span>
      <button type="button" class="kc-share-btn" data-share-url="${escapeHtml(url)}" data-share-title="${escapeHtml(a.title)}">
        نسخ الرابط
      </button>
      <a class="kc-share-btn kc-share-wa" href="https://wa.me/?text=${encodeURIComponent(a.title + ' ' + url)}" target="_blank" rel="noopener">واتساب</a>
      <a class="kc-share-btn kc-share-fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">فيسبوك</a>
    </div>

  </article>

  ${relatedHtml(related)}
</main>

${footerHtml()}
<script defer src="/articles/article.js?v=${ver}"></script>
</body>
</html>`;
}

/* ══════════════════════════════════════════════════════════════
   7) sitemap.xml
   ══════════════════════════════════════════════════════════════ */
function renderSitemap(articles) {
  const today = NOW.toISOString().slice(0, 10);
  const urls = [
    ...STATIC_PAGES.map(p => `  <url>
    <loc>${SITE}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`),
    ...articles.map(a => `  <url>
    <loc>${SITE}/articles/${encodeURIComponent(a.slug)}/</loc>
    <lastmod>${(a.updatedAt || a.publishedAt || NOW.toISOString()).slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/* ══════════════════════════════════════════════════════════════
   7.5) روابط <noscript> داخل articles/index.html (ملف متتبَّع في git)
   الهدف: صفحة القسم مُرقَّمة بأزرار JS لا روابط <a>، فبلا هذا لا مسار
   للزاحف إلى ما بعد الصفحة الأولى إلا عبر sitemap.xml. المنطقة بين
   علامتين ثابتتين تُستبدَل بالكامل كل بناء (idempotent، لا تراكم).
   لا يُسقط البناء لو غابت العلامات أو الملف — warn فقط.
   ══════════════════════════════════════════════════════════════ */
function injectNoscriptLinks(articles) {
  const indexPath = path.join(OUT_DIR, 'index.html');
  const START = '<!--KC:LINKS-->';
  const END   = '<!--/KC:LINKS-->';

  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    warn(`تعذّرت قراءة articles/index.html — تخطّي حقن روابط noscript (${e.message})`);
    return;
  }

  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s === -1 || e === -1 || e < s) {
    warn('علامتا <!--KC:LINKS--> غير موجودتين في articles/index.html — تخطّي حقن روابط noscript');
    return;
  }

  const items = articles.map(a =>
    `        <li><a href="/articles/${encodeURIComponent(a.slug)}/">${escapeHtml(a.title)}</a></li>`
  ).join('\n');

  const block = items
    ? `${START}\n    <noscript>\n      <ul class="kc-noscript-links">\n${items}\n      </ul>\n    </noscript>\n    ${END}`
    : `${START}\n    ${END}`;

  const next = html.slice(0, s) + block + html.slice(e + END.length);
  try {
    fs.writeFileSync(indexPath, next, 'utf8');
  } catch (e2) {
    warn(`تعذّرت الكتابة إلى articles/index.html — تخطّي حقن روابط noscript (${e2.message})`);
  }
}

/* ══════════════════════════════════════════════════════════════
   8) البناء
   ══════════════════════════════════════════════════════════════ */
function build() {
  const ver      = readVersion();
  const settings = readSettings();
  console.log(`\n📚 ${settings.sectionTitle} — build  (version ${ver})`);

  if (!fs.existsSync(SRC_DIR)) {
    warn(`لا يوجد ${path.relative(ROOT, SRC_DIR)} — تخطّي بناء المقالات.`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(
      { generatedAt: NOW.toISOString(), count: 0, settings, categories: [], tags: [], articles: [] }));
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap([]));
    injectNoscriptLinks([]);
    return;
  }

  /* فرز أبجدي صريح — readdirSync لا يضمن ترتيبًا ثابتًا عبر أنظمة
     الملفات المختلفة، وهذا يقرّر "الفائز" في تصادم الـ slug أعلاه
     وترتيب التعادل في published.sort() تحت */
  const files = fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.md')).sort();
  log(`وُجد ${files.length} ملف .md`);

  const published = [];
  const seenSlugs = new Set();
  let skipped = 0, failed = 0;

  /* ── المرور الأول: القراءة والتحليل ── */
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
      const { data, body } = parseFrontMatter(raw);

      const slug = String(data.slug || path.basename(file, '.md')).trim();
      if (!/^[a-z0-9][a-z0-9\-]{0,119}$/.test(slug)) {
        warn(`${file}: slug غير صالح "${slug}" — تخطّي (المسموح: أحرف لاتينية صغيرة وأرقام وشرطات)`);
        skipped++; continue;
      }
      if (!data.title) {
        warn(`${file}: بلا عنوان — تخطّي`);
        skipped++; continue;
      }

      const status = String(data.status || 'draft').trim();
      const pub    = isoOrNull(data.publishedAt);

      /* قاعدة الحياة الوحيدة: الحالة تسمح + حان موعد النشر.
         'published' و'scheduled' متطابقتان هنا عمدًا — «مجدول» تسمية
         واجهة فقط، والتاريخ وحده هو ما يقرّر. لولا ذلك لاختلفت اللوحة
         عن البناء: اللوحة تعرض «مجدول» بينما الصفحة منشورة فعلًا. */
      if (status !== 'published' && status !== 'scheduled') { skipped++; continue; }

      if (!pub) {
        warn(`${file}: ${status} بلا publishedAt صالح — تخطّي`);
        skipped++; continue;
      }
      if (new Date(pub) > NOW) { skipped++; continue; }   /* مجدول لم يحن وقته */

      /* تصادم slug: ملفان مختلفان يُنتجان نفس الرابط النهائي كانا
         يُنتجان صفحة واحدة تُكتب فوق الأخرى بصمت (ترتيب readdirSync
         غير مضمون) + مدخلَين في _index.json + رابطًا مكرَّرًا في
         sitemap.xml. نرفض الثاني صراحة بدل الكتابة فوقه بصمت. */
      if (seenSlugs.has(slug)) {
        warn(`${file}: الرابط "${slug}" مستخدَم أصلًا في ملف آخر — تخطّي`);
        skipped++; continue;
      }
      seenSlugs.add(slug);

      const words = countWords(body);

      published.push({
        slug,
        title:           String(data.title),
        locale:          data.locale === 'en' ? 'en' : 'ar',
        description:     data.description || '',
        category:        data.category || '',
        tags:            Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
        cover:           data.cover || '',
        coverAlt:        data.coverAlt || '',
        ogImage:         data.ogImage || '',
        author:          data.author || BRAND,
        publishedAt:     pub,
        updatedAt:       isoOrNull(data.updatedAt) || pub,
        featured:        data.featured === true,
        showOnHomepage:  data.showOnHomepage === true,
        showUpdatedDate: data.showUpdatedDate !== false,
        seoTitle:        data.seoTitle || '',
        seoDescription:  data.seoDescription || '',
        canonical:       data.canonical || '',
        cta:             data.cta || 'none',
        wordCount:       words,
        readingMinutes:  readingMinutes(words),
        contentHtml:     mdToHtml(body),
        sourceFile:      file,
      });
    } catch (e) {
      failed++;
      warn(`${file}: فشل التحليل — ${e.message}`);
    }
  }

  /* مفتاح ثانوي (slug) — تاريخا نشر متطابقان كانا يُعيدان ترتيبًا
     غير حتمي بين عمليات البناء (V8's sort مستقر، لكن ترتيب files
     المتغيّر أعلاه بلا .sort() كان يحرّك أيّهما "أولًا" فعليًا) */
  published.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || a.slug.localeCompare(b.slug));

  /* ── المرور الثاني: توليد الصفحات ── */
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;

  for (const a of published) {
    try {
      /* ذات صلة: نفس التصنيف أولًا، ثم وسم مشترك، ثم الأحدث */
      const others  = published.filter(x => x.slug !== a.slug);
      const sameCat = others.filter(x => a.category && x.category === a.category);
      const sameTag = others.filter(x => !sameCat.includes(x) && x.tags.some(t => a.tags.includes(t)));
      const related = [...sameCat, ...sameTag, ...others]
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .slice(0, Math.max(0, settings.relatedCount));

      const dir = path.join(OUT_DIR, a.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), renderArticle(a, related, ver), 'utf8');
      written++;
    } catch (e) {
      failed++;
      warn(`${a.slug}: فشل التوليد — ${e.message}`);
    }
  }

  /* ── الفهرس ── */
  const categories = [...new Set(published.map(a => a.category).filter(Boolean))];
  const tags       = [...new Set(published.flatMap(a => a.tags))];

  const index = {
    generatedAt: NOW.toISOString(),
    count: published.length,
    settings,
    categories,
    tags,
    /* contentHtml و sourceFile مستبعدان عمدًا — الفهرس يجب أن يبقى خفيفًا.
       status يُثبَّت على 'published': كل ما في هذا الفهرس حيّ بحكم البناء
       (المجدول الذي حان وقته صار منشورًا فعليًا). بدونه كانت لوحة الأدمن
       تعرض كل المقالات المنشورة كـ«مسودة» لأن الحقل غائب. */
    articles: published.map(({ contentHtml, sourceFile, ...rest }) =>
      Object.assign({}, rest, { status: 'published' })),
  };
  /* بلا تنسيق (null, 2) — ملف يُقرأ آليًا فقط، والتنسيق يكلّف نحو
     ٣٠٪ حجمًا زائدًا بلا أي فائدة (لا يفتحه أحد يدويًا) */
  fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(index), 'utf8');

  /* ── خريطة الموقع ── */
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap(published), 'utf8');

  /* ── روابط الزاحف داخل صفحة القسم ── */
  injectNoscriptLinks(published);

  console.log('');
  log(`✅ ${written} صفحة مقال`);
  log(`📇 articles/_index.json  (${published.length} مقال، ${categories.length} تصنيف، ${tags.length} وسم)`);
  log(`🗺️  sitemap.xml  (${STATIC_PAGES.length + published.length} رابط)`);
  if (skipped) log(`⏭️  ${skipped} متخطّى (مسودة/مخفي/مجدول لم يحن وقته)`);
  if (failed)  warn(`${failed} فشل — راجع التحذيرات أعلاه`);
  console.log('');
}

/* لا نُسقط ديبلوي المنصة كلها بسبب المحتوى مهما حدث */
try {
  build();
} catch (e) {
  console.error('❌ فشل بناء المحتوى (تم تجاهله كي لا يسقط الديبلوي):', e && e.stack || e);
}
process.exit(0);
