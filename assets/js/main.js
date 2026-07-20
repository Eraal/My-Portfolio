// ============================================
// GERALD PANDAAN : PORTFOLIO
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
      // Skip animations, show everything immediately
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
    const duration = 1200; // ms
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
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
  // 5. SMOOTH SCROLL (fallback)
  // ==========================================
  function initSmoothScroll() {
    if (prefersReduced) return;

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
            nav.style.borderBottomColor = 'rgba(148, 163, 184, 0.15)';
            nav.style.background = 'rgba(10, 15, 26, 0.95)';
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
  });

})();
