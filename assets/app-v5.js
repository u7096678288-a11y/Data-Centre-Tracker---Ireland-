const SERVICE = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const IRELAND_BOUNDS = L.latLngBounds([[51.15, -11.15], [55.65, -5.15]]);
const START_DATE = Date.UTC(2016, 0, 1);
const END_DATE = Date.UTC(2027, 0, 1);

const map = L.map('map', {
  maxBounds: IRELAND_BOUNDS,
  maxBoundsViscosity: 1,
  minZoom: 6,
  maxZoom: 16,
  zoomSnap: 0.25,
  worldCopyJump: false
}).setView([53.35, -8.05], 6.5);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  noWrap: true,
  minZoom: 6,
  maxZoom: 18
}).addTo(map);

const PRIMARY_TERMS = ['data centre', 'data center', 'datacentre', 'datacenter'];
const SECONDARY_TERMS = [
  'data-centre', 'data-center', 'data centres', 'data centers',
  'data hall', 'server hall', 'server farm', 'hyperscale',
  'colocation', 'co-location', 'cloud computing', 'compute campus',
  'digital infrastructure', 'data storage', 'data processing facility',
  'server room', 'ICT facility', 'information technology facility',
  'computer facility', 'mission critical facility'
];

const DIRECT_PATTERNS = [
  /\bdata[\s-]*cent(?:re|er)s?\b/i,
  /\bdata halls?\b/i,
  /\bserver halls?\b/i,
  /\bserver farms?\b/i,
  /\bhyperscale\b/i,
  /\bco-?location\b/i,
  /\bcloud computing\b/i,
  /\bcompute campus\b/i,
  /\bdigital infrastructure\b/i,
  /\bdata storage\b/i,
  /\bdata processing facilit(?:y|ies)\b/i,
  /\bmission critical facilit(?:y|ies)\b/i
];

const TECHNICAL_PATTERNS = [
  /\bserver rooms?\b/i,
  /\bICT facilit(?:y|ies)\b/i,
  /\binformation technology facilit(?:y|ies)\b/i,
  /\bcomputer facilit(?:y|ies)\b/i
];

const SUPPORT_PATTERNS = [
  /\bgenerators?\b/i,
  /\bsub-?stations?\b/i,
  /\btransformers?\b/i,
  /\bcooling\b/i,
  /\bchillers?\b/i,
  /\bswitch\s*rooms?\b/i,
  /\benergy cent(?:re|er)\b/i,
  /\bcampus\b/i,
  /\bdata halls?\b/i
];

const OUT_FIELDS = [
  'OBJECTID', 'PlanningAuthority', 'ApplicationNumber', 'DevelopmentDescription',
  'DevelopmentAddress', 'ApplicationStatus', 'ApplicationType',
  'ApplicantForename', 'ApplicantSurname', 'Decision', 'ReceivedDate',
  'DecisionDate', 'GrantDate', 'ExpiryDate', 'AppealRefNumber', 'AppealStatus',
  'AppealDecision', 'AppealDecisionDate', 'AppealSubmittedDate',
  'FIRequestDate', 'FIRecDate', 'FloorArea', 'AreaofSite', 'LinkAppDetails'
].join(',');

let data = [];
let layer;
let statusChart;
let authorityChart;
let jsonpCounter = 0;
let loadedIds = new Set();
const records = new Map();

const props = feature => feature.properties || {};
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLowerCase();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function setStatus(message) {
  document.querySelector('#updated').textContent = message;
}

function setControlsDisabled(disabled) {
  ['search', 'status', 'authority', 'download'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = disabled;
  });
}

function arcgisJsonp(params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const callbackName = `__irish_dc_${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      script.remove();
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      callback(value);
    };

    const timer = window.setTimeout(() => {
      finish(reject, new Error('Planning service request timed out.'));
    }, timeoutMs);

    window[callbackName] = response => {
      if (response?.error) {
        finish(reject, new Error(response.error.message || 'ArcGIS query error'));
      } else {
        finish(resolve, response);
      }
    };

    const query = new URLSearchParams({ ...params, f: 'json', callback: callbackName });
    script.src = `${SERVICE}?${query.toString()}`;
    script.async = true;
    script.onerror = () => finish(reject, new Error('Planning service could not be reached.'));
    document.head.appendChild(script);
  });
}

function titleCase(value) {
  return value.replace(/\b\w/g, character => character.toUpperCase());
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

async function queryTermIds(term) {
  const variants = [...new Set([term.toLowerCase(), term.toUpperCase(), titleCase(term)])];
  const where = variants
    .map(variant => `DevelopmentDescription LIKE '%${sqlEscape(variant)}%'`)
    .join(' OR ');
  const response = await arcgisJsonp({ where, returnIdsOnly: 'true' });
  return response.objectIds || [];
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchFeatureBatch(ids) {
  const response = await arcgisJsonp({
    objectIds: ids.join(','),
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326'
  }, 18000);

  return (response.features || []).flatMap(feature => {
    const geometry = feature.geometry;
    if (!geometry || !Number.isFinite(Number(geometry.x)) || !Number.isFinite(Number(geometry.y))) return [];
    return [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(geometry.x), Number(geometry.y)] },
      properties: feature.attributes || {}
    }];
  });
}

async function fetchNewFeatures(ids) {
  const unseen = [...new Set(ids)].filter(id => !loadedIds.has(id));
  unseen.forEach(id => loadedIds.add(id));
  const batches = chunks(unseen, 80);
  const features = [];

  for (const group of chunks(batches, 3)) {
    const settled = await Promise.allSettled(group.map(batch => fetchFeatureBatch(batch)));
    settled.forEach(result => {
      if (result.status === 'fulfilled') features.push(...result.value);
      else console.warn(result.reason);
    });
  }
  return features;
}

function featureTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRelevantDescription(description) {
  const text = clean(description);
  if (DIRECT_PATTERNS.some(pattern => pattern.test(text))) return true;
  const technical = TECHNICAL_PATTERNS.some(pattern => pattern.test(text));
  const supportCount = SUPPORT_PATTERNS.filter(pattern => pattern.test(text)).length;
  return technical && supportCount >= 2;
}

function hasIrishPointGeometry(feature) {
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) return false;
  const [longitude, latitude] = coordinates.map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) &&
    IRELAND_BOUNDS.contains(L.latLng(latitude, longitude));
}

function normaliseDate(value) {
  const timestamp = featureTimestamp(value);
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('en-IE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function planningStatus(value) {
  const text = lower(value);
  if (text.includes('grant') || text.includes('conditional') || text.includes('unconditional') || text.includes('approval')) return 'Granted';
  if (text.includes('refus')) return 'Refused';
  if (text.includes('withdraw')) return 'Withdrawn';
  if (text.includes('invalid')) return 'Invalid';
  return 'Pending / other';
}

function normaliseFeature(feature) {
  if (!hasIrishPointGeometry(feature)) return null;
  const raw = feature.properties || {};
  const receivedTimestamp = featureTimestamp(raw.ReceivedDate);
  if (receivedTimestamp < START_DATE || receivedTimestamp >= END_DATE) return null;

  const description = clean(raw.DevelopmentDescription);
  if (!isRelevantDescription(description)) return null;

  const authority = clean(raw.PlanningAuthority);
  const applicationNumber = clean(raw.ApplicationNumber);
  const applicant = clean([raw.ApplicantForename, raw.ApplicantSurname].filter(Boolean).join(' '));
  const decision = clean(raw.Decision || raw.ApplicationStatus);

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      key: `${authority.toUpperCase()}|${applicationNumber.toUpperCase()}`,
      object_id: raw.OBJECTID,
      project_name: clean(raw.DevelopmentAddress) || applicationNumber,
      planning_authority: authority,
      application_number: applicationNumber,
      description,
      address: clean(raw.DevelopmentAddress),
      applicant,
      received_timestamp: receivedTimestamp,
      received_date: normaliseDate(raw.ReceivedDate),
      decision,
      status_group: planningStatus(decision),
      appeal: clean(raw.AppealRefNumber),
      source_url: clean(raw.LinkAppDetails)
    }
  };
}

function addFeatures(features) {
  features.forEach(feature => {
    const item = normaliseFeature(feature);
    if (!item) return;
    const itemProps = props(item);
    const key = itemProps.key && itemProps.key !== '|' ? itemProps.key : `OBJECTID|${itemProps.object_id}`;
    if (!records.has(key)) records.set(key, item);
  });

  data = [...records.values()].sort((a, b) =>
    (props(b).received_timestamp || 0) - (props(a).received_timestamp || 0)
  );
}

function filtered() {
  const query = lower(document.getElementById('search').value);
  const authority = document.getElementById('authority').value;
  const selectedStatus = document.getElementById('status').value;
  return data.filter(feature => {
    const item = props(feature);
    return (!query || JSON.stringify(item).toLowerCase().includes(query)) &&
      (!authority || item.planning_authority === authority) &&
      (!selectedStatus || item.status_group === selectedStatus);
  });
}

function pinIcon(status) {
  const className = status === 'Granted' ? 'pin-granted' :
    status === 'Pending / other' ? 'pin-pending' :
      status === 'Withdrawn' ? 'pin-withdrawn' : 'pin-refused';
  return L.divIcon({
    className: 'map-pin-wrapper',
    html: `<span class="map-pin ${className}"></span>`,
    iconSize: [20, 28],
    iconAnchor: [10, 27],
    popupAnchor: [0, -25]
  });
}

function excerpt(value, maxLength = 260) {
  const text = clean(value);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > 170 ? lastSpace : maxLength)}…`;
}

function renderMarkers() {
  const selected = filtered();
  if (layer) layer.remove();
  layer = L.geoJSON({ type: 'FeatureCollection', features: selected }, {
    pointToLayer: (feature, latlng) => L.marker(latlng, { icon: pinIcon(props(feature).status_group) }),
    onEachFeature: (feature, marker) => {
      const item = props(feature);
      const source = item.source_url
        ? `<p><a href="${esc(item.source_url)}" target="_blank" rel="noopener">Open official planning record</a></p>`
        : '';
      marker.bindPopup(
        `<b>${esc(item.project_name)}</b>` +
        `<p>${esc(item.application_number)} · ${esc(item.planning_authority)}</p>` +
        `<p><strong>${esc(item.status_group)}</strong>${item.decision ? ` — ${esc(item.decision)}` : ''}</p>` +
        `<p>${esc(excerpt(item.description))}</p>${source}`
      );
    }
  }).addTo(map);
  map.panInsideBounds(IRELAND_BOUNDS, { animate: false });
}

function renderKpisAndCharts() {
  const summary = {
    applications: data.length,
    authorities: new Set(data.map(item => props(item).planning_authority).filter(Boolean)).size,
    granted: data.filter(item => props(item).status_group === 'Granted').length,
    pending: data.filter(item => props(item).status_group === 'Pending / other').length,
    refused: data.filter(item => props(item).status_group === 'Refused').length,
    appealed: data.filter(item => props(item).appeal).length
  };

  document.getElementById('kpis').innerHTML = Object.entries(summary)
    .map(([label, value]) => `<div class="kpi"><b>${value}</b><span>${esc(label)}</span></div>`)
    .join('');

  const statusOrder = ['Granted', 'Pending / other', 'Refused', 'Invalid', 'Withdrawn'];
  const statusCounts = statusOrder.map(status => data.filter(item => props(item).status_group === status).length);
  statusChart?.destroy();
  statusChart = new Chart(document.getElementById('statusChart'), {
    type: 'doughnut',
    data: { labels: statusOrder, datasets: [{ data: statusCounts }] },
    options: { animation: false, plugins: { legend: { position: 'bottom' } } }
  });

  const counts = {};
  data.forEach(feature => {
    const authority = props(feature).planning_authority || 'Unknown';
    counts[authority] = (counts[authority] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  authorityChart?.destroy();
  authorityChart = new Chart(document.getElementById('authorityChart'), {
    type: 'bar',
    data: { labels: top.map(item => item[0]), datasets: [{ label: 'Applications', data: top.map(item => item[1]) }] },
    options: { animation: false, indexAxis: 'y', plugins: { legend: { display: false } } }
  });
}

function populateAuthorities() {
  const select = document.getElementById('authority');
  const current = select.value;
  select.innerHTML = '<option value="">All authorities</option>';
  [...new Set(data.map(item => props(item).planning_authority).filter(Boolean))]
    .sort()
    .forEach(authority => select.insertAdjacentHTML('beforeend', `<option>${esc(authority)}</option>`));
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function renderTable() {
  const selected = filtered();
  document.getElementById('rows').innerHTML = selected.length
    ? selected.map(feature => {
      const item = props(feature);
      const reference = item.source_url
        ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener">${esc(item.application_number)}</a>`
        : esc(item.application_number);
      return `<tr>` +
        `<td><b>${esc(item.project_name)}</b><br><small>${esc(excerpt(item.description, 340))}</small></td>` +
        `<td>${esc(item.applicant)}</td>` +
        `<td>${esc(item.planning_authority)}</td>` +
        `<td>${reference}</td>` +
        `<td>${esc(item.received_date)}</td>` +
        `<td><span class="status-badge status-${lower(item.status_group).replace(/[^a-z0-9]+/g, '-')}">${esc(item.status_group)}</span><br><small>${esc(item.decision)}</small></td>` +
        `<td>${esc(item.appeal)}</td></tr>`;
    }).join('')
    : '<tr><td colspan="7">No data-centre applications match the selected filters.</td></tr>';
}

function renderAll({ refreshCharts = false } = {}) {
  renderMarkers();
  renderTable();
  if (refreshCharts) {
    renderKpisAndCharts();
    populateAuthorities();
  }
}

async function processTerms(terms, phaseLabel) {
  const settled = await Promise.allSettled(terms.map(term => queryTermIds(term)));
  const ids = [];
  let failed = 0;
  settled.forEach(result => {
    if (result.status === 'fulfilled') ids.push(...result.value);
    else failed += 1;
  });

  if (ids.length) {
    setStatus(`${phaseLabel}: loading matching planning records…`);
    const features = await fetchNewFeatures(ids);
    addFeatures(features);
    if (data.length) {
      setControlsDisabled(false);
      renderAll({ refreshCharts: true });
      setStatus(`${data.length.toLocaleString('en-IE')} Irish data-centre planning applications loaded; continuing background checks…`);
    }
  }
  return { failed };
}

async function initialise() {
  setControlsDisabled(true);
  setStatus('Loading Irish data-centre planning applications…');

  let failed = 0;
  try {
    const primary = await processTerms(PRIMARY_TERMS, 'Initial data-centre search');
    failed += primary.failed;

    for (const batch of chunks(SECONDARY_TERMS, 5)) {
      const result = await processTerms(batch, 'Expanding description search');
      failed += result.failed;
    }

    if (!data.length) throw new Error('The planning service returned no usable records.');
    renderAll({ refreshCharts: true });
    const note = failed ? ` ${failed} search request${failed === 1 ? '' : 's'} timed out; available results are shown.` : '';
    setStatus(`${data.length.toLocaleString('en-IE')} Irish data-centre planning applications loaded for 2016–2026.${note}`);
  } catch (error) {
    console.error(error);
    setControlsDisabled(false);
    setStatus(`Unable to load planning data: ${error.message} Reload the page to retry.`);
  }
}

['search', 'status', 'authority'].forEach(id => {
  document.getElementById(id).addEventListener(id === 'search' ? 'input' : 'change', () => renderAll());
});

document.getElementById('download').addEventListener('click', () => {
  const rows = filtered().map(feature => props(feature));
  const fields = ['project_name', 'applicant', 'planning_authority', 'application_number', 'received_date', 'status_group', 'decision', 'appeal', 'description', 'source_url'];
  const csv = [fields.join(','), ...rows.map(row => fields.map(field => `"${String(row[field] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'irish-data-centre-planning-applications.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});

initialise();
