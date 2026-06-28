/**
 * 浏览器端 API Key 加密工具
 * 使用 Web Crypto API: PBKDF2 派生密钥 + AES-GCM 加密
 *
 * 存储格式: localStorage.grindpal_apikey_enc = JSON.stringify({kdfSalt, iv, ciphertext})
 *   kdfSalt: PBKDF2 密钥派生盐值（Base64）
 *   iv:      AES-GCM 初始化向量（Base64）
 *   ciphertext: 密文（Base64）
 * 解密缓存: App._apiKey 内存变量（标签页关闭即失）
 */

const CryptoUtils = {
  ITERATIONS: 100000,  // PBKDF2 迭代次数
  KEY_LEN: 256,        // AES-GCM 密钥长度
  SALT_LEN: 16,        // PBKDF2 salt 长度（字节）
  IV_LEN: 12,          // AES-GCM IV 长度（字节）

  _bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length <= 0x8000) {
      return btoa(String.fromCharCode(...bytes));
    }
    // 分块避免大数组导致栈溢出
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  },

  _base64ToBuf(b64) {
    const raw = atob(b64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return buf.buffer;
  },

  _encode(str) { return new TextEncoder().encode(str); },
  _decode(buf) { return new TextDecoder().decode(buf); },

  /**
   * PBKDF2 从密码派生 AES-GCM 密钥
   * @param {string} password
   * @param {string} kdfSalt - Base64 编码的盐值
   * @returns {Promise<CryptoKey>}
   */
  async deriveKey(password, kdfSalt) {
    const saltBuf = this._base64ToBuf(kdfSalt);
    const baseKey = await crypto.subtle.importKey(
      'raw', this._encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBuf, iterations: this.ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: this.KEY_LEN },
      false,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * AES-GCM 加密（不生成 salt，salt 由上层 PBKDF2 管理）
   * @returns {Promise<{iv: string, ciphertext: string}>}
   */
  async _aesEncrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LEN));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, this._encode(plaintext)
    );
    return { iv: this._bufToBase64(iv), ciphertext: this._bufToBase64(encrypted) };
  },

  /**
   * AES-GCM 解密
   * @returns {Promise<string>}
   */
  async _aesDecrypt(ivB64, ciphertextB64, key) {
    const iv = this._base64ToBuf(ivB64);
    const data = this._base64ToBuf(ciphertextB64);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return this._decode(decrypted);
  },

  /**
   * 一键加密：PBKDF2 派生密钥 → AES-GCM 加密 → 打包 JSON
   * @param {string} plaintext - API Key 明文
   * @param {string} password - 登录密码
   * @returns {Promise<string>} JSON 字符串 {kdfSalt, iv, ciphertext}
   */
  async encryptWithPassword(plaintext, password) {
    const kdfSalt = crypto.getRandomValues(new Uint8Array(this.SALT_LEN));
    const key = await this.deriveKey(password, this._bufToBase64(kdfSalt));
    const { iv, ciphertext } = await this._aesEncrypt(plaintext, key);
    return JSON.stringify({ kdfSalt: this._bufToBase64(kdfSalt), iv, ciphertext });
  },

  /**
   * 一键解密：解析 JSON → PBKDF2 派生密钥 → AES-GCM 解密
   * @param {{kdfSalt: string, iv: string, ciphertext: string}} encryptedData
   * @param {string} password
   * @returns {Promise<string>}
   */
  async decrypt(encryptedData, password) {
    // 兼容旧格式 {salt, iv, ciphertext} → {kdfSalt, iv, ciphertext}
    const kdfSalt = encryptedData.kdfSalt || encryptedData.salt;
    if (!kdfSalt) throw new Error('Missing kdfSalt');
    const key = await this.deriveKey(password, kdfSalt);
    return this._aesDecrypt(encryptedData.iv, encryptedData.ciphertext, key);
  },
};
