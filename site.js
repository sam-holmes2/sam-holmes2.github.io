(() => {
  const dialog = document.querySelector('.project-dialog');
  const panels = [...dialog.querySelectorAll('[data-project]')];
  let opener = null;
  const findPanel = (hash) => {
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return null; }
    return panels.find((panel) => panel.dataset.project === id || [...panel.querySelectorAll('[id]')].some((target) => target.id === id));
  };
  function show(panel, trigger = null) {
    opener = trigger || document.getElementById(panel.dataset.project)?.querySelector('.shelf-open');
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
      panel.querySelector(link.hash)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    show(panel, link);
    window.history.replaceState(null, '', link.hash);
  });
  window.addEventListener('hashchange', () => {
    const panel = findPanel(window.location.hash);
    if (panel) show(panel);
    else if (dialog.open) dialog.close();
  });
  dialog.querySelector('[data-project-close]').addEventListener('click', () => dialog.close());
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
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('gallery-open');
    if (findPanel(window.location.hash)) window.history.replaceState(null, '', '#projects');
    opener?.focus({ preventScroll: true });
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
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeGallery = null;
  let opener = null;
  const galleries = [...document.querySelectorAll('[data-gallery]')].map((element) => {
    const slides = [...element.querySelectorAll('.gallery-image')];
    const gallery = { element, slides, index: 0, timer: null, visible: false, hovered: false, paused: reducedMotion.matches };
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

  function canPlay(gallery) {
    const held = gallery.paused || gallery.hovered || gallery.element.contains(document.activeElement) || dialog.open;
    return gallery.slides.length > 1 && gallery.visible && !document.hidden && !held;
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
      schedule(gallery);
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
    gallery.index = (gallery.index + step + gallery.slides.length) % gallery.slides.length;
    render(gallery, automatic);
    if (dialog.open && activeGallery === gallery) renderDialog();
    schedule(gallery);
  }
  function renderDialog() {
    const slide = activeGallery.slides[activeGallery.index];
    const source = slide.querySelector('img');
    const image = dialog.querySelector('.dialog-image');
    image.src = source.src;
    image.alt = source.alt;
    dialog.querySelector('h2').textContent = activeGallery.element.dataset.gallery;
    dialog.querySelector('[data-dialog-caption]').textContent = slide.dataset.caption;
    dialog.querySelector('[data-dialog-caption]').hidden = activeGallery.element.classList.contains('interest-gallery');
    dialog.querySelector('[data-dialog-count]').textContent = `${activeGallery.index + 1} / ${activeGallery.slides.length}`;
    ['[data-dialog-prev]', '[data-dialog-next]', '[data-dialog-count]'].forEach((selector) => {
      dialog.querySelector(selector).hidden = activeGallery.slides.length < 2;
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
    renderDialog();
    document.documentElement.classList.add('gallery-open');
    dialog.showModal();
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
    if (index >= 0) { gallery.index = index; render(gallery); schedule(gallery); }
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
    const initial = frame.querySelector('img').getAttribute('src');
    sources.sort((a, b) => Number(b.getAttribute('src') === initial) - Number(a.getAttribute('src') === initial));
    const images = sources.map((source, index) => {
      const image = source.cloneNode();
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
    const preview = { card, frame, images, index: 0, timer: null, visible: false, hovered: false, paused: false };
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
  function canPlay(preview) {
    return preview.visible && !preview.paused && !preview.hovered && !preview.card.contains(document.activeElement)
      && !document.hidden && !document.querySelector('dialog[open]');
  }
  function schedule(preview) {
    window.clearTimeout(preview.timer);
    preview.timer = null;
    if (!canPlay(preview)) return;
    preview.timer = window.setTimeout(() => {
      if (!canPlay(preview)) return;
      preview.index = (preview.index + 1) % preview.images.length;
      preview.images.forEach((image, index) => {
        image.classList.toggle('is-current', index === preview.index);
        image.setAttribute('aria-hidden', String(index !== preview.index));
      });
      preview.frame.dataset.carouselIndex = String(preview.index);
      schedule(preview);
    }, 7500);
  }
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    const preview = previews.find(item => item.card === entry.target);
    preview.visible = entry.isIntersecting;
    schedule(preview);
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
        text.textContent = `“${quotes[index].text}”`;
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
    carousel.querySelectorAll('button').forEach((button) => { button.hidden = quotes.length < 2; });
    render();
    schedule();
  });

  const header = document.querySelector('.masthead');
  const inspiration = document.querySelector('.inspiration-bar');
  const root = document.documentElement;
  const measure = () => {
    root.style.setProperty('--header-height', `${header.getBoundingClientRect().height}px`);
    root.style.setProperty('--inspiration-height', `${inspiration.getBoundingClientRect().height}px`);
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
