(() => {
  const baseMeta = document.querySelector('meta[name="gpz-preview-base"]');
  if (!baseMeta) return;

  const rawBase = baseMeta.content || '/';
  const base = `/${rawBase.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
  const storageKey = `gpz63-pages-preview-cart:${base}`;
  const maxQuantity = 1_000_000;
  const idPattern = /^[0-9]{1,16}$/;
  const quantityPattern = /^[0-9]{1,7}$/;

  const readCart = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter(([id, amount]) => (
        idPattern.test(id) && Number.isInteger(amount) && amount > 0 && amount <= maxQuantity
      )));
    } catch {
      return {};
    }
  };
  let cart = readCart();
  let productsById = new Map();

  const writeCart = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
      return true;
    } catch {
      return false;
    }
  };
  const lineCount = () => Object.keys(cart).length;
  const updateBadges = () => {
    const count = String(lineCount());
    for (const link of document.querySelectorAll('.cart-link')) {
      const badge = link.querySelector('.cart-count');
      if (badge) badge.textContent = count;
      link.setAttribute('aria-label', `Корзина, позиций: ${count}`);
    }
  };
  const validQuantity = (value) => {
    if (!quantityPattern.test(value)) return null;
    const amount = Number(value);
    return amount >= 1 && amount <= maxQuantity ? amount : null;
  };
  const formDetails = (form) => {
    const id = form.elements.namedItem('product_id')?.value || '';
    const action = form.elements.namedItem('action')?.value || '';
    const actionUrl = new URL(form.getAttribute('action') || '', location.href);
    const expectedPath = `${base}cart/items/`;
    if (!idPattern.test(id) || !['add', 'set', 'remove', 'set_catalogue_quantity'].includes(action)) return null;
    if (actionUrl.origin !== location.origin || actionUrl.pathname !== expectedPath) return null;
    return { id, action };
  };
  const formStatus = (form) => {
    let status = form.querySelector('[data-cart-status]');
    if (!status) {
      status = document.createElement('p');
      status.className = 'card-cart-status';
      status.setAttribute('role', 'status');
      status.dataset.cartStatus = '';
      form.append(status);
    }
    return status;
  };
  const showFormStatus = (form, message, error = false) => {
    const status = formStatus(form);
    status.toggleAttribute('data-error', error);
    status.classList.toggle('sr-only', !error && form.matches('[data-card-cart]'));
    status.textContent = message;
  };
  const reflectForm = (form) => {
    const details = formDetails(form);
    if (!details || !form.matches('[data-card-cart]')) return;
    const quantity = form.elements.namedItem('quantity');
    const saved = cart[details.id] || 0;
    if (quantity && document.activeElement !== quantity) quantity.value = saved ? String(saved) : '';
    form.toggleAttribute('data-in-cart', saved > 0 && quantity?.valueAsNumber === saved);
    const steps = form.querySelectorAll('[data-quantity-step]');
    steps.forEach((step) => { step.hidden = false; });
    if (saved) showFormStatus(form, `В корзине: ${saved} шт.`);
  };
  const syncForms = (scope = document) => {
    if (scope instanceof Element && scope.matches('[data-card-cart]')) reflectForm(scope);
    for (const form of scope.querySelectorAll?.('[data-card-cart]') || []) reflectForm(form);
  };

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches('[data-preview-request]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      let status = form.querySelector('[data-preview-status]');
      if (!status) {
        status = document.createElement('p');
        status.className = 'field-hint';
        status.dataset.previewStatus = '';
        status.setAttribute('role', 'status');
        form.append(status);
      }
      status.textContent = 'Это демонстрация: заявка не отправлена и введённые данные не сохраняются.';
      return;
    }
    const details = formDetails(form);
    if (!details) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const field = form.elements.namedItem('quantity');
    const catalogueAction = details.action === 'set_catalogue_quantity';
    const entered = field?.value || '';
    let amount = validQuantity(entered);
    if (details.action === 'remove' || (catalogueAction && entered === '0')) amount = 0;
    if (catalogueAction && entered === '') amount = 1;
    if (details.action !== 'remove' && amount === null) {
      showFormStatus(form, 'Введите целое количество от 1 до 1 000 000.', true);
      field?.focus();
      return;
    }

    const prior = cart[details.id] || 0;
    const next = details.action === 'remove' || (catalogueAction && entered === '0') ? 0
      : details.action === 'add' ? prior + amount : amount;
    if (next > maxQuantity) {
      showFormStatus(form, 'В корзине не может быть больше 1 000 000 шт.', true);
      return;
    }
    if (next) cart[details.id] = next;
    else delete cart[details.id];
    if (!writeCart()) {
      if (prior) cart[details.id] = prior;
      else delete cart[details.id];
      showFormStatus(form, 'Не удалось сохранить корзину в этом браузере.', true);
      return;
    }
    updateBadges();
    syncForms();
    showFormStatus(form, next ? `В корзине: ${next} шт.` : 'Позиция удалена из корзины.');
    if (isCartPage()) renderCart();
  }, true);

  document.addEventListener('click', (event) => {
    const step = event.target.closest?.('[data-quantity-step]');
    if (!step) return;
    const form = step.closest('form[data-card-cart]');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const field = form.elements.namedItem('quantity');
    if (!field) return;
    const current = Number(field.value) || 0;
    const saved = cart[form.elements.namedItem('product_id')?.value] || 0;
    const next = step.dataset.quantityStep === '1' ? Math.min(maxQuantity, current + 1) : Math.max(0, current - 1);
    field.value = next ? String(next) : '';
    form.toggleAttribute('data-in-cart', saved > 0 && next === saved);
    showFormStatus(form, saved ? `В корзине: ${saved} шт.` : '');
  }, true);
  document.addEventListener('input', (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || field.name !== 'quantity') return;
    const form = field.closest('form[data-card-cart]');
    if (!form) return;
    const id = form.elements.namedItem('product_id')?.value || '';
    const saved = cart[id] || 0;
    form.toggleAttribute('data-in-cart', saved > 0 && field.valueAsNumber === saved);
    showFormStatus(form, saved ? `В корзине: ${saved} шт.` : '');
  });

  document.addEventListener('gpz-preview-cards', (event) => {
    const scope = event.detail?.element || event.detail?.container || document;
    syncForms(scope);
  });

  const isCartPage = () => location.pathname === `${base}cart/` || location.pathname === `${base}cart`;
  const catalogueUrl = () => `${base}collection/all/`;
  const safeProductUrl = (path) => {
    const clean = String(path || '').replace(/^\/+/, '');
    const segments = clean.replace(/\/+$/, '').split('/');
    if (!clean || segments.some((part) => !part || part === '.' || part === '..') || /[\\?#]/.test(clean)) {
      return catalogueUrl();
    }
    return `${base}${segments.join('/')}/`;
  };
  const money = (kopecks) => {
    if (!Number.isSafeInteger(kopecks) || kopecks < 0) return '';
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 })
      .format(kopecks / 100);
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const renderCart = () => {
    const empty = document.querySelector('.empty-state');
    if (!empty) return;
    if (!lineCount()) {
      document.querySelector('[data-preview-cart-layout]')?.remove();
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    let layout = document.querySelector('[data-preview-cart-layout]');
    if (!layout) {
      layout = element('div', 'cart-layout');
      layout.dataset.previewCartLayout = '';
      empty.after(layout);
    }
    layout.replaceChildren();
    const list = element('ul', 'cart-lines');
    list.setAttribute('role', 'list');
    const summary = element('aside', 'summary-box');
    summary.append(element('h2', '', 'Корзина в демонстрации'));
    const status = element('p', '', 'Корзина хранится только в localStorage этого браузера. Заявка не отправляется.');
    status.setAttribute('role', 'status');
    summary.append(status);
    const continueLink = element('a', 'back-link', 'Продолжить подбор');
    continueLink.href = catalogueUrl();
    const requestLink = element('a', 'button', 'Открыть демонстрационную форму');
    requestLink.href = `${base}request/`;
    const note = element('p', '', 'Форма доступна только для просмотра: введённые данные не сохраняются и не отправляются.');
    summary.append(note, continueLink, requestLink);

    for (const [id, quantity] of Object.entries(cart)) {
      const product = productsById.get(id);
      if (!product) continue;
      const row = element('li', 'cart-row');
      const info = element('div');
      const title = element('h2');
      const link = element('a', '', product.title || 'Позиция каталога');
      link.href = safeProductUrl(product.path);
      title.append(link);
      info.append(title);
      if (product.sku) info.append(element('p', 'item-meta', `Артикул: ${product.sku}`));
      const unitPrice = money(product.price_kopecks);
      if (unitPrice) info.append(element('p', 'product-price', `Цена: ${unitPrice}`));

      const controls = element('div', 'cart-controls');
      const form = element('form', 'quantity-form');
      form.method = 'post';
      form.action = `${base}cart/items/`;
      for (const [name, value] of [['product_id', id], ['action', 'set']]) {
        const hidden = element('input');
        hidden.type = 'hidden';
        hidden.name = name;
        hidden.value = value;
        form.append(hidden);
      }
      const fieldLabel = element('label', 'field');
      const inputId = `preview-cart-quantity-${id}`;
      const label = element('span', '', 'Количество, шт.');
      label.htmlFor = inputId;
      const input = element('input');
      input.id = inputId;
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.max = String(maxQuantity);
      input.step = '1';
      input.name = 'quantity';
      input.value = String(quantity);
      input.setAttribute('aria-label', `Количество: ${product.title || 'позиция'}`);
      fieldLabel.append(label, input);
      const save = element('button', 'button button--secondary', 'Обновить');
      save.type = 'submit';
      form.append(fieldLabel, save);
      const removeForm = element('form');
      removeForm.method = 'post';
      removeForm.action = `${base}cart/items/`;
      for (const [name, value] of [['product_id', id], ['action', 'remove'], ['quantity', String(quantity)]]) {
        const hidden = element('input');
        hidden.type = 'hidden';
        hidden.name = name;
        hidden.value = value;
        removeForm.append(hidden);
      }
      const remove = element('button', 'text-button', 'Убрать');
      remove.type = 'submit';
      removeForm.append(remove);
      controls.append(form, removeForm);
      row.append(info, controls);
      list.append(row);
    }
    layout.append(list, summary);
    empty.hidden = true;
  };

  const loadCatalogue = async () => {
    if (!isCartPage() || !lineCount()) return;
    try {
      const response = await fetch(`${base}data/catalogue.json`, { credentials: 'omit' });
      if (!response.ok) throw new Error('Catalogue unavailable');
      const data = await response.json();
      productsById = new Map((Array.isArray(data.products) ? data.products : [])
        .filter((product) => product && idPattern.test(String(product.id)))
        .map((product) => [String(product.id), product]));
      renderCart();
      for (const id of Object.keys(cart)) {
        if (!productsById.has(id)) delete cart[id];
      }
      writeCart();
      updateBadges();
      if (!lineCount()) renderCart();
    } catch {
      const empty = document.querySelector('.empty-state');
      if (!empty) return;
      empty.hidden = false;
      const note = element('p', '', 'Не удалось загрузить каталог для отображения корзины. Обновите страницу позже.');
      note.setAttribute('role', 'status');
      empty.append(note);
    }
  };

  const back = document.querySelector('.product-back');
  const backValue = new URLSearchParams(location.search).get('back');
  if (back && backValue) {
    try {
      const target = new URL(backValue, location.origin);
      if (target.origin === location.origin
          && (target.pathname.startsWith(`${base}collection/`) || target.pathname === `${base}search/`)) {
        back.href = target.pathname + target.search + target.hash;
      }
    } catch {
      // Keep the catalogue link when the URL is malformed.
    }
  }

  syncForms();
  updateBadges();
  if (isCartPage()) loadCatalogue();
})();
