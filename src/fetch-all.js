'use strict';

/**
 * Script tự động lấy cookie cho TẤT CẢ tài khoản đã đăng nhập
 * Chạy: npm run fetch:all
 * Có thể hẹn giờ chạy tự động mỗi ngày bằng Task Scheduler (Windows) hoặc cron (Linux)
 */

require('dotenv').config();
const chalk = require('chalk');
const { getAccounts, updateAccountStatus, saveCookieResult, OUTPUT_FILE } = require('./lib/account-store');
const { fetchCookiesForAccount } = require('./lib/cookie-fetcher');

const HEADLESS = process.env.HEADLESS !== 'false'; // Default: true

async function fetchSingleAccount(account) {
  const name = account.name;
  console.log(chalk.blue(`\n  ▶ Đang xử lý: ${chalk.cyan(name)}`));

  try {
    const cookieData = await fetchCookiesForAccount(name, HEADLESS);

    if (!cookieData.isLoggedIn) {
      console.log(chalk.red(`  ❌ ${name}: Không có __session cookie - Cần đăng nhập lại!`));
      await updateAccountStatus(name, 'error', cookieData.fetchedAt);
      return { success: false, name, error: 'Not logged in' };
    }

    await saveCookieResult(cookieData);
    await updateAccountStatus(name, 'active', cookieData.fetchedAt);

    const sessionPreview = cookieData.session?.substring(0, 25) + '...';
    console.log(chalk.green(`  ✅ ${name}: Thành công!`));
    console.log(chalk.gray(`     Session: ${sessionPreview}`));
    console.log(chalk.gray(`     API Ver: ${cookieData.clientApiVersion}`));

    return { success: true, name, data: cookieData };

  } catch (error) {
    console.log(chalk.red(`  ❌ ${name}: Lỗi - ${error.message}`));
    await updateAccountStatus(name, 'error').catch(() => {});
    return { success: false, name, error: error.message };
  }
}

async function main() {
  const startTime = Date.now();

  console.log(chalk.cyan('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║   SUNO COOKIE FETCHER - FETCH ALL ACCOUNTS  ║'));
  console.log(chalk.cyan('╠════════════════════════════════════════════╣'));
  console.log(chalk.cyan(`║  Thời gian: ${new Date().toLocaleString('vi-VN').padEnd(30)}║`));
  console.log(chalk.cyan('╚════════════════════════════════════════════╝'));

  // Đọc danh sách tài khoản
  const accounts = await getAccounts();

  if (accounts.length === 0) {
    console.log(chalk.yellow('\n⚠️  Chưa có tài khoản nào! Chạy "npm run add-account" để thêm tài khoản.\n'));
    process.exit(0);
  }

  console.log(chalk.white(`\n📋 Tìm thấy ${chalk.cyan(accounts.length)} tài khoản\n`));

  // Lấy cookie tuần tự (không chạy song song để tránh bị rate limit)
  const results = [];
  for (const account of accounts) {
    const result = await fetchSingleAccount(account);
    results.push(result);

    // Delay nhỏ giữa các tài khoản
    if (accounts.indexOf(account) < accounts.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Tổng kết
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(chalk.cyan('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║                  KẾT QUẢ                    ║'));
  console.log(chalk.cyan('╠════════════════════════════════════════════╣'));
  console.log(chalk.cyan(`║  ✅ Thành công: ${String(successCount).padEnd(26)}║`));
  console.log(chalk.cyan(`║  ❌ Thất bại:  ${String(failCount).padEnd(26)}║`));
  console.log(chalk.cyan(`║  ⏱️  Thời gian: ${(elapsed + 's').padEnd(26)}║`));
  console.log(chalk.cyan(`║  📄 Output:    output/cookies.json          ║`));
  console.log(chalk.cyan('╚════════════════════════════════════════════╝\n'));

  if (failCount > 0) {
    console.log(chalk.red('⚠️  Các tài khoản thất bại (cần đăng nhập lại):'));
    results.filter((r) => !r.success).forEach((r) => {
      console.log(chalk.red(`   - ${r.name}: ${r.error}`));
    });
    console.log(chalk.yellow('\n💡 Chạy "npm run add-account" để đăng nhập lại tài khoản bị lỗi.\n'));
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(chalk.red('\n💥 Lỗi nghiêm trọng:'), err);
  process.exit(1);
});
