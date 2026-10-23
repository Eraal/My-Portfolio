// ============================================
// GERALD PANDAAN : PORTFOLIO — v2
// Main interaction logic
// ============================================

(function () {
  'use strict';

  // --- Respect reduced motion preference ---
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ==========================================
  // 1. SCROLL REVEAL (Intersection Observer)
  // ==========================================
  function initScrollReveal() {
    const revealEls = document.querySelectorAll('.reveal');
    if (!revealEls.length) return;

    if (prefersReduced) {
      revealEls.forEach(el => el.classList.add('visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach(el => observer.observe(el));
  }

  // ==========================================
  // 2. ANIMATED COUNTERS (Hero Stats)
  // ==========================================
  function initCounters() {
    const counters = document.querySelectorAll('.hero-stat-value[data-count]');
    if (!counters.length) return;

    if (prefersReduced) {
      counters.forEach(el => { el.textContent = el.dataset.count; });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(el => observer.observe(el));
  }

  function animateCounter(el) {
    const target = parseInt(el.dataset.count, 10);
    const duration = 1200;
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }

  // ==========================================
  // 3. MOBILE NAVIGATION
  // ==========================================
  function initMobileNav() {
    const toggle = document.getElementById('navToggle');
    const mobileNav = document.getElementById('mobileNav');
    if (!toggle || !mobileNav) return;

    toggle.addEventListener('click', () => {
      const isOpen = !mobileNav.classList.contains('hidden');
      mobileNav.classList.toggle('hidden');
      toggle.setAttribute('aria-expanded', !isOpen);
    });

    // Close mobile nav when a link is clicked
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ==========================================
  // 4. ACTIVE NAV LINK HIGHLIGHTING
  // ==========================================
  function initActiveNavHighlight() {
    const sections = document.querySelectorAll('section[id], header[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    if (!sections.length || !navLinks.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
          });
        }
      });
    }, {
      threshold: 0.2,
      rootMargin: '-80px 0px -50% 0px'
    });

    sections.forEach(section => observer.observe(section));
  }

  // ==========================================
  // 5. SMOOTH SCROLL (fallback — skipped when Lenis handles it)
  // ==========================================
  function initSmoothScroll() {
    if (prefersReduced) return;
    // Lenis (from scroll3d.js) handles smooth scrolling when available
    if (window.Lenis) return;
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', e => {
        const targetId = link.getAttribute('href').substring(1);
        const target = document.getElementById(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
          history.pushState(null, '', `#${targetId}`);
        }
      });
    });
  }

  // ==========================================
  // 6. DYNAMIC YEAR
  // ==========================================
  function initYear() {
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  }

  // ==========================================
  // 7. KEYBOARD ACCESSIBILITY
  // ==========================================
  function initA11y() {
    function handleFirstTab(e) {
      if (e.key === 'Tab') {
        document.documentElement.classList.add('user-tabbing');
        window.removeEventListener('keydown', handleFirstTab);
      }
    }
    window.addEventListener('keydown', handleFirstTab);
  }

  // ==========================================
  // 8. NAV BACKGROUND ON SCROLL
  // ==========================================
  function initNavScroll() {
    const nav = document.getElementById('mainNav');
    if (!nav) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          if (window.scrollY > 50) {
            nav.style.borderBottomColor = 'rgba(161, 161, 170, 0.12)';
            nav.style.background = 'rgba(9, 9, 11, 0.95)';
          } else {
            nav.style.borderBottomColor = '';
            nav.style.background = '';
          }
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  // ==========================================
  // 9. CURSOR SPOTLIGHT on Project Cards
  // ==========================================
  function initCursorSpotlight() {
    if (prefersReduced) return;

    const cards = document.querySelectorAll('.project-card');
    if (!cards.length) return;

    cards.forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const nx = (x / rect.width) * 2 - 1;
        const ny = (y / rect.height) * 2 - 1;
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
        card.style.setProperty('--tilt-x', `${nx * 2.2}deg`);
        card.style.setProperty('--tilt-y', `${ny * -2.2}deg`);
      });

      // Reset position when mouse leaves for clean re-entry
      card.addEventListener('mouseleave', () => {
        card.style.setProperty('--mouse-x', '50%');
        card.style.setProperty('--mouse-y', '50%');
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      });
    });
  }

  // ==========================================
  // 10. HEADING DECODE EFFECT
  // ==========================================
  function initHeadingDecode() {
    if (prefersReduced) return;

    const headings = document.querySelectorAll('.section-heading h2');
    if (!headings.length) return;

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@$%';

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          decodeText(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    headings.forEach(h => {
      // Store the original text
      h.dataset.decoded = h.innerText;
      observer.observe(h);
    });

    function decodeText(el) {
      const originalText = el.dataset.decoded;
      if (!originalText) return;

      let iteration = 0;
      const totalLength = originalText.length;
      // Reveal ~2 characters per frame at 30ms intervals → fast and smooth
      const speed = Math.max(1, Math.floor(totalLength / 20));

      const interval = setInterval(() => {
        el.innerText = originalText
          .split('')
          .map((char, index) => {
            if (index < iteration) return originalText[index];
            if (char === ' ') return ' ';
            return chars[Math.floor(Math.random() * chars.length)];
          })
          .join('');

        iteration += speed;

        if (iteration >= totalLength) {
          el.innerText = originalText;
          clearInterval(interval);
        }
      }, 30);
    }
  }

  // ==========================================
  // INIT ALL
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    initScrollReveal();
    initCounters();
    initMobileNav();
    initActiveNavHighlight();
    initSmoothScroll();
    initYear();
    initA11y();
    initNavScroll();
    initCursorSpotlight();
    initHeadingDecode();
  });

})();
