/**
 * ═══════════════════════════════════════════════════════════════
 *  utils.js — الأدوات المساعدة | نظام الشكاوى الإلكتروني
 *  مركز القلب والقسطرة القلبية — الجمهورية اليمنية
 *  استشاري التصميم والتطوير الطبي: د/ صلاح الأهدل
 *  الإصدار: 2.0 — 2026
 * ═══════════════════════════════════════════════════════════════
 * 
 *  الوظائف:
 *  • تنسيق التاريخ والوقت (هجري + ميلادي)
 *  • تحويل الأرقام العربية/الإنجليزية
 *  • حماية XSS (escape HTML)
 *  • Debounce / Throttle
 *  • LocalStorage helper آمن
 *  • التحقق من صحة البيانات (Validation)
 *  • تنسيق حجم الملفات
 *  • توليد معرفات فريدة (UUID)
 *  • دوال Promise مساعدة
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const Utils = (() => {

  /* ═══════════════════════════════════════════════
     1. تنسيق التاريخ والوقت
     ═══════════════════════════════════════════════ */

  const MONTHS_AR = [
    'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];

  const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  /**
   * تنسيق تاريخ إلى نص عربي
   */
  function formatDate(dateInput, options = {}) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d)) return '—';

    const defaults = {
      weekday: false,
      year: true,
      month: 'long',   // 'long' | 'short' | 'numeric'
      day: true,
      time: false,
      relative: false  // "منذ 3 ساعات"
    };
    const opts = { ...defaults, ...options };

    // Relative time
    if (opts.relative) {
      return timeAgo(d);
    }

    const parts = [];
    if (opts.weekday) parts.push(DAYS_AR[d.getDay()]);
    if (opts.day) parts.push(d.getDate());
    if (opts.month === 'long') parts.push(MONTHS_AR[d.getMonth()]);
    else if (opts.month === 'short') parts.push(MONTHS_AR[d.getMonth()].substring(0, 3));
    else if (opts.month === 'numeric') parts.push(d.getMonth() + 1);
    if (opts.year) parts.push(d.getFullYear());

    let result = parts.join(' ');
    if (opts.time) {
      result += ' ' + formatTime(d);
    }
    return result;
  }

  /**
   * تنسيق الوقت فقط
   */
  function formatTime(dateInput) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d)) return '—';
    return d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  /**
   * "منذ X دقيقة/ساعة/يوم"
   */
  function timeAgo(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'الآن';
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    if (diffHour < 24) return `منذ ${diffHour} ساعة`;
    if (diffDay < 7) return `منذ ${diffDay} يوم`;
    if (diffDay < 30) return `منذ ${Math.floor(diffDay / 7)} أسبوع`;
    if (diffDay < 365) return `منذ ${Math.floor(diffDay / 30)} شهر`;
    return `منذ ${Math.floor(diffDay / 365)} سنة`;
  }

  /**
   * تاريخ اليوم بصيغة YYYY-MM-DD
   */
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * تاريخ ووقت كامل ISO
   */
  function nowISO() {
    return new Date().toISOString();
  }

  /* ═══════════════════════════════════════════════
     2. تحويل الأرقام
     ═══════════════════════════════════════════════ */

  const ARABIC_NUMS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const ENGLISH_NUMS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

  function toArabicNums(str) {
    if (str == null) return '';
    return String(str).replace(/[0-9]/g, w => ARABIC_NUMS[+w]);
  }

  function toEnglishNums(str) {
    if (str == null) return '';
    return String(str).replace(/[٠-٩]/g, w => ENGLISH_NUMS[ARABIC_NUMS.indexOf(w)]);
  }

  /* ═══════════════════════════════════════════════
     3. حماية XSS
     ═══════════════════════════════════════════════ */

  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"'\/]/g, s => HTML_ESCAPE_MAP[s]);
  }

  function stripHtml(str) {
    if (str == null) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = str;
    return tmp.textContent || tmp.innerText || '';
  }

  function truncate(str, length = 100, suffix = '...') {
    if (!str || str.length <= length) return str;
    return str.substring(0, length).trim() + suffix;
  }

  /* ═══════════════════════════════════════════════
     4. Debounce / Throttle
     ═══════════════════════════════════════════════ */

  function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function throttle(fn, limit = 300) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /* ═══════════════════════════════════════════════
     5. LocalStorage Helper (آمن)
     ═══════════════════════════════════════════════ */

  const Storage = {
    get(key, defaultValue = null) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    },

    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('⚠️ LocalStorage full:', e);
        return false;
      }
    },

    remove(key) {
      localStorage.removeItem(key);
    },

    clear() {
      localStorage.clear();
    },

    has(key) {
      return localStorage.getItem(key) !== null;
    },

    // SessionStorage
    session: {
      get(key, defaultValue = null) {
        try {
          const item = sessionStorage.getItem(key);
          return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
          return defaultValue;
        }
      },
      set(key, value) {
        try {
          sessionStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch (e) {
          return false;
        }
      },
      remove(key) {
        sessionStorage.removeItem(key);
      }
    }
  };

  /* ═══════════════════════════════════════════════
     6. التحقق من صحة البيانات (Validation)
     ═══════════════════════════════════════════════ */

  const Validator = {
    email(value) {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return re.test(String(value).toLowerCase());
    },

    phone(value) {
      const re = /^(\+?967|0)?7[0-9]{8}$/;
      return re.test(String(value).replace(/\s/g, ''));
    },

    required(value) {
      return value != null && String(value).trim().length > 0;
    },

    minLength(value, min) {
      return String(value).length >= min;
    },

    maxLength(value, max) {
      return String(value).length <= max;
    },

    numeric(value) {
      return !isNaN(parseFloat(value)) && isFinite(value);
    },

    url(value) {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },

    date(value) {
      const d = new Date(value);
      return !isNaN(d);
    },

    yemeniID(value) {
      // رقم البطاقة الشخصية اليمنية
      return /^\d{9}$/.test(value);
    }
  };

  /* ═══════════════════════════════════════════════
     7. تنسيق حجم الملفات
     ═══════════════════════════════════════════════ */

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 بايت';
    const k = 1024;
    const sizes = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /* ═══════════════════════════════════════════════
     8. توليد معرفات فريدة
     ═══════════════════════════════════════════════ */

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function shortId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /* ═══════════════════════════════════════════════
     9. Promise Helpers
     ═══════════════════════════════════════════════ */

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function retry(fn, maxAttempts = 3, delayMs = 1000) {
    return new Promise(async (resolve, reject) => {
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const result = await fn();
          resolve(result);
          return;
        } catch (e) {
          if (i === maxAttempts - 1) {
            reject(e);
            return;
          }
          await delay(delayMs);
        }
      }
    });
  }

  /* ═══════════════════════════════════════════════
     10. Array/Object Helpers
     ═══════════════════════════════════════════════ */

  function groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key];
      result[group] = result[group] || [];
      result[group].push(item);
      return result;
    }, {});
  }

  function sortBy(array, key, order = 'desc') {
    return [...array].sort((a, b) => {
      const valA = a[key];
      const valB = b[key];
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function uniqueBy(array, key) {
    const seen = new Set();
    return array.filter(item => {
      const val = item[key];
      if (seen.has(val)) return false;
      seen.add(val);
      return true;
    });
  }

  /* ═══════════════════════════════════════════════
     11. Color Helpers
     ═══════════════════════════════════════════════ */

  function getStatusColor(status) {
    const colors = {
      pending: '#FF6B35',
      'in-progress': '#00F3FF',
      resolved: '#39FF14',
      closed: '#8a9bb0',
      rejected: '#FF073A'
    };
    return colors[status] || '#8a9bb0';
  }

  function getPriorityColor(priority) {
    const colors = {
      urgent: '#FF073A',
      high: '#FF073A',
      medium: '#FF6B35',
      low: '#39FF14'
    };
    return colors[priority] || '#8a9bb0';
  }

  /* ═══════════════════════════════════════════════
     12. Copy to Clipboard
     ═══════════════════════════════════════════════ */

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  }

  /* ═══════════════════════════════════════════════
     13. Detect Device / Browser
     ═══════════════════════════════════════════════ */

  function getDeviceInfo() {
    const ua = navigator.userAgent;
    return {
      isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua),
      isIOS: /iPad|iPhone|iPod/.test(ua),
      isAndroid: /Android/.test(ua),
      isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      isOnline: navigator.onLine,
      language: navigator.language,
      platform: navigator.platform
    };
  }

  /* ═══════════════════════════════════════════════
     14. الواجهة البرمجية العامة
     ═══════════════════════════════════════════════ */

  return {
    // Date/Time
    formatDate,
    formatTime,
    timeAgo,
    todayISO,
    nowISO,

    // Numbers
    toArabicNums,
    toEnglishNums,

    // Security
    escapeHtml,
    stripHtml,
    truncate,

    // Performance
    debounce,
    throttle,

    // Storage
    Storage,

    // Validation
    Validator,

    // Formatting
    formatFileSize,

    // IDs
    uuid,
    shortId,

    // Promise
    delay,
    retry,

    // Array/Object
    groupBy,
    sortBy,
    uniqueBy,

    // Colors
    getStatusColor,
    getPriorityColor,

    // Utilities
    copyToClipboard,
    getDeviceInfo
  };

})();

// Global access
if (typeof window !== 'undefined') {
  window.Utils = Utils;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Utils };
}