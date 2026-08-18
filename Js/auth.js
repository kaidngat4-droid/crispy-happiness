/**
 * ═══════════════════════════════════════════════════════════════
 *  auth.js — المصادقة والصلاحيات | نظام الشكاوى الإلكتروني
 *  مركز القلب والقسطرة القلبية — الجمهورية اليمنية
 *  استشاري التصميم والتطوير الطبي: د/ صلاح الأهدل
 *  الإصدار: 2.0 — 2026
 * ═══════════════════════════════════════════════════════════════
 * 
 *  الوظائف:
 *  • تسجيل الدخول / الخروج
 *  • إدارة الجلسات مع انتهاء صلاحية تلقائي
 *  • التحقق من الصلاحيات (RBAC)
 *  • حماية من هجمات القوة الغاشمة (Brute-force)
 *  • تشفير كلمات المرور (Base64 + Salt)
 *  • التحقق من صلاحية الرمز (Token validation)
 *  • إعادة توجيه غير المصرح لهم
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const Auth = (() => {

  /* ═══════════════════════════════════════════════
     1. الثوابت والإعدادات
     ═══════════════════════════════════════════════ */

  const CFG = Object.freeze({
    SESSION_KEY: 'hc_session',
    CURRENT_USER_KEY: 'hc_currentUser',
    USERS_KEY: 'hc_users',
    LOCKOUT_KEY: 'hc_lockout',
    ATTEMPTS_KEY: 'hc_attempts',
    MAX_ATTEMPTS: 5,
    LOCKOUT_MINUTES: 15,
    SESSION_HOURS: 8,
    TOKEN_SECRET: 'HC-2026-Secret-Key-HeartCenter-Yemen'
  });

  const ROLE_MAP = Object.freeze({
    admin: { label: 'مدير النظام', level: 4, permissions: ['*'] },
    doctor: { label: 'طبيب', level: 3, permissions: ['read', 'reply', 'update_status', 'view_all'] },
    nurse: { label: 'ممرض', level: 2, permissions: ['read', 'reply', 'view_all'] },
    patient: { label: 'مريض', level: 1, permissions: ['read_own', 'create', 'reply_own'] }
  });

  const PERMISSIONS = Object.freeze({
    READ_ALL: 'view_all',
    READ_OWN: 'read_own',
    CREATE: 'create',
    REPLY: 'reply',
    REPLY_OWN: 'reply_own',
    UPDATE_STATUS: 'update_status',
    DELETE: 'delete',
    MANAGE_USERS: 'manage_users',
    EXPORT: 'export',
    ALL: '*'
  });

  /* ═══════════════════════════════════════════════
     2. تشفير وتوكنات (Mock JWT)
     ═══════════════════════════════════════════════ */

  function generateSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt + CFG.TOKEN_SECRET);
    return btoa(String.fromCharCode(...data)).substring(0, 64);
  }

  function verifyPassword(password, salt, hash) {
    return hashPassword(password, salt) === hash;
  }

  function generateToken(user) {
    const payload = {
      email: user.email,
      role: user.role,
      iat: Date.now(),
      exp: Date.now() + (CFG.SESSION_HOURS * 60 * 60 * 1000)
    };
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    const signature = btoa(hashPassword(header + '.' + body, CFG.TOKEN_SECRET));
    return `${header}.${body}.${signature}`;
  }

  function verifyToken(token) {
    try {
      const [header, body, signature] = token.split('.');
      const expected = btoa(hashPassword(header + '.' + body, CFG.TOKEN_SECRET));
      if (signature !== expected) return null;
      const payload = JSON.parse(atob(body));
      if (payload.exp < Date.now()) return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  /* ═══════════════════════════════════════════════
     3. إدارة الجلسات
     ═══════════════════════════════════════════════ */

  function getSession() {
    try {
      const raw = sessionStorage.getItem(CFG.SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !session.token) return null;
      const payload = verifyToken(session.token);
      if (!payload) {
        clearSession();
        return null;
      }
      return { ...session, payload };
    } catch (e) {
      clearSession();
      return null;
    }
  }

  function setSession(user) {
    const token = generateToken(user);
    const session = {
      token,
      user: { ...user, password: undefined, salt: undefined },
      loginAt: Date.now(),
      expiresAt: Date.now() + (CFG.SESSION_HOURS * 60 * 60 * 1000)
    };
    sessionStorage.setItem(CFG.SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(CFG.CURRENT_USER_KEY, JSON.stringify(session.user));
    return session;
  }

  function clearSession() {
    sessionStorage.removeItem(CFG.SESSION_KEY);
    localStorage.removeItem(CFG.CURRENT_USER_KEY);
  }

  function getCurrentUser() {
    const session = getSession();
    if (session) return session.user;
    try {
      return JSON.parse(localStorage.getItem(CFG.CURRENT_USER_KEY));
    } catch (e) {
      return null;
    }
  }

  function isLoggedIn() {
    return getSession() !== null;
  }

  function getTimeRemaining() {
    const session = getSession();
    if (!session) return 0;
    return Math.max(0, session.expiresAt - Date.now());
  }

  function renewSession() {
    const user = getCurrentUser();
    if (!user) return false;
    setSession(user);
    return true;
  }

  /* ═══════════════════════════════════════════════
     4. حماية Brute-force
     ═══════════════════════════════════════════════ */

  function getAttempts() {
    try {
      return JSON.parse(sessionStorage.getItem(CFG.ATTEMPTS_KEY) || '{"count":0,"lastAttempt":0}');
    } catch (e) {
      return { count: 0, lastAttempt: 0 };
    }
  }

  function setAttempts(data) {
    sessionStorage.setItem(CFG.ATTEMPTS_KEY, JSON.stringify(data));
  }

  function isLockedOut() {
    const lockout = parseInt(sessionStorage.getItem(CFG.LOCKOUT_KEY) || '0', 10);
    if (lockout > Date.now()) {
      const minutes = Math.ceil((lockout - Date.now()) / 60000);
      return { locked: true, minutes };
    }
    sessionStorage.removeItem(CFG.LOCKOUT_KEY);
    return { locked: false, minutes: 0 };
  }

  function recordFailedAttempt() {
    const attempts = getAttempts();
    attempts.count += 1;
    attempts.lastAttempt = Date.now();
    setAttempts(attempts);

    if (attempts.count >= CFG.MAX_ATTEMPTS) {
      const lockoutEnd = Date.now() + (CFG.LOCKOUT_MINUTES * 60 * 1000);
      sessionStorage.setItem(CFG.LOCKOUT_KEY, lockoutEnd);
      return { locked: true, minutes: CFG.LOCKOUT_MINUTES };
    }
    return { locked: false, remaining: CFG.MAX_ATTEMPTS - attempts.count };
  }

  function resetAttempts() {
    sessionStorage.removeItem(CFG.ATTEMPTS_KEY);
    sessionStorage.removeItem(CFG.LOCKOUT_KEY);
  }

  /* ═══════════════════════════════════════════════
     5. التحقق من الصلاحيات (RBAC)
     ═══════════════════════════════════════════════ */

  function getRole(role) {
    return ROLE_MAP[role] || ROLE_MAP.patient;
  }

  function hasPermission(permission) {
    const user = getCurrentUser();
    if (!user) return false;
    const role = getRole(user.role);
    if (role.permissions.includes(PERMISSIONS.ALL)) return true;
    return role.permissions.includes(permission);
  }

  function canViewComplaint(complaint) {
    if (hasPermission(PERMISSIONS.READ_ALL)) return true;
    const user = getCurrentUser();
    if (!user || !complaint) return false;
    return complaint.email === user.email;
  }

  function canEditComplaint(complaint) {
    if (hasPermission(PERMISSIONS.UPDATE_STATUS)) return true;
    const user = getCurrentUser();
    if (!user || !complaint) return false;
    return complaint.email === user.email && complaint.status === 'pending';
  }

  function canDeleteComplaint() {
    return hasPermission(PERMISSIONS.DELETE);
  }

  function canReplyToComplaint(complaint) {
    if (hasPermission(PERMISSIONS.REPLY)) return true;
    const user = getCurrentUser();
    if (!user || !complaint) return false;
    return complaint.email === user.email && hasPermission(PERMISSIONS.REPLY_OWN);
  }

  function canExport() {
    return hasPermission(PERMISSIONS.EXPORT) || hasPermission(PERMISSIONS.ALL);
  }

  function getRoleLabel(role) {
    return getRole(role).label;
  }

  function getRoleLevel(role) {
    return getRole(role).level;
  }

  /* ═══════════════════════════════════════════════
     6. تسجيل الدخول / الخروج
     ═══════════════════════════════════════════════ */

  async function login(email, password) {
  // ── 1. التحقق من المدخلات ──
  if (!email || !password) {
    return {
      success: false,
      error: 'missing',
      message: 'يرجى إدخال البريد الإلكتروني وكلمة المرور',
      remaining: null
    };
  }

  // ── 2. جلب المستخدمين مع حماية كاملة ──
  let users = [];
  
  try {
    // إذا كان DB متوفراً ويعيد وعداً
    if (typeof DB !== 'undefined' && DB.getUsers) {
      const result = DB.getUsers();
      users = await Promise.resolve(result); // يتعامل مع sync/async
    }
  } catch (e) {
    console.warn('⚠️ فشل قراءة المستخدمين من DB:', e);
  }

  // ── 3. التأكد أن users مصفوفة ──
  if (!Array.isArray(users)) {
    console.error('❌ users ليس مصفوفة:', typeof users, users);
    users = [];
  }

  // ── 4. Fallback: المستخدمون التجريبيون إذا كانت القائمة فارغة ──
  if (users.length === 0) {
    const DEMO_USERS = [
      { id: 1, email: 'admin@heartcenter.sa', password: 'admin123', name: 'مدير النظام', role: 'admin' },
      { id: 2, email: 'doctor@heartcenter.sa', password: 'doctor123', name: 'د. أحمد القلبي', role: 'doctor' },
      { id: 3, email: 'nurse@heartcenter.sa', password: 'nurse123', name: 'سارة التمريض', role: 'nurse' },
      { id: 4, email: 'patient@heartcenter.sa', password: 'patient123', name: 'محمد العمري', role: 'patient' }
    ];
    users = DEMO_USERS;
    // حفظهم في localStorage للمرة القادمة
    try {
      if (typeof DB !== 'undefined' && DB.saveUsers) {
        await DB.saveUsers(DEMO_USERS);
      } else {
        localStorage.setItem('hc_users', JSON.stringify(DEMO_USERS));
      }
    } catch (e) {}
  }

  // ── 5. البحث عن المستخدم ──
  const user = users.find(u => u && u.email === email);
  
  if (!user) {
    const result = recordFailedAttempt();
    return {
      success: false,
      error: 'invalid',
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      remaining: result.remaining
    };
  }

  // ── 6. التحقق من كلمة المرور ──
  // مقارنة آمنة (توقيت ثابت) لمنع هجمات التوقيت
  const isMatch = safeCompare(user.password, password);
  
  if (!isMatch) {
    const result = recordFailedAttempt();
    return {
      success: false,
      error: 'invalid',
      message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      remaining: result.remaining
    };
  }

  // ── 7. نجاح تسجيل الدخول ──
  resetFailedAttempts();
  
  // نسخة آمنة بدون كلمة المرور
  const { password: _, ...safeUser } = user;
  
  saveSession(safeUser);
  
  return {
    success: true,
    user: safeUser,
    token: generateToken(safeUser.id)
  };
}

// ── دوال مساعدة ──

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function recordFailedAttempt() {
  const key = 'hc_login_attempts';
  const attempts = (parseInt(sessionStorage.getItem(key)) || 0) + 1;
  sessionStorage.setItem(key, attempts);
  
  const MAX = 3;
  return {
    attempts,
    remaining: Math.max(0, MAX - attempts),
    locked: attempts >= MAX
  };
}

function resetFailedAttempts() {
  sessionStorage.removeItem('hc_login_attempts');
}

function saveSession(user) {
  const session = {
    user,
    loginTime: Date.now(),
    expiresAt: Date.now() + (60 * 60 * 1000) // ساعة
  };
  sessionStorage.setItem('hc_session', JSON.stringify(session));
  localStorage.setItem('hc_currentUser', JSON.stringify(user));
}

function generateToken(userId) {
  return btoa(userId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

  /* ═══════════════════════════════════════════════
     7. حماية الصفحات (Route Guards)
     ═══════════════════════════════════════════════ */

  function requireAuth(redirectTo = 'index.html') {
    if (!isLoggedIn()) {
      if (typeof Notifier !== 'undefined') {
        Notifier.warning('يجب تسجيل الدخول أولاً', 3000);
      }
      setTimeout(() => {
        window.location.href = redirectTo;
      }, 1500);
      return false;
    }
    return true;
  }

  function requireRole(roles, redirectTo = 'dashboard.html') {
    const user = getCurrentUser();
    if (!user || !roles.includes(user.role)) {
      if (typeof Notifier !== 'undefined') {
        Notifier.error('ليس لديك صلاحية للوصول لهذه الصفحة', 3000);
      }
      setTimeout(() => {
        window.location.href = redirectTo;
      }, 1500);
      return false;
    }
    return true;
  }

  function requireAdmin(redirectTo = 'dashboard.html') {
    return requireRole(['admin'], redirectTo);
  }

  /* ═══════════════════════════════════════════════
     8. تحديث بيانات المستخدم
     ═══════════════════════════════════════════════ */

  function updateCurrentUser(updates) {
    const user = getCurrentUser();
    if (!user) return null;

    const updated = { ...user, ...updates };
    setSession(updated);

    // تحديث في قائمة المستخدمين أيضاً
    let users = [];
    try {
      users = JSON.parse(localStorage.getItem(CFG.USERS_KEY) || '[]');
    } catch (e) {}
    const idx = users.findIndex(u => u.email === user.email);
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...updates };
      localStorage.setItem(CFG.USERS_KEY, JSON.stringify(users));
    }

    return updated;
  }

  function changePassword(currentPassword, newPassword) {
    const user = getCurrentUser();
    if (!user) return { success: false, message: 'يجب تسجيل الدخول أولاً' };

    let users = [];
    try {
      users = JSON.parse(localStorage.getItem(CFG.USERS_KEY) || '[]');
    } catch (e) {}

    const dbUser = users.find(u => u.email === user.email);
    if (!dbUser) return { success: false, message: 'المستخدم غير موجود' };

    const valid = dbUser.salt
      ? verifyPassword(currentPassword, dbUser.salt, dbUser.password)
      : dbUser.password === currentPassword;

    if (!valid) return { success: false, message: 'كلمة المرور الحالية غير صحيحة' };

    const salt = generateSalt();
    dbUser.salt = salt;
    dbUser.password = hashPassword(newPassword, salt);
    localStorage.setItem(CFG.USERS_KEY, JSON.stringify(users));

    return { success: true, message: 'تم تغيير كلمة المرور بنجاح' };
  }

  /* ═══════════════════════════════════════════════
     9. مراقبة الجلسة (Session Monitor)
     ═══════════════════════════════════════════════ */

function startSessionMonitor() {
  // ── حماية من التشغيل المتكرر ──
  if (window.__sessionMonitorActive) return;
  window.__sessionMonitorActive = true;

  const LOGIN_PATHS = ['index.html', 'login.html'];
  const isLoginPage = () => LOGIN_PATHS.some(p => window.location.pathname.includes(p));

  // ── التحقق من توفر الدوال الأساسية ──
  if (typeof getSession !== 'function' || typeof clearSession !== 'function') {
    console.warn('⚠️ نظام الجلسات غير متوفر');
    return;
  }

  // ═══════════════════════════════════════════════
  // 1. مراقبة انتهاء الجلسة (كل دقيقة)
  // ═══════════════════════════════════════════════
  const monitorInterval = setInterval(() => {
    const session = getSession();

    // الخطأ الأصلي: كان يُنبّه ويُحوّل حتى لو كان المستخدم في صفحة الدخول أصلاً
    if (!session && !isLoginPage()) {
      clearSession();

      if (typeof Notifier !== 'undefined') {
        Notifier.warning('انتهت الجلسة. سيتم تحويلك إلى صفحة تسجيل الدخول...', 5000);
      }

      setTimeout(() => {
        if (!isLoginPage()) {
          window.location.href = 'index.html';
        }
      }, 3000);
    }
  }, 60000);

  // ═══════════════════════════════════════════════
  // 2. تجديد الجلسة عند النشاط (مع خنق زمني)
  // ═══════════════════════════════════════════════
  let activityTimer;
  let lastRenewal = 0;
  const RENEW_COOLDOWN = 60000; // دقيقة واحدة بين كل تجديد

  const tryRenewSession = () => {
    // التحقق من توفر الدوال قبل الاستخدام
    if (typeof isLoggedIn !== 'function' || 
        typeof getTimeRemaining !== 'function' || 
        typeof renewSession !== 'function') {
      return;
    }

    if (!isLoggedIn()) return;

    const remaining = getTimeRemaining();
    const now = Date.now();

    // جدّد فقط إذا بقي أقل من 30 دقيقة ومرت دقيقة على آخر تجديد
    if (remaining < 30 * 60 * 1000 && (now - lastRenewal) > RENEW_COOLDOWN) {
      try {
        renewSession();
        lastRenewal = now;
        console.log('🔄 تم تجديد الجلسة تلقائياً');
      } catch (e) {
        console.error('❌ فشل تجديد الجلسة:', e);
      }
    }
  };

  const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
  events.forEach(evt => {
    document.addEventListener(evt, () => {
      clearTimeout(activityTimer);
      // الخطأ الأصلي: التجديد كان يحصل بعد 5 ثوانٍ من آخر نشاط (debounce)
      // المشكلة: إذا استمر المستخدم بالنشاط لساعات، قد تنتهي الجلسة قبل التجديد!
      // الحل: نفّذ التجديد بعد ثبات قصير (5 ثوانٍ) مع تسجيل وقت آخر محاولة
      activityTimer = setTimeout(tryRenewSession, 5000);
    }, { passive: true });
  });

  // ── تنظيف الموارد عند مغادرة الصفحة ──
  window.addEventListener('beforeunload', () => {
    clearInterval(monitorInterval);
    clearTimeout(activityTimer);
  });
}

  /* ═══════════════════════════════════════════════
     10. التهيئة
     ═══════════════════════════════════════════════ */

  function init() {
    // تشفير كلمات المرور القديمة (migration)
    let users = [];
    try {
      users = JSON.parse(localStorage.getItem(CFG.USERS_KEY) || '[]');
    } catch (e) {}

    let migrated = false;
    users = users.map(u => {
      if (!u.salt) {
        migrated = true;
        const salt = generateSalt();
        return { ...u, salt, password: hashPassword(u.password, salt) };
      }
      return u;
    });

    if (migrated) {
      localStorage.setItem(CFG.USERS_KEY, JSON.stringify(users));
      console.log('🔐 تم تشفير كلمات المرور القديمة');
    }

    startSessionMonitor();
    console.log('🔐 Auth system initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ═══════════════════════════════════════════════
     11. الواجهة البرمجية العامة
     ═══════════════════════════════════════════════ */

  return {
    // Constants
    CFG,
    ROLE_MAP,
    PERMISSIONS,

    // Session
    getSession,
    getCurrentUser,
    isLoggedIn,
    getTimeRemaining,
    renewSession,
    logout,

    // Login/Auth
    login,
    changePassword,
    updateCurrentUser,

    // Permissions
    hasPermission,
    canViewComplaint,
    canEditComplaint,
    canDeleteComplaint,
    canReplyToComplaint,
    canExport,
    getRoleLabel,
    getRoleLevel,

    // Guards
    requireAuth,
    requireRole,
    requireAdmin,

    // Lockout
    isLockedOut,
    getAttempts,
    resetAttempts,

    // Crypto helpers
    hashPassword,
    verifyPassword,
    generateToken,
    verifyToken,
    generateSalt
  };

})();

// Global access
if (typeof window !== 'undefined') {
  window.Auth = Auth;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Auth };
}