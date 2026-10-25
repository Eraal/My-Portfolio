/**
 * ATOM GUIDE SPEECH BUBBLE
 *
 * Provides contextual narrative guidance as the atom crawls across the portfolio:
 * - Fixed DOM glass bubble tracking the atom nucleus with a spring lag
 * - Three bouncing dots thinking state (400ms) -> typing animation (~25ms/char)
 * - Section visibility triggers (50% threshold, once per page load)
 * - Nav and CTA click arrival triggers (when atom reaches target or after 1.2s)
 * - Card tendril-grip reactions (once per card per page load on desktop)
 * - Accessibility: aria-live="polite", Esc dismiss, prefers-reduced-motion, mobile optimizations
 * - Footer guide toggle with try/catch storage persistence
 */

(() => {
  'use strict';

  /* ═══════════════════════════════════════════════
     MESSAGES CONFIGURATION (Easily Editable)
     ═══════════════════════════════════════════════ */
  const MESSAGES = {
    hero: {
      label: 'GUIDE // START',
      text: "Hi, I'm your guide! Scroll down and I'll show you around.",
    },
    about: {
      label: '01 // ABOUT',
      text: 'Meet Gerald, a Cum Laude IT graduate who has already shipped real systems.',
    },
    experience: {
      label: '02 // EXPERIENCE',
      text: 'From an RFID capstone to a live municipal platform. Follow the timeline!',
    },
    projects: {
      label: '03 // PROJECTS',
      text: "Four projects here, and two are live right now. Try 'Visit Live Site'!",
    },
    cv: {
      label: '04 // RESUME',
      text: 'Want the full story? You can download the resume right here.',
    },
    certifications: {
      label: '05 // CERTIFICATIONS',
      text: 'DICT certified in data privacy awareness and cybersecurity.',
    },
    contact: {
      label: '06 // CONTACT',
      text: 'Gerald is open to work. Say hi, email is right here!',
    },
    cards: {
      PiyuGuide: {
        label: 'PROJECT // PIYUGUIDE',
        text: 'PiyuGuide: counseling with real-time video.',
      },
      Siniloan: {
        label: 'PROJECT // SINILOAN',
        text: 'Used daily by the municipality.',
      },
      TagTrack: {
        label: 'PROJECT // TAGTRACK',
        text: 'RFID powered lost and found.',
      },
      PiyuClean: {
        label: 'PROJECT // PIYUCLEAN',
        text: 'Cleaning tasks, fully automated.',
      },
    },
  };

  /* ═══════════════════════════════════════════════
     SECRET ATOM FACTS (Editable Object)
     ═══════════════════════════════════════════════ */
  const ATOM_FACTS = [
    "Cum Laude graduate in BS Information Technology.",
    "His work is already live and used by real people.",
    "PiyuGuide has real-time WebSocket chat and WebRTC video sessions.",
    "The municipal platform runs on a Hostinger VPS that Gerald administers.",
    "CHED Tulong Dunong scholar, and proud of it.",
    "Network Administration degree, full-stack skills.",
    "Open to work. Email is at the bottom of the page!"
  ];
  let factIndex = 0;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < 768;

  // Persistence for Guide toggle
  let guideEnabled = true;
  try {
    const saved = localStorage.getItem('atom_guide_enabled');
    if (saved !== null) guideEnabled = saved === 'true';
  } catch (_) {
    guideEnabled = true;
  }

  // Sets to track trigger execution once per page load
  const triggeredSections = new Set();
  const triggeredCards = new Set();

  /* ═══════════════════════════════════════════════
     BUBBLE & CLICK TARGET & RADIAL MENU DOM SETUP
     ═══════════════════════════════════════════════ */
  const bubble = document.createElement('aside');
  bubble.id = 'atomSpeechBubble';
  bubble.className = 'atom-speech-bubble';
  bubble.setAttribute('aria-hidden', 'true');
  bubble.innerHTML = `
    <div class="atom-bubble-body">
      <div class="atom-bubble-tail" aria-hidden="true"></div>
      <div class="atom-bubble-label font-mono"></div>
      <div class="atom-bubble-content">
        <div class="atom-bubble-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div class="atom-bubble-message font-body" aria-live="polite"></div>
        <span class="atom-bubble-cursor" aria-hidden="true"></span>
      </div>
    </div>
  `;
  document.body.appendChild(bubble);

  const tailEl = bubble.querySelector('.atom-bubble-tail');
  const labelEl = bubble.querySelector('.atom-bubble-label');
  const dotsEl = bubble.querySelector('.atom-bubble-dots');
  const messageEl = bubble.querySelector('.atom-bubble-message');
  const cursorEl = bubble.querySelector('.atom-bubble-cursor');

  // 1. Invisible circular click target (~90px, follows atom every frame)
  const clickTarget = document.createElement('div');
  clickTarget.id = 'atomClickTarget';
  clickTarget.className = 'atom-click-target';
  clickTarget.setAttribute('role', 'button');
  clickTarget.setAttribute('aria-label', 'Open guide menu');
  clickTarget.setAttribute('tabindex', '0');
  document.body.appendChild(clickTarget);

  // 2. Radial Guide Menu container & 4 round glass buttons
  const menuContainer = document.createElement('nav');
  menuContainer.id = 'atomGuideMenu';
  menuContainer.className = 'atom-guide-menu';
  menuContainer.setAttribute('aria-label', 'Atom guide radial menu');

  const menuItems = [
    { label: 'Projects', target: '#projects', aria: 'Navigate to Projects section' },
    { label: 'Resume', target: '#cv', aria: 'Navigate to Resume section' },
    { label: 'Contact', target: '#contact', aria: 'Navigate to Contact section' },
    { label: 'Surprise me', action: 'surprise', aria: 'Show a secret fun fact' },
  ];

  const menuButtons = menuItems.map((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atom-menu-btn';
    btn.textContent = item.label;
    btn.setAttribute('aria-label', item.aria);
    btn.setAttribute('tabindex', '-1');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (item.action === 'surprise') {
        showNextFact(true);
      } else {
        closeMenu();
        navigateToSection(item.target);
      }
    });

    menuContainer.appendChild(btn);
    return { btn, item, idx };
  });

  document.body.appendChild(menuContainer);

  /* ═══════════════════════════════════════════════
     CLICK INTERACTION & MENU STATE
     ═══════════════════════════════════════════════ */
  let isMenuOpen = false;
  let scrollAtMenuOpen = 0;
  let clickTimestamps = [];
  let hasClickedAtom = false;
  let hintTimer = null;
  let isHintActive = false;

  function cancelHint() {
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
    if (isHintActive) {
      isHintActive = false;
      hideBubble(true);
    }
  }

  function showNextFact(forceImmediate = false) {
    const fact = ATOM_FACTS[factIndex];
    factIndex = (factIndex + 1) % ATOM_FACTS.length;
    showMessage('GUIDE // FACT', fact, forceImmediate);
  }

  function handleAtomClick(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!guideEnabled) return;

    hasClickedAtom = true;
    cancelHint();

    const now = performance.now();
    clickTimestamps = clickTimestamps.filter((t) => now - t < 10000);
    clickTimestamps.push(now);

    const atomApi = window.__particleAtom;
    if (atomApi && typeof atomApi.triggerClickEffects === 'function') {
      atomApi.triggerClickEffects();
    }

    // After 8 clicks within 10 seconds, show one playful line instead
    if (clickTimestamps.length >= 8) {
      showMessage('GUIDE // HELLO!', "Okay okay, I'm awake! Try the menu.", true);
      clickTimestamps = [];
    } else {
      showNextFact(true);
    }

    // Guide menu opens ~300ms after the click effects start
    setTimeout(() => {
      if (guideEnabled) openMenu();
    }, 300);
  }

  clickTarget.addEventListener('click', handleAtomClick);
  clickTarget.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleAtomClick(e);
    }
  });

  function positionMenuButtons(atomX, atomY) {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const R = isMobile ? 70 : 85;

    // Flip sides if atom is near viewport edges
    const isNearRight = atomX > winW - 130;
    const isNearLeft = atomX < 130;
    const isNearTop = atomY < 130;
    const isNearBottom = atomY > winH - 130;

    let angles;
    if (isNearRight) {
      angles = [Math.PI * 0.72, Math.PI * 0.92, Math.PI * 1.08, Math.PI * 1.28];
    } else if (isNearLeft) {
      angles = [-Math.PI * 0.28, -Math.PI * 0.08, Math.PI * 0.08, Math.PI * 0.28];
    } else if (isNearTop) {
      angles = [Math.PI * 0.22, Math.PI * 0.42, Math.PI * 0.58, Math.PI * 0.78];
    } else if (isNearBottom) {
      angles = [-Math.PI * 0.78, -Math.PI * 0.58, -Math.PI * 0.42, -Math.PI * 0.22];
    } else {
      angles = [-Math.PI * 0.75, -Math.PI * 0.25, Math.PI * 0.25, Math.PI * 0.75];
    }

    menuButtons.forEach(({ btn, idx }) => {
      const angle = angles[idx];
      let btnX = atomX + Math.cos(angle) * R;
      let btnY = atomY + Math.sin(angle) * R;

      // Clamp inside viewport
      btnX = Math.max(42, Math.min(winW - 42, btnX));
      btnY = Math.max(76, Math.min(winH - 30, btnY)); // below nav

      btn.style.left = `${btnX.toFixed(1)}px`;
      btn.style.top = `${btnY.toFixed(1)}px`;
    });
  }

  function openMenu() {
    if (isMenuOpen || !guideEnabled) return;
    isMenuOpen = true;
    scrollAtMenuOpen = window.scrollY;

    const atomApi = window.__particleAtom;
    if (atomApi && atomApi.position) {
      positionMenuButtons(atomApi.position.x, window.innerHeight - atomApi.position.y);
    }

    menuButtons.forEach(({ btn, idx }) => {
      btn.setAttribute('tabindex', '0');
      btn.classList.remove('closing');
      if (reduceMotion) {
        btn.classList.add('open');
      } else {
        setTimeout(() => {
          if (isMenuOpen) btn.classList.add('open');
        }, idx * 45);
      }
    });
  }

  function closeMenu() {
    if (!isMenuOpen) return;
    isMenuOpen = false;

    menuButtons.forEach(({ btn }) => {
      btn.setAttribute('tabindex', '-1');
      btn.classList.remove('open');
      btn.classList.add('closing');
    });

    setTimeout(() => {
      menuButtons.forEach(({ btn }) => btn.classList.remove('closing'));
    }, 220);
  }

  function navigateToSection(targetSelector) {
    const target = document.querySelector(targetSelector);
    if (!target) return;

    if (window.lenis && typeof window.lenis.scrollTo === 'function') {
      window.lenis.scrollTo(target, { offset: -80 });
    } else if (window.__lenis && typeof window.__lenis.scrollTo === 'function') {
      window.__lenis.scrollTo(target, { offset: -80 });
    } else {
      target.scrollIntoView({ behavior: 'smooth' });
    }

    const cleanId = targetSelector.replace('#', '');
    const msgConfig = MESSAGES[cleanId] || (cleanId === 'cv' ? MESSAGES.cv : null);
    if (!msgConfig) return;

    const startTime = performance.now();
    function checkMenuArrival() {
      const now = performance.now();
      const elapsed = (now - startTime) / 1000;
      const atomApi = window.__particleAtom;
      let arrived = false;
      if (atomApi && target) {
        const rect = target.getBoundingClientRect();
        const targetCenterY = rect.top + rect.height * 0.5;
        const atomY = window.innerHeight - atomApi.position.y;
        if (Math.abs(atomY - targetCenterY) < 220) {
          arrived = true;
        }
      }
      if (arrived || elapsed >= 1.2) {
        showMessage(msgConfig.label, msgConfig.text);
      } else {
        requestAnimationFrame(checkMenuArrival);
      }
    }
    requestAnimationFrame(checkMenuArrival);
  }

  // Close menu on click outside
  window.addEventListener('click', (e) => {
    if (isMenuOpen && !menuContainer.contains(e.target) && e.target !== clickTarget) {
      closeMenu();
    }
  });

  /* ═══════════════════════════════════════════════
     POSITION TRACKING & SPRING LAG
     ═══════════════════════════════════════════════ */
  let currentX = window.innerWidth * 0.7;
  let currentY = window.innerHeight * 0.4;
  let targetX = currentX;
  let targetY = currentY;
  let bubbleWidth = 240;
  let bubbleHeight = 90;
  let tailSide = 'left';

  let isVisible = false;
  let isFading = false;
  let activeTimeout = null;
  let typingInterval = null;
  let pendingMessage = null;

  function updateBubblePosition() {
    requestAnimationFrame(updateBubblePosition);

    const atomApi = window.__particleAtom;
    if (!atomApi || !atomApi.position) return;

    // Convert atom Three.js position to DOM viewport coords
    const atomX = atomApi.position.x;
    const atomY = window.innerHeight - atomApi.position.y;

    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // Follow atom position with click target (~90px circular button)
    clickTarget.style.transform = `translate3d(${(atomX - 45).toFixed(1)}px, ${(atomY - 45).toFixed(1)}px, 0)`;

    // Keep menu attached and close if scrolled > 300px
    if (isMenuOpen) {
      positionMenuButtons(atomX, atomY);
      if (Math.abs(window.scrollY - scrollAtMenuOpen) > 300) {
        closeMenu();
      }
    }

    bubbleWidth = isMobile ? 190 : 240;
    const rect = bubble.getBoundingClientRect();
    if (rect.height > 20) bubbleHeight = rect.height;

    // Place bubble on side with most room, offset further when menu is open so it doesn't cover buttons
    const freeRight = winW - atomX;
    const freeLeft = atomX;
    const placeRight = freeRight > freeLeft;
    const radialOffset = isMenuOpen ? (isMobile ? 86 : 128) : (isMobile ? 32 : 46);

    if (placeRight) {
      targetX = atomX + radialOffset;
      tailSide = 'left';
    } else {
      targetX = atomX - bubbleWidth - radialOffset;
      tailSide = 'right';
    }
    targetY = atomY - bubbleHeight * 0.5;

    // Clamp inside viewport
    const pad = 14;
    targetX = Math.max(pad, Math.min(winW - bubbleWidth - pad, targetX));
    targetY = Math.max(68, Math.min(winH - bubbleHeight - pad, targetY)); // below nav

    // Spring / lerp lag
    const lerpRate = reduceMotion ? 1.0 : 0.16;
    currentX += (targetX - currentX) * lerpRate;
    currentY += (targetY - currentY) * lerpRate;

    bubble.style.transform = `translate3d(${currentX.toFixed(1)}px, ${currentY.toFixed(1)}px, 0)`;

    // Update tail orientation
    if (tailEl) {
      if (tailSide === 'left') {
        tailEl.className = 'atom-bubble-tail tail-left';
      } else {
        tailEl.className = 'atom-bubble-tail tail-right';
      }
    }
  }
  requestAnimationFrame(updateBubblePosition);

  /* ═══════════════════════════════════════════════
     SHOW & HIDE LOGIC (Typing & Transitions)
     ═══════════════════════════════════════════════ */
  function hideBubble(immediate = false) {
    if (!isVisible) return;
    if (typingInterval) clearInterval(typingInterval);
    if (activeTimeout) clearTimeout(activeTimeout);

    if (immediate || reduceMotion) {
      bubble.classList.remove('active', 'fading');
      bubble.setAttribute('aria-hidden', 'true');
      isVisible = false;
      isFading = false;
      if (pendingMessage) {
        const next = pendingMessage;
        pendingMessage = null;
        showMessage(next.label, next.text);
      }
      return;
    }

    isFading = true;
    bubble.classList.add('fading');
    bubble.classList.remove('active');

    activeTimeout = setTimeout(() => {
      bubble.classList.remove('fading');
      bubble.setAttribute('aria-hidden', 'true');
      isVisible = false;
      isFading = false;
      if (pendingMessage) {
        const next = pendingMessage;
        pendingMessage = null;
        showMessage(next.label, next.text);
      }
    }, 280);
  }

  function showMessage(label, text, forceReplace = false) {
    if (!guideEnabled) return;

    // Queue at most one pending message if currently busy (unless forceReplace is active)
    if (isVisible && !isFading && !forceReplace) {
      pendingMessage = { label, text };
      hideBubble(false);
      return;
    }

    if (typingInterval) clearInterval(typingInterval);
    if (activeTimeout) clearTimeout(activeTimeout);

    isVisible = true;
    isFading = false;
    bubble.setAttribute('aria-hidden', 'false');
    bubble.classList.remove('fading');
    bubble.classList.add('active');

    labelEl.textContent = label;
    messageEl.textContent = '';
    cursorEl.style.display = 'none';

    // Reduced motion shortcut: no typing animation
    if (reduceMotion) {
      dotsEl.style.display = 'none';
      messageEl.textContent = text;
      activeTimeout = setTimeout(() => hideBubble(), 3800);
      return;
    }

    // Thinking state: 3 bouncing dots (skip if forceReplace / secret fact for instant feedback)
    if (forceReplace) {
      dotsEl.style.display = 'none';
      cursorEl.style.display = 'inline-block';
      let charIndex = 0;
      typingInterval = setInterval(() => {
        if (charIndex < text.length) {
          messageEl.textContent += text[charIndex];
          charIndex++;
        } else {
          clearInterval(typingInterval);
          cursorEl.style.display = 'none';
          activeTimeout = setTimeout(() => hideBubble(), 3800);
        }
      }, 22);
      return;
    }

    dotsEl.style.display = 'flex';
    activeTimeout = setTimeout(() => {
      dotsEl.style.display = 'none';
      cursorEl.style.display = 'inline-block';

      let charIndex = 0;
      typingInterval = setInterval(() => {
        if (charIndex < text.length) {
          messageEl.textContent += text[charIndex];
          charIndex++;
        } else {
          clearInterval(typingInterval);
          cursorEl.style.display = 'none';
          activeTimeout = setTimeout(() => hideBubble(), 3500);
        }
      }, 25);
    }, 400);
  }

  /* ═══════════════════════════════════════════════
     SECTION INTERSECTION OBSERVER TRIGGER
     ═══════════════════════════════════════════════ */
  function setupSectionObserver() {
    const sectionIds = ['hero', 'about', 'experience', 'projects', 'certifications', 'contact'];
    const sectionEls = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);

    // Also check for CV / resume section or anchor
    const cvEl = document.getElementById('resume') || document.querySelector('.resume-section');
    if (cvEl) sectionEls.push(cvEl);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            const id = entry.target.id || (entry.target.classList.contains('resume-section') ? 'cv' : null);
            if (!id || triggeredSections.has(id)) return;
            triggeredSections.add(id);

            const msgConfig = MESSAGES[id];
            if (msgConfig) {
              showMessage(msgConfig.label, msgConfig.text);
            }
          }
        });
      },
      { threshold: [0.2, 0.35, 0.5, 0.7] }
    );

    sectionEls.forEach((el) => observer.observe(el));

    // Welcome hero message on initial load if at top of page
    setTimeout(() => {
      if (window.scrollY < 250 && !triggeredSections.has('hero')) {
        triggeredSections.add('hero');
        showMessage(MESSAGES.hero.label, MESSAGES.hero.text);
      }
    }, 800);
  }

  /* ═══════════════════════════════════════════════
     NAV CLICKS & CTA BUTTON TRIGGERS
     ═══════════════════════════════════════════════ */
  function setupNavAndCtaTriggers() {
    const navAndCtas = document.querySelectorAll(
      'nav a[href^="#"], a[href="#projects"], a[href="#about"], a[href="#contact"], a[href="#experience"], a[href="#certifications"], a[href*="resume"], a[href*="Resume"], #viewProjectsBtn, #downloadResumeBtn'
    );

    navAndCtas.forEach((link) => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href') || '';
        let targetId = href.startsWith('#') ? href.slice(1) : '';
        if (!targetId && (href.toLowerCase().includes('resume') || link.id === 'downloadResumeBtn')) {
          targetId = 'cv';
        }

        const msgConfig = MESSAGES[targetId];
        if (!msgConfig) return;

        // Wait for atom to arrive near target heading (~200px) or after 1.2s at latest
        const startTime = performance.now();
        const targetElement = document.getElementById(targetId) ||
          document.querySelector(`header#${targetId}`) ||
          document.querySelector(href);

        function checkArrival() {
          const now = performance.now();
          const elapsed = (now - startTime) / 1000;
          const atomApi = window.__particleAtom;

          let arrived = false;
          if (atomApi && targetElement) {
            const rect = targetElement.getBoundingClientRect();
            const targetCenterY = rect.top + rect.height * 0.5;
            const atomY = window.innerHeight - atomApi.position.y;
            if (Math.abs(atomY - targetCenterY) < 220) {
              arrived = true;
            }
          }

          if (arrived || elapsed >= 1.2) {
            showMessage(msgConfig.label, msgConfig.text);
          } else {
            requestAnimationFrame(checkArrival);
          }
        }

        requestAnimationFrame(checkArrival);
      });
    });
  }

  /* ═══════════════════════════════════════════════
     CARD TENDRIL-GRIP REACTIONS (Desktop only)
     ═══════════════════════════════════════════════ */
  function setupCardGripObserver() {
    if (isMobile) return; // Skip card reactions on mobile per prompt rules

    // Observe when cards receive the .atom-card-gripped class from tendril grips
    const cardMap = [
      { key: 'PiyuGuide', selector: '.project-card, .card-surface', keyword: 'piyuguide' },
      { key: 'Siniloan', selector: '.project-card, .card-surface', keyword: 'siniloan' },
      { key: 'TagTrack', selector: '.project-card, .card-surface', keyword: 'tagtrack' },
      { key: 'PiyuClean', selector: '.project-card, .card-surface', keyword: 'piyuclean' },
    ];

    const cards = document.querySelectorAll('.project-card, .card-surface');
    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mut) => {
        if (mut.attributeName === 'class') {
          const target = mut.target;
          if (target.classList.contains('atom-card-gripped')) {
            const textContent = (target.textContent || '').toLowerCase();
            for (const item of cardMap) {
              if (textContent.includes(item.keyword) && !triggeredCards.has(item.key)) {
                triggeredCards.add(item.key);
                const cardMsg = MESSAGES.cards[item.key];
                if (cardMsg) {
                  showMessage(cardMsg.label, cardMsg.text);
                }
                break;
              }
            }
          }
        }
      });
    });

    cards.forEach((c) => mutationObserver.observe(c, { attributes: true, attributeFilter: ['class'] }));
  }

  /* ═══════════════════════════════════════════════
     ACCESSIBILITY & KEYBOARD CONTROLS (Esc Key)
     ═══════════════════════════════════════════════ */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (isMenuOpen) closeMenu();
      hideBubble(true);
    }
  });

  /* ═══════════════════════════════════════════════
     FIRST-TIME HINT (Hero 6s timeout)
     ═══════════════════════════════════════════════ */
  function setupFirstTimeHint() {
    hintTimer = setTimeout(() => {
      if (hasClickedAtom || window.scrollY > 150 || !guideEnabled) return;
      isHintActive = true;
      showMessage('GUIDE // HINT', 'Psst, click me!', true);
      const atomApi = window.__particleAtom;
      if (atomApi && typeof atomApi.triggerHintPulse === 'function') {
        atomApi.triggerHintPulse();
      }
    }, 6000);

    // Cancel as soon as user scrolls
    window.addEventListener('scroll', () => {
      if (window.scrollY > 80) cancelHint();
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════
     FOOTER TOGGLE BUTTON SETUP
     ═══════════════════════════════════════════════ */
  function setupGuideToggle() {
    const toggleBtn = document.getElementById('guideToggleBtn');
    const toggleText = document.getElementById('guideToggleText');
    const toggleDot = document.getElementById('guideToggleDot');

    function syncState() {
      if (toggleText) toggleText.textContent = `Guide: ${guideEnabled ? 'ON' : 'OFF'}`;
      if (toggleDot) {
        toggleDot.className = `w-1.5 h-1.5 rounded-full transition-colors ${
          guideEnabled ? 'bg-accent animate-pulse' : 'bg-text-muted/40'
        }`;
      }
      if (!guideEnabled) {
        hideBubble(true);
        closeMenu();
        if (clickTarget) clickTarget.style.display = 'none';
        if (menuContainer) menuContainer.style.display = 'none';
      } else {
        if (clickTarget) clickTarget.style.display = 'block';
        if (menuContainer) menuContainer.style.display = 'block';
      }
    }

    syncState();

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        guideEnabled = !guideEnabled;
        try {
          localStorage.setItem('atom_guide_enabled', guideEnabled ? 'true' : 'false');
        } catch (_) {}
        syncState();
        if (guideEnabled) {
          showMessage('GUIDE // READY', 'Guide enabled! I will point out highlights as you browse.');
        }
      });
    }
  }

  /* ═══════════════════════════════════════════════
     INITIALIZATION
     ═══════════════════════════════════════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    setupSectionObserver();
    setupNavAndCtaTriggers();
    setupCardGripObserver();
    setupFirstTimeHint();
    setupGuideToggle();
  }
})();
