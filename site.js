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
    const marker = Math.min(100, window.innerHeight * 0.18);
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
  links.forEach((link) => link.addEventListener("click", () => {
    link.closest("details")?.removeAttribute("open");
    setActive(link.dataset.sectionLink);
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
  const galleries = [...document.querySelectorAll('[data-gallery]')].map((element) => {
    const slides = [...element.querySelectorAll('.gallery-image')];
    const gallery = { element, slides, index: 0 };
    const previous = element.querySelector('[data-gallery-prev]');
    const next = element.querySelector('[data-gallery-next]');
    const count = element.querySelector('[data-gallery-count]');
    [previous, next, count].forEach((control) => { control.hidden = slides.length < 2; });
    previous.addEventListener('click', () => select(gallery, -1));
    next.addEventListener('click', () => select(gallery, 1));
    slides.forEach((slide) => slide.addEventListener('click', (event) => open(event, gallery)));
    const enlarge = element.querySelector('[data-gallery-enlarge]');
    enlarge.setAttribute('aria-label', `Enlarge ${element.dataset.gallery} screenshot`);
    if (typeof dialog.showModal === 'function') enlarge.setAttribute('aria-haspopup', 'dialog');
    enlarge.addEventListener('click', (event) => open(event, gallery));
    render(gallery);
    return gallery;
  });
  let activeGallery = null;
  let opener = null;

  function render(gallery) {
    gallery.slides.forEach((slide, index) => { slide.hidden = index !== gallery.index; });
    const slide = gallery.slides[gallery.index];
    gallery.element.querySelector('.gallery-caption').textContent = slide.dataset.caption;
    gallery.element.querySelector('[data-gallery-count]').textContent = `${gallery.index + 1} / ${gallery.slides.length}`;
    gallery.element.querySelector('[data-gallery-enlarge]').href = slide.href;
  }

  function select(gallery, step) {
    gallery.index = (gallery.index + step + gallery.slides.length) % gallery.slides.length;
    render(gallery);
    if (dialog.open && activeGallery === gallery) renderDialog();
  }

  function renderDialog() {
    const slide = activeGallery.slides[activeGallery.index];
    const source = slide.querySelector('img');
    const image = dialog.querySelector('.dialog-image');
    image.src = source.src;
    image.alt = source.alt;
    dialog.querySelector('h2').textContent = activeGallery.element.dataset.gallery;
    dialog.querySelector('[data-dialog-caption]').textContent = slide.dataset.caption;
    dialog.querySelector('[data-dialog-count]').textContent = `${activeGallery.index + 1} / ${activeGallery.slides.length}`;
    ['[data-dialog-prev]', '[data-dialog-next]', '[data-dialog-count]'].forEach((selector) => {
      dialog.querySelector(selector).hidden = activeGallery.slides.length < 2;
    });
  }

  function open(event, gallery) {
    if (typeof dialog.showModal !== 'function' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    activeGallery = gallery;
    opener = event.currentTarget;
    renderDialog();
    document.documentElement.classList.add('gallery-open');
    dialog.showModal();
  }

  dialog.querySelector('[data-dialog-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-dialog-prev]').addEventListener('click', () => select(activeGallery, -1));
  dialog.querySelector('[data-dialog-next]').addEventListener('click', () => select(activeGallery, 1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
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
    document.documentElement.classList.remove('gallery-open');
    const focusTarget = opener?.classList.contains('gallery-image') ? activeGallery.slides[activeGallery.index] : opener;
    focusTarget?.focus({ preventScroll: true });
    activeGallery = null;
  });
})();

(() => {
  const quotes = JSON.parse(document.querySelector('#approved-quotes').textContent)
    .filter((quote) => quote.approved === true && quote.text && quote.attribution);
  if (!quotes.length) return;
  const carousel = document.querySelector('.quote-carousel');
  const controls = carousel.querySelector('.quote-controls');
  const text = carousel.querySelector('[data-quote-text]');
  const attribution = carousel.querySelector('[data-quote-attribution]');
  const pause = carousel.querySelector('[data-quote-pause]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let paused = reducedMotion.matches;
  let timer = null;

  function render() {
    text.textContent = `“${quotes[index].text}”`;
    attribution.textContent = ` / ${quotes[index].attribution}`;
  }
  function schedule() {
    window.clearInterval(timer);
    timer = null;
    pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-label', paused ? 'Play quote rotation' : 'Pause quote rotation');
    if (quotes.length > 1 && !paused && !document.hidden && !carousel.matches(':hover') && !carousel.contains(document.activeElement)) {
      timer = window.setInterval(() => { index = (index + 1) % quotes.length; render(); }, 12000);
    }
  }
  function step(delta) {
    index = (index + delta + quotes.length) % quotes.length;
    render();
    schedule();
  }
  carousel.querySelector('[data-quote-prev]').addEventListener('click', () => step(-1));
  carousel.querySelector('[data-quote-next]').addEventListener('click', () => step(1));
  pause.addEventListener('click', () => { paused = !paused; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  carousel.addEventListener('focusin', () => { window.clearInterval(timer); });
  carousel.addEventListener('focusout', (event) => { if (!carousel.contains(event.relatedTarget)) schedule(); });
  carousel.addEventListener('mouseenter', () => { window.clearInterval(timer); });
  carousel.addEventListener('mouseleave', schedule);
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { paused = true; schedule(); } });
  controls.hidden = quotes.length < 2;
  render();
  schedule();
})();
