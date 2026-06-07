'use strict';

/**
 * ====================================================
 *  UPDATE ALL - Lệnh "thần thánh" 1 nhấn
 * ====================================================
 *  Thực hiện tuần tự:
 *   1. Dùng Playwright lấy cookie mới cho TẤT CẢ tài khoản
 *   2. Lưu vào output/cookies.json
 *   3. Đẩy cookie mới vào Spring Boot DB (theo email)
 *   4. Gửi báo cáo tổng kết qua Telegram
 *
 *  Cách chạy:
 *   npm run update:all
 *   node src/update-all.js
 * ====================================================
 */

require('dotenv').config();
const chalk = require('chalk');
const { getAccounts, updateAccountStatus, saveCookieResult, saveClientToken } = require('./lib/account-store');
const { fetchCookiesForAccount } = require('./lib/cookie-fetcher');
const { pushCookieToSpringBoot } = require('./lib/spring-push');
const { sendTelegram, buildSummaryMessage } = require('./lib/telegram');

const HEADLESS = process.env.HEADLESS !== 'false';
const TARGET   = process.argv[2] || null; // VD: node src/update-all.js tk_1

async function main() {
  const startTime = Date.now();

  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║     🔄 SUNO COOKIE UPDATER - UPDATE ALL          ║'));
  console.log(chalk.cyan('╠══════════════════════════════════════════════════╣'));
  console.log(chalk.cyan(`║  ⏰ ${new Date().toLocaleString('vi-VN').padEnd(43)}║`));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════╝\n'));

  let accounts = await getAccounts();

  if (accounts.length === 0) {
    console.log(chalk.yellow('⚠️  Chưa có tài khoản nào! Chạy "npm run add-account" để thêm.\n'));
    await sendTelegram('⚠️ <b>Suno Updater</b>: Không có tài khoản nào để cập nhật!');
    process.exit(0);
  }

  // Lọc 1 tài khoản nếu có truyền tên
  if (TARGET) {
    accounts = accounts.filter(a => a.name === TARGET);
    if (accounts.length === 0) {
      console.log(chalk.red(`❌ Không tìm thấy tài khoản: "${TARGET}"\n`));
      process.exit(1);
    }
    console.log(chalk.yellow(`🎯 Chỉ update: ${chalk.cyan(TARGET)}\n`));
  } else {
    console.log(chalk.white(`📋 Tìm thấy ${chalk.cyan(accounts.length)} tài khoản\n`));
  }

  const results = [];

  for (const account of accounts) {
    const { name, email } = account;
    console.log(chalk.blue(`\n──────────────────────────────────────`));
    console.log(chalk.blue(`▶ Đang xử lý: ${chalk.cyan(name)} (${email || 'chưa có email'})`));
    console.log(chalk.blue(`──────────────────────────────────────`));

    const result = { name, email, success: false, springBootUpdated: false, data: null, error: null };

    // ── BƯỚC 1: Lấy cookie bằng Playwright ──
    try {
      console.log('  🌐 Bước 1/3: Lấy cookie từ Suno...');
      const cookieData = await fetchCookiesForAccount(name, HEADLESS);
      cookieData.email = email;

      if (!cookieData.isLoggedIn) {
        result.error = 'Không có __session cookie - Cần đăng nhập lại!';
        console.log(chalk.red(`  ❌ ${result.error}`));
        await updateAccountStatus(name, 'error');
        results.push(result);
        continue;
      }

      result.success = true;
      result.data = cookieData;

      const sessionPreview = cookieData.session?.substring(0, 20) + '...';
      console.log(chalk.green(`  ✅ Lấy cookie thành công!`));
      console.log(chalk.gray(`     Session: ${sessionPreview}`));
      console.log(chalk.gray(`     API Ver: ${cookieData.clientApiVersion}`));

      // ── BƯỚC 2: Lưu local + lưu __client token ──
      console.log('  💾 Bước 2/3: Lưu vào output/cookies.json...');
      await saveCookieResult(cookieData);
      await updateAccountStatus(name, 'active', cookieData.fetchedAt);

      // ✅ Lưu __client (Refresh Token) để daemon dùng sau
      if (cookieData.clientToken) {
        await saveClientToken(name, cookieData.clientToken);
        console.log(chalk.green('  ✅ Đã lưu Refresh Token (__client)!'));
      }

      // ── BƯỚC 3: Push lên Spring Boot ──
      console.log('  🚀 Bước 3/3: Đẩy vào Spring Boot DB...');
      if (!email) {
        console.log(chalk.yellow('  ⚠️  Tài khoản chưa có email → bỏ qua push Spring Boot'));
        console.log(chalk.yellow('  💡 Chạy lại "npm run add-account" và nhập email để kích hoạt!'));
      } else {
        // Dùng cookieString (chuỗi đầy đủ) nếu có, nếu không thì dùng session
        const cookieToSend = cookieData.cookieString || cookieData.session;
        const springOk = await pushCookieToSpringBoot(email, cookieToSend, cookieData.creditsLeft);
        result.springBootUpdated = springOk;

        if (springOk) {
          console.log(chalk.green('  ✅ Spring Boot DB đã được cập nhật!'));
        } else {
          console.log(chalk.red('  ❌ Không cập nhật được Spring Boot (xem log bên trên)'));
        }
      }

    } catch (err) {
      result.error = err.message;
      console.log(chalk.red(`  ❌ Lỗi: ${err.message}`));
      await updateAccountStatus(name, 'error').catch(() => {});
    }

    results.push(result);

    // Delay nhỏ giữa các tài khoản
    if (accounts.indexOf(account) < accounts.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── TỔNG KẾT ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter((r) => r.success).length;
  const springCount  = results.filter((r) => r.springBootUpdated).length;
  const failCount    = results.filter((r) => !r.success).length;

  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║                    KẾT QUẢ                      ║'));
  console.log(chalk.cyan('╠══════════════════════════════════════════════════╣'));
  console.log(chalk.cyan(`║  🍪 Cookie lấy được:  ${String(successCount + '/' + accounts.length).padEnd(26)}║`));
  console.log(chalk.cyan(`║  🗄️  Đã vào Spring DB: ${String(springCount + '/' + accounts.length).padEnd(26)}║`));
  console.log(chalk.cyan(`║  ❌ Thất bại:         ${String(failCount).padEnd(26)}║`));
  console.log(chalk.cyan(`║  ⏱️  Thời gian:        ${(elapsed + 's').padEnd(26)}║`));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════╝\n'));

  // ── GỬI TELEGRAM ──
  console.log('📱 Đang gửi báo cáo Telegram...');
  const summary = { total: accounts.length, success: successCount, fail: failCount };
  const telegramMsg = buildSummaryMessage(results, summary);
  await sendTelegram(telegramMsg);

  if (failCount > 0) {
    console.log(chalk.red('\n⚠️  Tài khoản cần đăng nhập lại:'));
    results.filter((r) => !r.success).forEach((r) => {
      console.log(chalk.red(`   - ${r.name} (${r.email || 'chưa có email'}): ${r.error}`));
    });
    console.log(chalk.yellow('\n💡 Chạy "npm run add-account" và nhập lại cho tài khoản bị lỗi.\n'));
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(chalk.red('\n💥 Lỗi nghiêm trọng:'), err.message);
  await sendTelegram(`💥 <b>Suno Updater - LỖI NGHIÊM TRỌNG</b>\n<code>${err.message}</code>`).catch(() => {});
  process.exit(1);
});
