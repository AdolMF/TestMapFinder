// ------------------------------------
// RESIZE: hacer el mapa / sidebar redimensionables con el divisor
// ------------------------------------
const mapElement = document.getElementById('map');
const sidebarElement = document.getElementById('sidebar');
const dividerElement = document.getElementById('divider');

let isResizing = false;
let map; // se asignará más abajo con L.map

if (dividerElement && mapElement && sidebarElement) {
  dividerElement.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.classList.add('resizing');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const minMap = 250;                        // ancho mínimo del mapa
    const maxMap = window.innerWidth - 280;    // ancho mínimo para el sidebar

    let newMapWidth = e.clientX;
    if (newMapWidth < minMap) newMapWidth = minMap;
    if (newMapWidth > maxMap) newMapWidth = maxMap;

    mapElement.style.flex = '0 0 ' + newMapWidth + 'px';
    sidebarElement.style.flex = '1 1 auto';

    // Muy importante: avisar a Leaflet de que el tamaño ha cambiado
    if (map) {
      map.invalidateSize();
    }
  });

  window.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.classList.remove('resizing');
  });
}

// ------------------------------------
// ESTADO GLOBAL
// ------------------------------------
let selectedPlaces = [];   // paradas seleccionadas
let plan = [];             // respuesta del LLM
let searchResults = [];    // últimos resultados de búsqueda


// ------------------------------------
// INICIALIZACIÓN DEL MAPA
// ------------------------------------
map = L.map('map').setView([40.4168, -3.7038], 13);

// Asegurarnos de que el mapa se reajusta al cambiar el tamaño de la ventana
window.addEventListener('resize', () => {
  const isMobile = window.innerWidth <= 900;

  if (isMobile) {
    // Limpiar estilos inline que puso el slider en escritorio
    if (mapElement) mapElement.style.flex = '';
    if (sidebarElement) sidebarElement.style.flex = '';
  }

  if (map) {
    map.invalidateSize();
  }
});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);


// ------------------------------------
// ZOOM dinámico según "importance"
// Nominatim suele dar importance entre ~0 y 1 (a veces algo más).
// Cuanto mayor la importance, más alejamos el zoom.
// ------------------------------------
function getZoomFromImportance(importance) {
  const minZoom = 7;   // vista más alejada (países muy importantes)
  const maxZoom = 15;  // vista más cercana (puntos muy concretos)

  if (importance === undefined || importance === null || isNaN(importance)) {
    return 14; // valor por defecto si no sabemos la importance
  }

  // Clampear importance a 0–1.5 por seguridad
  const imp = Math.max(0, Math.min(Number(importance), 1.5));

  // Más importancia → zoom más bajo (más alejado)
  const zoom = maxZoom - imp * (maxZoom - minZoom);

  return Math.round(zoom);
}


// ------------------------------------
// UTILIDADES PARA DETALLES (bonito + JSON)
// ------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function showDetails(title, data) {
  const prettyContainer = document.getElementById('details-pretty');
  const rawContainer = document.getElementById('details-raw');

  if (!prettyContainer || !rawContainer) return;

  // Vista "bonita"
  let html = `<h3>${escapeHtml(title)}</h3><dl>`;

  Object.entries(data).forEach(([key, value]) => {
    if (key === 'raw') return; // evitamos duplicar el raw
    html += `
      <dt>${escapeHtml(key)}</dt>
      <dd>${escapeHtml(formatValue(value))}</dd>
    `;
  });

  html += '</dl>';
  prettyContainer.innerHTML = html;

  // JSON crudo
  rawContainer.textContent = JSON.stringify(data, null, 2);
}


// ------------------------------------
// CLICK EN EL MAPA → REVERSE GEOCODING
// ------------------------------------
map.on('click', async (e) => {
  const { lat, lng } = e.latlng;

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "MiAppViajes/1.0 (tu-email@ejemplo.com)"
      }
    });

    const data = await res.json();

    const place = {
      id: String(data.place_id || `${lat},${lng}`),
      name: data.name || data.display_name || "Ubicación sin nombre",
      lat,
      lon: lng,
      address: data.display_name || "",
      raw: data
    };

    openPlacePopup(place);
  } catch (err) {
    console.error("Error en reverse geocoding:", err);
  }
});


// ------------------------------------
// POPUP DE LUGAR → BOTÓN AÑADIR
// ------------------------------------
function openPlacePopup(place) {
  const popupContent = `
    <div>
      <strong>${escapeHtml(place.name)}</strong><br/>
      <small>${escapeHtml(place.address)}</small><br/>
      <button class="add-place-btn">Añadir a la lista</button>
    </div>
  `;

  const popup = L.popup()
    .setLatLng([place.lat, place.lon])
    .setContent(popupContent);

  popup.on("add", () => {
    const el = popup.getElement();
    if (!el) return;

    const btn = el.querySelector(".add-place-btn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      addPlace(place);
      map.closePopup(popup);
    });
  });

  popup.openOn(map);
}


// ------------------------------------
// AÑADIR PARADA A LA LISTA
// ------------------------------------
function addPlace(place) {
  const normalizedPlace = {
    ...place,
    id: String(place.id)
  };

  if (!selectedPlaces.find(p => String(p.id) === normalizedPlace.id)) {
    selectedPlaces.push(normalizedPlace);
    renderPlacesList();
  } else {
    console.log("Lugar duplicado no añadido:", normalizedPlace.id);
  }
}


// ------------------------------------
// ELIMINAR PARADA
// ------------------------------------
function removePlace(id) {
  const idStr = String(id);
  selectedPlaces = selectedPlaces.filter(p => String(p.id) !== idStr);
  renderPlacesList();
}


// ------------------------------------
// CENTRAR MAPA EN UNA PARADA
// ------------------------------------
function focusOnPlace(place) {
  const importance =
    place?.raw?.importance !== undefined
      ? place.raw.importance
      : place?.importance; // por si algún día se la pasas directa

  const zoom = getZoomFromImportance(importance);

  map.setView([place.lat, place.lon], zoom);

  L.popup()
    .setLatLng([place.lat, place.lon])
    .setContent(`
      <strong>${escapeHtml(place.name)}</strong><br/>
      <small>${escapeHtml(place.address)}</small>
    `)
    .openOn(map);
}


// ------------------------------------
// RENDER DE LA LISTA DE PARADAS
// (click en la card = ver en mapa)
// ------------------------------------
function renderPlacesList() {
  const container = document.getElementById("places-list");
  container.innerHTML = "";

  selectedPlaces.forEach(place => {
    const div = document.createElement("div");
    div.className = "place-item";

    div.innerHTML = `
      <strong>${escapeHtml(place.name)}</strong><br/>
      <small>${escapeHtml(place.address)}</small><br/>
      <button data-id="${place.id}" class="details-btn">Ver detalles</button>
      <button data-id="${place.id}" class="delete-btn">Eliminar</button>
    `;

    // Clic en toda la card → centrar en mapa
    div.addEventListener("click", () => {
      focusOnPlace(place);
    });

    container.appendChild(div);
  });

  // Eventos "Ver detalles"
  container.querySelectorAll(".details-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = String(e.currentTarget.dataset.id);
      const place = selectedPlaces.find(p => String(p.id) === id);
      if (place) {
        showDetails("Parada seleccionada", place);
      }
    });
  });

  // Eventos "Eliminar"
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = String(e.currentTarget.dataset.id);
      removePlace(id);
    });
  });
}


// ------------------------------------
// BUSCADOR (Nominatim Search)
// ------------------------------------
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");

searchBtn.addEventListener("click", () => {
  const query = searchInput.value.trim();
  if (query) searchPlaces(query);
});

// ------------------------------------
// LIMPIAR RESULTADOS DE BÚSQUEDA
// ------------------------------------
const clearSearchBtn = document.getElementById("clear-search-btn");

clearSearchBtn.addEventListener("click", () => {
  document.getElementById("search-input").value = "";
  document.getElementById("search-results").innerHTML = "";

  // Limpia detalles si estaban mostrando un resultado de búsqueda
  document.getElementById("details-pretty").innerHTML = "";
  document.getElementById("details-raw").textContent = "";
});


searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const query = searchInput.value.trim();
    if (query) searchPlaces(query);
  }
});


async function searchPlaces(query) {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "MiAppViajes/1.0 (tu-email@ejemplo.com)"
      }
    });

    const data = await res.json();
    searchResults = data;

    renderSearchResults(data);

    if (data.length > 0) {
      focusSearchResult(data[0]); // Primer resultado automático
    }
  } catch (err) {
    console.error("Error en búsqueda Nominatim:", err);
  }
}


// ------------------------------------
// MOSTRAR RESULTADOS DEL BUSCADOR
// (click en la card = ver en mapa)
// + botón "Añadir a la lista"
// + botón "Ver detalles"
// ------------------------------------
function renderSearchResults(results) {
  const container = document.getElementById("search-results");
  container.innerHTML = "";

  if (!results || results.length === 0) {
    container.innerHTML = "<small>Sin resultados.</small>";
    return;
  }

  results.forEach(r => {
    const div = document.createElement("div");
    div.className = "search-result";

    const name = r.display_name || "Resultado sin nombre";

    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);

    const placeFromSearch = {
      id: String(r.place_id || `${lat},${lon}`),
      name,
      lat,
      lon,
      address: name,
      raw: r
    };

    div.innerHTML = `
      <strong>${escapeHtml(name)}</strong><br/>
      <small>${escapeHtml(r.type || "")} ${r.class ? "(" + escapeHtml(r.class) + ")" : ""}</small><br/>
      <button class="search-add-btn">Añadir a la lista</button>
      <button class="search-details-btn">Ver detalles</button>
    `;

    // Click en la card → ver en mapa
    div.addEventListener("click", () => {
      focusSearchResult(r);
    });

    // Botón "Añadir a la lista"
    const addBtn = div.querySelector('.search-add-btn');
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addPlace(placeFromSearch);
    });

    // Botón "Ver detalles"
    const detailsBtn = div.querySelector('.search-details-btn');
    detailsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showDetails("Resultado de búsqueda", placeFromSearch);
    });

    container.appendChild(div);
  });
}


// ------------------------------------
// FOCALIZAR UN LUGAR DESDE EL BUSCADOR
// ------------------------------------
function focusSearchResult(result) {
  const lat = parseFloat(result.lat);
  const lon = parseFloat(result.lon);

  // Si tiene bounding box (países, ciudades grandes, etc.), mantenemos fitBounds
  if (result.boundingbox) {
    const [south, north, west, east] = result.boundingbox.map(parseFloat);
    const bounds = L.latLngBounds([south, west], [north, east]);
    map.fitBounds(bounds);
  } else {
    const zoom = getZoomFromImportance(result.importance);
    map.setView([lat, lon], zoom);
  }

  const place = {
    id: String(result.place_id || `${lat},${lon}`),
    name: result.display_name || "Ubicación sin nombre",
    lat,
    lon,
    address: result.display_name || "",
    raw: result
  };

  openPlacePopup(place);
}


// ------------------------------------
// ENVIAR LISTA AL BACKEND DEL LLM
// ------------------------------------
document.getElementById("generate-plan-btn").addEventListener("click", async () => {
  if (selectedPlaces.length === 0) {
    alert("Selecciona al menos un lugar.");
    return;
  }

  try {
    const res = await fetch("/api/travel-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ places: selectedPlaces })
    });

    if (!res.ok) throw new Error("Error en backend");

    plan = await res.json();
    renderPlan();

  } catch (err) {
    console.error("Error generando plan:", err);
    alert("Hubo un error generando el plan.");
  }
});


// ------------------------------------
// MOSTRAR PLAN DEL LLM
// (click en la card = ver en mapa)
// ------------------------------------
function renderPlan() {
  const container = document.getElementById("plan-list");
  container.innerHTML = "";

  plan.forEach(item => {
    const div = document.createElement("div");
    div.className = "plan-item";

    div.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong><br/>
      <small>${escapeHtml(item.address || "")}</small><br/>
      💰 Presupuesto estimado: ${escapeHtml(item.recommended_budget)} ${escapeHtml(item.currency || "EUR")}<br/>
      ⏱ Tiempo estimado: ${escapeHtml(item.recommended_time_minutes)} min<br/>
      <button class="plan-details-btn">Ver detalles</button>
    `;

    // Clic en la card → centrar mapa + popup
    div.addEventListener("click", () => {
      map.setView([item.lat, item.lon], 16);

      L.popup()
        .setLatLng([item.lat, item.lon])
        .setContent(`
          <strong>${escapeHtml(item.name)}</strong><br/>
          <small>${escapeHtml(item.address || "")}</small><br/>
          💰 ${escapeHtml(item.recommended_budget)} ${escapeHtml(item.currency || "EUR")}<br/>
          ⏱ ${escapeHtml(item.recommended_time_minutes)} min
        `)
        .openOn(map);
    });

    // Botón "Ver detalles" → solo detalles, sin mover mapa
    const detailsBtn = div.querySelector('.plan-details-btn');
    detailsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showDetails("Elemento del plan", item);
    });

    container.appendChild(div);
  });
}
