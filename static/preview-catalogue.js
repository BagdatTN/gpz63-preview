(() => {
  const body = document.body;
  const collection = body?.dataset.previewCollection || '';
  const baseMeta = document.querySelector('meta[name="gpz-preview-base"]');
  const base = (baseMeta?.content || '/').replace(/\/?$/, '/');
  const params = new URLSearchParams(location.search);
  const searchRoute = !collection;
  const pageSize = 24;
  const shardCache = new Map();
  const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/\s+/g, ' ');
  const compact = (value) => normalize(value).replace(/[^\p{L}\p{N}]/gu, '');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const split = (value) => String(value ?? '').split('|').map((part) => part.trim()).filter(Boolean);
  const selectedFromParams = (key) => [...new Set(params.getAll(key).flatMap(split))];
  const filters = {
    q: params.get('q') || '',
    brand: selectedFromParams('brand'),
    family: selectedFromParams('family'),
    product_type: selectedFromParams('product_type'),
    application: selectedFromParams('application'),
    d: selectedFromParams('d'), D: selectedFromParams('D'), B: selectedFromParams('B'),
    sort: params.get('sort') || 'relevance',
  };
  const requestedPage = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const root = document.querySelector('.catalog-results');
  const grid = root?.querySelector('.product-grid');
  const count = root?.querySelector('#results-count');
  let pagination = root?.querySelector('.pagination');
  const activeFilters = document.querySelector('.active-filters');
  const searchInput = document.querySelector('#catalog-search');
  const filterForm = document.querySelector('[data-filter-form]');
  const sortForm = document.querySelector('.catalog-sort');
  const searchForm = document.querySelector('.catalog-search-row .search-form');
  let status = root?.querySelector('.status');
  if (!root || !grid || !count || !activeFilters) return;
  if (!status) {
    status = document.createElement('p');
    status.className = 'status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    root.insertBefore(status, root.querySelector('.results-head'));
  }

  const inputValues = (name) => [...(filterForm?.querySelectorAll(`input[name="${name}"]`) || [])];
  const reflectControls = () => {
    if (searchInput) searchInput.value = filters.q;
    for (const name of ['brand', 'product_type', 'application']) {
      const chosen = new Set(filters[name]);
      const inputs = inputValues(name);
      for (const input of inputs) input.checked = chosen.has(input.value);
      inputs[0]?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const familyScope = filterForm?.querySelector('input[type="hidden"][name="family"]');
    if (familyScope) familyScope.value = filters.family.join('|');
    for (const name of ['d', 'D', 'B']) {
      const field = filterForm?.querySelector(`input[name="${name}"]`);
      if (field) field.value = filters[name].join('|');
    }
    const hiddenSort = filterForm?.querySelector('input[name="sort"]');
    if (hiddenSort) hiddenSort.value = filters.sort;
    const sort = sortForm?.querySelector('select[name="sort"]');
    if (sort) sort.value = filters.sort;
  };

  const writeUrl = (page = 1, replace = false) => {
    const next = new URLSearchParams();
    if (filters.q) next.set('q', filters.q);
    for (const name of ['brand', 'family', 'product_type', 'application', 'd', 'D', 'B']) {
      if (filters[name].length) next.set(name, filters[name].join('|'));
    }
    if (filters.sort !== 'relevance') next.set('sort', filters.sort);
    if (page > 1) next.set('page', String(page));
    const route = searchRoute ? `${base}search/` : `${base}collection/${encodeURIComponent(collection)}/`;
    const url = `${route}${next.size ? `?${next}` : ''}`;
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
  };

  const valuesFor = (product, facet) => {
    if (facet === 'application') return Array.isArray(product.applications) ? product.applications : [];
    if (facet === 'brand') return product.brand_slug ? [product.brand_slug] : [];
    if (facet === 'family') return product.family_slug ? [product.family_slug] : [];
    if (facet === 'product_type') return product.product_type ? [product.product_type] : [];
    return [];
  };
  const epkBrands = new Set();
  const matchesFacet = (product, facet, chosen) => {
    if (!chosen.length) return true;
    const productValues = valuesFor(product, facet);
    return chosen.some((value) => value === 'epk-all'
      ? productValues.some((candidate) => epkBrands.has(candidate))
      : productValues.includes(value));
  };
  const dimensionNumber = (value) => {
    if (!/^[0-9]{1,6}(?:[.,][0-9]{1,6})?$/.test(value)) return NaN;
    const number = Number(value.replace(',', '.'));
    return Number.isFinite(number) && number > 0 ? number : NaN;
  };
  const matchesDimensions = (product, name, chosen) => !chosen.length || chosen.some((value) => {
    const wanted = dimensionNumber(value);
    const actual = Number(product[{ d: 'bore', D: 'outer_diameter', B: 'width' }[name]]);
    return Number.isFinite(wanted) && Number.isFinite(actual) && wanted === actual;
  });
  const matchesText = (product, query) => {
    if (!query) return true;
    const terms = normalize(query).split(' ').slice(0, 12);
    const corpus = normalize(`${product.marking || ''} ${product.title || ''} ${product.brand || ''} ${product.sku || ''}`);
    const allTerms = terms.every((term) => corpus.includes(term));
    const packed = compact(query);
    return allTerms || (packed.length >= 2 && (compact(product.marking).includes(packed) || compact(product.sku) === packed));
  };
  const filterProducts = (products, exclude = '') => products.filter((product) => {
    if (collection && collection !== 'all' && !(product.collections || []).includes(collection)) return false;
    if (!matchesText(product, filters.q)) return false;
    for (const facet of ['brand', 'family', 'product_type', 'application']) {
      if (facet !== exclude && !matchesFacet(product, facet, filters[facet])) return false;
    }
    for (const axis of ['d', 'D', 'B']) if (!matchesDimensions(product, axis, filters[axis])) return false;
    return true;
  });
  const searchRank = (product) => {
    const query = compact(filters.q);
    if (!query) return 0;
    const sku = compact(product.sku);
    const marking = compact(product.marking);
    if (sku && sku === query) return 0;
    if (marking && marking === query) return 1;
    if (marking.includes(query)) return 2;
    if (sku.includes(query)) return 3;
    return 4;
  };
  const sortProducts = (products) => {
    const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
    return products.sort((a, b) => {
      if (filters.sort === 'name') return collator.compare(a.title || '', b.title || '') || Number(a.id) - Number(b.id);
      if (filters.sort === 'price-asc' || filters.sort === 'price-desc') {
        const direction = filters.sort === 'price-asc' ? 1 : -1;
        const aMissing = a.price_kopecks == null;
        const bMissing = b.price_kopecks == null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        return (Number(a.price_kopecks) - Number(b.price_kopecks)) * direction || Number(a.id) - Number(b.id);
      }
      if (filters.q) return searchRank(a) - searchRank(b) || Number(a.id) - Number(b.id);
      if (collection === 'all') {
        const aBearing = normalize(a.title).startsWith('подшипник ') || a.family_slug === 'podshipnikovye-uzly';
        const bBearing = normalize(b.title).startsWith('подшипник ') || b.family_slug === 'podshipnikovye-uzly';
        if (aBearing !== bBearing) return aBearing ? -1 : 1;
      }
      return Number(a.id) - Number(b.id);
    });
  };
  const labels = new Map();
  const shellFacetLabels = () => {
    for (const row of document.querySelectorAll('[data-choice-option]')) {
      const input = row.querySelector('input');
      if (input) labels.set(input.value, row.dataset.label || row.textContent.trim());
    }
  };
  shellFacetLabels();
  let productTypeLabels = {};
  const refreshProductTypeOptions = () => {
    const options = [...document.querySelectorAll('.choice-options label[data-choice-option]')]
      .filter((row) => row.querySelector('input[name="product_type"]'));
    if (!options.length) return;
    const totals = new Map();
    for (const product of filterProducts(products, 'product_type')) {
      if (product.product_type) totals.set(product.product_type, (totals.get(product.product_type) || 0) + 1);
    }
    const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
    for (const row of options) {
      const input = row.querySelector('input[name="product_type"]');
      const label = productTypeLabels[input.value] || row.dataset.label || input.value;
      row.dataset.label = label;
      let value = row.querySelector('span');
      if (!value) {
        value = document.createElement('span');
        input.insertAdjacentElement('afterend', value);
      }
      value.textContent = label;
      row.hidden = !totals.get(input.value) && !filters.product_type.includes(input.value);
    }
    options.sort((a, b) => {
      const aInput = a.querySelector('input[name="product_type"]');
      const bInput = b.querySelector('input[name="product_type"]');
      const unclassifiedOrder = Number(aInput.value === 'unclassified') - Number(bInput.value === 'unclassified');
      const difference = (totals.get(bInput.value) || 0) - (totals.get(aInput.value) || 0);
      return unclassifiedOrder || difference || collator.compare(a.dataset.label || '', b.dataset.label || '');
    });
    const list = options[0].parentElement;
    for (const row of options) list.append(row);
    list.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const renderChips = () => {
    const chips = [];
    if (filters.q) chips.push({ key: 'q', value: filters.q, text: `Запрос: ${filters.q}`, group: 'q' });
    for (const name of ['brand', 'family', 'product_type', 'application', 'd', 'D', 'B']) {
      const prefix = ({ brand: 'Производитель', family: 'Тип изделия', product_type: 'Группа', application: 'Применение' })[name];
      for (const value of filters[name]) {
        const text = name === 'product_type' ? (productTypeLabels[value] || labels.get(value) || value)
          : prefix ? (labels.get(value) || value) : `${name}: ${value}`;
        chips.push({ key: name, value, text, group: name });
      }
    }
    if (filters.sort !== 'relevance') chips.push({ key: 'sort', value: filters.sort, text: `Сортировка: ${{ name: 'По названию', 'price-asc': 'Сначала дешевле', 'price-desc': 'Сначала дороже' }[filters.sort] || filters.sort}`, group: 'sort' });
    const rows = chips.map((chip, index) => `<li class="filter-chip">${escapeHtml(chip.text)} <a href="#" data-remove-filter="${escapeHtml(chip.key)}" data-remove-value="${escapeHtml(chip.value)}" aria-label="Убрать фильтр ${escapeHtml(chip.text)}">×</a></li>`);
    if (chips.length) rows.push('<li><a class="button button--secondary reset-applied" href="#" data-reset-filters>Сбросить</a></li>');
    activeFilters.innerHTML = rows.length ? `<ul class="filter-chips" aria-label="Управление применёнными фильтрами">${rows.join('')}</ul>` : '';
  };
  const renderPagination = (page, pages) => {
    if (pages < 2) {
      pagination?.remove();
      pagination = null;
      return;
    }
    const shown = pages <= 7 ? Array.from({ length: pages }, (_, index) => index + 1)
      : page <= 4 ? [1, 2, 3, 4, 5, null, pages]
        : page >= pages - 3 ? [1, null, pages - 4, pages - 3, pages - 2, pages - 1, pages]
          : [1, null, page - 1, page, page + 1, null, pages];
    const link = (target, label, aria = '') => `<a href="${escapeHtml(makePageUrl(target))}" data-page="${target}"${aria ? ` aria-label="${aria}"` : ''}>${label}</a>`;
    const items = [page > 1 ? link(page - 1, '‹', 'Предыдущая страница') : '<span aria-disabled="true" aria-hidden="true">‹</span>'];
    for (const number of shown) items.push(number === null ? '<span>…</span>' : number === page
      ? `<span aria-current="page">${number}</span>` : link(number, number, `Страница ${number}`));
    items.push(page < pages ? link(page + 1, '›', 'Следующая страница') : '<span aria-disabled="true" aria-hidden="true">›</span>');
    const nav = pagination || document.createElement('nav');
    nav.className = 'pagination'; nav.setAttribute('aria-label', 'Страницы каталога'); nav.innerHTML = items.join('');
    if (!pagination) { root.append(nav); pagination = nav; }
  };
  const makePageUrl = (page) => {
    const current = new URL(location.href);
    const next = new URLSearchParams(current.search);
    if (page > 1) next.set('page', String(page)); else next.delete('page');
    const path = searchRoute ? `${base}search/` : `${base}collection/${encodeURIComponent(collection)}/`;
    return `${path}${next.size ? `?${next}` : ''}`;
  };
  const moneyCount = (number) => new Intl.NumberFormat('ru-RU').format(number);
  const fetchShard = (key) => {
    if (!shardCache.has(key)) {
      const safeKey = encodeURIComponent(String(key));
      shardCache.set(key, fetch(`${base}data/cards/${safeKey}.json`, { headers: { Accept: 'application/json' } }).then((response) => {
        if (!response.ok) throw new Error(`Карточки не загрузились (${response.status})`);
        return response.json();
      }));
    }
    return shardCache.get(key);
  };
  const setStatus = (message) => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  };

  let products = [];
  let dataReady = false;
  let renderToken = 0;
  const render = async (page = 1) => {
    const token = ++renderToken;
    const matches = sortProducts(filterProducts(products));
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    const currentPage = Math.min(page, pages);
    const visible = matches.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    count.textContent = `Найдено: ${moneyCount(matches.length)}`;
    renderChips();
    reflectControls();
    refreshProductTypeOptions();
    renderPagination(currentPage, pages);
    setStatus('');
    if (!visible.length) {
      const requestUrl = document.querySelector('.catalog-specification')?.getAttribute('href') || `${base}request/`;
      grid.innerHTML = `<li class="empty-state"><h2>Ничего не найдено</h2><p>Проверьте маркировку или уберите часть фильтров. Если вы не нашли нужную позицию, отправьте спецификацию.</p><div class="actions"><a class="button" href="#catalog-search">Изменить запрос</a><a href="${escapeHtml(requestUrl)}">Отправить спецификацию</a></div></li>`;
      return;
    }
    try {
      const shards = await Promise.all([...new Set(visible.map((product) => product.card).filter(Boolean))].map(fetchShard));
      if (token !== renderToken) return;
      const cards = Object.assign({}, ...shards);
      const container = document.createElement('div');
      container.innerHTML = visible.map((product) => cards[String(product.id)] || '').filter(Boolean).join('');
      const listingBack = `${location.pathname}${location.search}`;
      for (const product of visible) {
        const itemId = `catalog-item-${product.id}`;
        for (const anchor of container.querySelectorAll(`#${CSS.escape(itemId)} a[href]`)) {
          try {
            const target = new URL(anchor.href, location.href);
            if (!target.searchParams.has('back')) continue;
            target.searchParams.set('back', `${listingBack}#${itemId}`);
            anchor.href = target.href;
          } catch { /* Keep the trusted exported link if it cannot be parsed. */ }
        }
      }
      grid.innerHTML = container.innerHTML;
      if (!grid.children.length) throw new Error('Разметка карточек отсутствует');
      document.dispatchEvent(new CustomEvent('gpz-preview-cards', { detail: { products: visible } }));
    } catch (error) {
      if (token !== renderToken) return;
      setStatus('Не удалось загрузить карточки. Обновите страницу или попробуйте ещё раз.');
      console.error('[gpz-preview] cards:', error);
    }
  };

  const readForm = (form) => {
    const data = new FormData(form);
    filters.q = String(data.get('q') || '').trim();
    for (const name of ['brand', 'product_type', 'application']) filters[name] = [...new Set(data.getAll(name).flatMap((value) => split(value)))];
    for (const name of ['d', 'D', 'B']) filters[name] = split(String(data.get(name) || '').replaceAll(',', '.'));
  };
  filterForm?.addEventListener('submit', (event) => {
    if (!dataReady) return;
    event.preventDefault(); readForm(filterForm); writeUrl(1); render(1);
  });
  searchForm?.addEventListener('submit', (event) => {
    if (!dataReady) return;
    event.preventDefault(); filters.q = searchInput?.value.trim() || ''; writeUrl(1); render(1);
  });
  sortForm?.addEventListener('submit', (event) => {
    if (!dataReady) return;
    event.preventDefault(); filters.sort = sortForm.querySelector('select[name="sort"]')?.value || 'relevance'; writeUrl(1); render(1);
  });
  activeFilters.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-filter]');
    if (remove) {
      event.preventDefault();
      const key = remove.dataset.removeFilter;
      if (key === 'q') filters.q = '';
      else if (key === 'sort') filters.sort = 'relevance';
      else filters[key] = filters[key].filter((value) => value !== remove.dataset.removeValue);
      writeUrl(1); render(1);
    } else if (event.target.closest('[data-reset-filters]')) {
      event.preventDefault(); filters.q = ''; filters.sort = 'relevance';
      for (const key of ['brand', 'family', 'product_type', 'application', 'd', 'D', 'B']) filters[key] = [];
      writeUrl(1); render(1);
    }
  });
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-page]');
    if (!link) return;
    event.preventDefault();
    const page = Number(link.dataset.page) || 1;
    writeUrl(page); render(page);
    document.getElementById('results-title')?.scrollIntoView({ block: 'start' });
  });
  window.addEventListener('popstate', () => {
    location.reload();
  });

  reflectControls();
  fetch(`${base}data/catalogue.json`, { headers: { Accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error(`Каталог не загрузился (${response.status})`);
      return response.json();
    })
    .then((data) => {
      products = Array.isArray(data.products) ? data.products : [];
      for (const product of products) {
        if (product.family_slug && product.family) labels.set(product.family_slug, product.family);
      }
      productTypeLabels = data.product_types || {};
      for (const [slug, label] of Object.entries(productTypeLabels)) labels.set(slug, label);
      for (const slug of data.epk_brands || []) epkBrands.add(slug);
      dataReady = true;
      if (requestedPage === 1 && !location.search) {
        // Preserve the server-rendered first page and its formatted count.
        refreshProductTypeOptions();
        return;
      }
      render(requestedPage);
    })
    .catch((error) => {
      setStatus('Не удалось загрузить каталог. Уже показанные позиции доступны, обновите страницу позже.');
      console.error('[gpz-preview] catalogue:', error);
    });
})();
