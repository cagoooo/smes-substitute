# scripts/bump-version.ps1
param (
    [string]$notes = ""
)

# Get current date in yyyy.MM.dd format
$today = Get-Date -Format "yyyy.MM.dd"
$newVersion = ""

# 1. Read current version and determine new version
$versionFile = "docs/version.json"
if (Test-Path $versionFile) {
    $json = Get-Content $versionFile -Raw | ConvertFrom-Json
    $currentVersion = $json.version
    if ($currentVersion -match "^(\d{4}\.\d{2}\.\d{2})-(\d+)$") {
        $datePart = $Matches[1]
        $numPart = [int]$Matches[2]
        
        if ($datePart -eq $today) {
            $nextNum = $numPart + 1
            $newVersion = "$today-$nextNum"
        } else {
            $newVersion = "$today-1"
        }
    } else {
        $newVersion = "$today-1"
    }
} else {
    $newVersion = "$today-1"
}

Write-Host "🚀 Preparing to bump version to: $newVersion" -ForegroundColor Cyan

# 2. Determine update notes
if ([string]::IsNullOrEmpty($notes)) {
    # If not provided via param, ask interactively
    $notes = Read-Host "📝 Enter update notes (in English or Chinese)"
    if ([string]::IsNullOrEmpty($notes)) {
        $notes = "Routine update and optimization"
    }
}

# 3. Replace version in docs/index.html
$indexPath = "docs/index.html"
if (Test-Path $indexPath) {
    $indexContent = Get-Content $indexPath -Encoding UTF8 -Raw
    $indexContent = $indexContent -replace "var APP_VERSION='[^']+';", "var APP_VERSION='$newVersion';"
    $indexContent = $indexContent -replace "og-preview.png\?v=[^`"]*", "og-preview.png?v=$newVersion"
    $indexContent = $indexContent -replace "twitter:image.*og-preview.png\?v=[^`"]*", "og-preview.png?v=$newVersion"
    [System.IO.File]::WriteAllText($indexPath, $indexContent, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "✓ index.html version updated." -ForegroundColor Green
}

# 4. Replace version in docs/sw.js
$swPath = "docs/sw.js"
if (Test-Path $swPath) {
    $swContent = Get-Content $swPath -Encoding UTF8 -Raw
    $swContent = $swContent -replace "const BUILD_VERSION = '[^']+';", "const BUILD_VERSION = '$newVersion';"
    [System.IO.File]::WriteAllText($swPath, $swContent, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "✓ sw.js version updated." -ForegroundColor Green
}

# 5. Update docs/version.json
$newJson = @{
    version = $newVersion
    notes = $notes
} | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($versionFile, $newJson, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "✓ version.json updated." -ForegroundColor Green

# 6. Key safety scan
Write-Host "🔍 Scanning for API Key leaks..." -ForegroundColor Yellow
$found = @()
$pattern = [regex]"AIzaSy[0-9A-Za-z_-]{33}"
Get-ChildItem -Path . -Recurse -Include *.html,*.js,*.json,*.md,*.py,*.yml | Where-Object { $_.FullName -notmatch "\\\.git" -and $_.FullName -notmatch "\\node_modules" } | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match $pattern) {
        $found += $_.FullName
    }
}

if ($found.Count -gt 0) {
    Write-Error "⚠️ API Key leak detected! Aborting deployment."
    $found | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host "✅ No API Key leaks found." -ForegroundColor Green

# 7. Git commit & push
Write-Host "📦 Git commit and push..." -ForegroundColor Yellow

# Use Unicode code points for "✅升級 PWA 版本號為" to prevent script encoding issues in PowerShell 5.1
$prefix = "$([char]0x2705)$([char]0x5347)$([char]0x7d1a) PWA $([char]0x7248)$([char]0x672c)$([char]0x865f)$([char]0x70ba)"
$commitMsg = "$prefix $newVersion ($notes)"

# Write commit message directly to a UTF-8 file (without BOM for git compatibility)
# Using .NET File API to ensure pure UTF-8 encoding
[System.IO.File]::WriteAllText("temp_commit_msg.txt", $commitMsg, [System.Text.Encoding]::UTF8)

git add .
# Commit using the message file
git commit -F temp_commit_msg.txt

# Clean up temporary file
if (Test-Path "temp_commit_msg.txt") {
    Remove-Item "temp_commit_msg.txt"
}

$env:GITHUB_TOKEN = "" # Clear invalid Token
git push

Write-Host "🎉 Version bump and push successful! Deployment starts in seconds." -ForegroundColor Green
