'use strict';

const path = require('path');
const fs = require('fs-extra');
const { chromium } = require('playwright');
require('dotenv').config();

const PROFILES_DIR = path.resolve(process.env.PROFILES_DIR || './profiles');
const SUNO_URL = process.env.SUNO_URL || 'https://suno.com';

/**
 * Mở trình duyệt với Persistent Context (có bộ nhớ - như hồ sơ Chrome)
 * @param {string} profileName - Tên thư mục profile (VD: 'account_01')
 * @param {boolean} headless - true: chạy ẩn | false: hiện giao diện
 * @returns {Promise<{context, page}>}
 */
async function launchBrowser(profileName, headless = true) {
  const userDataDir = path.join(PROFILES_DIR, profileName);
  await fs.ensureDir(userDataDir);

  // Khi login lần đầu (headless=false), PHẢI dùng Chrome thật
  // để Google không phát hiện là bot
  const launchOptions = {
    headless,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Ho_Chi_Minh',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-plugins-discovery',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    ignoreDefaultArgs: [
      '--enable-automation',
      '--enable-blink-features=IdleDetection',
    ],
    bypassCSP: true,
  };

  // Thử dùng Chrome thật trên máy (Google sẽ tin hơn)
  // Nếu không có Chrome thật thì fallback về Chromium bundled
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: 'chrome', // Dùng Chrome thật đã cài trên máy
    });
    console.log('  🟢 Đang dùng Chrome thật (chế độ chống phát hiện tốt nhất)');
  } catch (_) {
    // Không tìm thấy Chrome thật → dùng Chromium bundled
    console.log('  🟡 Không tìm thấy Chrome thật, dùng Chromium tích hợp sẵn...');
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  }

  // Ẩn TẤT CẢ dấu vết automation (chạy trên mọi trang mới)
  await context.addInitScript(() => {
    // Xóa webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Giả lập Chrome thật có đầy đủ runtime
    window.chrome = {
      app: { isInstalled: false },
      webstore: { onInstallStageChanged: {}, onDownloadProgress: {} },
      runtime: {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      },
    };

    // Giả lập permissions API như Chrome thật
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // Ẩn Playwright/automation plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5], // Chrome thật có nhiều plugin
    });

    // Ẩn languages trống (dấu hiệu của bot)
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  return { context, page };
}

/**
 * Đóng trình duyệt an toàn
 */
async function closeBrowser(context) {
  try {
    await context.close();
  } catch (_) {
    // ignore
  }
}

module.exports = { launchBrowser, closeBrowser, SUNO_URL, PROFILES_DIR };
