// ============================================
// SCROLL3D.JS — Scroll-scrubbed camera control
// Connects Lenis smooth scroll + GSAP ScrollTrigger
// to the 3D scene
// ============================================

(function () {
  'use strict';

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ═══════════════════════════════════════════
     WAIT FOR DEPENDENCIES
     ═══════════════════════════════════════════ */
  function waitForDeps(cb) {
    const check = () => {
      if (window.Lenis && window.gsap && window.ScrollTrigger && window.__scene3d) {
        cb();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  }

  waitForDeps(() => {
    const { gsap, ScrollTrigger, Lenis } = window;
    const scene3d = window.__scene3d;

    gsap.registerPlugin(ScrollTrigger);

    /* ═══════════════════════════════════════════
       LENIS SMOOTH SCROLL
       ═══════════════════════════════════════════ */
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: !prefersReduced,
      wheelMultiplier: 1,
      touchMultiplier: 2,
    });

    // Connect Lenis to ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update);

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);

    /* ═══════════════════════════════════════════
       SECTION IDS + ORDER
       ═══════════════════════════════════════════ */
    const sectionIds = ['hero', 'about', 'experience', 'projects', 'certifications', 'contact'];

    /* ═══════════════════════════════════════════
       SCROLL PROGRESS → CAMERA (0..1)
       ═══════════════════════════════════════════ */
    ScrollTrigger.create({
      trigger: 'body',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.5,
      onUpdate: (self) => {
        scene3d.setProgress(self.progress);
      },
    });

    /* ═══════════════════════════════════════════
       SECTION DETECTION
       ═══════════════════════════════════════════ */
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      ScrollTrigger.create({
        trigger: el,
        start: 'top 60%',
        end: 'bottom 40%',
        onEnter: () => scene3d.setSection(id),
        onEnterBack: () => scene3d.setSection(id),
      });
    });

    /* ═══════════════════════════════════════════
       MOUSE PARALLAX (normalized -1..1)
       ═══════════════════════════════════════════ */
    let mouseTargetX = 0, mouseTargetY = 0;
    let mouseCurrentX = 0, mouseCurrentY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseTargetX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseTargetY = -(e.clientY / window.innerHeight) * 2 + 1;
    }, { passive: true });

    // Smooth mouse with lerp
    gsap.ticker.add(() => {
      mouseCurrentX += (mouseTargetX - mouseCurrentX) * 0.06;
      mouseCurrentY += (mouseTargetY - mouseCurrentY) * 0.06;
      scene3d.setMouse(mouseCurrentX, mouseCurrentY);
    });

    /* ═══════════════════════════════════════════
       SCROLL PROGRESS BAR
       ═══════════════════════════════════════════ */
    const progressBar = document.getElementById('scrollProgress');
    if (progressBar) {
      ScrollTrigger.create({
        trigger: 'body',
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: (self) => {
          progressBar.style.transform = `scaleX(${self.progress})`;
        },
      });
    }

    /* ═══════════════════════════════════════════
       ANCHOR SCROLL WITH LENIS
       ═══════════════════════════════════════════ */
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const targetId = link.getAttribute('href').substring(1);
        const target = document.getElementById(targetId);
        if (target) {
          e.preventDefault();
          lenis.scrollTo(target, { offset: -80 });
          history.pushState(null, '', `#${targetId}`);
        }
      });
    });
  });

})();
