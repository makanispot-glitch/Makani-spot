/* ================================================================
   📁 media-handler.js — معالج الصور
   ================================================================
   ضغط الصور محلياً (Canvas API) ثم رفعها لـ Cloudflare R2
   عبر Pages Function على /upload
   يُستدعى من post-ad.html
   ================================================================ */

const UPLOAD_ENDPOINT  = '/upload';
const R2_PUBLIC_BASE   = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev';
const MAX_W            = 1280;
const MAX_H            = 1280;
const QUALITY          = 0.82;
const MAX_FILE_BYTES   = 20 * 1024 * 1024; // 20MB

let _uploadAbortCtrl = null;

/* ──────────────────────────────────────────────────────────────
   قراءة EXIF Orientation من أول 64KB من الملف
   يُرجع رقم 1-8 (1 = طبيعي)
   ────────────────────────────────────────────────────────────── */
function getExifOrientation(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ({ target: { result } }) => {
      try {
        const view = new DataView(result);
        if (view.getUint16(0, false) !== 0xFFD8) { resolve(1); return; }
        let offset = 2;
        while (offset < view.byteLength - 2) {
          const marker = view.getUint16(offset, false);
          offset += 2;
          if (marker === 0xFFE1) {
            if (view.getUint32(offset + 2, false) !== 0x45786966) { resolve(1); return; }
            const little = view.getUint16(offset + 8, false) === 0x4949;
            const ifd    = offset + 8 + view.getUint32(offset + 12, little);
            const nTags  = view.getUint16(ifd, little);
            for (let n = 0; n < nTags; n++) {
              if (view.getUint16(ifd + 2 + n * 12, little) === 0x0112) {
                resolve(view.getUint16(ifd + 2 + n * 12 + 8, little));
                return;
              }
            }
            resolve(1); return;
          }
          if ((marker & 0xFF00) !== 0xFF00) break;
          offset += view.getUint16(offset, false);
        }
        resolve(1);
      } catch (_) { resolve(1); }
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

/* ──────────────────────────────────────────────────────────────
   ضغط صورة واحدة مع تصحيح EXIF Rotation
   @param {File} file
   @returns {Promise<Blob>}
   ────────────────────────────────────────────────────────────── */
async function compressImage(file) {
  if (file.size > MAX_FILE_BYTES) {
    return Promise.reject(
      new Error(`حجم الصورة كبير جداً (${(file.size / 1024 / 1024).toFixed(1)} MB) — الحد الأقصى 20 MB`)
    );
  }

  const orientation = await getExifOrientation(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const origW = img.naturalWidth;
      const origH = img.naturalHeight;

      // تطبيق الـ scaling على الأبعاد الأصلية (قبل الدوران)
      let fw = origW, fh = origH;
      if (fw > MAX_W || fh > MAX_H) {
        const r = Math.min(MAX_W / fw, MAX_H / fh);
        fw = Math.round(fw * r);
        fh = Math.round(fh * r);
      }

      // اتجاهات 5-8: يُبدَّل عرض وارتفاع الكانفاس
      const swapDim = orientation >= 5 && orientation <= 8;
      const canvas  = document.createElement('canvas');
      canvas.width  = swapDim ? fh : fw;
      canvas.height = swapDim ? fw : fh;

      const ctx = canvas.getContext('2d');

      /*
        مصفوفة التحويل لكل اتجاه EXIF:
        transform(a, b, c, d, e, f)  ←  x' = a·x + c·y + e  /  y' = b·x + d·y + f
        تضمن أن الصورة تُعرض بشكل صحيح بعد الضغط
      */
      switch (orientation) {
        case 2: ctx.transform(-1,  0,  0,  1, fw,  0); break; // flip أفقي
        case 3: ctx.transform(-1,  0,  0, -1, fw, fh); break; // 180°
        case 4: ctx.transform( 1,  0,  0, -1,  0, fh); break; // flip عمودي
        case 5: ctx.transform( 0,  1,  1,  0,  0,  0); break; // transpose
        case 6: ctx.transform( 0,  1, -1,  0, fh,  0); break; // 90° عكس عقارب الساعة (iPhone portrait)
        case 7: ctx.transform( 0, -1, -1,  0, fh, fw); break; // transverse
        case 8: ctx.transform( 0, -1,  1,  0,  0, fw); break; // 90° مع عقارب الساعة
      }

      ctx.drawImage(img, 0, 0, fw, fh);

      const q = file.size < 300 * 1024 ? 0.92 : QUALITY;
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('فشل ضغط الصورة'))),
        'image/jpeg',
        q
      );
    };

    img.onerror = () => reject(new Error('فشل قراءة الصورة'));
    img.src = url;
  });
}

/* ──────────────────────────────────────────────────────────────
   رفع blob واحد لـ R2 مع دعم إلغاء الرفع
   ────────────────────────────────────────────────────────────── */
async function uploadToR2(blob, path, authToken, signal) {
  const form = new FormData();
  form.append('file', new File([blob], 'image.jpg', { type: 'image/jpeg' }));
  form.append('path', path);

  const res = await fetch(UPLOAD_ENDPOINT, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${authToken}` },
    body:    form,
    signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل رفع الصورة');
  return data.url;
}

/* محاولة الرفع مع retry تلقائي مرتين عند انقطاع الشبكة */
async function uploadWithRetry(blob, path, authToken, signal, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await uploadToR2(blob, path, authToken, signal);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 900 * (attempt + 1))); // 0.9s ثم 1.8s
    }
  }
}

/* ──────────────────────────────────────────────────────────────
   رفع مصفوفة الملفات بالتوازي (Promise.all) مع ضغط + retry
   @param {File[]}   files
   @param {string}   userId
   @param {Function} onProgress  — callback(done, total)
   @param {string}   authToken
   @returns {Promise<string[]>}
   ────────────────────────────────────────────────────────────── */
async function uploadImages(files, userId, onProgress, authToken) {
  _uploadAbortCtrl = new AbortController();
  const signal = _uploadAbortCtrl.signal;

  // ضغط كل الصور بالتوازي (خفيفة على الذاكرة لأنها تعمل محلياً)
  const blobs = await Promise.all(files.map(f => compressImage(f)));

  let done = 0;
  const urls = await Promise.all(
    blobs.map(async (blob, i) => {
      // إضافة random suffix لتفادي تعارض الأسماء عند الرفع المتوازي
      const rand = Math.random().toString(36).slice(2, 6);
      const path = `${userId}/${Date.now()}_${i}_${rand}.jpg`;
      const url  = await uploadWithRetry(blob, path, authToken, signal);
      if (onProgress) onProgress(++done, files.length);
      return url;
    })
  );

  return urls;
}

/* إلغاء الرفع الجاري */
function cancelUpload() {
  _uploadAbortCtrl?.abort();
}

/* ──────────────────────────────────────────────────────────────
   ضغط صورة واحدة وتحويلها إلى WebP (مع EXIF orientation)
   @param {File}   file
   @param {number} maxW     — أقصى عرض (px)  افتراضي 1280
   @param {number} maxH     — أقصى ارتفاع (px) افتراضي 1280
   @param {number} quality  — جودة WebP 0-1   افتراضي 0.85
   @returns {Promise<Blob>}
   ────────────────────────────────────────────────────────────── */
async function compressToWebP(file, maxW = 1280, maxH = 1280, quality = 0.85) {
  if (file.size > MAX_FILE_BYTES) {
    return Promise.reject(
      new Error(`حجم الصورة كبير جداً (${(file.size / 1024 / 1024).toFixed(1)} MB) — الحد الأقصى 20 MB`)
    );
  }

  const orientation = await getExifOrientation(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let fw = img.naturalWidth, fh = img.naturalHeight;
      if (fw > maxW || fh > maxH) {
        const r = Math.min(maxW / fw, maxH / fh);
        fw = Math.round(fw * r);
        fh = Math.round(fh * r);
      }

      const swapDim = orientation >= 5 && orientation <= 8;
      const canvas  = document.createElement('canvas');
      canvas.width  = swapDim ? fh : fw;
      canvas.height = swapDim ? fw : fh;

      const ctx = canvas.getContext('2d');
      switch (orientation) {
        case 2: ctx.transform(-1,  0,  0,  1, fw,  0); break;
        case 3: ctx.transform(-1,  0,  0, -1, fw, fh); break;
        case 4: ctx.transform( 1,  0,  0, -1,  0, fh); break;
        case 5: ctx.transform( 0,  1,  1,  0,  0,  0); break;
        case 6: ctx.transform( 0,  1, -1,  0, fh,  0); break;
        case 7: ctx.transform( 0, -1, -1,  0, fh, fw); break;
        case 8: ctx.transform( 0, -1,  1,  0,  0, fw); break;
      }
      ctx.drawImage(img, 0, 0, fw, fh);

      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('فشل ضغط الصورة'))),
        'image/webp',
        quality
      );
    };

    img.onerror = () => reject(new Error('فشل قراءة الصورة'));
    img.src = url;
  });
}

/* ──────────────────────────────────────────────────────────────
   رفع صورة واحدة → ضغط WebP → R2
   @param {File}   file       الملف الأصلي
   @param {string} r2Path     المسار داخل الباكيت  مثال: bazaars/123.webp
   @param {string} authToken  Supabase access token
   @returns {Promise<string>} الـ URL العام
   ────────────────────────────────────────────────────────────── */
async function uploadSingleImageToR2(file, r2Path, authToken) {
  const blob = await compressToWebP(file);
  const form = new FormData();
  form.append('file', new File([blob], 'image.webp', { type: 'image/webp' }));
  form.append('path', r2Path);

  const res = await fetch(UPLOAD_ENDPOINT, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${authToken}` },
    body:    form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل رفع الصورة');
  return data.url;
}
