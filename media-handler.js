/* ================================================================
   📁 media-handler.js — معالج الصور
   ================================================================
   ضغط الصور قبل الرفع + رفعها لـ Supabase Storage
   يُستدعى من post-ad.html
   ================================================================ */

const SUPABASE_URL_MH = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY_MH = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';
const STORAGE_BUCKET   = 'listing-images';
const MAX_W = 1200;
const MAX_H = 1200;
const QUALITY = 0.82;

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
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('فشل ضغط الصورة')), 'image/jpeg', QUALITY);
    };
    img.onerror = () => reject(new Error('فشل قراءة الصورة'));
    img.src = url;
  });
}

/**
 * يرفع ملف واحد لـ Supabase Storage
 * @param {Blob} blob
 * @param {string} path — المسار داخل الـ bucket
 * @returns {Promise<string>} — الـ URL العام للصورة
 */
async function uploadToSupabase(blob, path) {
  const endpoint = `${SUPABASE_URL_MH}/storage/v1/object/${STORAGE_BUCKET}/${path}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY_MH}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true'
    },
    body: blob
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'فشل رفع الصورة');
  }
  return `${SUPABASE_URL_MH}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

/**
 * يضغط ويرفع مصفوفة من الملفات
 * @param {File[]} files
 * @param {string} userId
 * @param {Function} onProgress — callback(done, total)
 * @returns {Promise<string[]>} — قائمة الـ URLs
 */
async function uploadImages(files, userId, onProgress) {
  const urls = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const blob = await compressImage(file);
    const ext  = 'jpg';
    const ts   = Date.now();
    const path = `${userId}/${ts}_${i}.${ext}`;
    const url  = await uploadToSupabase(blob, path);
    urls.push(url);
    if (onProgress) onProgress(i + 1, files.length);
  }
  return urls;
}
