/* ================================================================
   📸 media-handler.js — مسار الصور الكامل
   ================================================================
   المهام:
   1. ضغط الصور (Canvas API) — Max 1200px / JPEG 75%
   2. رفع لـ Supabase Storage
   3. حفظ الروابط في جدول listing_images
   4. Preview فوري قبل الرفع
   ================================================================ */

/* ────────────────────────────────────────
   الإعدادات — غيّر القيم من makani-config.txt
   ──────────────────────────────────────── */
const STORAGE_BUCKET = 'listing-images';
const MAX_FILE_SIZE  = 10 * 1024 * 1024; // 10MB
const MAX_WIDTH      = 1200;             // أقصى عرض بعد الضغط
const JPEG_QUALITY   = 0.75;            // جودة الضغط 75%
const MAX_IMAGES     = 5;               // أقصى عدد صور للإعلان الواحد

/* ────────────────────────────────────────
   المتغيرات العامة
   ──────────────────────────────────────── */
let uploadedImages = []; // [{file, previewUrl, compressed, uploaded, r2Url}]

/* ================================================================
   1️⃣  ضغط الصورة (Canvas API)
   ================================================================ */
async function compressImage(file) {
  return new Promise((resolve, reject) => {

    // رفض الملفات الكبيرة
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`الصورة أكبر من 10MB — حجمها ${(file.size/1024/1024).toFixed(1)}MB`));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      // حساب الأبعاد الجديدة
      let width  = img.width;
      let height = img.height;

      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width  = MAX_WIDTH;
      }

      // رسم الصورة على Canvas
      const canvas    = document.createElement('canvas');
      canvas.width    = width;
      canvas.height   = height;
      const ctx       = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // تحويل لـ Blob مضغوط
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) { reject(new Error('فشل ضغط الصورة')); return; }
          resolve(blob);
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذّر قراءة الصورة'));
    };

    img.src = url;
  });
}

/* ================================================================
   2️⃣  رفع صورة واحدة لـ Supabase Storage
   ================================================================ */
async function uploadImageToStorage(compressedBlob, userId, listingId, index) {
  const sb = window.sbClient;
  if (!sb) throw new Error('Supabase غير متاح');

  // اسم الملف: userId/listingId/index-timestamp.jpg
  const timestamp = Date.now();
  const fileName  = `${userId}/${listingId}/${index}-${timestamp}.jpg`;

  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, compressedBlob, {
      contentType : 'image/jpeg',
      cacheControl: '3600',
      upsert      : false
    });

  if (error) throw new Error('فشل رفع الصورة: ' + error.message);

  // الحصول على الرابط العام
  const { data: urlData } = sb.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

/* ================================================================
   3️⃣  حفظ رابط الصورة في جدول listing_images
   ================================================================ */
async function saveImageToDb(listingId, imageUrl, isCover, sortOrder) {
  const sb = window.sbClient;
  if (!sb) throw new Error('Supabase غير متاح');

  const { error } = await sb
    .from('listing_images')
    .insert({
      listing_id : listingId,
      url        : imageUrl,
      is_cover   : isCover,
      sort_order : sortOrder
    });

  if (error) throw new Error('فشل حفظ رابط الصورة: ' + error.message);
}

/* ================================================================
   4️⃣  المسار الكامل — ضغط + رفع + حفظ
   ================================================================ */
async function processAndUploadImage(file, userId, listingId, index, onProgress) {
  try {
    // الخطوة 1: ضغط
    onProgress(index, 'compressing', 20);
    const compressed = await compressImage(file);

    // الخطوة 2: رفع
    onProgress(index, 'uploading', 60);
    const imageUrl = await uploadImageToStorage(compressed, userId, listingId, index);

    // الخطوة 3: حفظ في DB
    onProgress(index, 'saving', 90);
    const isCover = index === 0; // أول صورة = غلاف
    await saveImageToDb(listingId, imageUrl, isCover, index);

    onProgress(index, 'done', 100);
    return imageUrl;

  } catch (err) {
    onProgress(index, 'error', 0);
    throw err;
  }
}

/* ================================================================
   5️⃣  Preview فوري في المتصفح
   ================================================================ */
function createImagePreview(file, index) {
  return new Promise((resolve) => {
    const reader    = new FileReader();
    reader.onload   = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

/* ================================================================
   6️⃣  تحديث Progress Bar في الـ UI
   ================================================================ */
function updateProgressBar(index, status, percent) {
  const bar   = document.getElementById(`progress-bar-${index}`);
  const label = document.getElementById(`progress-label-${index}`);
  if (!bar || !label) return;

  bar.style.width = percent + '%';

  const labels = {
    compressing : '⚙️ جاري الضغط...',
    uploading   : '☁️ جاري الرفع...',
    saving      : '💾 جاري الحفظ...',
    done        : '✅ تم بنجاح',
    error       : '❌ فشل الرفع'
  };

  label.textContent    = labels[status] || '';
  bar.style.background = status === 'error'
    ? '#EF4444'
    : status === 'done'
    ? '#22C55E'
    : '#FF6B00';
}

/* ================================================================
   7️⃣  رفع كل الصور دفعة واحدة
   ================================================================ */
async function uploadAllImages(files, userId, listingId) {
  const results = [];
  const errors  = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const url = await processAndUploadImage(
        files[i],
        userId,
        listingId,
        i,
        updateProgressBar
      );
      results.push(url);
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  return { results, errors };
}

/* ================================================================
   8️⃣  حذف صورة من Storage + DB
   ================================================================ */
async function deleteImage(listingId, imageId, filePath) {
  const sb = window.sbClient;
  if (!sb) throw new Error('Supabase غير متاح');

  // حذف من Storage
  const { error: storageError } = await sb.storage
    .from(STORAGE_BUCKET)
    .remove([filePath]);

  if (storageError) throw new Error('فشل حذف الصورة من Storage');

  // حذف من DB
  const { error: dbError } = await sb
    .from('listing_images')
    .delete()
    .eq('id', imageId);

  if (dbError) throw new Error('فشل حذف الصورة من قاعدة البيانات');
}

/* ================================================================
   9️⃣  Validation قبل الرفع
   ================================================================ */
function validateFiles(files) {
  const errors = [];

  if (files.length === 0) {
    errors.push('أضف صورة واحدة على الأقل');
    return errors;
  }

  if (files.length > MAX_IMAGES) {
    errors.push(`الحد الأقصى ${MAX_IMAGES} صور فقط`);
    return errors;
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  Array.from(files).forEach((file, i) => {
    if (!allowedTypes.includes(file.type)) {
      errors.push(`الصورة ${i + 1}: نوع غير مدعوم — JPEG أو PNG أو WebP فقط`);
    }
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`الصورة ${i + 1}: أكبر من 10MB`);
    }
  });

  return errors;
}
