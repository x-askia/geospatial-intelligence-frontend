const API_URL = "./payload.json";

const state = {
  payload: null,
  selectedMarket: "all",
  showConstruction: true,
  showCameras: true,
  selectedConstructionId: null,
  selectedCameraId: null,
  map: null,
  constructionLayer: null,
  cameraLayer: null,
};

/**
 * UTILITIES
 */
function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metersBetweenFrontend(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = deg => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * DATA HELPERS
 */
function getSelectedConstruction() {
  if (!state.payload || !state.selectedConstructionId) return null;
  return (state.payload.records || []).find(
    r => r.layerType === "construction" && r.id === state.selectedConstructionId
  ) || null;
}

function getSelectedCamera() {
  if (!state.payload || !state.selectedCameraId) return null;
  return (state.payload.records || []).find(
    r => r.layerType === "cameras" && r.id === state.selectedCameraId
  ) || null;
}

function getCameraLookup() {
  return new Map(
    (state.payload?.records || [])
      .filter(r => r.layerType === "cameras")
      .map(r => [r.id, r])
  );
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

function getConstructionAnchor(record) {
  if (Number.isFinite(record?.lat) && Number.isFinite(record?.lng)) {
    return { lat: record.lat, lng: record.lng };
  }

  const geometry = Array.isArray(record?.geometry) ? record.geometry : [];
  if (geometry.length > 0 && Array.isArray(geometry[0]) && geometry[0].length >= 2) {
    return { lat: Number(geometry[0][1]), lng: Number(geometry[0][0]) };
  }

  return null;
}

function getSuggestedCameraRecords(constructionRecord) {
  const cameraLookup = getCameraLookup();
  const relationships = Array.isArray(constructionRecord?.relationships)
    ? [...constructionRecord.relationships]
        .filter(rel => rel.targetLayer === "cameras")
        .sort((a, b) => (a.distanceMeters ?? 999999) - (b.distanceMeters ?? 999999))
    : [];

  return relationships.map(rel => ({
    relationship: rel,
    camera: cameraLookup.get(rel.targetId)
  })).filter(item => item.camera);
}

function getOtherNearbyCameraRecords(constructionRecord, radiusMeters = 250) {
  if (!state.payload || !constructionRecord) return [];

  const anchor = getConstructionAnchor(constructionRecord);
  if (!anchor) return [];

  const suggestedIds = new Set(
    (constructionRecord.relationships || [])
      .filter(rel => rel.targetLayer === "cameras")
      .map(rel => rel.targetId)
  );

  return (state.payload.records || [])
    .filter(r => r.layerType === "cameras")
    .filter(r => r.market === constructionRecord.market)
    .filter(r => !suggestedIds.has(r.id))
    .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .map(camera => ({
      camera,
      distanceMeters: Math.round(
        metersBetweenFrontend(anchor.lat, anchor.lng, camera.lat, camera.lng)
      )
    }))
    .filter(item => item.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/**
 * INTERACTION HANDLERS
 */
function selectConstruction(record) {
  state.selectedConstructionId = record.id;
  state.selectedCameraId = null;
  renderDetails();
}

function selectCamera(record) {
  state.selectedCameraId = record.id;
  renderDetails();
}

/**
 * MAP INITIALIZATION & RENDERING
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

function renderMap() {
  state.constructionLayer.clearLayers();
  state.cameraLayer.clearLayers();

  const records = getFilteredRecords();
  const constructionRecords = records.filter(r => r.layerType === "construction");
  const cameraRecords = records.filter(r => r.layerType === "cameras");

  const bounds = [];

  // Render Construction
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

      polyline.on("click", () => selectConstruction(record));
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

      marker.on("click", () => selectConstruction(record));
      marker.bindPopup(`<strong>${escapeHtml(record.title)}</strong>`);
      marker.addTo(state.constructionLayer);

      bounds.push([record.lat, record.lng]);
    }
  });

  // Render Cameras
  cameraRecords.forEach((record) => {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lng)) return;

    const marker = L.circleMarker([record.lat, record.lng], {
      radius: 5,
      color: "#3b82f6",
      fillColor: "#3b82f6",
      fillOpacity: 0.9,
    });

    marker.on("click", () => selectCamera(record));
    marker.bindPopup(`<strong>${escapeHtml(record.title)}</strong>`);
    marker.addTo(state.cameraLayer);
    bounds.push([record.lat, record.lng]);
  });

  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/**
 * UI RENDERING
 */
function renderMeta() {
  const statusEl = document.getElementById("service-status");
  const genAtEl = document.getElementById("generated-at");
  if (statusEl) statusEl.textContent = `Status: ${state.payload.serviceStatus}`;
  if (genAtEl) genAtEl.textContent = `Generated: ${state.payload.generatedAt}`;
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

function renderCounts() {
  const records = getFilteredRecords();
  const constructionCount = records.filter(r => r.layerType === "construction").length;
  const cameraCount = records.filter(r => r.layerType === "cameras").length;

  const countsEl = document.getElementById("counts");
  if (countsEl) {
    countsEl.innerHTML = `
      <div class="count-row"><span>Construction</span><span>${constructionCount}</span></div>
      <div class="count-row"><span>Cameras</span><span>${cameraCount}</span></div>
      <div class="count-row"><span>Total</span><span>${records.length}</span></div>
    `;
  }
}

function renderCollapsibleMeta(title, obj, sectionId) {
  const pretty = escapeHtml(JSON.stringify(obj || {}, null, 2));

  return `
    <div class="detail-block collapsible-block">
      <button class="collapse-toggle" data-target="${sectionId}">
        <span class="caret"></span>
        <span>${escapeHtml(title)}</span>
      </button>
      <div id="${sectionId}" class="collapse-content hidden">
        <div class="detail-pre">${pretty}</div>
      </div>
    </div>
  `;
}

function renderCameraCard(camera, distanceMeters, confidence, isSuggested) {
  const title = camera?.title || camera?.id || "Unknown Camera";
  const locationText = camera?.meta?.locationName || camera?.meta?.primaryStreet || camera?.description || "";
  const imageUrl = camera?.meta?.imageUrl || camera?.meta?.screenshotAddress || camera?.imageUrl || "";
  const streamUrl = camera?.meta?.streamUrl || camera?.streamUrl || "";
  const isAustin = camera?.market === "austin";

  const previewHtml = imageUrl
    ? `<img class="camera-preview" src="${imageUrl}" alt="${escapeHtml(title)} preview" />`
    : `<div class="camera-preview-empty">${isAustin ? "Austin preview requires auth or is unavailable." : "No preview available."}</div>`;

  return `
    <div class="camera-card">
      <div><strong>${escapeHtml(title)}</strong></div>
      <div class="camera-location">${escapeHtml(locationText)}</div>
      <div class="distance">${escapeHtml(String(confidence))} · ${distanceMeters ?? "?"}m ${isSuggested ? "· suggested" : "· nearby"}</div>
      <div class="camera-preview-wrap">${previewHtml}</div>
      <div class="camera-actions">
        <button class="camera-select-button" data-camera-id="${escapeHtml(camera.id)}">Focus camera</button>
        ${imageUrl
          ? `<a class="camera-link" href="${imageUrl}" target="_blank" rel="noopener noreferrer">Open still frame</a>`
          : ``
        }
        ${streamUrl
          ? `<a class="camera-link" href="${streamUrl}" target="_blank" rel="noopener noreferrer">Open stream</a>`
          : `<span class="camera-link-disabled">${isAustin ? "Still frame only" : "No live link"}</span>`
        }
      </div>
    </div>
  `;
}

function renderFocusedCamera(camera) {
  const imageUrl = camera?.meta?.imageUrl || camera?.meta?.screenshotAddress || camera?.imageUrl || "";
  const streamUrl = camera?.meta?.streamUrl || camera?.streamUrl || "";
  const isAustin = camera?.market === "austin";

  return `
    <div class="camera-card focused-camera">
      <div><strong>${escapeHtml(camera.title || camera.id)}</strong></div>
      <div class="camera-location">${escapeHtml(camera.description || "")}</div>
      ${renderCollapsibleMeta("Camera Metadata", camera.meta || {}, `camera-meta-${camera.id}`)}
      <div class="camera-preview-wrap">
        ${imageUrl
          ? `<img class="camera-preview" src="${imageUrl}" alt="${escapeHtml(camera.title || camera.id)} preview" />`
          : `<div class="camera-preview-empty">${isAustin ? "Austin preview requires auth or is unavailable." : "No preview available."}</div>`
        }
      </div>
      <div class="camera-actions">
        ${imageUrl
          ? `<a class="camera-link" href="${imageUrl}" target="_blank" rel="noopener noreferrer">Open still frame</a>`
          : ``
        }
        ${streamUrl
          ? `<a class="camera-link" href="${streamUrl}" target="_blank" rel="noopener noreferrer">Open stream</a>`
          : `<span class="camera-link-disabled">${isAustin ? "Still frame only" : "No live link"}</span>`
        }
      </div>
    </div>
  `;
}

function renderDetails() {
  const detailsEmpty = document.getElementById("details-empty");
  const detailsContent = document.getElementById("details-content");
  if (!detailsEmpty || !detailsContent) return;

  const constructionRecord = getSelectedConstruction();
  const selectedCamera = getSelectedCamera();

  if (!constructionRecord) {
    detailsEmpty.classList.remove("hidden");
    detailsContent.classList.add("hidden");
    detailsContent.innerHTML = "";
    return;
  }

  detailsEmpty.classList.add("hidden");
  detailsContent.classList.remove("hidden");

  const selectedCameraId = selectedCamera ? selectedCamera.id : null;

  const suggested = getSuggestedCameraRecords(constructionRecord)
    .filter(item => item.camera && item.camera.id !== selectedCameraId);

  const nearby = getOtherNearbyCameraRecords(constructionRecord, 250)
    .filter(item => item.camera && item.camera.id !== selectedCameraId);

  const suggestedHtml = suggested.length
    ? suggested.map(({ relationship, camera }) => renderCameraCard(camera, relationship.distanceMeters, relationship.confidence, true)).join("")
    : `<div class="detail-meta">No suggested cameras attached.</div>`;

  const nearbyHtml = nearby.length
    ? nearby.map(({ camera, distanceMeters }) => renderCameraCard(camera, distanceMeters, "nearby", false)).join("")
    : `<div class="detail-meta">No additional nearby cameras found.</div>`;

  const selectedCameraHtml = selectedCamera
    ? `
      <div class="detail-block">
        <h3>Selected Camera</h3>
        ${renderFocusedCamera(selectedCamera)}
      </div>
    `
    : "";

  const analystNotesHtml = `
    <div class="detail-block">
      <h3>Analyst Notes</h3>
      <div class="detail-pre">Deferred for now until a real public write backend exists.</div>
    </div>
  `;

  detailsContent.innerHTML = `
    <h2 class="detail-title">${escapeHtml(constructionRecord.title)}</h2>
    <div class="detail-meta">
      ${escapeHtml(constructionRecord.market)} · ${escapeHtml(constructionRecord.status || "unknown")}
    </div>

    <div class="detail-block">
      <h3>Dates</h3>
      <div class="detail-pre">Start: ${escapeHtml(constructionRecord.startTime || "N/A")}
End: ${escapeHtml(constructionRecord.endTime || "N/A")}</div>
    </div>

    <div class="detail-block">
      <h3>Description</h3>
      <div class="detail-pre">${escapeHtml(constructionRecord.description || "")}</div>
    </div>

    ${renderCollapsibleMeta(
      "Source / Metadata",
      {
        sourceName: constructionRecord.sourceName || "N/A",
        sourceSystem: constructionRecord.sourceSystem || "N/A",
        sourceUrl: constructionRecord.sourceUrl || "N/A",
        sourceRecordId: constructionRecord.sourceRecordId || "N/A"
      },
      `construction-source-${constructionRecord.id}`
    )}

    ${renderCollapsibleMeta("Construction Details Metadata", constructionRecord.meta || {}, `construction-meta-${constructionRecord.id}`)}

    ${analystNotesHtml}
    ${selectedCameraHtml}

    <div class="detail-block">
      <h3>Suggested Cameras</h3>
      ${suggestedHtml}
    </div>

    <div class="detail-block">
      <h3>Other Nearby Cameras</h3>
      ${nearbyHtml}
    </div>
  `;

  // Bind click events for the newly injected camera buttons
  detailsContent.querySelectorAll(".camera-select-button").forEach(btn => {
    btn.addEventListener("click", () => {
      const cameraId = btn.getAttribute("data-camera-id");
      const camera = (state.payload.records || []).find(
        r => r.layerType === "cameras" && r.id === cameraId
      );
      if (camera) {
        selectCamera(camera);
      }
    });
  });

  // Bind click events for the collapsible meta blocks
  detailsContent.querySelectorAll(".collapse-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const target = document.getElementById(targetId);
      const caret = btn.querySelector(".caret");

      if (!target) return;

      target.classList.toggle("hidden");
      caret.textContent = target.classList.contains("hidden") ? "" : "▼";
    });
  });
}

function bindUi() {
  const marketSelect = document.getElementById("market-select");
  if (marketSelect) {
    marketSelect.addEventListener("change", (event) => {
      state.selectedMarket = event.target.value;
      renderCounts();
      renderMap();
    });
  }

  const toggleConstruction = document.getElementById("toggle-construction");
  if (toggleConstruction) {
    toggleConstruction.addEventListener("change", (event) => {
      state.showConstruction = event.target.checked;
      renderCounts();
      renderMap();
    });
  }

  const toggleCameras = document.getElementById("toggle-cameras");
  if (toggleCameras) {
    toggleCameras.addEventListener("change", (event) => {
      state.showCameras = event.target.checked;
      renderCounts();
      renderMap();
    });
  }
}

/**
 * BOOTSTRAP
 */
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

async function bootstrap() {
  try {
    initMap();
    bindUi();
    await loadPayload();
  } catch (error) {
    const statusEl = document.getElementById("service-status");
    if (statusEl) {
      statusEl.textContent = `Error: ${error.message}`;
    }
    console.error(error);
  }
}

bootstrap();
