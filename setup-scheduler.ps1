# ============================================================
# setup-scheduler.ps1
# Đăng ký Windows Task Scheduler để tự động chạy update:all
# Lịch: 7:00 AM và 22:00 PM mỗi ngày
#
# Cách chạy (mở PowerShell với quyền Admin):
#   .\setup-scheduler.ps1
# ============================================================

$ErrorActionPreference = "Stop"

# ── Cấu hình ──
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodePath   = (Get-Command node -ErrorAction SilentlyContinue).Source
$ScriptPath = Join-Path $ProjectDir "src\update-all.js"
$LogDir     = Join-Path $ProjectDir "logs"
$TaskName1  = "SunoCookieUpdater_Morning"
$TaskName2  = "SunoCookieUpdater_Night"

# Tạo thư mục log
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# Kiểm tra Node.js
if (!$NodePath) {
    Write-Host "❌ Không tìm thấy Node.js! Vui lòng cài Node.js trước." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   SUNO COOKIE UPDATER - SETUP TASK SCHEDULER    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "📁 Thư mục dự án: $ProjectDir" -ForegroundColor White
Write-Host "🟢 Node.js: $NodePath" -ForegroundColor White
Write-Host "📝 Script: $ScriptPath" -ForegroundColor White
Write-Host ""

# ── Lệnh chạy (dùng cmd để chạy node và ghi log) ──
$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$NodePath`" `"$ScriptPath`" >> `"$LogDir\update.log`" 2>&1" `
    -WorkingDirectory $ProjectDir

# ── Trigger 1: 7:00 AM mỗi ngày ──
$Trigger1 = New-ScheduledTaskTrigger -Daily -At "07:00"

# ── Trigger 2: 22:00 PM mỗi ngày ──
$Trigger2 = New-ScheduledTaskTrigger -Daily -At "22:00"

# ── Cài đặt: chạy dù không ai đăng nhập, quyền cao nhất ──
$Settings = New-ScheduledTaskSettingsSet `
    -RunOnlyIfNetworkAvailable `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

# ── Đăng ký Task 1 (Sáng 7h) ──
Write-Host "⏰ Đang đăng ký task 7:00 AM..." -ForegroundColor Blue
try {
    Unregister-ScheduledTask -TaskName $TaskName1 -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask `
        -TaskName $TaskName1 `
        -Action $Action `
        -Trigger $Trigger1 `
        -Settings $Settings `
        -Description "Suno Cookie Updater - Chạy lúc 7:00 AM hàng ngày" `
        -RunLevel Highest `
        | Out-Null
    Write-Host "  ✅ Đã đăng ký: $TaskName1 (7:00 AM)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Lỗi đăng ký task sáng: $_" -ForegroundColor Red
}

# ── Đăng ký Task 2 (Tối 22h) ──
Write-Host "⏰ Đang đăng ký task 22:00 PM..." -ForegroundColor Blue
try {
    Unregister-ScheduledTask -TaskName $TaskName2 -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask `
        -TaskName $TaskName2 `
        -Action $Action `
        -Trigger $Trigger2 `
        -Settings $Settings `
        -Description "Suno Cookie Updater - Chạy lúc 22:00 PM hàng ngày" `
        -RunLevel Highest `
        | Out-Null
    Write-Host "  ✅ Đã đăng ký: $TaskName2 (22:00 PM)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Lỗi đăng ký task tối: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║           ✅ CÀI ĐẶT THÀNH CÔNG!                ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "📅 Lịch chạy:" -ForegroundColor White
Write-Host "   • 07:00 AM mỗi ngày → fetch cookie → cập nhật Spring Boot" -ForegroundColor Gray
Write-Host "   • 22:00 PM mỗi ngày → fetch cookie → cập nhật Spring Boot" -ForegroundColor Gray
Write-Host "   • Telegram sẽ báo cáo kết quả mỗi lần chạy" -ForegroundColor Gray
Write-Host ""
Write-Host "📝 Log được lưu tại: $LogDir\update.log" -ForegroundColor Yellow
Write-Host ""
Write-Host "💡 Để xem các task đã đăng ký, mở Task Scheduler và tìm:" -ForegroundColor Yellow
Write-Host "   - $TaskName1" -ForegroundColor Gray
Write-Host "   - $TaskName2" -ForegroundColor Gray
Write-Host ""
Write-Host "💡 Để chạy thủ công ngay bây giờ:" -ForegroundColor Yellow
Write-Host "   npm run update:all" -ForegroundColor Cyan
Write-Host ""
