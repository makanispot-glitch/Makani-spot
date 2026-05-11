/* ================================================================
   📁 media-handler.js — معالج الصور
   ================================================================
   ضغط الصور محلياً (Canvas API) ثم رفعها لـ Cloudflare R2
   عبر Pages Function على /upload
   يُستدعى من post-ad.html
   ================================================================ */

const UPLOAD_ENDPOINT = '/upload';
const R2_PUBLIC_BASE  = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev';
const MAX_W    = 1200;
const MAX_H    = 1200;
const QUALITY  = 0.75;   // JPEG 75%

/**
 * يضغط صورة واحدة عبر Canvas ويُرجع Blob
 * @param {File} file
 * @returns {Promise<Blob>}
 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_W || height > MAX_H) {
        const ratio = Math.min(MAX_W / width, MAX_H / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('فشل ضغط الصورة')),
        'image/jpeg',
        QUALITY
      );
    };
    img.onerror = () => reject(new Error('فشل قراءة الصورة'));
    img.src = url;
  });
}

/**
 * يرفع blob واحد لـ R2 عبر Pages Function /upload
 * @param {Blob}   blob
 * @param {string} path       — مسار الملف داخل الـ bucket
 * @param {string} authToken  — Supabase session access_token
 * @returns {Promise<string>} — الـ URL العام
 */
async function uploadToR2(blob, path, authToken) {
  const form = new FormData();
  form.append('file', new File([blob], 'image.jpg', { type: 'image/jpeg' }));
  form.append('path', path);

  const res = await fetch(UPLOAD_ENDPOINT, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${authToken}` },
    body:    form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'فشل رفع الصورة');
  return data.url;
}

/**
 * يضغط ويرفع مصفوفة من الملفات
 * @param {File[]}   files
 * @param {string}   userId
 * @param {Function} onProgress  — callback(done, total)
 * @param {string}   authToken   — Supabase session access_token
 * @returns {Promise<string[]>}  — قائمة الـ URLs
 */
async function uploadImages(files, userId, onProgress, authToken) {
  const urls = [];
  for (let i = 0; i < files.length; i++) {
    const blob = await compressImage(files[i]);
    const path = `${userId}/${Date.now()}_${i}.jpg`;
    const url  = await uploadToR2(blob, path, authToken);
    urls.push(url);
    if (onProgress) onProgress(i + 1, files.length);
  }
  return urls;
}
