/* ═══════════════════════════════════════════════════════════════
   app.js — صفحة قسم مركز المعرفة
   مصدر البيانات الوحيد: /articles/_index.json (يولّده build-content.js).
   كل الفلترة والبحث والترقيم على العميل — طلب شبكة واحد للصفحة كلها.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var INDEX_URL = '/articles/_index.json';

  var state = {
    all: [],
    settings: { perPage: 9, featuredMode: 'hero', featuredCount: 3, showAuthor: true, showReadingTime: true },
    categories: [],
    category: '',
    tag: '',
    q: '',
    page: 1,
  };

  var el = {
    grid:       document.getElementById('kc-grid'),
    chips:      document.getElementById('kc-chips'),
    featured:   document.getElementById('kc-featured'),
    pagination: document.getElementById('kc-pagination'),
    count:      document.getElementById('kc-count'),
    listTitle:  document.getElementById('kc-list-title'),
    search:     document.getElementById('kc-search'),
    heroTitle:  document.getElementById('kc-hero-title'),
    heroDesc:   document.getElementById('kc-hero-desc'),
  };

  /* ── أدوات ── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* نسخة أصغر من صورة R2 — نفس عُرف المنصة */
  function cardImg(url) {
    return (url && url.indexOf('_f.webp') !== -1) ? url.replace('_f.webp', '_c.webp') : url;
  }
  function detailImg(url) {
    return (url && url.indexOf('_f.webp') !== -1) ? url.replace('_f.webp', '_d.webp') : url;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try { return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return iso.slice(0, 10); }
  }

  /* تصريف عربي صحيح — بدونه "1 دقائق قراءة" يظهر لكل مقال قصير.
     نسخة مطابقة لدالة arMinutes في build-content.js (لا وحدة مشتركة
     في هذا الكود الخالي من أي أداة بناء). */
  function arMinutes(n) {
    n = Math.max(1, Math.round(n));
    if (n === 1) return 'دقيقة واحدة';
    if (n === 2) return 'دقيقتان';
    if (n >= 3 && n <= 10) return n + ' دقائق';
    return n + ' دقيقة';
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ── قراءة/كتابة حالة الرابط ── */
  function readUrl() {
    var p = new URLSearchParams(location.search);
    state.category = p.get('category') || '';
    state.tag      = p.get('tag') || '';
    state.q        = p.get('q') || '';
    state.page     = Math.max(1, parseInt(p.get('page'), 10) || 1);
    if (el.search && state.q) el.search.value = state.q;
  }

  var historyInitialized = false;

  function writeUrl() {
    var p = new URLSearchParams();
    if (state.category) p.set('category', state.category);
    if (state.tag)      p.set('tag', state.tag);
    if (state.q)        p.set('q', state.q);
    if (state.page > 1) p.set('page', String(state.page));
    var qs = p.toString();
    var url = location.pathname + (qs ? '?' + qs : '');

    if (!historyInitialized) {
      /* أول عرض بعد التحميل — استبدال لا إضافة، حتى لا يخلق زر
         الرجوع إدخالًا مكرَّرًا لنفس الصفحة فور الوصول إليها */
      history.replaceState(null, '', url);
      historyInitialized = true;
    } else if (url !== location.pathname + location.search) {
      /* إدخال حقيقي فقط لو تغيّر الرابط فعليًا — صفحة/تصنيف/بحث
         جديد. هذا ما يجعل زر الرجوع يعمل مع الترقيم بدل مغادرة
         القسم كليًا كما كان يحدث مع replaceState وحدها. */
      history.pushState(null, '', url);
    }
  }

  /* ── الفلترة ── */
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return state.all.filter(function (a) {
      if (state.category && a.category !== state.category) return false;
      if (state.tag && (a.tags || []).indexOf(state.tag) === -1) return false;
      if (!q) return true;
      var hay = [a.title, a.description, a.category, (a.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  /* ── العرض ── */
  function cardHtml(a) {
    var img = a.cover
      ? '<img class="kc-card-img" src="' + esc(cardImg(a.cover)) + '" alt="' + esc(a.coverAlt || a.title) + '" loading="lazy" decoding="async">'
      : '<div class="kc-card-noimg"></div>';

    var meta = [];
    if (a.publishedAt) meta.push('<span>' + esc(fmtDate(a.publishedAt)) + '</span>');
    if (state.settings.showReadingTime) meta.push('<span>⏱ ' + esc(arMinutes(a.readingMinutes)) + ' قراءة</span>');

    return '<a class="kc-card" href="/articles/' + encodeURIComponent(a.slug) + '/">' +
      img +
      '<div class="kc-card-body">' +
        (a.category ? '<span class="kc-card-cat">' + esc(a.category) + '</span>' : '') +
        '<h3>' + esc(a.title) + '</h3>' +
        (a.description ? '<p class="kc-card-desc">' + esc(a.description) + '</p>' : '') +
        '<div class="kc-card-meta">' + meta.join('') + '</div>' +
      '</div>' +
    '</a>';
  }

  function featuredHtml(a) {
    var img = a.cover
      ? '<img class="kc-feat-img" src="' + esc(detailImg(a.cover)) + '" alt="' + esc(a.coverAlt || a.title) + '" loading="lazy" decoding="async">'
      : '<div class="kc-feat-noimg"></div>';

    var meta = [];
    if (a.publishedAt) meta.push('<span>' + esc(fmtDate(a.publishedAt)) + '</span>');
    if (state.settings.showReadingTime) meta.push('<span>⏱ ' + esc(arMinutes(a.readingMinutes)) + ' قراءة</span>');

    return '<a class="kc-feat" href="/articles/' + encodeURIComponent(a.slug) + '/">' +
      img +
      '<div class="kc-feat-body">' +
        '<span class="kc-feat-badge">⭐ مقال مميّز</span>' +
        '<h3>' + esc(a.title) + '</h3>' +
        (a.description ? '<p>' + esc(a.description) + '</p>' : '') +
        '<div class="kc-card-meta">' + meta.join('') + '</div>' +
      '</div>' +
    '</a>';
  }

  function renderChips() {
    if (!el.chips) return;
    var html = '<button type="button" class="kc-chip' + (!state.category && !state.tag ? ' active' : '') +
      '" data-cat="">الكل</button>';
    state.categories.forEach(function (c) {
      html += '<button type="button" class="kc-chip' + (state.category === c ? ' active' : '') +
        '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    });
    el.chips.innerHTML = html;
  }

  function renderPagination(total, pages) {
    if (!el.pagination) return;
    if (pages <= 1) { el.pagination.innerHTML = ''; return; }

    var html = '<button type="button" class="kc-page-btn" data-page="' + (state.page - 1) + '"' +
      (state.page === 1 ? ' disabled' : '') + '>السابق</button>';

    /* نافذة صفحات مضغوطة حول الصفحة الحالية */
    var from = Math.max(1, state.page - 2);
    var to   = Math.min(pages, from + 4);
    from = Math.max(1, to - 4);

    if (from > 1) html += '<button type="button" class="kc-page-btn" data-page="1">1</button>' +
      (from > 2 ? '<span class="kc-count">…</span>' : '');

    for (var i = from; i <= to; i++) {
      html += '<button type="button" class="kc-page-btn' + (i === state.page ? ' active' : '') +
        '" data-page="' + i + '">' + i + '</button>';
    }

    if (to < pages) html += (to < pages - 1 ? '<span class="kc-count">…</span>' : '') +
      '<button type="button" class="kc-page-btn" data-page="' + pages + '">' + pages + '</button>';

    html += '<button type="button" class="kc-page-btn" data-page="' + (state.page + 1) + '"' +
      (state.page === pages ? ' disabled' : '') + '>التالي</button>';

    el.pagination.innerHTML = html;
  }

  function render(skipHistoryWrite) {
    var list     = filtered();
    var perPage  = Math.max(1, state.settings.perPage || 9);
    var isBrowse = !state.category && !state.tag && !state.q;

    /* المميّزة تظهر فقط في العرض غير المفلتر، ولا تتكرّر في الشبكة */
    var feat = [];
    if (isBrowse && state.settings.featuredMode !== 'off') {
      feat = list.filter(function (a) { return a.featured; })
                 .slice(0, Math.max(1, state.settings.featuredCount || 1));
      if (state.settings.featuredMode === 'hero') feat = feat.slice(0, 1);
    }
    var featSlugs = feat.map(function (a) { return a.slug; });
    var rest = list.filter(function (a) { return featSlugs.indexOf(a.slug) === -1; });

    if (el.featured) el.featured.innerHTML = feat.map(featuredHtml).join('');

    var pages = Math.max(1, Math.ceil(rest.length / perPage));
    if (state.page > pages) state.page = pages;
    var slice = rest.slice((state.page - 1) * perPage, state.page * perPage);

    if (el.listTitle) {
      el.listTitle.textContent = state.tag      ? 'وسم: ' + state.tag
                              : state.category  ? state.category
                              : state.q         ? 'نتائج البحث'
                              : 'أحدث المقالات';
    }

    if (el.count) {
      el.count.textContent = list.length ? list.length + ' مقال' : '';
    }

    if (!slice.length) {
      el.grid.innerHTML = feat.length ? '' :
        '<div class="kc-empty" style="grid-column:1/-1">' +
          '<div class="kc-empty-title">لا توجد مقالات مطابقة</div>' +
          '<div>جرّب كلمة بحث أخرى أو اختر تصنيفًا مختلفًا.</div>' +
        '</div>';
    } else {
      el.grid.innerHTML = slice.map(cardHtml).join('');
    }

    renderChips();
    renderPagination(rest.length, pages);
    /* عند استدعاء render() ردًّا على popstate (التنقّل عبر زر
       الرجوع/التقدّم) لا نكتب الرابط ثانيةً — المتصفح غيّره بالفعل،
       وإعادة الكتابة هنا كانت ستُنشئ إدخال history جديدًا فتُعطّل
       التنقّل ذهابًا وإيابًا. */
    if (!skipHistoryWrite) writeUrl();
  }

  /* ── الأحداث ── */
  function wire() {
    if (el.chips) {
      el.chips.addEventListener('click', function (e) {
        var btn = e.target.closest('.kc-chip');
        if (!btn) return;
        state.category = btn.getAttribute('data-cat') || '';
        state.tag = '';
        state.page = 1;
        render();
      });
    }

    if (el.pagination) {
      el.pagination.addEventListener('click', function (e) {
        var btn = e.target.closest('.kc-page-btn');
        if (!btn || btn.disabled) return;
        var p = parseInt(btn.getAttribute('data-page'), 10);
        if (!p) return;
        state.page = p;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    if (el.search) {
      el.search.addEventListener('input', debounce(function () {
        state.q = el.search.value || '';
        state.page = 1;
        render();
      }, 220));
    }

    /* زر الرجوع/التقدّم: أعد القراءة من الرابط الحالي (غيّره المتصفح
       بالفعل) وأعد الرسم بلا كتابة history من جديد */
    window.addEventListener('popstate', function () {
      readUrl();
      render(true);
    });
  }

  /* ── الإقلاع ── */
  function boot() {
    readUrl();
    wire();

    fetch(INDEX_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.all        = Array.isArray(data.articles) ? data.articles : [];
        state.categories = Array.isArray(data.categories) ? data.categories : [];
        if (data.settings) {
          Object.keys(data.settings).forEach(function (k) { state.settings[k] = data.settings[k]; });
        }
        if (el.heroTitle && state.settings.sectionTitle) el.heroTitle.textContent = state.settings.sectionTitle;
        if (el.heroDesc && state.settings.sectionDescription) el.heroDesc.textContent = state.settings.sectionDescription;
        render();
      })
      .catch(function (err) {
        /* التمييز بين 404 وبقية الأخطاء مقصود: 404 على هذا المسار له
           سبب واحد عمليًا — أن build-content.js لم يعمل على الخادم
           (الملف مولَّد ومستبعَد من git). رسالة عامة هنا كانت تُخفي
           السبب وتُظهرها كعُطل شبكة عابر. */
        var isMissing = /HTTP 404/.test(String(err && err.message));
        console.error('تعذّر تحميل فهرس المقالات:', err);
        if (isMissing) {
          console.error(
            'articles/_index.json غير موجود على الخادم. هذا الملف يولّده build-content.js ' +
            'وهو مستبعَد من git عمدًا. تأكّد أن Build command في Cloudflare Pages = "node build-content.js" ' +
            'وأن Build output directory = "/".'
          );
        }
        el.grid.innerHTML =
          '<div class="kc-empty" style="grid-column:1/-1">' +
            '<div class="kc-empty-title">' +
              (isMissing ? 'لم يُبنَ فهرس المقالات بعد' : 'تعذّر تحميل المقالات') +
            '</div>' +
            '<div>' +
              (isMissing
                ? 'المحتوى موجود لكن خطوة البناء لم تُنفَّذ على الخادم. التفاصيل في console.'
                : 'حدّث الصفحة أو حاول بعد قليل.') +
            '</div>' +
          '</div>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
