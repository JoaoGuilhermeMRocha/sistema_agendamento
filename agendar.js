"use strict";

const bookingElements = {
  services: document.querySelector("#serviceOptions"),
  professionals: document.querySelector("#professionalOptions"),
  dates: document.querySelector("#availableDates"),
  times: document.querySelector("#availableTimes"),
  availabilityMessage: document.querySelector("#availabilityMessage"),
  repeat: document.querySelector("#repeatBooking"),
  frequencyField: document.querySelector("#frequencyField"),
  frequency: document.querySelector("#bookingFrequency"),
  summaryServices: document.querySelector("#summaryServices"),
  summaryProfessional: document.querySelector("#summaryProfessional"),
  summaryDate: document.querySelector("#summaryDate"),
  summaryFrequency: document.querySelector("#summaryFrequency"),
  contactFields: document.querySelector("#contactFields"),
  customerName: document.querySelector("#customerName"),
  customerPhone: document.querySelector("#customerPhone"),
  submit: document.querySelector("#submitRequest"),
  feedback: document.querySelector("#requestFeedback")
};

const serviceDurations = { Cabelo: 30, Barba: 30, Sobrancelha: 15 };
const professionalNames = ["Santiago", "Damigo"];
const openingMinutes = 9 * 60;
const closingMinutes = 18 * 60;
const lunchStartMinutes = 12 * 60;
const lunchEndMinutes = 13 * 60;

const selection = {
  services: ["Cabelo"],
  professional: null,
  date: null,
  time: null,
  frequency: "none",
  submitted: false
};

const localRequests = [];
const padNumber = value => String(value).padStart(2, "0");
const dateKey = date => `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
const dateFromKey = key => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const formatDate = key => new Intl.DateTimeFormat("pt-BR").format(dateFromKey(key));
const formatTime = minutes => `${padNumber(Math.floor(minutes / 60))}:${padNumber(minutes % 60)}`;
const timeInMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && otherStart < end;

function datePlusDays(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function occurrenceDates(firstDate) {
  if (selection.frequency === "none") return [firstDate];

  if (selection.frequency === "weekly" || selection.frequency === "fortnightly") {
    const interval = selection.frequency === "weekly" ? 7 : 14;
    return Array.from({ length: 4 }, (_, index) => datePlusDays(firstDate, index * interval));
  }

  const original = dateFromKey(firstDate);
  return Array.from({ length: 4 }, (_, index) => {
    const month = new Date(original.getFullYear(), original.getMonth() + index, 1);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    if (original.getDate() > lastDay) return null;
    month.setDate(original.getDate());
    return dateKey(month);
  });
}

function isProfessionalAvailable(professional, dates, start, duration) {
  const end = start + duration;
  if (start < openingMinutes || end > closingMinutes ||
      overlaps(start, end, lunchStartMinutes, lunchEndMinutes)) return false;

  return dates.every(key => {
    if (!key) return false;
    const day = dateFromKey(key).getDay();
    const now = new Date();
    if (day === 0 || day === 1 || key < dateKey(now) ||
        (key === dateKey(now) && start <= now.getHours() * 60 + now.getMinutes())) return false;

    return !localRequests.some(request =>
      request.professional === professional &&
      request.dates.includes(key) &&
      overlaps(start, end, request.start, request.start + request.duration)
    );
  });
}

function availableProfessional(dates, start, duration) {
  const candidates = selection.professional ? [selection.professional] : professionalNames;
  return candidates.find(name => isProfessionalAvailable(name, dates, start, duration)) || null;
}

function availableTimes(firstDate) {
  if (!firstDate || !selection.services.length) return [];
  const dates = occurrenceDates(firstDate);
  const duration = selection.services.reduce((total, service) => total + serviceDurations[service], 0);
  const times = [];

  for (let start = openingMinutes; start + duration <= closingMinutes; start += 15) {
    if (availableProfessional(dates, start, duration)) times.push(formatTime(start));
  }
  return times;
}

function renderSummary() {
  const duration = selection.services.reduce((total, service) => total + serviceDurations[service], 0);
  bookingElements.summaryServices.textContent = selection.services.length
    ? `${selection.services.join(" + ")} · ${duration} min`
    : "Escolha um serviço";
  bookingElements.summaryProfessional.textContent = selection.professional || "Tanto faz";
  bookingElements.summaryDate.textContent = selection.time
    ? `${occurrenceDates(selection.date).map(formatDate).join(" · ")} às ${selection.time}`
    : selection.date ? `${formatDate(selection.date)} · escolha um horário` : "Escolha um dia";
  bookingElements.summaryFrequency.textContent = {
    none: "Somente uma vez",
    weekly: "Semanal · 4 datas",
    fortnightly: "Quinzenal · 4 datas",
    monthly: "Mensal · 4 datas"
  }[selection.frequency];

  const ready = selection.services.length > 0 && selection.date && selection.time;
  bookingElements.contactFields.hidden = !ready;
  bookingElements.submit.disabled = !ready || selection.submitted;
  bookingElements.submit.textContent = selection.submitted
    ? "Solicitação simulada"
    : !selection.services.length ? "Escolha um serviço"
    : !selection.date ? "Escolha um dia"
    : !selection.time ? "Escolha um horário" : "Simular pré-reserva";
}

function renderTimes() {
  bookingElements.times.replaceChildren();
  if (!selection.date) {
    bookingElements.availabilityMessage.textContent = "Escolha uma data para ver os horários.";
    return;
  }

  const times = availableTimes(selection.date);
  if (!times.includes(selection.time)) selection.time = null;

  for (const time of times) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `time-button${time === selection.time ? " is-selected" : ""}`;
    button.textContent = time;
    button.dataset.time = time;
    button.setAttribute("aria-pressed", String(time === selection.time));
    bookingElements.times.append(button);
  }
  bookingElements.availabilityMessage.textContent = times.length
    ? "Os horários mostrados comportam todos os serviços e datas selecionados."
    : "Não há horário disponível para esta combinação.";
}

function renderDates() {
  bookingElements.dates.replaceChildren();
  const today = dateKey(new Date());
  const dates = Array.from({ length: 14 }, (_, index) => datePlusDays(today, index))
    .filter(key => availableTimes(key).length > 0);

  if (!dates.includes(selection.date)) {
    selection.date = null;
    selection.time = null;
  }

  for (const key of dates) {
    const date = dateFromKey(key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `date-button${key === selection.date ? " is-selected" : ""}`;
    button.dataset.date = key;
    button.setAttribute("aria-pressed", String(key === selection.date));
    button.setAttribute("aria-label", `Escolher ${formatDate(key)}`);

    const weekday = document.createElement("span");
    weekday.textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
      .format(date).replace(".", "").toUpperCase();
    const day = document.createElement("strong");
    day.textContent = date.getDate();
    button.append(weekday, day);
    bookingElements.dates.append(button);
  }

  if (!dates.length) {
    bookingElements.availabilityMessage.textContent =
      "Nenhuma data disponível nos próximos 14 dias. Tente outro serviço, profissional ou frequência.";
  } else {
    renderTimes();
  }
  renderSummary();
}

bookingElements.services.addEventListener("click", event => {
  const button = event.target.closest("[data-service]");
  if (!button || selection.submitted) return;

  const service = button.dataset.service;
  selection.services = selection.services.includes(service)
    ? selection.services.filter(item => item !== service)
    : [...selection.services, service];
  button.classList.toggle("is-selected", selection.services.includes(service));
  button.setAttribute("aria-pressed", String(selection.services.includes(service)));
  renderDates();
});

bookingElements.professionals.addEventListener("click", event => {
  const button = event.target.closest("[data-professional]");
  if (!button || selection.submitted) return;

  selection.professional = selection.professional === button.dataset.professional
    ? null : button.dataset.professional;
  for (const option of bookingElements.professionals.querySelectorAll("[data-professional]")) {
    const active = option.dataset.professional === selection.professional;
    option.classList.toggle("is-selected", active);
    option.setAttribute("aria-pressed", String(active));
  }
  renderDates();
});

bookingElements.repeat.addEventListener("change", () => {
  if (selection.submitted) return;
  bookingElements.frequencyField.hidden = !bookingElements.repeat.checked;
  selection.frequency = bookingElements.repeat.checked ? bookingElements.frequency.value : "none";
  renderDates();
});

bookingElements.frequency.addEventListener("change", () => {
  if (selection.submitted) return;
  selection.frequency = bookingElements.frequency.value;
  renderDates();
});

bookingElements.dates.addEventListener("click", event => {
  const button = event.target.closest("[data-date]");
  if (!button || selection.submitted) return;
  selection.date = button.dataset.date;
  selection.time = null;
  renderDates();
});

bookingElements.times.addEventListener("click", event => {
  const button = event.target.closest("[data-time]");
  if (!button || selection.submitted) return;
  selection.time = button.dataset.time;
  renderTimes();
  renderSummary();
});

bookingElements.submit.addEventListener("click", () => {
  if (selection.submitted || !selection.date || !selection.time) return;

  const name = bookingElements.customerName.value.trim();
  const phone = bookingElements.customerPhone.value.replace(/\D/g, "");
  if (!name || !/^\d{10,11}$/.test(phone)) {
    bookingElements.feedback.textContent = "Informe um nome e um WhatsApp fictício com DDD.";
    (!name ? bookingElements.customerName : bookingElements.customerPhone).focus();
    return;
  }

  const dates = occurrenceDates(selection.date);
  const start = timeInMinutes(selection.time);
  const duration = selection.services.reduce((total, service) => total + serviceDurations[service], 0);
  const professional = availableProfessional(dates, start, duration);
  if (!professional) {
    bookingElements.feedback.textContent = "O horário deixou de estar disponível nesta demonstração.";
    renderDates();
    return;
  }

  localRequests.push({ professional, dates, start, duration });
  selection.submitted = true;
  bookingElements.feedback.textContent =
    `Pré-reserva simulada para ${dates.length} ${dates.length === 1 ? "data" : "datas"}. ` +
    "Nada foi enviado à barbearia. Não é um agendamento confirmado.";
  renderSummary();
});

renderDates();