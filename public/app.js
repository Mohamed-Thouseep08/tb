const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  locale: {}, language: localStorage.getItem('saffron-language') || 'en', config: null,
  menu: [], categories: [], category: 'All', diet: 'all', query: '', cart: new Map(),
  area: 'AC', tables: { AC: [], 'Non-AC': [] }, selectedTable: null,
  reservation: null, coupon: null, bill: null, paymentMode: 'UPI', rating: 0
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function t(key) {
  return key.split('.').reduce((value, part) => value?.[part], state.locale) || key;
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function money(value) {
  return new Intl.NumberFormat(state.language === 'en' ? 'en-IN' : state.language === 'ta' ? 'ta-IN' : 'hi-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || t('errorGeneric'));
  return payload;
}

function toast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `toast${isError ? ' error' : ''}`;
  node.textContent = message;
  $('#toast-region').append(node);
  window.setTimeout(() => node.remove(), 3900);
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Loading…</span>';
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  } else if (label) button.innerHTML = label;
}

function applyTranslations() {
  $$('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  $$('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  if (state.config) populateGuestOptions();
  document.documentElement.lang = state.language;
  $('#language').value = state.language;
  renderCategories();
  renderMenu();
  renderCart();
  if (state.selectedTable) renderTables();
  if ($('#app-dialog').open && state.dialogRenderer) state.dialogRenderer();
}

function populateGuestOptions() {
  const selected = $('#booking-guests').value || '2';
  $('#booking-guests').innerHTML = Array.from({ length: 8 }, (_item, index) => {
    const guests = index + 1;
    const label = t(guests === 1 ? 'guestSingular' : 'guestPlural');
    return `<option value="${guests}" ${String(guests) === selected ? 'selected' : ''}>${guests} ${escapeHtml(label)}</option>`;
  }).join('');
}

async function setLanguage(language) {
  if (!['en', 'ta', 'hi'].includes(language)) language = 'en';
  try {
    const response = await fetch(`/i18n/${language}.json`);
    if (!response.ok) throw new Error('Translation unavailable.');
    state.locale = await response.json();
    state.language = language;
    localStorage.setItem('saffron-language', language);
    applyTranslations();
  } catch {
    toast(t('loadFailed'), true);
  }
}

function openDialog(html, redraw = null) {
  $('#dialog-content').innerHTML = html;
  state.dialogRenderer = redraw;
  const dialog = $('#app-dialog');
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  state.dialogRenderer = null;
  $('#app-dialog').close();
}

function hallLabel(area) {
  return area === 'AC' ? t('acDining') : t('nonAcDining');
}

async function loadConfig() {
  state.config = await api('/api/config');
  $('#booking-date').min = localDate();
  $('#booking-date').value = localDate();
  $('#booking-slot').innerHTML = state.config.timeSlots.map((slot) => `<option value="${escapeHtml(slot)}">${escapeHtml(slot)}</option>`).join('');
  populateGuestOptions();
}

async function loadMenu() {
  $('#menu-grid').innerHTML = '<div class="loading-shimmer" aria-label="Loading menu"></div><div class="loading-shimmer"></div><div class="loading-shimmer"></div>';
  try {
    const result = await api('/api/menu');
    state.menu = result.items;
    state.categories = result.categories;
    renderCategories();
    renderMenu();
  } catch (error) {
    $('#menu-grid').innerHTML = `<p class="menu-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderCategories() {
  const tabs = [{ name: 'All', label: t('allDishes') }, ...state.categories.map((name) => ({ name, label: t(`categories.${name}`) }))];
  $('#category-tabs').innerHTML = tabs.map(({ name, label }) => `<button class="category-tab${state.category === name ? ' active' : ''}" type="button" role="tab" aria-selected="${state.category === name}" data-category="${escapeHtml(name)}">${escapeHtml(label)}</button>`).join('');
}

function translatedDiet() {
  if (state.diet === 'veg') return t('vegetarian');
  if (state.diet === 'nonveg') return t('nonVegetarian');
  return t('allDishes');
}

function renderMenu() {
  const visible = state.menu.filter((item) => {
    const matchesCategory = state.category === 'All' || item.category === state.category;
    const matchesDiet = state.diet === 'all' || (state.diet === 'veg' ? item.isVeg : !item.isVeg);
    const matchesSearch = `${item.name} ${t(`dishes.${item.name}`)} ${item.category} ${t(`categories.${item.category}`)}`.toLowerCase().includes(state.query.toLowerCase());
    return matchesCategory && matchesDiet && matchesSearch;
  });
  $('#diet-filter').classList.toggle('active', state.diet === 'veg');
  $('#diet-filter').setAttribute('aria-label', `${translatedDiet()} filter`);
  $('#diet-filter [data-i18n]').textContent = translatedDiet();
  if (!visible.length) {
    $('#menu-grid').innerHTML = `<p class="menu-empty">${escapeHtml(t('noDishes'))}</p>`;
    return;
  }
  $('#menu-grid').innerHTML = visible.map((item, index) => `
    <article class="menu-card" style="animation-delay:${Math.min(index * 35, 210)}ms">
      <div class="menu-card-image"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(t(`dishes.${item.name}`))}" loading="lazy"><span class="diet-marker${item.isVeg ? '' : ' nonveg'}" aria-label="${item.isVeg ? escapeHtml(t('vegetarian')) : escapeHtml(t('nonVegetarian'))}"></span></div>
      <div class="menu-card-copy"><p class="menu-card-category">${escapeHtml(t(`categories.${item.category}`))}</p><h3>${escapeHtml(t(`dishes.${item.name}`))}</h3><div class="menu-card-bottom"><span class="menu-price">${money(item.price)}</span><button class="add-item" type="button" data-add-item="${item.id}" aria-label="${escapeHtml(t('addToOrder'))}: ${escapeHtml(t(`dishes.${item.name}`))}" title="${escapeHtml(t('addToOrder'))}"><i class="fa-solid fa-plus"></i></button></div></div>
    </article>`).join('');
}

function addToCart(id) {
  const item = state.menu.find((candidate) => candidate.id === Number(id));
  if (!item) return;
  const existing = state.cart.get(item.id);
  state.cart.set(item.id, { item, quantity: Math.min((existing?.quantity || 0) + 1, 20) });
  renderCart();
  toast(t('addSuccess'));
}

function cartSubtotal() {
  return [...state.cart.values()].reduce((sum, line) => sum + line.item.price * line.quantity, 0);
}

function renderCart() {
  const lines = [...state.cart.entries()];
  const count = lines.reduce((sum, [, line]) => sum + line.quantity, 0);
  const subtotal = cartSubtotal();
  const gst = subtotal * .05;
  const service = subtotal * .05;
  const ac = state.area === 'AC' ? subtotal * ((state.config?.acSurchargePercent || 10) / 100) : 0;
  const discount = subtotal * ((state.coupon?.discountPercent || 0) / 100);
  const total = Math.max(0, subtotal + gst + service + ac - discount);
  $('#cart-count').textContent = count;
  $('#empty-cart').classList.toggle('hidden', count > 0);
  $('#cart-lines').innerHTML = lines.map(([id, line]) => `<div class="cart-line"><div><h4>${escapeHtml(t(`dishes.${line.item.name}`))}</h4><span class="cart-line-price">${money(line.item.price * line.quantity)}</span></div><div class="cart-line-actions"><button class="quantity-button" type="button" data-quantity="${id}" data-delta="-1" aria-label="Decrease quantity"><i class="fa-solid fa-minus"></i></button><span>${line.quantity}</span><button class="quantity-button" type="button" data-quantity="${id}" data-delta="1" aria-label="Increase quantity"><i class="fa-solid fa-plus"></i></button><button class="remove-line" type="button" data-remove="${id}" aria-label="${escapeHtml(t('remove'))}"><i class="fa-regular fa-trash-can"></i></button></div></div>`).join('');
  $('#cart-subtotal').textContent = money(subtotal);
  $('#cart-gst').textContent = money(gst);
  $('#cart-service').textContent = money(service);
  $('#cart-ac').textContent = money(ac);
  $('#cart-ac-row').classList.toggle('hidden', state.area !== 'AC' || subtotal <= 0);
  $('#cart-discount').textContent = `−${money(discount)}`;
  $('#cart-discount-row').classList.toggle('hidden', !state.coupon || subtotal <= 0);
  $('#cart-total').textContent = money(total);
  const splitCount = Math.max(1, Math.min(20, Number($('#split-count')?.value) || 1));
  if ($('#split-count')) $('#split-amount').innerHTML = `${money(total / splitCount)} <small data-i18n="perPerson">${escapeHtml(t('perPerson'))}</small>`;
}

function setArea(area) {
  state.area = area;
  state.selectedTable = null;
  $$('.segment').forEach((button) => {
    const active = button.dataset.area === area;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#hall-title').textContent = `${hallLabel(area)} · ${area === 'AC' ? '01' : '02'}`;
  $('#reservation-form').classList.add('hidden');
  renderTables();
  renderCart();
}

function renderTables() {
  const floorplan = $('#floorplan');
  floorplan.innerHTML = ['AC', 'Non-AC'].map((area, index) => {
    const tables = state.tables[area] || [];
    const seats = tables.length ? tables.map((table) => {
      const selected = state.selectedTable?.id === table.id;
      const booked = !table.available;
      return `<button type="button" class="table-seat${booked ? ' booked' : ''}${selected ? ' selected' : ''}" data-table-id="${table.id}" data-table-area="${escapeHtml(area)}" ${booked ? 'disabled' : ''} aria-pressed="${selected}" aria-label="${escapeHtml(table.number)}, ${table.capacity} ${escapeHtml(t('seats'))}, ${escapeHtml(booked ? t('booked') : t('available'))}"><strong>${escapeHtml(table.number)}</strong><small>${table.capacity} ${escapeHtml(t('seats'))}</small></button>`;
    }).join('') : `<p class="hall-empty">${escapeHtml(t('noTables'))}</p>`;
    return `<section class="floorplan-hall${state.area === area ? ' active-hall' : ''}" aria-label="${escapeHtml(hallLabel(area))}"><div class="hall-label"><i class="fa-solid ${area === 'AC' ? 'fa-snowflake' : 'fa-cloud-sun'}"></i> ${escapeHtml(hallLabel(area))} · ${index === 0 ? '01' : '02'}</div><div class="hall-tables">${seats}</div></section>`;
  }).join('');
}

async function refreshAvailability() {
  const date = $('#booking-date').value;
  const slot = $('#booking-slot').value;
  const guests = $('#booking-guests').value;
  const params = new URLSearchParams({ date, slot, guests });
  try {
    const [ac, nonAc] = await Promise.all([
      api(`/api/tables?${params}&area=AC`),
      api(`/api/tables?${params}&area=Non-AC`)
    ]);
    state.tables = { AC: ac, 'Non-AC': nonAc };
    if (state.selectedTable) {
      const updated = state.tables[state.selectedTable.area]?.find((table) => table.id === state.selectedTable.id);
      if (!updated?.available) {
        state.selectedTable = null;
        $('#reservation-form').classList.add('hidden');
        toast(t('tableTaken'), true);
      }
    }
    renderTables();
  } catch (error) { toast(error.message, true); }
}

async function checkAvailability(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  state.selectedTable = null;
  $('#reservation-form').classList.add('hidden');
  $('#availability-panel').classList.remove('hidden');
  setBusy($('button[type="submit"]', form), true);
  await refreshAvailability();
  setBusy($('button[type="submit"]', form), false);
  $('#availability-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submitReservation(event) {
  event.preventDefault();
  if (!state.selectedTable) return toast(t('tableRequired'), true);
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = $('button[type="submit"]', form);
  setBusy(button, true);
  try {
    const values = Object.fromEntries(new FormData(form));
    const reservation = await api('/api/reservations', {
      method: 'POST', body: JSON.stringify({ ...values, date: $('#booking-date').value, slot: $('#booking-slot').value,
        guests: Number($('#booking-guests').value), area: state.selectedTable.area, tableId: state.selectedTable.id })
    });
    state.reservation = reservation;
    $('#cart-reservation-id').value = reservation.id;
    $('#reservation-form').classList.add('hidden');
    $('#selection-summary').textContent = '';
    openBookingSlip(reservation);
    await refreshAvailability();
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
}

function qrUrl(value, size = 160) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
}

function openBookingSlip(reservation) {
  const url = `${location.origin}/?reservation=${reservation.id}`;
  openDialog(`<div class="dialog-kicker">${escapeHtml(t('bookingSuccess'))}</div><h2>${escapeHtml(reservation.name.split(' ')[0])}, ${escapeHtml(t('tableWaiting'))}</h2><p class="dialog-intro">${escapeHtml(t('slipIntro'))}</p>
    <div class="slip-brand"><span class="brand-mark"><i class="fa-solid fa-fire-flame-curved"></i></span><div><strong>SAFFRON & EMBER</strong><small>INDIAN KITCHEN · BENGALURU</small></div></div>
    <div class="slip-details"><div><span>${escapeHtml(t('reservationId'))}</span><strong>#${reservation.id}</strong></div><div><span>${escapeHtml(t('bookedFor'))}</span><strong>${escapeHtml(reservation.name)}</strong></div><div><span>${escapeHtml(t('date'))} & ${escapeHtml(t('time'))}</span><strong>${escapeHtml(reservation.date)} · ${escapeHtml(reservation.slot)}</strong></div><div><span>${escapeHtml(t('table'))}</span><strong>${escapeHtml(reservation.tableNumber)} · ${escapeHtml(hallLabel(reservation.area))}</strong></div><div><span>${escapeHtml(t('guests'))}</span><strong>${reservation.guests}</strong></div><div><span>${escapeHtml(t('status'))}</span><strong>${escapeHtml(reservation.status)}</strong></div></div>
    <div class="dialog-actions"><button class="button button-gold" type="button" data-print><i class="fa-solid fa-print"></i><span>${escapeHtml(t('downloadSlip'))}</span></button><button class="button button-dark" type="button" data-close-and-menu><span>${escapeHtml(t('continue'))}</span><i class="fa-solid fa-arrow-right"></i></button></div><p class="order-footnote"><img class="qr-image" src="${qrUrl(url, 112)}" alt="Reservation QR code"></p>`, () => openBookingSlip(reservation));
}

function renderInvoice(bill) {
  const rows = bill.items.map((item) => `<tr><td>${escapeHtml(t(`dishes.${item.name}`))}<small class="invoice-item-note"> ${item.quantity} × ${money(item.unitPrice)}</small></td><td>${money(item.quantity * item.unitPrice)}</td></tr>`).join('');
  const invoiceUrl = `${location.origin}/?reservation=${bill.reservationId}&bill=${bill.id}`;
  return `<div class="dialog-kicker">SAFFRON & EMBER · ${escapeHtml(t('cart'))}</div><h2>${escapeHtml(t('billNumber'))} #${bill.id}</h2><p class="dialog-intro">${escapeHtml(bill.customerName)} · ${escapeHtml(bill.reservationDate)} · ${escapeHtml(bill.tableNumber)}</p>
    <table class="invoice-items"><thead><tr><th>${escapeHtml(t('yourOrder'))}</th><th>${escapeHtml(t('total'))}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="invoice-totals"><div><span>${escapeHtml(t('subtotal'))}</span><strong>${money(bill.subtotal)}</strong></div><div><span>${escapeHtml(t('gst'))}</span><strong>${money(bill.gst)}</strong></div><div><span>${escapeHtml(t('serviceCharge'))}</span><strong>${money(bill.serviceCharge)}</strong></div>${Number(bill.acCharge) ? `<div><span>${escapeHtml(t('acCharge'))}</span><strong>${money(bill.acCharge)}</strong></div>` : ''}${Number(bill.discount) ? `<div><span>${escapeHtml(t('discount'))}</span><strong>−${money(bill.discount)}</strong></div>` : ''}<div class="invoice-grand"><span>${escapeHtml(t('total'))}</span><strong>${money(bill.grandTotal)}</strong></div></div><div class="invoice-qr"><img class="qr-image" src="${qrUrl(invoiceUrl, 112)}" alt="Invoice QR code"><span>${escapeHtml(t('billNumber'))} #${bill.id}</span></div>
    <div class="dialog-actions"><button class="button button-gold" type="button" data-proceed-payment><span>${escapeHtml(t('payNow'))}</span><i class="fa-solid fa-arrow-right"></i></button><button class="icon-button" type="button" data-print aria-label="${escapeHtml(t('print'))}" title="${escapeHtml(t('print'))}"><i class="fa-solid fa-print"></i></button></div>`;
}

async function createBill() {
  const reservationId = Number($('#cart-reservation-id').value);
  const items = [...state.cart.values()].map((line) => ({ itemId: line.item.id, quantity: line.quantity }));
  if (!reservationId || !items.length) return toast(t('reservationRequired'), true);
  const button = $('#checkout-button');
  setBusy(button, true);
  try {
    const bill = await api('/api/bills', { method: 'POST', body: JSON.stringify({ reservationId, items, couponCode: state.coupon?.code }) });
    state.bill = bill;
    state.reservation ||= await api(`/api/reservations/${reservationId}`);
    state.bill = { ...bill, reservationId };
    await showBill(bill.bill_id);
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
}

async function showBill(id) {
  try {
    const bill = await api(`/api/bills/${id}`);
    state.bill = bill;
    openDialog(renderInvoice(bill), () => showBill(id));
  } catch (error) { toast(error.message, true); }
}

function paymentFormHtml(mode = 'UPI') {
  const bill = state.bill;
  const qrPaymentData = `upi://pay?pa=saffronember@upi&pn=Saffron%20%26%20Ember&am=${Number(bill.grandTotal).toFixed(2)}&cu=INR&tn=Bill%20${bill.id}`;
  const options = [
    ['Cash', 'fa-money-bill-wave', t('cash')], ['UPI', 'fa-qrcode', t('upi')],
    ['Card', 'fa-credit-card', t('card')], ['NetBanking', 'fa-building-columns', t('netBanking')]
  ];
  let extra = '';
  if (mode === 'Cash') extra = `<div class="payment-field"><label class="field"><span>${escapeHtml(t('amountReceived'))}</span><input id="amount-received" type="number" min="${Number(bill.grandTotal).toFixed(2)}" step="0.01" value="${Number(bill.grandTotal).toFixed(2)}" required></label><div class="payment-readout" style="margin-top:10px"><span>${escapeHtml(t('changeDue'))}</span><strong id="cash-change">${money(0)}</strong></div></div>`;
  if (mode === 'UPI') extra = `<div class="qr-payment"><img class="qr-image" src="${qrUrl(qrPaymentData)}" alt="UPI payment QR code"><span>${escapeHtml(t('scanUpi'))}</span></div>`;
  if (mode === 'Card') extra = `<div class="payment-field"><label class="field"><span>${escapeHtml(t('cardholder'))}</span><input id="card-name" autocomplete="cc-name" placeholder="${escapeHtml(t('nameOnCard'))}" required></label><label class="field" style="margin-top:10px"><span>${escapeHtml(t('cardNumber'))}</span><input id="card-number" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" minlength="12" maxlength="23" required></label><div class="guest-fields" style="margin-top:10px"><label class="field"><span>${escapeHtml(t('expiry'))}</span><input placeholder="MM/YY" autocomplete="cc-exp" required></label><label class="field"><span>${escapeHtml(t('cvv'))}</span><input inputmode="numeric" autocomplete="cc-csc" placeholder="•••" minlength="3" maxlength="4" required></label></div></div>`;
  if (mode === 'NetBanking') extra = `<div class="payment-field"><label class="field"><span>${escapeHtml(t('selectBank'))}</span><select id="bank-name" required><option value="">${escapeHtml(t('chooseBank'))}</option><option>State Bank of India</option><option>HDFC Bank</option><option>ICICI Bank</option><option>Axis Bank</option></select></label></div>`;
  return `<div class="dialog-kicker">${escapeHtml(t('paymentMethod'))}</div><h2>${escapeHtml(t('payNow'))}</h2><p class="dialog-intro">${escapeHtml(t('billNumber'))} #${bill.id} · ${escapeHtml(bill.customerName || '')}</p><div class="payment-readout"><span>${escapeHtml(t('total'))}</span><strong>${money(bill.grandTotal)}</strong></div>
    <div class="payment-methods">${options.map(([name, icon, label]) => `<button type="button" class="payment-method${mode === name ? ' active' : ''}" data-payment-mode="${name}"><i class="fa-solid ${icon}"></i><span>${escapeHtml(label)}</span></button>`).join('')}</div>
    <div id="payment-fields">${extra}</div><div class="dialog-actions"><button class="button button-gold" type="button" data-pay-success><span>${escapeHtml(mode === 'Cash' ? t('payNow') : t('simulatePayment'))}</span><i class="fa-solid fa-arrow-right"></i></button>${mode !== 'Cash' ? `<button class="outline-button" type="button" data-pay-failure>${escapeHtml(t('declineDemo'))}</button>` : ''}</div><p class="order-footnote">${escapeHtml(t('demoOnly'))}</p>`;
}

function openPayment(mode = 'UPI') {
  state.paymentMode = mode;
  openDialog(paymentFormHtml(mode), () => openPayment(mode));
  updateCashChange();
}

function updateCashChange() {
  if (!$('#amount-received') || !state.bill) return;
  const received = Number($('#amount-received').value) || 0;
  $('#cash-change').textContent = money(Math.max(0, received - state.bill.grandTotal));
}

async function submitPayment(success) {
  const mode = state.paymentMode;
  const amount = $('#amount-received');
  if (amount && Number(amount.value) < state.bill.grandTotal) return toast('Amount received must cover the full bill.', true);
  for (const selector of ['#card-name', '#card-number', '#bank-name']) {
    const input = $(selector);
    if (input && !input.reportValidity()) return;
  }
  const button = $('[data-pay-success]');
  setBusy(button, true);
  try {
    const result = await api('/api/payments', { method: 'POST', body: JSON.stringify({ billId: state.bill.id, mode,
      received: amount ? Number(amount.value) : undefined, success }) });
    state.paymentResult = result;
    if (result.status === 'success') {
      state.cart.clear();
      state.coupon = null;
      renderCart();
      openPaymentResult(result);
    } else openPaymentFailure(result);
  } catch (error) { toast(error.message, true); }
  finally { if (button.isConnected) setBusy(button, false); }
}

function openPaymentFailure(result) {
  openDialog(`<div class="result-mark failed"><i class="fa-solid fa-xmark"></i></div><h2>${escapeHtml(t('paymentFailed'))}</h2><p class="dialog-intro">${escapeHtml(t('transaction'))} ${escapeHtml(result.transactionRef)} ${escapeHtml(t('paymentDeclined'))}</p><div class="dialog-actions"><button class="button button-gold" type="button" data-retry-payment><span>${escapeHtml(t('retryPayment'))}</span><i class="fa-solid fa-arrow-right"></i></button></div>`, () => openPaymentFailure(result));
}

function openPaymentResult(result) {
  openDialog(`<div class="result-mark"><i class="fa-solid fa-check"></i></div><div class="dialog-kicker" style="text-align:center">${escapeHtml(t('paymentSuccess'))}</div><h2 style="text-align:center">${escapeHtml(t('paymentSuccess'))}</h2><p class="dialog-intro" style="text-align:center">${escapeHtml(t('transaction'))} · ${escapeHtml(result.transactionRef)}</p><div class="slip-details"><div><span>${escapeHtml(t('billNumber'))}</span><strong>#${state.bill.id}</strong></div><div><span>${escapeHtml(t('paymentMethod'))}</span><strong>${escapeHtml(t(state.paymentMode === 'NetBanking' ? 'netBanking' : state.paymentMode.toLowerCase()))}</strong></div><div><span>${escapeHtml(t('total'))}</span><strong>${money(result.amount)}</strong></div>${result.change ? `<div><span>${escapeHtml(t('changeDue'))}</span><strong>${money(result.change)}</strong></div>` : ''}</div><div class="dialog-actions"><button class="button button-gold" type="button" data-reprint-bill><i class="fa-solid fa-print"></i><span>${escapeHtml(t('print'))}</span></button><button class="button button-dark" type="button" data-show-feedback><span>${escapeHtml(t('ratingTitle'))}</span><i class="fa-solid fa-arrow-right"></i></button></div>`, () => openPaymentResult(result));
}

function openFeedback() {
  state.rating = 0;
  openDialog(`<div class="dialog-kicker">SAFFRON & EMBER</div><h2 style="text-align:center">${escapeHtml(t('ratingTitle'))}</h2><p class="dialog-intro" style="text-align:center">${escapeHtml(t('thoughts'))}</p><div class="rating-stars" role="group" aria-label="Rating from 1 to 5">${[1, 2, 3, 4, 5].map((star) => `<button class="rating-star" type="button" data-rating="${star}" aria-label="${star} stars"><i class="fa-solid fa-star"></i></button>`).join('')}</div><form id="feedback-form"><label class="field"><span>${escapeHtml(t('feedbackPlaceholder'))}</span><textarea name="comment" maxlength="500" placeholder="${escapeHtml(t('feedbackPlaceholder'))}"></textarea></label><div class="dialog-actions"><button class="button button-gold" type="submit"><span>${escapeHtml(t('sendFeedback'))}</span><i class="fa-solid fa-arrow-right"></i></button></div></form>`, openFeedback);
}

async function showBillHistory() {
  const reservationId = Number($('#cart-reservation-id').value);
  if (!reservationId) return toast(t('reservationRequired'), true);
  try {
    const bills = await api(`/api/bill-history?reservationId=${reservationId}`);
    if (!bills.length) return openDialog(`<div class="dialog-kicker">SAFFRON & EMBER</div><h2>${escapeHtml(t('billHistory'))}</h2><p class="dialog-intro">${escapeHtml(t('noBills'))} #${reservationId}</p>`, showBillHistory);
    openDialog(`<div class="dialog-kicker">SAFFRON & EMBER</div><h2>${escapeHtml(t('billHistory'))}</h2><p class="dialog-intro">Reservation #${reservationId}</p><div class="history-list">${bills.map((bill) => `<button class="history-row" type="button" data-open-bill="${bill.id}"><span><strong>#${bill.id}</strong><small>${escapeHtml(new Date(bill.generatedAt).toLocaleString())} · ${escapeHtml(bill.paymentStatus)}</small></span><b>${money(bill.grandTotal)}</b><i class="fa-solid fa-arrow-right"></i></button>`).join('')}</div>`, showBillHistory);
  } catch (error) { toast(error.message, true); }
}

async function validateCoupon() {
  const code = $('#coupon-code').value.trim();
  if (!code) return toast('Enter a coupon code.', true);
  try {
    state.coupon = await api('/api/coupons/validate', { method: 'POST', body: JSON.stringify({ code }) });
    renderCart();
    toast(`${t('couponSuccess')} ${state.coupon.discountPercent}%`);
  } catch (error) { state.coupon = null; renderCart(); toast(error.message, true); }
}

function bindEvents() {
  $('#language').addEventListener('change', (event) => setLanguage(event.target.value));
  $('#theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const light = document.body.classList.contains('light-mode');
    localStorage.setItem('saffron-theme', light ? 'light' : 'dark');
    $('#theme-toggle').innerHTML = `<i class="fa-regular ${light ? 'fa-moon' : 'fa-sun'}"></i>`;
    $('#theme-toggle').title = light ? 'Switch to dark mode' : 'Switch to light mode';
  });
  $('#availability-form').addEventListener('submit', checkAvailability);
  $('#reservation-form').addEventListener('submit', submitReservation);
  $$('.segment').forEach((button) => button.addEventListener('click', () => {
    setArea(button.dataset.area);
    if (!$('#availability-panel').classList.contains('hidden')) refreshAvailability();
  }));
  ['#booking-date', '#booking-slot', '#booking-guests'].forEach((selector) => $(selector).addEventListener('change', () => {
    state.selectedTable = null;
    $('#reservation-form').classList.add('hidden');
    if (!$('#availability-panel').classList.contains('hidden')) refreshAvailability();
  }));
  $('#floorplan').addEventListener('click', (event) => {
    const button = event.target.closest('[data-table-id]');
    if (!button || button.disabled) return;
    const area = button.dataset.tableArea;
    const table = state.tables[area].find((item) => item.id === Number(button.dataset.tableId));
    if (!table) return;
    state.area = area;
    state.selectedTable = { ...table, area };
    $$('.segment').forEach((segment) => {
      const active = segment.dataset.area === area;
      segment.classList.toggle('active', active);
      segment.setAttribute('aria-pressed', String(active));
    });
    $('#hall-title').textContent = `${hallLabel(area)} · ${area === 'AC' ? '01' : '02'}`;
    $('#selection-summary').textContent = `${table.number} · ${table.capacity} ${t('seats')} · ${hallLabel(area)}`;
    $('#reservation-form').classList.remove('hidden');
    renderTables();
    renderCart();
  });
  $('#category-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    renderCategories();
    renderMenu();
  });
  $('#menu-search').addEventListener('input', (event) => { state.query = event.target.value; renderMenu(); });
  $('#diet-filter').addEventListener('click', () => {
    state.diet = state.diet === 'all' ? 'veg' : state.diet === 'veg' ? 'nonveg' : 'all';
    renderMenu();
  });
  $('#menu-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-item]');
    if (button) addToCart(button.dataset.addItem);
  });
  $('#cart-lines').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    const quantity = event.target.closest('[data-quantity]');
    if (remove) state.cart.delete(Number(remove.dataset.remove));
    if (quantity) {
      const id = Number(quantity.dataset.quantity);
      const line = state.cart.get(id);
      if (line) {
        line.quantity += Number(quantity.dataset.delta);
        if (line.quantity < 1) state.cart.delete(id);
        else if (line.quantity > 20) line.quantity = 20;
      }
    }
    renderCart();
  });
  $('#coupon-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); validateCoupon(); } });
  $('#apply-coupon').addEventListener('click', validateCoupon);
  $('#split-count').addEventListener('input', renderCart);
  $('#checkout-button').addEventListener('click', createBill);
  $('#bill-history-button').addEventListener('click', showBillHistory);
  $('#app-dialog').addEventListener('click', (event) => { if (event.target === $('#app-dialog')) closeDialog(); });
  $('.dialog-close').addEventListener('click', closeDialog);
  $('#app-dialog').addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-print')) window.print();
    if (target.hasAttribute('data-close-and-menu')) { closeDialog(); $('#menu').scrollIntoView({ behavior: 'smooth' }); }
    if (target.hasAttribute('data-proceed-payment')) openPayment();
    if (target.hasAttribute('data-payment-mode')) openPayment(target.dataset.paymentMode);
    if (target.hasAttribute('data-pay-success')) submitPayment(true);
    if (target.hasAttribute('data-pay-failure')) submitPayment(false);
    if (target.hasAttribute('data-retry-payment')) openPayment();
    if (target.hasAttribute('data-reprint-bill')) showBill(state.bill.id);
    if (target.hasAttribute('data-show-feedback')) openFeedback();
    if (target.hasAttribute('data-open-bill')) showBill(target.dataset.openBill);
    if (target.hasAttribute('data-rating')) {
      state.rating = Number(target.dataset.rating);
      $$('.rating-star').forEach((star) => star.classList.toggle('active', Number(star.dataset.rating) <= state.rating));
    }
  });
  $('#app-dialog').addEventListener('input', updateCashChange);
  $('#app-dialog').addEventListener('submit', async (event) => {
    if (event.target.id !== 'feedback-form') return;
    event.preventDefault();
    if (!state.rating) return toast('Choose a star rating first.', true);
    const button = $('button[type="submit"]', event.target);
    setBusy(button, true);
    try {
      await api('/api/feedback', { method: 'POST', body: JSON.stringify({ reservationId: state.bill.reservationId, rating: state.rating, ...Object.fromEntries(new FormData(event.target)) }) });
      openDialog(`<div class="result-mark"><i class="fa-solid fa-heart"></i></div><h2 style="text-align:center">${escapeHtml(t('feedbackThanks'))}</h2><p class="dialog-intro" style="text-align:center">${escapeHtml(t('visitAgain'))}</p>`);
    } catch (error) { toast(error.message, true); }
    finally { if (button.isConnected) setBusy(button, false); }
  });
}

async function init() {
  $('#year').textContent = new Date().getFullYear();
  if (localStorage.getItem('saffron-theme') === 'light') {
    document.body.classList.add('light-mode');
    $('#theme-toggle').innerHTML = '<i class="fa-regular fa-moon"></i>';
    $('#theme-toggle').title = 'Switch to dark mode';
  }
  bindEvents();
  await Promise.all([setLanguage(state.language), loadConfig(), loadMenu()]);
  renderCart();
  const reservationId = Number(new URLSearchParams(location.search).get('reservation'));
  if (reservationId) {
    try {
      state.reservation = await api(`/api/reservations/${reservationId}`);
      $('#cart-reservation-id').value = reservationId;
    } catch { /* A stale shared link should not interrupt browsing. */ }
  }
  const billId = Number(new URLSearchParams(location.search).get('bill'));
  if (billId) await showBill(billId);
  window.setInterval(() => {
    if (!document.hidden && !$('#availability-panel').classList.contains('hidden')) refreshAvailability();
  }, 15000);
}

init().catch((error) => toast(error.message, true));