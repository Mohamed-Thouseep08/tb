const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { view: 'overview', charts: {}, reservations: [], tables: [], menu: [], customers: [], slots: ['12:00 PM - 2:00 PM', '2:00 PM - 4:00 PM', '6:00 PM - 8:00 PM', '8:00 PM - 10:00 PM'] };
const categories = ['Starters', 'Main Course', 'Biryani', 'Breads', 'Desserts', 'Beverages'];
const money = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount) || 0);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/admin/login') showLogin();
    throw new Error(payload?.error || 'Something went wrong. Please try again.');
  }
  return payload;
}

function notify(message, error = false) {
  const node = document.createElement('div');
  node.className = `admin-toast${error ? ' error' : ''}`;
  node.textContent = message;
  $('#admin-toasts').append(node);
  setTimeout(() => node.remove(), 3800);
}

function showLogin() {
  $('#admin-app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

function showApp(username) {
  $('#login-screen').classList.add('hidden');
  $('#admin-app').classList.remove('hidden');
  $('#topbar-date').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  $('#service-eyebrow').textContent = `${new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(new Date()).toUpperCase()} SERVICE · BENGALURU`;
  $('#breadcrumb').textContent = username ? `Overview · ${username}` : 'Overview';
  loadView('overview');
}

function setView(view) {
  state.view = view;
  $$('.side-link').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view-section').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $('#breadcrumb').textContent = view[0].toUpperCase() + view.slice(1);
  $('#sidebar').classList.remove('open');
  loadView(view);
}

function statusPill(status) {
  return `<span class="status-pill ${esc(status)}">${esc(status)}</span>`;
}

function emptyTable(columns, text = 'Nothing to show here yet.') {
  return `<table class="data-table"><tbody><tr><td class="empty-row" colspan="${columns}">${esc(text)}</td></tr></tbody></table>`;
}

async function loadView(view = state.view) {
  try {
    if (view === 'overview') await Promise.all([loadSummary(), loadReservations(true)]);
    if (view === 'reservations') { await loadTables(); await loadReservations(false); }
    if (view === 'tables') await loadTables();
    if (view === 'menu') await loadMenu();
    if (view === 'customers') await loadCustomers();
  } catch (error) { notify(error.message, true); }
}

async function loadSummary() {
  const summary = await api('/api/admin/summary');
  $('#metric-reservations').textContent = summary.reservations;
  $('#metric-revenue').textContent = money(summary.revenue);
  $('#metric-orders').textContent = summary.orders;
  $('#metric-dish').textContent = summary.popular?.name || 'No orders yet';
  $('#metric-dish-count').textContent = summary.popular ? `${summary.popular.units} portions ordered` : 'No orders yet';
  const palette = ['#7c4943', '#d0a25f', '#62876a', '#8b8276'];
  if (!window.Chart) return;
  Object.values(state.charts).forEach((chart) => chart.destroy());
  state.charts.revenue = new Chart($('#revenue-chart'), {
    type: 'line', data: { labels: summary.daily.map((day) => new Date(`${day.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })), datasets: [{ data: summary.daily.map((day) => day.revenue), borderColor: '#925e40', backgroundColor: 'rgba(201, 155, 91, .12)', fill: true, tension: .3, pointRadius: 3, pointBackgroundColor: '#925e40' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => money(item.raw) } } }, scales: { x: { grid: { display: false }, ticks: { color: '#8d857a', font: { size: 9 } } }, y: { beginAtZero: true, grid: { color: '#eeeae3' }, ticks: { color: '#8d857a', font: { size: 8 }, callback: (value) => money(value) } } } }
  });
  const areaLabels = ['AC', 'Non-AC'];
  const areaCounts = areaLabels.map((name) => summary.areas.find((area) => area.area === name)?.count || 0);
  state.charts.area = new Chart($('#area-chart'), {
    type: 'doughnut', data: { labels: areaLabels, datasets: [{ data: areaCounts, backgroundColor: palette.slice(0, 2), borderColor: '#fffefa', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { color: '#756d62', boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 9 } } } } }
  });
  const payLabels = ['Cash', 'UPI', 'Card', 'NetBanking'];
  const payCounts = payLabels.map((name) => summary.paymentModes.find((mode) => mode.mode === name)?.count || 0);
  state.charts.payment = new Chart($('#payment-chart'), {
    type: 'doughnut', data: { labels: payLabels, datasets: [{ data: payCounts, backgroundColor: palette, borderColor: '#fffefa', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { color: '#756d62', boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 8 } } } } }
  });
}

async function loadReservations(recentOnly) {
  state.reservations = await api('/api/admin/reservations');
  if (recentOnly) {
    const recent = state.reservations.slice(0, 6);
    $('#recent-reservations').innerHTML = reservationTable(recent, false);
  } else renderReservations();
}

function reservationTable(rows, editable = true) {
  if (!rows.length) return emptyTable(7, 'No reservations found.');
  return `<table class="data-table"><thead><tr><th>BOOKING</th><th>GUEST</th><th>DATE & TIME</th><th>TABLE</th><th>GUESTS</th><th>STATUS</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((row) => `<tr data-reservation-row="${row.id}"><td><strong>#${row.id}</strong><small>${esc(row.area)}</small></td><td><strong>${esc(row.customer)}</strong><small>${esc(row.phone)}</small></td><td>${editable ? `<input type="date" data-field="date" value="${esc(row.date)}"><select data-field="slot">${state.slots.map((slot) => `<option ${slot === row.slot ? 'selected' : ''}>${esc(slot)}</option>`).join('')}</select>` : `${esc(row.date)}<small>${esc(row.slot)}</small>`}</td><td>${editable ? `<select data-field="tableId">${state.tables.map((table) => `<option value="${table.id}" ${table.id === row.tableId ? 'selected' : ''}>${esc(table.number)} · ${esc(table.area)}</option>`).join('')}</select>` : esc(row.tableNumber)}</td><td>${editable ? `<input class="small-input" type="number" min="1" max="20" data-field="guests" value="${row.guests}">` : row.guests}</td><td>${editable ? `<select data-field="status">${['confirmed', 'seated', 'completed', 'cancelled'].map((status) => `<option ${row.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select>` : statusPill(row.status)}</td>${editable ? `<td><div class="row-actions"><button class="row-button" type="button" data-save-reservation="${row.id}" aria-label="Save reservation" title="Save"><i class="fa-solid fa-check"></i></button></div></td>` : ''}</tr>`).join('')}</tbody></table>`;
}

function renderReservations() {
  const query = ($('#reservation-search')?.value || '').trim().toLowerCase();
  const rows = state.reservations.filter((row) => `${row.id} ${row.customer} ${row.phone} ${row.tableNumber} ${row.status}`.toLowerCase().includes(query));
  $('#reservation-count').textContent = `${rows.length} bookings`;
  $('#reservations-list').innerHTML = reservationTable(rows, true);
}

async function loadTables() {
  state.tables = await api('/api/admin/tables');
  renderTables();
}

function renderTables() {
  const rows = state.tables;
  if (!rows.length) { $('#tables-list').innerHTML = emptyTable(6); return; }
  $('#tables-list').innerHTML = `<table class="data-table"><thead><tr><th>TABLE</th><th>CAPACITY</th><th>DINING ROOM</th><th>STATUS</th><th></th></tr></thead><tbody>${rows.map((table) => `<tr data-table-row="${table.id}"><td><input class="name-input" data-field="number" value="${esc(table.number)}" aria-label="Table number"></td><td><input class="small-input" type="number" min="1" max="20" data-field="capacity" value="${table.capacity}" aria-label="Capacity"></td><td><select data-field="area"><option ${table.area === 'AC' ? 'selected' : ''}>AC</option><option ${table.area === 'Non-AC' ? 'selected' : ''}>Non-AC</option></select></td><td><select data-field="status">${['available', 'reserved', 'occupied', 'unavailable'].map((status) => `<option ${status === table.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td><td><div class="row-actions"><button class="row-button" type="button" data-save-table="${table.id}" aria-label="Save table"><i class="fa-solid fa-check"></i></button><button class="row-button danger" type="button" data-delete-table="${table.id}" aria-label="Delete table"><i class="fa-regular fa-trash-can"></i></button></div></td></tr>`).join('')}</tbody></table>`;
}

async function loadMenu() {
  state.menu = await api('/api/admin/menu-items');
  renderMenu();
}

function renderMenu() {
  const query = ($('#menu-search')?.value || '').toLowerCase();
  const rows = state.menu.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query));
  $('#menu-count').textContent = `${rows.length} items`;
  if (!rows.length) { $('#menu-list').innerHTML = emptyTable(6); return; }
  $('#menu-list').innerHTML = `<table class="data-table"><thead><tr><th>ITEM</th><th>CATEGORY</th><th>PRICE</th><th>DIET</th><th>AVAILABLE</th><th></th></tr></thead><tbody>${rows.map((item) => `<tr data-menu-row="${item.id}"><td><input class="name-input" data-field="name" value="${esc(item.name)}" aria-label="Menu item name"></td><td><select data-field="category">${categories.map((category) => `<option ${category === item.category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></td><td><input class="small-input" type="number" min="0" step="1" data-field="price" value="${item.price}" aria-label="Price"></td><td><select data-field="isVeg"><option value="1" ${item.isVeg ? 'selected' : ''}>Veg</option><option value="0" ${!item.isVeg ? 'selected' : ''}>Non-veg</option></select></td><td><select data-field="available"><option value="1" ${item.available ? 'selected' : ''}>Yes</option><option value="0" ${!item.available ? 'selected' : ''}>No</option></select></td><td><div class="row-actions"><button class="row-button" type="button" data-save-menu="${item.id}" aria-label="Save item"><i class="fa-solid fa-check"></i></button><button class="row-button danger" type="button" data-delete-menu="${item.id}" aria-label="Delete item"><i class="fa-regular fa-trash-can"></i></button></div></td></tr>`).join('')}</tbody></table>`;
}

async function loadCustomers() {
  state.customers = await api('/api/admin/customers');
  renderCustomers();
}

function renderCustomers() {
  const query = ($('#customer-search')?.value || '').toLowerCase();
  const rows = state.customers.filter((customer) => `${customer.name} ${customer.phone} ${customer.email || ''}`.toLowerCase().includes(query));
  $('#customer-count').textContent = `${rows.length} guests`;
  if (!rows.length) { $('#customers-list').innerHTML = emptyTable(6); return; }
  $('#customers-list').innerHTML = `<table class="data-table"><thead><tr><th>GUEST</th><th>PHONE</th><th>EMAIL</th><th>VISITS</th><th>ADDED</th><th></th></tr></thead><tbody>${rows.map((customer) => `<tr data-customer-row="${customer.id}"><td><input class="name-input" data-field="name" value="${esc(customer.name)}" aria-label="Customer name"></td><td><input data-field="phone" value="${esc(customer.phone)}" aria-label="Phone"></td><td><input class="name-input" data-field="email" value="${esc(customer.email || '')}" aria-label="Email"></td><td>${customer.visits}</td><td>${esc(customer.createdAt?.slice(0, 10))}</td><td><div class="row-actions"><button class="row-button" type="button" data-save-customer="${customer.id}" aria-label="Save customer"><i class="fa-solid fa-check"></i></button><button class="row-button danger" type="button" data-delete-customer="${customer.id}" aria-label="Delete customer"><i class="fa-regular fa-trash-can"></i></button></div></td></tr>`).join('')}</tbody></table>`;
}

function field(name, label, value = '', type = 'text', options = {}) {
  const required = options.required ? 'required' : '';
  const span = options.full ? ' full-span' : '';
  if (options.select) return `<label class="${span}">${label}<select name="${name}" ${required}>${options.select.map((option) => { const optionValue = typeof option === 'object' ? option.value : option; const optionLabel = typeof option === 'object' ? option.label : option; return `<option value="${esc(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>${esc(optionLabel)}</option>`; }).join('')}</select></label>`;
  return `<label class="${span}">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required} ${options.min !== undefined ? `min="${options.min}"` : ''} ${options.max !== undefined ? `max="${options.max}"` : ''} ${options.step ? `step="${options.step}"` : ''}></label>`;
}

function openForm(kind) {
  const title = { reservation: 'Create a reservation', table: 'Add a table', menu: 'Add a menu item', customer: 'Add a customer' }[kind];
  let fields = '';
  if (kind === 'reservation') fields = field('name', 'Guest name', '', 'text', { required: true }) + field('phone', 'Phone number', '', 'tel', { required: true }) + field('email', 'Email (optional)', '', 'email') + field('date', 'Date', new Date().toISOString().slice(0, 10), 'date', { required: true }) + field('slot', 'Dining time', state.slots[0], 'text', { required: true, select: state.slots }) + field('guests', 'Guests', '2', 'number', { required: true, min: 1, max: 8 }) + field('area', 'Dining area', 'AC', 'text', { required: true, select: ['AC', 'Non-AC'] }) + field('tableId', 'Table', state.tables[0]?.id || '', 'text', { required: true, select: state.tables.map((table) => ({ value: table.id, label: `${table.number} · ${table.area} · ${table.capacity} seats` })) });
  if (kind === 'table') fields = field('number', 'Table number', '', 'text', { required: true }) + field('capacity', 'Seats', '4', 'number', { required: true, min: 1, max: 20 }) + field('area', 'Dining area', 'AC', 'text', { required: true, select: ['AC', 'Non-AC'] });
  if (kind === 'menu') fields = field('name', 'Item name', '', 'text', { required: true }) + field('category', 'Category', categories[0], 'text', { required: true, select: categories }) + field('price', 'Price (INR)', '', 'number', { required: true, min: 0, step: '0.01' }) + field('image', 'Image URL (optional)', '', 'url', { full: true }) + `<label class="check-field full-span"><input name="isVeg" type="checkbox" checked> Vegetarian</label>`;
  if (kind === 'customer') fields = field('name', 'Full name', '', 'text', { required: true }) + field('phone', 'Phone number', '', 'tel', { required: true }) + field('email', 'Email (optional)', '', 'email', { full: true });
  $('#admin-dialog-content').innerHTML = `<h2>${title}</h2><p>New records are immediately available across the service.</p><div class="form-fields">${fields}</div><button class="form-submit" type="submit"><span>Create record</span><i class="fa-solid fa-arrow-right"></i></button>`;
  $('#admin-dialog-form').dataset.kind = kind;
  $('#admin-dialog').showModal();
}

async function saveRow(type, id, row) {
  const value = (name) => $('[data-field="' + name + '"]', row).value;
  let body;
  if (type === 'reservation') body = { date: value('date'), slot: value('slot'), tableId: Number(value('tableId')), guests: Number(value('guests')), status: value('status') };
  if (type === 'table') body = { number: value('number'), capacity: Number(value('capacity')), area: value('area'), status: value('status') };
  if (type === 'menu') body = { name: value('name'), category: value('category'), price: Number(value('price')), isVeg: value('isVeg') === '1', available: value('available') === '1' };
  if (type === 'customer') body = { name: value('name'), phone: value('phone'), email: value('email') };
  const route = { reservation: 'reservations', table: 'tables', menu: 'menu-items', customer: 'customers' }[type];
  await api(`/api/admin/${route}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  notify('Changes saved.');
  await loadView(type === 'menu' ? 'menu' : `${type}s`);
}

async function deleteRecord(type, id) {
  const names = { table: 'table', menu: 'menu item', customer: 'customer' };
  if (!window.confirm(`Delete this ${names[type]}? This may be blocked if it is linked to service history.`)) return;
  const route = { table: 'tables', menu: 'menu-items', customer: 'customers' }[type];
  await api(`/api/admin/${route}/${id}`, { method: 'DELETE' });
  notify(`${names[type][0].toUpperCase()}${names[type].slice(1)} removed.`);
  await loadView(type === 'menu' ? 'menu' : `${type}s`);
}

async function createRecord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = form.dataset.kind;
  const raw = Object.fromEntries(new FormData(form));
  if (kind === 'menu') raw.isVeg = form.elements.isVeg.checked;
  const route = kind === 'reservation' ? null : { table: 'tables', menu: 'menu-items', customer: 'customers' }[kind];
  const button = $('.form-submit', form);
  button.disabled = true;
  try {
    await api(kind === 'reservation' ? '/api/reservations' : `/api/admin/${route}`, { method: 'POST', body: JSON.stringify(raw) });
    $('#admin-dialog').close();
    notify('Record created.');
    await loadView(kind === 'menu' ? 'menu' : `${kind}s`);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

function bindEvents() {
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    $('#login-error').classList.add('hidden');
    try {
      const credentials = Object.fromEntries(new FormData(event.currentTarget));
      const session = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(credentials) });
      showApp(session.username);
    } catch (error) { $('#login-error').textContent = error.message; $('#login-error').classList.remove('hidden'); }
    finally { button.disabled = false; }
  });
  $('#logout-button').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST', body: '{}' }); showLogin(); });
  $('.side-nav').addEventListener('click', (event) => { const button = event.target.closest('[data-view]'); if (button) setView(button.dataset.view); });
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#refresh-button').addEventListener('click', () => loadView());
  $('#admin-app').addEventListener('click', async (event) => {
    const target = event.target.closest('button, a');
    if (!target) return;
    try {
      if (target.dataset.goView) setView(target.dataset.goView);
      if (target.dataset.refreshView) loadView(target.dataset.refreshView);
      if (target.dataset.create) openForm(target.dataset.create);
      const saveReservation = target.dataset.saveReservation;
      const saveTable = target.dataset.saveTable;
      const saveMenu = target.dataset.saveMenu;
      const saveCustomer = target.dataset.saveCustomer;
      if (saveReservation) await saveRow('reservation', saveReservation, target.closest('[data-reservation-row]'));
      if (saveTable) await saveRow('table', saveTable, target.closest('[data-table-row]'));
      if (saveMenu) await saveRow('menu', saveMenu, target.closest('[data-menu-row]'));
      if (saveCustomer) await saveRow('customer', saveCustomer, target.closest('[data-customer-row]'));
      if (target.dataset.deleteTable) await deleteRecord('table', target.dataset.deleteTable);
      if (target.dataset.deleteMenu) await deleteRecord('menu', target.dataset.deleteMenu);
      if (target.dataset.deleteCustomer) await deleteRecord('customer', target.dataset.deleteCustomer);
    } catch (error) { notify(error.message, true); }
  });
  $('#admin-dialog-form').addEventListener('submit', createRecord);
  $('.dialog-x').addEventListener('click', () => $('#admin-dialog').close());
  $('#admin-dialog').addEventListener('click', (event) => { if (event.target === $('#admin-dialog')) $('#admin-dialog').close(); });
  $('#reservation-search').addEventListener('input', renderReservations);
  $('#menu-search').addEventListener('input', renderMenu);
  $('#customer-search').addEventListener('input', renderCustomers);
}

async function init() {
  bindEvents();
  try {
    const session = await api('/api/admin/session');
    if (session.authenticated) showApp(session.username);
    else showLogin();
  } catch { showLogin(); }
}

init();