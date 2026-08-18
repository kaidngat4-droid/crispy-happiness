/**
 * ═══════════════════════════════════════════════════════════════
 *  db.js — قاعدة البيانات المحلية | نظام الشكاوى الإلكتروني
 *  مركز القلب والقسطرة القلبية — الجمهورية اليمنية
 *  استشاري التصميم والتطوير الطبي: د/ صلاح الأهدل
 *  الإصدار: 3.0 — 2026
 * ═══════════════════════════════════════════════════════════════
 * 
 *  الوظائف الرئيسية:
 *  • IndexedDB لتخزين الشكاوى والمرفقات والمستخدمين
 *  • localStorage كـ fallback للجلسات والإعدادات
 *  • العمل الكامل Offline بدون إنترنت
 *  • تصدير/استيراد JSON للنسخ الاحتياطي
 *  • بحث متقدم وفلترة الشكاوى
 *  • تشفير كلمات المرور (SHA-256 + Salt)
 *  • نظام صلاحيات متقدم (RBAC)
 *  • صفحات متجزئة (Pagination)
 *  • التحقق من صحة البيانات
 *  • نظام SLA للتتبع
 *  • ذكاء التخزين المؤقت (Smart Cache)
 *  • طابور العمليات دون اتصال (Offline Queue)
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. الثوابت والإعدادات
   ═══════════════════════════════════════════════════════════════ */
const DB_CONFIG = Object.freeze({
  DB_NAME: 'HeartCenterComplaintsDB',
  DB_VERSION: 2,
  STORES: {
    USERS: 'users',
    COMPLAINTS: 'complaints',
    ATTACHMENTS: 'attachments',
    LOGS: 'logs',
    SETTINGS: 'settings',
    NOTIFICATIONS: 'notifications',
    OFFLINE_QUEUE: 'offlineQueue'
  },
  KEYS: {
    SESSION: 'hc_session',
    CURRENT_USER: 'hc_currentUser',
    USERS: 'hc_users',
    COMPLAINTS: 'hc_complaints',
    LAST_SYNC: 'hc_lastSync',
    SETTINGS: 'hc_settings',
    NOTIFICATIONS: 'hc_notifications'
  },
  LIMITS: {
    MAX_ATTACHMENT_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_ATTACHMENT_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    MAX_COMPLAINTS_PER_PAGE: 20,
    CACHE_TTL: 60000, // 1 دقيقة
    AUTO_BACKUP_INTERVAL: 86400000 // 24 ساعة
  },
  ROLES: Object.freeze({
    ADMIN: { level: 4, label: 'مدير النظام', permissions: ['*'] },
    DOCTOR: { level: 3, label: 'طبيب', permissions: ['read', 'update', 'reply', 'view_stats'] },
    NURSE: { level: 2, label: 'ممرض', permissions: ['read', 'reply', 'view_stats'] },
    PATIENT: { level: 1, label: 'مريض', permissions: ['create', 'read_own', 'update_own'] }
  }),
  SLA_TARGETS: Object.freeze({
    URGENT: 2,    // ساعتين
    HIGH: 24,     // 24 ساعة
    MEDIUM: 72,   // 3 أيام
    LOW: 168      // أسبوع
  })
});

/* ═══════════════════════════════════════════════════════════════
   2. أدوات مساعدة (Utilities)
   ═══════════════════════════════════════════════════════════════ */
class DBError extends Error {
  constructor(code, message, original = null) {
    super(message);
    this.name = 'DBError';
    this.code = code;
    this.original = original;
    this.timestamp = Date.now();
    this.arabicMessage = message;
  }
}

class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const Utils = {
  /**
   * تشفير كلمة المرور باستخدام SHA-256 + Salt
   */
  async hashPassword(password, salt = 'HeartCenter2026') {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },

  /**
   * التحقق من كلمة المرور
   */
  async verifyPassword(password, hash) {
    const hashed = await this.hashPassword(password);
    return hashed === hash;
  },

  /**
   * توليد معرف فريد
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * التحقق من صحة البريد الإلكتروني
   */
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  /**
   * التحقق من صحة رقم الهاتف اليمني
   */
  isValidYemeniPhone(phone) {
    return /^(7[0-9]{8}|01[0-9]{8})$/.test(phone);
  },

  /**
   * حساب الوقت المتبقي لـ SLA
   */
  calculateSLA(priority, createdAt) {
    const hours = DB_CONFIG.SLA_TARGETS[priority?.toUpperCase()] || DB_CONFIG.SLA_TARGETS.LOW;
    const deadline = new Date(createdAt).getTime() + (hours * 3600000);
    const remaining = deadline - Date.now();
    return {
      deadline,
      remaining,
      hoursRemaining: Math.ceil(remaining / 3600000),
      isOverdue: remaining < 0,
      targetHours: hours
    };
  },

  /**
   * تنسيق التاريخ العربي
   */
  formatArabicDate(date) {
    return new Date(date).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * ضغط بيانات JSON
   */
  compressJSON(data) {
    try {
      return JSON.stringify(data);
    } catch (e) {
      throw new DBError('COMPRESS_ERROR', 'فشل ضغط البيانات', e);
    }
  },

  /**
   * إنشاء Blob URL من ArrayBuffer
   */
  arrayBufferToBlobUrl(buffer, type) {
    const blob = new Blob([buffer], { type });
    return URL.createObjectURL(blob);
  }
};

/* ═══════════════════════════════════════════════════════════════
   3. التحقق من صحة البيانات (Validation Schema)
   ═══════════════════════════════════════════════════════════════ */
const ValidationSchemas = {
  user: {
    email: { required: true, type: 'email', message: 'البريد الإلكتروني غير صالح' },
    password: { required: true, min: 6, max: 100, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' },
    name: { required: true, min: 2, max: 100, message: 'الاسم مطلوب' },
    role: { required: true, enum: Object.keys(DB_CONFIG.ROLES), message: 'الدور غير صالح' },
    phone: { required: false, pattern: /^(7[0-9]{8}|01[0-9]{8})$/, message: 'رقم الهاتف اليمني غير صالح' }
  },

  complaint: {
    title: { required: true, min: 5, max: 200, message: 'العنوان يجب أن يكون بين 5 و 200 حرف' },
    description: { required: true, min: 10, max: 5000, message: 'الوصف يجب أن يكون بين 10 و 5000 حرف' },
    category: { required: true, message: 'التصنيف مطلوب' },
    priority: { required: true, enum: ['low', 'medium', 'high', 'urgent'], message: 'الأولوية غير صالحة' },
    email: { required: true, type: 'email', message: 'البريد الإلكتروني مطلوب' },
    submitter: { required: true, min: 2, message: 'اسم المُرسل مطلوب' }
  },

  attachment: {
    size: { max: DB_CONFIG.LIMITS.MAX_ATTACHMENT_SIZE, message: 'حجم الملف يتجاوز 5 ميجابايت' },
    type: { enum: DB_CONFIG.LIMITS.ALLOWED_ATTACHMENT_TYPES, message: 'نوع الملف غير مسموح به' }
  }
};

class Validator {
  static validate(data, schema) {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      if (rules.required && (!value || (typeof value === 'string' && !value.trim()))) {
        errors.push({ field, message: rules.message || `${field} مطلوب` });
        continue;
      }

      if (!value) continue;

      if (rules.min && String(value).length < rules.min) {
        errors.push({ field, message: rules.message || `${field} قصير جداً` });
      }

      if (rules.max && String(value).length > rules.max) {
        errors.push({ field, message: rules.message || `${field} طويل جداً` });
      }

      if (rules.type === 'email' && !Utils.isValidEmail(value)) {
        errors.push({ field, message: rules.message || 'البريد الإلكتروني غير صالح' });
      }

      if (rules.pattern && !rules.pattern.test(String(value))) {
        errors.push({ field, message: rules.message || `${field} غير صالح` });
      }

      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field, message: rules.message || `${field} قيمة غير صالحة` });
      }
    }
    return errors;
  }
}

/* ═══════════════════════════════════════════════════════════════
   4. التخزين المؤقت الذكي (Smart Cache)
   ═══════════════════════════════════════════════════════════════ */
class SmartCache {
  constructor(ttl = DB_CONFIG.LIMITS.CACHE_TTL) {
    this.cache = new Map();
    this.ttl = ttl;
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const item = this.cache.get(key);
    if (item && Date.now() - item.time < this.ttl) {
      this.hits++;
      return item.data;
    }
    if (item) this.cache.delete(key);
    this.misses++;
    return null;
  }

  set(key, data) {
    this.cache.set(key, { data, time: Date.now() });
  }

  invalidate(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key);
    }
  }

  invalidateAll() {
    this.cache.clear();
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%',
      size: this.cache.size
    };
  }
}

/* ═══════════════════════════════════════════════════════════════
   5. نظام الإشعارات (Notifications)
   ═══════════════════════════════════════════════════════════════ */
class NotificationManager {
  constructor(db) {
    this.db = db;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      this.initialized = permission === 'granted';
    }
  }

  async notify(title, options = {}) {
    const notification = {
      id: Utils.generateId(),
      title,
      body: options.body || '',
      icon: options.icon || '/logo.png',
      tag: options.tag || Utils.generateId(),
      complaintId: options.complaintId || null,
      read: false,
      createdAt: Date.now()
    };

    // حفظ في IndexedDB
    try {
      await this.db.ensureReady();
      const tx = this.db.db.transaction(DB_CONFIG.STORES.NOTIFICATIONS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.NOTIFICATIONS);
      await store.add(notification);
    } catch (e) {
      // Fallback
      const notifications = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.NOTIFICATIONS) || '[]');
      notifications.push(notification);
      localStorage.setItem(DB_CONFIG.KEYS.NOTIFICATIONS, JSON.stringify(notifications));
    }

    // عرض إشعار نظام التشغيل
    if (this.initialized && 'Notification' in window) {
      new Notification(title, {
        body: options.body,
        icon: options.icon,
        tag: notification.tag,
        requireInteraction: options.requireInteraction || false
      });
    }

    return notification;
  }

  async getUnread() {
    try {
      await this.db.ensureReady();
      const tx = this.db.db.transaction(DB_CONFIG.STORES.NOTIFICATIONS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.NOTIFICATIONS);
      const all = await store.getAll();
      return all.filter(n => !n.read).sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) {
      const notifications = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.NOTIFICATIONS) || '[]');
      return notifications.filter(n => !n.read).sort((a, b) => b.createdAt - a.createdAt);
    }
  }

  async markAsRead(id) {
    try {
      await this.db.ensureReady();
      const tx = this.db.db.transaction(DB_CONFIG.STORES.NOTIFICATIONS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.NOTIFICATIONS);
      const notification = await store.get(id);
      if (notification) {
        notification.read = true;
        await store.put(notification);
      }
    } catch (e) {
      const notifications = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.NOTIFICATIONS) || '[]');
      const idx = notifications.findIndex(n => n.id === id);
      if (idx >= 0) notifications[idx].read = true;
      localStorage.setItem(DB_CONFIG.KEYS.NOTIFICATIONS, JSON.stringify(notifications));
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   6. طابور العمليات دون اتصال (Offline Queue)
   ═══════════════════════════════════════════════════════════════ */
class OfflineQueue {
  constructor(db) {
    this.db = db;
    this.processing = false;
    window.addEventListener('online', () => this.processQueue());
  }

  async add(action) {
    const queueItem = {
      id: Utils.generateId(),
      action,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: 3
    };

    try {
      await this.db.ensureReady();
      const tx = this.db.db.transaction(DB_CONFIG.STORES.OFFLINE_QUEUE, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.OFFLINE_QUEUE);
      await store.add(queueItem);
    } catch (e) {
      const queue = JSON.parse(localStorage.getItem('hc_offlineQueue') || '[]');
      queue.push(queueItem);
      localStorage.setItem('hc_offlineQueue', JSON.stringify(queue));
    }

    // محاولة المعالجة فوراً إذا كان متصلاً
    if (navigator.onLine) {
      await this.processQueue();
    }
  }

  async processQueue() {
    if (this.processing || !navigator.onLine) return;
    this.processing = true;

    try {
      let queue = [];
      try {
        await this.db.ensureReady();
        const tx = this.db.db.transaction(DB_CONFIG.STORES.OFFLINE_QUEUE, 'readonly');
        const store = tx.objectStore(DB_CONFIG.STORES.OFFLINE_QUEUE);
        queue = await store.getAll();
      } catch (e) {
        queue = JSON.parse(localStorage.getItem('hc_offlineQueue') || '[]');
      }

      const failed = [];
      for (const item of queue.sort((a, b) => a.timestamp - b.timestamp)) {
        try {
          await this.executeAction(item.action);
          // حذف بعد النجاح
          try {
            const tx = this.db.db.transaction(DB_CONFIG.STORES.OFFLINE_QUEUE, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.STORES.OFFLINE_QUEUE);
            await store.delete(item.id);
          } catch (e) {
            // localStorage fallback handled below
          }
        } catch (e) {
          item.retries++;
          if (item.retries < item.maxRetries) {
            failed.push(item);
          } else {
            console.error('❌ فشلت العملية بعد عدة محاولات:', item);
          }
        }
      }

      // تحديث localStorage fallback
      localStorage.setItem('hc_offlineQueue', JSON.stringify(failed));
    } finally {
      this.processing = false;
    }
  }

  async executeAction(action) {
    switch (action.type) {
      case 'ADD_COMPLAINT':
        return await this.db.addComplaint(action.data);
      case 'UPDATE_COMPLAINT':
        return await this.db.updateComplaint(action.id, action.data);
      case 'ADD_REPLY':
        return await this.db.addReply(action.complaintId, action.data);
      default:
        throw new Error(`نوع العملية غير معروف: ${action.type}`);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   7. فئة قاعدة البيانات الرئيسية (IndexedDB)
   ═══════════════════════════════════════════════════════════════ */
class ComplaintsDB {
  constructor() {
    this.db = null;
    this.isReady = false;
    this.initPromise = null;
    this.cache = new SmartCache();
    this.notifications = new NotificationManager(this);
    this.offlineQueue = new OfflineQueue(this);
    this.eventListeners = new Map();
    this.autoBackupTimer = null;
  }

  /**
   * تهيئة قاعدة البيانات وفتح الاتصال
   */
  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_CONFIG.DB_NAME, DB_CONFIG.DB_VERSION);

      request.onerror = () => {
        console.error('❌ فشل فتح IndexedDB:', request.error);
        this.isReady = false;
        reject(new DBError('DB_OPEN_FAILED', 'فشل فتح قاعدة البيانات', request.error));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isReady = true;
        console.log('✅ IndexedDB جاهزة:', DB_CONFIG.DB_NAME);
        this.startAutoBackup();
        this.notifications.init();
        resolve(this.db);
      };

      request.onblocked = () => {
        console.warn('⚠️ قاعدة البيانات محظورة — أغلق جميع التبويبات الأخرى');
        this.emit('dbBlocked', { message: 'قاعدة البيانات محظورة' });
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // مخزن المستخدمين
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.USERS)) {
          const usersStore = db.createObjectStore(DB_CONFIG.STORES.USERS, { keyPath: 'email' });
          usersStore.createIndex('role', 'role', { unique: false });
          usersStore.createIndex('name', 'name', { unique: false });
          usersStore.createIndex('department', 'department', { unique: false });
        }

        // مخزن الشكاوى
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.COMPLAINTS)) {
          const compStore = db.createObjectStore(DB_CONFIG.STORES.COMPLAINTS, { keyPath: 'id', autoIncrement: true });
          compStore.createIndex('status', 'status', { unique: false });
          compStore.createIndex('priority', 'priority', { unique: false });
          compStore.createIndex('email', 'email', { unique: false });
          compStore.createIndex('date', 'date', { unique: false });
          compStore.createIndex('category', 'category', { unique: false });
          compStore.createIndex('status_priority', ['status', 'priority'], { unique: false });
          compStore.createIndex('date_status', ['date', 'status'], { unique: false });
        }

        // مخزن المرفقات (Blobs)
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.ATTACHMENTS)) {
          const attStore = db.createObjectStore(DB_CONFIG.STORES.ATTACHMENTS, { keyPath: 'id', autoIncrement: true });
          attStore.createIndex('complaintId', 'complaintId', { unique: false });
        }

        // مخزن السجلات (للتدقيق)
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.LOGS)) {
          const logStore = db.createObjectStore(DB_CONFIG.STORES.LOGS, { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('complaintId', 'complaintId', { unique: false });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // مخزن الإعدادات
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SETTINGS)) {
          db.createObjectStore(DB_CONFIG.STORES.SETTINGS, { keyPath: 'key' });
        }

        // مخزن الإشعارات
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.NOTIFICATIONS)) {
          const notifStore = db.createObjectStore(DB_CONFIG.STORES.NOTIFICATIONS, { keyPath: 'id' });
          notifStore.createIndex('complaintId', 'complaintId', { unique: false });
          notifStore.createIndex('read', 'read', { unique: false });
        }

        // مخزن طابور العمليات دون اتصال
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.OFFLINE_QUEUE)) {
          db.createObjectStore(DB_CONFIG.STORES.OFFLINE_QUEUE, { keyPath: 'id' });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * التأكد من جاهزية قاعدة البيانات
   */
  async ensureReady() {
    if (!this.isReady || !this.db) {
      await this.init();
    }
  }

  /* ═══════════════════════════════════════════════════════════
     8. نظام الأحداث (Event Emitter)
     ═══════════════════════════════════════════════════════════ */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.eventListeners.has(event)) return;
    const listeners = this.eventListeners.get(event);
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  }

  emit(event, data) {
    if (!this.eventListeners.has(event)) return;
    this.eventListeners.get(event).forEach(cb => {
      try { cb(data); } catch (e) { console.error(e); }
    });
  }

  /* ═══════════════════════════════════════════════════════════
     9. إدارة المستخدمين (Users) — محسّنة بالتشفير
     ═══════════════════════════════════════════════════════════ */

  /**
   * الحصول على جميع المستخدمين
   */
  async getAllUsers() {
    const cacheKey = 'users:all';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.USERS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.USERS);
      const users = await store.getAll();
      this.cache.set(cacheKey, users);
      return users;
    } catch (e) {
      return JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.USERS) || '[]');
    }
  }

  /**
   * الحصول على مستخدم بالبريد
   */
  async getUserByEmail(email) {
    if (!Utils.isValidEmail(email)) {
      throw new ValidationError('email', 'البريد الإلكتروني غير صالح');
    }

    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.USERS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.USERS);
      return await store.get(email);
    } catch (e) {
      const users = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.USERS) || '[]');
      return users.find(u => u.email === email) || null;
    }
  }

  /**
   * إضافة/تحديث مستخدم — مع التحقق والتشفير
   */
  async saveUser(user) {
    // التحقق من صحة البيانات
    const errors = Validator.validate(user, ValidationSchemas.user);
    if (errors.length > 0) {
      throw new DBError('VALIDATION_ERROR', errors.map(e => e.message).join(', '));
    }

    // تشفير كلمة المرور إذا كانت نصية
    if (user.password && user.password.length < 64) {
      user.password = await Utils.hashPassword(user.password);
      user.passwordChangedAt = Date.now();
    }

    // إضافة الطوابع الزمنية
    user.updatedAt = Date.now();
    if (!user.createdAt) user.createdAt = Date.now();

    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.USERS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.USERS);
      await store.put(user);
      this.cache.invalidate('users:');
      await this.syncUsersToLocal();
      return user;
    } catch (e) {
      let users = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.USERS) || '[]');
      const idx = users.findIndex(u => u.email === user.email);
      if (idx >= 0) users[idx] = user;
      else users.push(user);
      localStorage.setItem(DB_CONFIG.KEYS.USERS, JSON.stringify(users));
      return user;
    }
  }

  /**
   * تسجيل الدخول — مع التحقق من كلمة المرور
   */
  async login(email, password) {
    const user = await this.getUserByEmail(email);
    if (!user) {
      throw new DBError('AUTH_FAILED', 'بيانات الدخول غير صحيحة');
    }

    const isValid = await Utils.verifyPassword(password, user.password);
    if (!isValid) {
      throw new DBError('AUTH_FAILED', 'بيانات الدخول غير صحيحة');
    }

    // تحديث آخر تسجيل دخول
    user.lastLogin = Date.now();
    user.loginCount = (user.loginCount || 0) + 1;
    await this.saveUser(user);

    // إنشاء جلسة
    const session = {
      email: user.email,
      role: user.role,
      name: user.name,
      loginAt: Date.now(),
      token: Utils.generateId()
    };
    localStorage.setItem(DB_CONFIG.KEYS.SESSION, JSON.stringify(session));
    localStorage.setItem(DB_CONFIG.KEYS.CURRENT_USER, JSON.stringify(user));

    return { user, session };
  }

  /**
   * التحقق من الصلاحيات (RBAC)
   */
  hasPermission(userRole, permission) {
    const role = DB_CONFIG.ROLES[userRole?.toUpperCase()];
    if (!role) return false;
    if (role.permissions.includes('*')) return true;
    return role.permissions.includes(permission);
  }

  /**
   * حذف مستخدم
   */
  async deleteUser(email) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.USERS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.USERS);
      await store.delete(email);
      this.cache.invalidate('users:');
      await this.syncUsersToLocal();
      return true;
    } catch (e) {
      let users = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.USERS) || '[]');
      users = users.filter(u => u.email !== email);
      localStorage.setItem(DB_CONFIG.KEYS.USERS, JSON.stringify(users));
      return true;
    }
  }

  /**
   * مزامنة المستخدمين إلى localStorage
   */
  async syncUsersToLocal() {
    try {
      const users = await this.getAllUsers();
      localStorage.setItem(DB_CONFIG.KEYS.USERS, JSON.stringify(users));
    } catch (e) {}
  }

  /* ═══════════════════════════════════════════════════════════
     10. إدارة الشكاوى (Complaints) — محسّنة
     ═══════════════════════════════════════════════════════════ */

  /**
   * الحصول على جميع الشكاوى مع Pagination
   */
  async getAllComplaints(page = 1, perPage = DB_CONFIG.LIMITS.MAX_COMPLAINTS_PER_PAGE) {
    const cacheKey = `complaints:all:${page}:${perPage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.COMPLAINTS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.COMPLAINTS);
      const complaints = await store.getAll();
      const sorted = complaints.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      
      const start = (page - 1) * perPage;
      const paginated = sorted.slice(start, start + perPage);
      
      const result = {
        data: paginated,
        total: sorted.length,
        pages: Math.ceil(sorted.length / perPage),
        currentPage: page,
        perPage
      };
      
      this.cache.set(cacheKey, result);
      return result;
    } catch (e) {
      const all = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      const start = (page - 1) * perPage;
      return {
        data: all.slice(start, start + perPage),
        total: all.length,
        pages: Math.ceil(all.length / perPage),
        currentPage: page,
        perPage
      };
    }
  }

  /**
   * الحصول على شكوى بالمعرف
   */
  async getComplaintById(id) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.COMPLAINTS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.COMPLAINTS);
      const complaint = await store.get(Number(id));
      
      // إضافة بيانات SLA
      if (complaint) {
        complaint.sla = Utils.calculateSLA(complaint.priority, complaint.createdAt);
      }
      
      return complaint;
    } catch (e) {
      const complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      const complaint = complaints.find(c => c.id === Number(id)) || null;
      if (complaint) {
        complaint.sla = Utils.calculateSLA(complaint.priority, complaint.createdAt);
      }
      return complaint;
    }
  }

  /**
   * إضافة شكوى جديدة — مع التحقق
   */
  async addComplaint(complaint) {
    // التحقق من صحة البيانات
    const errors = Validator.validate(complaint, ValidationSchemas.complaint);
    if (errors.length > 0) {
      throw new DBError('VALIDATION_ERROR', errors.map(e => e.message).join(', '));
    }

    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.COMPLAINTS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.COMPLAINTS);

      const newComplaint = {
        ...complaint,
        id: complaint.id || Date.now(),
        createdAt: complaint.createdAt || Date.now(),
        updatedAt: Date.now(),
        status: complaint.status || 'pending',
        replies: complaint.replies || [],
        attachments: complaint.attachments || [],
        feedback: null,
        sla: Utils.calculateSLA(complaint.priority, complaint.createdAt || Date.now())
      };

      await store.put(newComplaint);

      // تسجيل في السجل
      await this.addLog({
        complaintId: newComplaint.id,
        action: 'CREATE',
        user: complaint.submitter || 'غير معروف',
        timestamp: Date.now(),
        details: `تم إنشاء شكوى جديدة: ${complaint.title}`
      });

      // إشعار
      await this.notifications.notify('شكوى جديدة', {
        body: `${complaint.submitter} أرسل شكوى: ${complaint.title}`,
        complaintId: newComplaint.id,
        tag: `complaint-${newComplaint.id}`
      });

      this.cache.invalidate('complaints:');
      await this.syncComplaintsToLocal();
      return newComplaint;
    } catch (e) {
      if (e instanceof DBError) throw e;
      
      // Fallback
      let complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      const newId = complaints.length > 0 ? Math.max(...complaints.map(c => c.id)) + 1 : 1;
      const newComplaint = { 
        ...complaint, 
        id: newId, 
        createdAt: Date.now(), 
        updatedAt: Date.now(),
        feedback: null
      };
      complaints.unshift(newComplaint);
      localStorage.setItem(DB_CONFIG.KEYS.COMPLAINTS, JSON.stringify(complaints));
      return newComplaint;
    }
  }

  /**
   * تحديث شكوى
   */
  async updateComplaint(id, updates) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.COMPLAINTS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.COMPLAINTS);

      const existing = await store.get(Number(id));
      if (!existing) return null;

      const updated = { 
        ...existing, 
        ...updates, 
        updatedAt: Date.now(),
        sla: Utils.calculateSLA(updates.priority || existing.priority, existing.createdAt)
      };
      await store.put(updated);

      await this.addLog({
        complaintId: Number(id),
        action: 'UPDATE',
        user: updates.updatedBy || 'غير معروف',
        timestamp: Date.now(),
        details: `تم تحديث الشكوى #${id}`
      });

      this.cache.invalidate('complaints:');
      await this.syncComplaintsToLocal();
      return updated;
    } catch (e) {
      let complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      const idx = complaints.findIndex(c => c.id === Number(id));
      if (idx >= 0) {
        complaints[idx] = { 
          ...complaints[idx], 
          ...updates, 
          updatedAt: Date.now(),
          sla: Utils.calculateSLA(updates.priority || complaints[idx].priority, complaints[idx].createdAt)
        };
        localStorage.setItem(DB_CONFIG.KEYS.COMPLAINTS, JSON.stringify(complaints));
        return complaints[idx];
      }
      return null;
    }
  }

  /**
   * تحديث حالة الشكوى (للجدول السريع)
   */
  async updateStatus(id, newStatus, updatedBy = 'غير معروف') {
    const complaint = await this.getComplaintById(id);
    if (!complaint) return null;

    const oldStatus = complaint.status;
    const updated = await this.updateComplaint(id, { status: newStatus, updatedBy });

    if (updated) {
      await this.addLog({
        complaintId: Number(id),
        action: 'STATUS_CHANGE',
        user: updatedBy,
        timestamp: Date.now(),
        details: `تغيير الحالة من "${oldStatus}" إلى "${newStatus}"`
      });

      // إشعار عند الحل
      if (newStatus === 'resolved') {
        await this.notifications.notify('تم حل الشكوى', {
          body: `تم حل الشكوى #${id}: ${complaint.title}`,
          complaintId: Number(id)
        });
      }
    }
    return updated;
  }

  /**
   * إضافة رد لشكوى
   */
  async addReply(complaintId, reply) {
    const complaint = await this.getComplaintById(complaintId);
    if (!complaint) return null;

    const replies = complaint.replies || [];
    replies.push({
      ...reply,
      id: Date.now(),
      date: reply.date || new Date().toISOString().split('T')[0],
      timestamp: Date.now()
    });

    const updates = { replies };
    if (complaint.status === 'pending') {
      updates.status = 'in-progress';
    }

    return await this.updateComplaint(complaintId, updates);
  }

  /**
   * إضافة تقييم وإغلاق الشكوى
   */
  async addFeedback(complaintId, rating, comment, user = 'غير معروف') {
    if (rating < 1 || rating > 5) {
      throw new ValidationError('rating', 'التقييم يجب أن يكون بين 1 و 5');
    }

    const feedback = {
      rating,
      comment,
      user,
      date: new Date().toISOString().split('T')[0],
      timestamp: Date.now()
    };

    const updated = await this.updateComplaint(complaintId, {
      feedback,
      status: 'closed',
      updatedBy: user
    });

    if (updated) {
      await this.addLog({
        complaintId: Number(complaintId),
        action: 'FEEDBACK',
        user,
        timestamp: Date.now(),
        details: `تم إضافة تقييم ${rating}/5 للشكوى #${complaintId}`
      });
    }

    return updated;
  }

  /**
   * حذف شكوى
   */
  async deleteComplaint(id) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction([DB_CONFIG.STORES.COMPLAINTS, DB_CONFIG.STORES.ATTACHMENTS], 'readwrite');

      const attStore = tx.objectStore(DB_CONFIG.STORES.ATTACHMENTS);
      const attIndex = attStore.index('complaintId');
      const attachments = await attIndex.getAll(Number(id));
      for (const att of attachments) {
        await attStore.delete(att.id);
      }

      const compStore = tx.objectStore(DB_CONFIG.STORES.COMPLAINTS);
      await compStore.delete(Number(id));

      await this.addLog({
        complaintId: Number(id),
        action: 'DELETE',
        user: 'مدير النظام',
        timestamp: Date.now(),
        details: `تم حذف الشكوى #${id}`
      });

      this.cache.invalidate('complaints:');
      await this.syncComplaintsToLocal();
      return true;
    } catch (e) {
      let complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      complaints = complaints.filter(c => c.id !== Number(id));
      localStorage.setItem(DB_CONFIG.KEYS.COMPLAINTS, JSON.stringify(complaints));
      return true;
    }
  }

  /**
   * مزامنة الشكاوى إلى localStorage
   */
  async syncComplaintsToLocal() {
    try {
      const { data } = await this.getAllComplaints(1, 10000);
      localStorage.setItem(DB_CONFIG.KEYS.COMPLAINTS, JSON.stringify(data));
    } catch (e) {}
  }

  /* ═══════════════════════════════════════════════════════════
     11. البحث والفلترة المتقدمة — مع Pagination
     ═══════════════════════════════════════════════════════════ */

  /**
   * بحث متقدم في الشكاوى
   */
  async searchComplaints(filters = {}, page = 1, perPage = DB_CONFIG.LIMITS.MAX_COMPLAINTS_PER_PAGE) {
    const cacheKey = `search:${JSON.stringify(filters)}:${page}:${perPage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let complaints = [];
    try {
      const { data } = await this.getAllComplaints(1, 10000);
      complaints = data;
    } catch (e) {
      complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      complaints = complaints.filter(c => 
        (c.title || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.submitter || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q) ||
        (c.location || '').toLowerCase().includes(q)
      );
    }

    if (filters.status) complaints = complaints.filter(c => c.status === filters.status);
    if (filters.priority) complaints = complaints.filter(c => c.priority === filters.priority);
    if (filters.category) complaints = complaints.filter(c => c.category === filters.category);
    if (filters.email) complaints = complaints.filter(c => c.email === filters.email);

    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      complaints = complaints.filter(c => new Date(c.date) >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      complaints = complaints.filter(c => new Date(c.date) <= to);
    }

    // فلترة SLA المتأخرة
    if (filters.overdue) {
      complaints = complaints.filter(c => {
        const sla = Utils.calculateSLA(c.priority, c.createdAt);
        return sla.isOverdue && c.status !== 'resolved' && c.status !== 'closed';
      });
    }

    const total = complaints.length;
    const start = (page - 1) * perPage;
    const result = {
      data: complaints.slice(start, start + perPage),
      total,
      pages: Math.ceil(total / perPage),
      currentPage: page,
      perPage
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * إحصائيات شاملة
   */
  async getStats() {
    const cacheKey = 'stats:all';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const { data: complaints } = await this.getAllComplaints(1, 10000);
      
      const now = Date.now();
      const stats = {
        total: complaints.length,
        pending: complaints.filter(c => c.status === 'pending').length,
        inProgress: complaints.filter(c => c.status === 'in-progress').length,
        resolved: complaints.filter(c => c.status === 'resolved').length,
        closed: complaints.filter(c => c.status === 'closed').length,
        urgent: complaints.filter(c => c.priority === 'urgent' || c.priority === 'high').length,
        
        // إحصائيات SLA
        overdue: complaints.filter(c => {
          const sla = Utils.calculateSLA(c.priority, c.createdAt);
          return sla.isOverdue && c.status !== 'resolved' && c.status !== 'closed';
        }).length,
        
        // متوسط وقت الحل
        avgResolutionTime: this.calculateAvgResolutionTime(complaints),
        
        // توزيع حسب التصنيف
        byCategory: {},
        
        // توزيع حسب الشهر
        byMonth: {},
        
        // معدل الرضا
        satisfactionRate: this.calculateSatisfactionRate(complaints)
      };

      complaints.forEach(c => {
        if (c.category) {
          stats.byCategory[c.category] = (stats.byCategory[c.category] || 0) + 1;
        }
        const month = c.date?.substring(0, 7); // YYYY-MM
        if (month) {
          stats.byMonth[month] = (stats.byMonth[month] || 0) + 1;
        }
      });

      this.cache.set(cacheKey, stats);
      return stats;
    } catch (e) {
      return { total: 0, pending: 0, inProgress: 0, resolved: 0, closed: 0, urgent: 0, overdue: 0 };
    }
  }

  calculateAvgResolutionTime(complaints) {
    const resolved = complaints.filter(c => c.status === 'resolved' || c.status === 'closed');
    if (resolved.length === 0) return 0;
    
    const totalHours = resolved.reduce((sum, c) => {
      const created = new Date(c.createdAt).getTime();
      const closed = new Date(c.updatedAt).getTime();
      return sum + ((closed - created) / 3600000);
    }, 0);
    
    return Math.round(totalHours / resolved.length);
  }

  calculateSatisfactionRate(complaints) {
    const withFeedback = complaints.filter(c => c.feedback?.rating);
    if (withFeedback.length === 0) return 0;
    
    const total = withFeedback.reduce((sum, c) => sum + c.feedback.rating, 0);
    return ((total / (withFeedback.length * 5)) * 100).toFixed(1);
  }

  /* ═══════════════════════════════════════════════════════════
     12. إدارة المرفقات (Attachments) — محسّنة
     ═══════════════════════════════════════════════════════════ */

  /**
   * حفظ مرفق (Blob) — مع التحقق
   */
  async saveAttachment(complaintId, file) {
    // التحقق من المرفق
    const errors = Validator.validate({ size: file.size, type: file.type }, ValidationSchemas.attachment);
    if (errors.length > 0) {
      throw new DBError('VALIDATION_ERROR', errors.map(e => e.message).join(', '));
    }

    try {
      await this.ensureReady();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          const attachment = {
            complaintId: Number(complaintId),
            name: file.name,
            type: file.type,
            size: file.size,
            data: reader.result,
            uploadedAt: Date.now()
          };

          const tx = this.db.transaction(DB_CONFIG.STORES.ATTACHMENTS, 'readwrite');
          const store = tx.objectStore(DB_CONFIG.STORES.ATTACHMENTS);
          const id = await store.add(attachment);
          resolve({ ...attachment, id });
        };
        reader.onerror = () => reject(new DBError('FILE_READ_ERROR', 'فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
      });
    } catch (e) {
      console.warn('⚠️ فشل حفظ المرفق في IndexedDB:', e);
      return null;
    }
  }

  /**
   * الحصول على مرفقات شكوى
   */
  async getAttachments(complaintId) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.ATTACHMENTS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.ATTACHMENTS);
      const index = store.index('complaintId');
      return await index.getAll(Number(complaintId));
    } catch (e) {
      return [];
    }
  }

  /**
   * تحويل ArrayBuffer إلى Blob URL للعرض
   */
  static arrayBufferToBlobUrl(buffer, type) {
    return Utils.arrayBufferToBlobUrl(buffer, type);
  }

  /* ═══════════════════════════════════════════════════════════
     13. سجل الأحداث (Audit Logs)
     ═══════════════════════════════════════════════════════════ */

  async addLog(logEntry) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.LOGS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.LOGS);
      await store.add({
        ...logEntry,
        id: Date.now(),
        timestamp: logEntry.timestamp || Date.now()
      });
    } catch (e) {}
  }

  async getLogs(complaintId = null, limit = 100) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.LOGS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.LOGS);

      if (complaintId) {
        const index = store.index('complaintId');
        return (await index.getAll(Number(complaintId))).slice(-limit);
      }
      return (await store.getAll()).slice(-limit);
    } catch (e) {
      return [];
    }
  }

  /* ═══════════════════════════════════════════════════════════
     14. التصدير والاستيراد (Backup & Restore) — محسّن
     ═══════════════════════════════════════════════════════════ */

  /**
   * تصدير جميع البيانات كـ JSON
   */
  async exportAll() {
    const data = {
      exportedAt: new Date().toISOString(),
      version: '3.0',
      users: await this.getAllUsers(),
      complaints: (await this.getAllComplaints(1, 10000)).data,
      settings: await this.getSettings(),
      stats: await this.getStats()
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * تصدير كـ CSV
   */
  async exportToCSV() {
    const { data: complaints } = await this.getAllComplaints(1, 10000);
    const headers = ['ID', 'العنوان', 'التصنيف', 'الأولوية', 'الحالة', 'التاريخ', 'المُرسل', 'البريد', 'الموقع'];
    const rows = complaints.map(c => [
      c.id, c.title, c.category, c.priority, c.status, c.date, c.submitter, c.email, c.location
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','))].join('\n');
    return '\uFEFF' + csv; // BOM for Arabic Excel
  }

  /**
   * استيراد البيانات من JSON
   */
  async importAll(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      if (data.version && data.version !== '3.0') {
        console.warn('⚠️ إصدار مختلف للبيانات:', data.version);
      }

      if (data.users) {
        for (const user of data.users) {
          await this.saveUser(user);
        }
      }
      if (data.complaints) {
        for (const complaint of data.complaints) {
          await this.addComplaint(complaint);
        }
      }
      if (data.settings) {
        for (const [key, value] of Object.entries(data.settings)) {
          await this.setSetting(key, value);
        }
      }
      
      this.cache.invalidateAll();
      this.emit('importComplete', { count: data.complaints?.length || 0 });
      return true;
    } catch (e) {
      console.error('❌ فشل استيراد البيانات:', e);
      throw new DBError('IMPORT_FAILED', 'فشل استيراد البيانات', e);
    }
  }

  /**
   * النسخ الاحتياطي التلقائي
   */
  startAutoBackup() {
    if (this.autoBackupTimer) clearInterval(this.autoBackupTimer);
    this.autoBackupTimer = setInterval(async () => {
      try {
        const backup = await this.exportAll();
        localStorage.setItem('hc_autoBackup', backup);
        localStorage.setItem('hc_autoBackupDate', new Date().toISOString());
        console.log('✅ تم إنشاء نسخة احتياطية تلقائية');
      } catch (e) {
        console.error('❌ فشل النسخ الاحتياطي التلقائي:', e);
      }
    }, DB_CONFIG.LIMITS.AUTO_BACKUP_INTERVAL);
  }

  async restoreFromAutoBackup() {
    const backup = localStorage.getItem('hc_autoBackup');
    if (!backup) return false;
    return await this.importAll(backup);
  }

  /* ═══════════════════════════════════════════════════════════
     15. الإعدادات (Settings)
     ═══════════════════════════════════════════════════════════ */

  async getSetting(key) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.SETTINGS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.SETTINGS);
      const result = await store.get(key);
      return result ? result.value : null;
    } catch (e) {
      const settings = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.SETTINGS) || '{}');
      return settings[key] || null;
    }
  }

  async setSetting(key, value) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.SETTINGS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.SETTINGS);
      await store.put({ key, value, updatedAt: Date.now() });

      const settings = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.SETTINGS) || '{}');
      settings[key] = value;
      localStorage.setItem(DB_CONFIG.KEYS.SETTINGS, JSON.stringify(settings));
      return true;
    } catch (e) {
      const settings = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.SETTINGS) || '{}');
      settings[key] = value;
      localStorage.setItem(DB_CONFIG.KEYS.SETTINGS, JSON.stringify(settings));
      return true;
    }
  }

  async getSettings() {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.SETTINGS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.SETTINGS);
      const all = await store.getAll();
      const settings = {};
      all.forEach(s => settings[s.key] = s.value);
      return settings;
    } catch (e) {
      return JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.SETTINGS) || '{}');
    }
  }

  /* ═══════════════════════════════════════════════════════════
     16. بيانات تجريبية (Seed Data) — محسّنة
     ═══════════════════════════════════════════════════════════ */

  async seedDemoData() {
    const users = await this.getAllUsers();
    if (users.length > 0) return;

    const demoUsers = [
      { email: 'admin@heartcenter.sa', password: 'admin123', name: 'مدير النظام', role: 'admin', department: 'إدارة', phone: '770000001' },
      { email: 'doctor@heartcenter.sa', password: 'doctor123', name: 'د. أحمد القلبي', role: 'doctor', department: 'جراحة القلب', phone: '770000002' },
      { email: 'nurse@heartcenter.sa', password: 'nurse123', name: 'سارة التمريض', role: 'nurse', department: 'التمريض', phone: '770000003' },
      { email: 'patient@heartcenter.sa', password: 'patient123', name: 'محمد العمري', role: 'patient', department: '', phone: '770000004' }
    ];

    for (const user of demoUsers) {
      await this.saveUser(user);
    }

    const demoComplaints = [
      {
        id: 1,
        title: 'تأخر في موعد العملية المجدول',
        category: 'مواعيد',
        priority: 'high',
        status: 'pending',
        date: '2026-08-10',
        submitter: 'محمد العمري',
        email: 'patient@heartcenter.sa',
        phone: '770000004',
        location: 'قسم العمليات - الطابق الثالث',
        description: 'تم تأخير موعد العملية المجدول لمدة ساعتين دون إشعار مسبق. المريض في حالة انتظار منذ الساعة 8 صباحاً ولم يتم إبلاغه بأي سبب للتأخير.',
        attachments: [],
        replies: [],
        feedback: null,
        createdAt: Date.now() - 86400000 * 6,
        updatedAt: Date.now() - 86400000 * 6
      },
      {
        id: 2,
        title: 'نظافة غرفة الانتظار غير مرضية',
        category: 'نظافة',
        priority: 'medium',
        status: 'resolved',
        date: '2026-08-08',
        submitter: 'فاطمة الزهراني',
        email: 'fatima@email.com',
        phone: '770000005',
        location: 'غرفة الانتظار الرئيسية',
        description: 'غرفة الانتظار تحتاج لتنظيف دوري أفضل. الأرضيات متسخة والمقاعد تحتاج لتعقيم.',
        attachments: [],
        replies: [
          { from: 'مدير النظام', date: '2026-08-09', message: 'تم التواصل مع قسم النظافة ومعالجة الملاحظة. شكراً لك.', role: 'admin', timestamp: Date.now() - 86400000 * 5 }
        ],
        feedback: { rating: 4, comment: 'شكراً للسرعة في المعالجة', user: 'فاطمة الزهراني', date: '2026-08-10', timestamp: Date.now() - 86400000 * 4 },
        createdAt: Date.now() - 86400000 * 8,
        updatedAt: Date.now() - 86400000 * 4
      },
      {
        id: 3,
        title: 'صعوبة في حجز المواعيد أونلاين',
        category: 'تقنية',
        priority: 'high',
        status: 'in-progress',
        date: '2026-08-12',
        submitter: 'خالد السبيعي',
        email: 'khaled@email.com',
        phone: '770000006',
        location: 'الموقع الإلكتروني',
        description: 'الموقع لا يعمل بشكل صحيح عند محاولة حجز موعد جديد. تظهر رسالة خطأ 500 عند الضغط على "تأكيد الحجز".',
        attachments: [],
        replies: [
          { from: 'د. أحمد القلبي', date: '2026-08-12', message: 'نعمل على إصلاح المشكلة التقنية. سيتم إشعاركم قريباً.', role: 'doctor', timestamp: Date.now() - 86400000 * 4 }
        ],
        feedback: null,
        createdAt: Date.now() - 86400000 * 4,
        updatedAt: Date.now() - 86400000 * 4
      },
      {
        id: 4,
        title: 'نقص في أدوية القلب الأساسية',
        category: 'أدوية ومستلزمات',
        priority: 'urgent',
        status: 'pending',
        date: '2026-08-14',
        submitter: 'عبدالرحمن الحربي',
        email: 'abdurahman@email.com',
        phone: '770000007',
        location: 'صيدلية المستشفى',
        description: 'لا توجد أدوية القلب الأساسية (أسبرين، بلافيكس) في الصيدلية منذ يومين. المرضى يضطرون لشرائها من خارج المستشفى.',
        attachments: [],
        replies: [],
        feedback: null,
        createdAt: Date.now() - 86400000 * 2,
        updatedAt: Date.now() - 86400000 * 2
      },
      {
        id: 5,
        title: 'تعامل غير لائق من أحد موظفي الاستقبال',
        category: 'موظفين',
        priority: 'medium',
        status: 'in-progress',
        date: '2026-08-13',
        submitter: 'نورة الشمري',
        email: 'noura@email.com',
        phone: '770000008',
        location: 'استقبال الطوارئ',
        description: 'أحد موظفي الاستقبال (الوردية المسائية) تعامل بفظاظة مع المرضى ورفض الإجابة على استفساراتهم.',
        attachments: [],
        replies: [],
        feedback: null,
        createdAt: Date.now() - 86400000 * 3,
        updatedAt: Date.now() - 86400000 * 3
      },
      {
        id: 6,
        title: 'طول وقت الانتظار في العيادات الخارجية',
        category: 'إجراءات',
        priority: 'low',
        status: 'closed',
        date: '2026-08-05',
        submitter: 'سعد الغامدي',
        email: 'saad@email.com',
        phone: '770000009',
        location: 'العيادات الخارجية',
        description: 'الانتظار في العيادات الخارجية يصل لأكثر من 3 ساعات رغم وجود موعد مسبق.',
        attachments: [],
        replies: [
          { from: 'مدير النظام', date: '2026-08-06', message: 'تم زيادة عدد الأطباء في العيادات الخارجية وتحسين جدولة المواعيد. شكراً لملاحظتك.', role: 'admin', timestamp: Date.now() - 86400000 * 9 }
        ],
        feedback: { rating: 5, comment: 'ممتاز، تحسن كبير في الانتظار', user: 'سعد الغامدي', date: '2026-08-07', timestamp: Date.now() - 86400000 * 8 },
        createdAt: Date.now() - 86400000 * 11,
        updatedAt: Date.now() - 86400000 * 8
      }
    ];

    for (const complaint of demoComplaints) {
      await this.addComplaint(complaint);
    }

    console.log('✅ تم إضافة البيانات التجريبية بنجاح');
  }

  /* ═══════════════════════════════════════════════════════════
     17. مسح قاعدة البيانات (Reset)
     ═══════════════════════════════════════════════════════════ */

  async clearAll() {
    try {
      await this.ensureReady();
      const stores = Object.values(DB_CONFIG.STORES);
      for (const storeName of stores) {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        await store.clear();
      }
      
      localStorage.removeItem(DB_CONFIG.KEYS.USERS);
      localStorage.removeItem(DB_CONFIG.KEYS.COMPLAINTS);
      localStorage.removeItem(DB_CONFIG.KEYS.SETTINGS);
      localStorage.removeItem(DB_CONFIG.KEYS.NOTIFICATIONS);
      localStorage.removeItem('hc_autoBackup');
      localStorage.removeItem('hc_autoBackupDate');
      
      this.cache.invalidateAll();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * إغلاق الاتصال بقاعدة البيانات
   */
  close() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isReady = false;
      this.initPromise = null;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   18. تصدير نسخة عامة (Singleton)
   ═══════════════════════════════════════════════════════════════ */

const DB = new ComplaintsDB();

// Auto-init on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      await DB.init();
      await DB.seedDemoData();
    } catch (e) {
      console.error('❌ فشل تهيئة قاعدة البيانات:', e);
    }
  });

  // إغلاق نظيف عند مغادرة الصفحة
  window.addEventListener('beforeunload', () => {
    DB.close();
  });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    ComplaintsDB, 
    DB, 
    DB_CONFIG, 
    DBError, 
    ValidationError,
    Utils,
    Validator,
    SmartCache,
    NotificationManager,
    OfflineQueue
  };
}
