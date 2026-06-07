'use strict';

/**
 * ════════════════════════════════════════════════════════
 *  scheduler.js - Tự động fetch cookie mỗi 45 phút
 * ════════════════════════════════════════════════════════
 *
 *  Cách hoạt động:
 *   - Mở Chrome (Playwright) cho từng tài khoản
 *   - Lấy __session cookie mới (token sống 60 phút)
 *   - Push vào Spring Boot DB kèm credits
 *   - Lặp lại mỗi 45 phút → luôn có token còn ~15 phút đệm
 *
 *  Cách chạy:
 *   npm run scheduler        (chạy foreground)
 *   npm run scheduler:bg     (chạy nền - Windows)
 * ════════════════════════════════════════════════════════
 */

require('dotenv').config();
const chalk = require('chalk');
const { getAccounts, updateAccountStatus, saveCookieResult, saveClientToken } = require('./lib/account-store');
const { fetchCookiesForAccount } = require('./lib/cookie-fetcher');
const { pushCookieToSpringBoot } = require('./lib/spring-push');
const { sendTelegram, buildSummaryMessage } = require('./lib/telegram');

// ─── Cấu hình ───────────────────────────────────────────
// Token sống 60 phút → fetch lại sau 45 phút (đệm 15 phút)
const INTERVAL_MINUTES = 45;
const INTERVAL_MS      = INTERVAL_MINUTES * 60 * 1000;
const HEADLESS         = process.env.HEADLESS !== 'false';
// ────────────────────────────────────────────────────────

let cycleCount = 0;
let isRunning  = false;

function now() {
  return new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function nextRunTime() {
  const d = new Date(Date.now() + INTERVAL_MS);
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/**
 * Fetch cookie cho 1 tài khoản rồi push lên Spring Boot
 */
async function fetchAndPushOne(account) {
  const { name, email } = account;
  const result = { name, email, success: false, springBootUpdated: false, data: null, error: null };

  try {
    // Lấy cookie bằng Playwright
    const cookieData = await fetchCookiesForAccount(name, HEADLESS);
    cookieData.email  = email;

    if (!cookieData.isLoggedIn) {
      result.error = 'Không có __session → cần login lại!';
      await updateAccountStatus(name, 'error');
      return result;
    }

    result.success = true;
    result.data    = cookieData;

    // Lưu local
    await saveCookieResult(cookieData);
    await updateAccountStatus(name, 'active', cookieData.fetchedAt);

    // Lưu __client nếu có (để tham khảo sau)
    if (cookieData.clientToken) {
      await saveClientToken(name, cookieData.clientToken);
    }

    // Hiển thị thời gian hết hạn
    const { decodeJwtExp } = require('./lib/utils');
    const expiresAt = decodeJwtExp(cookieData.session);
    if (expiresAt) {
      const minutesLeft = Math.floor((expiresAt - Date.now() / 1000) / 60);
      console.log(chalk.green(`  ✅ ${name}: token còn ${minutesLeft} phút (hết lúc ${new Date(expiresAt * 1000).toLocaleTimeString('vi-VN')})`));
    } else {
      console.log(chalk.green(`  ✅ ${name}: lấy cookie thành công`));
    }

    // Push lên Spring Boot (kèm credits nếu lấy được)
    if (email) {
      const cookieToSend = cookieData.cookieString || cookieData.session;
      const springOk = await pushCookieToSpringBoot(email, cookieToSend, cookieData.creditsLeft);
      result.springBootUpdated = springOk;
      const creditsInfo = cookieData.creditsLeft !== null ? ` (${cookieData.creditsLeft} credits)` : '';
      console.log(chalk.green(`     Spring Boot: ${springOk ? '✅ OK' : '❌ Lỗi'}${creditsInfo}`));
    } else {
      console.log(chalk.yellow(`  ⚠️  ${name}: chưa có email → bỏ qua Spring Boot`));
    }

  } catch (err) {
    result.error = err.message;
    console.log(chalk.red(`  ❌ ${name}: ${err.message}`));
    await updateAccountStatus(name, 'error').catch(() => {});
  }

  return result;
}

/**
 * Chạy 1 chu kỳ fetch cho tất cả tài khoản
 */
async function runFetchCycle() {
  if (isRunning) {
    console.log(chalk.yellow(`[${now()}] ⚠️  Chu kỳ trước chưa xong, bỏ qua...`));
    return;
  }

  isRunning = true;
  cycleCount++;

  console.log(chalk.cyan(`\n${'═'.repeat(56)}`));
  console.log(chalk.cyan(`  🔄 Chu kỳ #${cycleCount} — ${now()}`));
  console.log(chalk.cyan(`${'═'.repeat(56)}\n`));

  const accounts = await getAccounts();

  if (accounts.length === 0) {
    console.log(chalk.yellow('  ⚠️  Chưa có tài khoản! Chạy: npm run add-account'));
    await sendTelegram('⚠️ Scheduler: Không có tài khoản nào!').catch(() => {});
    isRunning = false;
    return;
  }

  console.log(chalk.white(`  📋 ${accounts.length} tài khoản\n`));

  const results = [];
  for (const account of accounts) {
    console.log(chalk.blue(`  ▶ ${account.name} (${account.email || 'no email'})`));
    const r = await fetchAndPushOne(account);
    results.push(r);

    // Delay nhỏ giữa các tài khoản
    if (accounts.indexOf(account) < accounts.length - 1) {
      await new Promise(res => setTimeout(res, 2000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount    = results.filter(r => !r.success).length;

  console.log(chalk.cyan(`\n${'─'.repeat(56)}`));
  console.log(chalk.cyan(`  ✅ OK: ${successCount}  ❌ Lỗi: ${failCount}`));
  console.log(chalk.cyan(`  ⏰ Lần tiếp theo: ${nextRunTime()}`));
  console.log(chalk.cyan(`${'─'.repeat(56)}\n`));

  // Telegram: luôn gửi tóm tắt sau mỗi chu kỳ
  if (failCount > 0) {
    const summary = { total: accounts.length, success: successCount, fail: failCount };
    await sendTelegram(buildSummaryMessage(results, summary)).catch(() => {});
  } else {
    // Thành công toàn bộ → gửi tóm tắt nhẹ kèm credits
    const lines = results
      .filter(r => r.success)
      .map(r => {
        const credits = r.data?.creditsLeft !== null && r.data?.creditsLeft !== undefined
          ? ` — ${r.data.creditsLeft} credits`
          : '';
        return `• ${r.name}${credits}`;
      })
      .join('\n');
    const msg = `✅ <b>Cập nhật cookie thành công!</b>\n${lines}\n⏰ Lần tiếp: ${nextRunTime()}`;
    await sendTelegram(msg).catch(() => {});
  }

  isRunning = false;
}

/**
 * Khởi động scheduler
 */
async function start() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║       🕐 SUNO COOKIE SCHEDULER                       ║'));
  console.log(chalk.cyan('╠══════════════════════════════════════════════════════╣'));
  console.log(chalk.cyan(`║  Khởi động : ${now().padEnd(39)}║`));
  console.log(chalk.cyan(`║  Chu kỳ   : Mỗi ${INTERVAL_MINUTES} phút (token sống 60p, đệm 15p) ║`));
  console.log(chalk.cyan(`║  Chế độ   : ${HEADLESS ? 'Headless (ẩn Chrome)' : 'Hiện Chrome   '}${''.padEnd(HEADLESS ? 20 : 21)}║`));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════════╝\n'));

  await sendTelegram(
    `🕐 <b>Suno Scheduler</b> khởi động!\n⏰ ${now()}\n🔁 Fetch cookie mỗi <b>${INTERVAL_MINUTES} phút</b>`
  ).catch(() => {});

  // Chạy ngay lần đầu
  await runFetchCycle();

  // Lặp mỗi 50 phút
  setInterval(runFetchCycle, INTERVAL_MS);

  console.log(chalk.green('🟢 Đang chạy... Nhấn Ctrl+C để dừng.\n'));
}

process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n⏹️  Đang dừng...'));
  await sendTelegram('⏹️ <b>Suno Scheduler</b> đã dừng.').catch(() => {});
  process.exit(0);
});

process.on('uncaughtException', err => {
  console.error(chalk.red(`\n💥 Lỗi: ${err.message}`));
  sendTelegram(`💥 <b>Scheduler lỗi!</b>\n<code>${err.message}</code>`).catch(() => {});
  // Không exit, chờ chu kỳ tiếp theo tự phục hồi
});

start().catch(async err => {
  console.error(chalk.red(`💥 Không khởi động được: ${err.message}`));
  await sendTelegram(`💥 Scheduler không khởi động!\n<code>${err.message}</code>`).catch(() => {});
  process.exit(1);
});
