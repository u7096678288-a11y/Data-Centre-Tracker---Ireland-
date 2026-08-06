const SERVICE = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const IRELAND_BOUNDS = L.latLngBounds([[51.30, -10.85], [55.45, -5.85]]);
const DATE_FILTER = "ReceivedDate >= DATE '2016-01-01' AND ReceivedDate < DATE '2027-01-01'";

const map = L.map('map', {
  maxBounds: IRELAND_BOUNDS,
  maxBoundsViscosity: 1,
  minZoom: 6,
  maxZoom: 16,
  worldCopyJump: false
}).fitBounds(IRELAND_BOUNDS);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  bounds: IRELAND_BOUNDS,
  noWrap: true,
  minZoom: 6,
  maxZoom: 18
}).addTo(map);

const QUERY_GROUPS = [
  [
    'data centre', 'data center', 'data-centre', 'data-center',
    'datacentre', 'datacenter', 'data centres', 'data centers'
  ],
  [
    'data hall', 'server hall', 'server farm', 'hyperscale',
    'colocation', 'co-location', 'cloud computing', 'compute campus'
  ],
  [
    'digital infrastructure', 'data storage facility', 'data processing facility',
    'server room', 'ICT facility', 'information technology facility',
    'computer facility', 'mission critical facility'
  ]
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
  /\bdata storage facilit(?:y|ies)\b/i,
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
  /\bcampus\b/i
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
let initialMapFitted = false;

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
    const control = document.querySelector(`#${id}`);
    if (control) control.disabled = disabled;
  });
}

function arcgisJsonp(params) {
  return new Promise((resolve, reject) => {
    const callbackName = `__irish_dc_${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The national planning service did not respond in time.'));
    }, 45000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    }

    window[callbackName] = response => {
      cleanup();
      if (response?.error) {
        reject(new Error(response.error.message || 'ArcGIS query error'));
        return;
      }
      resolve(response);
    };

    const query = new URLSearchParams({ ...params, f: 'json', callback: callbackName });
    script.src = `${SERVICE}?${query.toString()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error('The national planning service could not be reached.'));
    };
    document.head.appendChild(script);
  });
}

function titleCase(value) {
  return value.replace(/\b\w/g, character => character.toUpperCase());
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

function buildWhere(terms) {
  const clauses = [];
  terms.forEach(term => {
    [...new Set([term.toLowerCase(), term.toUpperCase(), titleCase(term)])]
      .forEach(variant => clauses.push(`DevelopmentDescription LIKE '%${sqlEscape(variant)}%'`));
  });
  return `${DATE_FILTER} AND (${clauses.join(' OR ')})`;
}

async function fetchQueryGroup(terms) {
  const response = await arcgisJsonp({
    where: buildWhere(terms),
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '2000',
    orderByFields: 'ReceivedDate DESC'
  });
  return response.features || [];
}

function hasIrishPointGeometry(feature) {
  const geometry = feature.geometry || {};
  const longitude = Number(geometry.x ?? geometry.coordinates?.[0]);
  const latitude = Number(geometry.y ?? geometry.coordinates?.[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) &&
    IRELAND_BOUNDS.contains(L.latLng(latitude, longitude));
}

function isDataCentreDescription(description) {
  const text = clean(description);
  if (DIRECT_PATTERNS.some(pattern => pattern.test(text))) return true;
  return TECHNICAL_PATTERNS.some(pattern => pattern.test(text)) &&
    SUPPORT_PATTERNS.filter(pattern => pattern.test(text)).length >= 2;
}

function normaliseDate(value) {
  if (!value) return '';
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? numeric : value);
  if (Number.isNaN(date.getTime())) return clean(value).slice(0, 10);
  return date.toLocaleDateString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function planningStatus(value) {
  const text = lower(value);
  if (text.includes('grant') || text.includes('conditional') || text.includes('unconditional') || text.includes('approval')) return 'Granted';
  if (text.includes('refus')) return 'Refused';
  if (text.includes('withdraw')) return 'Withdrawn';
  if (text.includes('invalid')) return 'Invalid';
  return 'Pending / other';
}

function statusClass(status) {
  return `status-${lower(status).replace(/[^a-z0-9]+/g, '-')}`;
}

function excerpt(value, maxLength = 260) {
  const text = clean(value);
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > 160 ? lastSpace : maxLength)}…`;
}

function pinIcon(status) {
  return L.divIcon({
    className: 'pin-wrapper',
    html: `<span class="map-pin ${statusClass(status)}"><span></span></span>`,
    iconSize: [24, 32],
    iconAnchor: [12, 30],
    popupAnchor: [0, -27]
  });
}

function normaliseFeature(feature) {
  if (!hasIrishPointGeometry(feature)) return null;
  const raw = feature.attributes || feature.properties || {};
  const geometry = feature.geometry || {};
  const description = clean(raw.DevelopmentDescription);
  if (!isDataCentreDescription(description)) return null;

  const authority = clean(raw.PlanningAuthority);
  const applicationNumber = clean(raw.ApplicationNumber);
  const applicant = clean([raw.ApplicantForename, raw.ApplicantSurname].filter(Boolean).join(' '));
  const decision = clean(raw.Decision || raw.ApplicationStatus);
  const longitude = Number(geometry.x ?? geometry.coordinates?.[0]);
  const latitude = Number(geometry.y ?? geometry.coordinates?.[1]);

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      key: `${authority.toUpperCase()}|${applicationNumber.toUpperCase()}`,
      project_name: clean(raw.DevelopmentAddress) || applicationNumber,
      planning_authority: authority,
      application_number: applicationNumber,
      description,
      address: clean(raw.DevelopmentAddress),
      applicant,
      application_status: clean(raw.ApplicationStatus),
      application_type: clean(raw.ApplicationType),
      received_date: normaliseDate(raw.ReceivedDate),
      received_timestamp: Number(raw.ReceivedDate) || 0,
      decision,
      status_group: planningStatus(decision),
      decision_date: normaliseDate(raw.DecisionDate),
      grant_date: normaliseDate(raw.GrantDate),
      expiry_date: normaliseDate(raw.ExpiryDate),
      appeal: clean(raw.AppealRefNumber),
      appeal_status: clean(raw.AppealStatus),
      appeal_decision: clean(raw.AppealDecision),
      appeal_submitted_date: normaliseDate(raw.AppealSubmittedDate),
      appeal_decision_date: normaliseDate(raw.AppealDecisionDate),
      fi_requested_date: normaliseDate(raw.FIRequestDate),
      fi_received_date: normaliseDate(raw.FIRecDate),
      floor_area: raw.FloorArea ?? '',
      site_area: raw.AreaofSite ?? '',
      source_url: clean(raw.LinkAppDetails)
    }
  };
}

async function loadLiveData() {
  setStatus('Loading Irish data-centre planning applications from 2016–2026…');
  const settled = await Promise.allSettled(QUERY_GROUPS.map(fetchQueryGroup));
  const rawFeatures = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);

  if (!rawFeatures.length) {
    const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason?.message).filter(Boolean);
    throw new Error(errors[0] || 'No planning records could be retrieved.');
  }

  const unique = new Map();
  rawFeatures.forEach(feature => {
    const item = normaliseFeature(feature);
    if (!item) return;
    const itemProps = props(item);
    const fallbackKey = String((feature.attributes || {}).OBJECTID || JSON.stringify(item.geometry));
    const key = itemProps.key === '|' ? fallbackKey : itemProps.key;
    if (!unique.has(key)) unique.set(key, item);
  });

  return [...unique.values()].sort((a, b) => props(b).received_timestamp - props(a).received_timestamp);
}

function filtered() {
  const query = lower(document.querySelector('#search').value);
  const authority = document.querySelector('#authority').value;
  const selectedStatus = document.querySelector('#status').value;

  return data.filter(feature => {
    const item = props(feature);
    return (!query || JSON.stringify(item).toLowerCase().includes(query)) &&
      (!authority || item.planning_authority === authority) &&
      (!selectedStatus || item.status_group === selectedStatus);
  });
}

function renderKpis() {
  const summary = {
    applications: data.length,
    authorities: new Set(data.map(item => props(item).planning_authority).filter(Boolean)).size,
    granted: data.filter(item => props(item).status_group === 'Granted').length,
    pending: data.filter(item => props(item).status_group === 'Pending / other').length,
    refused: data.filter(item => props(item).status_group === 'Refused').length,
    appealed: data.filter(item => props(item).appeal).length
  };
  document.querySelector('#kpis').innerHTML = Object.entries(summary)
    .map(([label, value]) => `<div class="kpi"><b>${value}</b><span>${esc(label)}</span></div>`)
    .join('');
}

function populateAuthorities() {
  const select = document.querySelector('#authority');
  select.innerHTML = '<option value="">All authorities</option>';
  [...new Set(data.map(item => props(item).planning_authority).filter(Boolean))]
    .sort()
    .forEach(authority => select.insertAdjacentHTML('beforeend', `<option>${esc(authority)}</option>`));
}

function renderCharts() {
  const statusOrder = ['Granted', 'Pending / other', 'Refused', 'Invalid', 'Withdrawn'];
  const statusCounts = Object.fromEntries(statusOrder.map(status => [status, 0]));
  data.forEach(feature => {
    const status = props(feature).status_group;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  const statusEntries = Object.entries(statusCounts).filter(([, count]) => count > 0);

  statusChart?.destroy();
  statusChart = new Chart(document.querySelector('#statusChart'), {
    type: 'doughnut',
    data: {
      labels: statusEntries.map(([label]) => label),
      datasets: [{ data: statusEntries.map(([, count]) => count) }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  const authorityCounts = {};
  data.forEach(feature => {
    const authority = props(feature).planning_authority || 'Unknown';
    authorityCounts[authority] = (authorityCounts[authority] || 0) + 1;
  });
  const topAuthorities = Object.entries(authorityCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  authorityChart?.destroy();
  authorityChart = new Chart(document.querySelector('#authorityChart'), {
    type: 'bar',
    data: {
      labels: topAuthorities.map(([authority]) => authority),
      datasets: [{ label: 'Applications', data: topAuthorities.map(([, count]) => count) }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderMapAndTable({ fitInitial = false } = {}) {
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
        `<p>${esc(excerpt(item.description))}</p>${source}`,
        { maxWidth: 360 }
      );
    }
  }).addTo(map);

  if (fitInitial && !initialMapFitted) {
    const bounds = layer.getBounds();
    if (selected.length && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
    } else {
      map.fitBounds(IRELAND_BOUNDS);
    }
    initialMapFitted = true;
  }
  map.panInsideBounds(IRELAND_BOUNDS, { animate: false });

  document.querySelector('#rows').innerHTML = selected.map(feature => {
    const item = props(feature);
    const reference = item.source_url
      ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener">${esc(item.application_number)}</a>`
      : esc(item.application_number);
    return `<tr>` +
      `<td><b>${esc(item.project_name)}</b><br><small>${esc(excerpt(item.description, 320))}</small></td>` +
      `<td>${esc(item.applicant)}</td>` +
      `<td>${esc(item.planning_authority)}</td>` +
      `<td>${reference}</td>` +
      `<td>${esc(item.received_date)}</td>` +
      `<td><span class="status-badge ${statusClass(item.status_group)}">${esc(item.status_group)}</span><br><small>${esc(item.decision)}</small></td>` +
      `<td>${esc(item.appeal)}</td>` +
      `</tr>`;
  }).join('') || '<tr><td colspan="7">No data-centre applications match the selected filters.</td></tr>';

  setStatus(`${selected.length.toLocaleString('en-IE')} of ${data.length.toLocaleString('en-IE')} applications shown · 2016–2026 · Map view remains fixed while filtering.`);
}

function exportCsv() {
  const keys = [
    'project_name', 'applicant', 'planning_authority', 'application_number',
    'received_date', 'status_group', 'decision', 'appeal', 'description', 'source_url'
  ];
  const rows = [keys, ...filtered().map(feature => keys.map(key => props(feature)[key] ?? ''))];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'irish-data-centre-planning-applications-2016-2026.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialise() {
  setControlsDisabled(true);
  data = await loadLiveData();
  if (!data.length) throw new Error('No matching data-centre applications were returned.');
  renderKpis();
  populateAuthorities();
  renderCharts();
  setControlsDisabled(false);
  renderMapAndTable({ fitInitial: true });
}

['search', 'status', 'authority'].forEach(id => {
  const element = document.querySelector(`#${id}`);
  element.addEventListener(id === 'search' ? 'input' : 'change', () => renderMapAndTable());
});
document.querySelector('#download').addEventListener('click', exportCsv);

initialise().catch(error => {
  console.error(error);
  setControlsDisabled(true);
  setStatus(`Data could not be loaded: ${error.message}`);
  document.querySelector('#rows').innerHTML = `<tr><td colspan="7">Data could not be loaded: ${esc(error.message)}</td></tr>`;
  map.fitBounds(IRELAND_BOUNDS);
});
