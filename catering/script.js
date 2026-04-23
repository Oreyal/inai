(() => {
  'use strict';

  // GAS Web App URL — catering/gas-catering.js をデプロイした Web App の /exec URL。
  // 空文字の場合は送信せず、成功UIだけ表示（開発用フォールバック）。
  const CATERING_FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycby89xjU_7OvfsHy8D8P6O1nL966aqJEIjQM-AaR9xABjj6wxvQgVjz4CRd_Fuh3cy2S/exec';

  // ===== Header scroll state =====
  const header = document.getElementById('siteHeader');
  const onScroll = () => {
    if (window.scrollY > 24) header.classList.add('is-scrolled');
    else header.classList.remove('is-scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ===== Mobile nav =====
  const toggle = document.getElementById('navToggle');
  const navMobile = document.getElementById('navMobile');
  toggle.addEventListener('click', () => {
    const open = navMobile.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  });
  navMobile.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navMobile.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });

  // ===== Scroll reveal =====
  const revealTargets = document.querySelectorAll(
    '.section-head, .concept-text, .concept-visual, .service-card, .reason-card, .plan-card, .case-card, .scene-item, .flow-list li, .faq-list details, .contact-form'
  );
  revealTargets.forEach(el => el.classList.add('reveal'));

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    revealTargets.forEach(el => io.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.add('is-visible'));
  }

  // ===== Year =====
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ===== Contact form =====
  const form = document.getElementById('contactForm');
  const success = document.getElementById('formSuccess');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const required = ['company', 'department', 'name', 'email', 'date', 'people'];
      let firstInvalid = null;
      required.forEach((key) => {
        const el = form.elements.namedItem(key);
        if (el && !el.value.trim()) {
          el.style.borderColor = '#b94040';
          if (!firstInvalid) firstInvalid = el;
        } else if (el) {
          el.style.borderColor = '';
        }
      });

      const emailEl = form.elements.namedItem('email');
      if (emailEl && emailEl.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) {
        emailEl.style.borderColor = '#b94040';
        if (!firstInvalid) firstInvalid = emailEl;
      }

      const agree = document.getElementById('agree');
      if (!agree.checked && !firstInvalid) firstInvalid = agree;

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const submitBtn = document.getElementById('submitBtn');
      const submitLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = '送信中…';

      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.scene = formData.getAll('scene');
      payload.userAgent = navigator.userAgent;

      const showSuccess = () => {
        form.hidden = true;
        success.hidden = false;
        success.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      const showError = () => {
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
        alert('送信に失敗しました。時間をおいて再度お試しいただくか、お電話にてご連絡ください。');
      };

      if (!CATERING_FORM_ENDPOINT) {
        console.info('[contact] endpoint未設定のため送信スキップ (dev fallback):', payload);
        setTimeout(showSuccess, 600);
        return;
      }

      // GAS Web App へ POST。text/plain にして CORS プリフライトを回避。
      fetch(CATERING_FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      })
        .then((res) => res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)))
        .then((json) => {
          if (json && json.ok) showSuccess();
          else throw new Error(json && json.error ? json.error : 'unknown');
        })
        .catch((err) => {
          console.error('[contact] submit failed:', err);
          showError();
        });
    });
  }
})();
