(() => {
  const hero = document.querySelector('[data-measurement-hero]');
  if (!hero) return;

  const header = document.querySelector('.site-header');
  const sticky = hero.querySelector('[data-measurement-sticky]');
  const stage = hero.querySelector('.measurement-stage');
  const image = hero.querySelector('[data-measurement-image]');
  const controls = hero.querySelector('[data-measurement-controls]');
  const buttons = Array.from(controls.querySelectorAll('button'));
  const messages = Array.from(hero.querySelectorAll('[data-measurement-message]'));
  const poses = buttons.map((button) => Number(button.dataset.measurementFrame));
  const desktop = matchMedia('(min-width: 901px) and (min-height: 620px) and (prefers-reduced-motion: no-preference)');
  const mobile = matchMedia('(max-width: 900px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const openingHoldEnd = 20;
  const lastFrame = 180;
  const frameDuration = 1000 / 24;
  const directory = new URL('.', image.src);
  const framePath = (frame) => new URL(`f${String(frame).padStart(3, '0')}.webp`, directory).href;
  const heldFrame = (frame) => {
    if (frame <= openingHoldEnd) return poses[0];
    if (frame >= 80 && frame <= 100) return poses[1];
    return frame >= 154 ? poses[2] : frame;
  };
  const sequence = Array.from(new Set(Array.from({ length: lastFrame }, (_, index) => heldFrame(index + 1))));
  const mobileLegs = poses.slice(1).map((pose, index) =>
    sequence.slice(sequence.indexOf(poses[index]), sequence.indexOf(pose) + 1)
  );

  let target = poses[0];
  let displayed = poses[0];
  let active = -1;
  let inFlight = 0;
  let scheduled = false;
  let mobileMotion = false;
  let mobilePose = 0;
  let destination = 0;
  let flight;
  let headerHeight = 0;
  const requested = new Set([poses[0]]);
  const settled = new Set([poses[0]]);
  const ready = new Set([poses[0]]);

  const render = () => {
    // Present the closest available frame and its matching caption during a fast scroll.
    let frame = displayed;
    for (const available of ready) {
      if (Math.abs(target - available) < Math.abs(target - frame)) frame = available;
    }
    if (frame !== displayed) {
      displayed = frame;
      image.src = framePath(frame);
    }
    const step = frame < 55 ? 0 : frame < 130 ? 1 : 2;
    if (step === active) return;
    if (active !== -1) hero.classList.add('has-switched');
    active = step;
    hero.dataset.measurementStep = String(step);
    messages.forEach((message, index) => {
      const inactive = index !== step;
      message.inert = inactive;
      message.setAttribute('aria-hidden', String(inactive));
    });
    buttons.forEach((button, index) => { button.setAttribute('aria-pressed', String(index === step)); });
  };

  const load = () => {
    const bounds = hero.getBoundingClientRect();
    const nearScene = bounds.bottom > -100 && bounds.top < window.innerHeight + 100;
    const candidates = [target];
    if (desktop.matches && nearScene) {
      candidates.push(openingHoldEnd + 1);
    }
    candidates.push(...poses);
    if (desktop.matches && nearScene) {
      candidates.push(...sequence.slice().sort((left, right) => Math.abs(left - target) - Math.abs(right - target)));
    }
    if (mobileMotion) {
      if (flight) candidates.push(...flight.frames);
      if (nearScene && !navigator.connection?.saveData) {
        const nextLeg = Math.min(flight?.next ?? mobilePose, mobileLegs.length - 1);
        candidates.push(...mobileLegs[nextLeg]);
      }
    }
    for (const frame of candidates) {
      if (inFlight >= 4) break;
      if (requested.has(frame)) continue;
      requested.add(frame);
      inFlight += 1;
      const preview = new Image();
      preview.src = framePath(frame);
      preview.decode().then(() => {
        ready.add(frame);
        render();
      }).catch(() => {
        // Keep the most recent usable frame if a background request fails.
      }).finally(() => {
        settled.add(frame);
        inFlight -= 1;
        load();
        if (flight && flight.start === undefined) schedule();
      });
    }
  };

  const mobileCrop = (progress) => {
    // Open the close-up as the bearing moves away from the jaws, then return to it.
    const edge = Math.min(1, progress / 0.32, (1 - progress) / 0.32);
    const zoom = edge * edge * (3 - 2 * edge);
    const width = 560 + 270 * zoom;
    const height = width * 454 / 560;
    image.style.setProperty('--frame-width', `${960 / width * 100}%`);
    image.style.setProperty('--frame-left', `${-(250 - 195 * zoom) / width * 100}%`);
    image.style.setProperty('--frame-top', `${-(75 - (height - 454) / 2) / height * 100}%`);
  };

  const clearMobileCrop = () => {
    ['--frame-width', '--frame-left', '--frame-top'].forEach((name) => image.style.removeProperty(name));
  };

  const advanceMobile = (now) => {
    if (!flight) {
      if (mobilePose === destination) return;
      const next = mobilePose + Math.sign(destination - mobilePose);
      const leg = mobileLegs[Math.min(mobilePose, next)];
      flight = { next, frames: next > mobilePose ? leg : leg.slice().reverse(), loadedThrough: -1 };
    }
    const { frames, next } = flight;
    const last = frames.length - 1;
    while (flight.loadedThrough < last && settled.has(frames[flight.loadedThrough + 1])) {
      flight.loadedThrough += 1;
    }
    if (flight.start === undefined) {
      if (flight.loadedThrough < Math.min(8, last)) return;
      flight.start = now;
    }
    const position = Math.min((now - flight.start) / frameDuration, flight.loadedThrough);
    if (position === flight.loadedThrough && position < last) {
      // Preserve the timing when a slow connection exhausts the buffered frames.
      flight.start = now - position * frameDuration;
    }
    const progress = position / last;
    target = frames[Math.floor(position)];
    if (progress === 1) {
      clearMobileCrop();
      mobilePose = next;
      flight = undefined;
      if (mobilePose !== destination) schedule();
    } else {
      mobileCrop(progress);
      schedule();
    }
  };

  // The hero releases when its bottom reaches the scene pinned below the header.
  const scrollEnd = () => Math.max(1, window.scrollY + hero.getBoundingClientRect().bottom
    - sticky.getBoundingClientRect().height - headerHeight);
  const sync = (now) => {
    scheduled = false;
    if (desktop.matches) {
      const fraction = Math.min(1, Math.max(0, window.scrollY / scrollEnd()));
      target = fraction === 0 ? poses[0] : heldFrame(
        Math.max(openingHoldEnd + 1, Math.round(openingHoldEnd + (lastFrame - openingHoldEnd) * fraction))
      );
    } else if (mobileMotion) {
      advanceMobile(now);
    }
    render();
    load();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  };

  const measureHeader = () => {
    headerHeight = header.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--home-header-height', `${headerHeight}px`);
    schedule();
  };

  const selectPose = (index) => {
    if (mobileMotion) {
      destination = index;
      if (flight && flight.start === undefined && destination === mobilePose) flight = undefined;
      schedule();
      return;
    }

    const frame = poses[index];
    target = frame;
    if (desktop.matches) {
      const fraction = frame === poses[0] ? 0 : (frame - openingHoldEnd) / (lastFrame - openingHoldEnd);
      window.scrollTo({ top: scrollEnd() * fraction, behavior: 'instant' });
    }
    schedule();
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => selectPose(index));
  });

  let swipeStart;
  stage.addEventListener('pointerdown', (event) => {
    swipeStart = undefined;
    if (!mobile.matches || !event.isPrimary || event.button !== 0) return;
    swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointerup', (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.id) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = undefined;
    if (!mobile.matches || Math.abs(dx) < 42 || Math.abs(dx) < 1.35 * Math.abs(dy)) return;
    const next = (mobileMotion ? destination : active) + (dx < 0 ? 1 : -1);
    if (poses[next] !== undefined) selectPose(next);
  });
  stage.addEventListener('pointercancel', () => { swipeStart = undefined; });

  const setMode = () => {
    const animateMobile = mobile.matches && !reducedMotion.matches;
    if (animateMobile !== mobileMotion) {
      if (mobileMotion) clearMobileCrop();
      mobilePose = animateMobile ? Math.max(0, active) : destination;
      destination = mobilePose;
      target = poses[mobilePose];
      mobileMotion = animateMobile;
      flight = undefined;
    }
    hero.classList.toggle('has-scroll', desktop.matches);
    schedule();
  };

  hero.classList.add('is-interactive');
  controls.hidden = false;
  desktop.addEventListener('change', setMode);
  mobile.addEventListener('change', setMode);
  reducedMotion.addEventListener('change', setMode);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  measureHeader();
  new ResizeObserver(measureHeader).observe(header);
  setMode();
})();
