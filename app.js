const API_URL =
  "./payload.json";

const state = {
  payload: null,
  selectedMarket: "all",
  showConstruction: true,
  showCameras: true,
  map: null,
  constructionLayer: null,
  cameraLayer: null,
};

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

function renderMeta() {
  document.getElementById("service-status").textContent =
    `Status: ${state.payload.serviceStatus}`;
  document.getElementById("generated-at").textContent =
    `Generated: ${state.payload.generatedAt}`;
}

function renderMarketOptions() {
  const select = document.getElementById("market-select");
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
    if (state.selectedMarket !== "all" && record.market !== state.selectedMarket) {
      return false;
    }

    if (record.layerType === "construction" && !state.showConstruction) {
      return false;
    }

    if (record.layerType === "cameras" && !state.showCameras) {
      return false;
    }

    return true;
  });
}

function renderCounts() {
  const records = getFilteredRecords();
  const constructionCount = records.filter(r => r.layerType === "construction").length;
  const cameraCount = records.filter(r => r.layerType === "cameras").length;

  document.getElementById("counts").innerHTML = `
    <div class="count-row"><span>Construction</span><span>${constructionCount}</span></div>
    <div class="count-row"><span>Cameras</span><span>${cameraCount}</span></div>
    <div class="count-row"><span>Total</span><span>${records.length}</span></div>
  `;
}

function renderMap() {
  state.constructionLayer.clearLayers();
  state.cameraLayer.clearLayers();

  const records = getFilteredRecords();
  const constructionRecords = records.filter(r => r.layerType === "construction");
  const cameraRecords = records.filter(r => r.layerType === "cameras");

  const bounds = [];

  constructionRecords.forEach((record) => {
    const geometry = Array.isArray(record.geometry) ? record.geometry : [];
    const latlngs = geometry
      .filter(pair => Array.isArray(pair) && pair.length >= 2)
      .map(pair => [pair[1], pair[0]]);

    if (latlngs.length > 1) {
      const polyline = L.polyline(latlngs, {
        color: "#ef4444",
        weight: 4,
      });

      polyline.on("click", () => renderDetails(record));
      polyline.bindPopup(`<strong>${escapeHtml(record.title)}</strong>`);
      polyline.addTo(state.constructionLayer);

      latlngs.forEach(p => bounds.push(p));
    } else if (Number.isFinite(record.lat) && Number.isFinite(record.lng)) {
      const marker = L.circleMarker([record.lat, record.lng], {
        radius: 7,
        color: "#ef4444",
        fillColor: "#ef4444",
        fillOpacity: 0.9,
      });

      marker.on("click", () => renderDetails(record));
      marker.bindPopup(`<strong>${escapeHtml(record.title)}</strong>`);
      marker.addTo(state.constructionLayer);

      bounds.push([record.lat, record.lng]);
    }
  });

  cameraRecords.forEach((record) => {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lng)) return;

    const marker = L.circleMarker([record.lat, record.lng], {
      radius: 5,
      color: "#3b82f6",
      fillColor: "#3b82f6",
      fillOpacity: 0.9,
    });

    marker.bindPopup(`<strong>${escapeHtml(record.title)}</strong>`);
    marker.addTo(state.cameraLayer);

    bounds.push([record.lat, record.lng]);
  });

  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [30, 30] });
  }
}

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
    ? [...constructionRecord.relationships].sort((a, b) => {
        const da = Number.isFinite(a.distanceMeters) ? a.distanceMeters : 999999;
        const db = Number.isFinite(b.distanceMeters) ? b.distanceMeters : 999999;
        return da - db;
      })
    : [];

const candidateHtml = relationships.length
    ? relationships.map(rel => {
        const camera = cameraLookup.get(rel.targetId);
        const title = camera?.title || rel.targetId;
        const locationText =
          camera?.meta?.locationName ||
          camera?.meta?.location ||
          camera?.description ||
          "";

        const imageUrl =
          camera?.meta?.imageUrl ||
          camera?.meta?.screenshotAddress ||
          camera?.imageUrl ||
          "";

        const streamUrl =
          camera?.meta?.streamUrl ||
          camera?.streamUrl ||
          "";

        const sourceUrl =
          camera?.sourceUrl || "";

        const previewHtml = imageUrl
          ? `<img class="camera-preview" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)} preview" />`
          : `<div class="camera-preview-empty">No preview available</div>`;

        const linkHtml = streamUrl
          ? `<a class="camera-link" href="${escapeHtml(streamUrl)}" target="_blank" rel="noopener noreferrer">Open stream</a>`
          : sourceUrl
            ? `<a class="camera-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>`
            : `<span class="camera-link-disabled">No live link</span>`;

        return `
          <div class="camera-card">
            <div><strong>${escapeHtml(title)}</strong></div>
            <div>${escapeHtml(locationText)}</div>
            <div class="distance">
              ${escapeHtml(rel.confidence || "candidate")} · ${rel.distanceMeters ?? "?"}m
            </div>
            <div class="camera-preview-wrap">
              ${previewHtml}
            </div>
            <div class="camera-actions">
              ${linkHtml}
            </div>
          </div>
        `;
      }).join("")
    : `<div class="detail-meta">No candidate cameras attached.</div>`;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindUi() {
  document.getElementById("market-select").addEventListener("change", (event) => {
    state.selectedMarket = event.target.value;
    renderCounts();
    renderMap();
  });

  document.getElementById("toggle-construction").addEventListener("change", (event) => {
    state.showConstruction = event.target.checked;
    renderCounts();
    renderMap();
  });

  document.getElementById("toggle-cameras").addEventListener("change", (event) => {
    state.showCameras = event.target.checked;
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
    document.getElementById("service-status").textContent = `Error: ${error.message}`;
    console.error(error);
  }
}

bootstrap();
