// Keep a decoded, usable frame visible while another image loads.
const imageDelivery = (() => {
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
  async function ready(image, reload = false) {
    image.loading = 'eager';
    image.decoding = 'async';
    if (reload) {
      const source = image.getAttribute('src');
      image.removeAttribute('src');
      image.setAttribute('src', source);
    }
    let timer;
    let cleanup = () => {};
    const decoding = typeof image.decode === 'function' ? image.decode() : new Promise((resolve, reject) => {
      const loaded = () => resolve();
      const failed = () => reject(new Error('Image request failed'));
      cleanup = () => { image.removeEventListener('load', loaded); image.removeEventListener('error', failed); };
      if (image.complete) { image.naturalWidth > 0 ? resolve() : failed(); return; }
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
    });
    try {
      await Promise.race([decoding, new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Image loading timed out')), 15000);
      })]);
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('Image has no decoded pixels');
    } finally { window.clearTimeout(timer); cleanup(); }
  }
  function cancel(state) {
    state.serial += 1;
    state.pending = false;
    state.error = false;
    state.retryAction = null;
    state.status.hidden = true;
    state.root.removeAttribute('aria-busy');
    state.root.dataset.imageState = 'ready';
  }
  async function request(state, image, commit, retryAction, { reload = false, allow = () => true, current = () => true, prepare = null } = {}) {
    const serial = ++state.serial;
    state.pending = true;
    state.error = false;
    state.retryAction = retryAction;
    state.root.dataset.imageState = 'loading';
    state.root.setAttribute('aria-busy', 'true');
    state.status.hidden = false;
    state.message.textContent = 'Loading image…';
    state.retry.hidden = !reload;
    state.retry.textContent = reload ? 'Retrying…' : 'Retry image';
    state.retry.setAttribute('aria-disabled', String(reload));
    try {
      await (prepare ? prepare(reload) : ready(image, reload));
      if (serial !== state.serial) return false;
      if (!current()) { cancel(state); return false; }
      if (!allow()) { cancel(state); return false; }
      commit();
      if (document.activeElement === state.retry) {
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
      state.root.dataset.imageState = 'error';
      state.root.removeAttribute('aria-busy');
      state.message.textContent = 'Image couldn’t load. The current view is unchanged.';
      state.retry.hidden = false;
      state.retry.textContent = 'Retry image';
      state.retry.setAttribute('aria-disabled', 'false');
      return false;
    }
  }
  return { create, ready, request, cancel };
})();

const capitalizeQuote = (text) => text.replace(/\p{L}/u, (letter) => letter.toUpperCase());

(() => {
  const dialog = document.querySelector('.project-dialog');
  const panels = [...dialog.querySelectorAll('[data-project]')];
  const historyKey = 'samuelsManualsProject';
  let opener = null;
  let openerProject = null;
  let returnEntry = null;
  let pendingReturn = null;
  let closingViaHistory = false;
  let lastHref = window.location.href;
  const findPanel = (hash) => {
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return null; }
    return panels.find((panel) => panel.dataset.project === id || [...panel.querySelectorAll('[id]')].some((target) => target.id === id));
  };
  const readEntry = (panel) => {
    const entry = window.history.state?.[historyKey];
    return panel && entry?.version === 1 && entry.project === panel.dataset.project
      && entry.hash === window.location.hash && typeof entry.parentHash === 'string'
      && Number.isFinite(entry.x) && Number.isFinite(entry.y) ? entry : null;
  };
  function clearEntry() {
    const state = { ...window.history.state };
    delete state[historyKey];
    return Object.keys(state).length ? state : null;
  }
  function closeViewer() {
    const viewer = document.querySelector('.gallery-dialog');
    if (viewer?.open) viewer.close();
  }
  function show(panel, trigger = null) {
    opener = trigger || (openerProject === panel.dataset.project ? opener : null)
      || document.getElementById(panel.dataset.project)?.querySelector('.shelf-open');
    openerProject = panel.dataset.project;
    returnEntry = readEntry(panel);
    pendingReturn = null;
    panels.forEach((item) => { item.hidden = item !== panel; });
    dialog.querySelector('h2').textContent = panel.dataset.title;
    document.documentElement.classList.add('gallery-open');
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    const preview = document.getElementById(panel.dataset.project)?.querySelector('.shelf-image img.is-current');
    if (preview) document.dispatchEvent(new CustomEvent('project-preview-select', { detail: { project: panel.dataset.project, source: preview.getAttribute('src') } }));
    dialog.querySelector('[data-project-close]').focus({ preventScroll: true });
  }
  document.querySelectorAll('.shelf-open').forEach((link) => link.setAttribute('aria-haspopup', 'dialog'));
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const panel = findPanel(link.hash);
    if (!panel) return;
    event.preventDefault();
    // Keep internal gallery links within the currently open project.
    if (dialog.open && panel.contains(link)) {
      const target = panel.querySelector(link.hash);
      target?.scrollIntoView({ block: 'nearest' });
      target?.querySelector('button:not([hidden]), a[href]')?.focus({ preventScroll: true });
      return;
    }
    const entry = { version: 1, project: panel.dataset.project, hash: link.hash,
      parentHash: window.location.hash, x: window.scrollX, y: window.scrollY };
    window.history.pushState({ ...window.history.state, [historyKey]: entry }, '', link.hash);
    lastHref = window.location.href;
    show(panel, link);
  });
  function syncLocation() {
    const panel = findPanel(window.location.hash);
    if (lastHref === window.location.href && dialog.open === Boolean(panel) && (!panel || !panel.hidden)) return;
    lastHref = window.location.href;
    closingViaHistory = false;
    if (panel) { closeViewer(); show(panel); }
    else if (dialog.open) {
      pendingReturn = returnEntry?.parentHash === window.location.hash
        ? { type: 'restore', ...returnEntry } : null;
      closeViewer();
      dialog.close();
    }
  }
  window.addEventListener('popstate', syncLocation);
  window.addEventListener('hashchange', syncLocation);
  window.addEventListener('pageshow', syncLocation);
  function closeProject() {
    if (!dialog.open || closingViaHistory) return;
    const entry = readEntry(panels.find((panel) => !panel.hidden));
    if (entry && window.history.length > 1) {
      closingViaHistory = true;
      window.history.back();
    } else {
      // A direct link has no known in-site parent entry to traverse.
      pendingReturn = { type: 'fallback' };
      window.history.replaceState(clearEntry(), '', '#projects');
      lastHref = window.location.href;
      closeViewer();
      dialog.close();
    }
  }
  dialog.querySelector('[data-project-close]').addEventListener('click', closeProject);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeProject(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('a[href], button:not([disabled]), summary, [tabindex="0"]')]
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
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeProject();
  });
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('gallery-open');
    if (findPanel(window.location.hash)) {
      window.history.replaceState(clearEntry(), '', '#projects');
      lastHref = window.location.href;
      pendingReturn = { type: 'fallback' };
    }
    const closedMenu = opener?.closest('details:not([open])');
    const focusTarget = closedMenu?.querySelector('summary') || opener;
    focusTarget?.focus({ preventScroll: true });
    const target = pendingReturn;
    const hash = window.location.hash;
    pendingReturn = null;
    if (target) window.requestAnimationFrame(() => {
      if (dialog.open || window.location.hash !== hash) return;
      if (target.type === 'restore') window.scrollTo({ left: target.x, top: target.y, behavior: 'instant' });
      else focusTarget?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  });
  const initialPanel = findPanel(window.location.hash);
  if (initialPanel) show(initialPanel);
})();

(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sections = [...document.querySelectorAll("[data-section]")];
  const links = [...document.querySelectorAll("[data-section-link]")];
  const layout = document.querySelector(".site-layout");
  const sublinks = [...document.querySelectorAll("[data-subsection-link]")];

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

  const updateCircuit = () => {
    const start = layout.offsetTop;
    const distance = Math.max(1, layout.offsetHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, (window.scrollY - start) / distance));
    document.documentElement.style.setProperty("--circuit-progress", `${progress * 100}%`);
  };

  const updateActiveSection = () => {
    const headerHeight = document.querySelector('.masthead').getBoundingClientRect().height;
    const shortcutsHeight = document.querySelector('.mobile-shortcuts').getBoundingClientRect().height;
    const marker = headerHeight + shortcutsHeight + 26;
    let active = sections[0];
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= marker) active = section;
    });
    let child = null;
    active.querySelectorAll('[data-sitemap-target]').forEach((target) => {
      if (target.getBoundingClientRect().top <= marker) child = target;
    });
    setActive(active.dataset.section, child?.id);
  };

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
    link.closest("details")?.removeAttribute("open");
    setActive(link.dataset.sectionLink);
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.hash.slice(1));
    if (target) {
      event.preventDefault();
      window.history.pushState(null, '', link.hash);
      target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'instant' : 'smooth' });
    }
  }));
  sublinks.forEach((link) => link.addEventListener('click', () => {
    link.closest('details')?.removeAttribute('open');
    setActive(link.dataset.parentSection, link.dataset.subsectionLink);
  }));
  updateCircuit();
  updateActiveSection();
})();

(() => {
  const dialog = document.querySelector('.gallery-dialog');
  const dialogDelivery = imageDelivery.create(dialog, 'enlarged');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeGallery = null;
  let opener = null;
  const galleries = [...document.querySelectorAll('[data-gallery]')].map((element) => {
    const slides = [...element.querySelectorAll('.gallery-image')];
    const gallery = { element, slides, index: 0, timer: null, visible: false, hovered: false, paused: reducedMotion.matches, requestedIndex: null, imageIntent: 0, delivery: imageDelivery.create(element, element.dataset.gallery) };
    const previous = element.querySelector('[data-gallery-prev]');
    const next = element.querySelector('[data-gallery-next]');
    const count = element.querySelector('[data-gallery-count]');
    [previous, next, count].forEach((control) => { control.hidden = slides.length < 2; });
    previous.addEventListener('click', () => select(gallery, -1));
    next.addEventListener('click', () => select(gallery, 1));
    slides.forEach((slide) => {
      if (typeof dialog.showModal === 'function') { slide.setAttribute('aria-haspopup', 'dialog'); slide.setAttribute('aria-label', `Enlarge ${element.dataset.gallery} image`); }
      slide.addEventListener('click', (event) => open(event, gallery));
    });
    const detail = element.querySelector('[data-gallery-detail]');
    if (detail) {
      detail.hidden = false;
      detail.addEventListener('click', () => {
        const active = element.classList.toggle('gallery-detail');
        detail.setAttribute('aria-pressed', String(active));
        detail.textContent = active ? 'Overview' : 'Detail';
      });
    }
    if (slides.length > 1) {
      const autoplay = document.createElement('button');
      autoplay.type = 'button';
      autoplay.className = 'gallery-autoplay';
      autoplay.textContent = gallery.paused ? 'Play' : 'Pause';
      autoplay.setAttribute('aria-label', `${gallery.paused ? 'Play' : 'Pause'} ${element.dataset.gallery} slideshow`);
      autoplay.addEventListener('click', () => {
        gallery.paused = !gallery.paused;
        autoplay.textContent = gallery.paused ? 'Play' : 'Pause';
        autoplay.setAttribute('aria-label', `${gallery.paused ? 'Play' : 'Pause'} ${element.dataset.gallery} slideshow`);
        schedule(gallery);
      });
      element.querySelector('.gallery-toolbar').append(autoplay);
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

  function canPlay(gallery, ignorePending = false) {
    const held = gallery.paused || gallery.hovered || gallery.element.contains(document.activeElement) || dialog.open;
    return gallery.slides.length > 1 && gallery.visible && !document.hidden && !held
      && !gallery.delivery.error && (ignorePending || !gallery.delivery.pending);
  }
  function schedule(gallery) {
    window.clearTimeout(gallery.timer);
    gallery.timer = null;
    if (canPlay(gallery)) {
      gallery.timer = window.setTimeout(() => {
        if (canPlay(gallery)) select(gallery, 1, true);
        else schedule(gallery);
      }, 8000);
    }
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const gallery = galleries.find((item) => item.element === entry.target);
      gallery.visible = entry.isIntersecting;
      const image = gallery.slides[gallery.index].querySelector('img');
      if (gallery.visible && !gallery.delivery.pending && !gallery.delivery.error && (!image.complete || !image.naturalWidth)) {
        selectIndex(gallery, gallery.index);
      } else schedule(gallery);
    });
  }, { threshold: .15 });
  galleries.forEach((gallery) => observer.observe(gallery.element));
  document.addEventListener('visibilitychange', () => galleries.forEach(schedule));
  reducedMotion.addEventListener('change', () => galleries.forEach((gallery) => {
    if (reducedMotion.matches) {
      gallery.paused = true;
      const control = gallery.element.querySelector('.gallery-autoplay');
      if (control) { control.textContent = 'Play'; control.setAttribute('aria-label', `Play ${gallery.element.dataset.gallery} slideshow`); }
    }
    schedule(gallery);
  }));

  function render(gallery, automatic = false) {
    gallery.slides.forEach((slide, index) => { slide.hidden = index !== gallery.index; });
    const slide = gallery.slides[gallery.index];
    const caption = gallery.element.querySelector('.gallery-caption');
    if (caption) {
      caption.setAttribute('aria-live', automatic ? 'off' : 'polite');
      caption.textContent = slide.dataset.caption;
    }
    gallery.element.querySelector('[data-gallery-count]').textContent = `${gallery.index + 1} / ${gallery.slides.length}`;
    gallery.element.querySelector('.gallery-toolbar').hidden = gallery.element.classList.contains('interest-gallery') && gallery.slides.length < 2;
  }
  function select(gallery, step, automatic = false) {
    const origin = gallery.requestedIndex ?? gallery.index;
    return selectIndex(gallery, (origin + step + gallery.slides.length) % gallery.slides.length, automatic);
  }
  async function selectIndex(gallery, index, automatic = false, reload = false, viewer = false) {
    const intent = ++gallery.imageIntent;
    const viewing = viewer || (dialog.open && activeGallery === gallery);
    const state = viewing ? dialogDelivery : gallery.delivery;
    const source = gallery.slides[index].querySelector('img');
    const next = viewing ? dialog.querySelector('.dialog-image').cloneNode(false) : source;
    if (viewing) { next.src = source.src; next.alt = source.alt; }
    gallery.requestedIndex = index;
    window.clearTimeout(gallery.timer);
    gallery.timer = null;
    await imageDelivery.request(state, next, () => {
      gallery.index = index;
      render(gallery, automatic);
      if (viewing) {
        dialog.querySelector('.dialog-image').replaceWith(next);
        updateDialog(gallery);
      }
    }, () => selectIndex(gallery, index, false, true, viewing), {
      reload,
      current: () => intent === gallery.imageIntent && (!viewing || (dialog.open && activeGallery === gallery)),
      allow: () => !automatic || canPlay(gallery, true),
      prepare: viewing ? (retry) => Promise.all([
        imageDelivery.ready(source, retry && !source.naturalWidth),
        imageDelivery.ready(next, retry)
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
    activeGallery = gallery;
    opener = event.currentTarget;
    setZoom(false);
    document.documentElement.classList.add('gallery-open');
    dialog.showModal();
    renderDialog();
    galleries.forEach(schedule);
  }
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
  dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-dialog-prev]').addEventListener('click', () => select(activeGallery, -1));
  dialog.querySelector('[data-dialog-next]').addEventListener('click', () => select(activeGallery, 1));
  dialog.addEventListener('keydown', (event) => {
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
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    imageDelivery.cancel(dialogDelivery);
    if (activeGallery) { activeGallery.imageIntent += 1; activeGallery.requestedIndex = null; }
    if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('gallery-open');
    const focusTarget = opener?.classList.contains('gallery-image') ? activeGallery.slides[activeGallery.index] : opener;
    focusTarget?.focus({ preventScroll: true });
    activeGallery = null;
    galleries.forEach(schedule);
  });
  document.addEventListener('project-preview-select', (event) => {
    const gallery = galleries.find(g => g.element.closest('[data-project]')?.dataset.project === event.detail.project);
    if (!gallery) return;
    const index = gallery.slides.findIndex(s => s.querySelector('img').getAttribute('src') === event.detail.source);
    if (index >= 0) selectIndex(gallery, index);
  });
})();

(() => {
  // Reuse the project's reviewed gallery images in its overview tile.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const previews = [];
  document.querySelectorAll('.shelf-card').forEach((card) => {
    const gallery = document.querySelector(`[data-project="${card.id}"] [data-gallery]`);
    if (!gallery) return;
    const sources = [...gallery.querySelectorAll('.gallery-image img')];
    if (sources.length < 2) return;
    const frame = card.querySelector('.shelf-image');
    const original = frame.querySelector('img');
    const initial = original.getAttribute('src');
    sources.sort((a, b) => Number(b.getAttribute('src') === initial) - Number(a.getAttribute('src') === initial));
    const images = sources.map((source, index) => {
      const image = index === 0 ? original : source.cloneNode();
      image.hidden = index !== 0;
      image.classList.toggle('is-current', index === 0);
      image.setAttribute('aria-hidden', String(index !== 0));
      return image;
    });
    frame.replaceChildren(...images);
    frame.dataset.carousel = '';
    frame.dataset.carouselIndex = '0';
    frame.dataset.carouselLength = String(images.length);
    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'shelf-pause';
    pause.textContent = 'Ⅱ';
    pause.setAttribute('aria-label', `Pause ${card.querySelector('h3').textContent} previews`);
    frame.append(pause);
    const preview = { card, frame, images, index: 0, timer: null, visible: false, hovered: false, paused: false, delivery: imageDelivery.create(frame, card.id) };
    previews.push(preview);
    pause.addEventListener('click', () => {
      preview.paused = !preview.paused;
      pause.textContent = preview.paused ? '▷' : 'Ⅱ';
      pause.setAttribute('aria-label', `${preview.paused ? 'Play' : 'Pause'} ${card.querySelector('h3').textContent} previews`);
      schedule(preview);
    });
    card.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') { preview.hovered = true; schedule(preview); } });
    card.addEventListener('pointerleave', () => { preview.hovered = false; schedule(preview); });
    card.addEventListener('focusin', () => schedule(preview));
    card.addEventListener('focusout', () => window.setTimeout(() => schedule(preview), 0));
  });
  function canPlay(preview, ignorePending = false) {
    return preview.visible && !preview.paused && !preview.hovered && !preview.card.contains(document.activeElement)
      && !document.hidden && !document.querySelector('dialog[open]')
      && !preview.delivery.error && (ignorePending || !preview.delivery.pending);
  }
  function schedule(preview) {
    window.clearTimeout(preview.timer);
    preview.timer = null;
    if (!canPlay(preview)) return;
    preview.timer = window.setTimeout(() => {
      if (!canPlay(preview)) return;
      showPreview(preview, (preview.index + 1) % preview.images.length, true);
    }, 7500);
  }
  async function showPreview(preview, index, automatic = false, reload = false) {
    await imageDelivery.request(preview.delivery, preview.images[index], () => {
      preview.index = index;
      preview.images[index].hidden = false;
      preview.images.forEach((image, current) => {
        image.classList.toggle('is-current', current === index);
        image.setAttribute('aria-hidden', String(current !== index));
      });
      preview.frame.dataset.carouselIndex = String(index);
    }, () => showPreview(preview, index, false, true), {
      reload,
      allow: () => !automatic || canPlay(preview, true)
    });
    schedule(preview);
  }
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    const preview = previews.find(item => item.card === entry.target);
    preview.visible = entry.isIntersecting;
    const image = preview.images[preview.index];
    if (preview.visible && !preview.delivery.pending && !preview.delivery.error && (!image.complete || !image.naturalWidth)) {
      showPreview(preview, preview.index);
    } else schedule(preview);
  }), { threshold: .15 });
  previews.forEach(preview => observer.observe(preview.card));
  document.addEventListener('visibilitychange', () => previews.forEach(schedule));
  reducedMotion.addEventListener('change', () => previews.forEach(schedule));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('toggle', () => previews.forEach(schedule));
    dialog.addEventListener('close', () => previews.forEach(schedule));
  });
})();

(() => {
  const approved = JSON.parse(document.querySelector('#approved-quotes').textContent)
    .filter((quote) => quote.approved === true && quote.text && quote.attribution);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-quote-group]').forEach((carousel) => {
    const quotes = approved.filter((quote) => quote.group === carousel.dataset.quoteGroup);
    if (!quotes.length) { carousel.hidden = true; return; }
    const copy = carousel.querySelector('.site-maxim');
    const text = carousel.querySelector('[data-quote-text]');
    const attribution = carousel.querySelector('[data-quote-attribution]');
    let index = 0;
    let timer = null;
    let fadeTimer = null;

    function render(animate = false) {
      window.clearTimeout(fadeTimer);
      const commit = () => {
        text.textContent = `“${capitalizeQuote(quotes[index].text)}”`;
        attribution.textContent = ` / ${quotes[index].attribution}`;
        carousel.dataset.quoteId = quotes[index].id;
        copy.classList.remove('is-changing');
      };
      if (animate && !reducedMotion.matches) {
        copy.classList.add('is-changing');
        fadeTimer = window.setTimeout(commit, 160);
      } else commit();
    }
    function schedule() {
      window.clearInterval(timer);
      timer = null;
      const keyboardFocus = carousel.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
      if (quotes.length > 1 && !document.hidden && !keyboardFocus) {
        timer = window.setInterval(() => { index = (index + 1) % quotes.length; render(true); }, 12000);
      }
    }
    function step(delta) {
      index = (index + delta + quotes.length) % quotes.length;
      render(true);
      schedule();
    }
    carousel.querySelector('[data-quote-prev]').addEventListener('click', () => step(-1));
    carousel.querySelector('[data-quote-next]').addEventListener('click', () => step(1));
    carousel.addEventListener('focusin', schedule);
    carousel.addEventListener('pointerdown', () => window.setTimeout(schedule, 0));
    carousel.addEventListener('keydown', () => window.setTimeout(schedule, 0));
    carousel.addEventListener('focusout', () => window.setTimeout(schedule, 0));
    document.addEventListener('visibilitychange', schedule);
    reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) render(); });
    carousel.querySelectorAll('[data-quote-prev], [data-quote-next]').forEach((button) => { button.hidden = quotes.length < 2; });
    render();
    schedule();
  });

  const header = document.querySelector('.masthead');
  const inspiration = document.querySelector('.inspiration-bar');
  const root = document.documentElement;
  const measure = () => {
    const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
    const footerHeight = inspiration.getBoundingClientRect().height;
    const previousFooterHeight = parseFloat(root.style.getPropertyValue('--inspiration-height'));
    root.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
    root.style.setProperty('--inspiration-height', `${footerHeight}px`);
    // Keep the final paragraph above a growing footer when the reader is at the end.
    if (atBottom && footerHeight !== previousFooterHeight && !document.querySelector('dialog[open]')) {
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
    const shelf = document.querySelector('#treasury .shelf-copy');
    const details = document.querySelector('[data-project="treasury"] .project-links');
    if (!shelf || !details) return;
    let shelfLinks = shelf.querySelector('.shelf-links');
    if (!shelfLinks) { shelfLinks = document.createElement('div'); shelfLinks.className = 'shelf-links'; shelf.append(shelfLinks); }
    [shelfLinks, details].forEach((container) => {
      const link = document.createElement('a');
      link.href = demo.href;
      link.rel = 'noreferrer noopener';
      link.textContent = 'Check out demo site ↗';
      if (container === details) link.className = 'text-link';
      container.append(link);
    });
  } catch { /* Optional review links do not affect the public site. */ }
})();
