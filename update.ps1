[CmdletBinding()]
param (
    [string]$InstallDir,
    [string]$ZipUrl = "https://github.com/SonNX24042005/translate-for-slack/archive/refs/heads/main.zip"
)

$ErrorActionPreference = "Stop"
$defaultDir = Join-Path $env:LOCALAPPDATA "translate-for-slack"
$legacyDir = Join-Path (Join-Path $HOME "Downloads") "translate-for-slack"

if ($InstallDir) {
    $targetDir = $InstallDir
} elseif (Test-Path -LiteralPath $defaultDir -PathType Container) {
    $targetDir = $defaultDir
} elseif (Test-Path -LiteralPath $legacyDir -PathType Container) {
    $targetDir = $legacyDir
    Write-Host "Đang cập nhật bản cài cũ trong Downloads để giữ nguyên tiện ích đã tải vào trình duyệt."
} else {
    throw "Không tìm thấy tiện ích đã cài. Hãy chạy lệnh cài đặt trước."
}

if (-not (Test-Path -LiteralPath (Join-Path $targetDir "manifest.json") -PathType Leaf)) {
    throw "Thư mục không chứa tiện ích Translate for Slack: $targetDir"
}

Write-Host "Đang cập nhật: $targetDir"
if (Test-Path -LiteralPath (Join-Path $targetDir ".git")) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Cần cài Git để cập nhật bản cài bằng Git."
    }
    git -C "$targetDir" pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "Git không thể cập nhật bản cài." }
} else {
    $parentDir = Split-Path -Path $targetDir -Parent
    $workDir = Join-Path $parentDir (".tfs-update." + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $workDir | Out-Null
    $keepBackup = $false
    try {
        $zipPath = Join-Path $workDir "latest.zip"
        $extractDir = Join-Path $workDir "extracted"
        Invoke-WebRequest -Uri $ZipUrl -OutFile $zipPath
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir
        $newDir = Join-Path $extractDir "translate-for-slack-main"
        if (-not (Test-Path -LiteralPath (Join-Path $newDir "manifest.json") -PathType Leaf)) {
            throw "Bản tải về không hợp lệ; bản đang dùng chưa bị thay đổi."
        }
        $backupDir = Join-Path $workDir "backup"
        Move-Item -LiteralPath $targetDir -Destination $backupDir
        $keepBackup = $true
        try {
            Move-Item -LiteralPath $newDir -Destination $targetDir
            $keepBackup = $false
        } catch {
            try {
                Move-Item -LiteralPath $backupDir -Destination $targetDir
                $keepBackup = $false
            } catch {
                throw "Không thể khôi phục tự động; bản cũ được giữ tại: $backupDir"
            }
            throw "Cập nhật thất bại; đã khôi phục bản cũ. $($_.Exception.Message)"
        }
    } finally {
        if (-not $keepBackup) {
            Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "Đã cập nhật tại: $targetDir"
Write-Host "Mở trang quản lý tiện ích trong trình duyệt, nhấn Tải lại cho Translate for Slack, rồi tải lại các trang Slack đang mở."
