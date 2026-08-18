/**
 * ═══════════════════════════════════════════════════════════════
 *  db.js — قاعدة البيانات المحلية | نظام الشكاوى الإلكتروني
 *  مركز القلب والقسطرة القلبية — الجمهورية اليمنية
 *  استشاري التصميم والتطوير الطبي: د/ صلاح الأهدل
 *  الإصدار: 2.0 — 2026
 * ═══════════════════════════════════════════════════════════════
 * 
 *  الوظائف الرئيسية:
 *  • IndexedDB لتخزين الشكاوى والمرفقات والمستخدمين
 *  • localStorage كـ fallback للجلسات والإعدادات
 *  • العمل الكامل Offline بدون إنترنت
 *  • تصدير/استيراد JSON للنسخ الاحتياطي
 *  • بحث متقدم وفلترة الشكاوى
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. الثوابت والإعدادات
   ═══════════════════════════════════════════════════════════════ */
const DB_CONFIG = Object.freeze({
  DB_NAME: 'HeartCenterComplaintsDB',
  DB_VERSION: 1,
  STORES: {
    USERS: 'users',
    COMPLAINTS: 'complaints',
    ATTACHMENTS: 'attachments',
    LOGS: 'logs',
    SETTINGS: 'settings'
  },
  KEYS: {
    SESSION: 'hc_session',
    CURRENT_USER: 'hc_currentUser',
    USERS: 'hc_users',
    COMPLAINTS: 'hc_complaints',
    LAST_SYNC: 'hc_lastSync',
    SETTINGS: 'hc_settings'
  }
});

/* ═══════════════════════════════════════════════════════════════
   2. فئة قاعدة البيانات الرئيسية (IndexedDB)
   ═══════════════════════════════════════════════════════════════ */
class ComplaintsDB {
  constructor() {
    this.db = null;
    this.isReady = false;
    this.initPromise = null;
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
        // Fallback إلى localStorage
        this.isReady = false;
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isReady = true;
        console.log('✅ IndexedDB جاهزة:', DB_CONFIG.DB_NAME);
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // مخزن المستخدمين
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.USERS)) {
          const usersStore = db.createObjectStore(DB_CONFIG.STORES.USERS, { keyPath: 'email' });
          usersStore.createIndex('role', 'role', { unique: false });
          usersStore.createIndex('name', 'name', { unique: false });
        }

        // مخزن الشكاوى
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.COMPLAINTS)) {
          const compStore = db.createObjectStore(DB_CONFIG.STORES.COMPLAINTS, { keyPath: 'id', autoIncrement: true });
          compStore.createIndex('status', 'status', { unique: false });
          compStore.createIndex('priority', 'priority', { unique: false });
          compStore.createIndex('email', 'email', { unique: false });
          compStore.createIndex('date', 'date', { unique: false });
          compStore.createIndex('category', 'category', { unique: false });
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
     3. إدارة المستخدمين (Users)
     ═══════════════════════════════════════════════════════════ */

  /**
   * الحصول على جميع المستخدمين
   */
  async getAllUsers() {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.USERS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.USERS);
      return await store.getAll();
    } catch (e) {
      // Fallback
      return JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.USERS) || '[]');
    }
  }

  /**
   * الحصول على مستخدم بالبريد
   */
  async getUserByEmail(email) {
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
   * إضافة/تحديث مستخدم
   */
  async saveUser(user) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.USERS, 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.USERS);
      await store.put(user);
      // Sync to localStorage for quick access
      this.syncUsersToLocal();
      return user;
    } catch (e) {
      // Fallback
      let users = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.USERS) || '[]');
      const idx = users.findIndex(u => u.email === user.email);
      if (idx >= 0) users[idx] = user;
      else users.push(user);
      localStorage.setItem(DB_CONFIG.KEYS.USERS, JSON.stringify(users));
      return user;
    }
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
      this.syncUsersToLocal();
      return true;
    } catch (e) {
      let users = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.USERS) || '[]');
      users = users.filter(u => u.email !== email);
      localStorage.setItem(DB_CONFIG.KEYS.USERS, JSON.stringify(users));
      return true;
    }
  }

  /**
   * مزامنة المستخدمين إلى localStorage (للتوافق مع الصفحات الأخرى)
   */
  async syncUsersToLocal() {
    try {
      const users = await this.getAllUsers();
      localStorage.setItem(DB_CONFIG.KEYS.USERS, JSON.stringify(users));
    } catch (e) {}
  }

  /* ═══════════════════════════════════════════════════════════
     4. إدارة الشكاوى (Complaints)
     ═══════════════════════════════════════════════════════════ */

  /**
   * الحصول على جميع الشكاوى
   */
  async getAllComplaints() {
    try {
      await this.ensureReady();
      const tx = this.db.transaction(DB_CONFIG.STORES.COMPLAINTS, 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.COMPLAINTS);
      const complaints = await store.getAll();
      // Sort by date descending
      return complaints.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    } catch (e) {
      return JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
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
      return await store.get(Number(id));
    } catch (e) {
      const complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      return complaints.find(c => c.id === Number(id)) || null;
    }
  }

  /**
   * إضافة شكوى جديدة
   */
  async addComplaint(complaint) {
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
        attachments: complaint.attachments || []
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

      await this.syncComplaintsToLocal();
      return newComplaint;
    } catch (e) {
      // Fallback
      let complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      const newId = complaints.length > 0 ? Math.max(...complaints.map(c => c.id)) + 1 : 1;
      const newComplaint = { ...complaint, id: newId, createdAt: Date.now(), updatedAt: Date.now() };
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

      const updated = { ...existing, ...updates, updatedAt: Date.now() };
      await store.put(updated);

      await this.addLog({
        complaintId: Number(id),
        action: 'UPDATE',
        user: updates.updatedBy || 'غير معروف',
        timestamp: Date.now(),
        details: `تم تحديث الشكوى #${id}`
      });

      await this.syncComplaintsToLocal();
      return updated;
    } catch (e) {
      let complaints = JSON.parse(localStorage.getItem(DB_CONFIG.KEYS.COMPLAINTS) || '[]');
      const idx = complaints.findIndex(c => c.id === Number(id));
      if (idx >= 0) {
        complaints[idx] = { ...complaints[idx], ...updates, updatedAt: Date.now() };
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

    // إذا كانت الحالة معلقة، نغيرها تلقائياً إلى قيد المعالجة
    const updates = { replies };
    if (complaint.status === 'pending') {
      updates.status = 'in-progress';
    }

    return await this.updateComplaint(complaintId, updates);
  }

  /**
   * حذف شكوى
   */
  async deleteComplaint(id) {
    try {
      await this.ensureReady();
      const tx = this.db.transaction([DB_CONFIG.STORES.COMPLAINTS, DB_CONFIG.STORES.ATTACHMENTS], 'readwrite');

      // حذف المرفقات المرتبطة
      const attStore = tx.objectStore(DB_CONFIG.STORES.ATTACHMENTS);
      const attIndex = attStore.index('complaintId');
      const attachments = await attIndex.getAll(Number(id));
      for (const att of attachments) {
        await attStore.delete(att.id);
      }

      // حذف الشكوى
      const compStore = tx.objectStore(DB_CONFIG.STORES.COMPLAINTS);
      await compStore.delete(Number(id));

      await this.addLog({
        complaintId: Number(id),
        action: 'DELETE',
        user: 'مدير النظام',
        timestamp: Date.now(),
        details: `تم حذف الشكوى #${id}`
      });

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
      const complaints = await this.getAllComplaints();
      localStorage.setItem(DB_CONFIG.KEYS.COMPLAINTS, JSON.stringify(complaints));
    } catch (e) {}
  }

  /* ═══════════════════════════════════════════════════════════
     5. البحث والفلترة المتقدمة
     ═══════════════════════════════════════════════════════════ */

  /**
   * بحث متقدم في الشكاوى
   * @param {Object} filters - { search, status, priority, category, dateFrom, dateTo, email }
   */
  async searchComplaints(filters = {}) {
    let complaints = await this.getAllComplaints();

    if (filters.search) {
      const q = filters.search.toLowerCase();
      complaints = complaints.filter(c => 
        (c.title || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.submitter || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q)
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

    return complaints;
  }

  /**
   * إحصائيات سريعة
   */
  async getStats() {
    const complaints = await this.getAllComplaints();
    return {
      total: complaints.length,
      pending: complaints.filter(c => c.status === 'pending').length,
      inProgress: complaints.filter(c => c.status === 'in-progress').length,
      resolved: complaints.filter(c => c.status === 'resolved').length,
      closed: complaints.filter(c => c.status === 'closed').length,
      urgent: complaints.filter(c => c.priority === 'urgent' || c.priority === 'high').length
    };
  }

  /* ═══════════════════════════════════════════════════════════
     6. إدارة المرفقات (Attachments)
     ═══════════════════════════════════════════════════════════ */

  /**
   * حفظ مرفق (Blob)
   */
  async saveAttachment(complaintId, file) {
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
            data: reader.result, // ArrayBuffer
            uploadedAt: Date.now()
          };

          const tx = this.db.transaction(DB_CONFIG.STORES.ATTACHMENTS, 'readwrite');
          const store = tx.objectStore(DB_CONFIG.STORES.ATTACHMENTS);
          const id = await store.add(attachment);
          resolve({ ...attachment, id });
        };
        reader.onerror = reject;
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
    const blob = new Blob([buffer], { type });
    return URL.createObjectURL(blob);
  }

  /* ═══════════════════════════════════════════════════════════
     7. سجل الأحداث (Audit Logs)
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
     8. التصدير والاستيراد (Backup & Restore)
     ═══════════════════════════════════════════════════════════ */

  /**
   * تصدير جميع البيانات كـ JSON
   */
  async exportAll() {
    const data = {
      exportedAt: new Date().toISOString(),
      version: '2.0',
      users: await this.getAllUsers(),
      complaints: await this.getAllComplaints(),
      settings: await this.getSettings()
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * استيراد البيانات من JSON
   */
  async importAll(jsonString) {
    try {
      const data = JSON.parse(jsonString);

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
      return true;
    } catch (e) {
      console.error('❌ فشل استيراد البيانات:', e);
      return false;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     9. الإعدادات (Settings)
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

      // Sync to localStorage
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
     10. بيانات تجريبية (Seed Data)
     ═══════════════════════════════════════════════════════════ */

  async seedDemoData() {
    const users = await this.getAllUsers();
    if (users.length > 0) return; // لا تكرر إذا كان هناك بيانات

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
        createdAt: Date.now() - 86400000 * 8,
        updatedAt: Date.now() - 86400000 * 5
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
        createdAt: Date.now() - 86400000 * 11,
        updatedAt: Date.now() - 86400000 * 9
      }
    ];

    for (const complaint of demoComplaints) {
      await this.addComplaint(complaint);
    }

    console.log('✅ تم إضافة البيانات التجريبية بنجاح');
  }

  /* ═══════════════════════════════════════════════════════════
     11. مسح قاعدة البيانات (Reset)
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
      // Clear localStorage too
      localStorage.removeItem(DB_CONFIG.KEYS.USERS);
      localStorage.removeItem(DB_CONFIG.KEYS.COMPLAINTS);
      localStorage.removeItem(DB_CONFIG.KEYS.SETTINGS);
      return true;
    } catch (e) {
      return false;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   12. تصدير نسخة عامة (Singleton)
   ═══════════════════════════════════════════════════════════════ */

const DB = new ComplaintsDB();

// Auto-init on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    await DB.seedDemoData();
  });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ComplaintsDB, DB, DB_CONFIG };
}