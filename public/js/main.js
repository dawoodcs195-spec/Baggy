/* ═══════════════════════════════════════════════════════════════
   BA GGY - Frontend JavaScript (Polished)
   GSAP ScrollTrigger | Reduced Motion | Accessible | SVG Icons
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Helpers ──────────────────────────────────────────────────
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  // ─── 0. CSRF: auto-attach token to every fetch ────────────────
  const CSRF_TOKEN = document.body?.dataset.csrf || '';
  const _origFetch = window.fetch;
  window.fetch = function (input, init = {}) {
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      init.headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (!init.headers.has('X-CSRF-Token') && CSRF_TOKEN) {
        init.headers.set('X-CSRF-Token', CSRF_TOKEN);
        if (input instanceof Request) {
          input = new Request(input, { headers: init.headers });
        }
      }
    }
    return _origFetch.call(this, input, init);
  };

  // ─── 0b. Image URL resolver + guarded fallback ────────────────
  // Cloudinary URLs pass through; legacy bare filenames resolve locally.
  function imgUrlFor(src) {
    const v = String(src || '').trim();
    if (!v) return '/public/images/placeholder.png';
    if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/')) return v;
    return '/public/images/' + v;
  }
  window.imgUrlFor = imgUrlFor;
  // Swap failed product images to the placeholder exactly once (prevents 404 retry loops).
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = '1';
    img.src = '/public/images/placeholder.png';
  }, true);

  // ─── 1. Reduced Motion ────────────────────────────────────────
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── 2. Character Splitter ────────────────────────────────────
  function splitText(el) {
    if (!el || el.dataset.split || prefersReducedMotion) return;
    el.dataset.split = '1';
    const text = el.textContent.trim();
    el.textContent = '';
    [...text].forEach((char, i) => {
      const span = document.createElement('span');
      span.className = 'char';
      span.style.animationDelay = `${0.05 + i * 0.045}s`;
      span.textContent = char === ' ' ? ' ' : char;
      el.appendChild(span);
    });
  }
  $$('[data-split-text]').forEach(splitText);

  // ─── 3. Scroll Reveal (IntersectionObserver) ──────────────────
  // Fallback: force-reveal ALL data-reveal elements after 3 seconds
  // This fixes cases where IntersectionObserver doesn't fire (mobile Safari, etc.)
  // Note: .categories .category-card entrances are owned by GSAP (below);
  // keep them out of the CSS reveal system to avoid double-animation conflicts.
  const REVEAL_SELECTORS = '[data-reveal], .footer-grid';
  const revealAll = () => {
    $$(REVEAL_SELECTORS).forEach((el) => {
      if (!el.classList.contains('revealed')) {
        if (prefersReducedMotion) {
          el.style.opacity = '1';
          el.style.transform = 'none';
        }
        el.classList.add('revealed');
      }
    });
  };
  // Reveal only above-fold elements on load so below-fold sections
  // animate on scroll (editorial entrances)
  const revealInView = () => {
    $$(REVEAL_SELECTORS).forEach((el) => {
      if (el.classList.contains('revealed')) return;
      const rect = el.getBoundingClientRect();
      // In view now, or already scrolled past (fast jump / anchor link)
      if ((rect.top < window.innerHeight && rect.bottom > 0) || rect.bottom <= 0) {
        if (prefersReducedMotion) {
          el.style.opacity = '1';
          el.style.transform = 'none';
        }
        el.classList.add('revealed');
      }
    });
  };
  window.addEventListener('DOMContentLoaded', revealInView);
  // Scroll fallback: the IntersectionObserver can miss elements during
  // fast jumps — this guarantees nothing stays invisible after passing it
  let revealTicking = false;
  window.addEventListener('scroll', () => {
    if (!revealTicking) {
      revealTicking = true;
      requestAnimationFrame(() => { revealInView(); revealTicking = false; });
    }
  }, { passive: true });
  // No IntersectionObserver support: reveal everything immediately
  if (typeof IntersectionObserver === 'undefined') revealAll();

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        if (prefersReducedMotion) {
          e.target.style.opacity = '1';
          e.target.style.transform = 'none';
        }
        e.target.classList.add('revealed');
        revealObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });
  $$(REVEAL_SELECTORS).forEach((el) => {
    if (prefersReducedMotion) {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.classList.add('revealed');
    } else {
      revealObserver.observe(el);
    }
  });

  // ─── 4. Header scroll shadow + hide-on-scroll-down / reveal-on-scroll-up ──
  const header = $('.site-header');
  if (header) {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      header.classList.toggle('scrolled', y > 20);
      // Directional auto-hide: past the hero, scrolling down hides the header;
      // any upward scroll brings it back. Small deadzone prevents jitter
      // (trackpad feathering, iOS rubber-banding).
      if (!prefersReducedMotion) {
        const dy = y - lastY;
        if (y > 160 && dy > 4) header.classList.add('nav-hidden');
        else if (dy < -4 || y <= 160) header.classList.remove('nav-hidden');
      }
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Keep --header-h in sync with the real rendered header height
  // (on mobile the editorial header wraps to two rows ≈150px, but the
  // CSS token stays 72px — hero spacing then under-reserves space)
  if (header) {
    const syncHeaderH = () => {
      document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
    };
    syncHeaderH();
    window.addEventListener('resize', syncHeaderH, { passive: true });
    window.addEventListener('load', syncHeaderH);
  }

  // ─── 5. GSAP Scroll Animations ────────────────────────────────
  if (window.gsap && window.ScrollTrigger && !prefersReducedMotion) {
    gsap.registerPlugin(ScrollTrigger);

    // Hero parallax
    const heroTitle = $('.hero-title');
    if (heroTitle) {
      gsap.to(heroTitle, {
        scrollTrigger: {
          trigger: '.hero-section',
          start: 'top top',
          end: 'bottom top',
          scrub: 1.5
        },
        y: -80,
        opacity: 0.3,
        ease: 'none'
      });
    }

    // Layered hero parallax: giant word drifts up faster than the cutout
    const heroGiant = $('.hero-giant');
    const heroCutout = $('.hero-cutout');
    if (heroGiant && $('.hero-layered')) {
      gsap.to(heroGiant, {
        scrollTrigger: { trigger: '.hero-layered', start: 'top top', end: 'bottom top', scrub: 1.2 },
        y: -110,
        ease: 'none'
      });
    }
    if (heroCutout && $('.hero-layered')) {
      gsap.to(heroCutout, {
        scrollTrigger: { trigger: '.hero-layered', start: 'top top', end: 'bottom top', scrub: 1.2 },
        y: -38,
        ease: 'none'
      });
    }

    // Section headers
    $$('.section-header h2, .section-header > div').forEach((el) => {
      gsap.from(el, {
        scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' },
        y: 50,
        opacity: 0,
        duration: 0.9,
        ease: 'power3.out'
      });
    });

    // Trust badges stagger (homepage only — guard avoids GSAP warnings elsewhere)
    if ($('.trust-badges')) {
      gsap.from('.trust-badge', {
        scrollTrigger: { trigger: '.trust-badges', start: 'top 85%' },
        y: 24,
        opacity: 0,
        duration: 0.6,
        stagger: 0.12,
        ease: 'power3.out'
      });
    }

    // ── Case Study Flip Stack (Essentials) — ported from componentry.dev ──
    // Scroll-pinned deck: each card folds upward (rotateX) and slides away to
    // reveal the next. One viewport of scroll per transition; spring feel via scrub.
    const flipStack = $('[data-flip-stack]');
    if (flipStack) {
      const track = flipStack.querySelector('[data-flip-track]');
      const stage = flipStack.querySelector('.flip-stack-stage');
      const cards = gsap.utils.toArray('.flip-card', flipStack);
      const n = cards.length;
      if (n > 0 && track && stage) {
        // Cards authored in reading order; first card is top of deck.
        cards.forEach((card, i) => { card.style.zIndex = String(n - i); });
        track.style.setProperty('--flip-height', (n + 1) * 100 + 'vh');

        const seg = 1 / n;
        const stackGap = Math.min(24, 72 / Math.max(n - 1, 1));
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: track,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.6,
            invalidateOnRefresh: true
          }
        });

        cards.forEach((card, i) => {
          const exitStart = i * seg;
          const stackedOffset = stackGap * i;
          // Resting deck state for cards beneath the top one
          if (i > 0) {
            const restOffset = Math.min(i * 12, 34);
            const restScale = 1 - Math.min(i * 0.012, 0.035);
            gsap.set(card, { y: restOffset, scale: restScale, transformOrigin: '50% 100%' });
            // Rise into place as the card above folds away
            tl.to(card, { y: stackedOffset, scale: 1, ease: 'none', duration: seg * 0.7 }, Math.max(0, exitStart - seg * 0.7));
          }
          // Exit: fold upward and out of the clipped stage
          tl.to(card, { yPercent: -118, rotateX: 22, ease: 'none', duration: seg, transformOrigin: '50% 50%' }, exitStart);
        });

        // ── HUD: card counter (01 / 04) + progress bar ──
        const counterEl = stage.querySelector('.flip-counter-current');
        const fillEl = stage.querySelector('.flip-stack-progress-fill');
        const pad = (v) => String(v).padStart(2, '0');
        tl.eventCallback('onUpdate', () => {
          const p = tl.progress();
          // counter: which card is currently on top (its exit segment is active)
          const top = p >= 1 ? n : Math.min(n, Math.floor(p / seg) + 1);
          if (counterEl) counterEl.textContent = pad(top);
          if (fillEl) fillEl.style.transform = 'scaleX(' + p + ')';
        });
        ScrollTrigger.refresh();
      }
    }

    // Banner content
    if ($('.banner-section')) {
      gsap.from('.banner-content > *', {
        scrollTrigger: { trigger: '.banner-section', start: 'top 75%' },
        y: 30,
        opacity: 0,
        duration: 0.7,
        stagger: 0.15,
        ease: 'power3.out'
      });
    }

    // (Featured products + footer entrances are owned by the CSS reveal
    // system — data-reveal/.footer-grid — so they still animate if GSAP
    // ever fails to load. Only transform-scrub parallax uses GSAP here.)

    // Recalculate trigger positions once images/fonts finish loading,
    // so entrance animations fire even if the page height changed late
    window.addEventListener('load', () => ScrollTrigger.refresh());

    // Shop sidebar
    if ($('.shop-sidebar')) {
      gsap.from('.shop-sidebar > *', {
        scrollTrigger: { trigger: '.shop-sidebar', start: 'top 85%' },
        x: -20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: 'power2.out'
      });
    }
  }

  // ─── 6. Cart Utilities ─────────────────────────────────────────
  async function fetchCart() {
    try {
      const res = await fetch('/api/cart');
      return res.ok ? res.json() : [];
    } catch { return []; }
  }

  function updateCartCount() {
    fetchCart().then((cart) => {
      const count = Array.isArray(cart) ? cart.reduce((s, i) => s + i.qty, 0) : 0;
      const badge = $('.cart-count');
      if (!badge) return;
      badge.textContent = count;
      const hidden = count === 0;
      badge.classList.toggle('hidden', hidden);
      if (count > 0) {
        badge.classList.remove('pop');
        void badge.offsetWidth; // reflow
        badge.classList.add('pop');
      }
    });
  }

  async function addToCart(productId, size, qty = 1) {
    try {
      const res = await fetch('/api/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, size: size || 'M', qty })
      });
      const data = await res.json();
      if (data.ok) { updateCartCount(); return true; }
    } catch { /* network error */ }
    return false;
  }

  // ─── 7. Toast Notifications ───────────────────────────────────
  function showToast(message, type = 'success') {
    const existing = $('.toast-container');
    if (existing) existing.remove();
    const container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      background: ${type === 'success' ? '#0a0a0a' : '#b8002f'};
      color: #fff;
      padding: 14px 20px;
      border-radius: 4px;
      font-size: 0.875rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: auto;
      animation: toastIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
    `;
    toast.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${type === 'success'
          ? '<polyline points="20 6 9 17 4 12"/>'
          : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'}
      </svg>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    document.body.appendChild(container);

    // Inject animation
    if (!$('#toast-animations')) {
      const style = document.createElement('style');
      style.id = 'toast-animations';
      style.textContent = `
        @keyframes toastIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }
        @keyframes toastOut { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(40px); } }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => container.remove(), 300);
    }, 2800);
  }

  // ─── 8. Quick Add Buttons ────────────────────────────────────
  $$('.quick-add').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = '...';
      const ok = await addToCart(id, 'M', 1);
      if (ok) showToast('Added to cart!');
      else showToast('Failed to add', 'error');
      btn.disabled = false;
      btn.textContent = 'Quick Add';
    });
  });

  // ─── 9. Product Card Click (navigate to PDP) ──────────────────
  $$('.product-card').forEach((card) => {
    const handleClick = (e) => {
      if (e.target.closest('.quick-add') || e.target.closest('.action-btn')) return;
      const id = card.querySelector('[data-id]')?.dataset?.id
              || card.dataset?.productId;
      if (id) window.location.href = `/product/${id}`;
    };
    card.addEventListener('click', handleClick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handleClick(e);
    });
  });

  // ─── 10. Wishlist Toggle (only for .wishlist-toggle, NOT the .wishlist-btn header link) ──
  $$('.wishlist-toggle').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      let wish = JSON.parse(localStorage.getItem('baggy_wishlist') || '[]');
      const idx = wish.indexOf(id);
      if (idx > -1) {
        wish.splice(idx, 1);
        btn.classList.remove('active');
        const svg = btn.querySelector('svg');
        if (svg) { svg.style.fill = 'none'; svg.style.stroke = 'currentColor'; }
        showToast('Removed from wishlist');
      } else {
        wish.push(id);
        btn.classList.add('active');
        const svg = btn.querySelector('svg');
        if (svg) { svg.style.fill = 'var(--color-accent)'; svg.style.stroke = 'var(--color-accent)'; }
        showToast('Added to wishlist');
      }
      localStorage.setItem('baggy_wishlist', JSON.stringify(wish));
      // Update header badge
      const badge = document.querySelector('.wishlist-btn .badge');
      if (badge) {
        badge.textContent = wish.length;
        badge.classList.toggle('hidden', wish.length === 0);
      }
    });
  });

  // Mark already-saved items on page load
  const savedIds = JSON.parse(localStorage.getItem('baggy_wishlist') || '[]');
  savedIds.forEach((id) => {
    document.querySelectorAll(`.wishlist-toggle[data-id="${id}"]`).forEach((b) => {
      b.classList.add('active');
      const svg = b.querySelector('svg');
      if (svg) { svg.style.fill = 'var(--color-accent)'; svg.style.stroke = 'var(--color-accent)'; }
    });
  });
  // Update header wishlist badge
  const headerWishBadge = document.querySelector('.wishlist-btn .badge');
  if (headerWishBadge) {
    headerWishBadge.textContent = savedIds.length;
    headerWishBadge.classList.toggle('hidden', savedIds.length === 0);
  }

  // ─── 11. Product Page Interactions ───────────────────────────
  const productPage = $('.product-page');
  if (productPage) {
    const productId = productPage.dataset.productId;

    // Size buttons
    $$('.size-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.size-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        const inp = $('#selected-size');
        if (inp) inp.value = btn.dataset.size;
      });
    });

    // Qty controls
    const qtyInput = $('#qty-input');
    $('#qty-minus')?.addEventListener('click', () => {
      const v = parseInt(qtyInput?.value) || 1;
      if (v > 1) qtyInput.value = v - 1;
    });
    $('#qty-plus')?.addEventListener('click', () => {
      const v = parseInt(qtyInput?.value) || 1;
      const max = parseInt(qtyInput?.max) || 99;
      if (v < max) qtyInput.value = v + 1;
    });

    // Add to cart
    const addBtn = $('.add-to-cart');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const size = $('#selected-size')?.value || 'M';
        const qty = parseInt(qtyInput?.value) || 1;
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
        const ok = await addToCart(productId, size, qty);
        if (ok) { showToast('Added to cart!'); } else { showToast('Failed to add', 'error'); }
        addBtn.disabled = false;
        addBtn.textContent = 'Add to Cart';
      });
    }

    // Gallery thumbs
    const mainImg = $('#main-img');
    $$('.thumb').forEach((thumb) => {
      thumb.addEventListener('click', () => {
        $$('.thumb').forEach((t) => t.classList.remove('active'));
        thumb.classList.add('active');
        if (mainImg) {
          mainImg.style.transition = 'opacity 0.2s ease';
          mainImg.style.opacity = '0';
          setTimeout(() => {
            mainImg.src = imgUrlFor(thumb.dataset.img);
            mainImg.style.opacity = '1';
          }, 200);
        }
      });
    });

    // Tabs
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === target));
      });
    });
  }

  // ─── 12. Cart Page — qty +/− (no confirm modal needed) ──────
  if ($('.cart-page')) {
    $$('.qty-minus, .qty-plus').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { id, size } = btn.dataset;
        const valueEl = btn.parentElement.querySelector('.qty-value');
        let qty = parseInt(valueEl.textContent);
        qty = btn.classList.contains('qty-minus') ? Math.max(1, qty - 1) : qty + 1;
        const res = await fetch('/api/cart/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: id, size, qty })
        });
        if (res.ok) location.reload();
      });
    });
    // Note: .cart-remove and #clear-cart handlers are in the confirm-modal section below
  }

  // ─── 13. Checkout Form ────────────────────────────────────────
  const checkoutForm = $('#checkout-form');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(checkoutForm);
      const name    = fd.get('full-name')?.trim();
      const email   = fd.get('email')?.trim();
      const phone   = fd.get('phone')?.trim();
      const address = fd.get('address')?.trim();
      const payment = fd.get('payment-method');

      // Validation
      if (!name || !email || !phone || !address) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('Please enter a valid email address', 'error');
        return;
      }
      const total = parseInt(
        document.querySelector('.checkout-summary .total span:last-child')
          ?.textContent.replace(/[^\d]/g, '') || '0', 10
      );
      const sanitize = (s) => String(s).replace(/[<>]/g, '');
      const submitBtn = checkoutForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing...';
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: sanitize(name), email: sanitize(email),
            phone: sanitize(phone), address: sanitize(address),
            payment, total,
            couponCode: String(fd.get('checkout-coupon') || '').trim().toUpperCase()
          })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Order placed successfully!');
          window.location.href = data.redirect || `/checkout/success`;
          return;
        } else {
          showToast(data.message || 'Order failed', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Place Order';
        }
      } catch {
        showToast('Network error — please try again', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place Order';
      }
    });
  }

  // ─── 14. Search / Cart button nav ─────────────────────────────
  const searchToggle = $('.search-toggle');
  const searchOverlay = $('#search-overlay');
  const searchClose   = $('.search-close');
  const openSearch  = () => {
    if (!searchOverlay) return;
    searchOverlay.classList.remove('hidden');
    requestAnimationFrame(() => searchOverlay.classList.add('open'));
    setTimeout(() => searchOverlay.querySelector('input')?.focus(), 80);
  };
  const closeSearch = () => {
    if (!searchOverlay) return;
    searchOverlay.classList.remove('open');
    setTimeout(() => searchOverlay.classList.add('hidden'), 220);
  };
  searchToggle?.addEventListener('click', (e) => { e.preventDefault(); openSearch(); });
  searchClose?.addEventListener('click', closeSearch);
  searchOverlay?.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearch();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !searchOverlay?.classList.contains('hidden')) closeSearch();
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  });

  // ─── 14b. Modal helpers ───────────────────────────────────────
  function openModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('open'));
    document.body.style.overflow = 'hidden';
    // Focus first focusable element
    setTimeout(() => {
      const focusable = modal.querySelector('input, button, [tabindex]');
      focusable?.focus();
    }, 100);
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => modal.classList.add('hidden'), 240);
    document.body.style.overflow = '';
  }
  function bindModalClose(closeBtn, modal) {
    closeBtn?.addEventListener('click', () => closeModal(modal));
  }
  // Global click handler for any modal-overlay
  $$('.modal-overlay').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
    $$('.modal-close', modal).forEach((btn) => bindModalClose(btn, modal));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openOne = $('.modal-overlay.open');
    if (openOne) closeModal(openOne);
  });

  // ─── 14c. Newsletter popup (disabled) ────────────────────────
  // const newsletterPopup = $('#newsletter-popup');
  // if (newsletterPopup && !localStorage.getItem('newsletterDismissed')) {
  //   setTimeout(() => openModal('#newsletter-popup'), 6000);
  // }
  // $('#newsletter-popup-form')?.addEventListener('submit', async (e) => {
  //   e.preventDefault();
  //   const inp = e.target.querySelector('input[type="email"]');
  //   const email = inp?.value?.trim();
  //   if (!email) return;
  //   try {
  //     const res = await fetch('/api/newsletter', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ email })
  //     });
  //     const data = await res.json();
  //     if (data.ok) {
  //       showToast('Thanks! Check your inbox.');
  //       localStorage.setItem('newsletterDismissed', '1');
  //       closeModal(newsletterPopup);
  //     } else {
  //       showToast(data.message || 'Subscription failed', 'error');
  //     }
  //   } catch {
  //     showToast('Network error', 'error');
  //   }
  // });
  // // Dismiss newsletter = remember
  // newsletterPopup?.addEventListener('click', (e) => {
  //   if (e.target.matches('.modal-close')) {
  //     localStorage.setItem('newsletterDismissed', '1');
  //   }
  // });

  // ─── 14d. Size Guide modal ───────────────────────────────────
  $$('.size-guide-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('#size-guide-modal');
    });
  });

  // ─── 14e. Quick View modal ───────────────────────────────────
  $$('.quick-view-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      try {
        const res = await fetch(`/api/product/${id}`);
        if (!res.ok) return;
        const p = await res.json();
        const img = $('#qv-img');
        const title = $('#qv-title');
        const price = $('#qv-price');
        const desc = $('#qv-desc');
        const sizes = $('#qv-sizes');
        if (img) img.src = imgUrlFor(p.images && p.images[0]);
        if (title) title.textContent = p.name;
        if (price) price.textContent = '₨' + Number(p.price).toLocaleString('en-PK');
        if (desc) desc.textContent = p.description || '';
        if (sizes) {
          sizes.innerHTML = '';
          (p.sizes || []).forEach((s) => {
            const b = document.createElement('button');
            b.className = 'size-pill';
            b.textContent = s;
            b.dataset.size = s;
            b.addEventListener('click', () => {
              $$('.size-pill', sizes).forEach(x => x.classList.remove('selected'));
              b.classList.add('selected');
            });
            sizes.appendChild(b);
          });
        }
        const addBtn = $('#qv-add-btn');
        if (addBtn) {
          addBtn.onclick = async () => {
            const sel = sizes?.querySelector('.size-pill.selected');
            const size = sel?.dataset?.size || (p.sizes?.[0]) || 'M';
            const ok = await addToCart(id, size, 1);
            if (ok) {
              showToast('Added to cart!');
              closeModal($('#quick-view-modal'));
            } else showToast('Failed to add', 'error');
          };
        }
        const viewBtn = $('#qv-view-btn');
        if (viewBtn) viewBtn.href = `/product/${id}`;
        openModal('#quick-view-modal');
      } catch { showToast('Failed to load product', 'error'); }
    });
  });

  // ─── 14f. Confirm / Alert Modal (promise-based) ──────────────
  const confirmModal = $('#confirm-modal');
  const confirmTitle = $('#confirm-title');
  const confirmMsg   = $('#confirm-message');
  const confirmIcon  = $('#confirm-icon');
  const confirmBtn   = $('#confirm-btn');
  const confirmCancelBtn = confirmModal?.querySelector('.modal-close');
  let confirmState = null; // { resolve, onConfirm, confirmed }

  function showConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', icon = 'warning', onConfirm }) {
    return new Promise((resolve) => {
      // Fallback to native dialogs if the modal isn't present
      if (!confirmModal) {
        const ok = window.confirm((title ? title + '\n\n' : '') + (message || ''));
        if (ok && typeof onConfirm === 'function') onConfirm();
        resolve(ok);
        return;
      }
      if (confirmTitle) confirmTitle.textContent = title;
      if (confirmMsg)   confirmMsg.textContent = message;
      if (confirmBtn)   confirmBtn.textContent = confirmText;
      if (confirmCancelBtn) {
        confirmCancelBtn.textContent = cancelText;
        confirmCancelBtn.style.display = cancelText ? '' : 'none';
      }
      if (confirmIcon) {
        const icons = {
          warning: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
          danger:  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
          info:    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
          success: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        };
        confirmIcon.innerHTML = icons[icon] || icons.warning;
        confirmIcon.dataset.type = icon;
      }
      confirmState = { resolve, onConfirm, confirmed: false };
      openModal('#confirm-modal');
    });
  }

  // Alert-style dialog: single OK button, themed icon
  function showAlert(message, { title = 'Notice', type = 'info' } = {}) {
    return showConfirm({ title, message, confirmText: 'OK', cancelText: '', icon: type }).then(() => true);
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const st = confirmState;
      confirmState = null;
      closeModal(confirmModal);
      if (st) {
        st.confirmed = true;
        st.resolve(true);
        if (typeof st.onConfirm === 'function') st.onConfirm();
      }
    });
  }

  // Resolve `false` when the modal is dismissed any other way
  // (cancel button, overlay click, Escape key)
  if (confirmModal) {
    new MutationObserver(() => {
      if (confirmState && !confirmModal.classList.contains('open')) {
        const st = confirmState;
        confirmState = null;
        st.resolve(false);
      }
    }).observe(confirmModal, { attributes: true, attributeFilter: ['class'] });
  }

  // Wire confirm to clear-cart
  const clearCartBtn = $('#clear-cart');
  if (clearCartBtn) {
    clearCartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showConfirm({
        title: 'Clear your cart?',
        message: 'This will remove all items from your cart. You can\'t undo this.',
        confirmText: 'Clear Cart',
        cancelText: 'Keep Items',
        icon: 'danger',
        onConfirm: async () => {
          await fetch('/api/cart/clear', { method: 'POST' });
          showToast('Cart cleared');
          setTimeout(() => location.reload(), 600);
        }
      });
    });
  }

  // Wire confirm to remove cart item
  $$('.cart-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const { id, size } = btn.dataset;
      showConfirm({
        title: 'Remove this item?',
        message: 'It will be removed from your cart.',
        confirmText: 'Remove',
        icon: 'warning',
        onConfirm: async () => {
          await fetch('/api/cart/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: id, size })
          });
          showToast('Item removed');
          setTimeout(() => location.reload(), 500);
        }
      });
    });
  });

  // ─── 15. 3D Tilt on product images (desktop only) ───────────
  if (window.matchMedia('(hover: hover)').matches && !prefersReducedMotion) {
    $$('.product-image-wrapper').forEach((wrapper) => {
      wrapper.addEventListener('mousemove', (e) => {
        const rect = wrapper.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        wrapper.style.transform = `perspective(800px) rotateY(${x * 6}deg) rotateX(${-y * 4}deg) scale(1.02)`;
      });
      wrapper.addEventListener('mouseleave', () => {
        wrapper.style.transform = 'perspective(800px) rotateY(0) rotateX(0) scale(1)';
      });
    });
  }

  // ─── 16. Sort select ──────────────────────────────────────────
  $('#sort-select')?.addEventListener('change', function () {
    const grid = $('.shop-grid');
    if (!grid) return;
    const cards = [...grid.querySelectorAll('.product-card')];
    const sorted = cards.sort((a, b) => {
      const priceA = parseInt(a.querySelector('.price-current')?.textContent.replace(/[^\d]/g, '') || '0');
      const priceB = parseInt(b.querySelector('.price-current')?.textContent.replace(/[^\d]/g, '') || '0');
      if (this.value === 'price-asc')  return priceA - priceB;
      if (this.value === 'price-desc') return priceB - priceA;
      return 0;
    });
    if (this.value === 'price-asc' || this.value === 'price-desc') {
      sorted.forEach((c) => grid.appendChild(c));
    }
  });

  // ─── 14g. FAQ Accordion ────────────────────────────────────────
  $$('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      // Close all others
      $$('.faq-item').forEach((i) => {
        i.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
        i.querySelector('.faq-answer')?.setAttribute('hidden', '');
      });
      if (!isOpen) {
        btn.setAttribute('aria-expanded', 'true');
        const answer = item.querySelector('.faq-answer');
        if (answer) answer.removeAttribute('hidden');
      }
    });
  });

  // ─── 14h. Track Order Form ───────────────────────────────────
  const trackForm = $('#track-form');
  if (trackForm) {
    trackForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orderId = $('#track-id')?.value?.trim();
      if (!orderId) return;
      const result = $('#track-result');
      const empty  = $('#track-empty');
      if (result) result.classList.add('hidden');
      if (empty)  empty.classList.add('hidden');
      try {
        const res = await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId })
        });
        const data = await res.json();
        if (data.ok && data.order) {
          const o = data.order;
          if ($('#track-order-id')) $('#track-order-id').textContent = o.orderId || orderId;
          if ($('#track-date'))     $('#track-date').textContent = new Date(o.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' });
          if ($('#track-status')) {
            $('#track-status').textContent = o.status || 'Confirmed';
            $('#track-status').className = `track-status status-${(o.status || 'confirmed').toLowerCase()}`;
          }
          // Progress: DB stores lowercase statuses ('confirmed'); match case-insensitively.
          // 'pending' maps to step 0 (Order Placed), 'confirmed' to step 1, etc.
          const statusOrder = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
          const statusLc = String(o.status || 'pending').toLowerCase();
          const stepIndex = statusOrder.indexOf(statusLc);
          // Cancelled orders show zero progress
          const progressIndex = statusLc === 'cancelled' ? -1 : stepIndex;
          if ($('#track-bar')) {
            $('#track-bar').style.width = progressIndex < 0 ? '0%' : `${Math.max(0, Math.min(100, ((progressIndex + 1) / 5) * 100))}%`;
          }
          // Connected tracker line: red fill while in progress, green when delivered.
          // Line runs from the first dot (10%) to the last completed dot; each step is 20% wide.
          const trackStepsEl = $('#track-steps');
          if (trackStepsEl) {
            trackStepsEl.classList.toggle('delivered', statusLc === 'delivered');
            if (progressIndex < 0) {
              trackStepsEl.removeAttribute('data-progress');
            } else {
              trackStepsEl.setAttribute('data-progress', '');
              trackStepsEl.style.setProperty('--progress', Math.round(progressIndex * 20));
            }
          }
          // Steps: completed for every stage up to current; date from trackingSteps if present
          $$('.track-step').forEach((step, i) => {
            const done = progressIndex >= 0 && i <= progressIndex;
            step.classList.toggle('completed', done);
            step.classList.toggle('active', progressIndex >= 0 && i === progressIndex);
            const small = step.querySelector('small');
            if (small) {
              let dateVal = null;
              if (Array.isArray(o.trackingSteps) && o.trackingSteps[i] && o.trackingSteps[i].date) {
                dateVal = o.trackingSteps[i].date;
              }
              small.textContent = done ? (dateVal ? new Date(dateVal).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : '✓') : '';
            }
          });
          // Items with thumbnails, names, sizes, prices + order summary
          if ($('#track-items')) {
            const escTrack = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const itemsHtml = (o.items || []).map((item) => `
              <div class="track-item">
                <img src="${escTrack(window.imgUrlFor ? window.imgUrlFor(item.image) : item.image || '')}" alt="" loading="lazy" decoding="async" />
                <div class="track-item-info"><strong>${escTrack(item.name)}</strong><span>Size ${escTrack(item.size)} · Qty ${escTrack(item.qty)}</span></div>
                <span class="track-item-price">₨${Number(item.price * item.qty).toLocaleString('en-PK')}</span>
              </div>
            `).join('');
            const payLabels = { cod: 'Cash on Delivery', card: 'Card', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank Transfer' };
            const summary = `
              <div class="track-summary">
                <div><span>Subtotal</span><span>₨${Number(o.subtotal || 0).toLocaleString('en-PK')}</span></div>
                <div><span>Shipping</span><span>${Number(o.shipping || 0) === 0 ? 'Free' : '₨' + Number(o.shipping).toLocaleString('en-PK')}</span></div>
                <div><span>Payment</span><span>${escTrack(payLabels[o.payment] || o.payment || '—')}</span></div>
                <div class="track-total-row"><span>Total</span><span>₨${Number(o.total || 0).toLocaleString('en-PK')}</span></div>
              </div>
            `;
            $('#track-items').innerHTML = itemsHtml + summary;
          }
          // Customer
          if ($('#track-customer-info')) {
            const c = o.customer || {};
            const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            $('#track-customer-info').innerHTML = `${esc(c.name)}<br>${esc(c.phone)}<br>${esc(c.address)}`;
          }
          if (result) result.classList.remove('hidden');
        } else {
          if (empty) empty.classList.remove('hidden');
        }
      } catch {
        if (empty) empty.classList.remove('hidden');
      }
    });
  }

  // ─── 14i. Contact Form ────────────────────────────────────────
  const contactForm = $('#contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(contactForm);
      const sanitize = (s) => String(s).replace(/[<>]/g, '');
      const payload = {
        name:    sanitize(fd.get('name') || ''),
        email:   sanitize(fd.get('email') || ''),
        subject: sanitize(fd.get('subject') || 'Contact Form'),
        message: sanitize(fd.get('message') || '')
      };
      if (!payload.name || !payload.email || !payload.message) {
        showToast('Please fill in name, email, and message', 'error');
        return;
      }
      const btn = contactForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Message sent! We\'ll reply within 24 hours.');
          window.location.href = '/contact/thankyou';
        } else {
          showToast(data.message || 'Failed to send', 'error');
          btn.disabled = false;
          btn.textContent = 'Send Message';
        }
      } catch {
        showToast('Network error — please try again', 'error');
        btn.disabled = false;
        btn.textContent = 'Send Message';
      }
    });
  }

  // ─── 14j. Account Tabs ────────────────────────────────────────
  $$('.account-nav a[data-tab]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = link.dataset.tab;
      $$('.account-nav a').forEach((l) => l.classList.toggle('active', l === link));
      $$('.account-tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${tab}`));
    });
  });

  // ─── 14k. Wishlist ───────────────────────────────────────────
  const wishlistGrid = $('#wishlist-grid');
  const wishlistEmpty = $('#wishlist-empty');
  const wishlistItems = JSON.parse(localStorage.getItem('baggy_wishlist') || '[]');

  function renderWishlist() {
    if (!wishlistGrid) return;
    if (wishlistItems.length === 0) {
      if (wishlistGrid) wishlistGrid.classList.add('hidden');
      if (wishlistEmpty) wishlistEmpty.classList.remove('hidden');
      return;
    }
    if (wishlistEmpty) wishlistEmpty.classList.add('hidden');
    wishlistGrid.classList.remove('hidden');
    wishlistGrid.innerHTML = wishlistItems.map((id) => `
      <div class="product-card" data-product-id="${id}" style="cursor:pointer;">
        <a href="/product/${id}" class="product-card-link"></a>
        <div class="product-image-wrapper">
          <div class="product-badge">Saved</div>
          <button class="action-btn wishlist-toggle active" data-id="${id}" aria-label="Remove from wishlist">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="var(--color-accent)" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
        </div>
        <div class="product-info">
          <p class="product-name">Loading...</p>
          <div class="product-price">
            <span class="price-current">—</span>
          </div>
        </div>
      </div>
    `).join('');

    // Load product data
    wishlistItems.forEach(async (id) => {
      try {
        const res = await fetch(`/api/product/${id}`);
        if (!res.ok) return;
        const p = await res.json();
        const card = wishlistGrid.querySelector(`[data-product-id="${id}"]`);
        if (!card) return;
        const wrapper = card.querySelector('.product-image-wrapper');
        if (wrapper) {
          const imgUrl = imgUrlFor(p.images && p.images[0]);
          wrapper.style.backgroundImage = `url(${imgUrl})`;
          wrapper.style.backgroundSize = 'cover';
          wrapper.style.backgroundPosition = 'center';
          wrapper.style.minHeight = '300px';
        }
        if (card.querySelector('.product-name')) card.querySelector('.product-name').textContent = p.name;
        if (card.querySelector('.price-current')) card.querySelector('.price-current').textContent = '₨' + Number(p.price).toLocaleString('en-PK');
      } catch {}
    });

    // Toggle wishlist
    wishlistGrid.querySelectorAll('.wishlist-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = wishlistItems.indexOf(btn.dataset.id);
        if (idx > -1) { wishlistItems.splice(idx, 1); localStorage.setItem('baggy_wishlist', JSON.stringify(wishlistItems)); }
        renderWishlist();
        showToast('Removed from wishlist');
      });
    });
  }

  if (wishlistGrid) {
    renderWishlist();
    // Update wishlist badge in header
    const wishBadge = document.querySelector('.wishlist-btn .badge');
    if (wishBadge) {
      wishBadge.textContent = wishlistItems.length;
      wishBadge.classList.toggle('hidden', wishlistItems.length === 0);
    }
  }

  // (Global wishlist toggle handled above at section 10)

  // ─── 14m. 404 page confetti-style highlight ─────────────────
  if ($('.error-page')) {
    if (typeof gsap !== 'undefined') {
      $$('.error-actions a').forEach((link) => {
        link.addEventListener('mouseenter', () => gsap.to(link, { scale: 1.05, duration: 0.2 }));
        link.addEventListener('mouseleave', () => gsap.to(link, { scale: 1, duration: 0.2 }));
      });
    }
  }

  // ─── 14L. Wishlist API sync ─────────────────────────────────
  // Sync the in-page wishlist with the server session.
  // The wishlist page now uses the server-backed list (rendered by EJS),
  // but toggles need to hit /api/wishlist/toggle to stay in sync.
  function syncWishlistFromServer(then) {
    fetch('/api/wishlist')
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (Array.isArray(list)) {
          localStorage.setItem('baggy_wishlist', JSON.stringify(list.map(i => i.productId)));
        }
        if (typeof then === 'function') then(list);
      })
      .catch(() => {
        if (typeof then === 'function') then([]);
      });
  }

  // Wire wishlist page toggle buttons to the API
  function wireWishlistApiToggles() {
    $$('.wishlist-item-remove, .wishlist-item-add-cart-btn, .wishlist-item-add-cart').forEach(btn => {
      // Only attach if we haven't already
      if (btn.dataset.apiWired) return;
      btn.dataset.apiWired = '1';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const productId = btn.dataset.productId;
        if (!productId) return;
        btn.disabled = true;
        try {
          const res = await fetch('/api/wishlist/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId })
          });
          const data = await res.json();
          if (data.ok) {
            syncWishlistFromServer();
            // Re-render the page list
            window.location.reload();
          } else {
            showToast(data.message || 'Could not update wishlist', 'error');
          }
        } catch {
          showToast('Network error', 'error');
        }
        btn.disabled = false;
      });
    });
  }

  // On the wishlist page, render from server list instead of localStorage
  const wishlistPageGrid = $('#wishlist-grid');
  if (wishlistPageGrid) {
    // The server already rendered the list; just wire the remove/add buttons
    wireWishlistApiToggles();
    // Also handle "Clear wishlist"
    const clearBtn = $('#clear-wishlist');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/wishlist/clear', { method: 'POST' });
          if (res.ok) window.location.reload();
        } catch {}
      });
    }
  }

  // Keep the product/shop wishlist toggles in sync with the server too
  // (they currently use localStorage; upgrade them to also hit the API)
  $$('.wishlist-toggle').forEach(btn => {
    const original = btn._wishlistHandler;
    btn.addEventListener('click', async (e) => {
      // The existing handler already toggles localStorage + UI.
      // We run it first (it's attached above), then sync to server.
      // Guard: avoid double-firing if this handler is the original one.
      if (btn.dataset.wishlistApiFired) return;
      btn.dataset.wishlistApiFired = '1';
      const id = btn.dataset.id;
      if (!id) return;
      const wasAdded = btn.classList.contains('active');
      try {
        const res = await fetch('/api/wishlist/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: id })
        });
        const data = await res.json();
        if (data.ok) {
          // Update header badge
          const badge = document.querySelector('.wishlist-btn .badge');
          if (badge) {
            badge.textContent = (data.wishlist || []).length;
            badge.classList.toggle('hidden', (data.wishlist || []).length === 0);
          }
        } else {
          // Revert UI to prior state
          if (wasAdded) {
            btn.classList.remove('active');
            const svg = btn.querySelector('svg');
            if (svg) { svg.style.fill = 'none'; svg.style.stroke = 'currentColor'; }
          } else {
            btn.classList.add('active');
            const svg = btn.querySelector('svg');
            if (svg) { svg.style.fill = 'var(--color-accent)'; svg.style.stroke = 'var(--color-accent)'; }
          }
        }
      } catch {}
      delete btn.dataset.wishlistApiFired;
    });
  });

  // ─── 14M. User menu ──────────────────────────────────────────
  const userMenuTrigger = $('#user-menu-trigger');
  const userMenu = $('#user-menu');
  if (userMenuTrigger && userMenu) {
    userMenuTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      userMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!userMenu?.classList.contains('hidden') && !userMenu.contains(e.target) && e.target !== userMenuTrigger && !userMenuTrigger.contains(e.target)) {
        userMenu.classList.add('hidden');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && userMenu && !userMenu.classList.contains('hidden')) {
        userMenu.classList.add('hidden');
      }
    });
    const logoutBtn = $('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch {}
        window.location.href = '/';
      });
    }
  }

  // ─── 14M2. Phone 3-dot navigation menu ──────────────────────────
  const navDotsBtn = $('#nav-dots-btn');
  const mainNav = $('#main-nav');
  if (navDotsBtn && mainNav) {
    const setNavOpen = (open) => {
      mainNav.classList.toggle('dots-open', open);
      navDotsBtn.setAttribute('aria-expanded', String(open));
    };
    navDotsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setNavOpen(!mainNav.classList.contains('dots-open'));
    });
    document.addEventListener('click', (e) => {
      if (mainNav.classList.contains('dots-open') && !mainNav.contains(e.target) && !navDotsBtn.contains(e.target)) {
        setNavOpen(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mainNav.classList.contains('dots-open')) setNavOpen(false);
    });
    // Close after tapping a link (phone navigation)
    mainNav.addEventListener('click', (e) => {
      if (e.target.closest('a')) setNavOpen(false);
    });
  }

  // ─── 14N. Admin: order status modal + pagination + live search ──
  const statusModal = $('#status-modal');
  const statusOrderIdInput = $('#status-order-id');
  const statusSelect = $('#status-select');
  const statusModalTitle = $('#status-modal-title');
  const statusModalSub = $('#status-modal-sub');
  const statusForm = $('#status-form');
  const statusError = $('#status-error');

  if (statusForm) {
    statusForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orderId = statusOrderIdInput?.value;
      const status = statusSelect?.value;
      if (!orderId || !status) return;
      try {
        const res = await fetch(`/admin/order/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        const data = await res.json();
        if (data.ok) {
          closeModal(statusModal);
          showToast('Order status updated');
          setTimeout(() => location.reload(), 500);
        } else {
          if (statusError) {
            statusError.textContent = data.message || 'Update failed';
            statusError.style.display = 'block';
          }
        }
      } catch {
        if (statusError) {
          statusError.textContent = 'Network error';
          statusError.style.display = 'block';
        }
      }
    });
  }

  $$('.status-picker').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.orderId;
      const current = btn.dataset.currentStatus || 'pending';
      if (!orderId) return;
      if (statusOrderIdInput) statusOrderIdInput.value = orderId;
      if (statusSelect) statusSelect.value = current;
      if (statusModalSub) statusModalSub.textContent = `Order ${orderId} is currently ${current}.`;
      if (statusModalTitle) statusModalTitle.textContent = `Change Order ${orderId}`;
      if (statusError) statusError.style.display = 'none';
      openModal('#status-modal');
    });
  });

  // Admin pagination
  $$('.pagination-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.page;
      let next = null;
      if (target === 'prev') {
        const cur = parseInt($('.pagination-btn.active')?.textContent, 10) || 1;
        next = Math.max(1, cur - 1);
      } else if (target === 'next') {
        const cur = parseInt($('.pagination-btn.active')?.textContent, 10) || 1;
        const total = parseInt($('.pagination-info')?.textContent?.match(/\d+/)?.[0] || '1', 10);
        next = Math.min(total, cur + 1);
      } else if (target) {
        next = parseInt(target, 10);
      }
      if (next === null || next === parseInt($('.pagination-btn.active')?.textContent, 10) || next < 1) return;
      const url = new URL(window.location.href);
      url.searchParams.set('page', String(next));
      window.location.href = url.toString();
    });
  });

  // Admin products live search
  const adminLiveSearch = $('#admin-live-search');
  const adminSearchCount = $('#admin-search-count');
  if (adminLiveSearch && adminSearchCount) {
    let debounceTimer = null;
    adminLiveSearch.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const q = adminLiveSearch.value.trim();
        try {
          const res = await fetch(`/admin/live-search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          if (data.ok) {
            adminSearchCount.textContent = `${data.products.length} product(s)`;
          }
        } catch {}
      }, 350);
    });
  }

  // Admin product quick modal (click View -> show detail in modal)
  $$('.admin-btn[data-product-id]').forEach(btn => {
    // Only bind to buttons that DON'T have edit/delete markers and aren't navigation links
    if (btn.hasAttribute('data-edit-btn') || btn.hasAttribute('data-delete-btn') || btn.tagName === 'A') return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const productId = btn.dataset.productId;
      if (!productId) return;
      try {
        const res = await fetch(`/api/product/${productId}`);
        if (!res.ok) return;
        const p = await res.json();
        const body = $('#product-quick-body');
        if (!body) return;
        body.innerHTML = `
          <div style="display:flex;gap:var(--space-4);align-items:flex-start;">
            <img src="${imgUrlFor(p.images?.[0])}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:2px;flex-shrink:0;" onerror="this.style.display='none'" />
            <div style="flex:1;">
              <strong style="font-size:1.125rem;display:block;margin-bottom:4px;">${p.name}</strong>
              <span style="font-size:0.8125rem;color:var(--color-gray-500);text-transform:capitalize;">${p.category} · ${p.subcategory}</span>
              <div style="margin-top:var(--space-3);font-size:1.25rem;font-weight:700;">₨${Number(p.price).toLocaleString('en-PK')}</div>
              <div style="font-size:0.8125rem;color:var(--color-gray-500);margin-top:var(--space-2);display:flex;gap:var(--space-3);flex-wrap:wrap;">
                <span>Stock: ${p.stock}</span>
                <span>Rating: ${p.rating} ★</span>
                <span>Sizes: ${p.sizes?.join(', ') || '—'}</span>
              </div>
            </div>
          </div>
          <div style="margin-top:var(--space-5);padding-top:var(--space-5);border-top:1px solid var(--color-gray-200);font-size:0.875rem;color:var(--color-gray-600);line-height:1.6;">
            ${p.description || 'No description.'}
          </div>
        `;
        const title = $('#product-quick-title');
        if (title) title.textContent = p.name;
        openModal('#product-quick-modal');
      } catch {}
    });
  });

  // ─── 14N2. Admin orders: status filter ────────────────────────
  const orderStatusFilter = $('#order-status-filter');
  if (orderStatusFilter) {
    orderStatusFilter.addEventListener('change', () => {
      const url = new URL(window.location.href);
      if (orderStatusFilter.value) url.searchParams.set('status', orderStatusFilter.value);
      else url.searchParams.delete('status');
      url.searchParams.delete('page');
      window.location.href = url.toString();
    });
  }

  // ─── 14O. Search page category filter ────────────────────────
  function applySearchFilter(category) {
    const url = new URL(window.location.pathname + window.location.search, window.location.origin);
    if (category === 'all' || !category) {
      url.searchParams.delete('category');
    } else {
      url.searchParams.set('category', category);
    }
    window.location.href = url.toString();
  }
  $$('.search-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const filter = tag.dataset.filter;
      applySearchFilter(filter);
    });
  });
  $$('.search-filter-count [data-filter]').forEach(el => {
    el.addEventListener('click', () => {
      applySearchFilter(el.dataset.filter);
    });
  });

  // ─── 14P. Newsletter subscribe form ──────────────────────────
  const nlForm = $('#newsletter-subscribe-form');
  const nlSubscribed = $('#newsletter-subscribed');
  const nlError = $('#newsletter-error');
  if (nlForm) {
    nlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(nlForm);
      const email = fd.get('email')?.trim();
      const digest = fd.get('digest') === 'on';
      if (!email) {
        showToast('Please enter your email', 'error');
        return;
      }
      const topics = [];
      fd.getAll('digest_topics').forEach(v => topics.push(v));
      const btn = nlForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Subscribing...';
      try {
        const res = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, digest, topics })
        });
        const data = await res.json();
        if (data.ok) {
          nlSubscribed.querySelector('h3').textContent = 'You’re on the list';
          nlSubscribed.querySelector('p').textContent = 'Welcome to the BA GGY inner circle. Keep an eye on your inbox — your first email lands soon.';
          nlForm.classList.add('hidden');
          nlSubscribed.classList.add('visible');
          showToast('You’re on the list. Welcome!');
          document.addEventListener('click', function dismissNLHandler(e) {
            if (nlSubscribed && e.target && e.target.id === 'newsletter-dismiss') {
              nlSubscribed.classList.remove('visible');
              nlForm.classList.remove('hidden');
              nlForm.reset();
              document.removeEventListener('click', dismissNLHandler);
            }
          }, { once: true });
        } else if (data.duplicate) {
          // Already subscribed: same celebratory card, friendlier copy
          nlSubscribed.querySelector('h3').textContent = 'You’re already on the list';
          nlSubscribed.querySelector('p').textContent = 'This email is subscribed — drops and discounts are already headed your way.';
          nlForm.classList.add('hidden');
          nlSubscribed.classList.add('visible');
          showToast('You’re already on the list');
          document.addEventListener('click', function dismissNLHandler(e) {
            if (nlSubscribed && e.target && e.target.id === 'newsletter-dismiss') {
              nlSubscribed.classList.remove('visible');
              nlForm.classList.remove('hidden');
              document.removeEventListener('click', dismissNLHandler);
            }
          }, { once: true });
        } else {
          if (nlError) {
            nlError.textContent = data.message || 'Subscription failed';
            nlError.style.display = 'block';
          }
          showToast(data.message || 'Could not subscribe', 'error');
        }
      } catch {
        if (nlError) {
          nlError.textContent = 'Network error';
          nlError.style.display = 'block';
        }
        showToast('Network error', 'error');
      }
      btn.disabled = false;
      btn.textContent = 'Subscribe';
    });
  }

  // ─── 14Q. Account: sign in / out wiring from buttons ─────────
  const signInBtn = $('#signin-btn');
  const signUpBtn = $('#signup-btn');
  const accountLogoutBtn = $('#account-logout-btn');
  const accountLogoutBtn2 = $('#account-logout-btn-2');
  const accountLogoutHandler = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.href = '/';
  };
  if (accountLogoutBtn) accountLogoutBtn.addEventListener('click', accountLogoutHandler);
  if (accountLogoutBtn2) accountLogoutBtn2.addEventListener('click', accountLogoutHandler);
  if (signInBtn) signInBtn.addEventListener('click', () => { window.location.href = '/account?action=login'; });
  if (signUpBtn) signUpBtn.addEventListener('click', () => { window.location.href = '/account?action=register'; });

  // ─── 14Qa. Login form AJAX ────────────────────────────────────
  const loginForm = $('#login-form');
  const loginError = $('#auth-error');
  const loginSuccess = $('#auth-success');
  function showAuthMessage(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }
  function clearAuthMessages() {
    if (loginError) { loginError.style.display = 'none'; }
    if (loginSuccess) { loginSuccess.style.display = 'none'; }
  }
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthMessages();
      const fd = new FormData(loginForm);
      const email = fd.get('email')?.trim();
      const password = fd.get('password')?.trim();
      if (!email || !password) {
        showAuthMessage(loginError, 'Please fill in all fields');
        return;
      }
      const btn = loginForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.ok) {
          showAuthMessage(loginSuccess, 'Signed in successfully! Redirecting...');
          setTimeout(() => window.location.href = '/account', 800);
        } else {
          showAuthMessage(loginError, data.message || 'Sign in failed. Please try again.');
          btn.disabled = false;
          btn.textContent = 'Sign In';
        }
      } catch {
        showAuthMessage(loginError, 'Network error. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  }

  // ─── 14Qb. Register form AJAX ────────────────────────────────
  const registerForm = $('#register-form');
  const registerError = $('#auth-error');
  const registerSuccess = $('#auth-success');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthMessages();
      const fd = new FormData(registerForm);
      const name = fd.get('name')?.trim();
      const email = fd.get('email')?.trim();
      const password = fd.get('password')?.trim();
      if (!name || !email || !password) {
        showAuthMessage(registerError, 'Please fill in all required fields');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showAuthMessage(registerError, 'Please enter a valid email address');
        return;
      }
      if (password.length < 8) {
        showAuthMessage(registerError, 'Password must be at least 8 characters');
        return;
      }
      const btn = registerForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Creating account...';
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        const data = await res.json();
        if (data.ok) {
          showAuthMessage(registerSuccess, 'Account created! Redirecting to your account...');
          setTimeout(() => window.location.href = '/account', 800);
        } else {
          showAuthMessage(registerError, data.message || 'Registration failed. Please try again.');
          btn.disabled = false;
          btn.textContent = 'Create Account';
        }
      } catch {
        showAuthMessage(registerError, 'Network error. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    });
  }

  // ─── 14R. Forgot password link (now a real page) ─────────────
  // The login page links to /forgot-password; no handler needed here anymore.

  // ─── 14S. Admin product detail thumbnail switching ───────────
  const adminMainImg = $('.product-detail-admin-main-img img');
  if (adminMainImg) {
    $$('.product-detail-admin-thumbs .thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        $$('.product-detail-admin-thumbs .thumb').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
        adminMainImg.style.transition = 'opacity 0.2s ease';
        adminMainImg.style.opacity = '0';
        setTimeout(() => {
          adminMainImg.src = imgUrlFor(thumb.dataset.img);
          adminMainImg.style.opacity = '1';
        }, 200);
      });
    });
  }

  // ─── 14Q. Price range slider ───────────────────────────────
  const priceMin = $('#price-min');
  const priceMax = $('#price-max');
  const priceLabels = $$('.price-labels span');
  const shopGrid = $('.shop-grid');

  function updatePriceLabels() {
    if (!priceLabels.length) return;
    priceLabels[0].textContent = '₨' + Number(priceMin?.value || 0).toLocaleString('en-PK');
    priceLabels[1].textContent = '₨' + Number(priceMax?.value || 10000).toLocaleString('en-PK');
  }

  function applyPriceFilter() {
    if (!shopGrid) return;
    const min = parseInt(priceMin?.value || 0, 10);
    const max = parseInt(priceMax?.value || 10000, 10);
    $$('.product-card', shopGrid).forEach((card) => {
      const priceText = card.querySelector('.price-current')?.textContent || '';
      const price = parseInt(priceText.replace(/[^\d]/g, '') || '0', 10);
      const visible = price >= min && price <= max;
      card.style.display = visible ? '' : 'none';
    });
    // Update results count
    const visibleCount = $$('.product-card', shopGrid).filter(c => c.style.display !== 'none').length;
    const resultsCount = $('.results-count');
    if (resultsCount) {
      const total = $$('.product-card', shopGrid).length;
      resultsCount.textContent = `${visibleCount} of ${total} products`;
    }
  }

  const priceResetBtn = $('.price-reset-btn');

  function resetPriceSlider() {
    if (!priceMin || !priceMax) return;
    priceMin.value = 0;
    priceMax.value = 10000;
    updatePriceLabels();
    applyPriceFilter();
  }

  if (priceResetBtn) {
    priceResetBtn.addEventListener('click', resetPriceSlider);
  }

  if (priceMin && priceMax) {
    priceMin.addEventListener('input', () => {
      // Prevent min exceeding max
      if (parseInt(priceMin.value) > parseInt(priceMax.value)) {
        priceMin.value = priceMax.value;
      }
      updatePriceLabels();
      applyPriceFilter();
    });
    priceMax.addEventListener('input', () => {
      // Prevent max below min
      if (parseInt(priceMax.value) < parseInt(priceMin.value)) {
        priceMax.value = priceMin.value;
      }
      updatePriceLabels();
      applyPriceFilter();
    });
    updatePriceLabels();
    applyPriceFilter();
  }

  // Sort: also re-apply price filter after sorting
  const originalSortHandler = $('#sort-select')?.onchange;
  $('#sort-select')?.addEventListener('change', function () {
    // Existing sort logic runs via the separate handler above;
    // re-apply price filter after sort completes
    setTimeout(applyPriceFilter, 0);
  });

  // Initial cart count
  updateCartCount();
  // Sync wishlist badge from server on load
  syncWishlistFromServer(list => {
    const badge = document.querySelector('.wishlist-btn .badge');
    if (badge) {
      badge.textContent = list.length;
      badge.classList.toggle('hidden', list.length === 0);
    }
  });

  // ─── 14T. Password strength meter (register + reset password) ──
  const PW_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  const PW_COLORS = ['#dc2626', '#dc2626', '#d97706', '#65a30d', '#16a34a'];

  function pwScore(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if ((/[a-z]/.test(pw) && /[A-Z]/.test(pw)) || (/\d/.test(pw) && /[a-zA-Z]/.test(pw))) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  }

  function attachPwMeter(inputSel, barSel, hintSel) {
    const input = $(inputSel);
    const bar = $(barSel);
    const hint = $(hintSel);
    if (!input || !bar) return;
    input.addEventListener('input', () => {
      const empty = input.value.length === 0;
      const score = pwScore(input.value);
      bar.style.width = empty ? '0' : Math.max(8, score * 25) + '%';
      bar.style.backgroundColor = PW_COLORS[score];
      if (hint) {
        hint.textContent = empty ? '' :
          score === 0 ? 'At least 8 characters — add letters, numbers, and symbols to make it stronger.' :
          PW_LABELS[score] + (score < 3 ? ' — a longer password with mixed characters is stronger.' : '');
      }
    });
  }
  attachPwMeter('#reg-password', '#reg-pw-bar', '#reg-pw-hint');
  attachPwMeter('#rp-password', '#rp-pw-bar', '#rp-pw-hint');

  // ─── 14U. Inline-handler replacements (CSP: no inline event attrs) ──
  const applyCouponBtn = $('#apply-coupon-btn');
  if (applyCouponBtn && typeof window.applyCoupon === 'function') {
    applyCouponBtn.addEventListener('click', () => window.applyCoupon(applyCouponBtn));
  }
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-copy-address]');
    if (copyBtn && typeof window.copyAddress === 'function') {
      window.copyAddress(copyBtn.dataset.copyAddress, copyBtn);
      return;
    }
    const removeBtn = e.target.closest('[data-remove-index]');
    if (removeBtn && typeof window.removeAddress === 'function') {
      window.removeAddress(parseInt(removeBtn.dataset.removeIndex, 10));
    }
  });

  // Expose themed dialog helpers for page-level scripts
  window.showToast = showToast;
  window.showConfirm = showConfirm;
  window.showAlert = showAlert;
})();
