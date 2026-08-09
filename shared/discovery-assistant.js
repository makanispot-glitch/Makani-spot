/**
 * ════════════════════════════════════════════════════════════════════
 * 🧭 مساعد بداية المشروع — Business Starter Assistant
 * ════════════════════════════════════════════════════════════════════
 *
 * المستخدم اللي بيضغط «ساعدني» مش بيسأل «بازار ولا مساحة؟» — هو بيقول
 * «أنا مش عارف أبدأ منين». فالمساعد بيفهم **هو واقف فين** الأول، وبعدين
 * بيرشّح الخطوة، وبيقول ليه.
 *
 * ── المبدأ الحاكم ──────────────────────────────────────────────────
 * **مكاني Spot مش سمسار.** لو المستخدم مش جاهز يأجّر، بنقول له كده
 * بصراحة ونوجّهه لحاجة تانية — حتى لو ده معناه إننا ما نبيعش حاجة النهاردة.
 * الحارس العملي للمبدأ ده هو قاعدة «المساحة الثابتة محتاجة إشارات متوافقة»
 * تحت: مفيش أي مسار احتياطي بيوصّل لتوصية مساحة.
 *
 * ── نقطة التوسّع الوحيدة ───────────────────────────────────────────
 * إضافة سؤال أو توصية = **كائن واحد** في السجلّات تحت. المحرّك
 * (helpNextQuestion / recommendFromAnswers) عام وما بيتلمسش.
 * نفس فلسفة shared/onboarding-cues.js.
 *
 * ⚠️ الملف ده بيتحمّل في الصفحة الرئيسية **فقط** — /bazaars/ و/spaces/
 *    ما تحتاجوش شجرة الأسئلة.
 */

/* ════════════════════════════════════════════════════════════════
   ١) المتغيّرات
   ════════════════════════════════════════════════════════════════
   P — دليل الطلب   0 مفيش · 1 بيع متفرّق · 2 بيع منتظم وعملاء
   R — الجاهزية     0 / 1  (فيه حاجة تتباع النهاردة؟)
   C — الالتزام     0 / 1  (يقدر يلتزم بإيجار شهري دلوقتي؟)
   E — الخبرة       0 / 1 / 2   ← **سياق**، مش محور تسجيل
   G — الهدف        فرع «شغّال» فقط

   التمييز الجوهري: **P دليل على وجود طلب، مش دليل على جاهزية المشروع.**
   حد عمل ٣ علب عطور وباع واحدة لصاحبه عنده P=1 — وده مش معناه إنه جاهز
   لمساحة. علشان كده P=1 و P=2 مش نفس الشيء في السلّم. */

/** الأنشطة اللي محتاجة كهربا/مياه/تصاريح — **تحذير نصّي فقط، ما بيحرّكش التوصية**.
 *  عربية القهوة أنجح نوع عارض في البازارات؛ لو خلّينا «النشاط محتاج مكان» يدفع
 *  ناحية المساحة الثابتة هنعارض رغبة المستخدم الصريحة بتخمين — وده نفسه سلوك
 *  السمسار بشكل تاني. */
const HELP_INFRA_ACTIVITIES = Object.freeze(
  ['coffee', 'food', 'juice', 'sweets', 'popcorn', 'vending']
);


/* ════════════════════════════════════════════════════════════════
   ٢) سجلّ الأسئلة
   ════════════════════════════════════════════════════════════════
   كل خيار بيحمل `fx` = تأثيره على المتغيّرات. أي خيار بلا تأثير على
   القرار ولا على نص التوصية = خيار ميّت ولازم يتشال. */

const HELP_QUESTIONS = Object.freeze({

  /* ── Q1 البوابة — بتقسم الناس لحالات مختلفة تمامًا ────────────────
     الفكرة والمهارة **فرعان منفصلان** عن قصد: حد عنده فكرة محل عطور بلا
     خبرة في العطور ≠ حد اشتغل ٥ سنين في العطور بلا مشروع. الأول محتاج
     يختبر الفكرة ويطوّر منتجًا؛ التاني محتاج يحوّل خبرته لعرض ويختبره.
     دمجهم كان بيخلّي كارت «حوّل مهارتك لعرض» يوصل لحد ما ادّعاش مهارة. */
  have: {
    key: 'q.have',
    options: [
      { id: 'running', key: 'q.have.opts.running', icon: 'ico-shop',    fx: { branch: 'running' } },
      { id: 'product', key: 'q.have.opts.product', icon: 'ico-box',     fx: { branch: 'product' } },
      { id: 'idea',    key: 'q.have.opts.idea',    icon: 'ico-bulb',    fx: { branch: 'idea' } },
      { id: 'skill',   key: 'q.have.opts.skill',   icon: 'ico-tools',   fx: { branch: 'skill' } },
      { id: 'explore', key: 'q.have.opts.explore', icon: 'ico-compass', fx: { branch: 'explore' } },
    ],
  },

  /* ── Q2 النشاط — خياراته تُبنى وقت التشغيل من كتالوج space_activities ── */
  act: { key: 'q.act', dynamic: 'activities' },

  /* ── Q3 — بيقيس P (الفروع اللي عندها بيع) أو E (الفروع اللي لسه) ── */

  sell_how: {   // 🏪 شغّال
    key: 'q.sellHow',
    options: [
      { id: 'shop',        key: 'q.sellHow.opts.shop',       fx: { P: 2 } },
      { id: 'online_reg',  key: 'q.sellHow.opts.onlineReg',  fx: { P: 2 } },
      { id: 'home_events', key: 'q.sellHow.opts.homeEvents', fx: { P: 1 } },
      /* «طلبات قليلة» مش خيار ميّت — هو حارس السمسرة. P=1 بيمنع توصية
         المساحة ويوجّه للبازار: مشروع بطلبات قليلة بياخد ركنًا بـ١٥٬٠٠٠/شهر
         هو بالظبط اللي المبدأ بيمنعه. */
      { id: 'online_few',  key: 'q.sellHow.opts.onlineFew',  fx: { P: 1 } },
      { id: 'not_yet',     key: 'q.sellHow.opts.notYet',     fx: { P: 0 } },
    ],
  },

  sold_before: {   // 📦 منتج جاهز
    key: 'q.soldBefore',
    options: [
      { id: 'customers', key: 'q.soldBefore.opts.customers', fx: { P: 2 } },
      { id: 'a_little',  key: 'q.soldBefore.opts.aLittle',   fx: { P: 1 } },
      { id: 'friends',   key: 'q.soldBefore.opts.friends',   fx: { P: 1 } },
      { id: 'never',     key: 'q.soldBefore.opts.never',     fx: { P: 0 } },
    ],
  },

  field_exp: {   // 💡 فكرة
    key: 'q.fieldExp',
    options: [
      { id: 'worked',   key: 'q.fieldExp.opts.worked',   fx: { E: 2 } },
      { id: 'some',     key: 'q.fieldExp.opts.some',     fx: { E: 1 } },
      { id: 'learning', key: 'q.fieldExp.opts.learning', fx: { E: 1 } },
      { id: 'none',     key: 'q.fieldExp.opts.none',     fx: { E: 0 } },
    ],
  },

  skill_src: {   // 🛠️ مهارة
    key: 'q.skillSrc',
    options: [
      { id: 'years',    key: 'q.skillSrc.opts.years',    fx: { E: 2 } },
      { id: 'self',     key: 'q.skillSrc.opts.self',     fx: { E: 2 } },
      { id: 'recent',   key: 'q.skillSrc.opts.recent',   fx: { E: 1 } },
    ],
  },

  past_work: {   // 🤔 بستكشف
    key: 'q.pastWork',
    options: [
      { id: 'years', key: 'q.pastWork.opts.years', fx: { E: 2 } },
      { id: 'short', key: 'q.pastWork.opts.short', fx: { E: 1 } },
      { id: 'none',  key: 'q.pastWork.opts.none',  fx: { E: 0 } },
    ],
  },

  /* ── Q4 — الهدف أو القدرة ─────────────────────────────────────── */

  goal: {   // 🏪 شغّال
    key: 'q.goal',
    options: [
      { id: 'fixed_place',     key: 'q.goal.opts.fixedPlace',     fx: { G: 'fixed_place' } },
      { id: 'grow',            key: 'q.goal.opts.grow',           fx: { G: 'grow' } },
      { id: 'more_customers',  key: 'q.goal.opts.moreCustomers',  fx: { G: 'more_customers' } },
      { id: 'new_audience',    key: 'q.goal.opts.newAudience',    fx: { G: 'new_audience' } },
    ],
  },

  ready_now: {   // 📦 منتج جاهز
    key: 'q.readyNow',
    options: [
      { id: 'yes',     key: 'q.readyNow.opts.yes',    fx: { R: 1 } },
      { id: 'almost',  key: 'q.readyNow.opts.almost', fx: { R: 0 } },
      { id: 'testing', key: 'q.readyNow.opts.testing', fx: { R: 0 } },
    ],
  },

  can_build: {   // 💡 فكرة
    key: 'q.canBuild',
    options: [
      { id: 'yes',       key: 'q.canBuild.opts.yes',      fx: { canBuild: 'yes' } },
      { id: 'can_learn', key: 'q.canBuild.opts.canLearn', fx: { canBuild: 'learn' } },
      { id: 'need_help', key: 'q.canBuild.opts.needHelp', fx: { canBuild: 'no' } },
    ],
  },

  sold_skill: {   // 🛠️ مهارة
    key: 'q.soldSkill',
    options: [
      { id: 'customers', key: 'q.soldSkill.opts.customers', fx: { P: 2 } },
      { id: 'a_little',  key: 'q.soldSkill.opts.aLittle',   fx: { P: 1 } },
      { id: 'never',     key: 'q.soldSkill.opts.never',     fx: { P: 0 } },
    ],
  },

  have_now: {   // 🤔 بستكشف
    key: 'q.haveNow',
    options: [
      { id: 'experience', key: 'q.haveNow.opts.experience', fx: {} },
      { id: 'time',       key: 'q.haveNow.opts.time',       fx: {} },
      { id: 'nothing',    key: 'q.haveNow.opts.nothing',    fx: {} },
    ],
  },

  /* ── Q5 الالتزام — خياران لا أربعة ────────────────────────────────
     الأربع خيارات هنا **مش نعم/لأ لابس أربع كروت** — كل واحد بينتج
     **سببًا مختلفًا** في التوصية، وده اللي بيخلّيه يستحق مكانه:
       ready    → قدرة + استعداد
       validate → قدرة موجودة بس اختار يتأكد الأول (قرار صح، مش عجز)
       limited  → رأس المال محدود نسبيًا لالتزام شهري ← **بيفيتو المساحة**
       unsure   → لسه بيحسب، فما نحددش له التزام

     ── ليه سؤال واحد مش اتنين (رأس المال / ميزانية المكان)؟ ──────────
     المتغيّر اللي بيحرّك القرار مش «معاك كام» ولا «هتدفع كام للمكان»
     كلٌّ على حدة — هو **هل الالتزام الشهري استخدام منطقي لمواردك في
     مرحلتك دي؟** وده حكم واحد. سؤالان كانوا هيبقوا جمع بيانات، والمستخدم
     المبتدئ أصلًا بيعرف رأس ماله ومش بيعرف «كام للمكان في الشهر».
     والأهم: المقارنة بأرقام حقيقية مستحيلة دلوقتي — المنصة فيها ٣ مساحات
     حيّة بأسعار 1,000 / 15,000 / 60,000، وده مش أساس إحصائي لأي شرائح.
     فالنطاقات نوعية عن قصد، وما بندّعيش دقة مش موجودة. */
  budget: {
    key: 'q.budget',
    options: [
      { id: 'ready',    key: 'q.budget.opts.ready',    fx: { C: 1, CAP: 'ok' } },
      { id: 'validate', key: 'q.budget.opts.validate', fx: { C: 0, CAP: 'ok' } },
      { id: 'limited',  key: 'q.budget.opts.limited',  fx: { C: 0, CAP: 'low' } },
      { id: 'unsure',   key: 'q.budget.opts.unsure',   fx: { C: 0, CAP: 'unknown' } },
    ],
  },
});

/** ترتيب Q3/Q4 لكل فرع. */
const HELP_BRANCH_FLOW = Object.freeze({
  running: ['sell_how', 'goal'],
  product: ['sold_before', 'ready_now'],
  idea:    ['field_exp', 'can_build'],
  skill:   ['skill_src', 'sold_skill'],
  explore: ['past_work', 'have_now'],
});


/* ════════════════════════════════════════════════════════════════
   ٣) المحرّك — اشتقاق الحالة والسؤال التالي
   ════════════════════════════════════════════════════════════════ */

/** يحوّل الإجابات لحالة قابلة للحكم. `answers` = { questionId: optionId }. */
function helpDeriveState(answers) {
  const a = answers || {};
  const s = { branch: null, P: 0, R: 0, C: 0, E: 0, G: null, CAP: 'unknown',
              canBuild: null, act: a.act || null };

  Object.keys(a).forEach(qid => {
    const q = HELP_QUESTIONS[qid];
    if (!q || !q.options) return;
    const opt = q.options.find(o => o.id === a[qid]);
    if (!opt || !opt.fx) return;
    Object.keys(opt.fx).forEach(k => { s[k] = opt.fx[k]; });
  });

  /* R مُشتق لا مسؤول: فكرة أو مهارة لسه مش عرضًا — وده جوهر توصية F. */
  if (s.branch === 'running') s.R = 1;
  else if (s.branch !== 'product') s.R = 0;

  s.infra = !!(s.act && HELP_INFRA_ACTIVITIES.indexOf(s.act) > -1);
  return s;
}

/**
 * السؤال التالي — أو null يعني خلاص.
 * **٥ سقف مش هدف:** ممنوع سؤال زيادة عشان «نكمّل الشريط».
 */
function helpNextQuestion(answers) {
  const a = answers || {};
  if (!a.have) return 'have';
  if (!a.act) return 'act';

  const s = helpDeriveState(a);
  const flow = HELP_BRANCH_FLOW[s.branch] || [];
  for (let i = 0; i < flow.length; i++) {
    if (!a[flow[i]]) return flow[i];
  }

  /* الوضع المادي: بس لما فيه حاجة تتباع فعلًا. سؤال حد مالوش منتج عن
     الإيجار عبث — التوصية بتاعته «جهّز الأول» مهما كانت ميزانيته. */
  if (s.R === 1 && !a.budget) return 'budget';
  return null;
}

/** كل الأسئلة اللي المسار ده هيمرّ بيها (للمؤشّر — بيتزايد ولا ينقص أبدًا). */
function helpPathLength(answers) {
  const s = helpDeriveState(answers || {});
  if (!s.branch) return 2;                       // have + act على الأقل
  return 2 + (HELP_BRANCH_FLOW[s.branch] || []).length + (s.R === 1 ? 1 : 0);
}


/* ════════════════════════════════════════════════════════════════
   ٤) السلّم — أول تطابق يفوز
   ════════════════════════════════════════════════════════════════
   قاعدة المساحة الثابتة: **إشارات متوافقة لا احتياطي**
       دليل طلب (P=2) + جاهزية (R=1) + الهدف مكان + قدرة التزام (C=1)
   مفيش أي سطر تاني بيوصّل لـ`fixed`. ناقص أي إشارة → بازار أو تجهيز.

   عقد الشرح: كل توصية بتستشهد بإجابتين بالظبط، حرفيًا، في جملة واحدة.
   لا تلاتة ولا رقم — نتيجة رقمية ما بتشرحش نفسها. */

const HELP_RECOMMENDATIONS = Object.freeze([

  /* رأس المال المحدود **بيفيتو** المساحة حتى مع دليل طلب قوي وهدف مكان:
     التزام شهري على رأس مال صغير مش أفضل استخدام للموارد — وده مش
     «أرخص ضد أغلى»، ده **مخاطرة ضد تحقّق من السوق**. */
  { id: 'expand-fixed', family: 'fixed', decision: 'fixed', key: 'rec.expandFixed',
    when: s => s.P === 2 && s.R === 1 && s.C === 1 && s.CAP !== 'low' &&
               (s.G === 'fixed_place' || s.G === 'grow'),
    cite: ['sell_how', 'goal'] },

  /* نفس المخرج (بازار) بأربعة أسباب مختلفة — السبب هو اللي بيفرق للمستخدم،
     مش المخرج. الترتيب مقصود: الإشارة الاقتصادية أقوى من تفضيل الهدف. */
  { id: 'proven-tester', family: 'bazaar', decision: 'bazaar', key: 'rec.provenTester',
    when: s => s.P >= 1 && s.R === 1 &&
               (s.CAP === 'low' || s.P === 1 || s.C === 0 ||
                s.G === 'new_audience' || s.G === 'more_customers'),
    variant: s => s.CAP === 'low' ? 'budget'
      : s.P === 1 ? 'weak'
        : (s.G === 'new_audience' || s.G === 'more_customers') ? 'audience' : 'validate',
    cite: ['sell_how', 'budget'] },

  { id: 'first-proof', family: 'bazaar', decision: 'bazaar', key: 'rec.firstProof',
    when: s => s.P === 0 && s.R === 1,
    variant: s => s.CAP === 'low' ? 'budget' : 'plain',
    cite: ['sold_before', 'budget'] },

  /* F مقصورة على فرع المهارة — فصل الفكرة عن المهارة في Q1 هو اللي بيمنع
     الكارت ده إنه يوصل لحد ما ادّعاش مهارة أصلًا.
     decision='later' يعني: القرار بين بازار ومساحة **مؤجَّل**، مش ملغي. */
  { id: 'skill-to-offer', family: 'prepare', decision: 'later', key: 'rec.skillToOffer',
    when: s => s.branch === 'skill' && s.E >= 1,
    cite: ['skill_src'] },

  /* المخرج الافتراضي. تلات نسخ نص لنفس المخرج — النص هو اللي بيمنعه
     يُقرأ إهانة. «وده مش وحش» في العنوان ممنوع تليينه لسطر بيع. */
  { id: 'not-yet', family: 'prepare', decision: 'later', key: 'rec.notYet',
    when: () => true,
    variant: s => (s.P >= 1 ? 'b' : (s.E === 2 ? 'c' : 'a')),
    cite: [] },
]);

/**
 * التوصية النهائية.
 * @returns {{id, family, variant, key, infra, state, cite}}
 *   family: 'fixed' | 'bazaar' | 'prepare'
 */
function recommendFromAnswers(answers) {
  const s = helpDeriveState(answers);
  const rec = HELP_RECOMMENDATIONS.find(r => r.when(s)) ||
              HELP_RECOMMENDATIONS[HELP_RECOMMENDATIONS.length - 1];
  return {
    id: rec.id,
    family: rec.family,
    /* القرار اللي المستخدم دخل عشانه: بازار ولا مساحة ولا لسه بدري.
       كل توصية لازم تعرف موقعها من السؤال ده — حتى لو إجابتها «مؤجَّل». */
    decision: rec.decision,
    variant: typeof rec.variant === 'function' ? rec.variant(s) : null,
    key: rec.key,
    infra: s.infra,
    state: s,
    cite: rec.cite || [],
  };
}

/** تسمية الخيار اللي اختاره المستخدم — لبناء جملة «ليه» من إجاباته الحرفية. */
function helpAnswerLabel(answers, questionId, tFn) {
  const q = HELP_QUESTIONS[questionId];
  const a = answers || {};
  if (!q || !q.options || !a[questionId]) return '';
  const opt = q.options.find(o => o.id === a[questionId]);
  return opt ? tFn('assistant:' + opt.key) : '';
}
