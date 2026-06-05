'use strict';

const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

const ACCOUNTS_FILE = path.resolve('./accounts.json');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'cookies.json');
const PROFILES_DIR = path.resolve(process.env.PROFILES_DIR || './profiles');

/**
 * Đọc danh sách tài khoản
 */
async function getAccounts() {
  if (!(await fs.pathExists(ACCOUNTS_FILE))) {
    return [];
  }
  const data = await fs.readJson(ACCOUNTS_FILE);
  return data.accounts || [];
}

/**
 * Lưu danh sách tài khoản
 */
async function saveAccounts(accounts) {
  await fs.writeJson(ACCOUNTS_FILE, { accounts }, { spaces: 2 });
}

/**
 * Thêm tài khoản mới
 */
async function addAccount(name, email = '', note = '') {
  const accounts = await getAccounts();

  // Kiểm tra trùng
  if (accounts.find((a) => a.name === name)) {
    throw new Error(`Tài khoản "${name}" đã tồn tại!`);
  }

  const newAccount = {
    name,
    email,
    note,
    clientToken: null,   // __client cookie value (Refresh Token, sống 1 năm)
    profileDir: path.join(PROFILES_DIR, name),
    createdAt: new Date().toISOString(),
    lastFetchedAt: null,
    status: 'pending',
  };

  accounts.push(newAccount);
  await saveAccounts(accounts);
  return newAccount;
}

/**
 * Cập nhật trạng thái tài khoản sau khi fetch
 */
async function updateAccountStatus(name, status, lastFetchedAt = null) {
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.name === name);
  if (account) {
    account.status = status;
    if (lastFetchedAt) account.lastFetchedAt = lastFetchedAt;
    await saveAccounts(accounts);
  }
}

/**
 * Lưu __client token (Refresh Token) cho tài khoản
 * Dùng sau khi login lần đầu bằng Playwright
 */
async function saveClientToken(name, clientToken) {
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.name === name);
  if (account) {
    account.clientToken = clientToken;
    await saveAccounts(accounts);
    return true;
  }
  return false;
}

/**
 * Lấy thông tin 1 tài khoản theo tên
 */
async function getAccountByName(name) {
  const accounts = await getAccounts();
  return accounts.find((a) => a.name === name) || null;
}

/**
 * Lấy kết quả cookie đã lưu
 */
async function getSavedCookies() {
  if (!(await fs.pathExists(OUTPUT_FILE))) {
    return { accounts: [] };
  }
  return fs.readJson(OUTPUT_FILE);
}

/**
 * Lưu cookie của một tài khoản vào output
 */
async function saveCookieResult(cookieData) {
  await fs.ensureDir(OUTPUT_DIR);

  const existing = await getSavedCookies();
  const accounts = existing.accounts || [];

  // Thay thế hoặc thêm mới
  const idx = accounts.findIndex((a) => a.profileName === cookieData.profileName);
  if (idx >= 0) {
    accounts[idx] = cookieData;
  } else {
    accounts.push(cookieData);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    totalAccounts: accounts.length,
    activeAccounts: accounts.filter((a) => a.isLoggedIn).length,
    accounts,
  };

  await fs.writeJson(OUTPUT_FILE, output, { spaces: 2 });
  return output;
}

/**
 * Cập nhật email cho tài khoản (dùng khi tài khoản cũ chưa có email)
 */
async function updateAccountEmail(name, email) {
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.name === name);
  if (account) {
    account.email = email;
    await saveAccounts(accounts);
    return true;
  }
  return false;
}

/**
 * Xóa tài khoản
 */
async function removeAccount(name) {
  const accounts = await getAccounts();
  const filtered = accounts.filter((a) => a.name !== name);
  await saveAccounts(filtered);

  // Xóa profile dir
  const profileDir = path.join(PROFILES_DIR, name);
  if (await fs.pathExists(profileDir)) {
    await fs.remove(profileDir);
  }
}


module.exports = {
  getAccounts,
  getAccountByName,
  addAccount,
  updateAccountStatus,
  updateAccountEmail,
  saveClientToken,
  saveCookieResult,
  getSavedCookies,
  removeAccount,
  OUTPUT_FILE,
  OUTPUT_DIR,
};


