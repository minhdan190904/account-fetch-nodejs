'use strict';

/**
 * Cập nhật email cho tài khoản đã tạo mà chưa có email
 * Chạy: node src/set-email.js
 */

require('dotenv').config();
const readline = require('readline');
const chalk = require('chalk');
const { getAccounts, updateAccountEmail } = require('./lib/account-store');

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (ans) => { rl.close(); r(ans.trim()); }));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║   SUNO COOKIE FETCHER - SET EMAIL         ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝\n'));

  const accounts = await getAccounts();
  if (accounts.length === 0) {
    console.log(chalk.yellow('Chưa có tài khoản nào.\n'));
    return;
  }

  // Hiển thị danh sách
  console.log(chalk.white('Danh sách tài khoản hiện tại:\n'));
  accounts.forEach((a, i) => {
    const emailDisplay = a.email ? chalk.green(a.email) : chalk.red('❌ Chưa có email');
    console.log(`  ${i + 1}. ${chalk.cyan(a.name)} → ${emailDisplay}`);
  });

  console.log('');
  const nameInput = await prompt(chalk.white('Nhập tên tài khoản cần cập nhật email: '));
  const account = accounts.find((a) => a.name === nameInput);

  if (!account) {
    console.log(chalk.red(`❌ Không tìm thấy tài khoản: ${nameInput}`));
    process.exit(1);
  }

  let email = '';
  while (true) {
    email = await prompt(chalk.white(`📧 Nhập email Gmail cho "${nameInput}": `));
    if (!email) { console.log(chalk.red('  ❌ Không được để trống!')); continue; }
    if (!isValidEmail(email)) { console.log(chalk.red('  ❌ Email không hợp lệ!')); continue; }
    break;
  }

  const ok = await updateAccountEmail(nameInput, email);
  if (ok) {
    console.log(chalk.green(`\n✅ Đã cập nhật email cho ${nameInput}: ${email}`));
    console.log(chalk.yellow('💡 Giờ chạy "npm run update:all" để push cookie lên Spring Boot!\n'));
  } else {
    console.log(chalk.red('❌ Cập nhật thất bại!\n'));
  }
}

main().catch(console.error);
