/* ================================================================
   📁 media-handler.js — معالج الصور
   ================================================================
   - ضغط محلي عبر Canvas مع تصحيح EXIF Rotation
   - رفع متوازٍ (3 في نفس الوقت) مع إعادة محاولة عند الفشل
   - دعم إلغاء الرفع أثناء التشغيل
   ================================================================ */

const UPLOAD_ENDPOINT = '/upload';
const MAX_W           = 1280;
const MAX_H           = 1280;
const QUALITY         = 0.82;
const MAX_FILE_BYTES  = 20 * 1024 * 1024;  // 20 MB — رفض قبل الضغط
const CONCURRENCY     = 3;                  // عدد الصور تُرفع بالتوازي
const RETRY_ATTEMPTS  = 2;                  // عدد إعادة المحاولات عند فشل الشبكة

let _uploadAborted = false;

/* ================================================================
   قراءة EXIF Orientation من ملف JPEG
   ================================================================ */
function readExifOrientation(file) {
  return new Promise(resolve => {
    if (!file.type.match(/image\/jpe?g/i)) { resolve(1); return; }
    const reader = new FileReader();
    reader.onload = ({ target: { result } }) => {
      try {
        const view = new DataView(result);
        if (view.getUint16(0, false) !== 0xFFD8) { resolve(1); return; }
        let offset = 2;
        while (offset + 4 < view.byteLength) {
          const marker = view.getUint16(offset, false);
          offset += 2;
          if (marker === 0xFFE1) {
            if (offset + 10 > view.byteLength) { resolve(1); return; }
            if (view.getUint32(offset + 2, false) !== 0x45786966) { resolve(1); return; }
            const little  = view.getUint16(offset + 8, false) === 0x4949;
            const ifdBase = offset + 8;
            const ifdOff  = view.getUint32(ifdBase + 4, little);
            const ifdStart = ifdBase + ifdOff;
            if (ifdStart + 2 > view.byteLength) { resolve(1); return; }
            const tags = view.getUint16(ifdStart, little);
            for (let i = 0; i < tags; i++) {
              const off = ifdStart + 2 + i * 12;
              if (off + 12 > view.byteLength) break;
              if (view.getUint16(off, little) === 0x0112) {
                resolve(view.getUint16(off + 8, little));
                return;
              }
            }
            resolve(1); return;
          }
          if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
          if (offset + 2 > view.byteLength) break;
          offset += view.getUint16(offset, false);
        }
      } catch {}
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

/* ================================================================
   ضغط صورة واحدة مع تصحيح EXIF Rotation
   ================================================================ */
async function compressImage(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `حجم الصورة كبير جداً (${(file.size / 1024 / 1024).toFixed(1)} MB) — الحد الأقصى 20 MB`
    );
  }

  const orientation = await readExifOrientation(file);
  const swapped = orientation >= 5 && orientation <= 8;

  /* نستخدم createImageBitmap مع imageOrientation:'none'
     لضمان الحصول على البيكسلات الخام بدون تصحيح تلقائي من المتصفح،
     ثم نطبّق التصحيح يدوياً بشكل موحّد على كل المتصفحات */
  let source, srcW, srcH, releaseSrc;
  try {
    const bm = await createImageBitmap(file, { imageOrientation: 'none' });
    source = bm;
    srcW   = bm.width;
    srcH   = bm.height;
    releaseSrc = () => bm.close();
  } catch {
    // Fallback: متصفحات قديمة لا تدعم createImageBitmap + imageOrientation
    const result = await new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('فشل قراءة الصورة')); };
      img.src = url;
    });
    source     = result;
    srcW       = result.naturalWidth;
    srcH       = result.naturalHeight;
    releaseSrc = () => {};
  }

  /* أبعاد العرض النهائية (مع مراعاة التدوير) */
  let dstW = swapped ? srcH : srcW;
  let dstH = swapped ? srcW : srcH;
  if (dstW > MAX_W || dstH > MAX_H) {
    const r = Math.min(MAX_W / dstW, MAX_H / dstH);
    dstW = Math.round(dstW * r);
    dstH = Math.round(dstH * r);
  }

  const canvas = document.createElement('canvas');
  canvas.width  = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');

  /* تحويلات Canvas لتصحيح اتجاه EXIF
     (مُحقَّقة رياضياً لكل قيمة orientation) */
  switch (orientation) {
    case 2: ctx.translate(dstW, 0);      ctx.scale(-1, 1);           break; // flip H
    case 3: ctx.translate(dstW, dstH);   ctx.rotate(Math.PI);        break; // 180°
    case 4: ctx.translate(0, dstH);      ctx.scale(1, -1);           break; // flip V
    case 5: ctx.rotate(.5*Math.PI);      ctx.scale(1, -1);           break; // transpose
    case 6: ctx.translate(dstW, 0);      ctx.rotate(.5*Math.PI);     break; // 90° CW ← الأشيع
    case 7: ctx.translate(dstW, dstH);   ctx.rotate(-.5*Math.PI);    ctx.scale(1, -1); break;
    case 8: ctx.translate(0, dstH);      ctx.rotate(-.5*Math.PI);    break; // 90° CCW
  }

  /* رسم الصورة — للـ orientations المقلوبة الأبعاد يتبدّل dstW/dstH */
  ctx.drawImage(source, 0, 0, swapped ? dstH : dstW, swapped ? dstW : dstH);
  releaseSrc();

  const q = file.size < 300 * 1024 ? 0.92 : QUALITY;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('فشل ضغط الصورة')),
      'image/jpeg',
      q
    );
  });
}

/* ================================================================
   رفع Blob واحد لـ R2 عبر Pages Function
   ================================================================ */
async function uploadToR2(blob, path, authToken) {
  const form = new FormData();
  form.append('file', new File([blob], 'image.jpg', { type: 'image/jpeg' }));
  form.append('path', path);

  const res  = await fetch(UPLOAD_ENDPOINT, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${authToken}` },
    body:    form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل رفع الصورة');
  return data.url;
}

/* ================================================================
   Retry wrapper — يُعيد المحاولة مرتين عند انقطاع الشبكة
   ================================================================ */
async function uploadWithRetry(blob, path, authToken) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (_uploadAborted) throw new Error('تم إلغاء الرفع');
    try {
      return await uploadToR2(blob, path, authToken);
    } catch (e) {
      lastErr = e;
      if (attempt < RETRY_ATTEMPTS && !_uploadAborted) {
        await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); // 1.2s ثم 2.4s
      }
    }
  }
  throw lastErr;
}

/* ================================================================
   إلغاء الرفع الجاري
   ================================================================ */
function abortUpload() {
  _uploadAborted = true;
}

/* ================================================================
   الدالة الرئيسية — ضغط ورفع متوازٍ بـ CONCURRENCY workers
   ================================================================ */
async function uploadImages(files, userId, onProgress, authToken) {
  _uploadAborted = false;

  const urls  = new Array(files.length).fill(null);
  let   done  = 0;
  const queue = [...Array(files.length).keys()]; // [0, 1, 2, ..., n-1]

  /* كل worker يأخذ مهمة من الـ queue حتى ينتهي */
  const worker = async () => {
    while (queue.length > 0) {
      if (_uploadAborted) throw new Error('تم إلغاء الرفع');
      const i = queue.shift();
      if (i === undefined) break;

      const blob = await compressImage(files[i]);
      if (_uploadAborted) throw new Error('تم إلغاء الرفع');

      const path = `${userId}/${Date.now()}_${i}.jpg`;
      urls[i] = await uploadWithRetry(blob, path, authToken);

      done++;
      if (onProgress) onProgress(done, files.length);
    }
  };

  /* تشغيل CONCURRENCY workers بالتوازي */
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, files.length) },
    () => worker()
  );
  await Promise.all(workers);

  if (_uploadAborted) throw new Error('تم إلغاء الرفع');
  return urls.filter(Boolean);
}
