// Keep a decoded, usable frame visible while another image loads.
const imageDelivery = (() => {
  const decoded = new WeakMap();
  function create(root, label) {
    const status = document.createElement('div');
    status.className = 'image-state';
    status.hidden = true;
    const message = document.createElement('span');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'image-retry';
    retry.textContent = 'Retry image';
    retry.setAttribute('aria-label', 'Retry ' + label + ' image');
    retry.hidden = true;
    status.append(message, retry);
    root.append(status);
    const state = { root, status, message, retry, serial: 0, pending: false, error: false, retryAction: null };
    retry.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.pending) state.retryAction?.();
    });
    return state;
  }
  async function ready(image, reload = false, signal = null) {
    if (signal?.aborted) throw new Error('Image request cancelled');
    const source = image.currentSrc || image.src;
    if (!reload && decoded.get(image) === source && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return;
    image.loading = 'eager';
    image.decoding = 'async';
    if (reload) {
      decoded.delete(image);
      const source = image.getAttribute('src');
      image.removeAttribute('src');
      image.setAttribute('src', source);
    }
    let timer;
    let cleanup = () => {};
    let stopped;
    try {
      const decoding = typeof image.decode === 'function' ? image.decode() : new Promise((resolve, reject) => {
        const loaded = () => resolve();
        const failed = () => reject(new Error('Image request failed'));
        cleanup = () => { image.removeEventListener('load', loaded); image.removeEventListener('error', failed); };
        if (image.complete) { image.naturalWidth > 0 ? resolve() : failed(); return; }
        image.addEventListener('load', loaded, { once: true });
        image.addEventListener('error', failed, { once: true });
      });
      const waits = [decoding, new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Image loading timed out')), 15000);
      })];
      if (signal) waits.push(new Promise((_, reject) => {
        stopped = () => {
          window.clearTimeout(timer);
          cleanup();
          reject(new Error('Image request cancelled'));
        };
        signal.addEventListener('abort', stopped, { once: true });
        if (signal.aborted) stopped();
      }));
      await Promise.race(waits);
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('Image has no decoded pixels');
      decoded.set(image, image.currentSrc || image.src);
    } finally {
      window.clearTimeout(timer);
      cleanup();
      if (stopped) signal.removeEventListener('abort', stopped);
    }
  }
  function cancel(state) {
    state.serial += 1;
    state.cancelWait?.();
    state.cancelWait = null;
    state.pending = false;
    state.error = false;
    state.retryAction = null;
    state.status.hidden = true;
    state.root.removeAttribute('aria-busy');
    state.root.dataset.imageState = 'ready';
  }
  async function request(state, image, commit, retryAction, { reload = false, allow = () => true, current = () => true, prepare = null, failureMessage = 'Image couldn’t load. The current view is unchanged.' } = {}) {
    state.cancelWait?.();
    const controller = new AbortController();
    const serial = ++state.serial;
    const retryHadFocus = document.activeElement === state.retry;
    state.pending = true;
    state.error = false;
    state.retryAction = retryAction;
    state.root.dataset.imageState = 'loading';
    state.root.setAttribute('aria-busy', 'true');
    state.status.hidden = true;
    state.message.textContent = 'Loading image…';
    state.retry.hidden = !reload;
    state.retry.textContent = reload ? 'Retrying…' : 'Retry image';
    state.retry.setAttribute('aria-disabled', String(reload));
    const notice = window.setTimeout(() => {
      if (serial === state.serial && state.pending) state.status.hidden = false;
    }, 180);
    const cancelWait = () => {
      window.clearTimeout(notice);
      controller.abort();
    };
    state.cancelWait = cancelWait;
    try {
      await (prepare ? prepare(reload, controller.signal) : ready(image, reload, controller.signal));
      if (serial !== state.serial) return false;
      if (!current()) { cancel(state); return false; }
      if (!allow()) { cancel(state); return false; }
      commit();
      if (document.activeElement === state.retry || (retryHadFocus && document.activeElement === document.body)) {
        const target = state.root.querySelector('button:not(.image-retry):not([hidden]), a.gallery-image:not([hidden])')
          || state.root.closest('.shelf-card')?.querySelector('.shelf-open');
        target?.focus({ preventScroll: true });
      }
      cancel(state);
      return true;
    } catch (error) {
      if (serial !== state.serial) return false;
      if (!current()) { cancel(state); return false; }
      state.pending = false;
      state.error = true;
      state.status.hidden = false;
      state.root.dataset.imageState = 'error';
      state.root.removeAttribute('aria-busy');
      state.message.textContent = failureMessage;
      state.retry.hidden = false;
      state.retry.textContent = 'Retry image';
      state.retry.setAttribute('aria-disabled', 'false');
      return false;
    } finally {
      window.clearTimeout(notice);
      if (state.cancelWait === cancelWait) {
        controller.abort();
        state.cancelWait = null;
      }
    }
  }
  return { create, ready, request, cancel };
})();

const capitalizeQuote = (text) => text.replace(/\p{L}/u, (letter) => letter.toUpperCase());

// Keep this history entry's manual choices when Back rebuilds the document.
// A fresh visit or reload still starts with autoplay on.
const returnView = (() => {
  const key = 'samuelsManualsReturnView';
  const plain = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
  const valid = (value) => plain(value) && value.version === 1 && typeof value.paused === 'boolean'
    && Array.isArray(value.selections) && Array.from(value.selections).every((item) => plain(item)
      && typeof item.name === 'string' && typeof item.href === 'string');
  const validQuotes = (value) => Array.isArray(value) && Array.from(value).every((item) => plain(item)
    && typeof item.group === 'string' && typeof item.id === 'string' && Number.isSafeInteger(item.slot) && item.slot >= 0);
  const quoteViews = new Map();
  const galleryViews = new Map();
  let saved = null;
  try {
    const state = window.history.state;
    if (window.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'back_forward'
      && plain(state) && valid(state[key])) saved = state[key];
  } catch { /* History restoration is optional. */ }
  window.addEventListener('pagehide', () => {
    try {
      const state = window.history.state;
      if (state !== null && (!plain(state) || (Object.hasOwn(state, key) && !valid(state[key])))) return;
      const next = state === null ? {} : structuredClone(state);
      next[key] = {
        version: 1,
        paused: autoplayPolicy.paused,
        earlierOpen: document.getElementById('earlier-projects-disclosure')?.open ?? false,
        quotes: [...quoteViews.values()],
        selections: [...galleryViews.values()]
      };
      window.history.replaceState(next, '', window.location.href);
    } catch { /* Never block leaving, including browsers without history storage. */ }
  });
  return {
    paused: saved?.paused ?? false,
    earlierOpen: typeof saved?.earlierOpen === 'boolean' ? saved.earlierOpen : undefined,
    index(element, slides) {
      const name = element.dataset.galleryKey || element.dataset.gallery;
      const selection = saved?.selections.find((item) => item.name === name)
        || saved?.selections.find((item) => item.name === element.dataset.gallery);
      const index = selection ? slides.findIndex((slide) => slide.getAttribute('href') === selection.href) : -1;
      return index < 0 ? 0 : index;
    },
    quoteIndex(carousel, quotes) {
      if (!validQuotes(saved?.quotes)) return 0;
      const selected = saved.quotes.find((item) => item.group === carousel.dataset.quoteGroup);
      if (!selected) return 0;
      if (quotes[selected.slot]?.id === selected.id) return selected.slot;
      const index = quotes.findIndex((quote) => quote.id === selected.id);
      return index < 0 ? 0 : index;
    },
    noteQuote(carousel, quote, slot) {
      quoteViews.set(carousel.dataset.quoteGroup, { group: carousel.dataset.quoteGroup, id: quote.id, slot });
    },
    noteGallery(element, slide) {
      const name = element.dataset.galleryKey || element.dataset.gallery;
      galleryViews.set(name, { name, href: slide.getAttribute('href') });
    }
  };
})();

// BEGIN autoplay policy
const autoplayPolicy = { paused: returnView.paused };
const autoplayControls = [...document.querySelectorAll('[data-autoplay-toggle]')];
function setAutoplayPaused(paused) {
  autoplayPolicy.paused = paused;
  autoplayControls.forEach((button) => {
    button.querySelector('[data-autoplay-label]').textContent = paused ? 'Resume carousels' : 'Pause carousels';
    button.querySelector('[data-autoplay-pause]').toggleAttribute('hidden', paused);
    button.querySelector('[data-autoplay-play]').toggleAttribute('hidden', !paused);
    button.setAttribute('aria-label', paused ? 'Resume carousels' : 'Pause carousels');
    button.title = paused ? 'Resume automatic images and quotes' : 'Pause automatic images and quotes';
  });
  document.querySelectorAll('.gallery-dissolve, .site-maxim').forEach((element) => {
    element.getAnimations().forEach((animation) => paused ? animation.pause() : animation.play());
  });
  document.dispatchEvent(new CustomEvent('autoplay-policy-change'));
}
autoplayControls.forEach((button) => {
  button.addEventListener('click', () => setAutoplayPaused(!autoplayPolicy.paused));
  button.hidden = false;
});
setAutoplayPaused(autoplayPolicy.paused);
// Keyboard readers keep their place until they explicitly choose Play.
document.addEventListener('focusin', (event) => {
  if (event.target.matches(':focus-visible') && event.target.closest('[data-gallery], [data-quote-group]')) setAutoplayPaused(true);
});
(() => {
  const menus = [...document.querySelectorAll('.elsewhere-menu, .mobile-index')];
  const opened = [];
  menus.forEach((menu) => menu.addEventListener('toggle', () => {
    const index = opened.indexOf(menu);
    if (index >= 0) opened.splice(index, 1);
    if (menu.open) opened.push(menu);
  }));
  function topMenu() {
    const visible = menus.filter((menu) => menu.open && menu.querySelector('summary')?.getClientRects().length);
    const untracked = visible.filter((menu) => !opened.includes(menu));
    return untracked[untracked.length - 1] || [...opened].reverse().find((menu) => visible.includes(menu));
  }
  function dismiss(menu, event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    menu.open = false;
    menu.querySelector('summary')?.focus({ preventScroll: true });
  }
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    const menu = topMenu();
    if (menu && !menu.contains(event.target)) dismiss(menu, event);
  }, { capture: true });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    const menu = topMenu();
    if (menu) dismiss(menu, event);
  }, { capture: true });
})();
// END autoplay policy

// BEGIN inline compatibility routes
(() => {
  const legacyKey = 'samuelsManualsProject';
  const aliases = { 'current-projects': 'projects', whoami: 'top', xbar: 'sam-xbar-plugin' };
  let routeSerial = 0;
  let handledHash = null;
  let focusRevision = 0;
  let departure = null;
  const returnKey = 'samuelsManualsReturnFocus';
  const returnLinks = [...document.querySelectorAll('a[href]')];
  const earlier = document.getElementById('earlier-projects-disclosure');
  if (earlier && typeof returnView.earlierOpen === 'boolean') earlier.open = returnView.earlierOpen;
  else if (earlier && window.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'back_forward') {
    const target = targetFor(window.location.hash);
    if (target && (target.id === 'earlier-projects' || earlier.contains(target))) earlier.open = true;
  }
  function syncEarlier() {
    if (!earlier) return;
    const summary = earlier.querySelector('summary');
    summary.setAttribute('aria-expanded', String(earlier.open));
    document.dispatchEvent(new CustomEvent('autoplay-policy-change'));
  }
  earlier?.addEventListener('toggle', syncEarlier);
  syncEarlier();
  function plainRecord(value) {
    return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
  }
  function cloneRecord(value) {
    try { return plainRecord(value) && typeof structuredClone === 'function' ? structuredClone(value) : null; }
    catch { return null; }
  }
  function breadcrumb(value) {
    return plainRecord(value) && value.version === 1 && Number.isInteger(value.index) && value.index >= 0
      && typeof value.href === 'string' && typeof value.hash === 'string';
  }
  function cleanLegacyState() {
    const state = window.history.state;
    if (!plainRecord(state) || !(legacyKey in state)) return state;
    const next = cloneRecord(state);
    if (!next) return state;
    delete next[legacyKey];
    return Object.keys(next).length ? next : null;
  }
  function stateForVisit() {
    const state = cleanLegacyState();
    if (!plainRecord(state) || !breadcrumb(state[returnKey])) return state;
    const next = cloneRecord(state);
    if (!next) return state;
    delete next[returnKey];
    return Object.keys(next).length ? next : null;
  }
  function departureLink(link) {
    if (!link || !link.isConnected || !returnLinks.includes(link) || link.hasAttribute('download')) return false;
    if (link.target && link.target.toLowerCase() !== '_self') return false;
    try {
      const url = new URL(link.href, window.location.href);
      return ['http:', 'https:'].includes(url.protocol) && (url.origin !== window.location.origin
        || url.pathname !== window.location.pathname || url.search !== window.location.search);
    } catch { return false; }
  }
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    const link = event.target.closest('a[href]');
    if (!departureLink(link)) return;
    departure = { link, hash: window.location.hash };
    try {
      const state = window.history.state;
      if (state !== null && (!plainRecord(state) || (Object.hasOwn(state, returnKey) && !breadcrumb(state[returnKey])))) return;
      const next = state === null ? {} : cloneRecord(state);
      if (!next) return;
      next[returnKey] = { version: 1, index: returnLinks.indexOf(link), href: link.getAttribute('href'), hash: window.location.hash };
      window.history.replaceState(next, '', window.location.href);
    } catch { /* Optional focus metadata must never block the link. */ }
  });
  document.addEventListener('focusin', (event) => {
    if (event.target !== document.body && event.target !== document.documentElement) focusRevision += 1;
  });
  function restoreReturnFocus(serial) {
    const hash = window.location.hash;
    const revision = focusRevision;
    window.requestAnimationFrame(() => {
      if (serial !== routeSerial || hash !== window.location.hash || revision !== focusRevision || document.querySelector('dialog[open]')) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement && active.isConnected) return;
      const state = window.history.state;
      const saved = plainRecord(state) ? state[returnKey] : null;
      const recorded = breadcrumb(saved) && saved.hash === hash ? returnLinks[saved.index] : null;
      const link = departure?.hash === hash ? departure.link
        : recorded && recorded.getAttribute('href') === saved.href ? recorded : null;
      if (departureLink(link) && link.getClientRects().length) link.focus({ preventScroll: true });
    });
  }
  function targetFor(hash) {
    let id;
    try { id = decodeURIComponent(hash.replace(/^#/, '')); } catch { return null; }
    return document.getElementById(aliases[id] || id || 'top');
  }
  function visit(target, smooth = false) {
    routeSerial += 1;
    handledHash = window.location.hash;
    departure = null;
    if (earlier && (target.id === 'earlier-projects' || earlier.contains(target))) {
      earlier.open = true;
      syncEarlier();
    }
    document.dispatchEvent(new CustomEvent('manuals-route-visit', { detail: { target } }));
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'start', behavior: smooth && !motion ? 'smooth' : 'instant' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    const target = targetFor(link.hash);
    if (!target) return;
    event.preventDefault();
    if (window.location.hash !== link.hash) window.history.pushState(stateForVisit(), '', link.hash);
    visit(target, true);
  });
  function sync(event) {
    const next = cleanLegacyState();
    if (next !== window.history.state) window.history.replaceState(next, '', window.location.href);
    const restoredVisit = (event?.type === 'pageshow' && event.persisted)
      || ((!event || event.type === 'pageshow') && window.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'back_forward');
    const hash = window.location.hash;
    if (restoredVisit) {
      handledHash = hash;
      const serial = ++routeSerial;
      if (event?.type === 'pageshow') restoreReturnFocus(serial);
      return;
    }
    if ((event?.type === 'popstate' || event?.type === 'hashchange') && hash === handledHash) return;
    handledHash = hash;
    const serial = ++routeSerial;
    const target = targetFor(hash);
    if (target) window.requestAnimationFrame(() => {
      if (serial === routeSerial && window.location.hash === hash) visit(target);
    });
  }
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  window.addEventListener('pageshow', sync);
  sync();
})();
// END inline compatibility routes

(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sections = [...document.querySelectorAll("[data-section]")];
  const links = [...document.querySelectorAll("[data-section-link]")];
  const layout = document.querySelector(".site-layout");
  const sublinks = [...document.querySelectorAll("[data-subsection-link]")];
  let routeTarget = null;

  const setActive = (id, childId = null) => {
    links.forEach((link) => {
      const active = link.dataset.sectionLink === id;
      link.classList.toggle("is-active", active);
      if (active && !childId) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    sublinks.forEach((link) => {
      const active = link.dataset.subsectionLink === childId;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  // Content hover/focus highlights only its matching map entry, independently of scroll.
  const content = document.querySelector('main');
  let hoveredTarget = null;
  let focusedTarget = null;
  let effectiveTarget = null;
  const contextTarget = (node) => {
    if (!node || !content.contains(node)) return null;
    return node.closest?.('[data-sitemap-target], [data-section]') || null;
  };
  const highlightContext = (target) => {
    effectiveTarget = target;
    const childId = target?.hasAttribute('data-sitemap-target') ? target.id : null;
    const sectionId = target?.closest('[data-section]')?.dataset.section;
    links.forEach((link) => {
      const childLink = childId && sublinks.find((child) => child.dataset.subsectionLink === childId && child.closest('nav') === link.closest('nav'));
      const childCollapsed = childLink?.closest('details.index-links-disclosure:not([open])');
      link.classList.toggle('is-contextual', (!childId || !!childCollapsed) && !!sectionId && link.dataset.sectionLink === sectionId);
    });
    sublinks.forEach((link) => link.classList.toggle('is-contextual', !!childId && link.dataset.subsectionLink === childId));
  };
  content.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    hoveredTarget = contextTarget(event.target);
    highlightContext(hoveredTarget || focusedTarget);
  });
  content.addEventListener('pointerout', (event) => {
    if (event.pointerType === 'touch') return;
    hoveredTarget = contextTarget(event.relatedTarget);
    highlightContext(hoveredTarget || focusedTarget);
  });
  content.addEventListener('focusin', (event) => {
    focusedTarget = contextTarget(event.target);
    highlightContext(focusedTarget || hoveredTarget);
  });
  content.addEventListener('focusout', (event) => {
    focusedTarget = contextTarget(event.relatedTarget);
    highlightContext(focusedTarget || hoveredTarget);
  });
  content.addEventListener('pointercancel', () => {
    hoveredTarget = null;
    highlightContext(focusedTarget);
  });

  document.querySelectorAll('.index-links-disclosure').forEach((details) => {
    details.addEventListener('toggle', () => highlightContext(effectiveTarget));
  });

  const updateCircuit = () => {
    const start = layout.offsetTop;
    const distance = Math.max(1, layout.offsetHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, (window.scrollY - start) / distance));
    document.documentElement.style.setProperty("--circuit-progress", `${progress * 100}%`);
  };

  const updateActiveSection = () => {
    if (routeTarget) {
      const section = routeTarget.closest('[data-section]') || sections.find((item) => item.dataset.section === routeTarget.id);
      if (section) {
        setActive(section.dataset.section, routeTarget.hasAttribute('data-sitemap-target') ? routeTarget.id : null);
        return;
      }
      routeTarget = null;
    }
    const headerHeight = document.querySelector('.masthead').getBoundingClientRect().height;
    const shortcutsHeight = window.matchMedia('(max-width: 860px)').matches ? document.querySelector('.mobile-index > summary').getBoundingClientRect().height : 0;
    const marker = headerHeight + shortcutsHeight + 26;
    let active = sections[0];
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= marker) active = section;
    });
    let child = null;
    active.querySelectorAll('[data-sitemap-target]').forEach((target) => {
      if (!target.closest('details:not([open])') && target.getBoundingClientRect().top <= marker) child = target;
    });
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
      const bottom = Math.min(window.innerHeight, document.querySelector('.inspiration-bar').getBoundingClientRect().top);
      active.querySelectorAll('[data-sitemap-target]').forEach((target) => {
        const bounds = target.getBoundingClientRect();
        if (!target.closest('details:not([open])') && bounds.height > 0 && bounds.bottom > marker && bounds.top < bottom) child = target;
      });
    }
    setActive(active.dataset.section, child?.id);
  };

  const clearRouteTarget = () => {
    if (!routeTarget) return;
    routeTarget = null;
    updateActiveSection();
  };
  document.addEventListener('manuals-route-visit', (event) => {
    routeTarget = event.detail.target;
    updateActiveSection();
  });
  ['wheel', 'touchmove', 'pointerdown'].forEach((type) => document.addEventListener(type, clearRouteTarget, { passive: true }));
  document.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) clearRouteTarget();
  });
  document.addEventListener('focusin', (event) => {
    if (routeTarget && !routeTarget.contains(event.target)) clearRouteTarget();
  });

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      updateCircuit();
      updateActiveSection();
      ticking = false;
    });
  }, { passive: true });
  window.addEventListener("resize", () => { updateCircuit(); updateActiveSection(); });
  window.addEventListener("load", () => { updateCircuit(); updateActiveSection(); });

  if (!reduceMotion) document.documentElement.classList.add("motion-ready");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    });
  }, { rootMargin: "-18% 0px -62% 0px", threshold: 0 });

  sections.forEach((section) => observer.observe(section));
  links.forEach((link) => link.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    if (link.matches("summary")) return;
    link.closest("details")?.removeAttribute("open");
    setActive(link.dataset.sectionLink);
  }));
  sublinks.forEach((link) => link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    link.closest('details')?.removeAttribute('open');
    link.closest('details.mobile-index')?.removeAttribute('open');
    setActive(link.dataset.parentSection, link.dataset.subsectionLink);
  }));
  updateCircuit();
  updateActiveSection();
})();

(() => {
  const dialog = document.querySelector('.gallery-dialog');
  const dialogDelivery = imageDelivery.create(dialog, 'enlarged');
  function selectionStatus(parent) {
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.setAttribute('data-selection-status', '');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    parent.append(status);
    return status;
  }
  const dialogStatus = selectionStatus(dialog);
  dialog.querySelector('[data-dialog-caption]').setAttribute('aria-live', 'off');
  function selectionMessage(gallery) {
    const slide = gallery.slides[gallery.index];
    const description = slide.dataset.caption || slide.querySelector('img').alt;
    return `${gallery.element.dataset.gallery}, image ${gallery.index + 1} of ${gallery.slides.length}: ${description}`;
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeGallery = null;
  let opener = null;
  let viewerSession = 0;
  let routeEpoch = 0;
  const closedViews = [];
  const galleries = [...document.querySelectorAll('[data-gallery]')].map((element) => {
    const slides = [...element.querySelectorAll('.gallery-image')];
    const first = slides[0].querySelector('img');
    const width = Number(first.getAttribute('width')) || first.naturalWidth;
    const height = Number(first.getAttribute('height')) || first.naturalHeight;
    if (width > 0 && height > 0) element.style.setProperty('--gallery-ratio', `${width} / ${height}`);
    const restored = returnView.index(element, slides);
    returnView.noteGallery(element, slides[restored]);
    const gallery = { element, slides, status: selectionStatus(element), index: 0, restoreIndex: restored || null, timer: null, visible: false, hovered: false, requestedIndex: null, imageIntent: 0, delivery: imageDelivery.create(element, element.dataset.gallery) };
    const previous = element.querySelector('[data-gallery-prev]');
    const next = element.querySelector('[data-gallery-next]');
    const count = element.querySelector('[data-gallery-count]');
    [previous, next, count].forEach((control) => { control.hidden = slides.length < 2; });
    previous.addEventListener('click', () => select(gallery, -1));
    next.addEventListener('click', () => select(gallery, 1));
    slides.forEach((slide, index) => {
      const description = slide.querySelector('img').alt || slide.dataset.caption || element.dataset.gallery;
      if (!slide.hasAttribute('title')) slide.setAttribute('title', slide.dataset.caption || description);
      if (typeof dialog.showModal === 'function') { slide.setAttribute('aria-haspopup', 'dialog'); slide.setAttribute('aria-label', `Enlarge ${element.dataset.gallery} image ${index + 1} of ${slides.length}: ${description}`); }
      slide.addEventListener('click', (event) => open(event, gallery));
    });
    if (slides.length > 1) {
      element.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') { gallery.hovered = true; schedule(gallery); }
      });
      element.addEventListener('pointerleave', () => { gallery.hovered = false; schedule(gallery); });
      element.addEventListener('focusin', () => schedule(gallery));
      element.addEventListener('focusout', () => window.setTimeout(() => schedule(gallery), 0));
    }
    render(gallery);
    return gallery;
  });
  galleries.forEach((gallery) => {
    if (gallery.restoreIndex === null) return;
    const image = gallery.slides[gallery.restoreIndex].querySelector('img');
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) selectIndex(gallery, gallery.restoreIndex, false, false, false, { announceSelection: false });
  });

  function canPlay(gallery, ignorePending = false) {
    const held = gallery.hovered || gallery.element.contains(document.activeElement) || dialog.open;
    return gallery.slides.length > 1 && gallery.visible && !gallery.element.closest('details:not([open])') && !document.hidden && !held && !autoplayPolicy.paused
      && !gallery.delivery.error && (ignorePending || !gallery.delivery.pending);
  }
  function schedule(gallery) {
    if (!canPlay(gallery)) {
      window.clearTimeout(gallery.timer);
      gallery.timer = null;
      return;
    }
    if (gallery.timer === null) {
      gallery.timer = window.setTimeout(() => {
        gallery.timer = null;
        if (canPlay(gallery)) select(gallery, 1, true);
        else schedule(gallery);
      }, gallery.element.classList.contains('interest-gallery') || gallery.element.dataset.gallery === 'Whoami' ? 14000 + (galleries.indexOf(gallery) % 5) * 1100 : 18000 + (galleries.indexOf(gallery) % 5) * 1100);
    }
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const gallery = galleries.find((item) => item.element === entry.target);
      gallery.visible = entry.isIntersecting;
      const image = gallery.slides[gallery.index].querySelector('img');
      if (gallery.visible && gallery.restoreIndex !== null) {
        selectIndex(gallery, gallery.restoreIndex, false, false, false, { announceSelection: false });
      } else if (gallery.visible && !gallery.delivery.pending && !gallery.delivery.error && (!image.complete || !image.naturalWidth)) {
        selectIndex(gallery, gallery.index);
      } else schedule(gallery);
    });
  }, { threshold: .15 });
  galleries.forEach((gallery) => observer.observe(gallery.element));
  document.addEventListener('visibilitychange', () => galleries.forEach(schedule));
  document.addEventListener('autoplay-policy-change', () => galleries.forEach(schedule));
  reducedMotion.addEventListener('change', () => galleries.forEach(schedule));

  function render(gallery, automatic = false) {
    const previous = gallery.slides.find((slide) => !slide.hidden);
    gallery.element.querySelectorAll('.gallery-dissolve').forEach((frame) => {
      frame.getAnimations().forEach((animation) => animation.cancel());
      frame.remove();
    });
    gallery.slides.forEach((slide, index) => { slide.hidden = index !== gallery.index; });
    const slide = gallery.slides[gallery.index];
    if (automatic && previous && previous !== slide && typeof previous.animate === 'function') {
      const frame = previous.cloneNode(true);
      frame.hidden = false;
      frame.removeAttribute('href');
      frame.removeAttribute('id');
      frame.removeAttribute('aria-label');
      frame.setAttribute('aria-hidden', 'true');
      frame.inert = true;
      frame.classList.add('gallery-dissolve');
      frame.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      gallery.element.querySelector('.gallery-slides').append(frame);
      frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1600, easing: 'ease-in-out' })
        .finished.catch(() => {}).then(() => frame.remove());
    }
    const caption = gallery.element.querySelector('.gallery-caption');
    if (caption) {
      caption.setAttribute('aria-live', 'off');
      caption.textContent = slide.dataset.caption;
    }
    gallery.element.querySelector('[data-gallery-count]').textContent = `${gallery.index + 1} / ${gallery.slides.length}`;
    gallery.element.querySelector('.gallery-toolbar').hidden = gallery.element.classList.contains('interest-gallery') && gallery.slides.length < 2;
  }
  function select(gallery, step, automatic = false) {
    const origin = gallery.requestedIndex ?? gallery.index;
    return selectIndex(gallery, (origin + step + gallery.slides.length) % gallery.slides.length, automatic);
  }
  async function selectIndex(gallery, index, automatic = false, reload = false, viewer = false, { announceSelection = true } = {}) {
    gallery.restoreIndex = null;
    const intent = ++gallery.imageIntent;
    const viewing = viewer || (dialog.open && activeGallery === gallery);
    const state = viewing ? dialogDelivery : gallery.delivery;
    const source = gallery.slides[index].querySelector('img');
    const next = viewing ? dialog.querySelector('.dialog-image').cloneNode(false) : source;
    if (viewing) { next.src = source.src; next.alt = source.alt; next.hidden = false; }
    gallery.requestedIndex = index;
    window.clearTimeout(gallery.timer);
    gallery.timer = null;
    await imageDelivery.request(state, next, () => {
      const changed = gallery.index !== index;
      gallery.index = index;
      returnView.noteGallery(gallery.element, gallery.slides[index]);
      render(gallery, automatic);
      if (viewing) {
        imageDelivery.cancel(gallery.delivery);
        dialog.querySelector('.dialog-image').replaceWith(next);
        updateDialog(gallery);
        dialogStatus.textContent = selectionMessage(gallery);
        gallery.status.textContent = '';
      } else {
        gallery.status.textContent = !announceSelection || automatic || !changed ? '' : selectionMessage(gallery);
      }
    }, () => selectIndex(gallery, index, false, true, viewing), {
      reload,
      failureMessage: viewing && dialog.querySelector('.dialog-image').hidden ? 'Image couldn’t load. Try again.' : undefined,
      current: () => intent === gallery.imageIntent && (!viewing || (dialog.open && activeGallery === gallery)),
      allow: () => !automatic || canPlay(gallery, true),
      prepare: viewing ? (retry, signal) => Promise.all([
        imageDelivery.ready(source, retry && !source.naturalWidth, signal),
        imageDelivery.ready(next, retry, signal)
      ]) : null
    });
    if (intent === gallery.imageIntent && !state.error) gallery.requestedIndex = null;
    schedule(gallery);
  }
  function renderDialog() {
    return selectIndex(activeGallery, activeGallery.index, false, false, true);
  }
  function updateDialog(gallery) {
    const slide = gallery.slides[gallery.index];
    dialog.querySelector('h2').textContent = gallery.element.dataset.gallery;
    dialog.querySelector('[data-dialog-caption]').textContent = slide.dataset.caption;
    dialog.querySelector('[data-dialog-caption]').hidden = gallery.element.classList.contains('interest-gallery');
    dialog.querySelector('[data-dialog-count]').textContent = String(gallery.index + 1) + ' / ' + gallery.slides.length;
    ['[data-dialog-prev]', '[data-dialog-next]', '[data-dialog-count]'].forEach((selector) => {
      dialog.querySelector(selector).hidden = gallery.slides.length < 2;
    });
    const viewport = dialog.querySelector('.dialog-image-viewport');
    viewport.scrollTop = 0; viewport.scrollLeft = 0;
  }
  function open(event, gallery) {
    if (typeof dialog.showModal !== 'function' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    viewerSession += 1;
    activeGallery = gallery;
    opener = event.currentTarget;
    const image = dialog.querySelector('.dialog-image');
    image.hidden = true;
    image.removeAttribute('src');
    image.alt = '';
    dialogStatus.textContent = '';
    updateDialog(gallery);
    setZoom(false);
    document.documentElement.classList.add('gallery-open');
    dialog.showModal();
    renderDialog();
    galleries.forEach(schedule);
  }
  function closeViewer(restoreFocus = true) {
    if (!dialog.open) return;
    const gallery = activeGallery;
    closedViews.push({ session: viewerSession, routeEpoch, gallery, opener, restoreFocus });
    imageDelivery.cancel(dialogDelivery);
    if (gallery) { gallery.imageIntent += 1; gallery.requestedIndex = null; }
    activeGallery = null;
    opener = null;
    dialogStatus.textContent = '';
    dialog.close();
  }
  document.addEventListener('manuals-route-visit', () => {
    routeEpoch += 1;
    closeViewer(false);
  }, { capture: true });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer();
  });
  function setZoom(active) {
    dialog.classList.toggle('is-zoomed', active);
    const zoom = dialog.querySelector('[data-dialog-zoom]');
    zoom.setAttribute('aria-pressed', String(active));
    zoom.textContent = active ? 'Fit image' : 'View detail';
    dialog.querySelector('[data-dialog-hint]').hidden = !active;
    const viewport = dialog.querySelector('.dialog-image-viewport');
    viewport.scrollTop = 0; viewport.scrollLeft = 0;
    viewport.tabIndex = active ? 0 : -1;
    if (active) viewport.focus({ preventScroll: true });
  }
  dialog.querySelector('[data-dialog-zoom]').addEventListener('click', () => setZoom(!dialog.classList.contains('is-zoomed')));
  dialog.querySelector('[data-dialog-close]').addEventListener('click', () => closeViewer());
  dialog.querySelector('[data-dialog-prev]').addEventListener('click', () => select(activeGallery, -1));
  dialog.querySelector('[data-dialog-next]').addEventListener('click', () => select(activeGallery, 1));
  dialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.shiftKey && event.key !== 'Tab')) return;
    const viewport = dialog.querySelector('.dialog-image-viewport');
    if (dialog.classList.contains('is-zoomed') && document.activeElement === viewport && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const direction = { ArrowLeft: [-120, 0], ArrowRight: [120, 0], ArrowUp: [0, -120], ArrowDown: [0, 120] }[event.key];
      viewport.scrollBy({ left: direction[0], top: direction[1], behavior: 'instant' });
      return;
    }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button:not([hidden]), [tabindex="0"]')]
        .filter((control) => control.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // Keep arrow keys available for panning a magnified image.
      if (dialog.classList.contains('is-zoomed')) return;
      event.preventDefault();
      select(activeGallery, event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeViewer();
  });
  dialog.addEventListener('close', () => {
    const closed = closedViews.shift();
    if (!closed || closed.session !== viewerSession || dialog.open) return;
    if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('gallery-open');
    if (closed.restoreFocus && closed.routeEpoch === routeEpoch) {
      const focusTarget = closed.opener?.classList.contains('gallery-image') ? closed.gallery?.slides[closed.gallery.index] : closed.opener;
      if (focusTarget?.isConnected && !focusTarget.hidden) focusTarget.focus({ preventScroll: true });
    }
    galleries.forEach(schedule);
  });

})();

(() => {
  const approved = JSON.parse(document.querySelector('#approved-quotes').textContent)
    .filter((quote) => quote.approved === true && quote.text && quote.attribution);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-quote-group]').forEach((carousel) => {
    let quotes = approved.filter((quote) => quote.group === carousel.dataset.quoteGroup);
    if (carousel.dataset.quoteGroup === 'alternating') {
      const sam = approved.filter((quote) => quote.group === 'sam');
      const others = approved.filter((quote) => quote.group === 'inspiration');
      const gcd = (a, b) => b ? gcd(b, a % b) : a;
      if (sam.length && others.length) {
        const rounds = sam.length * others.length / gcd(sam.length, others.length);
        quotes = Array.from({ length: rounds * 2 }, (_, slot) => {
          const pool = slot % 2 ? others : sam;
          return pool[Math.floor(slot / 2) % pool.length];
        });
      } else quotes = sam.length ? sam : others;
    }
    if (!quotes.length) { carousel.hidden = true; return; }
    const copy = carousel.querySelector('.site-maxim');
    const text = carousel.querySelector('[data-quote-text]');
    const attribution = carousel.querySelector('[data-quote-attribution]');
    let index = returnView.quoteIndex(carousel, quotes);
    let timer = null;
    let hovered = false;

    function render(automatic = false, announce = true) {
      // A manual step must not inherit a paused fade from the previous quote.
      copy.getAnimations().forEach((animation) => animation.cancel());
      const quote = quotes[index];
      copy.setAttribute('aria-live', automatic || !announce ? 'off' : 'polite');
      text.textContent = `“${capitalizeQuote(quote.text)}”`;
      attribution.textContent = ` / ${quote.attribution}`;
      let source;
      try {
        if (typeof quote.sourceUrl === 'string') source = new URL(quote.sourceUrl);
      } catch { /* Keep the approved attribution as plain text. */ }
      if (source?.protocol === 'https:' && !source.username && !source.password) {
        const link = document.createElement('a');
        link.href = source.href;
        link.rel = 'noopener noreferrer';
        link.textContent = quote.attribution;
        const format = quote.sourceType === 'pdf' ? ' (PDF)' : '';
        link.setAttribute('aria-label', `Source for this quotation by ${quote.attribution}${format}`);
        link.title = `${typeof quote.sourceTitle === 'string' ? quote.sourceTitle : 'Quotation source'}${format}`;
        attribution.replaceChildren(document.createTextNode(' / '), link);
      }
      carousel.dataset.quoteId = quote.id;
      carousel.dataset.quoteSource = quote.group;
      returnView.noteQuote(carousel, quote, index);
      if (automatic && typeof copy.animate === 'function') {
        copy.animate([{ opacity: reducedMotion.matches ? .85 : .7 }, { opacity: 1 }], { duration: 1100, easing: 'ease-in-out' });
      }
    }
    function canRotate() {
      return quotes.length > 1 && !document.hidden && !autoplayPolicy.paused && !hovered
        && !carousel.contains(document.activeElement) && !document.querySelector('dialog[open]');
    }
    function schedule() {
      if (!canRotate()) {
        window.clearTimeout(timer);
        timer = null;
        return;
      }
      if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          if (canRotate()) { index = (index + 1) % quotes.length; render(true); }
          schedule();
        }, Math.min(36000, Math.max(22000, (quotes[index].text.split(/\s+/).length / 3 + 3) * 1000)));
      }
    }
    function step(delta) {
      window.clearTimeout(timer);
      timer = null;
      index = (index + delta + quotes.length) % quotes.length;
      render();
      schedule();
    }
    carousel.querySelector('[data-quote-prev]').addEventListener('click', () => step(-1));
    carousel.querySelector('[data-quote-next]').addEventListener('click', () => step(1));
    carousel.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') { hovered = true; schedule(); } });
    carousel.addEventListener('pointerleave', () => { hovered = false; schedule(); });
    carousel.addEventListener('focusin', schedule);
    carousel.addEventListener('pointerdown', () => window.setTimeout(schedule, 0));
    carousel.addEventListener('keydown', () => window.setTimeout(schedule, 0));
    carousel.addEventListener('focusout', () => window.setTimeout(schedule, 0));
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('autoplay-policy-change', schedule);
    document.querySelectorAll('dialog').forEach((dialog) => { dialog.addEventListener('toggle', schedule); dialog.addEventListener('close', schedule); });
    reducedMotion.addEventListener('change', schedule);
    carousel.querySelectorAll('[data-quote-prev], [data-quote-next]').forEach((button) => { button.hidden = quotes.length < 2; });
    render(false, autoplayPolicy.paused);
    schedule();
  });

  const header = document.querySelector('.masthead');
  const inspiration = document.querySelector('.inspiration-bar');
  const shortcuts = document.querySelector('.mobile-shortcuts');
  const sitemap = document.querySelector('.section-index');
  const mobileMap = document.querySelector('.mobile-index');
  const phoneMap = window.matchMedia('(max-width: 860px)');
  const responsiveNavigation = [
    { desktop: sitemap, phone: mobileMap },
    { desktop: document.querySelector('.header-actions > .social-links'), phone: document.querySelector('.elsewhere-menu') },
  ];
  let navigationFocus = null;
  document.addEventListener('focusin', (event) => {
    navigationFocus = responsiveNavigation.some(({ desktop, phone }) => desktop?.contains(event.target) || phone?.contains(event.target))
      ? event.target : null;
  });
  document.addEventListener('focusout', (event) => {
    // Retain only the control which the breakpoint itself has hidden.
    if (event.target === navigationFocus && event.target.getClientRects().length) navigationFocus = null;
  });
  phoneMap.addEventListener('change', () => {
    const origin = navigationFocus;
    const isPhone = phoneMap.matches;
    if (!origin || origin.getClientRects().length) return;
    const pair = responsiveNavigation.find(({ desktop, phone }) => desktop?.contains(origin) || phone?.contains(origin));
    if (!pair?.desktop || !pair.phone) return;
    window.requestAnimationFrame(() => {
      if (navigationFocus !== origin || phoneMap.matches !== isPhone || document.querySelector('dialog[open]')
        || (document.activeElement !== document.body && document.activeElement !== origin)) return;
      let target = pair.phone.querySelector('summary');
      if (!isPhone) {
        const href = origin.getAttribute('href');
        const section = origin.dataset.sectionLink;
        target = [...pair.desktop.querySelectorAll('a, summary')].find((item) =>
          (href && item.getAttribute('href') === href) || (section && item.dataset.sectionLink === section))
          || pair.desktop.querySelector('[aria-current="location"]') || pair.desktop.querySelector('a');
        const disclosure = target?.closest('details');
        if (disclosure && target.tagName !== 'SUMMARY') disclosure.open = true;
      }
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  });
  const root = document.documentElement;
  const measure = () => {
    const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
    const focused = document.activeElement;
    const wasInFlow = inspiration.classList.contains('is-in-flow');
    const wasMapTall = sitemap?.classList.contains('is-tall');
    const footerHeight = inspiration.getBoundingClientRect().height;
    const previousFooterHeight = parseFloat(root.style.getPropertyValue('--inspiration-height'));
    inspiration.classList.toggle('is-in-flow', footerHeight > Math.max(96, window.innerHeight * .25));
    const reservedFooterHeight = inspiration.classList.contains('is-in-flow') ? 0 : footerHeight;
    root.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
    const jumpHeight = phoneMap.matches ? mobileMap.querySelector('summary').getBoundingClientRect().height : 0;
    root.style.setProperty('--shortcuts-height', `${jumpHeight}px`);
    root.style.setProperty('--inspiration-height', `${reservedFooterHeight}px`);
    if (sitemap) {
      const available = window.innerHeight - header.getBoundingClientRect().height - reservedFooterHeight - 40;
      sitemap.classList.toggle('is-tall', sitemap.getBoundingClientRect().height > Math.max(0, available));
    }
    // Keep the active control visible when its containing surface changes position.
    const focusedSurfaceMoved = (wasInFlow !== inspiration.classList.contains('is-in-flow') && inspiration.contains(focused))
      || (sitemap && wasMapTall !== sitemap.classList.contains('is-tall') && sitemap.contains(focused));
    if (focusedSurfaceMoved) {
      window.requestAnimationFrame(() => {
        if (document.activeElement === focused && !document.querySelector('dialog[open]')) {
          focused.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      });
    // Keep the final paragraph above a growing footer when the reader is at the end.
    } else if (atBottom && reservedFooterHeight !== previousFooterHeight && !document.querySelector('dialog[open]')) {
      window.requestAnimationFrame(() => {
        if (!document.querySelector('dialog[open]')) {
          window.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
        }
      });
    }
  };
  // Different enter/exit thresholds avoid a shrink/expand loop from layout reflow.
  const compact = () => {
    if (window.scrollY > 96) header.classList.add('is-compact');
    else if (window.scrollY < 8) header.classList.remove('is-compact');
  };
  window.addEventListener('scroll', compact, { passive: true });
  new ResizeObserver(measure).observe(header);
  new ResizeObserver(measure).observe(inspiration);
  new ResizeObserver(measure).observe(document.querySelector('.mobile-index'));
  if (sitemap) new ResizeObserver(measure).observe(sitemap);
  window.addEventListener('resize', measure);
  window.addEventListener('pageshow', compact);
  compact();
  measure();
})();

// The local review server supplies optional links outside the public artifact.
(async () => {
  if (!['localhost', '127.0.0.1'].includes(window.location.hostname) || window.location.port !== '4181') return;
  try {
    const config = document.querySelector('meta[name="manuals-local-treasury-demo"]');
    if (!config) return;
    const demo = new URL(config.content);
    if (demo.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(demo.hostname) || demo.username || demo.password) return;
    const links = document.querySelector('#treasury .project-links');
    if (!links) return;
    const link = document.createElement('a');
    link.href = demo.href;
    link.rel = 'noreferrer noopener';
    link.className = 'text-link';
    link.textContent = 'Check out demo site ↗';
    links.append(link);
  } catch { /* Optional review links do not affect the public site. */ }
})();
