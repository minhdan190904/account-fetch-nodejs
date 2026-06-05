'use strict';

/**
 * Entry point - CLI đa năng
 * 
 * Cách dùng:
 *   node src/index.js --mode=login --account=ten_tai_khoan
 *   node src/index.js --mode=fetch --account=ten_tai_khoan
 *   node src/index.js --mode=fetch-all
 *   node src/index.js --mode=list
 */

require('dotenv').config();
const chalk = require('chalk');
const minimist = require('minimist');
const readline = require('readline');

const { getAccounts, addAccount, updateAccountStatus, saveCookieResult } = require('./lib/account-store');
const { fetchCookiesForAccount, manualLoginAndFetch } = require('./lib/cookie-fetcher');

const args = minimist(process.argv.slice(2));
const mode = args.mode || args.m || 'help';
const accountName = args.account || args.a || null;

async function runFetch(name) {
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.name === name);

  if (!account) {
    console.log(chalk.red(`❌ Không tìm thấy tài khoản: ${name}`));
    console.log(chalk.yellow('💡 Chạy "npm run list" để xem danh sách tài khoản.'));
    process.exit(1);
  }

  console.log(chalk.blue(`\n🔄 Đang lấy cookie cho: ${chalk.cyan(name)}`));

  const headless = process.env.HEADLESS !== 'false';
  const cookieData = await fetchCookiesForAccount(name, headless);

  if (!cookieData.isLoggedIn) {
    console.log(chalk.red('❌ Không có cookie __session! Tài khoản cần đăng nhập lại.'));
    await updateAccountStatus(name, 'error');
    process.exit(1);
  }

  await saveCookieResult(cookieData);
  await updateAccountStatus(name, 'active', cookieData.fetchedAt);

  console.log(chalk.green('\n✅ Lấy cookie thành công!'));
  console.log(chalk.white(`  Session: ${cookieData.session?.substring(0, 30)}...`));
  console.log(chalk.white(`  API Ver: ${cookieData.clientApiVersion}`));
  console.log(chalk.white(`  Lưu tại: output/cookies.json\n`));
}

async function runLogin(name) {
  if (!name) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    name = await new Promise((r) => rl.question('Tên tài khoản: ', (ans) => { rl.close(); r(ans.trim()); }));
  }

  const accounts = await getAccounts();
  const existing = accounts.find((a) => a.name === name);

  if (!existing) {
    await addAccount(name);
    console.log(chalk.green(`✅ Đã tạo tài khoản mới: ${name}`));
  }

  const cookieData = await manualLoginAndFetch(name);
  await saveCookieResult(cookieData);
  await updateAccountStatus(name, cookieData.isLoggedIn ? 'active' : 'error', cookieData.fetchedAt);

  if (cookieData.isLoggedIn) {
    console.log(chalk.green(`\n✅ Đăng nhập và lưu cookie thành công!`));
  } else {
    console.log(chalk.red(`\n❌ Không tìm thấy cookie! Vui lòng đăng nhập đúng cách.`));
    process.exit(1);
  }
}

function printHelp() {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════'));
  console.log(chalk.cyan('       SUNO COOKIE FETCHER - Hướng dẫn dùng'));
  console.log(chalk.cyan('═══════════════════════════════════════════════'));
  console.log('');
  console.log(chalk.white('  Lệnh chính:'));
  console.log(chalk.cyan('  npm run add-account') + chalk.gray('              Thêm tài khoản mới (login lần đầu)'));
  console.log(chalk.cyan('  npm run fetch:all') + chalk.gray('                Lấy cookie tất cả tài khoản (tự động)'));
  console.log(chalk.cyan('  npm run list') + chalk.gray('                     Xem danh sách tài khoản'));
  console.log('');
  console.log(chalk.white('  Lệnh nâng cao:'));
  console.log(chalk.cyan('  node src/index.js --mode=fetch --account=<name>') + chalk.gray('  Fetch 1 tài khoản'));
  console.log(chalk.cyan('  node src/index.js --mode=login --account=<name>') + chalk.gray('  Login lại 1 tài khoản'));
  console.log(chalk.cyan('  node src/index.js --mode=fetch-all') + chalk.gray('              Fetch tất cả'));
  console.log('');
  console.log(chalk.white('  Cấu hình (.env):'));
  console.log(chalk.gray('  HEADLESS=true|false   Chạy ẩn hay hiện giao diện'));
  console.log(chalk.gray('  PAGE_TIMEOUT=60000    Timeout load trang (ms)'));
  console.log('');
  console.log(chalk.yellow('  💡 Output: output/cookies.json'));
  console.log(chalk.cyan('═══════════════════════════════════════════════\n'));
}

async function main() {
  switch (mode) {
    case 'login':
      await runLogin(accountName);
      break;

    case 'fetch':
      if (!accountName) {
        console.log(chalk.red('❌ Cần chỉ định tên tài khoản: --account=<name>'));
        process.exit(1);
      }
      await runFetch(accountName);
      break;

    case 'fetch-all':
      // Delegate sang fetch-all.js
      require('./fetch-all');
      return;

    case 'list':
      require('./list-accounts');
      return;

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error(chalk.red('\n💥 Lỗi:'), err.message);
  process.exit(1);
});
