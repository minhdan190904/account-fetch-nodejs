'use strict';

/**
 * Decode JWT payload lấy exp timestamp
 * @param {string} token
 * @returns {number|null} Unix timestamp hết hạn
 */
function decodeJwtExp(token) {
  try {
    if (!token) return null;
    const [, payload] = token.split('.');
    const pad = payload.length % 4;
    const padded = pad ? payload + '='.repeat(4 - pad) : payload;
    const data = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return data.exp || null;
  } catch {
    return null;
  }
}

/**
 * Trả về số phút còn lại của token
 * @param {string} token
 * @returns {number} âm = đã hết hạn
 */
function getTokenMinutesLeft(token) {
  const exp = decodeJwtExp(token);
  if (!exp) return -1;
  return Math.floor((exp - Date.now() / 1000) / 60);
}

module.exports = { decodeJwtExp, getTokenMinutesLeft };
