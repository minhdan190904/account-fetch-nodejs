'use strict';

/**
 * test-refresh.js - Test thủ công luồng refresh token
 *
 * Cách dùng:
 *   npm run test:refresh
 *   node src/test-refresh.js
 *   node src/test-refresh.js --account=tk_2
 */

require('dotenv').config();
const chalk = require('chalk');
const minimist = require('minimist');
const { getAccounts, getAccountByName } = require('./lib/account-store');
const { refreshSessionToken } = require('./lib/clerk-refresh');
const { pushCookieToSpringBoot } = require('./lib/spring-push');

const args = minimist(process.argv.slice(2));
const targetAccount = args.account || args.a || null;

function toVN(isoOrTs) {
  const d = typeof isoOrTs === 'number' ? new Date(isoOrTs * 1000) : new Date(isoOrTs);
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

async function testRefreshForAccount(account) {
  const { name, email, clientToken } = account;

  console.log(chalk.cyan(`\n${'─'.repeat(55)}`));
  console.log(chalk.cyan(`  🔬 Test refresh: ${chalk.white(name)} (${email || 'no email'})`));
  console.log(chalk.cyan(`${'─'.repeat(55)}`));

  // ── Kiểm tra __client ──
  if (!clientToken) {
    console.log(chalk.red(`  ❌ Tài khoản "${name}" chưa có __client token!`));
    console.log(chalk.yellow(`  💡 Chạy: npm run add-account để login và lưu __client\n`));
    return false;
  }

  const clientPreview = clientToken.substring(0, 30) + '...';
  console.log(chalk.gray(`  __client: ${clientPreview}`));
  console.log('');

  // ── Bước 1: Gọi Clerk API ──
  console.log(chalk.white('  Bước 1/3: Gọi Clerk API lấy session_id...'));
  const t1 = Date.now();

  try {
    const { refreshSessionToken: _, getSessionInfo } = require('./lib/clerk-refresh');
    const sessionInfo = await getSessionInfo(clientToken);
    console.log(chalk.green(`  ✅ Session ID: ${sessionInfo.sessionId}`));

    // ── Bước 2: Lấy token mới ──
    console.log(chalk.white('\n  Bước 2/3: POST lấy __session mới...'));
    const tokenData = await refreshSessionToken(clientToken);
    const elapsed = ((Date.now() - t1) / 1000).toFixed(2);

    console.log(chalk.green(`  ✅ Token mới lấy thành công! (${elapsed}s)`));
    console.log('');
    console.log(chalk.white('  ┌─────────────────────────────────────┐'));
    console.log(chalk.white(`  │ Email:     ${chalk.cyan((tokenData.email || 'N/A').padEnd(25))}│`));
    console.log(chalk.white(`  │ Cấp lúc:  ${chalk.cyan(toVN(tokenData.iat).padEnd(25))}│`));
    console.log(chalk.white(`  │ Hết hạn:  ${chalk.cyan(toVN(tokenData.exp).padEnd(25))}│`));
    console.log(chalk.white(`  │ Còn lại:  ${chalk.green((tokenData.minutesLeft + ' phút').padEnd(25))}│`));
    console.log(chalk.white(`  │ JWT đầu:  ${chalk.gray((tokenData.jwt.substring(0, 25) + '...').padEnd(25))}│`));
    console.log(chalk.white('  └─────────────────────────────────────┘'));

    // ── Bước 3: Push Spring Boot ──
    if (email) {
      console.log(chalk.white('\n  Bước 3/3: Push vào Spring Boot DB...'));
      const fullCookie = `__session=${tokenData.jwt}; __client=${clientToken}`;
      const springOk = await pushCookieToSpringBoot(email, fullCookie);

      if (springOk) {
        console.log(chalk.green('  ✅ Spring Boot DB đã cập nhật!'));
      } else {
        console.log(chalk.red('  ❌ Không cập nhật được Spring Boot'));
        console.log(chalk.gray('     (Kiểm tra Spring Boot có đang chạy không?)'));
      }
    } else {
      console.log(chalk.yellow('\n  ⚠️  Bỏ qua Spring Boot (tài khoản chưa có email)'));
    }

    return true;

  } catch (err) {
    console.log(chalk.red(`  ❌ Lỗi: ${err.message}`));
    if (err.message.includes('active session')) {
      console.log(chalk.yellow('  💡 Session đã bị đăng xuất, cần login lại: npm run add-account'));
    }
    return false;
  }
}

async function main() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║     🔬 SUNO - TEST REFRESH TOKEN (HTTP Only)         ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════════════════╝'));

  const accounts = await getAccounts();

  if (accounts.length === 0) {
    console.log(chalk.yellow('\n⚠️  Chưa có tài khoản. Chạy: npm run add-account\n'));
    process.exit(0);
  }

  let toTest = [];

  if (targetAccount) {
    // Test 1 tài khoản cụ thể
    const acc = await getAccountByName(targetAccount);
    if (!acc) {
      console.log(chalk.red(`\n❌ Không tìm thấy tài khoản: ${targetAccount}\n`));
      process.exit(1);
    }
    toTest = [acc];
  } else {
    // Test tất cả
    toTest = accounts;
  }

  console.log(chalk.white(`\n📋 Sẽ test ${toTest.length} tài khoản...\n`));

  let successCount = 0;
  for (const acc of toTest) {
    const ok = await testRefreshForAccount(acc);
    if (ok) successCount++;
  }

  // ── Tổng kết ──
  console.log(chalk.cyan(`\n${'═'.repeat(55)}`));
  if (successCount === toTest.length) {
    console.log(chalk.green(`  ✅ TẤT CẢ ${successCount}/${toTest.length} tài khoản refresh OK!`));
    console.log(chalk.green(`  🚀 Chạy daemon: npm run daemon`));
  } else {
    console.log(chalk.yellow(`  ⚠️  ${successCount}/${toTest.length} thành công`));
    console.log(chalk.yellow(`  💡 Các tài khoản lỗi cần chạy lại: npm run add-account`));
  }
  console.log(chalk.cyan(`${'═'.repeat(55)}\n`));

  process.exit(successCount === toTest.length ? 0 : 1);
}

main().catch(console.error);
