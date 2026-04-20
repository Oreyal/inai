(() => {
  'use strict';

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
    '.section-head, .concept-text, .concept-visual, .service-card, .plan-card, .scene-item, .flow-list li, .faq-list details, .contact-form'
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

      const required = ['name', 'email', 'date', 'people'];
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
      const agree = document.getElementById('agree');
      if (!agree.checked) {
        if (!firstInvalid) firstInvalid = agree;
      }
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = '送信中…';

      // NOTE: Submission endpoint is not wired up yet.
      // Replace this simulated delay with a real POST to the chef's inbox / GAS endpoint.
      setTimeout(() => {
        form.hidden = true;
        success.hidden = false;
        success.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 600);
    });
  }
})();
