# ============================================================
# bump-version.ps1  —  المصدر الوحيد لتوليد الإصدار (Single Source of Truth)
#
# بيشتغل تلقائيًا عبر git pre-commit hook (githooks/pre-commit) في كل
# commit — مفيش داعي تشغّله يدويًا في السير العادي. لو حبيت تشغّله
# بنفسك لأي سبب (مثلاً للتأكد يدويًا): ./bump-version.ps1
#
# بيحدّث نفس رقم الإصدار في كل الأماكن دفعة واحدة:
#   sw.js (CACHE_VER) / version.js (window.APP_VERSION) /
#   manifest.json (حقل version) / كل *.html (?v= على .js و.css
#   ومانيفست، وبيضيف ?v= لأي سكريبت/ستايل محلي ملوش نسخة أصلًا)
# ============================================================

$ErrorActionPreference = 'Stop'

try {
    $ver  = (Get-Date -Format "yyyyMMddHHmmss")
    $root = $PSScriptRoot

    Write-Host ""
    Write-Host "==> الإصدار الجديد: v$ver" -ForegroundColor Cyan

    # ── 1. sw.js — CACHE_VER ─────────────────────────────────────
    $swPath = Join-Path $root "sw.js"
    $sw = Get-Content $swPath -Raw -Encoding utf8
    $sw = $sw -replace "const CACHE_VER\s*=\s*'[^']*'", "const CACHE_VER   = 'v$ver'"
    Set-Content $swPath $sw -Encoding utf8 -NoNewline
    Write-Host "  [sw.js]           CACHE_VER   = v$ver" -ForegroundColor Green

    # ── 2. version.js — window.APP_VERSION (يُقرأ من المتصفح) ───
    $versionJsPath = Join-Path $root "version.js"
    Set-Content $versionJsPath "window.APP_VERSION = 'v$ver';`n" -Encoding utf8 -NoNewline
    Write-Host "  [version.js]      APP_VERSION = v$ver" -ForegroundColor Green

    # ── 3. manifest.json — حقل "version" (معلوماتي، بدون تأثير على PWA) ─
    $manifestPath = Join-Path $root "manifest.json"
    $manifest = Get-Content $manifestPath -Raw -Encoding utf8
    if ($manifest -match '"version"\s*:\s*"[^"]*"') {
        $manifest = $manifest -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"v$ver`""
    } else {
        $manifest = $manifest -replace '^\{', "{`n  `"version`": `"v$ver`","
    }
    Set-Content $manifestPath $manifest -Encoding utf8 -NoNewline
    Write-Host "  [manifest.json]   version     = v$ver" -ForegroundColor Green

    # ── 4. كل ملفات HTML المتتبَّعة في git فقط ────────────────────
    #    (git ls-files بدل Get-ChildItem -Recurse — عشان miss يلمسش
    #     node_modules/ أو أي حاجة تانية موجودة بس محليًا وغير متتبَّعة)
    $htmlFiles = git -C $root ls-files -- '*.html' | ForEach-Object { Get-Item (Join-Path $root $_) }
    foreach ($file in $htmlFiles) {
        $content  = Get-Content $file.FullName -Raw -Encoding utf8
        $original = $content

        # أ) حدّث ?v= الموجود بالفعل على .js و.css
        $content = $content -replace '\.js\?v=[\w\-]+',  ".js?v=$ver"
        $content = $content -replace '\.css\?v=[\w\-]+', ".css?v=$ver"

        # ب) ضيف ?v= لأي src=".../local.js" أو href=".../local.css" محلي
        #    ملوش نسخة أصلًا (يستثني أي رابط خارجي http(s):// عمدًا)
        $content = $content -replace 'src="((?!https?://)[^"]+\.js)"',  "src=`"`$1?v=$ver`""
        $content = $content -replace 'href="((?!https?://)[^"]+\.css)"', "href=`"`$1?v=$ver`""

        # ج) حدّث/ضيف ?v= لرابط manifest.json تحديدًا
        $content = $content -replace 'href="(/manifest\.json)(\?v=[\w\-]*)?"', "href=`"`$1?v=$ver`""

        if ($content -ne $original) {
            Set-Content $file.FullName $content -Encoding utf8 -NoNewline
            Write-Host "  [$($file.Name.PadRight(28))] ?v= -> v$ver" -ForegroundColor Green
        }
    }

    # ── 5. ضيف الملفات المتأثرة لنفس الـ commit الجاري ────────────
    # (ErrorActionPreference بيترجع stderr الطبيعي بتاع git — زي تحذيرات
    #  CRLF/LF — لخطأ terminating لو سايبينها Stop؛ نأمّنها هنا مؤقتًا)
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    git -C $root add -A -- '*.html' 'sw.js' 'version.js' 'manifest.json' 2>$null | Out-Null
    $ErrorActionPreference = $prevEAP

    Write-Host ""
    Write-Host "==> تم توحيد الإصدار v$ver في كل مكان." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}
catch {
    Write-Host ""
    Write-Host "[X] bump-version.ps1 فشل: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    الـ commit هيكمل عادي من غير تحديث الإصدار." -ForegroundColor Yellow
    Write-Host "    شغّل ./bump-version.ps1 يدويًا وتأكد إنه يعدي قبل الرفع القادم." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
