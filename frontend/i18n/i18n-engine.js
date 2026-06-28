/**
 * 牛马助手 i18n 国际化引擎
 *
 * 用法：
 *   t('key')        → 返回当前语言的翻译文本
 *   t('key','zh-CN') → 强制返回指定语言文本
 *   setLang('en-US') → 切换语言并自动刷新页面文本
 *
 * 语言文件：zh-CN.js / en-US.js （挂载 window.I18N_MESSAGES 集合）
 */

;(function () {
  'use strict';

  const LANG_STORAGE_KEY = 'grindpal_lang';
  const DEFAULT_LANG = 'zh-CN';
  const FALLBACK_LANG = 'zh-CN';

  // ---- 检测系统语言 ----
  function _detectSystemLang() {
    try {
      const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
      if (navLang.startsWith('zh')) return 'zh-CN';
      if (navLang.startsWith('en')) return 'en-US';
      // 其他语言暂回退到英文
      return 'en-US';
    } catch (e) {
      return DEFAULT_LANG;
    }
  }

  // ---- 当前语言 ----
  var _currentLang = (function () {
    // 优先级：localStorage > navigator.language > 默认
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && (saved === 'zh-CN' || saved === 'en-US')) return saved;
    return _detectSystemLang();
  })();

  // ---- 所有语言包（由 zh-CN.js / en-US.js 注入） ----
  var MESSAGES = window.I18N_MESSAGES || {};
  window.I18N_MESSAGES = MESSAGES;

  // ---- 注册语言包 ----
  function registerLang(langCode, messages) {
    MESSAGES[langCode] = messages;
  }

  // ---- 获取翻译 ----
  function t(key, forceLang) {
    var lang = forceLang || _currentLang;
    var msgs = MESSAGES[lang];
    if (msgs && msgs[key] !== undefined) return msgs[key];
    // 回退到默认语言
    var fallback = MESSAGES[FALLBACK_LANG];
    if (fallback && fallback[key] !== undefined) return fallback[key];
    // 最后回退：返回 key 本身
    return key;
  }

  // ---- 获取当前语言 ----
  function getLang() {
    return _currentLang;
  }

  // ---- DOM 刷新：更新所有 data-i18n* 属性元素 ----
  function _refreshDOM() {
    // data-i18n → 只更新叶子节点（无子元素的），有子元素的跳过（由内部 span 处理）
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute('data-i18n');
      if (!key) continue;
      // 有子元素节点（如 icon span）→ 跳过，由内部 data-i18n span 处理
      if (els[i].children.length > 0) continue;
      els[i].textContent = t(key);
    }
    // data-i18n-placeholder → placeholder
    els = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < els.length; j++) {
      var pk = els[j].getAttribute('data-i18n-placeholder');
      if (pk) els[j].placeholder = t(pk);
    }
    // data-i18n-title → title
    els = document.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < els.length; k++) {
      var tk = els[k].getAttribute('data-i18n-title');
      if (tk) els[k].title = t(tk);
    }
    // data-i18n-value → value (for select options)
    els = document.querySelectorAll('[data-i18n-value]');
    for (var m = 0; m < els.length; m++) {
      var vk = els[m].getAttribute('data-i18n-value');
      if (vk) els[m].value = t(vk);
    }
    // Update document title
    var titleEl = document.getElementById('page-title');
    if (titleEl) {
      titleEl.textContent = t('app.version');
    }
    // Update logo alt
    var logoEl = document.getElementById('logo-img');
    if (logoEl) logoEl.alt = t('app.title');
    // Trigger App-level refresh for dynamic JS text
    if (window.App && typeof window.App._refreshI18n === 'function') {
      window.App._refreshI18n();
    }
  }

  // ---- 切换语言 ----
  function setLang(langCode) {
    if (!MESSAGES[langCode]) {
      console.warn('[i18n] 不支持的语言:', langCode);
      return false;
    }
    if (_currentLang === langCode) return true;
    _currentLang = langCode;
    localStorage.setItem(LANG_STORAGE_KEY, langCode);
    document.documentElement.lang = langCode;
    // 刷新 DOM
    _refreshDOM();
    // 触发自定义事件
    try {
      document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: langCode } }));
    } catch (e) {
      var ev = document.createEvent('Event');
      ev.initEvent('languagechange', true, true);
      ev.detail = { lang: langCode };
      document.dispatchEvent(ev);
    }
    return true;
  }

  // ---- 初始化：首屏 DOM 刷新 ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { _refreshDOM(); });
  } else {
    _refreshDOM();
  }

  // ---- 暴露到全局 ----
  window.registerLang = registerLang;
  window.t = t;
  window.getLang = getLang;
  window.setLang = setLang;
})();
