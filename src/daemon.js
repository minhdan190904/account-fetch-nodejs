'use strict';

/**
 * ════════════════════════════════════════════════════════
 *  daemon.js - Dịch vụ chạy ngầm, refresh token mỗi 55 phút
 * ════════════════════════════════════════════════════════
 *
 *  Cách hoạt động:
 *   - Không mở trình duyệt
 *   - Chỉ gọi 2 HTTP request đến Clerk API
 *   - Refresh __session mới → push vào Spring Boot
 *   - Lặp lại mỗi 55 phút → KHÔNG BAO GIỜ có time chết
 *
 *  Cách chạy:
 *   node src/daemon.js          (chạy foreground, thấy log)
 *   npm run daemon              (như trên)
 *   npm run daemon:bg           (chạy nền - Windows)
 * ════════════════════════════════════════════════════════
 */

require('dotenv').config();
const chalk = require('chalk');
const { getAccounts, saveClientToken, updateAccountStatus, saveCookieResult } = require('./lib/account-store');
const { refreshSessionToken } = require('./lib/clerk-refresh');
const { pushCookieToSpringBoot } = require('./lib/spring-push');
const { sendTelegram, buildSummaryMessage } = require('./lib/telegram');

// Refresh mỗi 30 phút
// Vì sao 30 phút?
//   - Clerk cache token cũ nếu còn hạn → không cấp mới
//   - Token sống 60 phút → daemon 30 phút đảm bảo luôn có token tươi
//   - Lần chạy đúng lúc token expire → Clerk cấp token MỚI ngay
const REFRESH_INTERVAL_MS    = 30 * 60 * 1000;
const REFRESH_INTERVAL_LABEL = '30 phút';

let isRunning = false;
let cycleCount = 0;

function now() {
  return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function log(msg) {
  console.log(`[${now()}] ${msg}`);
}

/**
 * Refresh token cho 1 tài khoản bằng HTTP (không cần browser)
 */
async function refreshOneAccount(account) {
  const { name, email, clientToken } = account;

  if (!clientToken) {
    return {
      name, email,
      success: false,
      springBootUpdated: false,
      error: 'Chưa có __client token! Cần login lại bằng: npm run add-account',
    };
  }

  const result = { name, email, success: false, springBootUpdated: false, data: null, error: null };

  try {
    // ── Bước 1: Gọi Clerk API lấy __session mới (HTTP thuần, không mở Chrome) ──
    const tokenData = await refreshSessionToken(clientToken);

    result.success = true;
    result.data = tokenData;

    log(chalk.green(`  ✅ ${name}: Token mới - còn ${tokenData.minutesLeft} phút`));

    // ── Bước 2: Lưu vào output/cookies.json ──
    await saveCookieResult({
      profileName: name,
      email,
      fetchedAt: new Date().toISOString(),
      isLoggedIn: true,
      session: tokenData.jwt,
      cookieString: `__session=${tokenData.jwt}`,
      clientApiVersion: 'via-clerk-api',
    });

    await updateAccountStatus(name, 'active', new Date().toISOString());

    // ── Bước 3: Push vào Spring Boot ──
    if (email) {
      // Spring Boot cần cookie string đầy đủ (có __client)
      const fullCookieString = `__session=${tokenData.jwt}; __client=${clientToken}`;
      const springOk = await pushCookieToSpringBoot(email, fullCookieString);
      result.springBootUpdated = springOk;

      if (springOk) {
        log(chalk.green(`  🗄️  ${name}: Spring Boot DB ✅`));
      } else {
        log(chalk.red(`  🗄️  ${name}: Spring Boot ❌ (xem log)`));
      }
    } else {
      log(chalk.yellow(`  ⚠️  ${name}: Chưa có email → bỏ qua Spring Boot`));
    }

  } catch (err) {
    result.error = err.message;

    // Nếu lỗi do __client hết hạn hoặc session bị đăng xuất → đánh dấu error
    if (err.message.includes('active session') || err.message.includes('401') || err.message.includes('403')) {
      await updateAccountStatus(name, 'error').catch(() => {});
      log(chalk.red(`  ❌ ${name}: Session hết hạn! Cần login lại: npm run add-account`));
      await sendTelegram(
        `❌ <b>${name}</b> (${email || 'no email'})\nSession hết hạn! Cần login lại.\n<code>npm run add-account</code>`
      ).catch(() => {});
    } else {
      log(chalk.red(`  ❌ ${name}: ${err.message}`));
    }
  }

  return result;
}

/**
 * Chạy 1 chu kỳ refresh cho tất cả tài khoản
 */
async function runRefreshCycle() {
  if (isRunning) {
    log(chalk.yellow('⚠️  Chu kỳ trước chưa xong, bỏ qua lần này...'));
    return;
  }

  isRunning = true;
  cycleCount++;

  log(chalk.cyan(`\n${'─'.repeat(55)}`));
  log(chalk.cyan(`🔄 Chu kỳ refresh #${cycleCount} bắt đầu`));
  log(chalk.cyan(`${'─'.repeat(55)}`));

  const accounts = await getAccounts();
  const activeAccounts = accounts.filter((a) => a.clientToken);

  if (activeAccounts.length === 0) {
    log(chalk.yellow('⚠️  Không có tài khoản nào có __client token!'));
    log(chalk.yellow('💡 Chạy: npm run add-account'));
    isRunning = false;
    return;
  }

  log(chalk.white(`📋 Refresh ${activeAccounts.length}/${accounts.length} tài khoản...\n`));

  const results = [];
  for (const account of activeAccounts) {
    log(chalk.blue(`▶ ${account.name} (${account.email || 'no email'})`));
    const result = await refreshOneAccount(account);
    results.push(result);

    // Delay nhỏ giữa các tài khoản
    if (activeAccounts.indexOf(account) < activeAccounts.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  log(chalk.cyan(`\n${'─'.repeat(55)}`));
  log(chalk.cyan(`✅ Xong: ${successCount} OK | ❌ Lỗi: ${failCount}`));
  log(chalk.cyan(`⏰ Refresh tiếp theo sau: ${REFRESH_INTERVAL_LABEL}`));
  log(chalk.cyan(`${'─'.repeat(55)}\n`));

  // Gửi Telegram nếu có lỗi (không gửi khi thành công để tránh spam)
  if (failCount > 0) {
    const summary = { total: accounts.length, success: successCount, fail: failCount };
    await sendTelegram(buildSummaryMessage(results, summary)).catch(() => {});
  }

  isRunning = false;
}

/**
 * Bắt đầu daemon
 */
async function startDaemon() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║     🚀 SUNO COOKIE DAEMON - HTTP REFRESH MODE        ║'));
  console.log(chalk.cyan('╠══════════════════════════════════════════════════════╣'));
  console.log(chalk.cyan(`║  ⏰ Khởi động: ${now().padEnd(37)}║`));
  console.log(chalk.cyan(`║  🔁 Refresh mỗi: ${REFRESH_INTERVAL_LABEL.padEnd(35)}║`));
  console.log(chalk.cyan('║  ✅ KHÔNG mở trình duyệt - chỉ HTTP thuần            ║'));
  console.log(chalk.cyan('║  📱 Telegram báo cáo khi có lỗi                      ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════════╝\n'));

  // Thông báo Telegram khi daemon khởi động
  await sendTelegram(
    `🚀 <b>Suno Cookie Daemon</b> đã khởi động!\n⏰ ${now()}\n🔁 Refresh mỗi ${REFRESH_INTERVAL_LABEL} (HTTP, không cần browser)`
  ).catch(() => {});

  // Chạy ngay lần đầu tiên
  await runRefreshCycle();

  // Lặp lại mỗi 55 phút
  setInterval(runRefreshCycle, REFRESH_INTERVAL_MS);

  log(chalk.green('🟢 Daemon đang chạy ngầm... Nhấn Ctrl+C để dừng.\n'));
}

// Xử lý tắt daemon
process.on('SIGINT', async () => {
  log(chalk.yellow('\n⏹️  Đang dừng daemon...'));
  await sendTelegram('⏹️ <b>Suno Cookie Daemon</b> đã dừng.').catch(() => {});
  process.exit(0);
});

process.on('uncaughtException', async (err) => {
  log(chalk.red(`\n💥 Lỗi không xử lý được: ${err.message}`));
  await sendTelegram(`💥 <b>Daemon crash!</b>\n<code>${err.message}</code>`).catch(() => {});
  // Không exit - để daemon tự phục hồi ở chu kỳ tiếp theo
});

startDaemon().catch(async (err) => {
  log(chalk.red(`💥 Không thể khởi động daemon: ${err.message}`));
  await sendTelegram(`💥 Daemon không khởi động được!\n<code>${err.message}</code>`).catch(() => {});
  process.exit(1);
});
