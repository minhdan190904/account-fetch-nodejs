'use strict';

/**
 * Liệt kê tất cả tài khoản đã đăng ký
 * Chạy: npm run list
 */

require('dotenv').config();
const chalk = require('chalk');
const { getAccounts, getSavedCookies } = require('./lib/account-store');

function formatDate(isoString) {
  if (!isoString) return chalk.gray('Chưa có');
  const d = new Date(isoString);
  return d.toLocaleString('vi-VN');
}

function getStatusColor(status) {
  switch (status) {
    case 'active': return chalk.green('● active');
    case 'error': return chalk.red('● error');
    case 'pending': return chalk.yellow('● pending');
    default: return chalk.gray(`● ${status}`);
  }
}

async function main() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║          SUNO COOKIE FETCHER - DANH SÁCH           ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════╝\n'));

  const accounts = await getAccounts();
  const savedCookies = await getSavedCookies();
  const cookieMap = {};
  (savedCookies.accounts || []).forEach((c) => {
    cookieMap[c.profileName] = c;
  });

  if (accounts.length === 0) {
    console.log(chalk.yellow('⚠️  Chưa có tài khoản nào!'));
    console.log(chalk.white('💡 Chạy "npm run add-account" để thêm tài khoản đầu tiên.\n'));
    return;
  }

  console.log(chalk.white(`📋 Tổng cộng: ${chalk.cyan(accounts.length)} tài khoản\n`));

  // Header bảng
  const col1 = 20, col2 = 14, col3 = 22, col4 = 22;
  const sep = '─'.repeat(col1 + col2 + col3 + col4 + 7);

  console.log(chalk.gray(sep));
  console.log(
    chalk.white(
      `${'Tên tài khoản'.padEnd(col1)} │ ${'Trạng thái'.padEnd(col2)} │ ${'Lần fetch cuối'.padEnd(col3)} │ ${'Session (20 ký tự đầu)'.padEnd(col4)}`
    )
  );
  console.log(chalk.gray(sep));

  accounts.forEach((account, idx) => {
    const cookie = cookieMap[account.name];
    const sessionPreview = cookie?.session
      ? chalk.green(cookie.session.substring(0, 20) + '...')
      : chalk.gray('Chưa có');

    const status = getStatusColor(account.status);
    const lastFetch = formatDate(account.lastFetchedAt);

    const num = chalk.gray(`${String(idx + 1).padStart(2)}. `);
    const nameStr = chalk.cyan(account.name.padEnd(col1 - 4));

    console.log(
      `${num}${nameStr} │ ${status.padEnd(col2 + 10)} │ ${lastFetch.padEnd(col3)} │ ${sessionPreview}`
    );

    if (account.email) {
      console.log(chalk.gray(`      Email: ${account.email}`));
    }
    if (account.note) {
      console.log(chalk.gray(`      Note:  ${account.note}`));
    }
    if (cookie?.clientApiVersion && cookie.clientApiVersion !== 'unknown') {
      console.log(chalk.gray(`      API v: ${cookie.clientApiVersion}`));
    }
  });

  console.log(chalk.gray(sep));

  // Tóm tắt
  const activeCount = accounts.filter((a) => a.status === 'active').length;
  const errorCount = accounts.filter((a) => a.status === 'error').length;
  const pendingCount = accounts.filter((a) => a.status === 'pending').length;

  console.log('');
  console.log(chalk.green(`  ✅ Active:  ${activeCount}`));
  console.log(chalk.red(`  ❌ Error:   ${errorCount}`));
  console.log(chalk.yellow(`  ⏳ Pending: ${pendingCount}`));

  if (savedCookies.updatedAt) {
    console.log(chalk.gray(`\n  Cookies cập nhật lần cuối: ${formatDate(savedCookies.updatedAt)}`));
  }
  console.log('');
}

main().catch(console.error);
