'use strict';

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

/**
 * Gửi thông báo Telegram
 * @param {string} message - Nội dung tin nhắn (hỗ trợ HTML)
 */
async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('  ⚠️  Chưa cấu hình Telegram, bỏ qua gửi thông báo.');
    return;
  }

  try {
    const body = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    const res = await fetch(TELEGRAM_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`  ⚠️  Telegram lỗi: ${err}`);
    } else {
      console.log('  📱 Đã gửi thông báo Telegram!');
    }
  } catch (err) {
    console.log(`  ⚠️  Không thể gửi Telegram: ${err.message}`);
  }
}

/**
 * Tạo tin nhắn tổng kết sau khi update cookie
 * @param {Array} results - Kết quả từng tài khoản
 * @param {object} summary - Thống kê tổng
 */
function buildSummaryMessage(results, summary) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  let lines = [];
  lines.push(`🔄 <b>Suno Cookie Refresh</b>`);
  lines.push(`🕐 ${now}`);
  lines.push('');

  results.forEach((r) => {
    if (r.success) {
      const sessionShort = r.data?.session?.substring(0, 15) || 'N/A';
      lines.push(`✅ <b>${r.email || r.name}</b>`);
      lines.push(`   Session: <code>${sessionShort}...</code>`);
      lines.push(`   Spring Boot: ${r.springBootUpdated ? '✅ Đã cập nhật DB' : '❌ Lỗi cập nhật DB'}`);
    } else {
      lines.push(`❌ <b>${r.email || r.name}</b>: ${r.error}`);
    }
    lines.push('');
  });

  lines.push('─────────────────');
  lines.push(`📊 Tổng: <b>${summary.total}</b> | ✅ OK: <b>${summary.success}</b> | ❌ Lỗi: <b>${summary.fail}</b>`);

  return lines.join('\n');
}

module.exports = { sendTelegram, buildSummaryMessage };
