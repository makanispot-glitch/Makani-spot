# ============================================================
# bump-version.ps1  —  شغّل هذا السكريبت قبل كل deploy
# يحدّث CACHE_VER في sw.js و ?v= في كل ملفات HTML دفعة واحدة
# ============================================================

$ver = (Get-Date -Format "yyyyMMddHHmm")
$root = $PSScriptRoot

Write-Host ""
Write-Host "==> الإصدار الجديد: v$ver" -ForegroundColor Cyan

# ── 1. تحديث sw.js ───────────────────────────────────────────
$swPath = Join-Path $root "sw.js"
$sw = Get-Content $swPath -Raw -Encoding utf8
$newSw = $sw -replace "const CACHE_VER\s*=\s*'[^']*'", "const CACHE_VER   = 'v$ver'"
Set-Content $swPath $newSw -Encoding utf8 -NoNewline
Write-Host "  [sw.js]        CACHE_VER = v$ver" -ForegroundColor Green

# ── 2. تحديث كل ملفات HTML ───────────────────────────────────
$htmlFiles = Get-ChildItem $root -Recurse -Filter "*.html"
foreach ($file in $htmlFiles) {
    $content = Get-Content $file.FullName -Raw -Encoding utf8
    $updated = $content -replace '\.js\?v=[\w\-]+', ".js?v=$ver"
    if ($updated -ne $content) {
        Set-Content $file.FullName $updated -Encoding utf8 -NoNewline
        Write-Host "  [$($file.Name.PadRight(30))] ?v= → $ver" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==> تم! الآن ارفع الملفات على Cloudflare Pages" -ForegroundColor Yellow
Write-Host ""
