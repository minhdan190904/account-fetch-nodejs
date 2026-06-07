'use strict';

require('dotenv').config();

const SPRING_BOOT_URL = process.env.SPRING_BOOT_URL || 'http://localhost:8080';
const ADMIN_PASSWORD = process.env.SPRING_BOOT_ADMIN_PASSWORD || '1977vlogsA@';

/**
 * Đẩy cookie mới vào Spring Boot thông qua endpoint /admin/save
 * Spring Boot tìm theo email: nếu có thì UPDATE, không có thì INSERT
 *
 * @param {string} email - Email của tài khoản Suno
 * @param {string} cookie - Chuỗi cookie mới
 * @param {number|null} creditsLeft - Số dư (nếu lấy được)
 * @returns {Promise<boolean>} - true nếu thành công
 */
async function pushCookieToSpringBoot(email, cookie, creditsLeft = null) {
  if (!email) {
    console.log('  ⚠️  Tài khoản này chưa có email, bỏ qua push lên Spring Boot.');
    return false;
  }

  const url = `${SPRING_BOOT_URL}/admin/save`;

  // Spring Boot dùng form POST (Thymeleaf), không phải JSON
  const formBody = new URLSearchParams({
    password: ADMIN_PASSWORD,
    email: email,
    cookie: cookie,
  });

  if (creditsLeft !== null) {
    formBody.append('creditsLeft', creditsLeft);
  }

  const MAX_RETRY = 3;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });

      // Spring Boot trả về HTML (redirect), status 200 hoặc 302 là OK
      if (res.ok || res.status === 302 || res.status === 200) {
        return true;
      }

      console.log(`  ⚠️  Spring Boot trả về HTTP ${res.status} (lần ${attempt}/${MAX_RETRY})`);
    } catch (err) {
      console.log(`  ⚠️  Không kết nối được Spring Boot: ${err.message} (lần ${attempt}/${MAX_RETRY})`);
    }

    // Chờ 2 giây trước khi retry
    if (attempt < MAX_RETRY) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return false;
}

/**
 * Đẩy cookie cho NHIỀU tài khoản vào Spring Boot
 * @param {Array<{email, cookie}>} accountList
 * @returns {Promise<Array<{email, success}>>}
 */
async function pushAllCookiesToSpringBoot(accountList) {
  const results = [];

  for (const acc of accountList) {
    const success = await pushCookieToSpringBoot(acc.email, acc.cookie, acc.creditsLeft);
    results.push({ email: acc.email, name: acc.name, success });

    if (success) {
      console.log(`  ✅ Đã cập nhật DB Spring Boot: ${acc.email}`);
    } else {
      console.log(`  ❌ Không cập nhật được: ${acc.email || acc.name}`);
    }
  }

  return results;
}

module.exports = { pushCookieToSpringBoot, pushAllCookiesToSpringBoot };
