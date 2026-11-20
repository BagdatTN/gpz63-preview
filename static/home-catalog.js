(() => {
  const studioFrameQueue = [];
  const busyStudioBearings = new Set();
  let studioFramesLoading = 0;

  function startStudioFrameLoads() {
    while (studioFramesLoading < 4 && studioFrameQueue.length) {
      const urgentIndex = studioFrameQueue.findIndex(frame => frame.isUrgent());
      if (urgentIndex === -1 && busyStudioBearings.size) return;
      const [frame] = studioFrameQueue.splice(Math.max(0, urgentIndex), 1);
      studioFramesLoading++;
      frame.prepare().then(frame.resolve, () => frame.resolve(null)).finally(() => {
        studioFramesLoading--;
        startStudioFrameLoads();
      });
    }
  }

  function queueStudioFrame(prepare, isUrgent) {
    return new Promise(resolve => {
      studioFrameQueue.push({ prepare, isUrgent, resolve });
      startStudioFrameLoads();
    });
  }

  function createStudioFrameBank() {
    return { frames: [], pending: [] };
  }

  function setupStudioBearing(button) {
    const card = button.closest('.home-construction-card');
    const image = button.querySelector('img');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const desktopHover = matchMedia('(min-width: 901px) and (hover: hover) and (pointer: fine)');
    const last = Number(button.dataset.studioFrameCount) - 1;
    const sourceSize = Number(image.getAttribute('width'));
    const paths = Array.from({ length: last + 1 }, (_, index) =>
      new URL(`f${String(index).padStart(3, '0')}.webp`, image.src).href);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      canvas.className = 'home-bearing-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.hidden = true;
      button.append(canvas);
    }
    let frameBank = createStudioFrameBank();
    let nearViewport = false;
    let releaseTimer = 0;
    let hovered = false;
    let latched = false;
    let suppressHover = false;
    let position = 0;
    let frameIndex = -1;
    let request = 0;
    let revision = 0;

    function desiredPose() {
      return Number(latched || (desktopHover.matches && hovered && !suppressHover && !reduced.matches));
    }

    function displaySize() {
      const edge = Math.min(button.clientWidth, button.clientHeight);
      return Math.max(1, Math.min(sourceSize, Math.ceil(edge * Math.min(devicePixelRatio, 1.5))));
    }

    function decode(index) {
      const bank = frameBank;
      if (bank.frames[index]) return Promise.resolve(bank.frames[index]);
      return bank.pending[index] ??= queueStudioFrame(async () => {
        if (bank !== frameBank) return null;
        if (reduced.matches && index !== 0 && index !== last) return null;
        bank.size ??= displaySize();
        if (context && typeof createImageBitmap === 'function') {
          const response = await fetch(paths[index]);
          if (!response.ok) return null;
          const source = await response.blob();
          if (bank !== frameBank) return null;
          try {
            return await createImageBitmap(source, {
              resizeWidth: bank.size,
              resizeHeight: bank.size,
              resizeQuality: 'high',
            });
          } catch {
            // Image drawing also supports browsers without bitmap resizing.
          }
        }
        if (bank !== frameBank) return null;
        const frame = new Image();
        frame.src = paths[index];
        await frame.decode();
        return frame;
      }, () => bank === frameBank && busyStudioBearings.has(button)).then(frame => {
        bank.pending[index] = null;
        if (bank !== frameBank) {
          frame?.close?.();
          return null;
        }
        bank.frames[index] = frame;
        return frame;
      });
    }

    function warm() {
      if (reduced.matches || !context) return decode(last);
      const bank = frameBank;
      bank.motion ??= Promise.all([decode(last), ...paths.slice(0, last).map((_, index) => decode(index))])
        .then(results => {
          if (bank !== frameBank) return false;
          const ready = results.every(Boolean);
          if (!ready) bank.motion = null;
          if (ready && frameIndex === 0 && canvas.hidden && image.complete && image.naturalWidth) {
            paint(bank.frames[0]);
          }
          return ready;
        });
      return bank.motion;
    }

    function paint(frame) {
      const size = frameBank.size;
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
        context.globalCompositeOperation = 'copy';
      }
      context.drawImage(frame, 0, 0, size, size);
      if (canvas.hidden) {
        canvas.hidden = false;
        button.dataset.homeModelState = 'ready';
      }
    }

    function showStill(index) {
      canvas.hidden = true;
      delete button.dataset.homeModelState;
      if (image.src !== paths[index]) image.src = paths[index];
    }

    function draw(progress) {
      const index = Math.round(progress * last);
      if (index === frameIndex) return;
      const frame = frameBank.frames[index];
      if (context && frame) {
        paint(frame);
      } else {
        showStill(index);
      }
      frameIndex = index;
      button.dataset.homeModelFrame = String(index);
      button.dataset.homeModelPose = index === 0 ? 'assembled' : index === last ? 'exploded' : 'transition';
    }

    function finishStudioDemand() {
      if (busyStudioBearings.delete(button)) startStudioFrameLoads();
    }

    function releaseOffscreenFrames() {
      if (nearViewport) return;
      revision++;
      cancelAnimationFrame(request);
      request = 0;
      hovered = suppressHover = false;
      position = Number(latched);
      draw(position);

      for (const frame of frameBank.frames) frame?.close?.();
      frameBank.frames.length = 0;
      frameBank = createStudioFrameBank();
      if (position === 0) showStill(0);
      if (canvas.hidden) {
        canvas.width = 0;
        canvas.height = 0;
      }
      finishStudioDemand();
    }

    async function updatePose() {
      const current = ++revision;
      cancelAnimationFrame(request);
      request = 0;
      const end = desiredPose();
      if (position === end) {
        finishStudioDemand();
        return;
      }
      busyStudioBearings.add(button);
      startStudioFrameLoads();
      try {
        const ready = await warm();
        if (current !== revision) return;
        if (reduced.matches || !context || !ready) {
          if ((!end || await decode(last)) && current === revision) {
            position = end;
            draw(position);
          }
          return;
        }
        const start = position;
        const duration = Math.abs(end - start) * 550;
        let startedAt;
        function advance(now) {
          request = 0;
          try {
            startedAt ??= now;
            const fraction = Math.min(1, Math.max(0, (now - startedAt) / duration));
            position = fraction === 1 ? end : start + (end - start) * fraction;
            draw(position);
            if (fraction < 1) request = requestAnimationFrame(advance);
          } finally {
            if (!request) finishStudioDemand();
          }
        }
        request = requestAnimationFrame(advance);
      } finally {
        if (current === revision && !request) finishStudioDemand();
      }
    }

    card.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      hovered = true;
      updatePose();
    });
    card.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'mouse') return;
      hovered = suppressHover = false;
      updatePose();
    });
    button.addEventListener('click', () => {
      latched = !latched;
      suppressHover = hovered && !latched;
      button.setAttribute('aria-pressed', String(latched));
      updatePose();
    });
    reduced.addEventListener('change', updatePose);
    desktopHover.addEventListener('change', updatePose);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        const { isIntersecting } = entries.at(-1);
        if (isIntersecting === nearViewport) return;
        nearViewport = isIntersecting;
        clearTimeout(releaseTimer);
        if (nearViewport) warm();
        else releaseTimer = setTimeout(releaseOffscreenFrames, 1500);
      }, { rootMargin: '240px 0px' });
      observer.observe(button);
    }
    draw(0);
  }

  const constructions = document.querySelector('[data-home-constructions][data-viewer-src]');
  if (constructions) {
    for (const button of constructions.querySelectorAll('[data-studio-frame-count]')) setupStudioBearing(button);
  }

  const manufacturerFlipMotion = matchMedia('(any-hover: hover) and (prefers-reduced-motion: no-preference)');
  for (const flip of document.querySelectorAll('[data-manufacturer-flip]')) {
    flip.closest('a').addEventListener('pointerenter', event => {
      if (!manufacturerFlipMotion.matches || event.pointerType === 'touch' || flip.getAnimations().length) return;
      flip.animate([
        { transform: 'rotateX(0deg)', easing: 'cubic-bezier(.38, 0, .32, 1)' },
        { transform: 'rotateX(370deg)', offset: .84, easing: 'ease-out' },
        { transform: 'rotateX(360deg)' },
      ], 620);
    });
  }

  for (const section of document.querySelectorAll('[data-home-rail-section]')) {
    const rail = section.querySelector('[data-home-rail]');
    const controls = section.querySelector('[data-rail-controls]');
    const previous = controls.querySelector('[data-rail-prev]');
    const next = controls.querySelector('[data-rail-next]');
    const [firstCard, secondCard] = rail.children;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let target = null;

    function syncControls() {
      const end = rail.scrollWidth - rail.clientWidth;
      if (target !== null && Math.abs(rail.scrollLeft - target) <= 1) target = null;
      const position = target ?? rail.scrollLeft;
      controls.hidden = end <= 1;
      rail.tabIndex = end > 1 ? 0 : -1;
      previous.setAttribute('aria-disabled', String(position <= 1));
      next.setAttribute('aria-disabled', String(position >= end - 1));
    }

    function move(direction) {
      const button = direction < 0 ? previous : next;
      if (button.getAttribute('aria-disabled') === 'true') return;
      if (!secondCard) return;
      const stride = secondCard.getBoundingClientRect().left - firstCard.getBoundingClientRect().left;
      const cardsPerPage = Math.max(1, Math.round(rail.clientWidth / stride));
      const firstVisible = Math.round((target ?? rail.scrollLeft) / stride);
      const end = rail.scrollWidth - rail.clientWidth;
      target = Math.min(end, Math.max(0, (firstVisible + direction * cardsPerPage) * stride));
      rail.scrollTo({ left: target, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      syncControls();
    }

    function syncManualScroll() {
      target = null;
      syncControls();
    }

    previous.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    rail.addEventListener('scroll', syncControls, { passive: true });
    rail.addEventListener('pointerdown', syncManualScroll);
    rail.addEventListener('wheel', syncManualScroll, { passive: true });
    rail.addEventListener('keydown', event => {
      if (event.target !== rail || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        move(event.key === 'ArrowLeft' ? -1 : 1);
      } else {
        target = event.key === 'Home' ? 0 : rail.scrollWidth - rail.clientWidth;
        rail.scrollTo({ left: target, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
        syncControls();
      }
    });
    if ('ResizeObserver' in window) new ResizeObserver(syncManualScroll).observe(rail);
    else window.addEventListener('resize', syncManualScroll);
    syncControls();
  }

  if (constructions?.querySelector('[data-home-bearing]') && 'IntersectionObserver' in window) {
    let loading = false;
    function loadViewer() {
      if (loading) return;
      loading = true;
      observer.disconnect();
      import(constructions.dataset.viewerSrc).catch(() => {
        for (const button of constructions.querySelectorAll('[data-home-bearing]')) {
          button.disabled = true;
          button.setAttribute('aria-pressed', 'false');
        }
      }).finally(() => {
        constructions.removeEventListener('click', rememberTap);
      });
    }

    function rememberTap(event) {
      const button = event.target.closest('[data-home-bearing]');
      if (!button) return;
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      loadViewer();
    }

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadViewer();
    }, { rootMargin: '0px 0px 500px' });
    constructions.addEventListener('click', rememberTap);
    observer.observe(constructions);
  }

})();
