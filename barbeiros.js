"use strict";

const $ = selector => document.querySelector(selector);
const pad = value => String(value).padStart(2, "0");
const toKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = key => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const formatDate = key => new Intl.DateTimeFormat("pt-BR").format(fromKey(key));
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && otherStart < end;
const validKey = key => /^\d{4}-\d{2}-\d{2}$/.test(key) && toKey(fromKey(key)) === key;
const currency = value => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL"
}).format(value);

const state = {
  displayedYear: new Date().getFullYear(),
  displayedMonth: new Date().getMonth(),
  nextBookingId: 10,
  nextSeriesId: 2,
  nextSettingId: 3,
  hours: { opening: "09:00", closing: "18:00", lunchStart: "12:00", lunchEnd: "13:00" },
  absences: [],
  blocks: [],
  products: [
    { id: 1, name: "Pomada modeladora (exemplo)", price: 35, photoUrl: null },
    { id: 2, name: "Óleo para barba (exemplo)", price: 42, photoUrl: null }
  ],
  bookings: [],
  requests: []
};

function plusDays(key, days) {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

const today = toKey(new Date());
state.bookings.push({
  id: 1, date: plusDays(today, 1), time: "09:00",
  name: "Pedro (exemplo)", phone: "(00) 00000-0000",
  service: "Barba", professional: "Damigo", duration: 30, seriesId: null
});
for (const [index, days] of [2, 9, 16, 23].entries()) {
  state.bookings.push({
    id: index + 2, date: plusDays(today, days), time: "14:00",
    name: "Cliente recorrente (exemplo)", phone: "(00) 00000-0000",
    service: "Cabelo", professional: "Santiago", duration: 30, seriesId: 1
  });
}
state.requests.push({
  id: 1, dates: [plusDays(today, 1)], time: "10:00",
  name: "Marina (exemplo)", phone: "(00) 00000-0000",
  service: "Cabelo", professional: "Santiago", duration: 30
});

function recurrenceDates(firstKey, frequency) {
  if (frequency === "none") return [firstKey];
  if (frequency === "weekly" || frequency === "fortnightly") {
    const days = frequency === "weekly" ? 7 : 14;
    return Array.from({ length: 4 }, (_, index) => plusDays(firstKey, index * days));
  }
  if (frequency !== "monthly") return null;

  const first = fromKey(firstKey);
  return Array.from({ length: 4 }, (_, index) => {
    const month = new Date(first.getFullYear(), first.getMonth() + index, 1);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    if (first.getDate() > lastDay) return null;
    month.setDate(first.getDate());
    return toKey(month);
  });
}

function isAvailable(dates, time, duration, professional, ignoredRequestId = null) {
  if (!Array.isArray(dates) || !dates.length ||
      !["Santiago", "Damigo"].includes(professional) ||
      !/^\d{2}:\d{2}$/.test(time) ||
      !Number.isInteger(duration) || duration < 1 || duration > 480) return false;

  const start = minutes(time);
  const end = start + duration;
  const { opening, closing, lunchStart, lunchEnd } = state.hours;
  if (start < minutes(opening) || end > minutes(closing) ||
      (lunchStart && overlaps(start, end, minutes(lunchStart), minutes(lunchEnd)))) return false;

  return dates.every(key => {
    const now = new Date();
    if (!validKey(key) || [0, 1].includes(fromKey(key).getDay()) ||
        key < toKey(now) ||
        (key === toKey(now) && start <= now.getHours() * 60 + now.getMinutes())) return false;

    if (state.blocks.some(block => block.date === key &&
        (!block.startTime || overlaps(start, end, minutes(block.startTime), minutes(block.endTime))))) return false;

    if (state.absences.some(absence =>
        absence.professional === professional && key >= absence.startDate && key <= absence.endDate &&
        (!absence.startTime || overlaps(start, end, minutes(absence.startTime), minutes(absence.endTime))))) return false;

    if (state.bookings.some(booking =>
        booking.date === key && booking.professional === professional &&
        overlaps(start, end, minutes(booking.time), minutes(booking.time) + booking.duration))) return false;

    return !state.requests.some(request =>
      request.id !== ignoredRequestId && request.professional === professional &&
      request.dates.includes(key) &&
      overlaps(start, end, minutes(request.time), minutes(request.time) + request.duration)
    );
  });
}

function showMonth(key) {
  const date = fromKey(key);
  state.displayedYear = date.getFullYear();
  state.displayedMonth = date.getMonth();
  renderCalendar();
}

function makeButton(label, action, className = "button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function renderRequests() {
  const list = $("#requestList");
  list.replaceChildren();
  $("#pendingCount").textContent = state.requests.length;

  if (!state.requests.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhuma solicitação pendente.";
    list.append(empty);
    return;
  }

  for (const request of state.requests) {
    const card = document.createElement("article");
    card.className = "list-item";

    const heading = document.createElement("h3");
    heading.textContent = `${request.name} · ${request.service}`;
    const description = document.createElement("p");
    description.textContent =
      `${request.dates.map(formatDate).join(", ")} às ${request.time} · ` +
      `${request.professional} · ${request.duration} min · WhatsApp: ${request.phone}`;

    const actions = document.createElement("div");
    actions.className = "button-row";
    actions.append(
      makeButton("Aprovar", () => decideRequest(request, true), "button button--primary"),
      makeButton("Recusar", () => decideRequest(request, false), "button button--danger")
    );
    card.append(heading, description, actions);
    list.append(card);
  }
}

function decideRequest(request, approved) {
  if (!state.requests.includes(request)) return;
  if (approved && !isAvailable(
      request.dates, request.time, request.duration, request.professional, request.id
  )) {
    $("#requestStatus").textContent = "Conflito de horário: não foi possível aprovar.";
    return;
  }

  state.requests.splice(state.requests.indexOf(request), 1);
  if (approved) {
    const seriesId = request.dates.length > 1 ? state.nextSeriesId++ : null;
    for (const date of request.dates) {
      state.bookings.push({
        id: state.nextBookingId++, date, time: request.time, duration: request.duration,
        name: request.name, phone: request.phone, service: request.service,
        professional: request.professional, seriesId
      });
    }
    showMonth(request.dates[0]);
  }

  $("#requestStatus").textContent = approved
    ? "Aprovado somente nesta demonstração. Avise o cliente manualmente."
    : "Recusado somente nesta demonstração. Avise o cliente manualmente.";
  renderRequests();
}

function renderCalendar() {
  const grid = $("#calendarGrid");
  grid.replaceChildren();
  $("#bookingDetails").hidden = true;
  $("#displayedMonth").textContent = new Intl.DateTimeFormat("pt-BR", {
    month: "long", year: "numeric"
  }).format(new Date(state.displayedYear, state.displayedMonth, 1));

  const firstWeekday = new Date(state.displayedYear, state.displayedMonth, 1).getDay();
  const daysInMonth = new Date(state.displayedYear, state.displayedMonth + 1, 0).getDate();

  for (let index = 0; index < firstWeekday; index++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day calendar-day--empty";
    empty.setAttribute("aria-hidden", "true");
    grid.append(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = toKey(new Date(state.displayedYear, state.displayedMonth, day));
    const cell = document.createElement("div");
    cell.className = `calendar-day${key === toKey(new Date()) ? " calendar-day--today" : ""}`;

    const number = document.createElement("strong");
    number.textContent = day;
    cell.append(number);

    state.bookings
      .filter(booking => booking.date === key)
      .sort((left, right) => left.time.localeCompare(right.time))
      .forEach(booking => {
        const entry = makeButton(
          `${booking.time} ${booking.name}${booking.seriesId ? " · recorrente" : ""}`,
          () => showBookingDetails(booking.id),
          "calendar-entry"
        );
        entry.setAttribute("aria-label", `${formatDate(key)}, ${booking.time}, ${booking.name}. Ver detalhes`);
        cell.append(entry);
      });

    state.absences.filter(item => key >= item.startDate && key <= item.endDate)
      .forEach(item => appendCalendarNote(
        cell, `${item.professional} ausente${item.startTime ? ` · ${item.startTime}–${item.endTime}` : " · dia inteiro"}`
      ));

    state.blocks.filter(item => item.date === key)
      .forEach(item => appendCalendarNote(
        cell, `${item.reason}${item.startTime ? ` · ${item.startTime}–${item.endTime}` : " · dia inteiro"}`
      ));

    grid.append(cell);
  }
}

function appendCalendarNote(cell, text) {
  const note = document.createElement("span");
  note.className = "calendar-entry calendar-entry--note";
  note.textContent = text;
  cell.append(note);
}

function removeBookings(ids) {
  state.bookings = state.bookings.filter(booking => !ids.has(booking.id));
  renderCalendar();
}

function showBookingDetails(id) {
  const booking = state.bookings.find(item => item.id === id);
  if (!booking) return;

  const panel = $("#bookingDetails");
  panel.replaceChildren();
  panel.hidden = false;

  const title = document.createElement("h3");
  title.textContent = `${booking.name} · ${booking.service}`;
  const description = document.createElement("p");
  description.textContent =
    `${formatDate(booking.date)} às ${booking.time} · ${booking.duration} min · ` +
    `${booking.professional} · WhatsApp: ${booking.phone}`;
  const actions = document.createElement("div");
  actions.className = "button-row";

  if (booking.seriesId === null) {
    actions.append(makeButton("Excluir agendamento", () => {
      if (window.confirm("Excluir este agendamento? O cliente não será avisado.")) {
        removeBookings(new Set([booking.id]));
      }
    }, "button button--danger"));
  } else {
    const upcoming = state.bookings
      .filter(item => item.seriesId === booking.seriesId && item.date >= toKey(new Date()))
      .sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time));

    const next = upcoming[0];
    const removeNext = makeButton("Excluir próximo agendamento", () => {
      if (next && window.confirm(`Excluir somente ${formatDate(next.date)} às ${next.time}? O cliente não será avisado.`)) {
        removeBookings(new Set([next.id]));
      }
    }, "button button--danger");
    removeNext.disabled = !next;

    const removeSeries = makeButton("Excluir recorrência futura", () => {
      const ids = new Set(upcoming.map(item => item.id));
      if (ids.size && window.confirm(`Excluir ${ids.size} agendamento(s) de hoje em diante? O cliente não será avisado.`)) {
        removeBookings(ids);
      }
    }, "button button--danger");
    removeSeries.disabled = !next;
    actions.append(removeNext, removeSeries);
  }

  panel.append(title, description, actions);
}

function changeMonth(offset) {
  const month = new Date(state.displayedYear, state.displayedMonth + offset, 1);
  state.displayedYear = month.getFullYear();
  state.displayedMonth = month.getMonth();
  renderCalendar();
}

$("#previousMonth").addEventListener("click", () => changeMonth(-1));
$("#nextMonth").addEventListener("click", () => changeMonth(1));
$("#currentMonth").addEventListener("click", () => {
  const now = new Date();
  state.displayedYear = now.getFullYear();
  state.displayedMonth = now.getMonth();
  renderCalendar();
});

$("#manualBookingForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const name = String(values.get("name")).trim();
  const phone = String(values.get("phone")).trim();
  const service = String(values.get("service")).trim();
  const professional = String(values.get("professional"));
  const date = String(values.get("date"));
  const time = String(values.get("time"));
  const duration = Number(values.get("duration"));
  const frequency = String(values.get("frequency"));
  const status = $("#manualBookingStatus");

  if (!name || !service || !/^\d{10,11}$/.test(phone.replace(/\D/g, "")) ||
      !validKey(date) || !Number.isInteger(duration) || duration < 1 || duration > 480) {
    status.textContent = "Confira nome, WhatsApp com DDD, data e duração.";
    return;
  }

  const dates = recurrenceDates(date, frequency);
  if (!dates || dates.some(item => !item)) {
    status.textContent = "Esta repetição não cabe no mesmo dia dos próximos meses.";
    return;
  }
  if (!isAvailable(dates, time, duration, professional)) {
    status.textContent = "Alguma data está fechada, bloqueada, no passado ou em conflito.";
    return;
  }

  const seriesId = dates.length > 1 ? state.nextSeriesId++ : null;
  for (const bookingDate of dates) {
    state.bookings.push({
      id: state.nextBookingId++, date: bookingDate, time, duration,
      name, phone, service, professional, seriesId
    });
  }

  status.textContent = `${dates.length} agendamento(s) incluído(s) nesta demonstração.`;
  form.reset();
  showMonth(date);
});

function intervalFrom(values) {
  const startTime = String(values.get("startTime") || "");
  const endTime = String(values.get("endTime") || "");
  if (Boolean(startTime) !== Boolean(endTime) ||
      (startTime && startTime >= endTime)) return null;
  return { startTime, endTime };
}

function renderRemovableList(containerSelector, items, describe, removeItem) {
  const container = $(containerSelector);
  container.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum registro nesta demonstração.";
    container.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-item";
    const text = document.createElement("span");
    text.textContent = describe(item);
    row.append(text, makeButton("Remover", () => removeItem(item), "button button--danger"));
    container.append(row);
  }
}

function renderAbsences() {
  renderRemovableList("#absenceList", state.absences,
    item => `${item.professional} · ${formatDate(item.startDate)} a ${formatDate(item.endDate)} · ` +
      (item.startTime ? `${item.startTime}–${item.endTime}` : "dia inteiro"),
    item => {
      state.absences.splice(state.absences.indexOf(item), 1);
      renderAbsences();
      renderCalendar();
    });
}

function renderBlocks() {
  renderRemovableList("#blockList", state.blocks,
    item => `${formatDate(item.date)} · ${item.reason} · ` +
      (item.startTime ? `${item.startTime}–${item.endTime}` : "dia inteiro"),
    item => {
      state.blocks.splice(state.blocks.indexOf(item), 1);
      renderBlocks();
      renderCalendar();
    });
}

$("#absenceForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const startDate = String(values.get("startDate"));
  const endDate = String(values.get("endDate"));
  const interval = intervalFrom(values);

  if (!validKey(startDate) || !validKey(endDate) || endDate < startDate || !interval) {
    $("#absenceStatus").textContent = "Confira os dias e, para ausência parcial, informe as duas horas em ordem.";
    return;
  }

  state.absences.push({
    professional: String(values.get("professional")), startDate, endDate, ...interval
  });
  $("#absenceStatus").textContent = "Ausência registrada. Confira manualmente agendamentos anteriores.";
  form.reset();
  renderAbsences();
  showMonth(startDate);
});

$("#openingHoursForm").addEventListener("submit", event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const opening = String(values.get("opening"));
  const closing = String(values.get("closing"));
  const lunchStart = String(values.get("lunchStart"));
  const lunchEnd = String(values.get("lunchEnd"));

  if (!opening || !closing || opening >= closing ||
      Boolean(lunchStart) !== Boolean(lunchEnd) ||
      (lunchStart && !(opening <= lunchStart && lunchStart < lunchEnd && lunchEnd <= closing))) {
    $("#openingHoursStatus").textContent = "Confira o expediente e as duas horas do almoço.";
    return;
  }

  Object.assign(state.hours, { opening, closing, lunchStart, lunchEnd });
  $("#openingHoursStatus").textContent = "Expediente atualizado somente nesta demonstração.";
});

$("#blockForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const date = String(values.get("date"));
  const reason = String(values.get("reason")).trim();
  const interval = intervalFrom(values);

  if (!validKey(date) || !reason || !interval) {
    $("#blockStatus").textContent = "Informe uma data, um motivo e horas em ordem válida.";
    return;
  }

  state.blocks.push({ date, reason, ...interval });
  $("#blockStatus").textContent = "Bloqueio aplicado somente a novos agendamentos desta demonstração.";
  form.reset();
  renderBlocks();
  showMonth(date);
});

function renderProducts() {
  const list = $("#productList");
  list.replaceChildren();

  for (const product of state.products) {
    const row = document.createElement("div");
    row.className = "list-item";

    if (product.photoUrl) {
      const image = document.createElement("img");
      image.src = product.photoUrl;
      image.alt = `Foto de ${product.name}`;
      row.append(image);
    }

    const description = document.createElement("p");
    description.textContent = `${product.name} · ${currency(product.price)}`;
    const remove = makeButton("Remover", () => {
      state.products.splice(state.products.indexOf(product), 1);
      if (product.photoUrl) URL.revokeObjectURL(product.photoUrl);
      renderProducts();
    }, "button button--danger");

    row.append(description, remove);
    list.append(row);
  }

  if (!state.products.length) list.textContent = "Nenhum produto nesta demonstração.";
}

$("#productForm").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const name = String(values.get("name")).trim();
  const price = Number(values.get("price"));
  const photo = values.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;

  if (!name || !Number.isFinite(price) || price <= 0) {
    $("#productStatus").textContent = "Informe um produto e preço maior que zero.";
    return;
  }
  if (hasPhoto && (!["image/jpeg", "image/png", "image/webp"].includes(photo.type) ||
      photo.size > 5 * 1024 * 1024)) {
    $("#productStatus").textContent = "Use JPG, PNG ou WebP de até 5 MB.";
    return;
  }

  state.products.push({
    id: state.nextSettingId++, name, price,
    photoUrl: hasPhoto ? URL.createObjectURL(photo) : null
  });
  $("#productStatus").textContent = "Produto incluído somente neste painel; a loja não foi alterada.";
  form.reset();
  renderProducts();
});

$("#copyReminder").addEventListener("click", async () => {
  const message =
    "Olá, Pedro! Passando para lembrar do seu horário de barba na Santiago Barbearia, " +
    "com o Damigo. Pode confirmar que vem? 🙂";
  $("#reminderText").textContent = message;
  $("#reminderText").hidden = false;

  try {
    await navigator.clipboard.writeText(message);
    $("#reminderStatus").textContent = "Mensagem copiada. Revise-a antes de enviar manualmente.";
  } catch {
    $("#reminderStatus").textContent = "Selecione a mensagem acima e copie-a manualmente.";
  }
});

renderRequests();
renderCalendar();
renderAbsences();
renderBlocks();
renderProducts();