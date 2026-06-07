'use strict';

/**
 * Script login lại cho tài khoản đã tồn tại nhưng chưa có states file
 * Chạy: npm run relogin
 */

require('dotenv').config();
const readline = require('readline');
const chalk = require('chalk');
const { getAccounts, updateAccountStatus, saveCookieResult, saveClientToken } = require('./lib/account-store');
const { manualLoginAndFetch } = require('./lib/cookie-fetcher');
const { pushCookieToSpringBoot } = require('./lib/spring-push');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log(chalk.cyan('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan('║   SUNO COOKIE FETCHER - RE-LOGIN       ║'));
  console.log(chalk.cyan('╚════════════════════════════════════════╝\n'));

  // Lấy danh sách tài khoản
  const accounts = await getAccounts();
  if (accounts.length === 0) {
    console.log(chalk.red('❌ Chưa có tài khoản nào!'));
    process.exit(1);
  }

  // Hiển thị danh sách
  console.log(chalk.white('📋 Danh sách tài khoản:\n'));
  accounts.forEach((acc, i) => {
    console.log(chalk.white(`  ${i + 1}. ${chalk.cyan(acc.name)} — ${acc.email || 'chưa có email'} (${acc.status})`));
  });

  const input = await prompt(chalk.white('\nNhập tên tài khoản cần login lại (VD: tk_3): '));
  const account = accounts.find((a) => a.name === input);

  if (!account) {
    console.log(chalk.red(`❌ Không tìm thấy tài khoản "${input}"!`));
    process.exit(1);
  }

  console.log(chalk.blue(`\n🔓 Mở trình duyệt để đăng nhập lại cho: ${account.name} (${account.email})`));

  try {
    const cookieData = await manualLoginAndFetch(account.name);
    cookieData.email = account.email;

    if (!cookieData.isLoggedIn) {
      console.log(chalk.red('\n❌ Không tìm thấy cookie __session! Chưa đăng nhập thành công.'));
      await updateAccountStatus(account.name, 'error');
      process.exit(1);
    }

    await saveCookieResult(cookieData);
    await updateAccountStatus(account.name, 'active', cookieData.fetchedAt);

    if (cookieData.clientToken) {
      await saveClientToken(account.name, cookieData.clientToken);
      console.log(chalk.green('  ✅ Đã lưu Refresh Token!'));
    }

    if (account.email) {
      const springOk = await pushCookieToSpringBoot(account.email, cookieData.cookieString || cookieData.session, cookieData.creditsLeft);
      console.log(chalk.white(`  🗄️  Spring DB: ${springOk ? chalk.green('✅ Đã cập nhật') : chalk.red('❌ Lỗi')}`));
    }

    console.log(chalk.green('\n✅ Đăng nhập lại thành công!'));
    console.log(chalk.white(`  👤 Tài khoản: ${chalk.cyan(account.name)}`));
    console.log(chalk.white(`  📧 Email:     ${chalk.cyan(account.email)}`));
    console.log(chalk.white(`  🍪 Session:   ${chalk.cyan(cookieData.session?.substring(0, 30))}...\n`));

  } catch (err) {
    console.error(chalk.red('\n❌ Lỗi:'), err.message);
    process.exit(1);
  }
}

main().catch(console.error);
