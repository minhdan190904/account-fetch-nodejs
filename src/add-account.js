'use strict';

/**
 * Script thêm tài khoản mới và login thủ công lần đầu tiên
 * Chạy: npm run add-account
 */

require('dotenv').config();
const readline = require('readline');
const chalk = require('chalk');
const { addAccount, updateAccountStatus, saveCookieResult, saveClientToken } = require('./lib/account-store');
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  console.log(chalk.cyan('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan('║     SUNO COOKIE FETCHER - ADD ACCOUNT  ║'));
  console.log(chalk.cyan('╚════════════════════════════════════════╝\n'));

  console.log(chalk.yellow('📌 Bước này chỉ cần làm 1 lần cho mỗi tài khoản.\n'));

  // Nhập tên tài khoản
  const name = await prompt(chalk.white('Tên tài khoản (VD: tk_1, no_space): '));
  if (!name || name.includes(' ')) {
    console.log(chalk.red('❌ Tên tài khoản không được có khoảng trắng!'));
    process.exit(1);
  }

  // ✅ BẮT BUỘC nhập Gmail (dùng để map với Spring Boot DB)
  let email = '';
  while (true) {
    email = await prompt(chalk.white('📧 Gmail Suno (BẮT BUỘC, dùng để update DB Spring Boot): '));
    if (!email) {
      console.log(chalk.red('  ❌ Gmail là bắt buộc! Không thể bỏ trống.'));
      continue;
    }
    if (!isValidEmail(email)) {
      console.log(chalk.red('  ❌ Email không hợp lệ! Ví dụ: abc@gmail.com'));
      continue;
    }
    break;
  }

  const note = await prompt(chalk.white('Ghi chú (tuỳ chọn, Enter để bỏ qua): '));

  console.log(chalk.blue(`\n📁 Tạo profile: ${name} (${email})`));

  try {
    // Tạo record tài khoản
    const account = await addAccount(name, email, note);
    console.log(chalk.green(`✅ Đã tạo tài khoản: ${account.name}`));

    // Mở trình duyệt để login thủ công
    const cookieData = await manualLoginAndFetch(name);
    // Gắn email vào cookieData để spring-push dùng
    cookieData.email = email;

    if (!cookieData.isLoggedIn) {
      console.log(chalk.red('\n❌ Không tìm thấy cookie __session! Có thể bạn chưa đăng nhập thành công.'));
      await updateAccountStatus(name, 'error');
      process.exit(1);
    }

    // Lưu kết quả local
    await saveCookieResult(cookieData);
    await updateAccountStatus(name, 'active', cookieData.fetchedAt);

    // ✅ Lưu __client token (Refresh Token) - quan trọng cho daemon HTTP refresh
    if (cookieData.clientToken) {
      await saveClientToken(name, cookieData.clientToken);
      console.log(chalk.green('  ✅ Đã lưu Refresh Token (__client) - Daemon sẽ dùng token này!'));
    } else {
      console.log(chalk.yellow('  ⚠️  Không lấy được __client token! Daemon sẽ không hoạt động.'));
      console.log(chalk.yellow('  💡 Thử login lại nếu daemon báo lỗi.'));
    }

    // ✅ Push cookie lên Spring Boot ngay lập tức
    console.log(chalk.blue('\n🚀 Đang cập nhật cookie vào Spring Boot DB...'));
    const springOk = await pushCookieToSpringBoot(email, cookieData.cookieString || cookieData.session);

    console.log(chalk.green('\n╔════════════════════════════════════════╗'));
    console.log(chalk.green('║         ✅ ĐĂNG NHẬP THÀNH CÔNG!       ║'));
    console.log(chalk.green('╚════════════════════════════════════════╝'));
    console.log(chalk.white(`\n  👤 Tài khoản: ${chalk.cyan(name)}`));
    console.log(chalk.white(`  📧 Email:     ${chalk.cyan(email)}`));
    console.log(chalk.white(`  🍪 __session: ${chalk.cyan(cookieData.session?.substring(0, 30))}...`));
    console.log(chalk.white(`  🔖 API Ver:   ${chalk.cyan(cookieData.clientApiVersion)}`));
    console.log(chalk.white(`  🗄️  Spring DB: ${springOk ? chalk.green('✅ Đã cập nhật') : chalk.red('❌ Lỗi - kiểm tra Spring Boot')}`));
    console.log(chalk.white(`  📄 Local:     ${chalk.cyan('output/cookies.json')}\n`));
    console.log(chalk.yellow('💡 Từ giờ chạy "npm run update:all" để tự động refresh cookie!\n'));

  } catch (error) {
    if (error.message && error.message.includes('đã tồn tại')) {
      console.log(chalk.red(`\n❌ ${error.message}`));
      console.log(chalk.yellow('💡 Tài khoản đã tồn tại, dùng "npm run update:all" để refresh cookie.\n'));
    } else {
      console.error(chalk.red('\n❌ Lỗi:'), error.message);
    }
    process.exit(1);
  }
}

main().catch(console.error);
