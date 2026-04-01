const API_URL = "./payload.json";

const state = {
  payload: null,
  selectedMarket: "all",
  showConstruction: true,
  showCameras: true,
  map: null,
  constructionLayer: null,
  cameraLayer: null,
};

/**
 * UTILS
 */
function escapeHtml(value) {
  if (!value) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * MAP & DATA
 */
function initMap() {
  state.map = L.map("map").setView([36.1699, -115.1398], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(state.map);

  state.constructionLayer = L.layerGroup().addTo(state.map);
  state.cameraLayer = L.layerGroup().addTo(state.map);
}

async function loadPayload() {
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  state.payload = payload;

  renderMeta();
  renderMarketOptions();
  renderCounts();
  renderMap();
}

/**
 * RENDERING UI COMPONENTS
 */
function renderMeta() {
  document.getElementById("service-status").textContent = `Status: ${state.payload.serviceStatus}`;
  document.getElementById("generated-at").textContent = `Generated: ${state.payload.generatedAt}`;
}

function renderMarketOptions() {
  const select = document.getElementById("market-select");
  if (!select) return;

  select.innerHTML = `<option value="all">All markets</option>`;
  state.payload.markets.forEach((market) => {
    const option = document.createElement("option");
    option.value = market.id;
    option.textContent = market.label;
    select.appendChild(option);
  });

  select.value = state.selectedMarket;
}

function getFilteredRecords() {
  const records = state.payload.records || [];
  return records.filter((record) => {
    if (state.selectedMarket !== "all" && record.market !== state.selectedMarket) return false;
    if (record.layerType === "construction" && !state.showConstruction) return false;
    if (record.layerType === "cameras" && !state.showCameras) return false;
    return true;
  });
}

function renderCounts() {
  const records = getFilteredRecords();
  const constructionCount = records.filter(r => r.layerType === "construction").length;
  const cameraCount = records.filter(r => r.layerType === "cameras").length;

  const countEl = document.getElementById("counts");
  if (countEl) {
    countEl.innerHTML = `
      <div class="count-row"><span>Construction</span><span>${constructionCount}</span></div>
      <div class="count-row"><span>Cameras</span><span>${cameraCount}</span></div>
      <div class="count-row"><span>Total</span><span>${records.length}</span></div>
    `;
  }
}

/**
 * RENDERING MAP
 */
function renderMap() {
  state.constructionLayer.clearLayers();
  state.cameraLayer.clearLayers();

  const records = getFilteredRecords();
  const bounds = [];

  records.forEach((record) => {
    if (record.layerType === "construction") {
      const geometry = Array.isArray(record.geometry) ? record.geometry : [];
      // GeoJSON is [lng, lat], Leaflet is [lat, lng]
      const latlngs = geometry
        .filter(pair => Array.isArray(pair) && pair.length >= 2)
        .map(pair => [pair[1], pair[0]]);

      let layer;
      if (latlngs.length > 1) {
        layer = L.polyline(latlngs, { color: "#ef4444", weight: 4 });
        latlngs.forEach(p => bounds.push(p));
      } else if (Number.isFinite(record.lat) && Number.isFinite(record.lng)) {
        layer = L.circleMarker([record.lat, record.lng], {
          radius: 7, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.9,
        });
        bounds.push([record.lat, record.lng]);
      }

      if (layer) {
        layer.on("click", () => renderDetails(record));
        layer.bindPopup(`<strong>${escapeHtml(record.title)}</strong>`);
        layer.addTo(state.constructionLayer);
      }
    } 
    
    else if (record.layerType === "cameras") {
      if (Number.isFinite(record.lat) && Number.isFinite(record.lng)) {
        const marker = L.circleMarker([record.lat, record.lng], {
          radius: 5, color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.9,
        });
        marker.bindPopup(`<strong>${escapeHtml(record.title)}</strong>`);
        marker.addTo(state.cameraLayer);
        bounds.push([record.lat, record.lng]);
      }
    }
  });

  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/**
 * RENDERING SIDEBAR DETAILS
 */
function renderDetails(constructionRecord) {
  const detailsEmpty = document.getElementById("details-empty");
  const detailsContent = document.getElementById("details-content");

  detailsEmpty.classList.add("hidden");
  detailsContent.classList.remove("hidden");

  const cameraLookup = new Map(
    (state.payload.records || [])
      .filter(r => r.layerType === "cameras")
      .map(r => [r.id, r])
  );

  const relationships = Array.isArray(constructionRecord.relationships)
    ? [...constructionRecord.relationships].sort((a, b) => (a.distanceMeters ?? 9999) - (b.distanceMeters ?? 9999))
    : [];

  const cameraCardsHtml = relationships.length
    ? relationships.map(rel => {
        const camera = cameraLookup.get(rel.targetId);
        const title = camera?.title || rel.targetId;
        const locationText = camera?.meta?.locationName || camera?.description || "";
        const imageUrl = camera?.meta?.imageUrl || camera?.imageUrl || "";
        const streamUrl = camera?.meta?.streamUrl || camera?.sourceUrl || "";

        const previewHtml = imageUrl
          ? `<img class="camera-preview" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />`
          : `<div class="camera-preview-empty">No preview available</div>`;

        const linkHtml = streamUrl
          ? `<a class="camera-link" href="${escapeHtml(streamUrl)}" target="_blank">View Live</a>`
          : `<span class="camera-link-disabled">No link</span>`;

        return `
          <div class="camera-card">
            <strong>${escapeHtml(title)}</strong>
            <div style="font-size:0.85em; color: #666;">${escapeHtml(locationText)}</div>
            <div class="distance">${rel.distanceMeters ?? "?"}m away</div>
            <div class="camera-preview-wrap">${previewHtml}</div>
            <div class="camera-actions">${linkHtml}</div>
          </div>
        `;
      }).join("")
    : `<p>No cameras associated with this project.</p>`;

  // Update the sidebar content
  detailsContent.innerHTML = `
    <h3>${escapeHtml(constructionRecord.title)}</h3>
    <p>${escapeHtml(constructionRecord.description || "No description provided.")}</p>
    <hr />
    <h4>Nearby Cameras</h4>
    <div class="camera-list">${cameraCardsHtml}</div>
  `;
}

/**
 * EVENT BINDING
 */
function bindUi() {
  document.getElementById("market-select").addEventListener("change", (e) => {
    state.selectedMarket = e.target.value;
    renderCounts();
    renderMap();
  });

  document.getElementById("toggle-construction").addEventListener("change", (e) => {
    state.showConstruction = e.target.checked;
    renderCounts();
    renderMap();
  });

  document.getElementById("toggle-cameras").addEventListener("change", (e) => {
    state.showCameras = e.target.checked;
    renderCounts();
    renderMap();
  });
}

async function bootstrap() {
  try {
    initMap();
    bindUi();
    await loadPayload();
  } catch (error) {
    const statusEl = document.getElementById("service-status");
    if (statusEl) statusEl.textContent = `Error: ${error.message}`;
    console.error(error);
  }
}

bootstrap();
