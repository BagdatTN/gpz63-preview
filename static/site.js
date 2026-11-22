(() => {
  const choices = Array.from(document.querySelectorAll('[data-choice]'), (choice) => ({
    choice,
    entry: choice.closest('.brand-entry') || choice,
  }));
  const normalized = (text) => text.normalize('NFKC').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  for (const { choice, entry } of choices) {
    const summary = choice.querySelector('summary');
    const rows = Array.from(choice.querySelectorAll('[data-choice-option]'));
    const inputs = rows.map((row) => row.querySelector('input'));
    const productTypes = inputs.some((input) => input.name === 'product_type');
    const message = choice.querySelector('[data-choice-message]');
    const value = choice.querySelector('[data-choice-value]');
    const brandControl = entry.querySelector('[data-brand-control]');
    const search = brandControl?.querySelector('[data-brand-search]');
    const toggle = brandControl?.querySelector('[data-brand-toggle]');
    const counts = [choice.querySelector('[data-choice-count]'), brandControl?.querySelector('[data-brand-count]')].filter(Boolean);
    const list = choice.querySelector('.choice-options');
    const brandNames = search ? rows.map((row) => normalized(row.dataset.label)) : [];
    const update = () => {
      const names = rows.filter((_, index) => inputs[index].checked).map((row) => row.dataset.label);
      const limitReached = !productTypes && names.length >= 10;
      for (const count of counts) {
        count.textContent = String(names.length);
        count.hidden = !names.length;
      }
      const label = names.join(', ') || choice.dataset.empty;
      value.textContent = label;
      if (search) search.placeholder = label;
      for (const input of inputs) input.disabled = !input.checked && limitReached;
      const hasMatches = rows.some((row) => !row.hidden);
      message.textContent = limitReached ? 'Выбрано 10: снимите выбор, чтобы добавить другое значение.'
        : !hasMatches ? 'Нет подходящих вариантов' : '';
    };
    const filterBrands = () => {
      const term = normalized(search.value);
      rows.forEach((row, index) => { row.hidden = !brandNames[index].includes(term); });
      list.scrollTop = 0;
      update();
    };
    if (brandControl) {
      const openBrands = () => { choice.open = true; };
      search.addEventListener('focus', openBrands);
      search.addEventListener('click', openBrands);
      search.addEventListener('input', () => {
        openBrands();
        filterBrands();
      });
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const wasOpen = choice.open;
        openBrands();
        const matches = inputs.filter((input, index) => !rows[index].hidden && !input.disabled);
        if (event.key === 'Enter' && wasOpen && matches.length === 1) matches[0].click();
        else if (event.key === 'ArrowDown') matches[0]?.focus();
      });
      toggle.addEventListener('click', () => {
        if (choice.open) choice.open = false;
        else {
          openBrands();
          search.focus({ preventScroll: true });
        }
      });
      summary.hidden = true;
      brandControl.hidden = false;
    }
    choice.addEventListener('change', update);
    choice.addEventListener('toggle', () => {
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(choice.open));
        if (!choice.open && search.value) {
          search.value = '';
          filterBrands();
        }
      }
      if (!choice.open) return;
      for (const { choice: other } of choices) if (other !== choice) other.open = false;
    });
    entry.addEventListener('keydown', (event) => {
      if (!choice.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        (search || summary).focus({ preventScroll: true });
        choice.open = false;
      } else if (event.key === 'Tab') {
        requestAnimationFrame(() => {
          if (!entry.contains(document.activeElement)) choice.open = false;
        });
      }
    });
    window.addEventListener('pageshow', update);
    update();
  }
  if (choices.length) {
    const closeOtherChoices = (event) => {
      for (const { choice, entry } of choices) {
        if (choice.open && !entry.contains(event.target)) choice.open = false;
      }
    };
    document.addEventListener('pointerdown', closeOtherChoices);
  }

  const restrictInsertions = (field, unsupportedCharacters) => {
    field.addEventListener('beforeinput', (event) => {
      const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
      if (unsupportedCharacters.test(text)) event.preventDefault();
    });
    field.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (unsupportedCharacters.test(text)) event.preventDefault();
    });
  };
  const nonDigits = /[^0-9]/;
  for (const field of document.querySelectorAll('input[type="number"][name="quantity"]')) {
    let previousValue = field.value;
    field.addEventListener('beforeinput', () => { previousValue = field.value; });
    restrictInsertions(field, nonDigits);
    field.addEventListener('input', () => {
      if (field.validity.badInput || nonDigits.test(field.value)) field.value = previousValue;
      else previousValue = field.value;
    });
  }

  let cartQueue = Promise.resolve();
  for (const form of document.querySelectorAll('[data-card-cart]')) {
    const quantity = form.elements.namedItem('quantity');
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector('[data-cart-status]');
    let savedQuantity = Number(quantity.defaultValue);
    const reflectQuantity = () => {
      form.toggleAttribute('data-in-cart', savedQuantity > 0 && quantity.valueAsNumber === savedQuantity);
    };
    const report = (message = '', error = false) => {
      status.toggleAttribute('data-error', error);
      status.classList.toggle('sr-only', !error);
      status.textContent = message;
    };
    quantity.addEventListener('input', () => {
      reflectQuantity();
      report();
    });
    for (const step of form.querySelectorAll('[data-quantity-step]')) {
      step.hidden = false;
      step.addEventListener('click', () => {
        if (step.dataset.quantityStep === '1') quantity.stepUp();
        else if (quantity.value) quantity.stepDown();
        reflectQuantity();
        report();
      });
    }
    reflectQuantity();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.hasAttribute('aria-disabled')) return;
      const enteredQuantity = quantity.value;
      const fields = new URLSearchParams(new FormData(form));
      fields.set('quantity', enteredQuantity ? String(quantity.valueAsNumber) : '1');
      submit.setAttribute('aria-disabled', 'true');
      report();

      cartQueue = cartQueue.then(async () => {
        try {
          const response = await fetch(form.getAttribute('action'), {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: fields,
          });
          const result = await response.json();
          if (!response.ok) {
            report(result.message, true);
            return;
          }
          for (const link of document.querySelectorAll('.cart-link')) {
            link.querySelector('.cart-count').textContent = result.cart_count;
            link.setAttribute('aria-label', `Корзина, позиций: ${result.cart_count}`);
          }
          savedQuantity = result.quantity;
          if (quantity.value === enteredQuantity) quantity.value = savedQuantity || '';
          reflectQuantity();
          report(savedQuantity ? `В корзине: ${savedQuantity} шт.` : 'Позиция удалена из корзины.');
        } catch {
          report('Не удалось подтвердить изменение. Проверьте корзину.', true);
        } finally {
          submit.removeAttribute('aria-disabled');
        }
      });
    });
  }

  const filterForm = document.querySelector('[data-filter-form]');
  const dimensionFields = Array.from(filterForm?.querySelectorAll('.filter-dimensions input') || []);
  if (dimensionFields.length) {
    const dimensionError = filterForm.querySelector('#dimension-error');
    const unsupportedCharacters = /[^0-9.,]/;
    const validDimension = (value) => {
      if (!value.trim()) return true;
      const parts = value.split('|').map((part) => part.trim()).filter(Boolean);
      return parts.length > 0 && parts.every((part) => (
        /^[0-9]{1,6}(?:[.,][0-9]{1,6})?$/.test(part) && Number(part.replace(',', '.')) > 0
      ));
    };
    const markDimension = (field, invalid) => {
      if (invalid) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', dimensionError.id);
      } else {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
      }
    };
    const firstInvalidDimension = () => dimensionFields.find((field) => field.hasAttribute('aria-invalid'));

    filterForm.addEventListener('submit', (event) => {
      for (const field of dimensionFields) {
        const valid = validDimension(field.value);
        markDimension(field, !valid);
        if (valid) field.value = field.value.replaceAll('.', ',');
      }
      const invalidField = firstInvalidDimension();
      dimensionError.hidden = !invalidField;
      if (!invalidField) return;
      event.preventDefault();
      invalidField.focus();
    });
    for (const field of dimensionFields) {
      restrictInsertions(field, unsupportedCharacters);
      field.addEventListener('input', () => {
        if (field.hasAttribute('aria-invalid') && validDimension(field.value)) {
          markDimension(field, false);
          dimensionError.hidden = !firstInvalidDimension();
        }
      });
    }
  }

  const navigation = performance.getEntriesByType('navigation')[0];
  if ((location.hash === '#catalog-title' || location.hash === '#results-title') && navigation?.type === 'navigate') {
    const invalidDimension = dimensionFields.find((field) => field.hasAttribute('aria-invalid'));
    if (invalidDimension) invalidDimension.focus();
    else document.getElementById(location.hash.slice(1))?.focus({ preventScroll: location.hash === '#catalog-title' });
  }
  document.querySelector('[data-errors]')?.focus();
})();
