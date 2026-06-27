const DATA_URL = "data/creatures.csv";

const state = {
  creatures: [],
  filtered: [],
  selectedId: null,
  region: "All",
};

const listEl = document.querySelector("#creature-list");
const cardEl = document.querySelector("#card");
const countEl = document.querySelector("#entry-count");
const regionButtons = document.querySelectorAll(".region-button");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])),
  );
}

function toStats(creature) {
  return [
    ["Charm", creature.stat_charm],
    ["Mystic", creature.stat_mystic],
    ["Courage", creature.stat_courage],
    ["Chaos", creature.stat_chaos],
  ].map(([label, rawValue]) => ({
    label,
    value: Math.max(0, Math.min(100, Number(rawValue) || 0)),
  }));
}

function applyRegion(region) {
  state.region = region;
  state.filtered =
    region === "All"
      ? [...state.creatures]
      : state.creatures.filter((creature) => creature.region === region);

  if (!state.filtered.some((creature) => creature.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
  }

  regionButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.region === region);
  });

  render();
}

function selectCreature(id) {
  state.selectedId = id;
  render();
}

function renderList() {
  countEl.textContent = state.filtered.length;
  listEl.innerHTML = state.filtered
    .map(
      (creature) => `
        <button class="entry-button ${creature.id === state.selectedId ? "active" : ""}" type="button" data-id="${creature.id}">
          <img class="entry-thumb" src="${creature.image}" alt="">
          <span>
            <span class="entry-name">${creature.name_en}</span>
            <span class="entry-region">${creature.region}</span>
          </span>
        </button>
      `,
    )
    .join("");

  listEl.querySelectorAll(".entry-button").forEach((button) => {
    button.addEventListener("click", () => selectCreature(button.dataset.id));
  });
}

function renderCard() {
  const creature = state.filtered.find((entry) => entry.id === state.selectedId);

  if (!creature) {
    cardEl.innerHTML = '<p class="empty">No legends found in this region yet.</p>';
    return;
  }

  const powers = [creature.power_1, creature.power_2, creature.power_3].filter(Boolean);
  const stats = toStats(creature);

  cardEl.innerHTML = `
    <div class="card-top">
      <div class="art-panel">
        <img class="creature-art" src="${creature.image}" alt="${creature.name_en}">
      </div>
      <div class="card-title">
        <span class="number">MY-${creature.number}</span>
        <h2>${creature.name_en}</h2>
        <p class="thai-name">${creature.name_th}</p>
        <div class="chips">
          <span class="chip">${creature.region}</span>
          <span class="chip">${creature.type}</span>
          <span class="chip">${creature.element}</span>
        </div>
      </div>
    </div>

    <div class="card-body">
      <section class="info-panel">
        <h3 class="section-title">Origin story</h3>
        <p class="story">${creature.origin_story}</p>
        <div class="fact-grid">
          <div class="fact">
            <span>Home turf</span>
            <strong>${creature.locality}</strong>
          </div>
          <div class="fact">
            <span>Lore age</span>
            <strong>${creature.lore_age}</strong>
          </div>
          <div class="fact">
            <span>First spotted in</span>
            <strong>${creature.source}</strong>
          </div>
          <div class="fact">
            <span>Card vibe</span>
            <strong>${creature.cute_note}</strong>
          </div>
        </div>
      </section>

      <section class="power-panel">
        <h3 class="section-title">Signature powers</h3>
        <div class="power-list">
          ${powers
            .map(
              (power, index) => `
                <div class="power">
                  <span class="power-mark">${index + 1}</span>
                  <span>${power}</span>
                </div>
              `,
            )
            .join("")}
        </div>

        <h3 class="section-title">Folklore stats</h3>
        <div class="stats">
          ${stats
            .map(
              (stat) => `
                <div class="stat-row">
                  <span class="stat-label">${stat.label}</span>
                  <span class="stat-track"><span class="stat-fill" style="width: ${stat.value}%"></span></span>
                  <span class="stat-value">${stat.value}</span>
                </div>
              `,
            )
            .join("")}
        </div>
        <p class="cute-note">${creature.dex_note}</p>
      </section>
    </div>
  `;
}

function render() {
  renderList();
  renderCard();
}

regionButtons.forEach((button) => {
  button.addEventListener("click", () => applyRegion(button.dataset.region));
});

fetch(DATA_URL)
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Could not load ${DATA_URL}`);
    }
    return response.text();
  })
  .then((csv) => {
    state.creatures = parseCsv(csv);
    state.selectedId = state.creatures[0]?.id || null;
    applyRegion("All");
  })
  .catch((error) => {
    cardEl.innerHTML = `<p class="empty">${error.message}</p>`;
  });
