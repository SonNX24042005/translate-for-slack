# Script cài đặt tiện ích Translate for Slack trên Windows
[CmdletBinding()]
param (
    [string]$RepoUrl = "https://github.com/SonNX24042005/translate-for-slack.git",
    [string]$ZipUrl = "https://github.com/SonNX24042005/translate-for-slack/archive/refs/heads/main.zip",
    [string]$InstallDir = "$HOME\Downloads\translate-for-slack"
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Cài đặt tiện ích Translate for Slack" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Chọn trình duyệt
Write-Host "Chọn trình duyệt bạn muốn cài đặt tiện ích:"
Write-Host "  1) Cốc Cốc"
Write-Host "  2) Google Chrome"
Write-Host "  3) Microsoft Edge"
Write-Host "  4) Brave"
Write-Host "  5) Mở trình duyệt mặc định"
Write-Host ""
$choice = Read-Host "Nhập lựa chọn của bạn (1-5) [mặc định: 1]"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }

$extensionsUrl = "chrome://extensions"
$browserPath = ""

switch ($choice) {
    "1" {
        $extensionsUrl = "coccoc://extensions"
        $coccocPaths = @(
            "$env:LOCALAPPDATA\CocCoc\Browser\Application\browser.exe",
            "$env:ProgramFiles\CocCoc\Browser\Application\browser.exe",
            "${env:ProgramFiles(x86)}\CocCoc\Browser\Application\browser.exe"
        )
        foreach ($p in $coccocPaths) {
            if (Test-Path $p) { $browserPath = $p; break }
        }
    }
    "2" {
        $extensionsUrl = "chrome://extensions"
        $chromePaths = @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
        foreach ($p in $chromePaths) {
            if (Test-Path $p) { $browserPath = $p; break }
        }
    }
    "3" {
        $extensionsUrl = "edge://extensions"
        $edgePaths = @(
            "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
        )
        foreach ($p in $edgePaths) {
            if (Test-Path $p) { $browserPath = $p; break }
        }
    }
    "4" {
        $extensionsUrl = "brave://extensions"
        $bravePaths = @(
            "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
            "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
            "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
        )
        foreach ($p in $bravePaths) {
            if (Test-Path $p) { $browserPath = $p; break }
        }
    }
    default {
        $extensionsUrl = "chrome://extensions"
    }
}

# 2. Tải mã nguồn tiện ích từ kho lưu trữ
Write-Host ""
Write-Host "→ Đang tải mã nguồn từ kho lưu trữ..." -ForegroundColor Yellow

$parentDir = Split-Path -Path $InstallDir -Parent
if (-not (Test-Path $parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}

$hasGit = (Get-Command git -ErrorAction SilentlyContinue) -ne $null

if (Test-Path "$InstallDir\.git") {
    Write-Host "• Thư mục đã tồn tại, tiến hành cập nhật bản mới nhất..." -ForegroundColor Gray
    git -C "$InstallDir" pull --ff-only
} elseif (Test-Path $InstallDir) {
    Write-Host "• Thư mục $InstallDir đã tồn tại." -ForegroundColor Gray
} else {
    if ($hasGit) {
        Write-Host "• Sử dụng git clone để tải mã nguồn..." -ForegroundColor Gray
        git clone "$RepoUrl" "$InstallDir"
    } else {
        Write-Host "• Tải tệp nén zip và giải nén..." -ForegroundColor Gray
        $tempZip = Join-Path $env:TEMP "translate-for-slack-main.zip"
        $tempExtract = Join-Path $env:TEMP "tfs_extract_$(Get-Random)"
        Invoke-WebRequest -Uri $ZipUrl -OutFile $tempZip
        Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
        $innerDir = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
        Move-Item -Path $innerDir.FullName -Destination $InstallDir -Force
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "✓ Mã nguồn đã sẵn sàng tại: $InstallDir" -ForegroundColor Green

# 3. Sao chép link trang tiện ích vào clipboard
try {
    Set-Clipboard -Value $extensionsUrl
    $copied = $true
} catch {
    $copied = $false
}

# 4. Mở trình duyệt
Write-Host ""
Write-Host "→ Đang mở trình duyệt..." -ForegroundColor Yellow
if (-not [string]::IsNullOrEmpty($browserPath) -and (Test-Path $browserPath)) {
    Start-Process -FilePath $browserPath
} else {
    Start-Process "about:blank"
}

# 5. Hướng dẫn người dùng hoàn tất
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "                  HƯỚNG DẪN HOÀN TẤT CÀI ĐẶT" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
if ($copied) {
    Write-Host "✓ Đã tự động sao chép link trang tiện ích vào clipboard:" -ForegroundColor Green
    Write-Host "  >>  $extensionsUrl" -ForegroundColor Yellow
    Write-Host "  (Chỉ cần nhấn Ctrl+V vào thanh địa chỉ của trình duyệt rồi bấm Enter)" -ForegroundColor White
} else {
    Write-Host "• Hãy nhập hoặc dán địa chỉ sau vào thanh URL của trình duyệt:" -ForegroundColor White
    Write-Host "  >>  $extensionsUrl" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "ĐƯỜNG DẪN THƯ MỤC CÀI ĐẶT (ĐỂ CHỌN HOẶC SAO CHÉP):" -ForegroundColor White
Write-Host ""
Write-Host "  +-------------------------------------------------------------+" -ForegroundColor Yellow
Write-Host "  |  $InstallDir" -ForegroundColor Green
Write-Host "  +-------------------------------------------------------------+" -ForegroundColor Yellow
Write-Host ""
Write-Host "CÁC BƯỚC THỰC HIỆN TRÊN TRÌNH DUYỆT:" -ForegroundColor White
Write-Host "  1. Trên trang tiện ích, gạt bật 'Chế độ dành cho nhà phát triển' (Developer mode) ở góc trên bên phải." -ForegroundColor White
Write-Host "  2. Nhấn nút 'Tải tiện ích đã giải nén' (Load unpacked) ở góc trên bên trái." -ForegroundColor White
Write-Host "  3. Chọn thư mục được đóng khung ở trên." -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Hoàn tất! Extension Translate for Slack đã sẵn sàng hoạt động." -ForegroundColor Green
