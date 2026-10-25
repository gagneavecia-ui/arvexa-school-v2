// ================================================================
// arvexa-confirm.js — ARVEXA School
// Modale de confirmation UNIFORME + déconnexion standard du site.
//
// Modèle de référence : index.html (extrait à l'identique).
// Utilisation dans une page :
//   1. <script type="module" src="./arvexa-confirm.js"></script>
//   2. Bouton de déconnexion :
//        if (window.arvexaLogout) { window.arvexaLogout(); return; }
//      (ou simplement ajouter data-arvexa-logout sur l'élément :
//       le module le relie automatiquement)
//   3. Toute autre modale de confirmation :
//        window.arvexaConfirm({ title, message, icon, confirmText,
//                               cancelText, variant, onConfirm })
// Toute déconnexion efface la session et renvoie vers auth-choice.html.
// ================================================================

(() => {
  if (window.__arvexaConfirmLoaded) return;
  window.__arvexaConfirmLoaded = true;

  // ── CSS extrait d'index.html — valeurs verrouillées sur le :root
  //    de l'index pour un rendu IDENTIQUE quelle que soit la page.
  const CSS = `
    .arvexa-confirm-overlay {
      --axc-accent: #B8860B;
      --axc-accent-bright: #E0B84A;
      --axc-danger: #B85C3A;
      --axc-text-light: #F5F0E8;
      --axc-text-dim: #8A8A7A;
      --axc-text-muted: #5A5A4A;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      visibility: hidden;
      transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
    }
    .arvexa-confirm-overlay.show {
      opacity: 1;
      visibility: visible;
    }
    .arvexa-confirm-modal {
      background: linear-gradient(145deg, #141414 0%, #0A0A0A 100%);
      border: 1px solid rgba(184, 134, 11, 0.25);
      border-radius: 20px;
      padding: 32px 28px 24px;
      max-width: 400px;
      width: 100%;
      position: relative;
      overflow: hidden;
      transform: scale(0.9) translateY(20px);
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    }
    .arvexa-confirm-overlay.show .arvexa-confirm-modal {
      transform: scale(1) translateY(0);
    }
    .arvexa-confirm-modal::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--axc-accent), var(--axc-accent-bright), var(--axc-accent));
    }
    .arvexa-confirm-icon-wrap {
      display: flex;
      justify-content: center;
      margin-bottom: 18px;
    }
    .arvexa-confirm-icon-box {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(184, 134, 11, 0.15), rgba(184, 134, 11, 0.05));
      border: 1px solid rgba(184, 134, 11, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
    }
    .arvexa-confirm-icon-box.danger {
      background: linear-gradient(135deg, rgba(184, 92, 58, 0.15), rgba(184, 92, 58, 0.05));
      border-color: rgba(184, 92, 58, 0.3);
    }
    .arvexa-confirm-title {
      font-size: 22px;
      font-weight: 700;
      font-family: 'Playfair Display', Georgia, serif;
      color: var(--axc-text-light);
      text-align: center;
      margin-bottom: 8px;
      line-height: 1.25;
    }
    .arvexa-confirm-divider {
      width: 40px;
      height: 2px;
      margin: 0 auto 16px;
      background: linear-gradient(90deg, transparent, var(--axc-accent), transparent);
    }
    .arvexa-confirm-message {
      font-size: 14.5px;
      line-height: 1.65;
      color: var(--axc-text-dim);
      text-align: center;
      margin-bottom: 24px;
    }
    .arvexa-confirm-message strong {
      color: var(--axc-text-light);
      font-weight: 600;
    }
    .arvexa-confirm-actions {
      display: flex;
      gap: 10px;
    }
    .arvexa-confirm-btn {
      flex: 1;
      padding: 13px 16px;
      border-radius: 30px;
      border: none;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
      font-family: 'Inter', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .arvexa-confirm-btn.cancel {
      background: rgba(255, 255, 255, 0.05);
      color: var(--axc-text-dim);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .arvexa-confirm-btn.cancel:hover {
      background: rgba(255, 255, 255, 0.09);
      color: var(--axc-text-light);
    }
    .arvexa-confirm-btn.danger {
      background: linear-gradient(135deg, #D97A3A, #B85C3A);
      color: #fff;
      box-shadow: 0 4px 16px rgba(184, 92, 58, 0.25);
    }
    .arvexa-confirm-btn.primary {
      background: linear-gradient(135deg, var(--axc-accent-bright), var(--axc-accent));
      color: #0A0A0A;
      box-shadow: 0 4px 16px rgba(184, 134, 11, 0.25);
    }
    .arvexa-confirm-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.03);
      color: var(--axc-text-muted);
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
      z-index: 2;
    }
    .arvexa-confirm-close:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--axc-text-light);
    }
  `;

  // ── Markup extrait à l'identique d'index.html
  const MARKUP = `
    <div class="arvexa-confirm-overlay" id="arvexaConfirmModal" role="dialog" aria-modal="true" aria-labelledby="arvexaConfirmTitle">
      <div class="arvexa-confirm-modal">
        <button class="arvexa-confirm-close" id="arvexaConfirmClose" aria-label="Fermer">
          <i class="fas fa-times"></i>
        </button>
        <div class="arvexa-confirm-icon-wrap">
          <div class="arvexa-confirm-icon-box danger" id="arvexaConfirmIconBox">
            <span id="arvexaConfirmIcon">⚠️</span>
          </div>
        </div>
        <h3 class="arvexa-confirm-title" id="arvexaConfirmTitle">Confirmation</h3>
        <div class="arvexa-confirm-divider"></div>
        <p class="arvexa-confirm-message" id="arvexaConfirmMessage">
          Es-tu sûr de vouloir continuer ?
        </p>
        <div class="arvexa-confirm-actions">
          <button class="arvexa-confirm-btn cancel" id="arvexaConfirmCancel">
            Annuler
          </button>
          <button class="arvexa-confirm-btn danger" id="arvexaConfirmOk">
            <i class="fas fa-check"></i>
            <span id="arvexaConfirmOkText">Confirmer</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // ── Injection (uniquement si la page n'a pas déjà sa propre modale)
  let overlay = document.getElementById('arvexaConfirmModal');
  const ownedByPage = !!overlay && typeof window.arvexaConfirm === 'function';

  if (!overlay) {
    try {
      const style = document.createElement('style');
      style.setAttribute('data-arvexa-confirm', '');
      style.textContent = CSS;
      document.head.appendChild(style);
      document.body.insertAdjacentHTML('beforeend', MARKUP);
      overlay = document.getElementById('arvexaConfirmModal');
    } catch (e) {
      console.error('[ArvexaConfirm] injection impossible:', e);
      return;
    }
  }

  // ── API uniforme (ne remplace jamais celle d'une page qui l'a déjà)
  if (!ownedByPage) {
    const titleEl = overlay.querySelector('#arvexaConfirmTitle');
    const msgEl = overlay.querySelector('#arvexaConfirmMessage');
    const iconEl = overlay.querySelector('#arvexaConfirmIcon');
    const iconBox = overlay.querySelector('#arvexaConfirmIconBox');
    const okBtn = overlay.querySelector('#arvexaConfirmOk');
    const okText = overlay.querySelector('#arvexaConfirmOkText');
    const cancelBtn = overlay.querySelector('#arvexaConfirmCancel');
    const closeBtn = overlay.querySelector('#arvexaConfirmClose');

    let confirmCallback = null;

    window.arvexaConfirm = function (options) {
      options = options || {};
      titleEl.textContent = options.title || 'Confirmation';
      msgEl.innerHTML = options.message || 'Es-tu sûr de vouloir continuer ?';
      iconEl.textContent = options.icon || '⚠️';
      okText.textContent = options.confirmText || 'Confirmer';
      cancelBtn.textContent = options.cancelText || 'Annuler';
      cancelBtn.style.display = options.showCancel === false ? 'none' : '';
      const variant = options.variant === 'primary' ? 'primary' : 'danger';
      iconBox.className = 'arvexa-confirm-icon-box ' + (variant === 'primary' ? '' : 'danger');
      okBtn.className = 'arvexa-confirm-btn ' + variant;
      confirmCallback = options.onConfirm || null;
      overlay.classList.add('show');
      document.body.style.overflow = 'hidden';
    };

    function closeArvexaConfirm() {
      overlay.classList.remove('show');
      document.body.style.overflow = '';
      confirmCallback = null;
    }

    cancelBtn.addEventListener('click', closeArvexaConfirm);
    closeBtn.addEventListener('click', closeArvexaConfirm);
    okBtn.addEventListener('click', () => {
      const cb = confirmCallback;
      closeArvexaConfirm();
      if (typeof cb === 'function') cb();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeArvexaConfirm();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) closeArvexaConfirm();
    });
  }

  // ── Déconnexion standard : session nettoyée + redirection auth-choice.html
  const SESSION_KEYS_LOCAL = ['arvexa_session', 'arvexa_user_data', 'arvexa_last_uid'];
  const SESSION_KEYS_SESSION = ['arvexa_session', 'redirectAfterLogin', 'redirectAfterAuth'];

  async function performStandardLogout() {
    SESSION_KEYS_LOCAL.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    SESSION_KEYS_SESSION.forEach((k) => { try { sessionStorage.removeItem(k); } catch (e) {} });
    try {
      const { getApps } = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js');
      const { getAuth, signOut } = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js');
      const app = getApps().find((a) => a.name === '[DEFAULT]');
      if (app) { try { await signOut(getAuth(app)); } catch (e) {} }
    } catch (e) {
      console.warn('[ArvexaConfirm] signOut:', e && (e.code || e.message));
    }
    window.location.replace('auth-choice.html');
  }

  window.arvexaLogout = function () {
    window.arvexaConfirm({
      title: 'Se déconnecter ?',
      message: 'Tu devras te <strong>reconnecter</strong> pour accéder à ton compte.',
      icon: '⚠️',
      confirmText: 'Se déconnecter',
      cancelText: 'Annuler',
      variant: 'danger',
      onConfirm: performStandardLogout
    });
  };

  // ── Reliage automatique des éléments déclarés data-arvexa-logout
  function bindLogoutTriggers() {
    document.querySelectorAll('[data-arvexa-logout]').forEach((el) => {
      if (el.dataset.arvexaLogoutBound) return;
      el.dataset.arvexaLogoutBound = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.arvexaLogout();
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLogoutTriggers);
  } else {
    bindLogoutTriggers();
  }
})();
