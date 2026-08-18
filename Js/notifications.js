/**
 * ═══════════════════════════════════════════════════════════════
 *  notifications.js — الإشعارات | نظام الشكاوى الإلكتروني
 *  مركز القلب والقسطرة القلبية — الجمهورية اليمنية
 *  استشاري التصميم والتطوير الطبي: د/ صلاح الأهدل
 *  الإصدار: 2.1 — 2026
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const Notifier = (() => {

  /* ═══════════════════════════════════════════════
     1. الثوابت (لا تتغير أبداً)
     ═══════════════════════════════════════════════ */

  const CONSTANTS = Object.freeze({
    TOAST_DURATION: 4000,
    MAX_TOASTS: 5,
    SOUNDS: {
      success: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVanu87plHQUuh9Dz2YU2Bhxqv+zplkcODVGm5O+4ZSAEMYrO89GFNwYdcfDr4ZdJDQtPp+XysWUeBjiS1/LNfi0GI33R8tOENAcdcO/r4phJDQxPp+XyxGUhBDeOzvPVhjYGH3Lw7OKbSQ0MTKjl8bllIAU2jc7z1YU1Bhxw8OzhmUgNC0+n5fK4ZSAFNo/M89CEMwYccPDs4plIDQtPp+XyuGUgBNo/M89CEMwYccPDs4plIDQtPp+XyuGUgBNo/M89CEMwYccPDs4plIDQtPp+XyuGUgBNo/M89CEMwYccPDs4plIDQtPp+XyuGUgBNo/M89CEMwYccPDs4plIDQtPp+XyuGUgBNo/M89CEMwYccPDs4plIDQ',
      error: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=',
      warning: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA='
    }
  });

  const ICONS = Object.freeze({
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle',
    newComplaint: 'fa-file-alt',
    statusChange: 'fa-sync-alt',
    reply: 'fa-reply'
  });

  /* ═══════════════════════════════════════════════
     2. الإعدادات القابلة للتغيير (Settings)
     ═══════════════════════════════════════════════ */

  const Settings = {
    SOUND_ENABLED: true,
    DESKTOP_ENABLED: true
  };

  let toastContainer = null;
  let audioCtx = null;
  let permissionGranted = false;

  /* ═══════════════════════════════════════════════
     3. تهيئة حاوية Toast
     ═══════════════════════════════════════════════ */

  function initContainer() {
    if (toastContainer) return;
    
    // استخدم العنصر الموجود إذا كان متوفراً
    toastContainer = document.getElementById('toastRegion');
    
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toastRegion';
      toastContainer.setAttribute('role', 'log');
      toastContainer.setAttribute('aria-live', 'polite');
      toastContainer.setAttribute('aria-atomic', 'false');
      toastContainer.style.cssText = `
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10001;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(90vw, 400px);
        pointer-events: none;
        direction: rtl;
      `;
      document.body.appendChild(toastContainer);
    }
  }

  /* ═══════════════════════════════════════════════
     4. Toast Notifications
     ═══════════════════════════════════════════════ */

  function toast(message, type = 'info', duration = CONSTANTS.TOAST_DURATION) {
    initContainer();

    const existing = toastContainer.querySelectorAll('.toast');
    if (existing.length >= CONSTANTS.MAX_TOASTS) {
      existing[0].remove();
    }

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    el.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      border-radius: 14px;
      font-size: 0.85rem;
      font-weight: 700;
      font-family: 'Cairo', 'Tajawal', sans-serif;
      pointer-events: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      line-height: 1.5;
      animation: toastIn 0.4s cubic-bezier(0.22,1,0.36,1);
      border: 1px solid transparent;
      direction: rtl;
    `;

    const colors = {
      success: { bg: 'rgba(57,255,20,0.1)', border: 'rgba(57,255,20,0.3)', color: '#39FF14' },
      error:   { bg: 'rgba(255,7,58,0.1)', border: 'rgba(255,7,58,0.3)', color: '#FF073A' },
      warning: { bg: 'rgba(255,107,53,0.1)', border: 'rgba(255,107,53,0.3)', color: '#FF6B35' },
      info:    { bg: 'rgba(0,243,255,0.07)', border: 'rgba(0,243,255,0.25)', color: '#00F3FF' },
      newComplaint: { bg: 'rgba(212,175,55,0.1)', border: 'rgba(212,175,55,0.3)', color: '#D4AF37' },
      statusChange: { bg: 'rgba(0,243,255,0.08)', border: 'rgba(0,243,255,0.2)', color: '#00F3FF' }
    };

    const style = colors[type] || colors.info;
    el.style.background = style.bg;
    el.style.borderColor = style.border;
    el.style.color = style.color;

    const iconClass = ICONS[type] || ICONS.info;
    el.innerHTML = `
      <i class="fas ${iconClass}" style="font-size:1.1rem;flex-shrink:0"></i>
      <span style="flex:1">${message}</span>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;cursor:pointer;padding:2px;opacity:0.6;font-size:0.8rem">
        <i class="fas fa-times"></i>
      </button>
    `;

    toastContainer.appendChild(el);

    if (Settings.SOUND_ENABLED) playSound(type);

    const timer = setTimeout(() => {
      if (el.parentElement) {
        el.style.animation = 'toastOut 0.3s ease forwards';
        el.addEventListener('animationend', () => el.remove(), { once: true });
      }
    }, duration);

    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (el.parentElement) {
          el.style.animation = 'toastOut 0.3s ease forwards';
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }
      }, 1000);
    });

    return el;
  }

  /* ═══════════════════════════════════════════════
     5. صوت التنبيه (Web Audio API)
     ═══════════════════════════════════════════════ */

  function playSound(type) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      const freqs = { success: 523, error: 200, warning: 350, info: 440 };
      oscillator.frequency.value = freqs[type] || 440;
      oscillator.type = type === 'error' ? 'sawtooth' : 'sine';

      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      // Audio blocked by browser policy
    }
  }

  /* ═══════════════════════════════════════════════
     6. Browser Notification API
     ═══════════════════════════════════════════════ */

  async function requestPermission() {
    if (!('Notification' in window)) {
      console.warn('⚠️ المتصفح لا يدعم الإشعارات');
      return false;
    }
    if (Notification.permission === 'granted') {
      permissionGranted = true;
      return true;
    }
    const result = await Notification.requestPermission();
    permissionGranted = result === 'granted';
    return permissionGranted;
  }

  function desktopNotify(title, options = {}) {
    if (!permissionGranted || !Settings.DESKTOP_ENABLED) return false;

    const defaults = {
      icon: 'images/logo.png',
      badge: 'images/logo.png',
      dir: 'rtl',
      lang: 'ar',
      requireInteraction: false,
      silent: false,
      tag: 'complaint-system'
    };

    try {
      const notif = new Notification(title, { ...defaults, ...options });
      notif.onclick = () => {
        window.focus();
        notif.close();
        if (options.onClick) options.onClick();
      };
      return notif;
    } catch (e) {
      return false;
    }
  }

  /* ═══════════════════════════════════════════════
     7. إشعارات خاصة بالشكاوى
     ═══════════════════════════════════════════════ */

  function newComplaint(complaint) {
    const msg = `شكوى جديدة: "${complaint.title}" من ${complaint.submitter}`;
    toast(msg, 'newComplaint', 6000);

    desktopNotify('شكوى جديدة', {
      body: msg,
      tag: `complaint-${complaint.id}`,
      icon: 'images/logo.png',
      onClick: () => {
        localStorage.setItem('hc_viewComplaintId', complaint.id);
        window.location.href = 'complaint-detail.html';
      }
    });
  }

  function statusChanged(complaint, oldStatus, newStatus, byUser) {
    const statusLabels = {
      pending: 'قيد الانتظار',
      'in-progress': 'قيد المعالجة',
      resolved: 'تم الحل',
      closed: 'مغلقة'
    };
    const msg = `تغيير حالة الشكوى #${complaint.id} من "${statusLabels[oldStatus] || oldStatus}" إلى "${statusLabels[newStatus] || newStatus}" بواسطة ${byUser}`;
    toast(msg, 'statusChange', 5000);

    desktopNotify('تحديث حالة الشكوى', {
      body: msg,
      tag: `status-${complaint.id}`,
      icon: 'images/logo.png'
    });
  }

  function newReply(complaint, reply) {
    const msg = `رد جديد على الشكوى #${complaint.id} من ${reply.from}`;
    toast(msg, 'info', 5000);

    desktopNotify('رد جديد', {
      body: msg,
      tag: `reply-${complaint.id}`,
      icon: 'images/logo.png'
    });
  }

  function adminAlert(message, type = 'warning') {
    toast(`🔔 إشعار المدير: ${message}`, type, 8000);
    desktopNotify('إشعار المدير', {
      body: message,
      requireInteraction: true,
      icon: 'images/logo.png'
    });
  }

  /* ═══════════════════════════════════════════════
     8. مراقبة التغييرات (Observer)
     ═══════════════════════════════════════════════ */

  let lastComplaintsCount = 0;
  let lastComplaintsHash = '';

  async function startWatching() {
    await requestPermission();

    setInterval(async () => {
      try {
        // التحقق من وجود DB قبل الاستخدام
        if (typeof DB === 'undefined' || !DB.getAllComplaints) return;
        
        const complaints = await DB.getAllComplaints();
        const currentCount = complaints.length;
        const currentHash = JSON.stringify(complaints.map(c => `${c.id}-${c.status}-${(c.replies || []).length}`));

        if (lastComplaintsCount > 0 && currentCount > lastComplaintsCount) {
          const newest = complaints[complaints.length - 1] || complaints[0];
          newComplaint(newest);
        }

        lastComplaintsCount = currentCount;
        lastComplaintsHash = currentHash;
      } catch (e) {
        // تجاهل الأخطاء إذا لم يكن DB جاهزاً
      }
    }, 5000);
  }

  /* ═══════════════════════════════════════════════
     9. Push Notifications
     ═══════════════════════════════════════════════ */

  async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('⚠️ Push notifications غير مدعومة');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          'BEl62iTMgU6KP8d6jHfdyK2n_pW0n0qGq2eE5P0pK2v3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6t7u8v9w0x1y2z3a4'
        )
      });
      console.log('✅ Push subscription:', subscription);
      return subscription;
    } catch (e) {
      console.error('❌ Push subscription failed:', e);
      return null;
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  }

  /* ═══════════════════════════════════════════════
     10. إدارة الإعدادات (تم الإصلاح هنا)
     ═══════════════════════════════════════════════ */

  function enableSound(enabled = true) {
    Settings.SOUND_ENABLED = enabled;
    try {
      localStorage.setItem('hc_soundEnabled', enabled);
    } catch (e) {}
  }

  function enableDesktop(enabled = true) {
    Settings.DESKTOP_ENABLED = enabled;
    try {
      localStorage.setItem('hc_desktopEnabled', enabled);
    } catch (e) {}
    if (enabled) requestPermission();
  }

  function loadSettings() {
    try {
      const sound = localStorage.getItem('hc_soundEnabled');
      const desktop = localStorage.getItem('hc_desktopEnabled');
      
      if (sound !== null) Settings.SOUND_ENABLED = sound !== 'false';
      if (desktop !== null) Settings.DESKTOP_ENABLED = desktop !== 'false';
    } catch (e) {
      console.warn('⚠️ تعذّر قراءة الإعدادات من localStorage');
    }
  }

  /* ═══════════════════════════════════════════════
     11. إضافة أنماط CSS
     ═══════════════════════════════════════════════ */

  function injectStyles() {
    if (document.getElementById('notifier-styles')) return;
    const style = document.createElement('style');
    style.id = 'notifier-styles';
    style.textContent = `
      @keyframes toastIn {
        from { opacity: 0; transform: translateY(-14px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes toastOut {
        to { opacity: 0; transform: translateY(-10px); }
      }
      .toast {
        position: relative;
        overflow: hidden;
      }
      .toast::before {
        content: '';
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: currentColor;
        opacity: 0.3;
      }
    `;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════════
     12. التهيئة
     ═══════════════════════════════════════════════ */

  function init() {
    injectStyles();
    initContainer();
    loadSettings();

    document.addEventListener('click', () => {
      if (!permissionGranted && Settings.DESKTOP_ENABLED) {
        requestPermission();
      }
    }, { once: true });

    console.log('🔔 Notifier initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ═══════════════════════════════════════════════
     13. الواجهة البرمجية العامة
     ═══════════════════════════════════════════════ */

  return {
    toast,
    success: (msg, dur) => toast(msg, 'success', dur),
    error: (msg, dur) => toast(msg, 'error', dur),
    warning: (msg, dur) => toast(msg, 'warning', dur),
    info: (msg, dur) => toast(msg, 'info', dur),

    requestPermission,
    desktopNotify,

    newComplaint,
    statusChanged,
    newReply,
    adminAlert,

    startWatching,
    subscribePush,

    enableSound,
    enableDesktop,
    loadSettings,

    get settings() { return { ...Settings }; }
  };

})();

// Global access
if (typeof window !== 'undefined') {
  window.Notifier = Notifier;
  // توافقية مع الكود القديم
  window.Notifications = Notifier;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Notifier };
}