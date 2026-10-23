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
      text: 'Meet Gerald, a Cum Laude IT graduate who has already shipped two production systems.',
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
     BUBBLE DOM CREATION & SETUP
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

  /* ═══════════════════════════════════════════════
     POSITION TRACKING & SPRING LAG
     ═══════════════════════════════════════════════ */
  let currentX = window.innerWidth * 0.7;
  let currentY = window.innerHeight * 0.4;
  let targetX = currentX;
  let targetY = currentY;
  let bubbleWidth = 240;
  let bubbleHeight = 90;
  let tailSide = 'left'; // 'left' or 'right'

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

    bubbleWidth = isMobile ? 190 : 240;
    const rect = bubble.getBoundingClientRect();
    if (rect.height > 20) bubbleHeight = rect.height;

    // Place the bubble on the side of the atom with the most free room (left or right)
    const freeRight = winW - atomX;
    const freeLeft = atomX;
    const placeRight = freeRight > freeLeft;

    if (placeRight) {
      targetX = atomX + (isMobile ? 32 : 46);
      tailSide = 'left';
    } else {
      targetX = atomX - bubbleWidth - (isMobile ? 32 : 46);
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

  function showMessage(label, text) {
    if (!guideEnabled) return;

    // Queue at most one pending message if currently busy
    if (isVisible && !isFading) {
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

    // Reduced motion shortcut
    if (reduceMotion) {
      dotsEl.style.display = 'none';
      messageEl.textContent = text;
      activeTimeout = setTimeout(() => hideBubble(), 3500);
      return;
    }

    // Thinking state: 3 bouncing dots for 400ms
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
          // Hold message for 3.5 seconds then fade
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
      hideBubble(true);
    }
  });

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
      if (!guideEnabled) hideBubble(true);
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
    setupGuideToggle();
  }
})();
