/* ============================================================
   牛马助手 - 前端 JavaScript
   模块化设计，每个功能独立对象，便于扩展
   ============================================================ */

/* ---- 调试日志 (gp-debug) ---- */
const GP = { _enabled: true, _history: [], log(fn, act, d) { if (!this._enabled) return; const t = new Date().toISOString().slice(11,23); const entry = {t, fn, act, d}; this._history.push(entry); console.log(`[GP ${t}] ${fn}: ${act}`, d !== undefined ? d : ''); }, download() { const blob = new Blob([JSON.stringify(this._history, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gp-debug-' + Date.now() + '.json'; a.click(); } };

const API_BASE = '/api/v1';

// ---- 工具函数 ----

function _loadingTexts() {
  return [
    t('loading.default'),
    t('loading.reportese'),
    t('loading.extract'),
    t('loading.polish'),
    t('loading.decode'),
    t('loading.pretending'),
  ];
}

function _successTexts() {
  return {
    summarize: t('mod.summarize.success'),
    email: t('mod.email.success'),
    minutes: t('mod.minutes.success'),
    polish: t('mod.polish.success'),
    reportese: t('mod.reportese.success'),
  };
}


function toast(msg, type='info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  const icons = { success: 'check_circle', error: 'error', info: 'info' };
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="material-icons" style="font-size:18px">${icons[type]||'info'}</span>${App._escapeHtml(String(msg))}`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

function $(id) { return document.getElementById(id); }

// ---- 全局状态 ----

const App = {
  _token: null,
  _username: null,
  _userId: null,
  _authView: 'login',  // 'login' | 'register' | 'forgot_question' | 'forgot_newpw'
  _forgotUsername: '',

  async init() {
    // 立即设置随机副标题和标题，避免闪烁
    this._randomSubtitle();
    this._randomTitle();
    this._token = sessionStorage.getItem('grindpal_token');
    // 回退到 Cookie（标签页重新打开时 sessionStorage 已清空但 Cookie 仍有效）
    if (!this._token) {
      const match = document.cookie.match(/(?:^|;\s*)grindpal_token=([^;]*)/);
      if (match) { this._token = match[1]; sessionStorage.setItem('grindpal_token', this._token); }
    }
    this._username = localStorage.getItem('grindpal_username');
    this._hasSecurity = localStorage.getItem('grindpal_has_security') === '1';
    this._securityQuestion = localStorage.getItem('grindpal_security_q') || '';
    this._userId = localStorage.getItem('grindpal_user_id');

    // 恢复设置
    const apiKey = sessionStorage.getItem('grindpal_apikey') || '';
    this._apiKey = apiKey || null;
    const model = localStorage.getItem('grindpal_model') || 'deepseek-v4-flash';
    $('settings-apikey').value = apiKey;
    $('settings-model').value = model;
    $('settings-style').value = localStorage.getItem('grindpal_style') || 'standard';
    $('settings-reminder').value = localStorage.getItem('grindpal_reminder') || '10';
    $('settings-tavern').checked = localStorage.getItem('grindpal_tavern') !== '0';
    $('settings-tavern-hide').checked = localStorage.getItem('grindpal_tavern_hide') === '1';

    // 恢复 token 统计
    this._sessionTokens = parseInt(sessionStorage.getItem('grindpal_session_tokens') || '0');

    // 一次性清理：旧的生成缓存 > 20 条时清理到 10 条（防 QuotaExceeded）
    try {
      const genKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('grindpal_gen_')) genKeys.push(k);
      }
      if (genKeys.length > 20) {
        genKeys.sort().slice(0, genKeys.length - 10).forEach(k => localStorage.removeItem(k));
      }
      // 同样清理旧的模板 prompt 缓存 (grindpal_style_prompt_*)
      const promptKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('grindpal_style_prompt_')) promptKeys.push(k);
      }
      if (promptKeys.length > 30) {
        promptKeys.sort().slice(0, promptKeys.length - 20).forEach(k => localStorage.removeItem(k));
      }
    } catch(e) {}
    this._totalTokens = parseInt(localStorage.getItem('grindpal_total_tokens') || '0');
    this._updateStats();

    // 自动登录
    if (this._token) {
      this._verifyToken();
    }

    // 恢复主题
    const theme = localStorage.getItem('grindpal_theme') || 'light';
    const dlbl = $('dark-label');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      $('dark-toggle').querySelector('.material-icons').textContent = 'dark_mode';
      if (dlbl) dlbl.textContent = t('app.theme.light');
    } else {
      if (dlbl) dlbl.textContent = t('app.theme.dark');
    }
    // 初始化语言按钮文字
    // 初始化语言下拉框
    const langSel = $('settings-lang');
    if (langSel) langSel.value = getLang();
    // 恢复背景
    const bg = await this._bgLoad('bg');
    if (bg) {
      const layer = $('bg-layer');
      if (layer) {
        layer.style.backgroundImage = `url("${bg}")`;
        layer.classList.add('show');
        const bgName = await this._bgLoad('bg_name') || '背景图片';
        $('bg-preview').style.display = 'flex';
        $('bg-thumb').src = bg;
        $('bg-name').textContent = bgName;
      }
    }

    // 导航事件
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // KB 文档列表事件委托（避免内联 onclick 注入）
    document.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const {action:act, colId, docId} = action.dataset;
      if (act === 'toggle-preview') {
        e.stopPropagation();
        this._toggleDocPreview(parseInt(colId), parseInt(docId));
      } else if (act === 'delete-kbdoc') {
        e.stopPropagation();
        this._deleteKBDoc(parseInt(colId), parseInt(docId));
      }
    });

    // 加载风格选择器
    this._loadStyleSelectors();
  },

  async _verifyToken() {
    try {
      const resp = await fetch(`${API_BASE}/auth/me`, {
        headers: { 'Authorization': `Bearer ${this._token}` }
      });
      if (resp.status === 200) {
        const data = await resp.json();
        if (data.code === 200) {
          this._hasSecurity = data.data.has_security || false;
          this._securityQuestion = data.data.security_question || '';
          localStorage.setItem('grindpal_has_security', this._hasSecurity ? '1' : '0');
          localStorage.setItem('grindpal_security_q', this._securityQuestion);
          this._unlock();
          return;
        }
      }
    } catch (e) {}
    this._clearAuth();
  },

  switchAuthTab(mode) {
    this._authView = mode;
    this._forgotUsername = '';
    // Tab 状态
    $('tab-login').classList.toggle('active', mode === 'login');
    $('tab-register').classList.toggle('active', mode === 'register');
    // 视图切换
    $('login-tabs-bar').style.display = (mode === 'login' || mode === 'register') ? 'flex' : 'none';
    $('login-form-view').style.display = mode === 'login' ? 'block' : 'none';
    $('register-form-view').style.display = mode === 'register' ? 'block' : 'none';
    $('forgot-view').style.display = 'none';
    // 登录视图按钮
    $('login-submit-btn').textContent = t('login.submitLogin');
    $('login-submit-btn').disabled = false;
    $('login-error').textContent = '';
    $('login-password').value = '';
    // 注册视图按钮
    $('reg-submit-btn').textContent = t('login.register').replace(' ','');
    $('reg-submit-btn').disabled = false;
    $('reg-error').textContent = '';
    $('reg-pw-hint').textContent = '';
    $('reg-password').value = '';
    $('reg-confirm-pw').value = '';
    // 标题
    $('login-title').textContent = t('login.title');
    this._randomSubtitle();
    $('login-subtitle').style.display = 'block';
  },

  async register() {
    const username = $('reg-username').value.trim();
    const password = $('reg-password').value.trim();
    const confirm = $('reg-confirm-pw').value.trim();
    if (!username) { $('reg-error').textContent = t('login.usernameRequired'); return; }
    if (!password) { $('reg-error').textContent = t('login.passwordRequired'); return; }
    if (password.length < 8) { $('reg-error').textContent = t('login.pwTooShort'); return; }
    if (password !== confirm) { $('reg-error').textContent = t('login.pwMismatch'); return; }
    $('reg-submit-btn').disabled = true;
    $('reg-submit-btn').textContent = t('login.registering');
    $('reg-error').textContent = '';

    try {
      const resp = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({username, password}),
      });
      const data = await resp.json();
      if (data.code === 200) {
        // 注册成功 → 切到登录视图并将用户名预填
        this._authView = 'login';
        $('login-tabs-bar').style.display = 'flex';
        $('tab-login').classList.add('active');
        $('tab-register').classList.remove('active');
        $('login-form-view').style.display = 'block';
        $('register-form-view').style.display = 'none';
        $('forgot-view').style.display = 'none';
        $('login-username').value = username;
        $('login-password').value = '';
        $('login-error').textContent = '';
        $('login-submit-btn').textContent = t('login.submitLogin');
        $('login-submit-btn').disabled = false;
        toast(t('login.registerSuccess'), 'success');
      } else {
        $('reg-error').textContent = data.message || data.detail || t('login.operationFailed');
        $('reg-submit-btn').disabled = false;
        $('reg-submit-btn').textContent = t('login.register').replace(' ','');
      }
    } catch(e) {
      $('reg-error').textContent = t('login.networkError');
      $('reg-submit-btn').disabled = false;
      $('reg-submit-btn').textContent = t('login.register').replace(' ','');
    }
  },

  async login() {
    // ===== 忘记密码流程 =====
    if (this._authView === 'forgot_question') {
      const username = $('forgot-input1').value.trim();
      if (!username) { $('forgot-error').textContent = t('login.usernameRequired'); return; }
      $('forgot-submit-btn').disabled = true;
      $('forgot-submit-btn').textContent = t('login.loggingIn');
      try {
        const resp = await fetch(`${API_BASE}/auth/forgot-question`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({username}),
        });
        const d = await resp.json();
        if (d.code === 200) {
          this._forgotUsername = username;
          this._forgotAnswer = '';
          $('forgot-step-label').textContent = t('login.forgotStep2');
          $('forgot-question-display').textContent = d.data.question;
          $('forgot-question-display').style.display = 'block';
          $('forgot-icon1').textContent = 'help';
          $('forgot-input1').type = 'text';
          $('forgot-input1').placeholder = t('login.securityAnswer');
          $('forgot-input1').value = '';
          $('forgot-input2-wrap').style.display = 'none';
          $('forgot-pw-hint').style.display = 'none';
          $('forgot-submit-btn').textContent = t('login.verify');
          $('forgot-submit-btn').disabled = false;
          $('forgot-error').textContent = '';
          this._authView = 'forgot_newpw';
        } else {
          $('forgot-error').textContent = d.message || t('login.noSecurityQuestion');
          $('forgot-submit-btn').disabled = false;
          $('forgot-submit-btn').textContent = t('login.submitLogin');
        }
      } catch(e) {
        $('forgot-error').textContent = t('login.networkError');
        $('forgot-submit-btn').disabled = false;
        $('forgot-submit-btn').textContent = t('login.submitLogin');
      }
      return;
    }

    if (this._authView === 'forgot_newpw') {
      // Step A: verify answer
      if (!this._forgotAnswer) {
        const answer = $('forgot-input1').value.trim();
        if (!answer) { $('forgot-error').textContent = t('login.securityAnswerRequired'); return; }
        $('forgot-submit-btn').disabled = true;
        $('forgot-submit-btn').textContent = t('login.verifyToken');
        // Verify answer
        try {
          const resp = await fetch(`${API_BASE}/auth/verify-security`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username: this._forgotUsername, answer}),
          });
          const d = await resp.json();
          if (d.code === 200) {
            this._forgotAnswer = answer;
            $('forgot-step-label').textContent = t('login.forgotStep3');
            $('forgot-question-display').style.display = 'none';
            $('forgot-icon1').textContent = 'lock';
            $('forgot-input1').type = 'password';
            $('forgot-input1').placeholder = t('login.newPassword');
            $('forgot-input1').value = '';
            $('forgot-input2-wrap').style.display = 'block';
            $('forgot-input2').placeholder = t('login.confirmPassword');
            $('forgot-input2').value = '';
            $('forgot-pw-hint').style.display = 'none';
            $('forgot-submit-btn').textContent = t('login.reset');
            $('forgot-submit-btn').disabled = false;
            $('forgot-error').textContent = '';
          } else {
            $('forgot-error').textContent = d.message || t('login.resetFailed');
            $('forgot-submit-btn').disabled = false;
            $('forgot-submit-btn').textContent = t('login.verify');
          }
        } catch(e) {
          $('forgot-error').textContent = t('login.networkError');
          $('forgot-submit-btn').disabled = false;
          $('forgot-submit-btn').textContent = t('login.verify');
        }
        return;
      }
      // Step B: new password + confirm
      const newPw = $('forgot-input1').value.trim();
      const confirmPw = $('forgot-input2').value.trim();
      if (newPw.length < 8) { $('forgot-error').textContent = t('login.pwTooShort'); return; }
      if (newPw !== confirmPw) { $('forgot-error').textContent = t('login.pwMismatch'); return; }
      $('forgot-submit-btn').disabled = true;
      $('forgot-submit-btn').textContent = t('login.resetPassword');
      try {
        const resp = await fetch(`${API_BASE}/auth/reset-password`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({username: this._forgotUsername, answer: this._forgotAnswer, new_password: newPw}),
        });
        const d = await resp.json();
        if (d.code === 200) {
          toast(t('login.passwordReset'), 'success');
          this._resetAuthView();
        } else {
          $('forgot-error').textContent = d.message || t('login.resetFailed');
          $('forgot-submit-btn').disabled = false;
          $('forgot-submit-btn').textContent = t('login.reset');
        }
      } catch(e) {
        $('forgot-error').textContent = t('login.networkError');
        $('forgot-submit-btn').disabled = false;
        $('forgot-submit-btn').textContent = t('login.reset');
      }
      return;
    }

    // ===== 登录 =====
    const username = $('login-username').value.trim();
    const password = $('login-password').value.trim();
    if (!username) { $('login-error').textContent = t('login.usernameRequired'); return; }
    if (!password) { $('login-error').textContent = t('login.passwordRequired'); return; }

    const btn = $('login-submit-btn');
    btn.disabled = true;
    btn.textContent = t('login.loggingIn');
    $('login-error').textContent = '';

    try {
      const resp = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (data.code === 200) {
        this._token = data.data.token;
        this._username = data.data.username;
        this._userId = data.data.user_id;
        this._hasSecurity = data.data.has_security || false;
        this._securityQuestion = data.data.security_question || '';
        sessionStorage.setItem('grindpal_token', this._token);
        localStorage.setItem('grindpal_username', this._username);
        localStorage.setItem('grindpal_user_id', this._userId);
        localStorage.setItem('grindpal_has_security', this._hasSecurity ? '1' : '0');
        localStorage.setItem('grindpal_security_q', this._securityQuestion);
        // 同时设置 Cookie，使 <img> 等无法自定义 Header 的元素也能加载 uploads 下受保护文件
        document.cookie = `grindpal_token=${this._token}; path=/; max-age=86400; SameSite=Lax`;

        // 缓存派生密钥，用于后续 API Key 加密
        await this._cacheDerivedKey(password);

        // 自动迁移：如果有旧明文 Key，加密存储；如果有加密 Key，尝试解密
        const oldPlain = localStorage.getItem('grindpal_apikey');
        const encKey = localStorage.getItem('grindpal_apikey_enc');
        if (oldPlain && !encKey) {
          try {
            const encJson = await CryptoUtils.encryptWithPassword(oldPlain, password);
            localStorage.setItem('grindpal_apikey_enc', encJson);
            this._apiKey = oldPlain;
            sessionStorage.setItem('grindpal_apikey', oldPlain);
            localStorage.removeItem('grindpal_apikey');
          } catch (e) { /* 加密失败，保留旧明文 */ }
        } else if (encKey) {
          try {
            const encData = JSON.parse(encKey);
            const plain = await CryptoUtils.decrypt(encData, password);
            this._apiKey = plain;
            sessionStorage.setItem('grindpal_apikey', plain);
          } catch (e) { /* 密码不匹配，后续惰性弹窗 */ }
        }

        // 尝试从服务端拉取加密的 API Key（优先级低于本地已有）
        if (!this._apiKey) {
          try {
            const r = await fetch(`${API_BASE}/preferences/api-key`, {
              headers: { 'Authorization': `Bearer ${this._token}` }
            });
            if (r.ok) {
              const d = await r.json();
              if (d.code === 200 && d.data.encrypted_key) {
                try {
                  const encData = JSON.parse(d.data.encrypted_key);
                  const serverPlain = await CryptoUtils.decrypt(encData, password);
                  this._apiKey = serverPlain;
                  sessionStorage.setItem('grindpal_apikey', serverPlain);
                  // 同步到本地加密存储
                  localStorage.setItem('grindpal_apikey_enc', d.data.encrypted_key);
                } catch (e) { /* 解密失败，忽略 */ }
              }
            }
          } catch (e) { /* 网络错误，忽略 */ }
        }

        this._unlock();
        toast(t('login.welcomeBack') + this._username, 'success');
      } else {
        // 423 = locked, 429 = rate limited, 401 = bad credentials
        $('login-error').textContent = data.message || data.detail || t('login.operationFailed');
        btn.disabled = false;
        btn.textContent = t('login.submitLogin');
        // 登录失败清空密码保留用户名
        $('login-password').value = '';
      }
    } catch (e) {
      $('login-error').textContent = t('login.networkError');
      btn.disabled = false;
      btn.textContent = t('login.submitLogin');
    }
  },

  async showForgotPassword() {
    this._authView = 'forgot_question';
    this._forgotUsername = '';
    this._forgotAnswer = '';
    // 视图切换
    $('login-tabs-bar').style.display = 'none';
    $('login-form-view').style.display = 'none';
    $('register-form-view').style.display = 'none';
    $('forgot-view').style.display = 'block';
    $('login-subtitle').style.display = 'none';
    $('login-title').textContent = t('login.resetTitle');
    // 重置 forgot 视图
    $('forgot-step-label').textContent = t('login.forgotStep1');
    $('forgot-question-display').style.display = 'none';
    $('forgot-icon1').textContent = 'person';
    $('forgot-input1').type = 'text';
    $('forgot-input1').placeholder = t('login.username');
    $('forgot-input1').value = $('login-username').value.trim();  // 预填当前用户名
    $('forgot-input2-wrap').style.display = 'none';
    $('forgot-input2').value = '';
    $('forgot-pw-hint').style.display = 'none';
    $('forgot-submit-btn').textContent = t('login.submitLogin');
    $('forgot-submit-btn').disabled = false;
    $('forgot-error').textContent = '';
  },

  _resetAuthView() {
    this._authView = 'login';
    this._forgotUsername = '';
    this._forgotAnswer = '';
    // 恢复所有视图
    $('login-tabs-bar').style.display = 'flex';
    $('login-form-view').style.display = 'block';
    $('register-form-view').style.display = 'none';
    $('forgot-view').style.display = 'none';
    $('tab-login').classList.add('active');
    $('tab-register').classList.remove('active');
    $('login-title').textContent = t('login.title');
    this._randomSubtitle();
    $('login-subtitle').style.display = 'block';
    $('login-password').value = '';
    $('login-error').textContent = '';
    $('login-submit-btn').textContent = t('login.submitLogin');
    $('login-submit-btn').disabled = false;
    // Clean forgot view
    $('forgot-input1').value = '';
    $('forgot-input2').value = '';
    $('forgot-error').textContent = '';
  },

  _unlock() {
    $('login-overlay').classList.add('hidden');
    $('top-nav').classList.remove('hidden');
    $('changelog-btn').style.display = 'flex';
    $('notif-btn').style.display = 'flex';
    $('app').classList.remove('hidden');
    $('bottom-bar').classList.remove('hidden');
    $('login-error').textContent = '';
    if (!this._apiKey && !localStorage.getItem('grindpal_apikey_enc') && !localStorage.getItem('grindpal_apikey')) {
      setTimeout(() => toast('👋 Please click Settings to configure your API Key', 'info'), 500);
    }
    this._randomTitle();
    this._tavernStart();
    this._loadTemplates();  // 预加载模板缓存
    this._refreshTodos();    // 刷新待办角标
    setTimeout(() => this._checkTodoReminders(), 2000);  // 登录后拉通知
    setTimeout(() => ChatApp.init(), 500);  // 初始化自由对话
    // 检测 OCR 可选依赖
    // OCR 状态检查已静默（避免控制台噪音）
    // fetch('/api/v1/health').then(r => r.json()).then(d => {
    //   if (d.data && !d.data.ocr_available) {
    //     console.log('PaddleOCR 未安装，图片/扫描件文字识别不可用。安装: pip install paddlepaddle paddleocr');
    //   }
    // }).catch(() => {});
  },

  /** 会话过期时弹出密码重输框，重新登录后继续使用，不丢失当前状态 */
  _showReAuthDialog() {
    // 防止重复弹出
    if (document.getElementById('reauth-overlay')) return;
    const username = this._username || localStorage.getItem('grindpal_username') || '';
    const overlay = document.createElement('div');
    overlay.id = 'reauth-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    overlay.innerHTML = `<div style="background:var(--color-card);border-radius:var(--radius-lg);padding:32px 28px;max-width:400px;width:90vw;box-shadow:var(--shadow-lg);text-align:center">
      <span class="material-icons" style="font-size:40px;color:var(--color-warning);margin-bottom:12px">lock_clock</span>
      <h3 style="margin:0 0 8px;font-size:18px;color:var(--color-text)">${t('login.sessionExpired') || '会话已过期'}</h3>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:20px">${t('login.reauthHint') || '请重新输入密码以继续'}${username ? '（' + this._escapeHtml(username) + '）' : ''}</p>
      <input type="password" id="reauth-password" placeholder="${t('login.password') || '密码'}" style="width:100%;padding:12px;border:2px solid var(--color-border);border-radius:var(--radius-sm);font-size:15px;outline:none;margin-bottom:12px;box-sizing:border-box;background:var(--color-bg);color:var(--color-text)" onkeydown="if(event.key==='Enter')document.getElementById('reauth-submit').click()">
      <p id="reauth-error" style="font-size:12px;color:var(--color-error);min-height:18px;margin-bottom:8px"></p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="reauth-submit" class="btn" style="margin:0;padding:10px 32px;font-size:14px">${t('login.submitLogin') || '登录'}</button>
        <button id="reauth-cancel" class="btn btn-secondary" style="margin:0;padding:10px 24px;font-size:14px">${t('app.cancel') || '取消'}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const self = this;
    overlay.querySelector('#reauth-cancel').onclick = () => { overlay.remove(); self.logout(); };
    overlay.querySelector('#reauth-submit').onclick = async () => {
      const pw = overlay.querySelector('#reauth-password').value.trim();
      const errEl = overlay.querySelector('#reauth-error');
      if (!pw) { errEl.textContent = t('login.passwordRequired') || '请输入密码'; return; }
      const btn = overlay.querySelector('#reauth-submit');
      btn.disabled = true; btn.textContent = '…';
      try {
        const resp = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: pw }),
        });
        const data = await resp.json();
        if (data.code === 200) {
          self._token = data.data.token;
          sessionStorage.setItem('grindpal_token', self._token);
          document.cookie = `grindpal_token=${self._token}; path=/; max-age=86400; SameSite=Lax`;
          self._masterPassword = pw;
          await self._cacheDerivedKey(pw);
          overlay.remove();
          toast(t('login.loginSuccess') || '登录成功', 'success');
        } else {
          errEl.textContent = data.message || t('login.operationFailed') || '密码错误';
          btn.disabled = false; btn.textContent = t('login.submitLogin') || '登录';
        }
      } catch (e) {
        errEl.textContent = t('login.networkError') || '网络错误';
        btn.disabled = false; btn.textContent = t('login.submitLogin') || '登录';
      }
    };
    // 自动聚焦密码框
    setTimeout(() => { const inp = overlay.querySelector('#reauth-password'); if (inp) inp.focus(); }, 100);
  },

  logout() {
    this._clearAuth();
    this._tavernStop();
    $('login-overlay').classList.remove('hidden');
    $('top-nav').classList.add('hidden');
    $('app').classList.add('hidden');
    $('bottom-bar').classList.add('hidden');
    $('history-panel').classList.remove('show');
    $('settings-overlay').classList.remove('show');
    this._resetAuthView();
  },

  _clearAuth() {
    this._token = null;
    this._username = null;
    this._userId = null;
    this._hasSecurity = false;
    this._securityQuestion = '';
    sessionStorage.removeItem('grindpal_token');
    localStorage.removeItem('grindpal_username');
    localStorage.removeItem('grindpal_user_id');
    localStorage.removeItem('grindpal_has_security');
    localStorage.removeItem('grindpal_security_q');
    // 清除 Cookie
    document.cookie = 'grindpal_token=; path=/; max-age=0; SameSite=Lax';
    // 清除解密的 API Key 缓存
    sessionStorage.removeItem('grindpal_apikey');
    this._apiKey = null;
    this._masterPassword = null;
    // 重置提交锁，防止重新登录后无法操作
    this._streamingEndpoint = null;
    this._streamingResultId = null;
    if (this._abortController) { this._abortController.abort(); this._abortController = null; }
    // 重置聊天流式状态
    if (typeof ChatApp !== 'undefined') {
      ChatApp._streaming = false;
      if (ChatApp._abortController) { ChatApp._abortController.abort(); ChatApp._abortController = null; }
    }
    // 隐藏所有中止按钮
    document.querySelectorAll('.stop-btn').forEach(b => b.style.display = 'none');
    // 关闭加载遮罩
    this._hideLoading();
  },

  // ---- API Key 加密存储 ----
  _masterPassword: null,  // 登录密码明文缓存（仅内存，用于PBKDF2派生AES密钥；logout时清除；生产环境建议用派生CryptoKey）
  _apiKey: null,           // 解密后的 API Key（仅内存）
  _streamingEndpoint: null,  // 当前正在流式的端点（null=无），支持后台流式
  _streamingResultId: null,  // 流式结果容器 ID，切换回来时恢复显示
  _unlockResolve: null,     // Promise resolve 用于解锁弹窗
  _unlockAttempts: 0,       // 密码尝试次数
  _kbCollections: [],       // KB 集合缓存，供 ChatApp 查找名称

  /** 从全局 localStorage 和 _kbCollections 计算 KB 显示名（非聊天工具用） */
  _kbNamesFromGlobal() {
    const kbIds = (localStorage.getItem('grindpal_active_kb') || '').split(',').map(s => parseInt(s.trim())).filter(id => !isNaN(id));
    if (!kbIds.length) return t('chat.kb');
    const first = (this._kbCollections || []).find(c => c.id === kbIds[0]);
    if (first) return first.name + (kbIds.length > 1 ? ' +' + (kbIds.length - 1) : '');
    return t('chat.kb');
  },

  _showLoading(msg) {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    if (text) text.textContent = msg || t('loading.default');
    if (overlay) overlay.classList.add('show');
  },
  _hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('show');
  },

  // ---- 像素酒馆日志 ----
  // 酒馆消息和随机标题已迁移至 locale 文件
  _tavernRecent: [],
  _tavernCoolDown: 15,
  _tavernTimer: null,

  _tavernGold: new Set([20,21,22,27,28]), // 摸鱼/下班/救赎/收获/吉日/准时 相关

  _tavernRandom() {
    const count = 30;
    const avail = [];
    for (let i = 0; i < count; i++) {
      if (!this._tavernRecent.includes(i)) avail.push(i);
    }
    if (avail.length === 0) { this._tavernRecent = []; return this._tavernRandom(); }
    const idx = avail[Math.floor(Math.random() * avail.length)];
    this._tavernRecent.push(idx);
    if (this._tavernRecent.length > this._tavernCoolDown) this._tavernRecent.shift();
    return { msg: t('tavern.msg.' + idx), gold: this._tavernGold.has(idx) };
  },

  _tavernAppend(item) {
    const log = document.getElementById('tavernLog');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (item.gold) entry.classList.add('gold');
    entry.innerHTML = '<span class="prefix">▸</span>' + item.msg;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    // 保持最多 20 条消息（清空按钮不计入）
    const entries = log.getElementsByClassName('log-entry');
    while (entries.length > 20) entries[0].remove();
  },

  tavernRandom() { this._tavernAppend(this._tavernRandom()); },

  _tavernSchedule() {
    if (this._tavernTimer) clearTimeout(this._tavernTimer);
    const delay = 1000 * 60 * (10 + Math.floor(Math.random() * 11)); // 10~20 min
    this._tavernTimer = setTimeout(() => {
      this.tavernRandom();
      this._tavernSchedule();
    }, delay);
  },

  _tavernStart() {
    const enabled = localStorage.getItem('grindpal_tavern') !== '0';
    const hidden = localStorage.getItem('grindpal_tavern_hide') === '1';
    $('settings-tavern').checked = enabled;
    $('settings-tavern-hide').checked = hidden;
    const wrapper = document.getElementById('tavern-wrapper');
    wrapper.style.display = (enabled && !hidden) ? 'block' : 'none';
    if (enabled && !hidden) {
      this._tavernAppend(this._tavernRandom());
      this._tavernSchedule();
    }
    this._tavernDraggable();
    // 恢复拖动位置
    const pos = localStorage.getItem('grindpal_tavern_pos');
    if (pos) {
      const [r, b] = pos.split(',').map(Number);
      wrapper.style.left = 'auto'; wrapper.style.top = 'auto';
      wrapper.style.right = r + 'px'; wrapper.style.bottom = b + 'px';
    }
  },

  _saveTavernSetting() {
    const checked = $('settings-tavern').checked;
    const hidden = $('settings-tavern-hide').checked;
    localStorage.setItem('grindpal_tavern', checked ? '1' : '0');
    localStorage.setItem('grindpal_tavern_hide', hidden ? '1' : '0');
    const wrapper = document.getElementById('tavern-wrapper');
    if (checked && !hidden) {
      wrapper.style.display = 'block';
      this._tavernSchedule();
    } else {
      wrapper.style.display = 'none';
      if (this._tavernTimer) clearTimeout(this._tavernTimer);
    }
  },

  _saveTavernHide() {
    const hidden = $('settings-tavern-hide').checked;
    localStorage.setItem('grindpal_tavern_hide', hidden ? '1' : '0');
    const wrapper = document.getElementById('tavern-wrapper');
    wrapper.style.display = hidden ? 'none' : 'block';
    if (!hidden && $('settings-tavern').checked) this._tavernSchedule();
  },

  _tavernClear() {
    const log = document.getElementById('tavernLog');
    if (log) {
      log.querySelectorAll('.log-entry').forEach(e => e.remove());
    }
  },

  _tavernDraggable() {
    const wrapper = document.getElementById('tavern-wrapper');
    if (!wrapper || wrapper.dataset.draggable) return;
    wrapper.dataset.draggable = '1';

    const makeDraggable = (el, onClick) => {
      let startX, startY, startLeft, startTop, dragging = false, moved = false;
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        startX = e.clientX; startY = e.clientY;
        const rect = el.getBoundingClientRect();
        startLeft = rect.left; startTop = rect.top;
        dragging = true; moved = false;
        el.style.right = 'auto'; el.style.bottom = 'auto';
        el.style.left = startLeft + 'px'; el.style.top = startTop + 'px';
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        moved = true;
        el.style.left = (startLeft + dx) + 'px';
        el.style.top = (startTop + dy) + 'px';
      });
      document.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        if (el === wrapper) {
          if (moved) {
            const right = window.innerWidth - el.offsetLeft - el.offsetWidth;
            const bottom = window.innerHeight - el.offsetTop - el.offsetHeight;
            el.style.left = 'auto'; el.style.top = 'auto';
            el.style.right = right + 'px'; el.style.bottom = bottom + 'px';
            localStorage.setItem('grindpal_tavern_pos', [right, bottom].join(','));
          } else {
            // 无拖动点击：恢复 right/bottom 锚定
            el.style.left = 'auto'; el.style.top = 'auto';
            const pos = localStorage.getItem('grindpal_tavern_pos');
            if (pos) {
              const [r, b] = pos.split(',').map(Number);
              el.style.right = r + 'px'; el.style.bottom = b + 'px';
            } else {
              el.style.right = '8px'; el.style.bottom = '85px';
            }
          }
        }
        if (!moved && onClick) onClick();
        if (!moved && e.target.id === 'tavernBtn') App.tavernRandom();
      });
    };
    makeDraggable(wrapper, null);
  },

  _tavernStop() {
    document.getElementById('tavern-wrapper').style.display = 'none';
    if (this._tavernTimer) clearTimeout(this._tavernTimer);
  },

  // 副标题随机短句
  _subtitlePhrases: [
    "垂直深耕，找到差异化的爆破点。",
    "深挖护城河，构建长期壁垒。",
    "聚焦核心抓手，形成组合拳。",
    "定义清楚边界，建立清晰路径",
    "打通信息链路，确保认知同频。",
    "抽离表象，看到更深层的本质。",
    "感知力不够，要建立全局视野。",
    "强化用户心智，占领认知高地。",
    "我们要把价值链条彻底做透。",
    "全链路渗透，完成端到端交付。",
    "打破部门墙，串联起业务孤岛。",
    "倒逼流程优化，释放冗余产能。",
    "盘一下现有资源，盘活存量市场。",
    "提炼核心卖点，放大声量传播。",
    "我们需要快速迭代，小步快跑。",
    "这套方法论需要快速复用落地。",
    "对齐一下颗粒度，拉通一下底层逻辑。",
    "夯实中台能力，支撑前台敏捷迭代。",
    "做好预期管理，对齐交付标准。",
    "打好这场关键战役，要有结果。"
  ],

  _randomTitle() {
    const idx = Math.floor(Math.random() * 20);
    const msg = t('titleMsg.' + idx);
    document.title = msg && msg !== 'titleMsg.' + idx ? msg : t('app.version');
    this._randomSubtitle();
  },

  _randomSubtitle() {
    const idx = Math.floor(Math.random() * 20);
    const sub = t('subtitle.' + idx);
    const el = document.getElementById('login-subtitle');
    if (el) el.textContent = '\u300C' + sub + '\u300D';
  },

  async getApiKey() {
    // 1. 内存缓存 → 直接返回
    if (this._apiKey) return this._apiKey;
    // 2. sessionStorage 明文缓存（刷新保留，关标签页清除）
    const cached = sessionStorage.getItem('grindpal_apikey');
    if (cached) { this._apiKey = cached; return cached; }

    // 3. 检查是否有加密的 Key
    const encJson = localStorage.getItem('grindpal_apikey_enc');
    if (encJson) {
      try {
        const encData = JSON.parse(encJson);
        // 验证格式完整性
        if (!encData.iv || !encData.ciphertext || !(encData.kdfSalt || encData.salt)) {
          throw new Error('Invalid format');
        }
        // 有加密 Key，需要密码解锁
        return new Promise((resolve) => {
          this._unlockResolve = resolve;
          this._unlockAttempts = 0;
          $('unlock-password').value = '';
          $('unlock-password').style.display = '';
          $('unlock-error').textContent = '';
          const vb = $('unlock-verify-btn'); if (vb) vb.style.display = 'none';
          $('unlock-overlay').style.display = 'flex';
          $('unlock-password').focus();
        });
      } catch (e) {
        // 加密数据损坏，清除并回退
        console.warn(t('error.apiKeyCleared'), e);
        localStorage.removeItem('grindpal_apikey_enc');
      }
    }

    // 3. 检查旧明文 Key（向后兼容，未登录时直接返回）
    const oldPlain = localStorage.getItem('grindpal_apikey');
    return oldPlain || '';
  },

  /** 设置 API Key：加密后存储，明文缓存到 sessionStorage */
  async setApiKey(plaintext) {
    if (!plaintext) {
      // 清空
      localStorage.removeItem('grindpal_apikey_enc');
      localStorage.removeItem('grindpal_apikey');
      sessionStorage.removeItem('grindpal_apikey');
      this._apiKey = null;
      return;
    }
    // 需要派生密钥来加密
    if (!this._masterPassword) {
      // 未登录或不支持加密，回退到 sessionStorage 明文缓存
      sessionStorage.setItem('grindpal_apikey', plaintext);
      this._apiKey = plaintext;
      return;
    }
    try {
      const encJson = await CryptoUtils.encryptWithPassword(plaintext, this._masterPassword);
      localStorage.setItem('grindpal_apikey_enc', encJson);
      sessionStorage.setItem('grindpal_apikey', plaintext);
      this._apiKey = plaintext;
      // 删除旧明文 Key
      localStorage.removeItem('grindpal_apikey');
      // 同步到服务端
      this._syncApiKeyToServer(encJson);
    } catch (e) {
      console.error('API Key 加密失败，回退 sessionStorage', e);
      sessionStorage.setItem('grindpal_apikey', plaintext);
      this._apiKey = plaintext;
    }
  },

  /** 缓存登录密码用于 PBKDF2 派生（仅内存，logout 时清除） */
  async _cacheDerivedKey(password) {
    try {
      this._masterPassword = password;
    } catch (e) {
      console.error('派生密钥缓存失败', e);
    }
  },

  /** 将加密的 API Key 同步到服务端 */
  async _syncApiKeyToServer(encJson) {
    if (!this._token) return;
    try {
      await fetch(`${API_BASE}/preferences/api-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._token}` },
        body: JSON.stringify({ encrypted_key: encJson })
      });
    } catch (e) { /* 网络错误，静默忽略 */ }
  },

  async _confirmUnlock() {
    const password = $('unlock-password').value;
    if (!password) {
      $('unlock-error').textContent = t('unlock.error');
      return;
    }
    this._unlockAttempts++;
    try {
      const encJson = localStorage.getItem('grindpal_apikey_enc');
      const encData = JSON.parse(encJson);
      const plaintext = await CryptoUtils.decrypt(encData, password);
      // 解密成功
      sessionStorage.setItem('grindpal_apikey', plaintext);
      this._apiKey = plaintext;
      // 缓存派生密钥以便后续 setApiKey 使用
      await this._cacheDerivedKey(password);
      $('unlock-overlay').style.display = 'none';
      if (this._unlockResolve) {
        this._unlockResolve(plaintext);
        this._unlockResolve = null;
      }
    } catch (e) {
      console.warn('API Key 解密失败', e);
      if (this._unlockAttempts >= 3) {
        // 不消 Key，提供密保验证入口
        $('unlock-error').textContent = t('unlock.securityHint');
        $('unlock-password').style.display = 'none';
        // 显示密保验证按钮
        let verifyBtn = $('unlock-verify-btn');
        if (!verifyBtn) {
          verifyBtn = document.createElement('button');
          verifyBtn.id = 'unlock-verify-btn';
          verifyBtn.className = 'btn';
          verifyBtn.style.cssText = 'flex:1;margin:0;font-size:14px;background:var(--color-accent)';
          verifyBtn.textContent = t('unlock.verifySecurity');
          verifyBtn.onclick = () => this._unlockViaSecurity();
          const btnRow = document.querySelector('#unlock-dialog div:last-child');
          if (btnRow) btnRow.insertBefore(verifyBtn, btnRow.firstChild);
        } else {
          verifyBtn.style.display = '';
        }
      } else {
        $('unlock-error').textContent = t('unlock.attemptsLeft').replace('{n}', String(3 - this._unlockAttempts));
        $('unlock-password').value = '';
        $('unlock-password').focus();
      }
    }
  },

  _cancelUnlock() {
    $('unlock-overlay').style.display = 'none';
    if (this._unlockResolve) {
      this._unlockResolve('');
      this._unlockResolve = null;
    }
  },

  async _unlockViaSecurity() {
    const username = this._username || localStorage.getItem('grindpal_username') || '';
    if (!username) { toast(t('toast.fetchFail'), 'error'); return; }
    try {
      // 1. 获取密保问题
      const r1 = await fetch(`${API_BASE}/auth/forgot-question`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username})
      });
      const d1 = await r1.json();
      if (d1.code !== 200) { toast(d1.message || t('login.noSecurityQuestion'), 'error'); return; }
      // 2. 弹窗输入答案
      const answer = await new Promise((resolve) => {
        App._showPrompt(d1.data.question, t('login.securityAnswer'), '', resolve, () => resolve(null));
      });
      if (!answer) return;
      // 3. 验证密保答案
      const r2 = await fetch(`${API_BASE}/auth/verify-security`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username, answer})
      });
      const d2 = await r2.json();
      if (d2.code !== 200) { toast(d2.message || t('login.resetFailed'), 'error'); return; }
      // 4. 使用登录时缓存的密码解密 API Key
      $('unlock-overlay').style.display = 'none';
      if (this._masterPassword) {
        try {
          const encJson = localStorage.getItem('grindpal_apikey_enc');
          if (encJson) {
            const encData = JSON.parse(encJson);
            const plaintext = await CryptoUtils.decrypt(encData, this._masterPassword);
            sessionStorage.setItem('grindpal_apikey', plaintext);
            this._apiKey = plaintext;
          }
        } catch(e) { toast(t('unlock.tooMany'), 'warning'); }
      }
      if (this._unlockResolve) {
        this._unlockResolve(this._apiKey || '');
        this._unlockResolve = null;
      }
    } catch(e) { toast(t('toast.networkError'), 'error'); }
  },

  _authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    try { headers['Accept-Language'] = getLang(); } catch(e) {}
    // 附带 API Key（聊天等需要）
    const key = this._apiKey || '';
    if (key) headers['X-Api-Key'] = key;
    return headers;
  },

  toggleDarkMode() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    const btn = $('dark-toggle');
    const lbl = $('dark-label');
    if (isDark) {
      html.removeAttribute('data-theme');
      if (lbl) lbl.textContent = t('app.theme.dark');
      btn.querySelector('.material-icons').textContent = 'light_mode';
      localStorage.setItem('grindpal_theme', 'light');
    } else {
      html.setAttribute('data-theme', 'dark');
      if (lbl) lbl.textContent = t('app.theme.light');
      btn.querySelector('.material-icons').textContent = 'dark_mode';
      localStorage.setItem('grindpal_theme', 'dark');
    }
    this._syncPreferences();
  },

  toggleLanguage() {
    const cur = getLang();
    setLang(cur === 'zh-CN' ? 'en-US' : 'zh-CN');
    // Update language dropdown
    const sel = $('settings-lang');
    if (sel) sel.value = getLang();
    // Update dark mode label too
    const dlbl = $('dark-label');
    if (dlbl) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      dlbl.textContent = isDark ? t('app.theme.light') : t('app.theme.dark');
    }
    // Update model options (have Chinese pricing info)
    this._refreshModelOptions();
    // Refresh settings model note
    const mNote = document.querySelector('#settings-tab-api .model-note');
    if (mNote && mNote.textContent.includes('推荐')) mNote.textContent = t('settings.model.note');
    // Refresh chat input placeholder (textarea 可能未被 _refreshDOM 覆盖)
    const chatInput = $('chat-input');
    if (chatInput) chatInput.placeholder = t('chat.placeholder');
    // Refresh the page title
    this._randomTitle();
  },

  _refreshI18n() {
    // Refresh dynamic text that can't use data-i18n attributes
    // Model select options
    this._refreshModelOptions();
    // Settings style select
    this._refreshStyleOptions();
    // Reminder select
    this._refreshReminderOptions();
    // Dark mode label
    const dlbl = $('dark-label');
    if (dlbl) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      dlbl.textContent = isDark ? t('app.theme.light') : t('app.theme.dark');
    }
    // Language dropdown
    const lsel = $('settings-lang');
    if (lsel) lsel.value = getLang();
    // Page title
    this._randomTitle();
    // Subtitle
    this._randomSubtitle();
    // Refresh minutes language button
    const langBtn = $('lang-btn');
    if (langBtn && Modules.minutes) {
      Modules.minutes._language = getLang() === 'en-US' ? 'en' : 'zh';
      const labels = { zh: '🇨🇳 中文', en: '🇬🇧 English', auto: '🌐 中英' };
      langBtn.textContent = labels[Modules.minutes._language] || '🇨🇳 中文';
    }
    // Clear tavern log on language switch (old entries in wrong language)
    const tLog = document.getElementById('tavernLog');
    if (tLog) tLog.innerHTML = '';
    // Refresh changelog if visible
    const chOverlay = document.getElementById('changelog-overlay');
    if (chOverlay && chOverlay.style.display === 'flex') this._renderChangelog();
    // Refresh settings model note
    const mNote = document.querySelector('#settings-tab-api .model-note');
    if (mNote) {
      const model = $('settings-model')?.value || '';
      if (model.includes('flash') || model.includes('pro')) mNote.textContent = t('settings.model.note');
    }
    // Refresh any select options that need i18n
    this._refreshEmailTone();
  },

  _refreshModelOptions() {
    const sel = $('settings-model');
    if (!sel) return;
    const val = sel.value;
    sel.options[0] = new Option(t('settings.model.v4flash'), 'deepseek-v4-flash');
    sel.options[1] = new Option(t('settings.model.v4pro'), 'deepseek-v4-pro');
    sel.options[2] = new Option(t('settings.model.chat'), 'deepseek-chat');
    sel.options[3] = new Option(t('settings.model.reasoner'), 'deepseek-reasoner');
    sel.value = val;
  },

  _refreshStyleOptions() {
    const sel = $('settings-style');
    if (!sel) return;
    const val = sel.value;
    sel.options[0] = new Option(t('settings.style.natural'), 'natural');
    sel.options[1] = new Option(t('settings.style.standard'), 'standard');
    sel.options[2] = new Option(t('settings.style.formal'), 'formal');
    sel.value = val;
  },

  _refreshReminderOptions() {
    const sel = $('settings-reminder');
    if (!sel) return;
    const val = sel.value;
    sel.options[0] = new Option(t('settings.reminder.5min'), '5');
    sel.options[1] = new Option(t('settings.reminder.10min'), '10');
    sel.options[2] = new Option(t('settings.reminder.15min'), '15');
    sel.options[3] = new Option(t('settings.reminder.30min'), '30');
    sel.options[4] = new Option(t('settings.reminder.1hour'), '60');
    sel.options[5] = new Option(t('settings.reminder.today'), '0');
    sel.value = val;
  },

  _refreshEmailTone() {
    const sel = $('email-tone');
    if (!sel) return;
    const val = sel.value;
    sel.options[0] = new Option(t('mod.email.tone.formal'), 'formal');
    sel.options[1] = new Option(t('mod.email.tone.friendly'), 'friendly');
    sel.options[2] = new Option(t('mod.email.tone.professional'), 'professional');
    sel.value = val;
  },

  // ---- 背景图 IndexedDB 存储（比 localStorage 大得多） ----
  _bgDB: null,
  async _bgDB_() {
    if (this._bgDB) return this._bgDB;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('grindpal_settings', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('bg', { keyPath: 'k' }); };
      req.onsuccess = () => { this._bgDB = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  },
  async _bgSave(k, v) {
    const db = await this._bgDB_();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('bg', 'readwrite');
      tx.objectStore('bg').put({ k, v });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
  async _bgLoad(k) {
    const db = await this._bgDB_();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('bg', 'readonly');
      const r = tx.objectStore('bg').get(k);
      r.onsuccess = () => resolve(r.result?.v ?? null);
      r.onerror = () => reject(r.error);
    });
  },
  async _bgDelete(k) {
    const db = await this._bgDB_();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('bg', 'readwrite');
      tx.objectStore('bg').delete(k);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async uploadBackground() {
    const input = $('settings-bg');
    const file = input.files[0];
    if (!file) return;
    toast(t('toast.backgroundProcessing') || '处理中…', 'info');
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        const maxW = 1600, maxH = 1200;
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const url = canvas.toDataURL('image/jpeg', 0.7);
        try {
          await this._bgSave('bg', url);
          await this._bgSave('bg_name', file.name);
        } catch (_) {
          toast(t('toast.backgroundTooLarge') || '保存失败，请尝试更小的图片', 'error');
          return;
        }
        const layer = $('bg-layer');
        if (!layer) return;
        layer.style.backgroundImage = `url("${url}")`;
        layer.classList.add('show');
        $('bg-preview').style.display = 'flex';
        $('bg-thumb').src = url;
        $('bg-name').textContent = file.name;
        App._syncPreferences();
        toast(t('toast.backgroundSet'), 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  },

  async clearBackground() {
    const layer = $('bg-layer');
    layer.style.backgroundImage = '';
    layer.classList.remove('show');
    await this._bgDelete('bg');
    await this._bgDelete('bg_name');
    $('settings-bg').value = '';
    $('bg-preview').style.display = 'none';
    this._syncPreferences();
    toast(t('toast.backgroundCleared'), 'info');
  },

  async _syncPreferences() {
    if (!this._token) return;
    try {
      const prefs = {
        theme: localStorage.getItem('grindpal_theme') || 'light',
        model: localStorage.getItem('grindpal_model') || 'deepseek-v4-flash',
        style: localStorage.getItem('grindpal_style') || 'standard',
      };
      await fetch(`${API_BASE}/auth/preferences`, {
        method: 'PUT',
        headers: this._authHeaders(),
        body: JSON.stringify({ preferences: prefs }),
      });
    } catch (e) {}
  },

  async deleteAccount() {
    this._showConfirm(t('account.deleteConfirm1'), () => {
      this._showConfirm(t('account.deleteConfirm2'), async () => {
        try {
          const resp = await fetch(`${API_BASE}/auth/account`, {
            method: 'DELETE',
            headers: this._authHeaders(),
          });
          const data = await resp.json();
          if (data.code === 200) {
            toast(t('account.deleted'), 'info');
            this.logout();
          } else {
            toast(data.message || t('account.deleteFail'), 'error');
          }
        } catch (e) {
          toast(t('toast.networkError'), 'error');
        }
      });
    });
  },

  async changePassword() {
    const oldPw = $('settings-oldpw').value;
    const newPw = $('settings-newpw').value;
    const newPw2 = $('settings-newpw2').value;
    const msg = $('pw-msg');
    if (!oldPw || !newPw) { msg.textContent = t('account.fillAllFields'); msg.style.color = 'var(--color-error)'; return; }
    if (newPw !== newPw2) { msg.textContent = t('account.pwMismatch'); msg.style.color = 'var(--color-error)'; return; }
    if (newPw.length < 4) { msg.textContent = t('account.pwTooShort'); msg.style.color = 'var(--color-error)'; return; }
    try {
      const resp = await fetch(`${API_BASE}/auth/password`, {
        method: 'PUT',
        headers: this._authHeaders(),
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      });
      const data = await resp.json();
      if (data.code === 200) {
        msg.textContent = t('account.pwSuccess');
        msg.style.color = 'var(--color-success)';
        // 用新密码重新加密 API Key
        try {
          const encJson = localStorage.getItem('grindpal_apikey_enc');
          if (encJson) {
            const encData = JSON.parse(encJson);
            const plaintext = await CryptoUtils.decrypt(encData, oldPw);
            const newEncJson = await CryptoUtils.encryptWithPassword(plaintext, newPw);
            localStorage.setItem('grindpal_apikey_enc', newEncJson);
            sessionStorage.setItem('grindpal_apikey', plaintext);
            this._apiKey = plaintext;
            // 更新缓存的派生密钥
            this._masterPassword = newPw;
          }
        } catch (e) {
          // 解密失败（密码上下文丢失），清空加密 Key
          console.warn('API Key 重加密失败，已清除加密 Key', e);
          localStorage.removeItem('grindpal_apikey_enc');
          this._apiKey = null;
          toast(t('error.apiKeyReEncrypt'), 'warning');
        }
        $('settings-oldpw').value = $('settings-newpw').value = $('settings-newpw2').value = '';
      } else {
        msg.textContent = data.message || data.detail || t('account.pwFail');
        msg.style.color = 'var(--color-error)';
      }
    } catch (e) {
      msg.textContent = t('account.pwNetworkError');
      msg.style.color = 'var(--color-error)';
    }
  },

  async setSecurity() {
    const question = ($('settings-security-q')?.value || '').trim();
    const answer = ($('settings-security-a')?.value || '').trim();
    const msg = $('sec-msg');
    if (!question) { msg.textContent = t('account.securityQRequired'); msg.style.color = 'var(--color-error)'; return; }
    if (!answer || answer.length < 2) { msg.textContent = t('account.securityAnswerTooShort'); msg.style.color = 'var(--color-error)'; return; }
    try {
      const resp = await fetch(`${API_BASE}/auth/security`, {
        method:'PUT', headers:{...this._authHeaders(),'Content-Type':'application/json'},
        body: JSON.stringify({question, answer}),
      });
      const d = await resp.json();
      if (d.code === 200) {
        msg.textContent = t('account.securitySaved'); msg.style.color = 'var(--color-success)';
        this._hasSecurity = true;
        this._securityQuestion = question;
        localStorage.setItem('grindpal_has_security', '1');
        localStorage.setItem('grindpal_security_q', question);
        this._refreshSecurityBtn();
        $('settings-security-a').value = '';
      } else {
        msg.textContent = d.message || t('account.securitySaveFail'); msg.style.color = 'var(--color-error)';
      }
    } catch(e) { msg.textContent = 'Network error'; msg.style.color = 'var(--color-error)'; }
  },

  _refreshSecurityBtn() {
    const btn = document.querySelector('#settings-tab-account button[onclick*="setSecurity"]');
    if (!btn) return;
    if (this._hasSecurity) {
      btn.textContent = t('account.modifySecurity');
      btn.className = 'btn btn-secondary';
      btn.style.marginTop = '6px';
    } else {
      btn.textContent = t('account.saveSecurity');
    }
  },

  switchTab(tab) {
    // 如果当前有后台流式任务，不中止它 —— 让它继续在后台运行
    // 用户切换回来时会自动恢复显示
    const streamingTab = this._streamingEndpoint ? this._endpointToTab(this._streamingEndpoint) : null;
    
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tool-section').forEach(s => s.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    const section = document.getElementById(`section-${tab}`);
    if (section) section.classList.add('active');
    
    // 切换回正在后台流式的 tab 时，确保结果容器可见
    if (streamingTab && tab === streamingTab && this._streamingResultId) {
      const resultBox = document.getElementById(this._streamingResultId);
      if (resultBox) {
        resultBox.classList.add('show');
        resultBox.classList.remove('thinking');
      }
    }
    
    // 后台流式指示：给正在流式的 nav tab 加脉冲标记
    document.querySelectorAll('.nav-tab .streaming-dot').forEach(d => d.remove());
    if (streamingTab && tab !== streamingTab) {
      const streamingBtn = document.querySelector(`[data-tab="${streamingTab}"]`);
      if (streamingBtn && !streamingBtn.querySelector('.streaming-dot')) {
        const dot = document.createElement('span');
        dot.className = 'streaming-dot';
        dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--color-accent);margin-left:4px;animation:pulse-dot 1.2s infinite;vertical-align:middle;';
        streamingBtn.appendChild(dot);
      }
    }
    
    if (tab === 'chat') {
      // 刷新 chat input placeholder（确保语言切换后正确）
      const ci = $('chat-input');
      if (ci && ci.getAttribute('data-i18n-placeholder') === 'chat.placeholder') ci.placeholder = t('chat.placeholder');
      if (!ChatApp._currentConvId && !ChatApp._loading) {
        setTimeout(() => ChatApp.init(), 100);
      } else {
        setTimeout(() => ChatApp.loadConversations(), 100);
      }
    }
  },

  /** 将 API 端点映射到 tab 名称 */
  _endpointToTab(endpoint) {
    const m = {
      '/summarize': 'summarize', '/write-email': 'email', '/meeting-minutes': 'minutes',
      '/polish-report': 'polish', '/report-ese': 'reportese', '/requirements': 'requirements',
      '/prd': 'prd', '/ppt-outline': 'ppt', '/weekly-report': 'weeklyreport'
    };
    return m[endpoint] || endpoint.replace('/', '');
  },

  switchSettingsTab(tab) {
    document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
    $('stab-' + tab).classList.add('active');
    $('settings-tab-api').style.display = tab === 'api' ? 'block' : 'none';
    $('settings-tab-account').style.display = tab === 'account' ? 'block' : 'none';
    const tEl = $('settings-tab-templates');
    if (tEl) tEl.style.display = tab === 'templates' ? 'block' : 'none';
    const kbEl = $('settings-tab-kb');
    if (kbEl) kbEl.style.display = tab === 'kb' ? 'block' : 'none';
    if (tab === 'templates') this._loadTemplates();
    if (tab === 'kb') this._loadKBs();
  },

  _setUILang(lang) {
    if (getLang() === lang) return;
    setLang(lang);
    const sel = $('settings-lang');
    if (sel) sel.value = lang;
    toast(lang === 'zh-CN' ? '已切换为中文' : 'Switched to English', 'success');
  },

  // ---- V0.4: 风格选择器 -----------------
  _templateCache: null,

  async _loadStyleSelectors() {
    try {
      const r = await fetch(API_BASE + '/templates', { headers: this._authHeaders() });
      const d = await r.json();
      if (d.code !== 200) return;
      const templates = d.data.templates;
      this._templateCache = {};
      templates.forEach(t => { this._templateCache[t.id] = t.system_prompt; localStorage.setItem('grindpal_style_prompt_' + t.id, t.system_prompt); });
      ['summarize','email','minutes','polish','reportese','requirements','prd','ppt-outline','weeklyreport'].forEach(mod => {
        const row = document.getElementById('style-row-' + mod);
        const sel = document.getElementById('style-select-' + mod);
        if (!row || !sel) return;
        const modTemplates = templates.filter(t => {
          const mods = JSON.parse(t.modules || '[]');
          return mods.length === 0 || mods.includes(mod);
        });
        if (modTemplates.length === 0) return;
        row.style.display = 'block';
        sel.innerHTML = '<option value="">默认</option>';
        const saved = localStorage.getItem('grindpal_style_' + mod);
        modTemplates.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.name + (t.is_default ? ' ⭐' : '');
          if (String(t.id) === saved) opt.selected = true;
          sel.appendChild(opt);
        });
      });
    } catch (e) {}
  },

  setStyle(module, templateId) {
    if (templateId) localStorage.setItem('grindpal_style_' + module, templateId);
    else localStorage.removeItem('grindpal_style_' + module);
  },

  // ---- V0.4: 提取待办 + 追问 -----------------
  async _extractTodosFromResult(resultId) {
    const text = document.getElementById(resultId)?.textContent?.trim();
    if (!text) return toast('Please generate content first', 'error');
    const key = await this.getApiKey();
    try {
      this._showLoading(t('loading.extracting'));
      const resp = await fetch(`${API_BASE}/extract-todos`, {
        method: 'POST',
        headers: { ...this._authHeaders(), 'Content-Type': 'application/json', 'X-Api-Key': key },
        body: JSON.stringify({ text: text.substring(0, 20000) }),
      });
      const d = await resp.json();
      if (d.code === 200) {
        const todos = d.data.todos || [];
        if (todos.length === 0) {
          toast('No action items detected. Add manually.', 'info');
          this._openTodoEditor([]);
        } else {
          this._openTodoEditor(todos);
        }
      }
      else toast(d.message || 'Extraction failed', 'error');
      this._hideLoading();
    } catch (e) { this._hideLoading(); toast('Extraction failed', 'error'); }
  },

  // ---- 待办审核编辑弹窗 ----
  _openTodoEditor(todos) {
    // 检查哪些待办缺少必填字段
    const needsAttention = todos.map(t => ({
      ...t,
      _noDeadline: !t.deadline || t.deadline === '待定' || t.deadline === '',
      _noTask: !t.task || t.task === '',
    }));
    const hasIssues = needsAttention.some(t => t._noDeadline || t._noTask);

    const overlay = document.createElement('div');
    overlay.id = 'todo-editor-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);

    const renderRows = (items) => items.map((t, i) => `
      <div class="todo-edit-row" style="background:var(--color-bg);border-radius:10px;padding:12px;margin-bottom:10px;position:relative;border:2px solid ${(t._noTask||t._noDeadline)?'var(--color-error)':'var(--color-border)'}">
        <textarea class="todo-edit-task" placeholder="${t('todos.taskPlaceholder')}" rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-family:inherit;line-height:1.5;outline:none;resize:vertical;box-sizing:border-box;display:block">${this._escapeHtml(t.task || '')}</textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <span style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;display:flex;align-items:center;gap:2px"><span class="material-icons" style="font-size:14px">calendar_today</span>截止</span>
          <input type="datetime-local" class="todo-edit-deadline" value="${this._escapeHtml(t.deadline === '待定' ? '' : (t.deadline || ''))}" style="flex:1;min-width:140px;padding:6px 8px;border:1px solid ${t._noDeadline?'var(--color-error)':'var(--color-border)'};border-radius:6px;font-size:13px;font-family:inherit;outline:none">
          <span style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;display:flex;align-items:center;gap:2px"><span class="material-icons" style="font-size:14px">person</span>负责人</span>
          <input type="text" class="todo-edit-assignee" value="${this._escapeHtml(t.assignee || '')}" placeholder="${t('todos.optional')}" style="flex:1;min-width:80px;padding:6px 8px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-family:inherit;outline:none">
        </div>
        <span class="material-icons" onclick="this.closest('.todo-edit-row').remove()" style="position:absolute;top:8px;right:8px;cursor:pointer;color:var(--color-text-muted);font-size:18px" title="删除">close</span>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div style="background:var(--color-card);color:var(--color-text);border-radius:var(--radius-lg);padding:24px 28px;max-width:700px;width:95vw;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">
        <h3 style="margin:0 0 4px;font-size:18px;display:flex;align-items:center;gap:8px">
          <span class="material-icons">checklist</span>${t('todos.reviewTitle')}
        </h3>
        <p style="font-size:12px;color:var(--color-text-muted);margin:0 0 16px">
          ${hasIssues ? '<span style="color:var(--color-error)">'+t('todos.reviewHint')+'</span>' : t('todos.reviewNormal')}
        </p>
        <div id="todo-editor-rows">${renderRows(needsAttention)}</div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button onclick="App._todoEditorAddRow()" style="padding:8px 16px;font-size:13px;border:2px dashed var(--color-border);background:transparent;color:var(--color-text-secondary);border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px">
            <span class="material-icons" style="font-size:16px">add</span>${t('todos.addTodo')}
          </button>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
          <button onclick="document.getElementById('todo-editor-overlay').remove()" style="padding:8px 20px;font-size:14px;background:transparent;color:var(--color-text-secondary);border:2px solid var(--color-border);border-radius:8px;cursor:pointer">${t('app.cancel')}</button>
          <button onclick="App._todoEditorSave()" style="padding:8px 24px;font-size:14px;margin:0;background:var(--color-primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">${t('todos.saveAll')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  },

  _todoEditorAddRow() {
    const container = document.getElementById('todo-editor-rows');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'todo-edit-row';
    row.style.cssText = 'background:var(--color-bg);border-radius:10px;padding:12px;margin-bottom:10px;position:relative;border:2px solid var(--color-border)';
    row.innerHTML = `
      <textarea class="todo-edit-task" placeholder="任务内容 *" rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-family:inherit;line-height:1.5;outline:none;resize:vertical;box-sizing:border-box;display:block"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <span style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;display:flex;align-items:center;gap:2px"><span class="material-icons" style="font-size:14px">calendar_today</span>截止</span>
        <input type="datetime-local" class="todo-edit-deadline" style="flex:1;min-width:140px;padding:6px 8px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-family:inherit;outline:none">
        <span style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;display:flex;align-items:center;gap:2px"><span class="material-icons" style="font-size:14px">person</span>负责人</span>
        <input type="text" class="todo-edit-assignee" placeholder="${t('todos.optional')}" style="flex:1;min-width:80px;padding:6px 8px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-family:inherit;outline:none">
      </div>
      <span class="material-icons" onclick="this.closest('.todo-edit-row').remove()" style="position:absolute;top:8px;right:8px;cursor:pointer;color:var(--color-text-muted);font-size:18px" title="删除">close</span>`;
    container.appendChild(row);
  },

  async _todoEditorSave() {
    const rows = document.querySelectorAll('#todo-editor-rows .todo-edit-row');
    const todos = [];
    let hasError = false;
    rows.forEach(row => {
      const task = row.querySelector('.todo-edit-task')?.value?.trim() || '';
      const deadline = row.querySelector('.todo-edit-deadline')?.value?.trim() || '';
      const assignee = row.querySelector('.todo-edit-assignee')?.value?.trim() || '';
      // 高亮缺失的必填项
      const taskEl = row.querySelector('.todo-edit-task');
      const deadlineEl = row.querySelector('.todo-edit-deadline');
      if (!task) { taskEl.style.borderColor = 'var(--color-error)'; hasError = true; }
      else { taskEl.style.borderColor = 'var(--color-border)'; }
      if (!deadline) { deadlineEl.style.borderColor = 'var(--color-error)'; hasError = true; }
      else { deadlineEl.style.borderColor = 'var(--color-border)'; }
      if (!task || !deadline) return;
      todos.push({ task, deadline, assignee });
    });
    if (hasError) { toast(t('toast.fillAllRequired'), 'error'); return; }
    if (todos.length === 0) { toast(t('toast.needAtLeastOne'), 'error'); return; }

    let saved = 0;
    for (const t of todos) {
      try {
        await fetch(`${API_BASE}/todos`, {
          method: 'POST',
          headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(t),
        });
        saved++;
      } catch (e) {}
    }
    document.getElementById('todo-editor-overlay')?.remove();
    toast('Saved ' + saved + ' todo(s)', 'success');
    this._refreshTodos();
  },

  async _continueFromHistory(recordId, recordType) {
    // 弹窗输入追问内容
    const overlay = document.createElement('div');
    overlay.id = 'continue-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
    overlay.innerHTML = `
      <div style="background:var(--color-card);color:var(--color-text);border-radius:var(--radius-lg);padding:24px 28px;max-width:480px;width:90vw" onclick="event.stopPropagation()">
        <h3 style="margin:0 0 12px;font-size:17px;display:flex;align-items:center;gap:8px"><span class="material-icons">chat_bubble</span>${t('history.continue')}</h3>
        <textarea id="continue-instruction" placeholder="${t('history.continuePlaceholder')}" rows="3" style="width:100%;padding:10px 12px;border:2px solid var(--color-border);border-radius:8px;font-size:14px;font-family:inherit;line-height:1.5;outline:none;resize:vertical;box-sizing:border-box;margin-bottom:14px"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('continue-overlay').remove()" style="padding:8px 20px;font-size:14px;background:transparent;color:var(--color-text-secondary);border:2px solid var(--color-border);border-radius:8px;cursor:pointer">${t('app.cancel')}</button>
          <button onclick="App._submitContinue(${recordId},'${String(recordType).replace(/'/g,"\\'").replace(/\\/g,"\\\\")}')" style="padding:8px 24px;font-size:14px;background:var(--color-primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">${t('history.apply')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  },

  async _submitContinue(recordId, recordType) {
    const instruction = document.getElementById('continue-instruction')?.value?.trim();
    if (!instruction) { toast(t('history.continueRequired'), 'error'); return; }
    document.getElementById('continue-overlay')?.remove();
    try {
      this._showLoading(t('loading.default'));
      const key = await this.getApiKey();
      const model = localStorage.getItem('grindpal_model') || 'deepseek-v4-flash';
      const resp = await fetch(`${API_BASE}/continue`, {
        method: 'POST',
        headers: { ...this._authHeaders(), 'Content-Type': 'application/json', 'X-Api-Key': key, 'X-Model': model },
        body: JSON.stringify({ record_id: recordId, instruction }),
      });
      const d = await resp.json();
      if (d.code === 200) {
        const typeTab = { summarize:'summarize', email:'email', minutes:'minutes', polish:'polish', reportese:'reportese', requirements:'requirements', prd:'prd', 'ppt-outline':'ppt', 'weekly-report':'weeklyreport' };
        const tab = typeTab[recordType] || 'summarize';
        this.switchTab(tab);
        const rb = $(tab + '-result');
        if (rb) { rb.innerHTML = this._renderMd(d.data.result); rb.classList.add('show'); }
        // 显示辅助按钮
        const copyBtn = $(tab + '-copy');
        if (copyBtn) copyBtn.style.display = 'inline-flex';
        const todoBtn = document.getElementById(tab + '-result-todo');
        if (todoBtn) todoBtn.style.display = 'inline-flex';
        toast(t('toast.followUpGenerated'), 'success');
        this._hideLoading();
      } else { toast(d.message || 'Follow-up failed', 'error'); this._hideLoading(); }
    } catch (e) { toast(t('toast.followUpFailed'), 'error'); this._hideLoading(); }
  },

  // ---- V0.4: 提炼为模板 -----------------
  _extractFromResult(moduleType, resultId) {
    const content = document.getElementById(resultId)?.textContent?.trim();
    if (!content) return toast(t('toast.contentFirst'), 'error');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const modName = t('nav.' + moduleType);
    overlay.innerHTML = '<div style="background:var(--color-card);color:var(--color-text);border-radius:var(--radius-lg);padding:28px;max-width:500px;width:90vw" onclick="event.stopPropagation()"><h3 style="margin:0 0 12px;font-size:18px;text-align:center"><span class="material-icons" style="vertical-align:middle">auto_awesome</span> ' + t('template.extractTitle') + '</h3><p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-bottom:10px">' + t('template.extractDesc').replace('{name}', modName) + '</p><div id="extract-loading" style="text-align:center;padding:12px;display:none">' + t('template.extracting') + '</div><div id="extract-done" style="display:none"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">' + t('template.name') + '</label><input type="text" id="extract-name" placeholder="' + t('template.namePlaceholder') + '" style="width:100%;box-sizing:border-box;margin-bottom:10px"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">' + t('template.systemPrompt') + '</label><textarea id="extract-prompt" rows="5" style="width:100%;box-sizing:border-box;font-size:13px;margin-bottom:12px"></textarea><button class="btn" style="margin:0;font-size:13px" onclick="App._saveExtractedTemplate(\''+moduleType+'\')">' + t('template.saveTemplate') + '</button><button class="btn btn-outline" style="margin:0;font-size:13px;margin-left:8px" onclick="this.closest(\'div\').parentElement.remove()">' + t('app.cancel') + '</button></div></div>';
    document.body.appendChild(overlay);
    this._doExtract(content, overlay, moduleType);
  },

  async _doExtract(content, overlay, moduleType) {
    const loading = overlay.querySelector('#extract-loading');
    const done = overlay.querySelector('#extract-done');
    loading.style.display = 'block';
    try {
      const key = await this.getApiKey();
      const r = await fetch(API_BASE + '/templates/extract', {method:'POST',headers:{...this._authHeaders(),'Content-Type':'application/json','X-Api-Key':key},body:JSON.stringify({sample_output:content})});
      const d = await r.json();
      loading.style.display = 'none';
      if (d.code === 200 && d.data) { done.style.display = 'block'; overlay.querySelector('#extract-prompt').value = d.data.system_prompt || ''; }
      else { toast(d.message||'Extraction failed','error'); overlay.remove(); }
    } catch (e) { loading.style.display = 'none'; toast(t('toast.extractFailedApiKey'),'error'); overlay.remove(); }
  },

  async _saveExtractedTemplate(moduleType) {
    const name = document.getElementById('extract-name')?.value?.trim();
    const prompt = document.getElementById('extract-prompt')?.value?.trim();
    if (!name) return toast(t('toast.nameRequired'), 'error');
    try {
      const data = {name,system_prompt:prompt,modules:[moduleType],output_style:'paragraph',is_default:0};
      const r = await fetch(API_BASE+'/templates',{method:'POST',headers:{...this._authHeaders(),'Content-Type':'application/json'},body:JSON.stringify(data)});
      const d = await r.json();
      if (d.code===200){toast('Template saved','success');document.querySelector('#extract-done').closest('div').parentElement?.remove();this._loadStyleSelectors();this._loadTemplates();}
      else toast(d.message,'error');
    } catch(e){toast(t('toast.saveFailed'),'error');}
  },

  // ---- V0.4: 模板复制+预览 -----------------
  async _copyTemplate(id) {
    try {
      const r = await fetch(API_BASE+'/templates',{headers:this._authHeaders()});
      const d = await r.json();
      if (d.code===200) {
        const t = d.data.templates.find(t=>t.id===id);
        if (t) {
          const data = {name:t.name+' (副本)',modules:JSON.parse(t.modules||'[]'),system_prompt:t.system_prompt,output_style:t.output_style,is_default:0};
          const r2 = await fetch(API_BASE+'/templates',{method:'POST',headers:{...this._authHeaders(),'Content-Type':'application/json'},body:JSON.stringify(data)});
          const d2 = await r2.json();
          if (d2.code===200){toast('Copied','success');this._loadTemplates();this._loadStyleSelectors();}
          else toast(d2.message,'error');
        }
      }
    } catch(e){}
  },

  async _previewTemplate() {
    const prompt = document.getElementById('tf-prompt')?.value?.trim();
    if (!prompt) return toast(t('toast.templatePromptRequired'), 'error');
    const key = await this.getApiKey();
    if (!key) return toast(t('toast.apiKeyRequired'), 'error');
    let pb = document.getElementById('template-preview');
    if (!pb) {
      pb = document.createElement('div'); pb.id='template-preview';
      pb.style.cssText = 'margin-top:14px;padding:12px;background:var(--color-bg);border-radius:var(--radius-sm);font-size:13px;color:var(--color-text-secondary)';
      pb.innerHTML = '<div id="preview-loading">' + t('todos.loading') + '</div><div id="preview-content" style="display:none"></div>';
      document.getElementById('template-form').appendChild(pb);
    }
    pb.style.display='block';
    document.getElementById('preview-loading').style.display='block';
    document.getElementById('preview-content').style.display='none';
    try {
      const r = await fetch(API_BASE+'/summarize',{method:'POST',headers:{...this._authHeaders(),'Content-Type':'application/json','X-Api-Key':key},body:JSON.stringify({text:'今天完成了用户登录模块的开发和测试，修复了3个bug。',custom_instruction:prompt})});
      const d = await r.json();
      document.getElementById('preview-loading').style.display='none';
      document.getElementById('preview-content').style.display='block';
      document.getElementById('preview-content').textContent = (d.code===200?(d.data?.content||d.data?.text||''):('失败: '+(d.message||'')));
    }catch(e){document.getElementById('preview-loading').style.display='none';document.getElementById('preview-content').style.display='block';document.getElementById('preview-content').textContent = t('toast.networkRetry');}
  },

  // ---- V0.4: KB增强 -----------------
  _toggleDocPreview(colId, docId) {
    const el = document.getElementById('doc-preview-'+docId);
    if (!el) return;
    if (el.style.display==='block'){el.style.display='none';return;}
    const row = el.parentElement?.querySelector('[data-preview]');
    el.textContent = (row?.dataset?.preview)||'(无预览内容)';
    el.style.display='block';
  },

  async _testKBSearch() {
    const q = (document.getElementById('kb-search-input')?.value||'').trim();
    if (!q) return toast(t('toast.enterQuery'),'error');
    try {
      const r = await fetch(`${API_BASE}/kb/search?q=${encodeURIComponent(q)}`,{headers:this._authHeaders()});
      const d = await r.json();
      const el = document.getElementById('kb-search-result');
      if (!el) return;
      if (!d.data.chunks||!d.data.chunks.length){el.innerHTML='<span style="color:var(--color-text-muted)">' + t('kb.noMatch') + '</span>';return;}
      el.innerHTML = d.data.chunks.map((c,i)=>'<div style="background:var(--color-card);padding:8px 12px;margin-bottom:6px;border-radius:var(--radius-sm);border-left:3px solid var(--color-accent)"><div style="font-size:10px;color:var(--color-accent);margin-bottom:2px">' + t('kb.source') + ': '+c.filename+'</div><div style="font-size:12px">'+c.content.substring(0,300)+'</div></div>').join('');
    }catch(e){}
  },

  async _saveKBPaste() {
    const text = (document.getElementById('kb-text-paste')?.value||'').trim();
    if (!text) return toast(t('toast.textRequired'),'error');
    const colId = parseInt($('kb-paste-collection')?.value) || 0;
    if (!colId) return toast(t('toast.kbRequired'),'error');
    const defaultName = t('kb.pastePrefix') + new Date().toLocaleDateString();
    const name = await new Promise((resolve) => {
      App._showPrompt(t('kb.docName'), t('kb.docNamePlaceholder'), defaultName, resolve, () => resolve(null));
    });
    if (!name) return;
    const parts = []; let start = 0;
    while (start < text.length) { const end = Math.min(start+500,text.length); parts.push(text.substring(start,end)); start = end-50; if (start>=text.length||start<=0) break; }
    if (parts.length===0) parts.push(text);
    const form = new FormData(); form.append('collection_id',colId); form.append('chunks',JSON.stringify(parts)); form.append('filename',name+'.txt'); form.append('file_type','text/plain');
    try {
      const headers = this._authHeaders();
      delete headers['Content-Type']; // FormData 需要浏览器自动设置 multipart boundary
      const r = await fetch(API_BASE+'/kb/upload-text',{method:'POST',headers,body:form});
      const d = await r.json();
      if (d.code===200){document.getElementById('kb-text-paste').value='';this._loadKBs();this._loadKBDocs(colId);toast(d.message,'success');}
      else toast(d.message,'error');
    }catch(e){toast(t('settings.saveFail'),'error');}
  },

  _renderKbIndicator(containerId) {
    const el = document.getElementById(containerId);
    if (!el || !this._lastKbChunks || !this._lastKbChunks.length) return;
    // 移除旧指示器及其面板
    const old = el.querySelector('.kb-indicator');
    if (old) {
      old.remove();
      const oldPanel = old.nextElementSibling;
      if (oldPanel && oldPanel.classList.contains('kb-ind-panel')) oldPanel.remove();
    }
    // 从 chunks 自身提取唯一的文件名作为展示名称
    const uniqueFiles = [...new Set(this._lastKbChunks.map(c => c.filename || '').filter(Boolean))];
    const kbName = uniqueFiles.length > 0
      ? uniqueFiles.length <= 2 ? uniqueFiles.join(' + ') : uniqueFiles[0] + ' 等' + uniqueFiles.length + '个文件'
      : (App._lastKbNames || t('chat.kb'));
    const bar = document.createElement('div');
    bar.className = 'kb-indicator';
    bar.innerHTML = '<span class="material-icons kb-ind-icon">menu_book</span><span class="kb-ind-label">参考 <b>'+this._escapeHtml(kbName)+'</b> · '+this._lastKbChunks.length+' 个片段</span><span class="material-icons kb-ind-arrow">expand_more</span>';
    const panel = document.createElement('div');
    panel.className = 'kb-ind-panel';
    // 从 bubble 提取 LLM 回答文本用于高亮匹配
    const answerText = (el.textContent || '').replace(/【参考[^】]*】|📎\d+·[^\s]+/g, '');
    panel.innerHTML = this._lastKbChunks.map(function(c, i) {
      const highlighted = App._highlightOverlap(c.content || '', answerText);
      return '<div class="kb-ind-item"><div class="kb-ind-filename"><span class="material-icons" style="font-size:13px;vertical-align:middle">attach_file</span> 参考 '+(i+1)+' · '+App._escapeHtml(c.filename)+'</div><div class="kb-ind-content">'+highlighted+'</div></div>';
    }).join('');
    // 面板默认隐藏，通过全局事件委托切换
    bar.onclick = null;
    // 嵌入容器内部末尾
    el.appendChild(bar);
    el.appendChild(panel);
    // 如果容器是 chat bubble，移除临时 id
    if (containerId.startsWith('chat-bubble-')) el.removeAttribute('id');
  },

  // 计算 chunk 文本与 LLM 回答的重叠，高亮匹配的句子
  _highlightOverlap(chunkText, answerText) {
    if (!chunkText || !answerText) return this._escapeHtml(chunkText || '');
    // 句子分割
    const splitSentences = (t) => t.split(/[。！？\n;；.!?]+/).filter(s => s.trim().length >= 4);
    const chunkSents = splitSentences(chunkText);
    const answerSents = splitSentences(answerText);
    if (!chunkSents.length || !answerSents.length) return this._escapeHtml(chunkText);
    // 构建 answer 的 2-gram 集合
    const answerNGrams = new Set();
    const buildNGrams = (text) => {
      for (let i = 0; i <= text.length - 2; i++) {
        answerNGrams.add(text.substring(i, i + 2));
      }
    };
    answerSents.forEach(buildNGrams);
    // 对 chunk 中每个句子计算重叠率
    const result = chunkSents.map(sent => {
      let overlap = 0;
      for (let i = 0; i <= sent.length - 2; i++) {
        if (answerNGrams.has(sent.substring(i, i + 2))) overlap++;
      }
      const ratio = sent.length >= 2 ? overlap / (sent.length - 1) : 0;
      const escaped = this._escapeHtml(sent);
      return ratio >= 0.25 ? `<mark>${escaped}</mark>` : escaped;
    });
    return result.join('。');
  },

  _escapeAttr(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); },
  _showRefTooltip(e, src, num) {
    const old = document.querySelector('.ref-tooltip');
    if (old) old.remove();
    const tip = document.createElement('div');
    tip.className = 'ref-tooltip';
    const idx = (parseInt(num) || 1) - 1;
    let chunkHtml = '';
    // 优先从最近 bubble 的 dataset 读取 kbChunks（支持历史消息独立存储）
    const bubbleEl = e.target.closest('.bubble');
    let kbChunks = null;
    if (bubbleEl && bubbleEl.dataset.kbChunks) {
      try { kbChunks = JSON.parse(bubbleEl.dataset.kbChunks); } catch (e) {}
    }
    const source = kbChunks;  // 仅使用该消息自己的 kb 数据，不回退到全局 _lastKbChunks
    // 匹配 chunk：精确文件名 → 文件名包含匹配 → 编号索引 → 全量模糊匹配
    let chunk = null;
    if (source) {
      // 1. 精确文件名匹配
      chunk = source.find(c => c.filename === src);
      // 2. 文件名包含匹配（处理截断/前后空格差异）
      if (!chunk) {
        const cleanSrc = src.trim().replace(/^[\s_\-]+|[\s_\-]+$/g, '');
        chunk = source.find(c => c.filename.trim().replace(/^[\s_\-]+|[\s_\-]+$/g, '') === cleanSrc);
      }
      if (!chunk) {
        chunk = source.find(c => c.filename.indexOf(src.trim()) !== -1 || src.trim().indexOf(c.filename) !== -1);
      }
      // 3. 编号索引 fallback
      if (!chunk && source[idx]) chunk = source[idx];
      // 4. 全量搜索：取任意包含部分关键词的 chunk
      if (!chunk) {
        const keywords = src.split(/[\s·._\-]+/).filter(k => k.length >= 2);
        chunk = source.find(c => keywords.some(k => c.filename.indexOf(k) !== -1));
      }
    }
    if (chunk) {
      // 从 bubble 提取 LLM 回答文本用于高亮匹配
      let answerText = '';
      if (bubbleEl) { answerText = (bubbleEl.textContent || '').replace(/【参考[^】]*】|📎\d+·[^\s]+/g, ''); }
      const highlightedContent = this._highlightOverlap(chunk.content || '', answerText);
      chunkHtml = `<div class="ref-chunk">${highlightedContent}</div>`;
    }
    tip.innerHTML = `<div style="font-weight:700;color:var(--color-accent);margin-bottom:6px;font-size:13px"><span class="material-icons" style="font-size:16px;vertical-align:middle">menu_book</span> ${t('chat.kbRef')}</div><div style="font-size:12px;color:var(--color-text-muted);margin-bottom:4px"><span class="material-icons" style="font-size:14px;vertical-align:middle">description</span> ${this._escapeHtml(src)}</div>${chunkHtml}<div style="margin-top:8px;font-size:10px;color:var(--color-text-muted);opacity:0.6">AI 从知识库检索后引用 · 点击外部关闭</div>`;
    // 智能定位：优先右下，避免溢出
    const tipW = 360;
    let left = e.clientX + 12;
    if (left + tipW > window.innerWidth - 10) left = window.innerWidth - tipW - 10;
    let top = e.clientY + 8;
    if (top + 250 > window.innerHeight) top = e.clientY - 260;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
    const targetEl = e.target.closest('.ref-citation');
    if (targetEl) targetEl.classList.add('active');
    document.body.appendChild(tip);
    requestAnimationFrame(() => tip.classList.add('show'));
    const close = () => {
      tip.classList.remove('show');
      if (targetEl) targetEl.classList.remove('active');
      setTimeout(() => tip.remove(), 200);
    };
    const hide = () => { close(); document.removeEventListener('click', hide); };
    setTimeout(() => document.addEventListener('click', hide), 10);
    setTimeout(close, 12000);
  },

  // ---- 模板库 ----
  async _loadTemplates() {
    try {
      const r = await fetch(`${API_BASE}/templates`, { headers: this._authHeaders() });
      if (r.status === 401) { this._showReAuthDialog(); return; }
      const d = await r.json();
      const list = $('templates-list');
      if (!list) return;
      if (d.code !== 200 || !d.data.templates.length) { list.innerHTML = '<p style="color:var(--color-text-muted);font-size:13px;padding:16px 0">'+t('template.empty')+'</p>'; this._templates = []; return; }
      this._templates = d.data.templates;  // 缓存供 _getTemplate 使用
      const modNames = { 'summarize': t('nav.summarize'), 'email': t('nav.email'), 'minutes': t('nav.minutes'), 'polish': t('nav.polish'), 'reportese': t('nav.reportese'), 'requirements': t('nav.requirements'), 'prd': t('nav.prd'), 'ppt-outline': t('nav.ppt'), 'weeklyreport': t('nav.weeklyreport') };
      list.innerHTML = d.data.templates.map(tmpl => {
        const mods = JSON.parse(tmpl.modules || '[]').map(m => modNames[m] || m).join(' · ');
        return `<div style="padding:14px 18px;margin-bottom:8px;background:var(--color-bg);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between">
          <div style="min-width:0;flex:1">
            <div style="font-size:14px;font-weight:600">${tmpl.name}${tmpl.is_default?'<span style="background:var(--color-accent);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px">'+t('template.default')+'</span>':''}</div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-top:3px">${mods||t('template.allModules')} | ${tmpl.output_style}</div>
          </div>
          <div style="display:flex;gap:12px;flex-shrink:0;margin-left:12px">
            <span class="material-icons" style="cursor:pointer;font-size:20px;color:var(--color-accent)" onclick="App._editTemplateById(${tmpl.id})" title="${t('app.edit')}">edit</span>
            <span class="material-icons" style="cursor:pointer;font-size:20px;color:var(--color-accent)" onclick="App._copyTemplate(${tmpl.id})" title="${t('app.copy')}">content_copy</span>
            <span class="material-icons" style="cursor:pointer;font-size:20px;color:var(--color-error)" onclick="App._deleteTemplate(${tmpl.id})" title="${t('app.delete')}">delete</span>
          </div>
        </div>`;
      }).join('');

    } catch (e) { console.error('_loadTemplates error:', e); }
  },
  _showTemplateForm() {
    const form = $('template-form');
    if (!form) return;
    form.style.display = 'block';
    $('tf-id').value = ''; $('tf-name').value = ''; $('tf-prompt').value = ''; $('tf-style').value = 'paragraph'; $('tf-default').checked = false;
    const _mods = ['summarize','email','minutes','polish','reportese','requirements','prd','ppt-outline','weeklyreport'];
    const _names = [t('nav.summarize'),t('nav.email'),t('nav.minutes'),t('nav.polish'),t('nav.reportese'),t('nav.requirements'),t('nav.prd'),t('nav.ppt'),t('nav.weeklyreport')];
    $('tf-modules').innerHTML = _mods.map((m,i) => '<label class="toggle-label" style="display:flex;align-items:center;justify-content:space-between;font-size:13px;padding:3px 0;cursor:pointer"><span>'+_names[i]+'</span><span class="toggle-switch"><input type="checkbox" value="'+m+'" class="tf-mod-cb" checked><span class="toggle-slider"></span></span></label>').join('');
  },
  async _saveTemplate() {
    const id = $('tf-id').value;
    const data = { name: $('tf-name').value.trim(), system_prompt: $('tf-prompt').value.trim(), output_style: $('tf-style').value, is_default: $('tf-default').checked ? 1 : 0, modules: Array.from(document.querySelectorAll('.tf-mod-cb:checked')).map(cb => cb.value) };
    if (!data.name) { toast('Please enter a name', 'error'); return; }
    const url = id ? `${API_BASE}/templates/${id}` : `${API_BASE}/templates`;
    try {
      const r = await fetch(url, { method: id ? 'PUT' : 'POST', headers: { ...this._authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const d = await r.json();
      if (r.status === 401) { toast(t('login.sessionExpired'), 'error'); this._showReAuthDialog(); return; }
      if (d.code === 200) { $('template-form').style.display = 'none'; this._loadTemplates(); toast('Saved', 'success'); }
      else toast(d.message || t('login.operationFailed'), 'error');
    } catch (e) { toast(t('login.networkError'), 'error'); }
  },
  async _deleteTemplate(id) {
    this._showConfirm(t('template.deleteConfirm').replace('{name}',''), async () => {
      try {
        const r = await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers: this._authHeaders() });
        if (r.status === 401) { toast(t('login.sessionExpired'), 'error'); this._showReAuthDialog(); return; }
        this._loadTemplates();
      } catch (e) { toast(t('login.networkError'), 'error'); }
    });
  },
  async _editTemplateById(id) {
    try {
      const r = await fetch(`${API_BASE}/templates`, { headers: this._authHeaders() });
      const d = await r.json();
      if (d.code === 200) {
        const t = d.data.templates.find(t => t.id === id);
        if (t) {
          this._showTemplateForm();
          $('tf-id').value = t.id; $('tf-name').value = t.name; $('tf-prompt').value = t.system_prompt;
          $('tf-style').value = t.output_style || 'paragraph'; $('tf-default').checked = !!t.is_default;
          // 回显模块勾选
          const mods = JSON.parse(t.modules || '[]');
          document.querySelectorAll('.tf-mod-cb').forEach(cb => { cb.checked = mods.includes(cb.value); });
        }
      }
    } catch (e) {}
  },
  async _extractTemplate() {
    // 弹窗输入
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<div style="background:var(--color-card);color:var(--color-text);border-radius:var(--radius-lg);padding:28px;max-width:500px;width:90vw;box-shadow:var(--shadow-lg)">
      <h3 style="margin:0 0 12px;font-size:18px;text-align:center"><span class="material-icons" style="vertical-align:middle">auto_awesome</span> 一键提炼风格</h3>
      <p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-bottom:12px">粘贴一段你满意的输出文本，AI将反推风格指令</p>
      <textarea id="extract-sample" placeholder="${t('todos.pasteSample')}" rows="6" style="width:100%;padding:10px;border:2px solid var(--color-border);border-radius:var(--radius-sm);font-size:13px;box-sizing:border-box;margin-bottom:12px"></textarea>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn" style="margin:0;font-size:13px;padding:8px 24px" id="extract-submit">提炼</button>
        <button class="btn btn-outline" style="margin:0;font-size:13px;padding:8px 24px" id="extract-cancel">取消</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#extract-cancel').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector('#extract-submit').onclick = async () => {
      const sample = overlay.querySelector('#extract-sample').value.trim();
      if (!sample) return;
      const apiKey = await App.getApiKey();
      if (!apiKey || apiKey === 'skip') {
        toast(t('toast.apiKeyRequired'), 'error');
        return;
      }
      const btn = overlay.querySelector('#extract-submit');
      btn.textContent = t('todos.extracting'); btn.disabled = true;
      const headers = { 'Content-Type': 'application/json' };
      if (App._token) headers['Authorization'] = `Bearer ${App._token}`;
      headers['X-Api-Key'] = apiKey;
      headers['X-Model'] = localStorage.getItem('grindpal_model') || 'deepseek-v4-flash';
      try {
        const r = await fetch(`${API_BASE}/templates/extract`, { method: 'POST', headers, body: JSON.stringify({ sample_output: sample }) });
        const d = await r.json();
        if (d.code === 200 && d.data.system_prompt && d.data.system_prompt.indexOf('模拟数据') === -1) {
          $('tf-prompt').value = d.data.system_prompt;
          $('template-form').style.display = 'block';
          toast(t('toast.templateExtracted'), 'success');
        } else {
          toast(t('toast.extractFailedApiKey'), 'error');
        }
        overlay.remove();
      } catch (e) { toast(t('toast.requestFailed'), 'error'); }
      btn.textContent = t('todos.extract'); btn.disabled = false;
    };
  },

  // ---- 知识库 ----
  async _loadKBs() {
    try {
      const r = await fetch(`${API_BASE}/kb/collections`, { headers: this._authHeaders() });
      const d = await r.json();
      const el = $('kb-collections');
      if (!el) return;
      if (!d.data.collections.length) { el.innerHTML = '<p style=\"color:var(--color-text-muted);font-size:13px;padding:16px 0\">'+t('kb.empty')+'</p>'; }
      // 同步更新粘贴选择器
      const sel = $('kb-paste-collection');
      if (sel) {
        sel.innerHTML = d.data.collections.length
          ? d.data.collections.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
          : '<option value="">'+t('kb.noCollection')+'</option>';
      }
      if (!d.data.collections.length) return;
      // 缓存集合供 ChatApp._getKbDisplayName() 查找名称
      this._kbCollections = d.data.collections;
      const activeKbIds = ChatApp._getKbIds ? ChatApp._getKbIds() : [];
      el.innerHTML = d.data.collections.map(c => {
        const isActive = activeKbIds.includes(c.id);
        return `<div style="margin-bottom:8px;background:var(--color-bg);border-radius:var(--radius-sm);overflow:hidden;${isActive ? 'border:2px solid var(--color-accent)' : ''}">
        <div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="App._toggleKBDocs(${c.id},this)">
          <b style="font-size:14px"><span class="material-icons" style="font-size:16px;vertical-align:middle;color:${isActive ? 'var(--color-accent)' : 'var(--color-text-muted)'};margin-right:4px">${isActive ? 'play_arrow' : 'folder'}</span>${c.name}${isActive ? '<span style="font-size:10px;background:var(--color-accent);color:#fff;padding:1px 6px;border-radius:3px;margin-left:6px">'+t('kb.activate')+'</span>' : ''}</b>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn ${isActive ? 'btn-secondary' : 'btn-outline'}" style="margin:0;padding:3px 8px;font-size:11px" onclick="event.stopPropagation();App._activateKB(${c.id},'${this._escapeAttr(c.name)}')" title="${isActive ? t('kb.deactivateHint') : t('kb.activateHint')}"><span class="material-icons" style="font-size:12px">${isActive ? 'remove' : 'add'}</span></button>
            <button class="btn btn-outline" style="margin:0;padding:3px 8px;font-size:11px" onclick="event.stopPropagation();document.getElementById('kb-file').dataset.cid='${c.id}';document.getElementById('kb-file').click()"><span class="material-icons" style="font-size:12px">upload</span></button>
            <span class="material-icons" style="cursor:pointer;font-size:18px;color:var(--color-error)" onclick="event.stopPropagation();App._deleteKB(${c.id})">delete</span>
          </div>
        </div>
        <div id="kb-docs-${c.id}" style="display:none;padding:0 14px 10px;font-size:12px;color:var(--color-text-muted)">${t('kb.loading')}</div>
      </div>`;
      }).join('');
      // 自动加载文档列表
      d.data.collections.forEach(c => { App._loadKBDocs(c.id); });
    } catch (e) {}
  },
  _activateKB(id, name) {
    // 多选模式：toggle 单个 KB 到激活列表
    const convKey = ChatApp._kbActiveKey ? ChatApp._kbActiveKey() : 'grindpal_active_kb';
    const cur = localStorage.getItem(convKey) || '';
    let ids = cur ? cur.split(',').map(s => s.trim()).filter(Boolean) : [];
    const sid = String(id);
    if (ids.includes(sid)) {
      // 移除
      ids = ids.filter(i => i !== sid);
    } else {
      // 添加
      ids.push(sid);
    }
    const newVal = ids.join(',');
    // 保存到当前对话
    localStorage.setItem(convKey, newVal);
    // 同步到全局（非聊天工具用）
    localStorage.setItem('grindpal_active_kb', newVal);
    if (ChatApp._currentConvId) {
      ChatApp._kbEnabled = true;
      localStorage.setItem(ChatApp._kbEnabledKey(), '1');
      ChatApp._updateKbToggle();
    }
    this._loadKBs();
    const isActive = ids.includes(sid);
    toast(isActive ? t('kb.activated') : t('kb.deactivated'), 'success');
  },
  async _createKB() {
    const name = ($('kb-col-name')?.value || '').trim();
    if (!name) return toast(t('toast.nameRequired'), 'error');
    try {
      const r = await fetch(`${API_BASE}/kb/collections`, { method: 'POST', headers: { ...this._authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const d = await r.json();
      if (d.code === 200) { if ($('kb-col-name')) $('kb-col-name').value = ''; this._loadKBs(); toast(d.message||t('kb.created'),'success'); }
    } catch (e) {}
  },
  async _deleteKB(id) {
    this._showConfirm(t('kb.deleteConfirm.collection'), async () => {
      try {
        const r = await fetch(`${API_BASE}/kb/collections/${id}`, { method: 'DELETE', headers: this._authHeaders() });
        if (r.status === 401) { toast(t('login.sessionExpired'), 'error'); this._showReAuthDialog(); return; }
        this._loadKBs();
      } catch (e) { toast(t('login.networkError'), 'error'); }
    });
  },
  async _loadKBDocs(colId) {
    try {
      const r = await fetch(`${API_BASE}/kb/documents/${colId}`, { headers: this._authHeaders() });
      const d = await r.json();
      const el = document.getElementById('kb-docs-' + colId);
      if (!el) return;
      if (!d.data.documents.length) { el.innerHTML = '<span style="color:var(--color-text-muted)">'+t('kb.noDocs')+'</span>'; return; }
      el.innerHTML = d.data.documents.map(doc => `<div style="padding:4px 0">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" data-action="toggle-preview" data-col-id="${colId}" data-doc-id="${doc.id}" data-preview="${App._escapeAttr(doc.preview||'')}">
          <span><span class="material-icons" style="font-size:14px;vertical-align:middle;color:var(--color-text-muted)">description</span> ${App._escapeHtml(doc.filename)} <span style="font-size:11px;color:var(--color-text-muted)">${(doc.file_size/1024).toFixed(1)}KB</span></span>
          <span class="material-icons" style="cursor:pointer;font-size:16px;color:var(--color-error)" data-action="delete-kbdoc" data-col-id="${colId}" data-doc-id="${doc.id}">close</span>
        </div>
        <div id="doc-preview-${doc.id}" style="display:none;font-size:11px;color:var(--color-text-muted);padding:4px 18px;line-height:1.4;white-space:pre-wrap;background:var(--color-bg);border-radius:4px;margin-top:4px"></div>
      </div>`).join('');
    } catch (e) {}
  },
  _toggleKBDocs(colId, el) {
    const docsEl = document.getElementById('kb-docs-' + colId);
    if (docsEl) docsEl.style.display = docsEl.style.display === 'none' ? 'block' : 'none';
  },
  async _deleteKBDoc(colId, docId) {
    this._showConfirm(t('kb.deleteConfirm.text'), async () => {
      try {
        const r = await fetch(`${API_BASE}/kb/documents/${docId}`, { method: 'DELETE', headers: this._authHeaders() });
        if (r.status === 401) { toast(t('login.sessionExpired'), 'error'); this._showReAuthDialog(); return; }
        this._loadKBDocs(colId);
      } catch (e) { toast(t('login.networkError'), 'error'); }
    });
  },
  async _uploadKB() {
    const fileInput = $('kb-file');
    if (!fileInput || !fileInput.files || !fileInput.files.length) return;
    const cid = fileInput.dataset?.cid || '';
    const files = Array.from(fileInput.files);  // FileList → Array（避免迭代过程中被清空）
    const form = new FormData();
    for (const file of files) {
      form.append('file', file);
    }
    form.append('collection_id', cid);

    // 显示上传进度条（KB 面板内联，不阻塞操作）
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    this._showUploadProgress(files.length, totalSize, true);

    try {
      const d = await this._uploadWithProgress(`${API_BASE}/kb/upload`, form, true);
      if (d.code === 200 && d.data?.results) {
        const results = d.data.results;
        const okCount = results.filter(r => !r.error).length;
        const errCount = results.filter(r => r.error).length;
        if (okCount) toast(`成功上传 ${okCount} 个文件${errCount ? `，${errCount} 个失败` : ''}`, 'success');
        else if (errCount) toast(`上传失败（${results[0]?.error || '未知错误'}）`, 'error');
        if (okCount) { this._loadKBs(); const cid2 = parseInt(cid) || 0; if (cid2) this._loadKBDocs(cid2); }
      } else {
        toast(d.message || '上传失败', 'error');
      }
    } catch (e) { toast(t('toast.networkRetry'), 'error'); }

    this._hideUploadProgress(true);
    fileInput.value = '';  // 上传完成后清空
  },

  // 带进度回调的上传（XMLHttpRequest）
  _uploadWithProgress(url, formData, inline = false) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (App._token) xhr.setRequestHeader('Authorization', `Bearer ${App._token}`);
      try { xhr.setRequestHeader('Accept-Language', getLang()); } catch(e) {}

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round(e.loaded / e.total * 100);
          this._updateUploadProgress(pct, e.loaded, e.total, inline);
        }
      };

      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('Invalid JSON response')); }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Upload timeout'));
      xhr.send(formData);
    });
  },

  _showUploadProgress(fileCount, totalBytes, inline = false) {
    if (inline) {
      const bar = document.getElementById('kb-upload-bar');
      const text = document.getElementById('kb-upload-text');
      const container = document.getElementById('kb-upload-progress');
      if (bar) bar.value = 0;
      const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
      if (text) text.textContent = `上传中 ${fileCount} 个文件（共 ${totalMB} MB）…`;
      if (container) container.style.display = 'block';
      return;
    }
    const overlay = document.getElementById('loading-overlay');
    const spinner = document.getElementById('loading-spinner');
    const bar = document.getElementById('upload-progress-bar');
    const text = document.getElementById('loading-text');
    if (spinner) spinner.style.display = 'none';
    if (bar) { bar.style.display = 'block'; bar.value = 0; }
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
    if (text) text.textContent = `正在上传 ${fileCount} 个文件（共 ${totalMB} MB）…`;
    if (overlay) overlay.classList.add('show');
  },

  _updateUploadProgress(pct, loaded, total, inline = false) {
    if (inline) {
      const bar = document.getElementById('kb-upload-bar');
      const text = document.getElementById('kb-upload-text');
      if (bar) bar.value = pct;
      if (text) {
        const loadedMB = (loaded / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        text.textContent = `上传中 ${pct}%（${loadedMB}/${totalMB} MB）`;
      }
      return;
    }
    const bar = document.getElementById('upload-progress-bar');
    if (bar) bar.value = pct;
    const text = document.getElementById('loading-text');
    if (text) {
      const loadedMB = (loaded / 1024 / 1024).toFixed(1);
      const totalMB = (total / 1024 / 1024).toFixed(1);
      text.textContent = `上传中 ${pct}%（${loadedMB}/${totalMB} MB）`;
    }
  },

  _hideUploadProgress(inline = false) {
    if (inline) {
      const container = document.getElementById('kb-upload-progress');
      if (container) container.style.display = 'none';
      return;
    }
    const overlay = document.getElementById('loading-overlay');
    const spinner = document.getElementById('loading-spinner');
    const bar = document.getElementById('upload-progress-bar');
    if (overlay) overlay.classList.remove('show');
    if (spinner) spinner.style.display = '';
    if (bar) bar.style.display = 'none';
  },

  // ---- 确认弹窗（替代浏览器 confirm） ----
  _showConfirm(msg, onOk, onCancel) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)';
    overlay.innerHTML = `<div style="background:var(--color-card);border-radius:16px;padding:28px 32px 24px;max-width:400px;width:90vw;box-shadow:var(--shadow-lg);text-align:center;animation:loginCardIn 0.25s ease-out">
      <p style="font-size:15px;color:var(--color-text);margin:0 0 24px;line-height:1.6;white-space:pre-wrap">${this._escapeHtml(String(msg))}</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-outline" style="min-width:90px;margin:0" id="confirm-cancel-btn">${t('app.cancel')}</button>
        <button class="btn" style="min-width:90px;margin:0;background:var(--color-error)" id="confirm-ok-btn">${t('app.confirm')}</button>
      </div>
    </div>`;
    const close = (confirmed) => {
      overlay.remove(); document.removeEventListener('keydown', onEsc);
      if (confirmed) onOk(); else if (onCancel) onCancel();
    };
    overlay.onmousedown = (e) => { if (e.target === overlay) close(false); };
    const onEsc = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onEsc);
    overlay.querySelector('#confirm-cancel-btn').onclick = () => close(false);
    overlay.querySelector('#confirm-ok-btn').onclick = () => close(true);
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-ok-btn').focus();
  },

  // ---- 输入弹窗（替代浏览器 prompt） ----
  _showPrompt(title, placeholder, defaultValue, onOk, onCancel) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)';
    overlay.innerHTML = `<div style="background:var(--color-card);border-radius:16px;padding:28px 32px 24px;max-width:400px;width:90vw;box-shadow:var(--shadow-lg);text-align:center;animation:loginCardIn 0.25s ease-out">
      <p style="font-size:15px;color:var(--color-text);margin:0 0 16px;line-height:1.6">${this._escapeHtml(String(title))}</p>
      <input type="text" id="prompt-input" value="${(defaultValue || '').replace(/"/g,'&quot;')}" placeholder="${(placeholder || '').replace(/"/g,'&quot;')}" style="width:100%;padding:10px 14px;border:2px solid var(--color-accent);border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;background:var(--color-bg);color:var(--color-text);margin-bottom:20px">
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn btn-outline" style="min-width:90px;margin:0" id="prompt-cancel-btn">${t('app.cancel')}</button>
        <button class="btn" style="min-width:90px;margin:0" id="prompt-ok-btn">${t('app.confirm')}</button>
      </div>
    </div>`;
    const input = overlay.querySelector('#prompt-input');
    const close = (confirmed) => {
      overlay.remove(); document.removeEventListener('keydown', onEsc);
      if (confirmed) onOk(input.value);
      else if (onCancel) onCancel();
    };
    overlay.onmousedown = (e) => { if (e.target === overlay) close(false); };
    const onEsc = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onEsc);
    overlay.querySelector('#prompt-cancel-btn').onclick = () => close(false);
    overlay.querySelector('#prompt-ok-btn').onclick = () => close(true);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(true); } });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  },

  // ---- 待办 ----
  _toggleTodoPanel() {
    const p = $('todo-panel');
    if (p.style.display === 'block') { p.style.display = 'none'; this._removeOverlay(); }
    else { p.style.display = 'block'; this._refreshTodos(); this._showOverlay(); }
  },
  _showOverlay() {
    let o = $('panel-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'panel-overlay'; o.style.cssText = 'position:fixed;inset:0;z-index:798;background:rgba(0,0,0,0.2)'; o.onmousedown = (e) => { if (!window.getSelection().toString()) this._closePanels(); }; document.body.appendChild(o); }
    o.style.display = 'block';
  },
  _removeOverlay() { const o = $('panel-overlay'); if (o) o.style.display = 'none'; },
  _closePanels() { $('history-panel').classList.remove('show'); $('todo-panel').style.display = 'none'; this._removeOverlay(); },

  toggleNotifications() {
    const existing = document.getElementById('notif-dropdown');
    if (existing) { existing.remove(); return; }
    // 立即显示下拉框（加载态）
    const dd = document.createElement('div');
    dd.id = 'notif-dropdown';
    dd.style.cssText = 'position:fixed;top:52px;right:12px;z-index:901;background:var(--color-card);border:1px solid var(--color-border);border-radius:12px;box-shadow:var(--shadow-lg);padding:16px;max-width:320px;width:90vw;max-height:300px;overflow-y:auto;font-size:13px';
    dd.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><b style="font-size:14px"><span class="material-icons" style="font-size:16px;vertical-align:middle">notifications</span> ${t('todos.title')}</b><span class="material-icons" style="cursor:pointer;font-size:18px;color:var(--color-text-muted)" onclick="document.getElementById('notif-dropdown').remove()">close</span></div><div style="text-align:center;color:var(--color-text-muted);padding:20px">` + t('todos.loading') + `</div>`;
    document.body.appendChild(dd);
    // 点击外部关闭
    setTimeout(() => {
      const closeHandler = (e) => {
        const d = document.getElementById('notif-dropdown');
        if (d && !d.contains(e.target) && e.target.id !== 'notif-btn' && !document.getElementById('notif-btn').contains(e.target)) {
          d.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);
    // 异步加载数据
    this._checkTodoReminders();
  },
  _checkTodoReminders() {
    // 请求浏览器通知权限
    if (window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // 获取待办
    fetch(`${API_BASE}/todos`, { headers: this._authHeaders() })
      .then(r => r.json())
      .then(d => {
        const todos = d?.data?.todos || [];
        const pending = todos.filter(t => t.status !== 'done');
        const badge = $('notif-badge');
        if (badge) { badge.textContent = pending.length; badge.style.display = pending.length > 0 ? 'block' : 'none'; }
        // 更新或创建下拉框
        const dd = document.getElementById('notif-dropdown');
        if (!dd) return; // 用户已关闭
        if (pending.length === 0) {
          dd.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><b style="font-size:14px"><span class="material-icons" style="font-size:16px;vertical-align:middle">notifications</span> ${t('todos.title')}</b><span class="material-icons" style="cursor:pointer;font-size:18px;color:var(--color-text-muted)" onclick="document.getElementById('notif-dropdown').remove()">close</span></div><div style="text-align:center;color:var(--color-text-muted);padding:20px">${t('app.noTodos')}</div>`;
          return;
        }
        dd.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><b style="font-size:14px"><span class="material-icons" style="font-size:16px;vertical-align:middle">notifications</span> ` + t('todos.pendingTodos').replace('{n}', pending.length) + `</b><span class="material-icons" style="cursor:pointer;font-size:18px;color:var(--color-text-muted)" onclick="document.getElementById('notif-dropdown').remove()">close</span></div>`;
        dd.innerHTML += pending.map(t => {
            let urgent = false;
            if (t.deadline) {
              const dl = new Date(t.deadline).getTime();
              const nowTs = Date.now();
              urgent = !isNaN(dl) && dl > 0 && dl <= nowTs + 3600000;
            }
            return `<div style="padding:6px 0;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;background:${urgent?'var(--color-error)':'var(--color-accent)'};color:#fff;border-radius:3px;padding:1px 5px;flex-shrink:0"><span class="material-icons" style="font-size:10px;vertical-align:middle">${urgent?'warning':'checklist'}</span> ${urgent?'临近':'待办'}</span>
              <span style="flex:1;font-size:12px">${this._escapeHtml(t.task)}${t.assignee && !t.task.includes(t.assignee) ? ' · ' + this._escapeHtml(t.assignee) : ''}</span>
              <span style="font-size:10px;color:var(--color-text-muted);white-space:nowrap;flex-shrink:0">${(t.deadline||'').replace('T',' ').substring(0,16)}</span>
            </div>`;
          }).join('');
        
        // 浏览器通知：检查是否有到期的待办
        if (window.Notification && Notification.permission === 'granted' && pending.length > 0) {
          const reminderMin = parseInt(localStorage.getItem('grindpal_reminder') || '10');
          const nowTs = Date.now();
          const dueSoon = pending.filter(t => {
            if (!t.deadline) return false;
            const dl = new Date(t.deadline).getTime();
            return !isNaN(dl) && dl > 0 && (dl - nowTs) <= reminderMin * 60 * 1000 && dl >= nowTs;
          });
          if (dueSoon.length > 0) {
            new Notification('⏰ Todo Reminder', { body: dueSoon.map(t => t.task).join(', '), icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⏰</text></svg>' });
          }
        }
      }).catch(() => {
        const dd = document.getElementById('notif-dropdown');
        if (dd) {
          dd.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><b style="font-size:14px"><span class="material-icons" style="font-size:16px;vertical-align:middle">notifications</span> ${t('todos.title')}</b><span class="material-icons" style="cursor:pointer;font-size:18px;color:var(--color-text-muted)" onclick="document.getElementById('notif-dropdown').remove()">close</span></div><div style="text-align:center;color:var(--color-text-muted);padding:20px">` + t('todos.loadFailed') + `</div>`;
        }
      });
  },
  async _addTodo() {
    const raw = ($('todo-new-task')?.value || '').trim();
    if (!raw) return toast(t('toast.textRequired'), 'error');
    const btn = document.querySelector('#todo-list').previousElementSibling?.querySelector('button');
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
    let task = raw, assignee = '', deadline = '';
    try {
      const key = await this.getApiKey();
      if (key && key !== 'skip') {
        const r = await fetch(`${API_BASE}/parse-todo`, {
          method: 'POST',
          headers: { ...this._authHeaders(), 'Content-Type': 'application/json', 'X-Api-Key': key },
          body: JSON.stringify({ text: raw }),
        });
        const d = await r.json();
        if (d.code === 200 && d.data) {
          task = d.data.task || raw;
          deadline = d.data.deadline || '';
          assignee = d.data.assignee || '';
        }
      }
    } catch (e) { /* 解析失败用原文 */ }
    try {
      const r = await fetch(`${API_BASE}/todos`, {
        method: 'POST',
        headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, assignee, deadline }),
      });
      const d = await r.json();
      if (d.code === 200) { $('todo-new-task').value = ''; this._refreshTodos(); toast('Added', 'success'); }
    } catch (e) { toast(t('toast.addFailed'), 'error'); }
    if (btn) { btn.textContent = '✓'; btn.disabled = false; }
  },
  async _editTodo(id) {
    // 先从 DOM 中获取当前显示的数据作为初始值
    let curTask = '', curDeadline = '', curAssignee = '';
    try {
      const r = await fetch(`${API_BASE}/todos`, { headers: this._authHeaders() });
      const d = await r.json();
      const todo = (d?.data?.todos || []).find(t => t.id === id);
      if (todo) { curTask = todo.task || ''; curDeadline = todo.deadline || ''; curAssignee = todo.assignee || ''; }
    } catch (e) {}

    const overlay = document.createElement('div');
    overlay.id = 'edit-todo-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
    overlay.innerHTML = `
      <div style="background:var(--color-card);color:var(--color-text);border-radius:var(--radius-lg);padding:24px 28px;max-width:480px;width:90vw" onclick="event.stopPropagation()">
        <h3 style="margin:0 0 16px;font-size:17px;display:flex;align-items:center;gap:8px"><span class="material-icons">edit</span>编辑待办</h3>
        <label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">任务内容</label>
        <textarea id="edit-todo-task" rows="3" style="width:100%;padding:8px 10px;border:2px solid var(--color-border);border-radius:8px;font-size:13px;font-family:inherit;line-height:1.5;outline:none;resize:vertical;box-sizing:border-box;margin-bottom:12px">${this._escapeHtml(curTask)}</textarea>
        <label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">截止时间</label>
        <input type="datetime-local" id="edit-todo-deadline" value="${this._escapeHtml(curDeadline)}" style="width:100%;padding:8px 10px;border:2px solid var(--color-border);border-radius:8px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:12px">
        <label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">负责人（选填）</label>
        <input type="text" id="edit-todo-assignee" value="${this._escapeHtml(curAssignee)}" placeholder="${t('todos.optional')}" style="width:100%;padding:8px 10px;border:2px solid var(--color-border);border-radius:8px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:16px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('edit-todo-overlay').remove()" style="padding:8px 20px;font-size:14px;background:transparent;color:var(--color-text-secondary);border:2px solid var(--color-border);border-radius:8px;cursor:pointer">取消</button>
          <button onclick="App._saveEditTodo(${id})" style="padding:8px 24px;font-size:14px;background:var(--color-primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">保存</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  },

  async _saveEditTodo(id) {
    const task = document.getElementById('edit-todo-task')?.value?.trim();
    const deadline = document.getElementById('edit-todo-deadline')?.value?.trim();
    const assignee = document.getElementById('edit-todo-assignee')?.value?.trim();
    if (!task) { toast(t('toast.textRequired'), 'error'); return; }
    try {
      const r = await fetch(`${API_BASE}/todos/${id}`, {
        method: 'PUT',
        headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, deadline: deadline || '', assignee: assignee || '' }),
      });
      if (!r.ok) { toast(t('toast.saveFailed'), 'error'); return; }
      document.getElementById('edit-todo-overlay')?.remove();
      toast('Saved', 'success');
      this._refreshTodos();
    } catch (e) { toast(t('toast.saveFailed'), 'error'); }
  },

  _deleteTodo(id) {
    // 从 data 属性获取任务名
    let taskName = '';
    const delBtn = document.querySelector(`[onclick*="_deleteTodo(${id})"]`);
    const row = delBtn?.closest('[data-todo-task]');
    if (row) taskName = row.getAttribute('data-todo-task') || '';

    const overlay = document.createElement('div');
    overlay.id = 'delete-todo-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const onEsc = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
    overlay.innerHTML = `
      <div style="background:var(--color-card);color:var(--color-text);border-radius:var(--radius-lg);padding:28px 32px;max-width:400px;width:90vw;text-align:center" onclick="event.stopPropagation()">
        <span class="material-icons" style="font-size:40px;color:var(--color-error);margin-bottom:8px">delete_forever</span>
        <h3 style="margin:0 0 8px;font-size:17px">确认删除</h3>
        <p style="font-size:13px;color:var(--color-text-secondary);margin:0 0 20px;word-break:break-word">${taskName ? '「' + this._escapeHtml(taskName) + '」' : '此待办'}将被永久删除</p>
        <div style="display:flex;gap:8px;justify-content:center">
          <button onclick="document.getElementById('delete-todo-overlay').remove()" style="padding:8px 24px;font-size:14px;background:transparent;color:var(--color-text-secondary);border:2px solid var(--color-border);border-radius:8px;cursor:pointer">取消</button>
          <button onclick="App._confirmDeleteTodo(${id})" style="padding:8px 24px;font-size:14px;background:var(--color-error);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">删除</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  },

  async _confirmDeleteTodo(id) {
    try {
      const resp = await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE', headers: this._authHeaders() });
      if (!resp.ok) { toast(t('toast.deleteFailed'), 'error'); return; }
      document.getElementById('delete-todo-overlay')?.remove();
      await this._refreshTodos();
      toast(t('toast.deleted'), 'success');
    } catch (e) { toast(t('toast.deleteFailed'), 'error'); }
  },

  // ---- 批量操作 ----
  _onBatchChange() {
    const checks = document.querySelectorAll('#todo-list .todo-batch-check:checked');
    const count = checks.length;
    const bar = $('todo-batch-bar');
    const selAll = $('todo-select-all');
    if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
    const cntEl = $('todo-selected-count');
    if (cntEl) cntEl.textContent = `已选${count}项`;
    if (selAll) selAll.checked = count > 0 && count === document.querySelectorAll('#todo-list .todo-batch-check').length;
  },

  _toggleSelectAll(checked) {
    this._batchMode = checked;
    if (!checked) {
      document.querySelectorAll('#todo-list .todo-batch-check').forEach(cb => { cb.checked = false; });
    }
    this._refreshTodos().then(() => {
      if (checked) {
        document.querySelectorAll('#todo-list .todo-batch-check').forEach(cb => { cb.checked = true; });
      }
      this._onBatchChange();
    });
  },

  async _batchToggleStatus(status) {
    const checks = document.querySelectorAll('#todo-list .todo-batch-check:checked');
    if (!checks.length) return;
    const count = checks.length;
    let ok = 0;
    for (const cb of checks) {
      const row = cb.closest('[data-todo-id]');
      const id = row?.dataset?.todoId;
      if (!id) continue;
      try {
        const r = await fetch(`${API_BASE}/todos/${id}`, {
          method: 'PUT',
          headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (r.ok) ok++;
      } catch (e) {}
    }
    if (ok > 0) { toast(`${status === 'done' ? '标记完成' : '标记待办'} ${ok}/${count} 项`, 'success'); this._refreshTodos(); }
    else toast(t('toast.operationFailed'), 'error');
  },

  async _batchDelete() {
    const checks = document.querySelectorAll('#todo-list .todo-batch-check:checked');
    if (!checks.length) return;
    const count = checks.length;
    this._showConfirm(t("todos.batchDeleteConfirm").replace("{n}", count), async () => {
      let ok = 0;
      for (const cb of checks) {
        const row = cb.closest('[data-todo-id]');
        const id = row?.dataset?.todoId;
        if (!id) continue;
        try {
          const r = await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE', headers: this._authHeaders() });
          if (r.ok) ok++;
        } catch (e) {}
      }
      if (ok > 0) { toast(`已删除 ${ok}/${count} 项`, 'success'); this._refreshTodos(); }
      else toast(t('toast.deleteFailed'), 'error');
    });
  },

  async _refreshTodos() {
    try {
      const r = await fetch(`${API_BASE}/todos`, { headers: this._authHeaders() });
      const d = await r.json();
      const el = $('todo-list');
      if (!el) return;
      const todos = d?.data?.todos;
      // 重置批量选择状态
      const selAll = $('todo-select-all');
      if (selAll) selAll.checked = false;
      const bar = $('todo-batch-bar');
      if (bar) bar.style.display = 'none';
      this._batchMode = false;
      $('todo-select-all').checked = false;
      if (!todos || !todos.length) { el.innerHTML = '<span style="font-size:13px;color:var(--color-text-muted)">'+t('app.noTodos')+'</span>'; return; }
      el.innerHTML = todos.map(t => {
        const done = t.status === 'done';
        return `<div style="padding:6px 0;border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:8px" data-todo-task="${(t.task||'').replace(/"/g,'&quot;')}" data-todo-id="${t.id}">
        ${this._batchMode ? '<input type="checkbox" class="todo-batch-check" onchange="App._onBatchChange()" style="margin:0;cursor:pointer;flex-shrink:0" title="'+t('todos.batchSelect')+'">' : ''}
        <input type="checkbox" ${done?'checked':''} onchange="App._toggleTodo(${t.id},this.checked)" style="margin:0;cursor:pointer;flex-shrink:0" title="'+t('todos.toggleStatus')+'">
        <span style="flex:1;font-size:13px;${done?'text-decoration:line-through;color:var(--color-text-muted)':''}">${this._escapeHtml(t.task)}${t.assignee && !t.task.includes(t.assignee) ? ' · ' + this._escapeHtml(t.assignee) : ''}</span>
        <span style="font-size:10px;color:var(--color-text-muted);white-space:nowrap">${(t.deadline||'').replace('T',' ').substring(0,16)}</span>
        <span class="material-icons" style="cursor:pointer;font-size:16px;color:var(--color-accent);flex-shrink:0" onclick="App._editTodo(${t.id})" title="编辑">edit</span>
        <span class="material-icons" style="cursor:pointer;font-size:16px;color:var(--color-error);flex-shrink:0" onclick="App._deleteTodo(${t.id})" title="删除">delete</span>
      </div>`;
      }).join('');
      // 更新待办角标（导航栏 + 铃铛）
      const pending = todos.filter(t => t.status !== 'done').length;
      const badge = $('todo-badge');
      if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? 'inline' : 'none'; }
      const nbadge = $('notif-badge');
      if (nbadge) { nbadge.textContent = pending; nbadge.style.display = pending > 0 ? 'block' : 'none'; }
    } catch (e) { console.error('_refreshTodos error:', e); }
  },
  async _toggleTodo(id, done) {
    try {
      const r = await fetch(`${API_BASE}/todos/${id}`, { method: 'PUT', headers: { ...this._authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: done ? 'done' : 'pending' }) });
      if (r.ok) this._refreshTodos();
    } catch (e) {}
  },

  async toggleSettings() {
    const overlay = $('settings-overlay');
    if (overlay.classList.contains('show')) {
      overlay.classList.remove('show');
    } else {
      let key = this._apiKey || '';
      // 如果内存中没有，尝试从加密存储惰性解密
      if (!key && localStorage.getItem('grindpal_apikey_enc')) {
        if (this._masterPassword) {
          try {
            const encData = JSON.parse(localStorage.getItem('grindpal_apikey_enc'));
            const plain = await CryptoUtils.decrypt(encData, this._masterPassword);
            this._apiKey = plain;
            sessionStorage.setItem('grindpal_apikey', plain);
            key = plain;
          } catch (e) { /* 解密失败，显示占位符 */ }
        }
        if (!key) key = '••••••••';
      }
      $('settings-apikey').value = key;
      $('settings-model').value = localStorage.getItem('grindpal_model') || 'deepseek-v4-flash';
      $('settings-style').value = localStorage.getItem('grindpal_style') || 'standard';
      $('settings-reminder').value = localStorage.getItem('grindpal_reminder') || '10';
      $('settings-tavern').checked = localStorage.getItem('grindpal_tavern') !== '0';
      $('settings-tavern-hide').checked = localStorage.getItem('grindpal_tavern_hide') === '1';
      $('account-username').value = this._username || '';
      // 密保状态
      this._hasSecurity = localStorage.getItem('grindpal_has_security') === '1';
      this._securityQuestion = localStorage.getItem('grindpal_security_q') || '';
      if (this._hasSecurity && this._securityQuestion) {
        $('settings-security-q').value = this._securityQuestion;
        $('settings-security-q').style.color = '';
      } else {
        $('settings-security-q').value = '';
      }
      this._refreshSecurityBtn();
      this.switchSettingsTab('api');
      overlay.classList.add('show');
    }
    overlay.onclick = function(e) { if (e.target === overlay && !window.getSelection().toString()) App.toggleSettings(); };
  },

  async saveSettings() {
    let key = $('settings-apikey').value.trim();
    // 如果用户没修改占位符，保留原 Key
    if (key === '••••••••') key = this._apiKey || '';
    const model = $('settings-model').value;
    const style = $('settings-style').value;
    await this.setApiKey(key);
    localStorage.setItem('grindpal_model', model);
    localStorage.setItem('grindpal_style', style);
    localStorage.setItem('grindpal_reminder', $('settings-reminder').value);
    toast(t('toast.settingsSaved') || '设置已保存', 'success');
    this.toggleSettings();
    // 自动查询余额
    if (key) this.queryBalance();
  },

  // 自动保存单项设置（静默，不关闭面板）
  async _autoSaveApiKey() {
    const key = $('settings-apikey').value.trim();
    if (!key || key === '••••••••') return;
    await this.setApiKey(key);
    toast('✓ API Key 已保存', 'success');
  },

  _autoSaveModel() {
    const model = $('settings-model').value;
    localStorage.setItem('grindpal_model', model);
    toast('✓ 模型已切换', 'success');
  },

  _autoSaveStyle() {
    const style = $('settings-style').value;
    localStorage.setItem('grindpal_style', style);
    toast('✓ 文风已切换', 'success');
  },

  _autoSaveReminder() {
    const val = $('settings-reminder').value;
    localStorage.setItem('grindpal_reminder', val);
    toast('✓ 提醒已更新', 'success');
  },

  async queryBalance(silent) {
    const key = await this.getApiKey();
    if (!key) { if (!silent) toast(t('toast.noApiKey'), 'error'); return; }
    try {
      const headers = { 'X-Api-Key': key };
      if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
      const resp = await fetch(`${API_BASE}/balance`, { headers });
      const data = await resp.json();
      if (data.code === 200) {
        const bal = data.data;
        let display = '---';
        if (bal && bal.balance_infos) {
          for (const info of bal.balance_infos) {
            if (info.currency === 'CNY') {
              display = `¥${parseFloat(info.total_balance).toFixed(2)}`;
            }
          }
        } else if (bal && bal.total_balance !== undefined) {
          display = `¥${parseFloat(bal.total_balance).toFixed(2)}`;
        }
        $('balance-amount').textContent = display;
        $('stat-balance').textContent = display;
        localStorage.setItem('grindpal_balance', display);
        if (!silent) toast(t('settings.balance') + ': ' + display, 'success');
      } else {
        if (!silent) { $('balance-amount').textContent = '---'; toast(data.message || t('settings.balance.fail'), 'error'); }
      }
    } catch (e) {
      if (!silent) { $('balance-amount').textContent = '---'; toast(t('toast.networkError'), 'error'); }
    }
  },

  addTokens(promptTokens, completionTokens) {
    const total = (promptTokens || 0) + (completionTokens || 0);
    this._sessionTokens += total;
    this._totalTokens += total;
    sessionStorage.setItem('grindpal_session_tokens', this._sessionTokens);
    localStorage.setItem('grindpal_total_tokens', this._totalTokens);
    this._updateStats();
    // 每次生成后静默查询余额
    if (this._apiKey || localStorage.getItem('grindpal_apikey_enc')) this.queryBalance(true);
  },

  _updateStats() {
    $('stat-session').textContent = this._sessionTokens.toLocaleString();
    $('stat-total').textContent = this._totalTokens.toLocaleString();
    const saved = localStorage.getItem('grindpal_balance');
    if (saved) $('stat-balance').textContent = saved;
  },

  _sessionTokens: 0,
  _totalTokens: 0,

  toggleHistory() {
    const panel = $('history-panel');
    if (panel.classList.contains('show')) {
      panel.classList.remove('show'); this._removeOverlay();
    } else {
      this._renderHistory(); panel.classList.add('show'); this._showOverlay();
    }
  },

  toggleChangelog() {
    const el = document.getElementById('changelog-overlay');
    if (el.style.display !== 'flex') this._renderChangelog();
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
  },

  _renderChangelog() {
    const el = document.getElementById('changelog-content');
    if (el) el.innerHTML = t('changelog.content');
  },

  _renderHistory() {
    const list = $('history-list');
    const records = JSON.parse(localStorage.getItem('grindpal_history') || '[]');
    const search = ($('history-search')?.value || '').toLowerCase();
    let filtered = records;
    if (search) {
      filtered = records.filter(r => 
        (r.inputPreview || '').toLowerCase().includes(search) ||
        (r.resultPreview || '').toLowerCase().includes(search) ||
        (r.type || '').toLowerCase().includes(search)
      );
    }
    if (filtered.length === 0) {
      list.innerHTML = '<span style="color:var(--color-text-muted);font-size:13px">'+t('app.noRecords')+'</span>';
      $('history-select-all').checked = false;
      return;
    }
    list.innerHTML = filtered.map((r, i) => `
      <div class="history-item">
        <input type="checkbox" class="history-check" value="${r.id}" style="margin-right:8px;cursor:pointer" onclick="event.stopPropagation()">
        <span class="type-badge" onclick="App._loadHistory('${r.id}')">${t('nav.'+r.type) || this._escapeHtml(r.type)}</span>
        <span class="preview" onclick="App._loadHistory('${r.id}')">${this._escapeHtml(r.inputPreview || '')}</span>
        <span class="tokens">${r.tokens || 0} tokens</span>
        <span class="time">${r.time || ''}</span>
        <span class="material-icons" style="cursor:pointer;font-size:16px;color:var(--color-accent);flex-shrink:0" onclick="event.stopPropagation();App._continueFromHistory(${r.id},'${String(r.type).replace(/'/g,"\\'").replace(/\\/g,"\\\\")}')" title="${t('history.continue')}">chat_bubble</span>
      </div>
    `).join('');
    $('history-select-all').checked = false;
  },

  _selectAllHistory() {
    const checked = $('history-select-all').checked;
    document.querySelectorAll('.history-check').forEach(cb => cb.checked = checked);
  },

  _deleteSelected() {
    const checks = document.querySelectorAll('.history-check:checked');
    if (checks.length === 0) { toast(t('history.selectHint'), 'info'); return; }
    const cnt = checks.length;
    this._showConfirm(t("todos.batchDeleteConfirm").replace("{n}", cnt), () => {
      const records = JSON.parse(localStorage.getItem('grindpal_history') || '[]');
      const indices = Array.from(checks).map(cb => {
        const rid = cb.value;
        return records.findIndex(r => String(r.id) === String(rid));
      }).filter(i => i >= 0).sort((a,b) => b-a);
      for (const i of indices) records.splice(i, 1);
      localStorage.setItem('grindpal_history', JSON.stringify(records));
      this._renderHistory();
      toast(t('history.deletedCount').replace('{n}', cnt), 'info');
    });
  },

  async _loadHistory(recordId) {
    const records = JSON.parse(localStorage.getItem('grindpal_history') || '[]');
    const r = records.find(r => String(r.id) === String(recordId));
    if (!r) return;
    // 如果内容被截断，从后端加载完整内容
    let resultText = r.resultPreview || '';
    if (r.hasMore) {
      try {
        const resp = await fetch(`${API_BASE}/history/${r.id}`, { headers: this._authHeaders() });
        if (resp.ok) {
          const data = await resp.json();
          if (data.data && data.data.result_text) resultText = data.data.result_text;
        }
      } catch(e) {}
    }
    this._showConfirm(t("history.loadConfirm").replace("{type}", r.type), () => {
      this.switchTab({ 'ppt-outline':'ppt', 'weekly-report':'weeklyreport' }[r.type] || r.type);
      const tabMap = { summarize:'summarize', email:'email', minutes:'minutes', polish:'polish', reportese:'reportese', requirements:'requirements', prd:'prd', 'ppt-outline':'ppt', ppt:'ppt', 'weekly-report':'weeklyreport' };
      const prefix = tabMap[r.type] || r.type;
      const resultBox = $(`${prefix}-result`);
      const copyBtn = $(`${prefix}-copy`);
      if (resultBox) {
        resultBox.innerHTML = App._renderMd(resultText);
        resultBox.classList.add('show', 'markdown');
      }
      if (copyBtn) copyBtn.style.display = 'inline-flex';
      setTimeout(() => {
        App._lastKbChunks = (r.kbChunks && r.kbChunks.length) ? r.kbChunks : null;
        App._lastKbNames = r.kbChunks ? App._kbNamesFromGlobal() : null;
        if (r.kbChunks && r.kbChunks.length) {
          this._renderKbIndicator(prefix + '-result');
        }
      }, 50);if (r.type === 'polish') {
        const outText = $('polish-output-text');
        if (outText) outText.innerHTML = this._escapeHtml(r.resultPreview || '');
      }
      // 回溯输入内容
      const inputMap = { summarize:'summarize-input', email:'email-recipient', minutes:'minutes-input', polish:'polish-input', reportese:'reportese-input', requirements:'requirements-input', prd:'prd-input', 'ppt-outline':'ppt-topic', 'weekly-report':'wr-raw-notes' };
      const inputEl = $(inputMap[r.type]);
      if (inputEl && r.inputPreview) {
        if (r.type === 'email') {
          // Email has multiple fields, just set subject
        } else {
          inputEl.value = '';
          inputEl.placeholder = `历史输入: ${r.inputPreview}...`;
        }
      }
      $('history-panel').classList.remove('show');
      toast(t('toast.historyLoaded'), 'info');
    });
  },

  _escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  },

  _getTemplate(moduleType) {
    // 从服务器加载的模板缓存中查找匹配模板
    if (!this._templates || !this._templates.length) return null;
    // 优先：用户在风格下拉框中选择的模板
    const selectedId = localStorage.getItem('grindpal_style_' + moduleType);
    if (selectedId) {
      const sel = this._templates.find(t => String(t.id) === selectedId);
      if (sel && sel.system_prompt) return sel.system_prompt;
    }
    // 其次：is_default 的模板，匹配此模块
    const def = this._templates.find(t => {
      const mods = JSON.parse(t.modules || '[]');
      return t.is_default && (mods.length === 0 || mods.includes(moduleType));
    });
    if (def && def.system_prompt) return def.system_prompt;
    // 回退：第一个匹配此模块的模板
    const first = this._templates.find(t => {
      const mods = JSON.parse(t.modules || '[]');
      return mods.length === 0 || mods.includes(moduleType);
    });
    return first ? first.system_prompt || null : null;
  },

  saveTemplate(moduleType, name, instruction) {
    const tpls = JSON.parse(localStorage.getItem('grindpal_templates') || '{}');
    const key = moduleType + '_' + name;
    // 截断过长指令防 QuotaExceeded（完整版在服务端）
    tpls[key] = { name, instruction: (instruction || '').substring(0, 2000), moduleType };
    tpls[moduleType + '_active'] = instruction.substring(0, 2000);
    try { localStorage.setItem('grindpal_templates', JSON.stringify(tpls)); }
    catch(e) { if (e.name === 'QuotaExceededError') { toast(t('toast.localStorageFull'), 'error'); } }
    toast(`模板「${name}」已保存`, 'success');
  },

  deleteTemplate(moduleType, name) {
    const tpls = JSON.parse(localStorage.getItem('grindpal_templates') || '{}');
    delete tpls[moduleType + '_' + name];
    if (tpls[moduleType + '_active'] === name) delete tpls[moduleType + '_active'];
    try { localStorage.setItem('grindpal_templates', JSON.stringify(tpls)); }
    catch(e) { /* ignore */ }
  },

  getTemplates(moduleType) {
    const tpls = JSON.parse(localStorage.getItem('grindpal_templates') || '{}');
    return Object.values(tpls).filter(t => t.moduleType === moduleType);
  },

  saveHistory(type, inputPreview, resultPreview, tokens, recordId, kbChunks) {
    try {
    const records = JSON.parse(localStorage.getItem('grindpal_history') || '[]');
    // 截断长文本防止 QuotaExceeded，完整内容通过后端 API 加载
    const maxPreview = 500;
    const entry = {
      id: recordId || Date.now(), type, inputPreview: (inputPreview || '').substring(0, 200),
      resultPreview: (resultPreview || '').substring(0, maxPreview),
      tokens, hasMore: (resultPreview || '').length > maxPreview,
      time: new Date().toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
    };
    if (kbChunks && kbChunks.length) entry.kbChunks = kbChunks;
    records.unshift(entry);
    if (records.length > 10) records.length = 10;
    localStorage.setItem('grindpal_history', JSON.stringify(records));
    } catch(e) {
      if (e.name === 'QuotaExceededError') {
        // 配额满：只保留最近 3 条再试
        try {
          const records = JSON.parse(localStorage.getItem('grindpal_history') || '[]');
          records.splice(3);
          const entry = {
            id: recordId || Date.now(), type, inputPreview: (inputPreview || '').substring(0, 100),
            resultPreview: (resultPreview || '').substring(0, 300), tokens,
            time: new Date().toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
          };
          records.unshift(entry);
          localStorage.setItem('grindpal_history', JSON.stringify(records));
        } catch(e2) { console.error('saveHistory retry failed', e2); }
      } else { console.error('saveHistory failed', e); }
    }
  },

  async apiCall(endpoint, body) {
    this._showLoading();
    const epMap = {'/write-email':'email','/meeting-minutes':'minutes','/polish-report':'polish','/report-ese':'reportese','/weekly-report':'weeklyreport'};
    const moduleType = epMap[endpoint] || endpoint.replace('/','');
    const template = this._getTemplate(moduleType);
    if (template) body.custom_instruction = template;
    const key = await this.getApiKey();
    const model = localStorage.getItem('grindpal_model') || 'deepseek-v4-flash';
    const style = localStorage.getItem('grindpal_style') || 'standard';
    if (!key) { this._hideLoading(); toast(t('toast.apiKeyRequired'), 'error'); return; }
    const headers = this._authHeaders();
    headers['X-Api-Key'] = key;
    headers['X-Model'] = model;
    headers['X-Style'] = style;
    const kbCol = localStorage.getItem('grindpal_active_kb') || '';
    if (kbCol) headers['X-Kb-Collection'] = kbCol;
    const resp = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.code !== 200) {
      this._hideLoading();
      if (resp.status === 401) {
        toast(t('login.sessionExpired'), 'error');
        this._showReAuthDialog();
        return;
      }
      if (resp.status === 429) {
        toast(t('toast.rateLimited'), 'error');
      } else {
        toast(`这个文本比老板的心思还难懂，请检查后重试。（${data.detail || data.message || ''}）`, 'error');
      }
      return;
    }
    this._hideLoading();
    if (data.data && data.data.kb_chunks && data.data.kb_chunks.length) {
      this._lastKbChunks = data.data.kb_chunks;
      this._lastKbNames = App._kbNamesFromGlobal();
    } else {
      this._lastKbChunks = null;
      this._lastKbNames = null;
    }
    return data.data;
  },

  async apiCallStream(endpoint, body, onToken, onDone) {
    // 防重提交：每个端点独立锁，允许不同工具后台并行流式
    if (this._streamingEndpoint === endpoint) { toast(t('toast.pleaseWait'), 'warning'); return; }
    // 如果其他端点正在流式，不阻止 —— 让它后台继续
    this._streamingEndpoint = endpoint;
    this._streamingResultId = ({
      '/summarize':'summarize-result','/write-email':'email-result','/meeting-minutes':'minutes-result',
      '/polish-report':'polish-output-text','/report-ese':'reportese-result','/requirements':'requirements-result',
      '/prd':'prd-result','/ppt-outline':'ppt-result','/weekly-report':'weeklyreport-result'
    })[endpoint] || null;
    // 创建中止控制器
    this._abortController = new AbortController();
    const signal = this._abortController.signal;
    // 注入自定义模板指令
    const epMap = {'/write-email':'email','/meeting-minutes':'minutes','/polish-report':'polish','/report-ese':'reportese','/weekly-report':'weeklyreport'};
    const moduleType = epMap[endpoint] || endpoint.replace('/','');
    const template = this._getTemplate(moduleType);
    if (template) body.custom_instruction = template;
    const key = await this.getApiKey();
    const model = localStorage.getItem('grindpal_model') || 'deepseek-v4-flash';
    const style = localStorage.getItem('grindpal_style') || 'standard';
    if (!key) { toast(t('toast.apiKeyRequired'), 'error'); this._streamingEndpoint = null; this._streamingResultId = null; this._abortController = null; return; }
    const headers = this._authHeaders();
    headers['X-Api-Key'] = key;
    headers['X-Model'] = model;
    headers['X-Style'] = style;
    const kbCol2 = localStorage.getItem('grindpal_active_kb') || '';
    if (kbCol2) headers['X-Kb-Collection'] = kbCol2;
    let resp;
    try {
      resp = await fetch(`${API_BASE}${endpoint}?stream=true`, {
        method: 'POST', headers, body: JSON.stringify(body), signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') { /* 用户中止 */ }
      else { toast(t('toast.requestFailed'), 'error'); }
      this._streamingEndpoint = null; this._streamingResultId = null; this._abortController = null;
      document.querySelectorAll('.stop-btn').forEach(b => b.style.display = 'none');
      document.querySelectorAll('.nav-tab .streaming-dot').forEach(d => d.remove());
      return;
    }
    if (!resp.ok) {
      if (resp.status === 401) { toast(t('login.sessionExpired'), 'error'); this._showReAuthDialog(); }
      else if (resp.status === 429) { toast(t('toast.rateLimited'), 'error'); }
      else { toast(t('toast.requestFailed'), 'error'); }
      this._streamingEndpoint = null; this._streamingResultId = null; this._abortController = null;
      document.querySelectorAll('.stop-btn').forEach(b => b.style.display = 'none');
      document.querySelectorAll('.nav-tab .streaming-dot').forEach(d => d.remove());
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage = null;
    let extra = null;
    let aborted = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === 'token') onToken(d.content);
              else if (d.type === 'demo_token') { const ed = document.getElementById('prd-demo-editor'); if (ed) { ed.value += d.content; ed.scrollTop = ed.scrollHeight; } }
              else if (d.type === 'demo_done') { extra = extra || {}; extra.demo_html = d.demo_html || ''; if (d.usage) extra.usage = d.usage; const ed = document.getElementById('prd-demo-editor'); if (ed) { ed.readOnly = false; ed.placeholder = t('prd.demoEditable'); } Modules.prd._autoRunDemo(d.demo_html); Modules.prd._demoPending = false; toast(t('prd.demoGenerated'), 'success'); }
              else if (d.type === 'demo_error') { const ed = document.getElementById('prd-demo-editor'); if (ed) { ed.readOnly = false; ed.value += '\n/* ' + t('prd.demoFailed') + ': ' + (d.message || t('toast.unknownError')) + ' */'; } const s = document.getElementById('prd-demo-status'); if (s) s.textContent = t('prd.demoFailed'); Modules.prd._demoPending = false; }
              else if (d.type === 'done') { usage = d.usage; extra = extra || {}; extra.record_id = d.record_id; extra.kb_chunks = d.kb_chunks; if (d.demo_html !== undefined) extra.demo_html = d.demo_html; App._lastKbChunks = d.kb_chunks || null; App._lastKbNames = d.kb_chunks ? App._kbNamesFromGlobal() : null; if (d.demo_html !== undefined && Modules.prd) Modules.prd._demoHtml = d.demo_html; }
              else if (d.type === 'error') { toast(d.message, 'error'); usage = null; break; }
            } catch (e) {}
          }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') { aborted = true; }
    }
    this._streamingEndpoint = null;
    this._streamingResultId = null;
    this._abortController = null;
    document.querySelectorAll('.stop-btn').forEach(b => b.style.display = 'none');
    document.querySelectorAll('.nav-tab .streaming-dot').forEach(d => d.remove());
    if (aborted) return;
    if (onDone) onDone(usage, extra);
    // 自动高亮知识库引用 + 辅助按钮
    const refMap = { '/summarize':'summarize-result', '/write-email':'email-result', '/meeting-minutes':'minutes-result', '/polish-report':'polish-output-text', '/report-ese':'reportese-result', '/requirements':'requirements-result', '/prd':'prd-result', '/ppt-outline':'ppt-result', '/weekly-report':'weeklyreport-result' };
    const refId = refMap[endpoint];
    if (refId && usage) {
      setTimeout(() => this._renderKbIndicator(refId), 200);
      const tid = refId + '-todo';
      const btn = document.getElementById(tid);
      if (btn) btn.style.display = 'inline-flex';
    }
    return usage;
  },

  stopGeneration() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    // Also abort chat streaming if active (ChatApp uses its own _abortController)
    if (typeof ChatApp !== 'undefined' && ChatApp._abortController) {
      ChatApp._abortController.abort();
      ChatApp._abortController = null;
    }
    this._streamingEndpoint = null;
    this._streamingResultId = null;
    document.querySelectorAll('.stop-btn').forEach(b => b.style.display = 'none');
    document.querySelectorAll('.nav-tab .streaming-dot').forEach(d => d.remove());
    toast(t('toast.generationStopped'), 'info');
  },

  copyText(elementId) {
    const el = $(elementId);
    if (!el) return;
    const text = el.textContent || el.innerText || '';
    navigator.clipboard.writeText(text).then(() => {
      toast('Copied to clipboard', 'success');
    }).catch(() => {
      toast(t('toast.copyFailed'), 'error');
    });
  },

  copyResult(resultId) {
    this.copyText(resultId);
  },

  async exportDocx(content, title) {
    try {
      const token = this._token || localStorage.getItem('grindpal_token') || '';
      const resp = await fetch(`${API_BASE}/export-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ content: String(content || ''), title: String(title || 'export'), lang: (typeof getLang === 'function' ? getLang() : 'zh-CN') === 'zh-CN' ? 'zh' : 'en' }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        toast(t('toast.exportFailed') + ': HTTP ' + resp.status + ' - ' + text.substring(0, 100), 'error');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (title || 'export') + '.docx';
      a.click(); URL.revokeObjectURL(url);
      toast(t('toast.exported') + ' Word 📥', 'success');
    } catch (e) { toast(t('toast.exportNetworkError'), 'error'); }
  },
  // 显式绑定到 window 确保内联 onclick 可访问
  _renderMd(md) {
    if (!md) return '';
    // 预处理：将 【参考 N · 来源：xxx】和 ——参考 N 转为可点击引用标签（在 marked 解析前，避免被转义）
    let processed = md.replace(
      /【参考\s*(\d+)\s*[·\s]*来源[：:]\s*([^】]+)】|（参考资料[：:]\s*([^）]+)）|[—\-]{2,3}\s*参考\s*(\d+)/g,
      (match, num, src, altSrc, dashNum) => {
        const n = num || dashNum || '?';
        const s = App._escapeAttr(src || altSrc || '');
        // 破折号引用无文件名时只显示编号
        const label = (src || altSrc) ? `${n}·${App._escapeHtml(src || altSrc || '')}` : `参考${n}`;
        return `<span class="ref-citation" data-ref-src="${s}" data-ref-num="${n}" title="点击查看来源片段"><span class="material-icons" style="font-size:11px;vertical-align:middle">attach_file</span>${label}</span>`;
      }
    );
    let html;
    if (typeof marked !== 'undefined') { marked.setOptions({ breaks: false, gfm: true }); html = marked.parse(processed); }
    else { html = processed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }
    html = App._sanitizeHtml(html);
    // 注入代码块复制按钮 + 语法高亮
    html = App._enhanceCodeBlocks(html);
    return html;
  },

  /** 为代码块注入复制按钮并应用语法高亮 */
  _enhanceCodeBlocks(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const pres = div.querySelectorAll('pre');
    pres.forEach(pre => {
      // 跳过已处理的
      if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) return;
      const code = pre.querySelector('code');
      const lang = code && code.className ? (code.className.match(/language-(\w+)/) || [])[1] : '';
      // 语法高亮
      if (typeof hljs !== 'undefined' && code) {
        if (lang && hljs.getLanguage(lang)) {
          code.classList.add('language-' + lang);
          hljs.highlightElement(code);
        } else {
          hljs.highlightElement(code);
        }
      }
      // 包装 + 复制按钮
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-code-btn';
      copyBtn.textContent = t('app.copy');
      copyBtn.onclick = function() {
        const text = (code || pre).textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = t('toast.copySuccess');
          copyBtn.classList.add('copied');
          setTimeout(() => { copyBtn.textContent = t('app.copy'); copyBtn.classList.remove('copied'); }, 1500);
        }).catch(() => {});
      };
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(copyBtn);
      wrapper.appendChild(pre);
    });
    return div.innerHTML;
  },

  /** HTML 转义（用于 innerHTML 中的文本内容） */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
  /** 属性值转义（用于 data-* 属性） */
  _escapeAttr(str) {
    return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
  },
  /** 使用 DOMPurify 进行 HTML 清洗，防止 XSS */
  _sanitizeHtml(html) {
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['b','i','em','strong','a','p','ul','ol','li','br','hr','h1','h2','h3','h4','h5','h6','code','pre','blockquote','table','thead','tbody','tr','th','td','span','div','img','sup','sub','del','ins','mark','details','summary'],
        ALLOWED_ATTR: ['href','src','alt','title','class','id','target'],
        ALLOW_DATA_ATTR: true,
      });
    }
    // 降级：轻量正则过滤
    html = html.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '');
    html = html.replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    return html;
  },
};
window.App = App;

// 全局事件委托：处理引用标签点击（_renderMd 生成的 .ref-citation 不含 onclick，靠此处捕获）
document.addEventListener('click', function(e) {
  const ref = e.target.closest('.ref-citation');
  if (!ref) return;
  e.stopPropagation();
  const src = ref.dataset.refSrc || '';
  const num = parseInt(ref.dataset.refNum) || 0;
  App._showRefTooltip(e, src, num);
});

// 全局事件委托：KB 指示条点击展开/收起面板
document.addEventListener('click', function(e) {
  const bar = e.target.closest('.kb-indicator');
  if (!bar) return;
  e.stopPropagation();
  const arrow = bar.querySelector('.kb-ind-arrow');
  const pnl = bar.nextElementSibling;
  if (!pnl || !pnl.classList.contains('kb-ind-panel')) return;
  if (pnl.style.display === 'block') { pnl.style.display = 'none'; if (arrow) arrow.style.transform = 'rotate(0deg)'; }
  else { pnl.style.display = 'block'; if (arrow) arrow.style.transform = 'rotate(180deg)'; }
});

// ---- 功能模块 ----

const Modules = {
  // 1. 太长不看
  summarize: {
    _length: 'medium',
    setLength(len, el) {
      this._length = len;
      el.parentElement.querySelectorAll('.tag').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    },
    async submit() {
      const text = $('summarize-input').value.trim();
      if (!text) { toast(t('toast.textContentRequired'), 'error'); return; }
      const resultBox = $('summarize-result');
      resultBox.textContent = t('loading.thinking');
      resultBox.classList.add('show', 'thinking');
      $('summarize-copy').style.display = 'none';
      let raw = '', first = true;
      try {
        $('summarize-stop').style.display = 'inline-flex';
        await App.apiCallStream('/summarize', { text, length: this._length },
          (token) => {
            if (first) { resultBox.innerHTML = ''; resultBox.classList.remove('thinking'); first = false; }
            raw += token; resultBox.innerHTML = App._renderMd(raw);
          },
          (usage, extra) => {
            this._lastRaw = raw;
            $('summarize-copy').style.display = 'inline-flex'; $('summarize-export').style.display = 'inline-flex';if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            App.saveHistory('summarize', text.substring(0, 100), raw, (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast(_successTexts().summarize, 'success');
          }
        );
      } catch (e) {}
  }
},

  // 2. 已读乱回
  email: {
    _isReply: false,

    toggleReply() {
      this._isReply = $('email-mode').value === 'reply';
      $('email-original').style.display = this._isReply ? 'block' : 'none';
    },

    async submit() {
      const recipient = $('email-recipient').value.trim();
      const subject = $('email-subject').value.trim();
      const pointsRaw = $('email-points').value.trim();
      const tone = $('email-tone').value;
      const originalEmail = this._isReply ? ($('email-original').value.trim() || '') : '';
      const points = pointsRaw ? pointsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
      const resultBox = $('email-result');
      resultBox.textContent = t('loading.thinking');
      resultBox.classList.add('show', 'thinking');
      $('email-copy').style.display = 'none';
      let raw = '', first = true;
      try {
        $('email-stop').style.display = 'inline-flex';
        await App.apiCallStream('/write-email', { recipient, subject_keywords: subject, points, tone, original_email: originalEmail },
          (token) => {
            if (first) { resultBox.innerHTML = ''; resultBox.classList.remove('thinking'); first = false; }
            raw += token; resultBox.innerHTML = App._renderMd(raw);
          },
          (usage, extra) => {
            this._lastRaw = raw;
            $('email-copy').style.display = 'inline-flex'; $('email-export').style.display = 'inline-flex';if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            App.saveHistory('email', `收件人:${recipient} 主题:${subject}`, raw, (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast(_successTexts().email, 'success');
          }
        );
      } catch (e) {}
    }
  },

  // 3. 人云议云
  minutes: {
    _isRecording: false,
    _mediaRecorder: null,
    _language: (function(){ try { return getLang() === 'en-US' ? 'en' : 'zh'; } catch(e) { return 'zh'; } })(),
    _segments: [],
    _timerInterval: null,
    _currentChunks: [],
    _stream: null,
    _segId: 0,
    _chunkQueue: Promise.resolve(),
    _batchMode: true,
    _model: 'medium',        // 实时转录模型: base/small/medium

    toggleModel() {
      const models = ['medium', 'small'];
      const labels = { small: '<span class="material-icons" style="font-size:14px;vertical-align:middle">bolt</span> ' + t('mod.minutes.modelFast'), medium: '<span class="material-icons" style="font-size:14px;vertical-align:middle">memory</span> ' + t('mod.minutes.modelQuality') };
      const idx = models.indexOf(this._model);
      this._model = models[(idx + 1) % models.length];
      $('model-btn').innerHTML = labels[this._model];
      $('model-btn').title = t('mod.minutes.modelTitle') + ': ' + (this._model === 'medium' ? t('mod.minutes.modelQuality') : t('mod.minutes.modelFast'));
    },

    toggleMode() {
      this._batchMode = !this._batchMode;
      const el = $('mode-btn');
      el.textContent = '';
      const icon = document.createElement('span');
      icon.className = 'material-icons';
      icon.style.cssText = 'font-size:14px;vertical-align:middle';
      icon.textContent = this._batchMode ? 'inventory_2' : 'bolt';
      el.appendChild(icon);
      el.appendChild(document.createTextNode(' ' + t(this._batchMode ? 'mod.minutes.modeBtnComplete' : 'mod.minutes.modeBtnRealtime')));
      el.style.background = this._batchMode ? 'var(--color-accent)' : '';
      el.style.color = this._batchMode ? '#fff' : '';
      if (!this._isRecording && this._segments.length === 0) {
        $('segments-list').innerHTML = `<span style="color:var(--color-text-muted);font-size:13px">${
          t(this._batchMode ? 'mod.minutes.modeCompleteHint' : 'mod.minutes.modeRealtimeHint')
        }</span>`;
      }
      // 模式切换时自动选择合适的模型：实时→性能（快），完成→质量（准）
      const labels = { small: '<span class="material-icons" style="font-size:14px;vertical-align:middle">bolt</span> ' + t('mod.minutes.modelFast'), medium: '<span class="material-icons" style="font-size:14px;vertical-align:middle">memory</span> ' + t('mod.minutes.modelQuality') };
      this._model = this._batchMode ? 'medium' : 'small';
      $('model-btn').innerHTML = labels[this._model];
    },

    toggleLang() {
      const states = [
        { v: 'zh', label: '🇨🇳 中文' },
        { v: 'en', label: '🇬🇧 English' },
      ];
      const idx = states.findIndex(s => s.v === this._language);
      const next = states[(idx + 1) % states.length];
      this._language = next.v;
      $('lang-btn').textContent = next.label;
    },

    toggleMic() {
      if (this._isRecording) { this._stopMic(); }
      else { this._startMic(); }
    },

    _startMic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast(t('mod.minutes.noSupport'), 'error'); return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        this._stream = stream;
        this._mediaRecorder = new MediaRecorder(stream);
        this._currentChunks = [];
        this._isRecording = true;
        this._startTime = Date.now();

        this._mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            this._currentChunks.push(e.data);
            if (this._batchMode) return; // 批量模式：只积累，不转写
            const blob = new Blob([e.data], { type: 'audio/webm' });
            const f = new File([blob], 'chunk.webm', { type: 'audio/webm' });
            this._transcribeChunk(f, this._segId);
          }
        };

        this._mediaRecorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          const fullBlob = new Blob(this._currentChunks, { type: 'audio/webm' });
          const url = URL.createObjectURL(fullBlob);
          const duration = Math.round((Date.now() - this._startTime) / 1000);
          const existing = this._segments.find(s => s.id === this._segId);
          if (existing) {
            existing.blob = fullBlob; existing.url = url; existing.duration = duration;
          }
          this._renderSegments();
          this._syncInput();
          // 批量模式：发送完整录音给批量端点
          if (this._batchMode && fullBlob.size > 0) {
            this._batchTranscribe(fullBlob, this._segId);
          }
        };

        this._mediaRecorder.start(4000);
        $('mic-btn').innerHTML = '<span class="material-icons" style="font-size:16px;vertical-align:middle">stop</span> ' + t('mod.minutes.stopRec');
        $('mic-btn').style.background = 'var(--color-error)';
        $('mic-btn').style.color = '#fff';
        $('mic-timer').style.display = 'inline';
        this._timerInterval = setInterval(() => {
          const elapsed = Math.round((Date.now() - this._startTime) / 1000);
          const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
          const s = (elapsed % 60).toString().padStart(2, '0');
          $('mic-timer').textContent = `${m}:${s}`;
        }, 1000);

        this._segId++;
        this._segments.push({ id: this._segId, text: '', duration: 0, blob: null, url: null });
        this._renderSegments();
        $('mic-status').innerHTML = this._batchMode
          ? t('mod.minutes.recording')
          : '<span class="material-icons" style="font-size:12px;color:var(--color-error)">fiber_manual_record</span> ' + t('mod.minutes.realtimeRecording');
        $('smooth-btn').style.display = 'none';
      }).catch(() => toast(t('mod.minutes.micDenied'), 'error'));
    },

    _stopMic() {
      if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
        this._mediaRecorder.stop();
      }
      this._isRecording = false;
      clearInterval(this._timerInterval);
      $('mic-btn').innerHTML = '<span class="material-icons" style="font-size:16px;vertical-align:middle">mic</span> ' + t('mod.minutes.startRec');
      $('mic-btn').style.background = '';
      $('mic-btn').style.color = '';
      $('mic-timer').style.display = 'none';
      $('mic-status').textContent = '';
    },

    async uploadAudio() {
      const file = $('minutes-audio').files[0];
      if (!file) return;
      $('mic-status').textContent = t('mod.minutes.uploading');
      const form = new FormData();
      form.append('file', file);
      form.append('language', this._language);
      form.append('model', this._model);
      form.append('gpu_layers', '0');
      const headers = {};
      if (App._token) headers['Authorization'] = `Bearer ${App._token}`;
      try {
        const resp = await fetch(`/api/v1/transcribe-vad`, { method: 'POST', headers, body: form });
        const data = await resp.json();
        if (data.code === 200 && data.data.text) {
          this._segId++;
          this._segments.push({ id: this._segId, text: data.data.text, duration: 0, blob: null, url: null });
          this._renderSegments();
          this._syncInput();
          $('mic-status').textContent = t('mod.minutes.transcribeDone');
          toast(t('mod.minutes.transcribeDone'), 'success');
        } else {
          $('mic-status').textContent = (data.message || '失败');
          toast(data.message || '转写失败', 'error');
        }
      } catch (e) {
        $('mic-status').textContent = t('mod.minutes.uploadFail');
      }
    },

    async _transcribeChunk(file, segId) {
      this._chunkQueue = this._chunkQueue.then(() => this._doChunk(file, segId));
    },
    async _doChunk(file, segId) {
      const form = new FormData();
      form.append('file', file);
      form.append('language', this._language);
      form.append('model', this._model);
      form.append('gpu_layers', '0');
      const headers = {};
      if (App._token) headers['Authorization'] = `Bearer ${App._token}`;
      try {
        const resp = await fetch(`/api/v1/transcribe-vad`, { method: 'POST', headers, body: form });
        const data = await resp.json();
        if (data.code === 200 && data.data.text) {
          const seg = this._segments.find(s => s.id === segId);
          if (seg) { seg.text += (seg.text ? ' ' : '') + data.data.text; this._renderSegments(); this._syncInput(); }
        }
      } catch (e) {}
    },

    async _batchTranscribe(blob, segId) {
      $('mic-status').textContent = t('mod.minutes.fullTranscribing');
      const form = new FormData();
      form.append('file', new File([blob], 'full.webm', { type: 'audio/webm' }));
      form.append('language', this._language);
      form.append('model', this._model);
      form.append('gpu_layers', '0');
      const headers = {};
      if (App._token) headers['Authorization'] = `Bearer ${App._token}`;
      try {
        const resp = await fetch('/api/v1/transcribe-batch', { method: 'POST', headers, body: form });
        const data = await resp.json();
        if (data.code === 200 && data.data.text) {
          const seg = this._segments.find(s => s.id === segId);
          if (seg) { seg.text = data.data.text; this._renderSegments(); this._syncInput(); }
          $('mic-status').textContent = t('mod.minutes.transcribeDone');
          $('smooth-btn').style.display = 'inline-block';
          toast(t('mod.minutes.transcribeDone'), 'success');
        } else {
          $('mic-status').textContent = (data.message || '失败');
          toast(data.message || '转写失败', 'error');
        }
      } catch (e) {
        $('mic-status').textContent = t('toast.fetchFail');
      }
    },

    async _smoothText() {
      const allText = this._segments.map(s => s.text).filter(Boolean).join('\n');
      if (!allText) { toast(t('toast.noTextToCorrect'), 'error'); return; }
      $('smooth-btn').textContent = '⏳ 纠错中…'; $('smooth-btn').disabled = true;
      App._showLoading(t('loading.correcting'));
      const headers = { 'Content-Type': 'application/json' };
      if (App._token) headers['Authorization'] = `Bearer ${App._token}`;
      headers['X-Api-Key'] = await App.getApiKey();
      headers['X-Model'] = localStorage.getItem('grindpal_model') || 'deepseek-v4-flash';
      try {
        const resp = await fetch('/api/v1/correct-text', {
          method: 'POST', headers,
          body: JSON.stringify({ text: allText }),
        });
        const data = await resp.json();
        if (data.code === 200 && data.data.text) {
          // 保留所有原始录音片段的 blob/url，只替换文本
          const orig = this._segments;
          const allBlobs = orig.filter(x => x.blob).map(x => x.blob);
          const allUrls = orig.filter(x => x.url).map(x => x.url);
          this._segments = [{ id: 1, text: data.data.text, duration: orig.reduce((s, x) => s + (x.duration || 0), 0),
                              blobs: allBlobs, urls: allUrls }];
          this._renderSegments(); this._syncInput();
          toast('AI 顺滑完成', 'success');
          App._hideLoading();
        } else {
          toast(data.message || '纠错失败', 'error');
          App._hideLoading();
        }
      } catch (e) { toast(t('toast.correctFailed'), 'error'); App._hideLoading(); }
      $('smooth-btn').textContent = 'AI 顺滑纠错'; $('smooth-btn').disabled = false;
    },

    _renderSegments() {
      const list = $('segments-list');
      if (this._segments.length === 0) {
        list.innerHTML = '<span style="color:var(--color-text-muted);font-size:13px">'+t('mod.minutes.modeCompleteHint')+'</span>';
        return;
      }
      list.innerHTML = this._segments.slice().reverse().map((seg, i) => {
        const urls = seg.urls || (seg.url ? [seg.url] : []);
        const audioHtml = urls.length > 0
          ? urls.map((u, ui) => `<audio controls src="${u}" style="height:32px;min-width:200px" preload="metadata"></audio>`).join('')
          : (seg.text ? '<span class="material-icons" style="font-size:12px;color:var(--color-success)">check_circle</span>' : '<span style="color:var(--color-text-muted);font-size:12px">' + t('mod.minutes.transcribing') + '</span>');
        const downloadHtml = urls.map((u, ui) =>
          `<a href="${u}" download="recording_${seg.id}_${ui+1}.webm" style="font-size:11px;color:var(--color-accent);text-decoration:none" title="下载片段${ui+1}">⬇${urls.length>1?ui+1:''}</a>`
        ).join(' ');
        return `
        <div class="history-item" style="flex-wrap:wrap;align-items:flex-start;gap:8px">
          <span style="font-weight:600;color:var(--color-primary);min-width:40px">#${seg.id}</span>
          ${audioHtml}
          <span style="flex:1;font-size:13px;color:var(--color-text);min-width:120px">${seg.text || t('mod.minutes.waiting')}</span>
          <span style="font-size:11px;color:var(--color-text-muted)">${seg.duration || 0}s</span>
          ${downloadHtml}
          <span style="cursor:pointer;color:var(--color-error);font-size:14px" onclick="Modules.minutes._deleteSeg(${seg.id})" title="删除">✕</span>
        </div>
      `}).join('');
      // 有文本时显示 AI 顺滑按钮
      const hasText = this._segments.some(s => s.text);
      const sb = $('smooth-btn');
      if (sb) sb.style.display = hasText ? 'inline-flex' : 'none';
    },

    _deleteSeg(id) {
      const seg = this._segments.find(s => s.id === id);
      if (seg) {
        const urls = seg.urls || (seg.url ? [seg.url] : []);
        urls.forEach(u => { try { URL.revokeObjectURL(u); } catch(e) {} });
      }
      this._segments = this._segments.filter(s => s.id !== id);
      this._renderSegments();
      this._syncInput();
    },

    _syncInput() {
      $('minutes-input').value = this._segments.map(s => s.text).filter(Boolean).join('\n');
    },

    async submit() {
      const transcript = $('minutes-input').value.trim();
      if (!transcript) { toast(t('error.inputRequired2'), 'error'); return; }
      const speakerTags = $('minutes-speakers').checked;
      const resultBox = $('minutes-result');
      resultBox.innerHTML = '<span style="color:var(--color-text-muted);font-style:italic">' + t('loading.thinking') + '</span>';
      resultBox.classList.add('show');
      $('minutes-copy').style.display = 'none';
      $('minutes-export').style.display = 'none';
      let raw = '', first = true;
      try {
        $('minutes-stop').style.display = 'inline-flex';
        await App.apiCallStream('/meeting-minutes', { transcript, speaker_tags: speakerTags },
          (token) => { if (first) { resultBox.innerHTML = ''; first = false; } raw += token; resultBox.innerHTML = App._renderMd(raw); },
          (usage, extra) => {
            this._lastRaw = raw;
            resultBox.innerHTML = App._renderMd(raw);
            $('minutes-copy').style.display = 'inline-flex'; $('minutes-export').style.display = 'inline-flex';
            if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            App.saveHistory('minutes', transcript.substring(0, 100), raw, (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast(_successTexts().minutes, 'success');
          }
        );
      } catch (e) {}
    },
  },


  polish: {
    _style: 'business',
    setStyle(s, el) {
      this._style = s;
      el.parentElement.querySelectorAll('.tag').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    },
    uploadFile() {
      const file = $('polish-file').files[0];
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      if (['txt','md','text'].includes(ext)) {
        App._showLoading('正在读取文件…');
        const reader = new FileReader();
        reader.onload = (e) => {
          let text = e.target.result;
          if (text.length > 20000) text = text.substring(0, 20000);
          $('polish-input').value = text;
          App._hideLoading();
          toast(`已读取: ${file.name} (${text.length}字)`, 'success');
        };
        reader.readAsText(file);
      } else if (['docx','doc'].includes(ext)) {
        this._uploadToBackend(file);
      } else {
        toast(t('toast.formatNotSupported'), 'error');
      }
    },
    async _uploadToBackend(file) {
      App._showLoading('正在解析文件…');
      const form = new FormData();
      form.append('file', file);
      const headers = {};
      if (App._token) headers['Authorization'] = `Bearer ${App._token}`;
      try {
        const resp = await fetch(`${API_BASE}/extract-text`, { method: 'POST', headers, body: form });
        const data = await resp.json();
        App._hideLoading();
        if (data.code === 200) {
          $('polish-input').value = data.data.text;
          toast(`已解析: ${file.name} (${data.data.length}字)`, 'success');
        } else {
          toast(data.message || '解析失败', 'error');
        }
      } catch (e) {
        App._hideLoading();
        toast(t('toast.uploadFailed'), 'error');
      }
    },
    async submit() {
      const draft = $('polish-input').value.trim();
      if (!draft) { toast(t('error.inputRequired'), 'error'); return; }
      const outText = $('polish-output-text');
      outText.textContent = t('loading.thinking');
      outText.style.color = 'var(--color-text-muted)';
      outText.style.fontStyle = 'italic';
      $('polish-copy').style.display = 'none';
      $('polish-export').style.display = 'none';
      let raw = '', first = true;
      try {
        $('polish-stop').style.display = 'inline-flex';
        await App.apiCallStream('/polish-report', { draft, style: this._style },
          (token) => {
            if (first) { outText.textContent = ''; outText.style.color = ''; outText.style.fontStyle = ''; first = false; }
            raw += token; outText.textContent = raw;
          },
          (usage, extra) => {
            this._lastRaw = raw;
            outText.innerHTML = App._renderMd(raw);
            $('polish-copy').style.display = 'inline-flex';$('polish-export').style.display = 'inline-flex';if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            App.saveHistory('polish', draft.substring(0, 100), raw, (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast(_successTexts().polish, 'success');
          }
        );
      } catch (e) {}
    }
  },

  // 5. 向上管理
  reportese: {
    _style: 'result-oriented',
    setStyle(s, el) {
      this._style = s;
      el.parentElement.querySelectorAll('.tag').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    },
    async submit() {
      const rant = $('reportese-input').value.trim();
      if (!rant) { toast(t('error.rantRequired'), 'error'); return; }
      const resultBox = $('reportese-result');
      resultBox.textContent = t('loading.thinking');
      resultBox.classList.add('show', 'thinking');
      $('reportese-copy').style.display = 'none';
      let first = true, raw = '';
      try {
        $('reportese-stop').style.display = 'inline-flex';
        await App.apiCallStream('/report-ese', { rant, style: this._style },
          (token) => {
            if (first) { resultBox.innerHTML = ''; resultBox.classList.remove('thinking'); first = false; }
            raw += token; resultBox.innerHTML = App._renderMd(raw);
          },
          (usage, extra) => {
            this._lastRaw = raw;
            $('reportese-copy').style.display = 'inline-flex'; $('reportese-export').style.display = 'inline-flex';if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            App.saveHistory('reportese', rant.substring(0, 100), raw, (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast(_successTexts().reportese, 'success');
          }
        );
      } catch (e) {}
    }
  },

  // 6. 需求炼金
  requirements: {
    _style: 'spec',
    setStyle(s, el) {
      this._style = s;
      el.parentElement.querySelectorAll('[data-rqstyle]').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    },
    async submit() {
      const text = $('requirements-input').value.trim();
      if (!text) { toast(t('error.textRequired'), 'error'); return; }
      const resultBox = $('requirements-result');
      resultBox.innerHTML = '<span style="color:var(--color-text-muted);font-style:italic">' + t('loading.thinking') + '</span>';
      resultBox.classList.add('show');
      $('requirements-copy').style.display = 'none';
      let first = true;
      try {
        $('requirements-stop').style.display = 'inline-flex';
        let raw = '';
        await App.apiCallStream('/requirements', { text, style: this._style },
          (token) => {
            if (first) { resultBox.innerHTML = ''; first = false; }
            raw += token; resultBox.innerHTML = App._renderMd(raw);
          },
          (usage, extra) => {
            this._lastRaw = raw;
            $('requirements-copy').style.display = 'inline-flex'; $('requirements-export').style.display = 'inline-flex';if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            App.saveHistory('requirements', text.substring(0, 100), raw, (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast(t('toast.requirementsDone'), 'success');
          }
        );
      } catch (e) {}
    }
  },

  // 7. 产品画饼
  prd: {
    _style: 'full',
    _demoHtml: '',
    setStyle(s, el) {
      this._style = s;
      el.parentElement.querySelectorAll('[data-prdstyle]').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    },
    async submit() {
      const idea = $('prd-input').value.trim();
      if (!idea) { toast(t('error.ideaRequired'), 'error'); return; }
      const withDemo = $('prd-demo').checked;
      const resultBox = $('prd-result');
      resultBox.innerHTML = '<span style="color:var(--color-text-muted);font-style:italic">' + t('loading.thinking') + '</span>';
      resultBox.style.display = 'block';
      $('prd-copy').style.display = 'none';
      $('prd-demo-box').style.display = 'none';
      if (withDemo) {
        this._demoPending = true;
        $('prd-demo-box').style.display = 'block';
        // 重置编辑器
        const ed = $('prd-demo-editor');
        ed.value = '';
        ed.readOnly = true;
        ed.placeholder = 'Demo 代码流式生成中…';
        $('prd-demo-frame').srcdoc = '';
        $('prd-demo-status').textContent = '';
        this._switchDemoTab('code');
      }
      let raw = '', first = true;
      try {
        $('prd-stop').style.display = 'inline-flex';
        await App.apiCallStream('/prd', { idea, style: this._style, with_demo: withDemo, _stream: true },
          (token) => {
            if (first) { resultBox.innerHTML = ''; first = false; }
            raw += token; resultBox.innerHTML = App._renderMd(raw);
          },
          (usage, extra) => {
            this._lastRaw = raw;
            resultBox.innerHTML = App._renderMd(raw);
            $('prd-copy').style.display = 'inline-flex'; $('prd-export').style.display = 'inline-flex';if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            const tokens = (extra?.usage?.prompt_tokens || usage?.prompt_tokens || 0) + (extra?.usage?.completion_tokens || usage?.completion_tokens || 0);
            App.saveHistory('prd', idea.substring(0, 100), raw, tokens, extra?.record_id, extra?.kb_chunks);
            const demoHtml = (extra && extra.demo_html) || '';
            if (!withDemo || demoHtml) {
              toast(t('prd.generated') + (Modules.prd._demoPending ? t('prd.generatingDemo') : ''), 'success');
            } else {
              toast(t('mod.prd.successNoDemo'), 'success');
            }
          }
        );
      } catch (e) { console.error('PRD failed', e); toast('PRD 生成失败: ' + (e.message || '网络错误'), 'error'); }
    },
    _switchDemoTab(tab) {
      document.querySelectorAll('#prd-demo-box .demo-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.demotab === tab);
        b.style.background = b.dataset.demotab === tab ? 'var(--color-card)' : 'var(--color-bg)';
        b.style.color = b.dataset.demotab === tab ? 'var(--color-text)' : 'var(--color-text-muted)';
      });
      $('prd-demo-code').style.display = tab === 'code' ? 'block' : 'none';
      $('prd-demo-run').style.display = tab === 'run' ? 'block' : 'none';
    },
    _autoRunDemo(html) {
      if (!html) return;
      this._demoHtml = html;
      $('prd-demo-frame').srcdoc = html;
      $('prd-demo-status').textContent = 'Demo 已生成 — 切换到「代码」标签可编辑';
    },
    runDemo() {
      const ed = $('prd-demo-editor');
      const code = ed ? ed.value.trim() : '';
      if (!code) { toast(t('error.codeFirst'), 'error'); return; }
      this._demoHtml = code;
      $('prd-demo-frame').srcdoc = code;
      $('prd-demo-status').textContent = t('prd.demoRanCustom');
      this._switchDemoTab('run');
    },
    openDemo() {
      const code = ($('prd-demo-editor')?.value || this._demoHtml || '').trim();
      if (!code) return;
      const blob = new Blob([code], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    },
    downloadDemo() {
      const code = ($('prd-demo-editor')?.value || this._demoHtml || '').trim();
      if (!code) return;
      const blob = new Blob([code], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'prd-demo.html';
      a.click();
      toast('Demo 下载中...', 'info');
    },
  },

  // 8. PPT雕花
  ppt: {
    _style: 'outline',
    setStyle(s, el) {
      this._style = s;
      el.parentElement.querySelectorAll('[data-pptstyle]').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    },
    async submit() {
      const topic = $('ppt-topic').value.trim();
      const points = $('ppt-points').value.trim();
      if (!topic) { toast(t('error.topicRequired'), 'error'); return; }
      const resultBox = $('ppt-result');
      resultBox.innerHTML = '<span style="color:var(--color-text-muted);font-style:italic">' + t('loading.thinking') + '</span>';
      resultBox.classList.add('show');
      $('ppt-copy').style.display = 'none';
      $('ppt-export').style.display = 'none';
      $('ppt-pptx').style.display = 'none';
      this._lastRaw = ''; let raw = '', first = true;
      try {
        $('ppt-stop').style.display = 'inline-flex';
        await App.apiCallStream('/ppt-outline', { topic, points, style: this._style },
          (token) => {
            if (first) { resultBox.innerHTML = ''; first = false; }
            raw += token; this._lastRaw = raw; resultBox.innerHTML = App._renderMd(raw);
          },
          (usage, extra) => {
            resultBox.innerHTML = App._renderMd(raw);
            $('ppt-copy').style.display = 'inline-flex';$('ppt-export').style.display = 'inline-flex';$('ppt-pptx').style.display = 'inline-flex';if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            App.saveHistory('ppt-outline', topic, raw, (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast('PPT大纲已生成', 'success');
          }
        );
      } catch (e) {}
    },
    async _exportPptx() {
      const content = this._lastRaw || $('ppt-result').textContent.trim();
      if (!content) { toast(t('error.outlineFirst'), 'error'); return; }
      // 弹窗选择主题
      const themes = [
        { v: 'blue', label: '<span class="material-icons" style="font-size:14px;vertical-align:middle;color:#3B82F6">circle</span> ' + t('ppt.theme.blue'), desc: t('ppt.theme.blueDesc') },
        { v: 'gray', label: '<span class="material-icons" style="font-size:14px;vertical-align:middle;color:#64748B">square</span> ' + t('ppt.theme.gray'), desc: t('ppt.theme.grayDesc') },
        { v: 'warm', label: '<span class="material-icons" style="font-size:14px;vertical-align:middle;color:#F97316">circle</span> ' + t('ppt.theme.warm'), desc: t('ppt.theme.warmDesc') },
      ];
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = `<div style="background:var(--color-card);color:var(--color-text);border-radius:var(--radius-lg);padding:32px;max-width:420px;width:90vw;box-shadow:var(--shadow-lg)">
        <h3 style="margin:0 0 16px;color:var(--color-primary)">${t('ppt.theme.title')}</h3>
        ${themes.map(t => `<button style="display:block;width:100%;padding:12px 16px;margin-bottom:8px;border:2px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-card);color:var(--color-text);cursor:pointer;text-align:left;font-size:14px" 
          onmouseover="this.style.borderColor='var(--color-accent)'" onmouseout="this.style.borderColor='var(--color-border)'"
          data-theme="${t.v}"><b>${t.label}</b><br><span style="color:var(--color-text-muted);font-size:12px">${t.desc}</span></button>`).join('')}
        <button style="width:100%;padding:8px;margin-top:4px;border:none;background:transparent;color:var(--color-text-muted);cursor:pointer;font-size:13px">${t('app.cancel')}</button>
      </div>`;
      overlay.querySelectorAll('button[data-theme]').forEach(btn => {
        btn.onclick = async () => {
          overlay.remove();
          await this._doExportPptx(content, btn.dataset.theme);
        };
      });
      overlay.querySelector('button:last-child').onclick = () => overlay.remove();
      overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);
    },
    async _doExportPptx(content, theme) {
      try {
        const resp = await fetch('/api/v1/export-pptx', {
          method: 'POST',
          headers: { ...App._authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, theme }),
        });
        if (!resp.ok) { const d = await resp.json(); toast(d.message || 'Export failed', 'error'); return; }
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'PPT大纲.pptx';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('PPTX 已下载 📥', 'success');
      } catch (e) { toast(t('toast.exportFailed') + ': ' + (e.message || t('toast.networkRetry')), 'error'); }
    }
  },

  // 9. 周报生成
  weeklyreport: {
    _type: 'research',
    _style: 'structured',
    _lang: 'zh',

    // placeholder映射：切换报告类型时换提示语
    _placeholders: {
      research: { zh: '在这里粘贴你的科研笔记…\n\n比如：这周精读了CVPR24的EfficientViT，多尺度特征融合那块可以用。实验修复了数据加载bug，CIFAR-100上跑通baseline。写了方法论初稿。问题是稀疏特征收敛太慢，打算试试LayerNorm。下周做消融实验和分析章节。', en: 'Paste your research notes here…\n\ne.g. This week I read EfficientViT (CVPR 2024) — the multi-scale fusion approach could apply to our feature extraction. Fixed the data loading bug, baseline running on CIFAR-100. Drafted the methodology section. Problem: slow convergence on sparse features, planning to try LayerNorm. Next week: ablation study and analysis chapter.' },
      project: { zh: '在这里粘贴你的项目笔记…\n\n比如：V2.1版本本周继续推进。开发：订单模块完成编码测试（100% WBS 3.2.1），用户中心联调80%（WBS 3.2.2）。运维：ITSM 8项全办结，平均3.2h。推广：12家区域上线，3200注册用户。预算：500万总预算，进度65%已支付280万。下周：完成联调（目标100%），启动报表模块（目标30% WBS 3.3.1）。', en: 'Paste your project notes here…\n\ne.g. V2.1 continued this week. Dev: order module coding done (100% WBS 3.2.1), user center integration 80% (WBS 3.2.2). Ops: 8 ITSM tickets all closed, avg 3.2h. Deployment: 12 regions, 3200 users. Budget: 5M total, 65% progress, 2.8M paid. Next: finish integration (100%), start reports module (30% WBS 3.3.1).' },
      techsurvey: { zh: '在这里粘贴你的技术调研笔记…\n\n比如：方向：实时推荐流式计算引擎选型。背景：日均千万级推荐请求，需要选流式引擎。方案A Flink：精确一次语义成熟但运维复杂。方案B Kafka Streams：轻量但无精确一次。PoC：3节点8C16G，500万条压测→Flink 12.3万/s P99 48ms vs Kafka 8.1万/s P99 142ms。倾向Flink，下周出资源预估方案。', en: 'Paste your tech survey notes here…\n\ne.g. Direction: streaming engine for real-time recommendations. Background: 10M+ daily requests. Option A Flink: exactly-once mature, ops heavy. Option B Kafka Streams: lightweight, no exactly-once. PoC: 3-node 8C16G, 5M records → Flink 123K/s P99 48ms vs Kafka 81K/s P99 142ms. Leaning Flink, resource estimate next week.' },
      ops: { zh: '在这里粘贴你的运维记录…\n\n比如：本周可用性99.97%，无P0。核心接口124ms，较上周收窄8.1%。工单34项已闭环31项。故障：订单服务超时，根因DB连接池max_connections=50太低，影响约1200用户18分钟。应急调高至150重启恢复。长期：加监控告警+纳入容量规划。巡检：日志服务器扩容至500G，释放42%空间。', en: 'Paste your ops notes here…\n\ne.g. SLA 99.97%, no P0. Avg latency 124ms, down 8.1% WoW. 34 tickets, 31 closed. Incident: order service timeout, root cause DB pool max_connections=50, ~1200 users affected 18min. Emergency: raised to 150, restarted. Long-term: add monitoring alert, add to capacity checklist. Routine: log server expanded to 500G, 42% space freed.' },
    },

    setType(type, el) {
      this._type = type;
      el.parentElement.querySelectorAll('[data-wrtype]').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
      // 切换placeholder
      const ta = document.getElementById('wr-raw-notes');
      if (ta && this._placeholders[type]) {
        const ph = this._placeholders[type][this._lang] || this._placeholders[type].zh;
        ta.placeholder = ph;
      }
    },

    setStyle(s, el) {
      this._style = s;
      el.parentElement.querySelectorAll('[data-wrstyle]').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
    },

    setLang(l, el) {
      this._lang = l;
      el.parentElement.querySelectorAll('[data-wrlang]').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
      // 更新placeholder语言
      const ta = document.getElementById('wr-raw-notes');
      if (ta && this._placeholders[this._type]) {
        ta.placeholder = this._placeholders[this._type][l] || this._placeholders[this._type].zh;
      }
    },

    async submit() {
      const notes = document.getElementById('wr-raw-notes')?.value?.trim() || '';
      const body = { report_type: this._type, style: this._style, lang: this._lang, raw_notes: notes };
      const resultBox = $('weeklyreport-result');
      resultBox.innerHTML = '<span style="color:var(--color-text-muted);font-style:italic">' + t('loading.thinking') + '</span>';
      resultBox.classList.add('show');
      $('weeklyreport-copy').style.display = 'none';
      $('weeklyreport-export').style.display = 'none';
      let raw = '', first = true;
      try {
        $('weeklyreport-stop').style.display = 'inline-flex';
        await App.apiCallStream('/weekly-report', body,
          (token) => {
            if (first) { resultBox.innerHTML = ''; first = false; }
            raw += token; resultBox.innerHTML = App._renderMd(raw);
          },
          (usage, extra) => {
            this._lastRaw = raw;
            resultBox.innerHTML = App._renderMd(raw);
            $('weeklyreport-copy').style.display = 'inline-flex';
            $('weeklyreport-export').style.display = 'inline-flex';
            const todoBtn = $('weeklyreport-result-todo');
            if (todoBtn) todoBtn.style.display = 'inline-flex';
            if (usage) App.addTokens(usage.prompt_tokens, usage.completion_tokens);
            const typeName = { research: '科研周报', project: '项目周报', techsurvey: '技术调研', ops: '运维周报' };
            App.saveHistory('weekly-report', typeName[this._type] || '周报', raw,
              (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0), extra?.record_id, extra?.kb_chunks);
            toast(t('mod.weeklyreport.success'), 'success');
          }
        );
      } catch (e) {}
    }
  }
};

// ---- 启动 ----
document.addEventListener('DOMContentLoaded', () => App.init());

// 回车提交（所有视图）
document.getElementById('login-password').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') App.login();
});
document.getElementById('login-username').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') App.login();
});
document.getElementById('reg-password').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') App.register();
});
document.getElementById('reg-confirm-pw').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') App.register();
});
document.getElementById('forgot-input1').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') App.login();
});
document.getElementById('forgot-input2').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') App.login();
});

// 注册密码一致性实时校验
document.getElementById('reg-confirm-pw').addEventListener('input', function() {
  const pw = document.getElementById('reg-password').value;
  const confirm = this.value;
  const hint = document.getElementById('reg-pw-hint');
  if (!confirm) { hint.textContent = ''; return; }
  if (pw !== confirm) {
    hint.textContent = t('login.pwMismatch');
    hint.style.color = '#EF4444';
  } else {
    hint.textContent = '✓';
    hint.style.color = '#10B981';
  }
});
document.getElementById('reg-password').addEventListener('input', function() {
  const confirm = document.getElementById('reg-confirm-pw');
  if (confirm.value) confirm.dispatchEvent(new Event('input'));
});

/* ============================================================
   自由对话 (ChatApp)
   ============================================================ */
const ChatApp = {
  _currentConvId: null,
  _conversations: [],
  _messages: [],
  _streaming: false,
  _abortController: null,
  _loading: false,
  _deepThink: false,
  _persona: 'standard',
  _editingMsgIdx: null,  // 当前正在编辑的消息索引，非 null 表示编辑模式
  _attachments: [],      // 待发送附件 [{file, id, filename, file_type, preview, url}]
  _getPlaceholders() {
    return [
      t('chat.placeholder1'),
      t('chat.placeholder2'),
      t('chat.placeholder3'),
      t('chat.placeholder4'),
      t('chat.placeholder5')
    ];
  },
  _kbEnabled: true,       // 当前对话的知识库开关状态

  // ---- KB 辅助：按对话独立存储，支持多选 ----
  _kbActiveKey() { return 'grindpal_active_kb_' + (this._currentConvId || 'global'); },
  _kbEnabledKey() { return 'grindpal_kb_enabled_' + (this._currentConvId || 'global'); },
  /** 返回逗号分隔的 ID 字符串，用于 X-Kb-Collection 头。优先当前对话，回退全局 */
  _getKbId() {
    const perConv = localStorage.getItem(this._kbActiveKey()) || '';
    if (perConv) return perConv;
    return localStorage.getItem('grindpal_active_kb') || '';
  },
  /** 返回已激活的 KB ID 数组 */
  _getKbIds() {
    const s = this._getKbId();
    if (!s) return [];
    return s.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
  },
  /** 返回 KB 显示名：单个显示名称，多个显示 "名称 +N"，无则 "未选择" */
  _getKbDisplayName() {
    const ids = this._getKbIds();
    if (!ids.length) return t('chat.kbNone');
    const colls = App._kbCollections || [];
    const names = ids.map(id => {
      const c = colls.find(col => col.id === id);
      return c ? c.name : null;
    }).filter(Boolean);
    if (!names.length) return t('chat.kbNone');
    if (names.length === 1) return names[0];
    return names[0] + ' +' + (names.length - 1);
  },

  // ---- 初始化 ----
  async init() {
    // 恢复深度思考偏好
    this._deepThink = localStorage.getItem('grindpal_deep_think') === '1';
    const dtCheckbox = $('chat-deep-think');
    if (dtCheckbox) dtCheckbox.checked = this._deepThink;
    // 恢复人设偏好
    this._persona = localStorage.getItem('grindpal_persona') || 'standard';
    const personaSel = $('chat-persona-select');
    if (personaSel) personaSel.value = this._persona;
    // 恢复模型偏好（默认 v4-flash）
    const modelSel = $('chat-model-select');
    const savedModel = localStorage.getItem('grindpal_chat_model') || 'deepseek-v4-flash';
    if (modelSel) modelSel.value = savedModel;
    this._initAttachments();
    await this.loadConversations();
    // 默认显示欢迎界面，不自动选中对话
    if (this._conversations.length === 0) {
      $('chat-messages').innerHTML = this._emptyHintHtml();
    }
    this._updateSendBtn();
    this._rotatePlaceholder();
  },

  _rotatePlaceholder() {
    let i = 0;
    setInterval(() => {
      const ta = $('chat-input');
      if (ta && document.activeElement !== ta) {
        ta.placeholder = this._getPlaceholders()[i % this._getPlaceholders().length];
        i++;
      }
    }, 4000);
  },

  // ---- 附件功能 ----
  _initAttachments() {
    // 创建隐藏文件选择器
    let fi = $('chat-file-input');
    if (!fi) {
      fi = document.createElement('input');
      fi.type = 'file';
      fi.id = 'chat-file-input';
      fi.multiple = true;
      fi.accept = 'image/*,.txt,.md,.docx,.pdf,.xlsx,.xls,.pptx,.ppt,.csv,.json,.xml,.log,.py,.js,.ts,.html,.css,.sql,.sh,.lua,.cpp,.c,.h,.java,.go,.rs,.rb,.php,.swift,.kt,.vue,.toml,.yaml,.yml,.ini,.cfg,.env,.bat,.ps1';
      fi.style.display = 'none';
      fi.onchange = () => this._onFilesSelected(fi.files);
      document.body.appendChild(fi);
    }
    // 拖拽支持
    const chatMain = document.querySelector('#chat-main');
    if (chatMain) {
      chatMain.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
      chatMain.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer.files.length) this._onFilesSelected(e.dataTransfer.files);
      });
    }
    // 粘贴图片
    const ta = $('chat-input');
    if (ta) {
      ta.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
        if (files.length) {
          e.preventDefault();
          this._onFilesSelected(files);
        }
      });
    }
  },

  _onFilesSelected(files) {
    for (const f of files) {
      if (this._attachments.length >= 10) { toast(t('toast.maxAttachments'), 'warning'); break; }
      this._attachments.push({ file: f, id: null, filename: f.name, file_type: f.type.startsWith('image/') ? 'image' : 'document', preview: '', url: null });
    }
    this._renderAttachments();
    this._uploadAttachments();
  },

  _renderAttachments() {
    const bar = $('chat-attachments-bar');
    if (!bar) return;
    bar.style.display = this._attachments.length ? 'flex' : 'none';
    // 统计上传中数量
    const pending = this._attachments.filter(a => !a.id && !a._error).length;
    const done = this._attachments.filter(a => a.id).length;
    bar.innerHTML = this._attachments.map((a, i) => {
      let statusHtml;
      if (a.id) {
        statusHtml = '<span class="material-icons" style="font-size:11px;color:var(--color-accent);vertical-align:middle">check_circle</span>';
      } else if (a._error) {
        statusHtml = '<span class="material-icons" style="font-size:11px;color:var(--color-error);vertical-align:middle">error</span>';
      } else {
        statusHtml = '<span class="att-uploading">上传中…</span>';
      }
      const name = a.filename.length > 20 ? a.filename.substring(0, 18) + '…' : a.filename;
      return `<div class="att-chip" title="${a.filename}">
        <span class="att-chip-icon"><span class="material-icons" style="font-size:14px">${a.file_type === 'image' ? 'image' : 'description'}</span></span>
        <span class="att-chip-name">${statusHtml} ${name}</span>
        <button class="att-chip-remove" onclick="ChatApp._removeAttachment(${i})">×</button>
      </div>`;
    }).join('');
    // 追加进度文字
    if (pending > 0) {
      bar.innerHTML += `<span style="font-size:11px;color:var(--color-accent);white-space:nowrap;padding:2px 6px">${done}/${done + pending} 已上传</span>`;
    }
  },

  async _uploadAttachments() {
    if (!this._currentConvId) return;  // 等对话创建后再上传
    const pending = this._attachments.filter(a => !a.id && !a._error && !a._fromHistory);
    if (pending.length === 0) return;
    for (let i = 0; i < this._attachments.length; i++) {
      const a = this._attachments[i];
      if (a.id || a._error) continue;
      if (a._fromHistory) continue;   // 历史附件无需重新上传
      this._renderAttachments();  // 显示当前文件的上传中状态
      try {
        const formData = new FormData();
        formData.append('file', a.file);
        const headers = App._authHeaders();
        delete headers['Content-Type'];  // FormData，浏览器自动设置
        const resp = await fetch(`${API_BASE}/chat/conversations/${this._currentConvId}/attachments`, {
          method: 'POST',
          headers: headers,
          body: formData,
        });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        if (data.code === 200) {
          a.id = data.data.id;
          a.preview = data.data.preview || '';
          a.url = data.data.url || '';
        } else {
          a._error = true;
        }
      } catch (e) { a._error = true; }
      this._renderAttachments();
    }
  },

  _removeAttachment(idx) {
    this._attachments.splice(idx, 1);
    this._renderAttachments();
  },

  _clearAttachments() {
    this._attachments = [];
    this._renderAttachments();
  },

  // ---- 上下文用量 ----
  async updateContextUsage() {
    // 已移除上下文显示
    return;
    if (!this._currentConvId) return;
    try {
      const resp = await fetch(`${API_BASE}/chat/conversations/${this._currentConvId}/context-usage`, {
        headers: App._authHeaders()
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.code !== 200) return;
      const { estimated_tokens, model_max, usage_percent, message_count } = data.data;
      const bar = $('chat-ctx-bar');
      if (!bar) return;
      bar.style.display = '';
      const pct = usage_percent;
      let color = '#10B981';  // green
      if (pct > 85) color = '#F59E0B';  // orange
      if (pct > 95) color = '#EF4444';  // red
      // 进度条样式：▰▰▰▱▱▱
      const blocks = 10;
      const filled = Math.round(pct / 100 * blocks);
      const barStr = '▰'.repeat(filled) + '▱'.repeat(blocks - filled);
      bar.innerHTML = `<span style="color:${color}">${barStr}</span> ${Math.round(estimated_tokens/1000)}K/${Math.round(model_max/1000)}K`;
      bar.title = `${estimated_tokens} tokens · ${message_count} 条消息 · ${pct}%`;
      // 超过 90% 自动提示压缩
      if (pct > 90 && message_count > 10) {
        bar.style.cursor = 'pointer';
        bar.title += ' · ' + t('chat.contextLimitHint');
        bar.onclick = () => this.compressContext();
      }
    } catch(e) {}
  },

  async compressContext() {
    App._showConfirm(t('chat.contextLimit'), async () => {
      await this.newConversation();
      toast(t('toast.newConvCreated'), 'info');
    });
  },

  // ---- 全文搜索 ----
  async openSearch() {
    const input = $('chat-search-input');
    const q = (input ? input.value : '').trim();
    if (!q || q.trim().length < 2) {
      if (input) { input.focus(); input.placeholder = t('search.placeholder'); }
      toast(t('toast.searchHint'), 'info');
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/chat/search?q=${encodeURIComponent(q.trim())}`, {
        headers: App._authHeaders()
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.code !== 200 || !data.data.results.length) {
        toast(t('toast.searchNoResults'), 'info');
        return;
      }
      // 展示搜索结果
      const results = data.data.results;
      let html = '<div style="max-height:400px;overflow-y:auto">';
      html += `<h4 style="margin:0 0 12px"><span class="material-icons" style="font-size:18px;vertical-align:middle">search</span> ` + t('search.resultsCount').replace('{q}', App._escapeHtml(q)).replace('{n}', results.length) + `</h4>`;
      for (const r of results) {
        const snippet = (r.snippet || '').replace(/<<</g, '<b style="color:var(--color-accent)">').replace(/>>>/g, '</b>');
        html += `<div style="padding:8px 12px;margin:4px 0;background:var(--color-card);border-radius:8px;cursor:pointer" onclick="ChatApp.switchConversation(${r.conversation_id})">
          <div style="font-size:11px;color:var(--color-text-muted)"><span class="material-icons" style="font-size:13px;vertical-align:middle">description</span> ${App._escapeHtml(r.conversation_title || '')} · <span class="material-icons" style="font-size:13px;vertical-align:middle">${r.role === 'user' ? 'person' : 'smart_toy'}</span></div>
          <div style="font-size:13px;margin-top:4px">${snippet}</div>
        </div>`;
      }
      html += '</div>';
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = `<div style="background:var(--color-bg);border-radius:16px;padding:20px;max-width:600px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3)">${html}<button style="margin-top:12px;width:100%;padding:8px" class="btn btn-secondary" onclick="this.closest('div').parentElement.remove()">` + t('search.close') + `</button></div>`;
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);
    } catch(e) {
      toast(t('toast.searchFailed'), 'error');
    }
  },

  // ---- 加载对话列表 ----
  async loadConversations() {
    try {
      const resp = await fetch(`${API_BASE}/chat/conversations`, {
        headers: App._authHeaders()
      });
      if (resp.status !== 200) return;
      const data = await resp.json();
      if (data.code === 200) {
        this._conversations = data.data.conversations || [];
        this.renderConversations();
      }
    } catch (e) {}
  },

  renderConversations(filter = '') {
    const list = $('chat-conv-list');
    if (!list) return;
    let convs = this._conversations;
    if (filter) {
      const q = filter.toLowerCase();
      convs = convs.filter(c => {
        const title = (c.title || t('chat.new')).toLowerCase();
        const first = (c.first_message || '').toLowerCase();
        const last = (c.last_message || '').toLowerCase();
        return title.includes(q) || first.includes(q) || last.includes(q);
      });
    }
    if (convs.length === 0) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--color-text-muted);font-size:13px">${filter ? t('chat.noMatch') : t('chat.noConvs')}</div>`;
      return;
    }
    list.innerHTML = convs.map(c => {
      const title = c.title || t('chat.new');
      const firstMsg = c.first_message || '';
      const lastMsg = c.last_message || firstMsg || '';
      const displayTitle = title !== t('chat.new') ? title :
        (firstMsg ? firstMsg.substring(0, 20) + (firstMsg.length > 20 ? '…' : '') : t('chat.new'));
      const preview = lastMsg ? lastMsg.substring(0, 30) + (lastMsg.length > 30 ? '…' : '') : '';
      const time = c.updated_at ? c.updated_at.substring(11, 16) : '';
      return `<div class="chat-conv-item${c.id === this._currentConvId ? ' active' : ''}" onclick="ChatApp.switchConversation(${c.id})" data-id="${c.id}">
        <div class="conv-title-row">
          <span class="conv-title" ondblclick="event.stopPropagation();ChatApp.renameConversation(${c.id},this)" title="${App._escapeAttr(t('chat.renameHint')||'双击重命名')}">${App._escapeHtml(displayTitle)}</span>
          <span class="conv-time">${time}</span>
          <button class="conv-delete-btn material-icons" onclick="event.stopPropagation();ChatApp.deleteConversation(${c.id})" title="${t('chat.deleteMsg')}">close</button>
          <button class="conv-export-btn material-icons" onclick="event.stopPropagation();ChatApp.exportConversation(${c.id})" title="${t('app.exportWord')}">download</button>
        </div>
        ${preview ? `<span class="conv-preview">${App._escapeHtml(preview)}</span>` : ''}
      </div>`;
    }).join('');
  },

  // ---- 对话操作 ----
  filterConversations() {
    const input = $('chat-search-input');
    this.renderConversations(input ? input.value : '');
  },

  async newConversation() {
    try {
      const resp = await fetch(`${API_BASE}/chat/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...App._authHeaders() },
        body: JSON.stringify({ title: '新对话' })
      });
      const data = await resp.json();
      if (data.code === 200) {
        this._conversations.unshift(data.data);
        this.renderConversations();
        await this.switchConversation(data.data.id);
      }
    } catch (e) {}
  },

  async switchConversation(convId) {
    if (this._streaming) this.stopGeneration();
    this._currentConvId = convId;
    this._editingMsgIdx = null;  // 清除编辑状态
    // 清除跨对话 pending 状态，防止污染新对话
    this._regenerateMode = false;
    this._regenerateMsgId = null;
    this._pendingGenerations = null;
    this._pendingEditedGen = null;
    this._regenerateBackup = null;
    this._branchTruncateId = null;
    this._retryAttachmentIds = [];
    const inputBox = $('chat-input-box');
    if (inputBox) inputBox.classList.remove('editing');
    this.renderConversations();
    // 移动端自动关闭侧栏
    const sidebar = $('chat-sidebar');
    if (sidebar && sidebar.classList.contains('open')) this.toggleSidebar();
    // 恢复该对话的知识库开关状态（默认开启）
    const savedEnabled = localStorage.getItem(this._kbEnabledKey());
    this._kbEnabled = savedEnabled !== null ? (savedEnabled === '1') : true;
    this._updateKbToggle();
    // 清空消息区并显示加载
    const container = $('chat-messages');
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--color-text-muted);font-size:13px">' + t('todos.loading') + '</div>';
    await this.loadMessages(convId);
  },

  async loadMessages(convId) {
    this._messages = [];
    try {
      const resp = await fetch(`${API_BASE}/chat/conversations/${convId}/messages`, {
        headers: App._authHeaders()
      });
      if (resp.status !== 200) {
        $('chat-messages').innerHTML = this._emptyHintHtml();
        return;
      }
      const data = await resp.json();
      if (data.code === 200) {
        this._messages = data.data.messages || [];
        // 编辑中断恢复：消息为空但有未完成的编辑备份
        if (this._messages.length === 0) {
          try {
            const backup = JSON.parse(sessionStorage.getItem('grindpal_edit_backup') || 'null');
            if (backup && backup.convId === convId && Date.now() - backup.timestamp < 300000) {
              this._messages = [{ role: 'user', content: backup.content, _recovered: true }];
              sessionStorage.removeItem('grindpal_edit_backup');
            }
          } catch(e) {}
        }
        // 恢复 localStorage 中服务端已删除但分支数据仍存在的孤儿消息
        this._recoverOrphanedGenerations(convId);
        // 解析 kb_chunks JSON 字符串，每消息独立存储
        for (const m of this._messages) {
          if (m.kb_chunks && typeof m.kb_chunks === 'string') {
            try { m.kb_chunks = JSON.parse(m.kb_chunks); } catch (e) { m.kb_chunks = null; }
          }
          // 后端已做引用过滤，前端不再重复交叉验证
          // （数组索引与 chunk_index 不一致会导致误删）
          // 后端返回的 attachments 嵌套在消息中——确保是数组，补上 url
          if (m.attachments && Array.isArray(m.attachments)) {
            m.attachments = m.attachments.map(a => {
              if (!a.url && a.file_path) a.url = '/uploads/chat/' + a.file_path.split('/uploads/chat/').pop();
              return a;
            });
          }
        }
        this._restoreGenerations();
        // 恢复后同步：若某条用户消息正查看已保存版本（非 live），把分支内容应用到 _messages
        GP.log("loadMessages", "reconcile_start"); this._reconcileGenerations();
        this.renderMessages();
        this.updateContextUsage();
        // 延迟渲染历史消息中的知识库引用指示器（从 data 属性读取，不依赖索引）
        setTimeout(() => {
          const msgs = $('chat-messages');
          if (!msgs) return;
          const items = msgs.querySelectorAll('.chat-msg[data-kb-chunks]');
          items.forEach((el) => {
            try {
              const kbChunks = JSON.parse(el.dataset.kbChunks);
              const bubble = el.querySelector('.bubble');
              if (bubble && kbChunks && kbChunks.length) {
                bubble.dataset.kbChunks = el.dataset.kbChunks;
              }
            } catch (e) {}
          });
        }, 150);
      } else {
        $('chat-messages').innerHTML = this._emptyHintHtml();
      }
    } catch (e) {
      $('chat-messages').innerHTML = this._emptyHintHtml();
    }
  },

  async deleteConversation(convId) {
    App._showConfirm(t('chat.deleteConfirm') || '确定删除此对话？', async () => {
    try {
      const resp = await fetch(`${API_BASE}/chat/conversations/${convId}`, {
        method: 'DELETE',
        headers: App._authHeaders()
      });
      const data = await resp.json();
      if (data.code === 200) {
        this._conversations = this._conversations.filter(c => c.id !== convId);
        if (this._currentConvId === convId) {
          this._currentConvId = null;
          this._messages = [];
          $('chat-messages').innerHTML = this._emptyHintHtml();
        }
        this.renderConversations();
      }
    } catch (e) {}
    });
  },

  // ---- 移动端侧栏切换 ----
  toggleSidebar() {
    const sidebar = $('chat-sidebar');
    const backdrop = $('chat-sidebar-backdrop');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('open');
    if (backdrop) backdrop.classList.toggle('show', isOpen);
  },

  // ---- 重命名 ----
  async renameConversation(convId, titleEl) {
    const currentTitle = titleEl.textContent.trim();
    // Replace title with inline input for editing
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.style.cssText = 'width:100%;padding:4px 8px;border:1px solid var(--color-accent);border-radius:6px;font-size:13px;outline:none;background:var(--color-card);color:var(--color-text)';
    const parent = titleEl.parentNode;
    titleEl.style.display = 'none';
    parent.insertBefore(input, titleEl.nextSibling);
    input.focus();
    input.select();

    const finish = async (newTitle) => {
      input.remove();
      titleEl.style.display = '';
      newTitle = (newTitle || '').trim();
      if (!newTitle || newTitle === currentTitle) return;
      try {
        const resp = await fetch(`${API_BASE}/chat/conversations/${convId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...App._authHeaders() },
          body: JSON.stringify({ title: newTitle })
        });
        const data = await resp.json();
        if (data.code === 200) {
          await this.loadConversations();
        }
      } catch (e) {}
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    input.addEventListener('blur', () => finish(input.value));
  },

  // ---- 导出 ----
  async exportConversation(convId) {
    const doExport = async (format) => {
      try {
        const resp = await fetch(`${API_BASE}/chat/conversations/${convId}/export?format=${format}`, {
          headers: App._authHeaders()
        });
        if (!resp.ok) { toast(t('toast.exportFailed'), 'error'); return; }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation_${convId}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch(e) { toast(t('toast.exportFailed'), 'error'); }
    };
    App._showConfirm('导出对话为 Markdown (.md) 格式？',
      () => doExport('md'),
      null  // 取消 = 不导出
    );
  },

  // ---- 消息渲染 ----
  renderMessages(skipScroll = false) {
    const container = $('chat-messages');
    if (this._messages.length === 0) {
      container.innerHTML = this._emptyHintHtml();
      return;
    }
    container.innerHTML = this._messages.map((m, i) => this._renderMessageHtml(m, i)).join('');
    if (!skipScroll) this.scrollToBottom(true);
  },

  _emptyHintHtml() {
    return '<div id="chat-empty-hint"><div class="empty-icon"><span class="material-icons">chat</span></div><h3 data-i18n="chat.welcomeTitle">今天想聊点什么？</h3><p data-i18n="chat.welcomeDesc">我是你的AI助手，可以回答问题、写作、编程、翻译、分析文件等</p><div class="quick-actions"><span class="quick-action-chip" onclick="ChatApp.quickActionByKey(\'writeReport\')"><span class="material-icons" style="font-size:14px;vertical-align:middle">edit_note</span> <span data-i18n="chat.quickWriteReport">写周报</span></span><span class="quick-action-chip" onclick="ChatApp.quickActionByKey(\'summarize\')"><span class="material-icons" style="font-size:14px;vertical-align:middle">summarize</span> <span data-i18n="chat.quickSummarize">总结文本</span></span><span class="quick-action-chip" onclick="ChatApp.quickActionByKey(\'translate\')"><span class="material-icons" style="font-size:14px;vertical-align:middle">translate</span> <span data-i18n="chat.quickTranslate">翻译中文</span></span><span class="quick-action-chip" onclick="ChatApp.quickActionByKey(\'polish\')"><span class="material-icons" style="font-size:14px;vertical-align:middle">auto_fix_high</span> <span data-i18n="chat.quickPolish">润色文字</span></span></div></div>';
  },

  quickAction(text) {
    const ta = $('chat-input');
    ta.value = text;
    this.autoResize();
    this._updateSendBtn();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  },

  quickActionByKey(actionKey) {
    const promptKey = 'chat.quick' + actionKey.charAt(0).toUpperCase() + actionKey.slice(1) + 'Prompt';
    this.quickAction(t(promptKey));
  },

  toggleDeepThink(enabled) {
    this._deepThink = enabled;
    localStorage.setItem('grindpal_deep_think', enabled ? '1' : '0');
  },

  switchModel(model) {
    // 为聊天单独保存模型偏好
    localStorage.setItem('grindpal_chat_model', model);
  },

  switchPersona(persona) {
    this._persona = persona || 'standard';
    localStorage.setItem('grindpal_persona', this._persona);
    const names = { 'standard': t('chat.persona.standard'), 'genius_girl': t('chat.persona.genius'), 'expert': t('chat.persona.expert') };
    toast(t('chat.personaSwitched') + (names[persona] || persona), 'success');
  },

  // ---- 知识库开关 ----
  toggleKB(enabled) {
    this._kbEnabled = enabled;
    localStorage.setItem(this._kbEnabledKey(), enabled ? '1' : '0');
    this._updateKbToggle();
  },

  _updateKbToggle() {
    const toggle = $('chat-kb-toggle');
    const checkbox = $('chat-kb-checkbox');
    const label = $('chat-kb-label');
    if (!toggle || !checkbox || !label) return;
    // 开关始终可用，独立于知识库选择
    checkbox.disabled = false;
    checkbox.checked = this._kbEnabled;
    if (this._kbEnabled) {
      label.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:2px">menu_book</span> ' + t('chat.kbOn');
      label.style.color = 'var(--color-accent)';
      label.style.fontWeight = '600';
    } else {
      label.innerHTML = '<span class="material-icons" style="font-size:14px;vertical-align:middle;margin-right:2px">menu_book</span> ' + t('chat.kbOff');
      label.style.color = 'var(--color-text-muted)';
      label.style.fontWeight = 'normal';
    }
    // 如果有关联的知识库，追加名称
    const kbId = this._getKbId();
    if (kbId) {
      const displayName = this._getKbDisplayName();
      if (displayName !== t('chat.kbNone')) {
        label.innerHTML += ' <span style="font-size:10px;opacity:0.7">(' + displayName + ')</span>';
      }
    }
  },

  _renderMessageHtml(msg, idx) {
    const role = msg.role;
    const content = msg.content || '';
    const isUser = role === 'user';
    const thinking = msg.thinking || '';
    const stopped = msg.stopped || false;
    let bubbleContent = '';
    if (!isUser && thinking) {
      bubbleContent += '<details class="thinking-box"><summary>思考过程</summary><div class="think-content">' + App._renderMd(thinking) + '</div></details>';
    }
    bubbleContent += isUser ? App._escapeHtml(content) : App._renderMd(content);
    // 用户消息附件预览（图片 inline，文件 chip）
    if (isUser && msg.attachments && msg.attachments.length) {
      bubbleContent += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">';
      for (const att of msg.attachments) {
        if (att.file_type === 'image' && att.url) {
          bubbleContent += `<img src="${att.url}" alt="${App._escapeAttr(att.filename)}" style="max-width:180px;max-height:120px;border-radius:8px;object-fit:cover;border:1px solid rgba(0,0,0,0.08)" title="${App._escapeAttr(att.filename)}">`;
        } else {
          const icon = att.file_type === 'image' ? 'image' : 'description';
          bubbleContent += `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(0,0,0,0.05);border-radius:6px;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="material-icons" style="font-size:14px;flex-shrink:0">${icon}</span>${App._escapeHtml(att.filename)}</span>`;
        }
      }
      bubbleContent += '</div>';
    }
    // 脱敏标记：检测消息中是否包含脱敏占位符
    const maskedTag = /\[(?:手机号|身份证号|银行卡号|邮箱)已隐藏\]/.test(content)
      ? '<span class="masked-tag" title="已自动脱敏敏感信息"><span class="material-icons" style="font-size:13px;vertical-align:middle">lock</span>已脱敏</span>' : '';
    if (stopped) {
      bubbleContent += '<div class="chat-stop-marker"><span><span class="material-icons" style="font-size:14px;vertical-align:middle">pause_circle</span> 已停止</span><button onclick="ChatApp.continueGeneration()">继续生成</button></div>';
    }
    const editBtn = isUser ? `<button class="edit-btn" onclick="ChatApp.editMessage(${idx})" title="${t('chat.editMsg') || '编辑'}"><span class="material-icons" style="font-size:14px">edit</span></button>` : '';
    // 生成版本翻页控件（AI 回复和用户消息均支持）
    let genPager = '';
    if (msg._generations && msg._generations.length > 0) {
      const total = msg._generations.length + 1; // saved + live
      const current = (msg._genIndex != null ? msg._genIndex : msg._generations.length) + 1;
      const pagerColor = isUser ? 'rgba(255,255,255,0.85)' : 'var(--color-text-secondary)';
      if (total > 1) {
        genPager = `<div class="gen-pager" style="display:flex;align-items:center;gap:4px;font-size:11px;color:${pagerColor};margin-right:auto">
        <button onclick="ChatApp.switchGeneration(${idx},-1)" style="background:none;border:none;cursor:pointer;color:${pagerColor};padding:2px 4px;font-size:14px" ${current <= 1 ? 'disabled' : ''}>◀</button>
        <span>${current}/${total}</span>
        <button onclick="ChatApp.switchGeneration(${idx},1)" style="background:none;border:none;cursor:pointer;color:${pagerColor};padding:2px 4px;font-size:14px" ${current >= total ? 'disabled' : ''}>▶</button>
      </div>`;
      }
    }
    // KB 指示条（仅 AI 消息且有知识库引用时）
    let kbIndicatorHtml = '';
    if (!isUser && msg.kb_chunks && msg.kb_chunks.length) {
      // 从 chunks 自身提取文件名作为展示名，不依赖可能为 null 的 msg.kb_names
      let kbName = msg.kb_names;
      if (!kbName || kbName === t('chat.kbNone')) {
        const uniqueFiles = [...new Set(msg.kb_chunks.map(c => c.filename || '').filter(Boolean))];
        kbName = uniqueFiles.length > 0
          ? (uniqueFiles.length <= 2 ? uniqueFiles.join(' + ') : uniqueFiles[0] + ' 等' + uniqueFiles.length + '个文件')
          : (ChatApp._getKbDisplayName() || t('chat.kb')).replace(t('chat.kbNone'), t('chat.kb'));
      }
      const answerText = (content || '').replace(/【参考[^】]*】|📎\d+·[^\s]+/g, '');
      const panelItems = msg.kb_chunks.map(function(c, i) {
        const highlighted = App._highlightOverlap(c.content || '', answerText);
        return '<div class="kb-ind-item"><div class="kb-ind-filename"><span class="material-icons" style="font-size:13px;vertical-align:middle">attach_file</span> 参考 '+(i+1)+' · '+App._escapeHtml(c.filename)+'</div><div class="kb-ind-content">'+highlighted+'</div></div>';
      }).join('');
      kbIndicatorHtml = '<div class="kb-indicator"><span class="material-icons kb-ind-icon">menu_book</span><span class="kb-ind-label">参考 <b>'+App._escapeHtml(kbName)+'</b> · '+msg.kb_chunks.length+' 个片段</span><span class="material-icons kb-ind-arrow">expand_more</span></div><div class="kb-ind-panel">'+panelItems+'</div>';
    }

    return `<div class="chat-msg ${role}" data-msg-idx="${idx}"${!isUser && msg.kb_chunks && msg.kb_chunks.length ? ' data-kb-chunks="' + App._escapeAttr(JSON.stringify(msg.kb_chunks)) + '"' : ''}>
      <div class="bubble">${bubbleContent}${maskedTag}${kbIndicatorHtml}
        <div class="chat-msg-actions">${genPager}
          <button onclick="ChatApp.copyMessage(this)" data-content="${App._escapeAttr(content.replace(/【参考[^】]*】/g, ''))}" title="${t('chat.copyMsg')}"><span class="material-icons" style="font-size:14px">content_copy</span></button>
          ${isUser ? editBtn : `<button onclick="ChatApp.regenerate(${idx})" title="${t('chat.regenerate')}"><span class="material-icons" style="font-size:14px">refresh</span></button>`}
          <button onclick="ChatApp.deleteMessage(${idx})" title="${t('chat.deleteMsg') || '删除'}"><span class="material-icons" style="font-size:14px">delete_outline</span></button>
        </div>
      </div>
    </div>`;
  },

  scrollToBottom(force = false) {
    const container = $('chat-messages');
    if (!container) return;
    // 如果用户手动向上滚动超过 80px，暂停自动跟随
    if (!force) {
      const distToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distToBottom > 80) return;
    }
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  },

  // ---- 输入框操作 ----
  autoResize() {
    const ta = $('chat-input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    this._updateSendBtn();
  },

  _updateSendBtn() {
    const btn = $('chat-send-btn');
    const ta = $('chat-input');
    if (!btn) return;
    if (this._streaming) {
      btn.disabled = false;
      btn.classList.add('streaming');
      btn.querySelector('.material-icons').textContent = 'stop';
    } else {
      btn.classList.remove('streaming');
      btn.querySelector('.material-icons').textContent = 'arrow_upward';
      if (btn && ta) {
        btn.disabled = !ta.value.trim();
      }
    }
  },

  sendOrStop() {
    if (this._streaming) {
      this.stopGeneration();
    } else {
      this.send();
    }
  },

  onKeyDown(e) {
    // Enter 发送（不含 Shift），Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!this._streaming) {
        this.send();
        // 确保输入框清空后高度复位
        const ta = e.target || $('chat-input');
        if (ta) { ta.style.height = 'auto'; }
      }
    }
  },

  // ---- 发送消息 ----
  async send() {
    GP.log('send', 'start', { streaming: this._streaming, editing: this._editingMsgIdx, branchTruncate: this._branchTruncateId, msgCount: this._messages.length });
    const ta = $('chat-input');
    const content = ta.value.trim();
    if (!content || this._streaming) return;
    this._streaming = true;  // 提前加锁，防止 async 间隙重入

    // 编辑模式：截断编辑点之后的所有消息，在原对话中继续
    let editedIdx = null;
    if (this._editingMsgIdx !== null) {
      const cutIdx = this._editingMsgIdx;
      editedIdx = cutIdx;
      this._editingMsgIdx = null;
      const inputBox = $('chat-input-box');
      if (inputBox) inputBox.classList.remove('editing');
      // 服务端截断前先备份，防止刷新丢失
      try { sessionStorage.setItem('grindpal_edit_backup', JSON.stringify({ convId: this._currentConvId, cutIdx, content: this._messages[cutIdx]?.content || '', timestamp: Date.now() })); } catch(e) {}
      const editMsgId = this._messages[cutIdx]?.id;
      if (!editMsgId) {
        GP.log('send', 'edit_abort_no_id');
        toast(t('toast.msgNoId'), 'error');
        this._editingMsgIdx = cutIdx;  // 恢复编辑状态
        this._streaming = false;
        return;
      }
      try {
        await this._truncateServer(editMsgId);
      } catch (e) {
        console.error('truncateServer failed:', e);
        toast(t('chat.truncateFail') || '服务端截断失败，请刷新页面后重试', 'error');
        this._editingMsgIdx = cutIdx;  // 恢复编辑状态
        this._streaming = false;
        return;  // 中止发送
      }
      // 保存旧分支：用户消息及其后所有消息 → _generations
      const oldMsg = this._messages[cutIdx];
      if (oldMsg && oldMsg.role === 'user') {
        const branch = JSON.parse(JSON.stringify(this._messages.slice(cutIdx)));
        if (!oldMsg._generations) oldMsg._generations = [];
        branch[0]._genIndex = oldMsg._generations.length; // 该分支在 _generations 中的位置
        const parentMsg = cutIdx > 0 ? this._messages[cutIdx - 1] : null;
        oldMsg._generations.push({
          content: oldMsg.content,
          attachments: oldMsg.attachments,
          branch: branch,
          parentId: parentMsg ? parentMsg.id : null  // 用于恢复时定位公共祖先
        });
        oldMsg._genIndex = oldMsg._generations.length; // 指向 live 槽位
        oldMsg._currentBackup = null;                  // 当前内容即 live
        // 版本历史稍后在 done 事件中按新 ID 持久化（此处旧 ID 即将被删，无需保存）
        // 暂存，注入到新用户消息以立即显示翻页
        this._pendingEditedGen = { generations: oldMsg._generations.slice(), genIndex: oldMsg._genIndex }; GP.log("send", "edit_branch_saved", {genCount: oldMsg._generations.length, genIndex: oldMsg._genIndex});
      }
      // 本地截断：收集将被删除的消息 ID，用于清理 localStorage 版本历史
      const removedIds = this._messages.slice(cutIdx).map(m => m.id).filter(Boolean);
      this._messages.splice(cutIdx);
      for (const rid of removedIds) {
        try { localStorage.removeItem(this._genKey(rid)); } catch (e) {}
      }
      this.renderMessages();
    }

    // G-1 修复：分支切换后发消息前先同步服务端（截断到公共祖先之后）
    if (!this._editingMsgIdx && this._branchTruncateId) {
      try {
        await this._truncateServer(this._branchTruncateId, true); GP.log("send", "branch_truncate", {ancestorId: this._branchTruncateId});
      } catch (e) {
        console.error('branch truncate failed:', e);
      }
      this._branchTruncateId = null;
    }

    // 自动创建对话
    if (!this._currentConvId) {
      await this.newConversation();
      if (!this._currentConvId) { this._streaming = false; return; }
      // 如果有未上传的附件，现在上传（需要 conversation_id）
      await this._uploadAttachments();
    }

    // 分支隔离：如果有用户消息正查看旧版本（非 live），先保存当前对话状态为新分支
    for (let i = 0; i < this._messages.length; i++) {
      const m = this._messages[i];
      if (m.role === 'user' && m._generations && m._genIndex != null && m._genIndex < m._generations.length) {
        const snapshot = JSON.parse(JSON.stringify(this._messages.slice(i)));
        snapshot[0]._genIndex = m._generations.length;
        const parentMsg = i > 0 ? this._messages[i - 1] : null;
        m._generations.push({
          content: m.content, attachments: m.attachments, branch: snapshot,
          parentId: parentMsg ? parentMsg.id : null
        }); GP.log("send", "branch_isolation", {msgIdx: i, genCount: m._generations.length, parentId: parentMsg?.id});
        m._genIndex = m._generations.length - 1; // 指向刚保存的分支，刷新后可恢复
        m._currentBackup = null;
        this._saveGeneration(i);
        // 一条消息只处理最近的分支点
        break;
      }
    }

    // 清除空状态提示
    const container = $('chat-messages');
    const emptyHint = container.querySelector('#chat-empty-hint');
    if (emptyHint) container.innerHTML = '';

    // 保存当前附件快照（包含 id/preview/url/filename 等）
    const attachmentsSnapshot = this._attachments.filter(a => a.id && !a._error).map(a => ({
      id: a.id, filename: a.filename, file_type: a.file_type, preview: a.preview, url: a.url
    }));

    // 添加用户消息到界面
    const userMsg = { role: 'user', content: content };
    if (attachmentsSnapshot.length) userMsg.attachments = attachmentsSnapshot;
    // 编辑模式下注入已保存的版本历史，立即显示翻页
    if (this._pendingEditedGen) {
      userMsg._generations = this._pendingEditedGen.generations;
      userMsg._genIndex = this._pendingEditedGen.genIndex;
      this._pendingEditedGen = null;
    }
    const userIdx = this._messages.length;
    this._messages.push(userMsg);
    container.insertAdjacentHTML('beforeend', this._renderMessageHtml(userMsg, userIdx));
    this.scrollToBottom();

    // 清空输入
    ta.value = '';
    this.autoResize();
    this._updateSendBtn();

    // 收集附件 ID
    const attachmentIds = this._attachments.filter(a => a.id && !a._error).map(a => a.id);
    this._clearAttachments();

    // 流式
    await this._streamChat(content, container, attachmentIds);

    // G-1: 发送成功后清除分支截断标记
    this._branchTruncateId = null;

    // 编辑完成，清除备份
    sessionStorage.removeItem('grindpal_edit_backup');

    // 编辑后立即恢复翻页控件
    if (editedIdx !== null) {
      this._restoreGenerations();
      const msg = this._messages[editedIdx];
      if (msg && msg._generations && msg._generations.length > 0) {
        const el = document.querySelector(`.chat-msg[data-msg-idx="${editedIdx}"]`);
        if (el) {
          const newHtml = this._renderMessageHtml(msg, editedIdx);
          const temp = document.createElement('div');
          temp.innerHTML = newHtml;
          el.replaceWith(temp.firstElementChild);
        }
      }
    }
  },

  // ---- 核心：流式请求+渲染 ----
  async _streamChat(content, container, attachmentIds = [], regenerateMsgIdx = null, insertAtIndex = null) {
    // 保存附件 ID 以便重试时使用
    this._retryAttachmentIds = attachmentIds;
    // 显示 loading
    const loadingId = 'chat-loading-' + Date.now();
    const loadingHtml = `<div class="chat-msg assistant chat-loading" id="${loadingId}">
      <div class="bubble">
        <div class="chat-loading-dots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
    // 如果在指定位置插入（regenerate 场景），插入到该索引位置；否则追加到末尾
    if (insertAtIndex !== null && insertAtIndex < container.children.length) {
      const refChild = container.children[insertAtIndex];
      refChild.insertAdjacentHTML('beforebegin', loadingHtml);
    } else {
      container.insertAdjacentHTML('beforeend', loadingHtml);
    }
    if (insertAtIndex === null) this.scrollToBottom();

    this._streaming = true;
    this._updateSendBtn();
    this._abortController = new AbortController();
    // 保存对话快照，防止异步回调污染
    const convIdSnapshot = this._currentConvId;
    const msgInsertPos = insertAtIndex !== null ? insertAtIndex : this._messages.length;

    let fullResponse = '';
    let thinkingContent = '';
    const assistantMsgEl = document.getElementById(loadingId);

    // Throttle：60ms 间隔 + trailing call 避免频繁全量 DOM 重绘
    let _throttleTimer = null;
    let _pendingRender = false;
    const updateBubble = () => {
      if (!assistantMsgEl) return;
      const isFirstContent = !fullResponse && !thinkingContent;
      if (isFirstContent) return;
      if (_throttleTimer) { _pendingRender = true; return; }
      _doRenderBubble();
      _throttleTimer = setTimeout(() => {
        _throttleTimer = null;
        if (_pendingRender) { _pendingRender = false; _doRenderBubble(); }
      }, 60);
    };

    const _doRenderBubble = () => {
      assistantMsgEl.classList.remove('chat-loading');
      const bubble = assistantMsgEl.querySelector('.bubble');
      if (!bubble) return;
      let html = '';
      if (thinkingContent) {
        html += '<details class="thinking-box" open><summary>思考过程</summary><div class="think-content">' + App._renderMd(thinkingContent) + '</div></details>';
      }
      html += App._renderMd(fullResponse);
      bubble.innerHTML = html;
      // 仅对未完成的代码块做实时高亮（已完成的不重复处理）
      const pres = bubble.querySelectorAll('pre:not([data-highlighted])');
      if (pres.length && typeof hljs !== 'undefined') {
        const lastPre = pres[pres.length - 1];
        const code = lastPre.querySelector('code');
        if (code) {
          try { hljs.highlightElement(code); } catch(e) {}
        }
        // 标记已完成的代码块（闭合的 ``` 表示完成）
        const allPres = bubble.querySelectorAll('pre');
        for (let i = 0; i < allPres.length - 1; i++) {
          allPres[i].setAttribute('data-highlighted', '1');
        }
      }
    };

    try {
      const kbEnabled = this._kbEnabled && !!this._getKbId();
      const kbHeaders = kbEnabled ? { 'X-Kb-Collection': this._getKbId() } : {};
      const resp = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Model': localStorage.getItem('grindpal_chat_model') || 'deepseek-v4-flash', 'X-Deep-Think': this._deepThink ? '1' : '0', 'X-Style': localStorage.getItem('grindpal_style') || 'standard', ...App._authHeaders(), ...kbHeaders },
        body: JSON.stringify({ conversation_id: this._currentConvId, content: content, regenerate: !!this._regenerateMode, regenerate_msg_idx: regenerateMsgIdx, regenerate_msg_id: this._regenerateMsgId || null, attachment_ids: attachmentIds, persona: this._persona || 'standard' }),
        signal: this._abortController.signal
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.substring(6));
            if (parsed.type === 'token') {
              fullResponse += parsed.content;
              updateBubble();
              if (insertAtIndex === null) this.scrollToBottom();
            } else if (parsed.type === 'thinking') {
              thinkingContent += parsed.content;
              updateBubble();
              if (insertAtIndex === null) this.scrollToBottom();
            } else if (parsed.type === 'user_msg') {
              GP.log('stream', 'user_msg', {user_msg_id: parsed.user_msg_id});
              // 后端提前告知 user_msg_id，在流式 token 到达前就回填 ID 并持久化版本历史
              if (parsed.user_msg_id && this._currentConvId === convIdSnapshot) {
                for (let i = this._messages.length - 1; i >= 0; i--) {
                  const m = this._messages[i];
                  if (m.role === 'user' && !m.id) {
                    m.id = parsed.user_msg_id;
                    if (m._generations) this._saveGeneration(i);
                    break;
                  }
                }
              }
            } else if (parsed.type === 'done') {
              GP.log('stream', 'done', {msg_id: parsed.msg_id, user_msg_id: parsed.user_msg_id});
              App._lastKbChunks = (parsed.kb_chunks && parsed.kb_chunks.length) ? parsed.kb_chunks : null;
              App._lastKbNames = parsed.kb_chunks ? ChatApp._getKbDisplayName() : null;
              if (fullResponse.trim() && this._currentConvId === convIdSnapshot) {
                const newMsg = { role: 'assistant', content: fullResponse, thinking: thinkingContent || undefined };
                if (parsed.msg_id) newMsg.id = parsed.msg_id;
                if (parsed.kb_chunks && parsed.kb_chunks.length) {
                  newMsg.kb_chunks = parsed.kb_chunks;
                  newMsg.kb_names = ChatApp._getKbDisplayName(); // 记录生成时的 KB 名称
                }
                if (this._pendingGenerations) {
                  newMsg._generations = this._pendingGenerations.generations;
                  newMsg._genIndex = this._pendingGenerations.genIndex;
                  this._pendingGenerations = null;
                }
                // 在正确位置插入（regenerate 场景保持一致），而非总 push 到末尾
                this._messages.splice(msgInsertPos, 0, newMsg);
                // 持久化版本历史（regenerate 只在内存写了 _generations，需落盘到 localStorage）
                if (newMsg._generations) this._saveGeneration(msgInsertPos);
                // 编辑模式：后端新建了用户消息，把新 ID 回填并持久化其版本历史
                if (parsed.user_msg_id) {
                  for (let i = msgInsertPos - 1; i >= 0; i--) {
                    const m = this._messages[i];
                    if (m.role === 'user' && !m.id) {
                      m.id = parsed.user_msg_id;
                      if (m._generations) this._saveGeneration(i);
                      break;
                    }
                  }
                } else {
                  // 防御：user_msg_id 缺失时用本地临时 ID，保证当前会话内不丢版本历史
                  for (let i = msgInsertPos - 1; i >= 0; i--) {
                    const m = this._messages[i];
                    if (m.role === 'user' && !m.id && m._generations) {
                      m.id = '_local_' + Date.now();
                      this._saveGeneration(i);
                      console.warn('[done] user_msg_id missing, using local id', m.id);
                      break;
                    }
                  }
                }
              }
              updateBubble();
              // Replace loading div with proper rendered message
              if (assistantMsgEl) {
                if (insertAtIndex !== null) {
                  // 非末尾插入 → 全量重渲染，保证 onclick/索引全部正确
                  this.renderMessages(true);
                  setTimeout(() => {
                    if (App._lastKbChunks && App._lastKbChunks.length) {
                      const newEl = container.children[insertAtIndex];
                      const newBubble = newEl ? newEl.querySelector('.bubble') : null;
                      if (newBubble) newBubble.dataset.kbChunks = JSON.stringify(App._lastKbChunks);
                    }
                  }, 100);
                } else {
                  const newMsgIdx = this._messages.length - 1;
                  const newMsgObj = this._messages[newMsgIdx];
                  const finalHtml = this._renderMessageHtml(newMsgObj, newMsgIdx);
                  const temp = document.createElement('div');
                  temp.innerHTML = finalHtml;
                  const newDomEl = temp.firstElementChild;
                  assistantMsgEl.replaceWith(newDomEl);
                  // 高亮知识库引用 + 底部指示条
                  setTimeout(() => {
                    const newBubble = newDomEl ? newDomEl.querySelector('.bubble') : null;
                    if (newBubble && App._lastKbChunks && App._lastKbChunks.length) {
                      newBubble.dataset.kbChunks = JSON.stringify(App._lastKbChunks);
                    }
                  }, 100);
                }
              }
              this.loadConversations();
              this.updateContextUsage();
            } else if (parsed.type === 'title_update') {
              // 对话标题已由 LLM 自动生成，刷新侧栏
              this.loadConversations();
            } else if (parsed.type === 'error') {
              if (assistantMsgEl) {
                assistantMsgEl.classList.remove('chat-loading');
                assistantMsgEl.classList.add('error');
                const bubble = assistantMsgEl.querySelector('.bubble');
                if (bubble) {
                  bubble.textContent = parsed.message || t('chat.error') || '回复生成失败';
                  const retryBtn = document.createElement('button');
                  retryBtn.className = 'retry-btn';
                  retryBtn.innerHTML = '<span class="material-icons" style="font-size:14px">refresh</span> ' + t('todos.retry');
                  const regenIdx = regenerateMsgIdx;
                  const insIdx = insertAtIndex;
                  const savedRegenMsgId2 = this._regenerateMsgId;  // 闭包捕获
                  retryBtn.onclick = () => {
                    assistantMsgEl.remove();
                    // 编辑流程重试：用简单 regen 路径（后端 delete_last_message_pair + 重新保存用户消息）
                    const isEditRetry = (regenIdx === null && insIdx === null);
                    this._regenerateMode = (regenIdx !== null) || isEditRetry;
                    if (isEditRetry) this._regenerateMsgId = null;  // 编辑重试用简单 regen 路径，不需要 msg_id
                    else this._regenerateMsgId = savedRegenMsgId2;   // 正常 regen 重试：原位更新同一个 assistant
                    this._streamChat(content, container, this._retryAttachmentIds || [], regenIdx, insIdx);
                  };
                  bubble.appendChild(retryBtn);
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        // 用户主动停止：保留已生成内容
        if (fullResponse.trim() && assistantMsgEl && this._currentConvId === convIdSnapshot) {
          this._pendingContent = fullResponse;
          this._pendingThinking = thinkingContent;
          this._messages.splice(msgInsertPos, 0, { role: 'assistant', content: fullResponse, thinking: thinkingContent || undefined, stopped: true });
          updateBubble();
          const finalHtml = this._renderMessageHtml({ role: 'assistant', content: fullResponse, thinking: thinkingContent, stopped: true });
          const temp = document.createElement('div');
          temp.innerHTML = finalHtml;
          assistantMsgEl.replaceWith(temp.firstElementChild);
        } else if (assistantMsgEl) {
          assistantMsgEl.remove();
          // 若为 regenerate 场景且无内容，恢复旧 assistant 避免对话缺口
          if (this._regenerateBackup && insertAtIndex !== null) {
            this._messages.splice(msgInsertPos, 0, this._regenerateBackup);
            this._regenerateBackup = null;
            this.renderMessages(true);
          }
        }
        // 停止后异步回填：服务端已创建用户消息，取回真实 ID 持久化版本历史
        // early user_msg 事件可能已回填 ID，先检查；未回填则从服务器取最新消息匹配
        const cvId = convIdSnapshot;
        (async () => {
          try {
            // 检查是否已有 ID（early user_msg 事件已回填）
            let needBackfill = false;
            for (let i = this._messages.length - 1; i >= 0; i--) {
              const m = this._messages[i];
              if (m.role === 'user' && !m.id && m._generations) {
                needBackfill = true;
                break;
              }
            }
            if (!needBackfill) return;

            const resp = await fetch(`${API_BASE}/chat/conversations/${cvId}/messages?limit=50`, {
              headers: App._authHeaders()
            });
            if (!resp.ok) return;
            const data = await resp.json();
            const serverMsgs = data.data?.messages || [];
            // 取服务器上最新的 user 消息作为我们的新消息
            let latestUserMsg = null;
            for (let j = serverMsgs.length - 1; j >= 0; j--) {
              if (serverMsgs[j].role === 'user') { latestUserMsg = serverMsgs[j]; break; }
            }
            if (!latestUserMsg) return;
            // 回填本地匹配的 user 消息（向后找第一个无 ID 且有 _generations 的 user 消息）
            for (let i = this._messages.length - 1; i >= 0; i--) {
              const m = this._messages[i];
              if (m.role === 'user' && !m.id && m._generations) {
                m.id = latestUserMsg.id;
                this._saveGeneration(i);
                break;
              }
            }
          } catch (ex) {}
        })();
      } else if (assistantMsgEl) {
        assistantMsgEl.classList.remove('chat-loading');
        assistantMsgEl.classList.add('error');
        const bubble = assistantMsgEl.querySelector('.bubble');
        if (bubble) {
          bubble.textContent = t('chat.error') || '回复生成失败，请重试';
          const retryBtn = document.createElement('button');
          retryBtn.className = 'retry-btn';
          retryBtn.innerHTML = '<span class="material-icons" style="font-size:14px">refresh</span> ' + t('todos.retry');
          const regenIdx2 = regenerateMsgIdx;
          const insIdx2 = insertAtIndex;
          const savedRegenMsgId = this._regenerateMsgId;  // 闭包捕获，防止 finally 清空
          retryBtn.onclick = () => {
            assistantMsgEl.remove();
            const isEditRetry2 = (regenIdx2 === null && insIdx2 === null);
            this._regenerateMode = (regenIdx2 !== null) || isEditRetry2;
            if (isEditRetry2) this._regenerateMsgId = null;  // 编辑重试用简单 regen 路径
            else this._regenerateMsgId = savedRegenMsgId;    // 正常 regen 重试：原位更新同一个 assistant
            this._streamChat(content, container, this._retryAttachmentIds || [], regenIdx2, insIdx2);
          };
          bubble.appendChild(retryBtn);
        }
      }
    } finally {
      this._streaming = false;
      this._abortController = null;
      this._regenerateMode = false;
      this._regenerateMsgId = null;
      this._pendingGenerations = null;  // 防止中止/报错后残留，污染下次 _streamChat
      this._regenerateBackup = null;
      this._updateSendBtn();
    }
  },

  // ---- 停止生成 ----
  stopGeneration() {
    if (this._abortController) {
      this._abortController.abort();
    }
    // _streamChat 的 catch (AbortError) 会处理 UI
  },

  // ---- 继续生成 ----
  async continueGeneration() { GP.log("continueGen", "start");
    if (this._streaming) return;  // 流式中不允许
    // 继续生成：定位最后一条 assistant 消息重新生成
    const lastIdx = this._messages.map(m => m.role).lastIndexOf('assistant');
    if (lastIdx >= 0) await this.regenerate(lastIdx);
  },

  // ---- 重新生成 ----
  async regenerate(idx) { GP.log("regenerate", "start", {idx, msgCount: this._messages.length});
    if (this._streaming) return;  // 流式中禁止重新生成
    // 找到该 assistant 消息之前的最近一条 user 消息
    let userMsgIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (this._messages[i].role === 'user') { userMsgIdx = i; break; }
    }
    if (userMsgIdx === -1) return;
    const lastUserMsg = this._messages[userMsgIdx];
    const oldAssistant = this._messages[idx];
    if (oldAssistant && oldAssistant.role === 'assistant') {
      // 仅当旧消息有实际内容且非 stopped 状态时保存到 generation 版本
      if (oldAssistant.content && !oldAssistant.stopped) {
        if (!oldAssistant._generations) oldAssistant._generations = [];
        oldAssistant._generations.push({ content: oldAssistant.content, thinking: oldAssistant.thinking || '' });
        oldAssistant._genIndex = oldAssistant._generations.length;
        this._pendingGenerations = { generations: oldAssistant._generations, genIndex: oldAssistant._generations.length }; GP.log("regenerate", "saved_pending", {genCount: oldAssistant._generations.length});
      } else {
        this._pendingGenerations = null;
      }
      // 不删服务端消息，传旧消息 ID 给后端原位更新
      this._regenerateMsgId = oldAssistant.id || null;
      this._regenerateBackup = oldAssistant;  // 保存旧消息引用，用于停止无内容时恢复
      this._messages.splice(idx, 1);
    }
    this.renderMessages(true);
    this._regenerateMode = true;
    const regenAttachmentIds = (lastUserMsg.attachments || []).map(a => a.id).filter(Boolean);
    await this._streamChat(lastUserMsg.content, $('chat-messages'), regenAttachmentIds, userMsgIdx, idx);
  },

  // ---- 版本切换 ----
  _genKey(msgId) {
    return `grindpal_gen_${this._currentConvId}_${msgId}`;
  },

  _restoreGenerations() {
    GP.log('restoreGen', 'start', {msgCount: this._messages.length});
    for (const m of this._messages) {
      if (!m.id || m._generations) continue;  // 已有内存数据则跳过，避免压缩版覆盖完整版
      const key = this._genKey(m.id);
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const gen = JSON.parse(saved);
          m._generations = gen.generations;
          const idx = gen.genIndex ?? (gen.generations || []).length;
          m._genIndex = Math.min(idx, Math.max(0, (gen.generations || []).length));
        }
      } catch (e) {}
    }
  },

  // 恢复后同步：若某条用户消息正查看已保存版本（非 live），把分支内容应用到 _messages
  _reconcileGenerations() { GP.log("reconcile", "start", {msgCount: this._messages.length});
    // 从右向左找第一个需要同步的用户消息（其分支会替换所有下游，只需处理最右侧的）
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const m = this._messages[i];
      if (m.role !== 'user' || m._reconciled || !m._generations || m._generations.length === 0) continue;
      const genIdx = m._genIndex != null ? m._genIndex : m._generations.length;
      if (genIdx >= m._generations.length) continue;  // live，无需同步
      const target = m._generations[genIdx];
      if (!target) continue;
      // 应用已保存版本的内容和分支
      m.content = target.content;
      m.attachments = target.attachments || undefined;
      if (target.branch && target.branch.length > 1) {
        // 替换下游消息为分支中的消息
        this._messages.splice(i + 1, this._messages.length - i - 1);
        for (let j = 1; j < target.branch.length; j++) {
          this._messages.push(JSON.parse(JSON.stringify(target.branch[j])));
        }
      } else {
        // 分支无下游消息（branch 仅包含自己或无 branch），清空下游
        this._messages.splice(i + 1, this._messages.length - i - 1);
      }
      GP.log("reconcile", "applied", {msgIdx: i, genIdx, branchLen: target.branch?.length}); break;  // 只处理最右侧的分支点
    }
  },

  // 恢复被截断清空的对话：从 localStorage 中找回分支锚点消息
  _recoverOrphanedGenerations(convId) { GP.log("recoverOrphan", "start", {convId, msgCount: this._messages.length});
    const prefix = `grindpal_gen_${convId}_`;
    const existingIds = new Set(this._messages.map(m => m.id).filter(Boolean));
    const candidates = [];
    let scannedKeys = 0, skippedExisting = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          const msgId = parseInt(key.slice(prefix.length));
          if (data && data.generations && data.generations.length > 0 && !isNaN(msgId)) {
            if (existingIds.has(msgId)) { skippedExisting++; continue; }
            scannedKeys++;
            const genIdx = Math.min(data.genIndex ?? data.generations.length, data.generations.length - 1);
            const firstGen = data.generations[genIdx] || data.generations[0];
            candidates.push({ msgId, content: firstGen.content || '', generations: data.generations, genIndex: genIdx });
          }
        } catch(e) {}
      }
    }
    if (candidates.length === 0) { GP.log("recoverOrphan", "no_candidates", {scannedKeys, skippedExisting, localStorageLen: localStorage.length}); return; }
    // 选 branch 数据最丰富的那条作为锚点
    candidates.sort((a, b) => (b.generations[0]?.branch?.length || 0) - (a.generations[0]?.branch?.length || 0));
    const best = candidates[0];
    const recovered = {
      role: 'user',
      content: best.content,
      id: best.msgId,
      _generations: best.generations,
      _genIndex: Math.min(best.genIndex, best.generations.length),
      _recovered: true,
    };
    // 找到 parentId 在 _messages 中的位置，插入恢复消息和分支内容
    const parentId = best.generations[best.genIndex || 0]?.parentId;
    let insertAt = this._messages.length;
    if (parentId) {
      const parentIdx = this._messages.findIndex(m => m.id === parentId);
      if (parentIdx >= 0) insertAt = parentIdx + 1;
    }
    // 直接展开分支内容插入（跳过 _reconcileGenerations，避免覆盖后续服务端消息）
    const branch = best.generations[best.genIndex || 0]?.branch || [];
    const toInsert = [recovered];
    for (let j = 1; j < branch.length; j++) {
      toInsert.push(JSON.parse(JSON.stringify(branch[j])));
    }
    GP.log("recoverOrphan", "insert", {insertAt, branchLen: branch.length, parentId, msgCount: this._messages.length}); this._messages.splice(insertAt, 0, ...toInsert);
    // 标记已恢复，避免 _reconcileGenerations 重复处理
    recovered._reconciled = true;
  },

  _saveGeneration(msgIdx) { GP.log("saveGen", "call", {msgIdx, msgId: this._messages[msgIdx]?.id, genCount: this._messages[msgIdx]?._generations?.length, genIdx: this._messages[msgIdx]?._genIndex});
    const msg = this._messages[msgIdx];
    if (!msg || !msg._generations || !msg.id) { GP.log("saveGen", "skip"); return; }
    const key = this._genKey(msg.id);
    // 保存完整 branch 数据（不再截断内容、不再丢弃 _generations / thinking）
    // 分支内消息保留 _generations 以便嵌套版本翻页，但只保留一层深度避免递归膨胀
    const savedGens = msg._generations.map(g => {
      const { branch, ...rest } = g;
      if (branch && Array.isArray(branch)) {
        rest.branch = branch.map(m => {
          const compact = {
            role: m.role,
            content: m.content || '',
            thinking: m.thinking || undefined,
            attachments: m.attachments || undefined,
          };
          if (m._generations && m._generations.length > 0) {
            compact._generations = m._generations.map(gg => {
              const { branch: _b, ...rr } = gg;
              if (_b && Array.isArray(_b)) {
                rr.branch = _b.map(mm => ({
                  role: mm.role,
                  content: (mm.content || '').slice(0, 1000),  // 二层分支截断防膨胀
                  attachments: mm.attachments || undefined,
                }));
              }
              return rr;
            });
            compact._genIndex = m._genIndex;
          }
          return compact;
        });
      }
      return rest;
    });
    try {
      // 序列化后若超过 200KB，降级为截断模式（300 字）
      const payload = JSON.stringify({ generations: savedGens, genIndex: msg._genIndex ?? msg._generations.length });
      if (payload.length > 200 * 1024) {
        // 降级：截断内容
        const liteGens = msg._generations.map(g => {
          const { branch, ...rest } = g;
          if (branch && Array.isArray(branch)) {
            rest.branch = branch.map(m => ({
              role: m.role,
              content: (m.content || '').slice(0, 300),
              attachments: m.attachments || undefined,
            }));
          }
          return rest;
        });
        localStorage.setItem(key, JSON.stringify({ generations: liteGens, genIndex: msg._genIndex ?? msg._generations.length }));
      } else {
        localStorage.setItem(key, payload);
        GP.log('saveGen', 'ok', {key: key.slice(-20), genIndex: msg._genIndex ?? msg._generations.length, payloadLen: payload.length});
      }
    } catch (e) {
      GP.log('saveGen', 'error', {key, error: e.name, msg: String(e).slice(0, 100)});
      if (e.name === 'QuotaExceededError') {
        // 清理旧的生成缓存（保留最近 10 条消息的缓存）
        try {
          const genKeys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('grindpal_gen_')) genKeys.push(k);
          }
          if (genKeys.length > 10) {
            genKeys.sort().slice(0, genKeys.length - 10).forEach(k => localStorage.removeItem(k));
            // 重试保存
            try { localStorage.setItem(key, payload); } catch(e2) {}
          }
        } catch(e2) {}
      }
    }
  },

  switchGeneration(msgIdx, direction) { GP.log("switchGen", "start", {msgIdx, direction, msgCount: this._messages.length});
    const msg = this._messages[msgIdx];
    if (!msg || !msg._generations || msg._generations.length === 0) return;
    const total = msg._generations.length + 1; // saved versions + current live version
    const current = msg._genIndex != null ? msg._genIndex : msg._generations.length;
    const newIndex = current + direction;
    if (newIndex < 0 || newIndex >= total) return;

    // 保存当前显示内容
    if (current < msg._generations.length) {
      // 当前在已保存版本上，原地覆盖
      if (msg.role === 'user') {
        const branch = JSON.parse(JSON.stringify(this._messages.slice(msgIdx)));
        branch[0]._genIndex = current;
        msg._generations[current] = { content: msg.content, attachments: msg.attachments, branch: branch };
      } else {
        msg._generations[current] = { content: msg.content, thinking: msg.thinking || '' };
      }
    } else {
      // 当前在 live 版本上（不 push 到数组，用 _currentBackup 暂存）
      if (msg.role === 'user') {
        const branch = JSON.parse(JSON.stringify(this._messages.slice(msgIdx)));
        branch[0]._genIndex = msg._generations.length;
        msg._currentBackup = { content: msg.content, attachments: msg.attachments, branch: branch };
      } else {
        msg._currentBackup = { content: msg.content, thinking: msg.thinking || '' };
      }
    }
    // 加载目标版本
    if (newIndex < msg._generations.length) {
      const target = msg._generations[newIndex];
      msg.content = target.content;
      if (msg.role === 'user') {
        msg.attachments = target.attachments;
        // 替换下游消息
        if (target.branch && target.branch.length > 1) {
          this._messages.splice(msgIdx + 1, this._messages.length - msgIdx - 1);
          for (let j = 1; j < target.branch.length; j++) {
            this._messages.push(JSON.parse(JSON.stringify(target.branch[j])));
          }
        } else {
          this._messages.splice(msgIdx + 1, this._messages.length - msgIdx - 1);
        }
      } else {
        msg.thinking = target.thinking;
      }
    } else {
      // 切回 live 版本
      if (msg._currentBackup) {
        msg.content = msg._currentBackup.content;
        if (msg.role === 'user') {
          msg.attachments = msg._currentBackup.attachments;
          if (msg._currentBackup.branch && msg._currentBackup.branch.length > 1) {
            this._messages.splice(msgIdx + 1, this._messages.length - msgIdx - 1);
            for (let j = 1; j < msg._currentBackup.branch.length; j++) {
              this._messages.push(JSON.parse(JSON.stringify(msg._currentBackup.branch[j])));
            }
          } else {
            this._messages.splice(msgIdx + 1, this._messages.length - msgIdx - 1);
          }
        } else {
          msg.thinking = msg._currentBackup.thinking;
        }
      }
      // _currentBackup 为空时保持当前内容不变，清除下游（live 版本无预存下游消息）
      else if (msg.role === 'user') {
        this._messages.splice(msgIdx + 1, this._messages.length - msgIdx - 1);
      }
    }
    GP.log("switchGen", "set_genIndex", {newIndex, total}); msg._genIndex = newIndex;
    this._saveGeneration(msgIdx);  // 持久化

    // G-1 修复：记录分支截断点，下次 send 时同步服务端
    if (msg.role === 'user') {
      if (newIndex < msg._generations.length) {
        // 切换到已保存分支 → 找到公共祖先（最后一个有效服务端 ID 的消息）
        let ancestorId = null;
        for (let k = msgIdx - 1; k >= 0; k--) {
          const anc = this._messages[k];
          if (anc.id && !String(anc.id).startsWith('_local_')) {
            ancestorId = anc.id;
            break;
          }
        }
        this._branchTruncateId = ancestorId;
      } else {
        // 切回 live → 无需截断
        this._branchTruncateId = null;
      }
    }

    // 用户消息需全量重渲染（下游消息变了），AI 消息只更新单个气泡
    if (msg.role === 'user') {
      this.renderMessages();
      // 不调 _restoreGenerations：下游消息是分支还原的新对象，无需从 localStorage 恢复
      // genIndex 已在上方显式设置并 saveGeneration，不会丢失
      return;
    }

    // 原地更新 DOM
    const el = document.querySelector(`.chat-msg[data-msg-idx="${msgIdx}"]`);
    if (el) {
      const bubble = el.querySelector('.bubble');
      if (bubble) {
        let html = '';
        if (msg.thinking) {
          html += '<details class="thinking-box" open><summary>思考过程</summary><div class="think-content">' + App._renderMd(msg.thinking) + '</div></details>';
        }
        html += App._renderMd(msg.content);
        // 保留翻页控件和操作按钮（bubble.innerHTML 会清空，先保存再重建）
        const existingPager = bubble.querySelector('.gen-pager');
        const existingActions = bubble.querySelector('.chat-msg-actions');
        bubble.innerHTML = html;
        if (existingActions) {
          bubble.appendChild(existingActions);
          // 更新翻页控件文本
          if (existingPager) {
            const newCurrent = newIndex + 1;
            const pColor = msg.role === 'user' ? 'rgba(255,255,255,0.85)' : 'var(--color-text-secondary)';
            existingPager.innerHTML = `<button onclick="ChatApp.switchGeneration(${msgIdx},-1)" style="background:none;border:none;cursor:pointer;color:${pColor};padding:2px 4px;font-size:14px" ${newCurrent <= 1 ? 'disabled' : ''}>◀</button>
        <span style="color:${pColor}">${newCurrent}/${total}</span>
        <button onclick="ChatApp.switchGeneration(${msgIdx},1)" style="background:none;border:none;cursor:pointer;color:${pColor};padding:2px 4px;font-size:14px" ${newCurrent >= total ? 'disabled' : ''}>▶</button>`;
          }
        }
      }
      // 更新复制按钮的 data-content
      const copyBtn = el.querySelector('[data-content]');
      if (copyBtn) copyBtn.dataset.content = msg.content;
    }
  },

  // ---- 复制消息 ----
  copyMessage(btn) {
    const content = btn.dataset.content;
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      btn.innerHTML = `<span class="material-icons" style="font-size:14px">check</span>`;
      App._showToast(t('chat.copied') || '已复制');
      setTimeout(() => {
        btn.innerHTML = `<span class="material-icons" style="font-size:14px">content_copy</span>`;
      }, 1500);
    }).catch(() => { console.warn('clipboard write failed'); });
  },

  // ---- 编辑消息 ----
  editMessage(msgIdx) { GP.log("editMessage", "start", {msgIdx, msgId: this._messages[msgIdx]?.id});
    if (this._streaming) return;
    const msg = this._messages[msgIdx];
    if (!msg || msg.role !== 'user') return;
    const ta = $('chat-input');
    ta.value = msg.content;
    this.autoResize();
    this._updateSendBtn();
    ta.focus();
    // 标记编辑模式，不立即截断，保留下方消息供参考
    this._editingMsgIdx = msgIdx;
    // 视觉提示：输入框变蓝
    const inputBox = $('chat-input-box');
    if (inputBox) inputBox.classList.add('editing');
    ta.setSelectionRange(ta.value.length, ta.value.length);
    // 恢复该消息的附件，允许删除和重新上传
    this._attachments = [];
    if (msg.attachments && msg.attachments.length) {
      this._attachments = msg.attachments.map(a => ({
        file: null,           // 已在服务端，无需本地文件
        id: a.id,
        filename: a.filename,
        file_type: a.file_type,
        preview: a.preview || '',
        url: a.url || '',
        _fromHistory: true,   // 标记为历史附件，不需要重新上传
      }));
    }
    this._renderAttachments();
  },

  async _truncateServer(msgId, strictlyAfter = false) { GP.log("truncateServer", "start", {msgId, strictlyAfter, convId: this._currentConvId});
    const resp = await fetch(`${API_BASE}/chat/conversations/${this._currentConvId}/messages/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...App._authHeaders() },
      body: JSON.stringify({ after_msg_id: msgId, strictly_after: strictlyAfter })
    });
    if (!resp.ok) throw new Error('truncate failed: ' + resp.status);
    return resp.json();
  },

  // ---- 删除单条消息 ----
  async deleteMessage(msgIdx) { GP.log("deleteMessage", "start", {msgIdx, role: this._messages[msgIdx]?.role, msgCount: this._messages.length});
    if (this._streaming) return;
    const msg = this._messages[msgIdx];
    if (!msg) return;
    const isUser = msg.role === 'user';
    const confirmText = t('chat.deleteMsgConfirm') || '确定删除此消息？';
    App._showConfirm(confirmText, async () => {
    const msgId = msg.id;
    // 乐观 UI：先删本地
    let downstreamRemoved = [];
    let removed;
    if (isUser && msgIdx < this._messages.length - 1) {
      // 用户消息：连同下游一起删除，记录用于回滚
      removed = this._messages[msgIdx];
      downstreamRemoved = this._messages.splice(msgIdx + 1);
      this._messages.splice(msgIdx, 1);
    } else {
      removed = this._messages.splice(msgIdx, 1)[0];
    }
    const allRemovedIds = [removed.id, ...downstreamRemoved.map(m => m.id)].filter(Boolean);
    this.renderMessages();
    try {
      if (isUser && msgId) {
        // 用户消息：用 truncate 删除该消息及其下游（而非逐条删）
        await this._truncateServer(msgId);
      } else if (msgId) {
        // 助理消息：单条删除
        const resp = await fetch(`${API_BASE}/chat/conversations/${this._currentConvId}/messages?msg_id=${msgId}`, {
          method: 'DELETE',
          headers: App._authHeaders()
        });
        if (!resp.ok) throw new Error('Failed');
      }
      // 清理所有已删消息的 localStorage 版本历史
      for (const rid of allRemovedIds) {
        try { localStorage.removeItem(this._genKey(rid)); } catch (e) {}
      }
      // 刷新对话列表以更新预览
      this.loadConversations();
    } catch (e) {
      // 回滚：把删除的消息插回原位
      this._messages.splice(msgIdx, 0, removed);
      if (downstreamRemoved.length) {
        this._messages.splice(msgIdx + 1, 0, ...downstreamRemoved);
      }
      this.renderMessages();
      toast(t('toast.deleteRestored'), 'warning');
    }
    });
  },

  // ---- Toast ----
  _showToast(message, duration = 2000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, duration);
  }
};
