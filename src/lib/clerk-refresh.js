'use strict';

/**
 * clerk-refresh.js
 * ─────────────────────────────────────────────────────
 * Refresh __session token bằng __client cookie
 * CHỈ dùng HTTP thuần - KHÔNG mở trình duyệt!
 *
 * Quy trình:
 *   1. GET  https://auth.suno.com/v1/client  → lấy session_id
 *   2. POST https://auth.suno.com/v1/client/sessions/{id}/tokens → __session mới
 * ─────────────────────────────────────────────────────
 */

require('dotenv').config();

const CLERK_BASE = 'https://auth.suno.com';
const CLERK_JS_VERSION = '5.56.0';

const HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Origin': 'https://suno.com',
  'Referer': 'https://suno.com/',
  'Accept': 'application/json',
};

/**
 * Decode JWT payload (không verify signature)
 */
function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    const pad = payload.length % 4;
    const padded = pad ? payload + '='.repeat(4 - pad) : payload;
    return JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch {
    return null;
  }
}

/**
 * Lấy session_id và last_active_token từ __client
 * @param {string} clientCookieValue - Giá trị của __client cookie (không bao gồm tên)
 */
async function getSessionInfo(clientCookieValue) {
  const url = `${CLERK_BASE}/v1/client?__clerk_js_version=${CLERK_JS_VERSION}`;
  const res = await fetch(url, {
    headers: {
      ...HEADERS_BASE,
      'Cookie': `__client=${clientCookieValue}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Clerk /v1/client trả về HTTP ${res.status}`);
  }

  const data = await res.json();
  const sessions = data?.response?.sessions || [];
  const activeSession = sessions.find((s) => s.status === 'active') || sessions[0];

  if (!activeSession) {
    throw new Error('Không tìm thấy active session trong __client! Tài khoản có thể đã bị đăng xuất.');
  }

  return {
    sessionId: activeSession.id,
    lastActiveToken: activeSession.last_active_token?.jwt || null,
  };
}

/**
 * Refresh lấy __session JWT mới bằng __client
 * @param {string} clientCookieValue - Giá trị của __client cookie
 * @returns {Promise<{jwt, exp, iat, email}>}
 */
async function refreshSessionToken(clientCookieValue) {
  // Bước 1: Lấy session_id
  const { sessionId } = await getSessionInfo(clientCookieValue);

  // Bước 2: POST để lấy token mới
  const url = `${CLERK_BASE}/v1/client/sessions/${sessionId}/tokens?__clerk_js_version=${CLERK_JS_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...HEADERS_BASE,
      'Cookie': `__client=${clientCookieValue}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': '0',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Clerk /tokens trả về HTTP ${res.status}: ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  const jwt = data.jwt || data.response?.jwt;

  if (!jwt) {
    throw new Error('Clerk không trả về JWT! Response: ' + JSON.stringify(data).substring(0, 200));
  }

  // Decode để lấy thông tin
  const payload = decodeJwt(jwt);

  return {
    jwt,                                              // Chuỗi JWT đầy đủ (dùng làm __session)
    exp: payload?.exp || null,                        // Unix timestamp hết hạn
    iat: payload?.iat || null,                        // Unix timestamp cấp
    email: payload?.['suno.com/claims/email'] || null,
    expiresAt: payload?.exp ? new Date(payload.exp * 1000).toISOString() : null,
    minutesLeft: payload?.exp ? Math.floor((payload.exp - Date.now() / 1000) / 60) : null,
  };
}

/**
 * Kiểm tra xem __session hiện tại còn bao nhiêu phút
 * @param {string} sessionJwt
 * @returns {number} số phút còn lại (âm = đã hết hạn)
 */
function getMinutesLeft(sessionJwt) {
  const payload = decodeJwt(sessionJwt);
  if (!payload?.exp) return -1;
  return Math.floor((payload.exp - Date.now() / 1000) / 60);
}

module.exports = { refreshSessionToken, getSessionInfo, getMinutesLeft, decodeJwt };
