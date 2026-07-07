/**
 * نموذج بيانات المساحة المشترك — مصدر واحد بدل تكرار تحويل صفّ القاعدة
 * إلى كائن العرض في app.js و spaces/app.js (كانا يتباعدان مع كل تعديل).
 * حمّلها بـ <script src="/shared/space-model.js"></script>.
 */

const SPACE_STATUS = Object.freeze({
  LIVE: 'live',
  PAUSED: 'paused',
  HIDDEN_BY_ADMIN: 'hidden_by_admin',
  ARCHIVED: 'archived',
});

/** يحوّل الأرقام العربية/الفارسية إلى أرقام إنجليزية — يوحّد عرض المقاسات والأسعار بغض النظر عن طريقة إدخالها */
function _toLatinDigits(str) {
  if (!str) return str;
  const arabic  = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return String(str).replace(/[٠-٩۰-۹]/g, d => {
    const ai = arabic.indexOf(d);
    if (ai > -1) return ai;
    return persian.indexOf(d);
  });
}

/**
 * يحوّل صفّ spaces (+ space_units المضمّنة) إلى كائن العرض المستخدم في الكروت/التفاصيل.
 * profilesMap: { [owner_id]: { plan_tier, full_name, avatar_url, entity_name, is_verified } }
 */
function mapSpaceRow(row, profilesMap) {
  profilesMap = profilesMap || {};
  const sizes = row.sizes_prices
    ? _toLatinDigits(row.sizes_prices).split(/[|·]/).map(s => s.trim()).filter(Boolean)
    : [];
  const ownerProfile = (row.owner_id && profilesMap[row.owner_id]) || {};
  const isBroker = row.is_broker || false;
  return {
    id: row.id,
    ownerId: row.owner_id || null,
    name: row.name || '',
    loc: row.region || '',
    type: row.type || '',
    price: row.min_price || 0,
    sizes: sizes,
    acts: row.activities || [],
    allActs: row.all_acts || false,
    badge: row.badge || 'متاح',
    badgeClass: row.badge_class || 'badge-avail',
    season: row.season || '',
    insight: row.insight || '',
    image: row.image_url || '',
    icon: row.icon_emoji || '',
    thumbClass: row.thumb_color || '',
    extraImages: row.extra_images || [],
    description: row.description || '',
    amenities: row.amenities || [],
    isBroker: isBroker,
    ownerName: isBroker ? 'مكاني سبوت' : (ownerProfile.entity_name || ownerProfile.full_name || null),
    ownerAvatar: isBroker ? null : (ownerProfile.avatar_url || null),
    ownerVerified: isBroker ? false : !!ownerProfile.is_verified,
    planTier: isBroker ? 'broker' : (ownerProfile.plan_tier || 'starter'),
    createdAt: row.created_at || '',
    subSpaces: (row.space_units || []).map(u => ({
      unitId: u.unit_id || '',
      name: u.name || '',
      location: u.location || '',
      size: u.size || '',
      price: u.price || 0,
      status: u.status || 'available',
      image: u.image_url || '',
      floor: u.floor || '',
      notes: u.notes || '',
    })),
  };
}

/** يحسم السعر الرقمي الحقيقي لحجم مُختار من space.sizes — بديل عن استخراجه من نص العرض */
function resolveSizePrice(space, sizeLabel) {
  if (!space) return 0;
  for (const sz of (space.sizes || [])) {
    const parts = sz.split(':');
    if (parts[0].trim() === sizeLabel) {
      return parts[1] ? parseInt(parts[1], 10) : (space.price || 0);
    }
  }
  return space.price || 0;
}

/* fetchLiveSpaces (تحميل كل المساحات دفعة واحدة) أُزيلت — كانت جذر مشكلة
   عدم وجود Pagination خادمي. استبدلها searchPublicSpaces أدناه لكل الحالات. */

/**
 * يجلب مساحة منشورة واحدة بمعرّفها — لفتح تفاصيل مساحة غير موجودة محليًا
 * (رابط مباشر ?space=ID، أو حدث Realtime لمساحة خارج الصفحة المعروضة حاليًا).
 * يُعيد null لو غير موجودة/غير منشورة (بدل رمي خطأ) — مطابقًا لسلوك الاستخدام السابق.
 */
async function fetchSpaceById(sbClient, spaceId) {
  if (!sbClient || !spaceId) return null;
  const { data, error } = await sbClient
    .from('spaces')
    .select('*, space_units(unit_id, name, floor, size, price, status, location, image_url, notes)')
    .eq('id', spaceId)
    .eq('status', SPACE_STATUS.LIVE)
    .maybeSingle();
  if (error || !data) return null;

  let profilesMap = {};
  if (data.owner_id) {
    // public_profiles: عرض آمن بأعمدة عامة فقط (بديل profiles_public_read_basic المحذوفة)
    const { data: profiles } = await sbClient
      .from('public_profiles')
      .select('id, plan_tier, full_name, avatar_url, entity_name, is_verified')
      .eq('id', data.owner_id);
    (profiles || []).forEach(p => { profilesMap[p.id] = p; });
  }
  return mapSpaceRow(data, profilesMap);
}

/**
 * يحوّل صفّ نتيجة search_public_spaces (RPC) — حقول المالك مسطّحة و units جاهزة
 * كمصفوفة — إلى نفس كائن العرض، بإعادة استخدام mapSpaceRow دون تكرار المنطق.
 */
function mapSearchRow(row) {
  const profilesMap = row.owner_id ? {
    [row.owner_id]: {
      plan_tier:   row.owner_plan_tier,
      full_name:   row.owner_full_name,
      avatar_url:  row.owner_avatar_url,
      entity_name: row.owner_entity_name,
      is_verified: row.owner_is_verified,
    },
  } : {};
  return mapSpaceRow({ ...row, space_units: row.units || [] }, profilesMap);
}

/**
 * البحث/الفلترة/الترتيب/الترقيم للمساحات المنشورة — مصدر واحد للحقيقة عبر RPC
 * search_public_spaces. تستدعيه الرئيسية و/spaces/ بنفس الدالة ونفس النتيجة دائمًا
 * (بدل فلترة محلية على ما تم تحميله فقط).
 * opts: { region, types:[], activities:[], maxPrice, sort, limit, offset }
 * يُعيد { items:[...], totalCount }.
 */
async function searchPublicSpaces(sbClient, opts) {
  opts = opts || {};
  const { data, error } = await sbClient.rpc('search_public_spaces', {
    p_region:     opts.region || null,
    p_types:      (opts.types && opts.types.length) ? opts.types : null,
    p_activities: (opts.activities && opts.activities.length) ? opts.activities : null,
    p_max_price:  (opts.maxPrice != null) ? opts.maxPrice : null,
    p_sort:       opts.sort || 'default',
    p_limit:      opts.limit != null ? opts.limit : 20,
    p_offset:     opts.offset || 0,
  });
  if (error) throw error;
  const rows = data || [];
  return {
    items: rows.map(mapSearchRow),
    totalCount: rows.length ? Number(rows[0].total_count) : 0,
  };
}
