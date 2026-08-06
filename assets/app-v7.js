const SERVICE = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const IRELAND_BOUNDS = L.latLngBounds([[51.15, -11.15], [55.65, -5.15]]);
const START_DATE = Date.UTC(2016, 0, 1);
const END_DATE = Date.UTC(2027, 0, 1);

const COUNCILS = [
  { label: 'Carlow County Council', aliases: ['Carlow County Council'] },
  { label: 'Cavan County Council', aliases: ['Cavan County Council'] },
  { label: 'Clare County Council', aliases: ['Clare County Council'] },
  { label: 'Cork City Council', aliases: ['Cork City Council'] },
  { label: 'Cork County Council', aliases: ['Cork County Council'] },
  { label: 'Donegal County Council', aliases: ['Donegal County Council'] },
  { label: 'Dublin City Council', aliases: ['Dublin City Council'] },
  { label: 'Dún Laoghaire–Rathdown County Council', aliases: [
    'Dún Laoghaire–Rathdown County Council',
    'Dún Laoghaire-Rathdown County Council',
    'Dun Laoghaire-Rathdown County Council',
    'Dun Laoghaire Rathdown County Council'
  ] },
  { label: 'Fingal County Council', aliases: ['Fingal County Council'] },
  { label: 'Galway City Council', aliases: ['Galway City Council'] },
  { label: 'Galway County Council', aliases: ['Galway County Council'] },
  { label: 'Kerry County Council', aliases: ['Kerry County Council'] },
  { label: 'Kildare County Council', aliases: ['Kildare County Council'] },
  { label: 'Kilkenny County Council', aliases: ['Kilkenny County Council'] },
  { label: 'Laois County Council', aliases: ['Laois County Council'] },
  { label: 'Leitrim County Council', aliases: ['Leitrim County Council'] },
  { label: 'Limerick City and County Council', aliases: ['Limerick City and County Council', 'Limerick City & County Council'] },
  { label: 'Longford County Council', aliases: ['Longford County Council'] },
  { label: 'Louth County Council', aliases: ['Louth County Council'] },
  { label: 'Mayo County Council', aliases: ['Mayo County Council'] },
  { label: 'Meath County Council', aliases: ['Meath County Council'] },
  { label: 'Monaghan County Council', aliases: ['Monaghan County Council'] },
  { label: 'Offaly County Council', aliases: ['Offaly County Council'] },
  { label: 'Roscommon County Council', aliases: ['Roscommon County Council'] },
  { label: 'Sligo County Council', aliases: ['Sligo County Council'] },
  { label: 'South Dublin County Council', aliases: ['South Dublin County Council'] },
  { label: 'Tipperary County Council', aliases: ['Tipperary County Council'] },
  { label: 'Waterford City and County Council', aliases: ['Waterford City and County Council', 'Waterford City & County Council'] },
  { label: 'Westmeath County Council', aliases: ['Westmeath County Council'] },
  { label: 'Wexford County Council', aliases: ['Wexford County Council'] },
  { label: 'Wicklow County Council', aliases: ['Wicklow County Council'] }
];

const CANDIDATE_GROUPS = [
  ['data cent', 'datacent', 'data hall', 'data campus', 'server', 'hyperscale', 'colocation', 'co-location'],
  ['data storage', 'data processing', 'cloud computing', 'compute campus', 'digital infrastructure', 'mission critical', 'ICT facil', 'ICT campus', 'information technology facil', 'information technology campus', 'computer facil', 'computer campus']
];

const DIRECT_PATTERNS = [
  /\bdata[\s-]*cent(?:re|er)s?\b/i,
  /\bdatacent(?:re|er)s?\b/i,
  /\bdata halls?\b/i,
  /\bdata campus\b/i,
  /\bserver halls?\b/i,
  /\bserver farms?\b/i,
  /\bhyperscale\b/i,
  /\bco-?location\b/i,
  /\bcloud computing\b/i,
  /\bcompute campus\b/i,
  /\bdigital infrastructure\b/i,
  /\bmission critical facilit(?:y|ies)\b/i,
  /\bdata storage facilit(?:y|ies)\b/i,
  /\bdata processing facilit(?:y|ies)\b/i
];

const TECHNICAL_PATTERNS = [
  /\bserver rooms?\b/i,
  /\bICT (?:facilit(?:y|ies)|campus|building)\b/i,
  /\binformation technology (?:facilit(?:y|ies)|campus|building)\b/i,
  /\bcomputer (?:facilit(?:y|ies)|campus|building)\b/i
];

const SUPPORT_PATTERNS = [
  /\bgenerators?\b/i,
  /\bsub-?stations?\b/i,
  /\btransformers?\b/i,
  /\bcooling\b/i,
  /\bchillers?\b/i,
  /\bswitch\s*rooms?\b/i,
  /\benergy cent(?:re|er)\b/i,
  /\bdata halls?\b/i,
  /\bcampus\b/i
];

const FALSE_POSITIVE_PATTERNS = [
  /\bcentre for data\b/i,
  /\bdata collection cent(?:re|er)\b/i,
  /\bdata analytics cent(?:re|er)\b/i,
  /\bdata training cent(?:re|er)\b/i,
  /\bcommunity data\b/i
];

const OUT_FIELDS = [
  'OBJECTID', 'PlanningAuthority', 'ApplicationNumber', 'DevelopmentDescription',
  'DevelopmentAddress', 'ApplicationStatus', 'ApplicationType',
  'ApplicantForename', 'ApplicantSurname', 'Decision', 'ReceivedDate',
  'DecisionDate', 'GrantDate', 'ExpiryDate', 'AppealRefNumber', 'AppealStatus',
  'AppealDecision', 'AppealDecisionDate', 'AppealSubmittedDate',
  'FIRequestDate', 'FIRecDate', 'AreaofSite', 'FloorArea', 'LinkAppDetails'
].join(',');

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

let data = [];
let markerLayer = L.layerGroup().addTo(map);
let statusChart;
let authorityChart;
let jsonpCounter = 0;
let councilsChecked = 0;
let failedCouncils = [];
let renderTimer = null;

const props = feature => feature.properties || {};
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLowerCase();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function setStatus(message) {
  document.querySelector('#updated').textContent = message;
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, character => character.toUpperCase());
}

function buildCandidateClause(stems) {
  const clauses = [];
  stems.forEach(stem => {
    const variants = [...new Set([stem.toLowerCase(), titleCase(stem), stem.toUpperCase()])];
    variants.forEach(variant => clauses.push(`DevelopmentDescription LIKE '%${sqlEscape(variant)}%'`));
  });
  return `(${clauses.join(' OR ')})`;
}

function arcgisJsonp(params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = `__irish_dc_v7_${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement('script');
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Request timed out'));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    }

    window[callbackName] = response => {
      if (settled) return;
      settled = true;
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
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('National planning service unavailable'));
    };
    document.head.appendChild(script);
  });
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dateValue(value) {
  if (!value) return NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 100000000000) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatDate(value) {
  const timestamp = dateValue(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleDateString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatNumber(value, maximumFractionDigits = 1) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-IE', { maximumFractionDigits });
}

function excerpt(value, limit = 260) {
  const text = clean(value);
  if (text.length <= limit) return text;
  const shortened = text.slice(0, limit);
  const breakAt = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, breakAt > 180 ? breakAt : limit)}…`;
}

function planningStatus(value) {
  const text = lower(value);
  if (text.includes('grant') || text.includes('conditional') || text.includes('unconditional') || text.includes('approval')) return 'Granted';
  if (text.includes('refus')) return 'Refused';
  if (text.includes('withdraw')) return 'Withdrawn';
  if (text.includes('invalid') || text.includes('incomplete')) return 'Invalid';
  return 'Pending / other';
}

function isDataCentreDescription(description) {
  const text = clean(description);
  if (!text || FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(text))) return false;
  if (DIRECT_PATTERNS.some(pattern => pattern.test(text))) return true;
  const technical = TECHNICAL_PATTERNS.some(pattern => pattern.test(text));
  const supportCount = SUPPORT_PATTERNS.filter(pattern => pattern.test(text)).length;
  return technical && supportCount >= 1;
}

function hasIrishPoint(feature) {
  const geometry = feature.geometry;
  if (!geometry || !Number.isFinite(Number(geometry.x)) || !Number.isFinite(Number(geometry.y))) return false;
  return IRELAND_BOUNDS.contains(L.latLng(Number(geometry.y), Number(geometry.x)));
}

function normaliseFeature(rawFeature, officialCouncil) {
  if (!hasIrishPoint(rawFeature)) return null;
  const raw = rawFeature.attributes || {};
  const received = dateValue(raw.ReceivedDate);
  if (!Number.isFinite(received) || received < START_DATE || received >= END_DATE) return null;
  const description = clean(raw.DevelopmentDescription);
  if (!isDataCentreDescription(description)) return null;

  const authority = officialCouncil || clean(raw.PlanningAuthority);
  const applicationNumber = clean(raw.ApplicationNumber);
  const decision = clean(raw.Decision || raw.ApplicationStatus);
  const siteAreaHa = numberOrNull(raw.AreaofSite);
  const floorAreaSqm = numberOrNull(raw.FloorArea);

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(rawFeature.geometry.x), Number(rawFeature.geometry.y)] },
    properties: {
      key: `${authority.toUpperCase()}|${applicationNumber.toUpperCase()}`,
      project_name: clean(raw.DevelopmentAddress) || applicationNumber,
      address: clean(raw.DevelopmentAddress),
      planning_authority: authority,
      application_number: applicationNumber,
      description,
      applicant: clean([raw.ApplicantForename, raw.ApplicantSurname].filter(Boolean).join(' ')),
      received_date: formatDate(raw.ReceivedDate),
      received_timestamp: received,
      decision,
      status_group: planningStatus(decision),
      appeal: clean(raw.AppealRefNumber),
      appeal_status: clean(raw.AppealStatus),
      site_area_ha: siteAreaHa,
      floor_area_sqm: floorAreaSqm,
      source_url: clean(raw.LinkAppDetails)
    }
  };
}

function buildCouncilWhere(council, stems) {
  const authorityClause = council.aliases.map(alias => `PlanningAuthority='${sqlEscape(alias)}'`).join(' OR ');
  return `((${authorityClause}) AND ${buildCandidateClause(stems)})`;
}

async function queryCouncilGroup(council, stems, timeoutMs = 16000) {
  const response = await arcgisJsonp({
    where: buildCouncilWhere(council, stems),
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '2000',
    orderByFields: 'ReceivedDate DESC'
  }, timeoutMs);

  const features = [];
  (response.features || []).forEach(rawFeature => {
    const feature = normaliseFeature(rawFeature, council.label);
    if (feature) features.push(feature);
  });
  return features;
}

function mergeFeatures(features) {
  const unique = new Map(data.map(feature => [props(feature).key, feature]));
  features.forEach(feature => {
    const key = props(feature).key || JSON.stringify(feature.geometry);
    if (!unique.has(key)) unique.set(key, feature);
  });
  data = [...unique.values()].sort((a, b) => props(b).received_timestamp - props(a).received_timestamp);
}

function populateCouncilFilter() {
  const select = document.querySelector('#authority');
  select.innerHTML = '<option value="">All 31 councils</option>';
  COUNCILS.forEach(council => {
    select.insertAdjacentHTML('beforeend', `<option value="${esc(council.label)}">${esc(council.label)}</option>`);
  });
}

function enableControls() {
  ['#search', '#status', '#authority', '#download'].forEach(selector => {
    document.querySelector(selector).disabled = false;
  });
}

function filteredData() {
  const query = lower(document.querySelector('#search').value);
  const status = document.querySelector('#status').value;
  const authority = document.querySelector('#authority').value;
  return data.filter(feature => {
    const item = props(feature);
    return (!query || JSON.stringify(item).toLowerCase().includes(query)) &&
      (!status || item.status_group === status) &&
      (!authority || item.planning_authority === authority);
  });
}

function pinClass(status) {
  if (status === 'Granted') return 'pin-granted';
  if (status === 'Refused' || status === 'Invalid') return 'pin-refused';
  if (status === 'Withdrawn') return 'pin-withdrawn';
  return 'pin-pending';
}

function renderPins(selected) {
  markerLayer.clearLayers();
  selected.forEach(feature => {
    const item = props(feature);
    const [longitude, latitude] = feature.geometry.coordinates;
    const icon = L.divIcon({
      className: 'map-pin-wrapper',
      html: `<span class="map-pin ${pinClass(item.status_group)}"></span>`,
      iconSize: [24, 30],
      iconAnchor: [12, 29],
      popupAnchor: [0, -27]
    });
    const marker = L.marker([latitude, longitude], { icon });
    const source = item.source_url
      ? `<p><a href="${esc(item.source_url)}" target="_blank" rel="noopener">Open official planning record</a></p>`
      : '';
    marker.bindPopup(
      `<b>${esc(item.project_name)}</b>` +
      `<p>${esc(item.application_number)} · ${esc(item.planning_authority)}</p>` +
      `<p><strong>${esc(item.status_group)}</strong>${item.decision ? ` — ${esc(item.decision)}` : ''}</p>` +
      `<p><strong>Site area:</strong> ${item.site_area_ha ? `${formatNumber(item.site_area_ha, 3)} ha` : 'Not recorded'}<br>` +
      `<strong>Floor area:</strong> ${item.floor_area_sqm ? `${formatNumber(item.floor_area_sqm, 0)} m²` : 'Not recorded'}</p>` +
      `<p>${esc(excerpt(item.description, 260))}</p>${source}`
    );
    marker.addTo(markerLayer);
  });
}

function renderKpis() {
  const totalSiteArea = data.reduce((sum, feature) => sum + (props(feature).site_area_ha || 0), 0);
  const totalFloorArea = data.reduce((sum, feature) => sum + (props(feature).floor_area_sqm || 0), 0);
  const councilsWithMatches = new Set(data.map(feature => props(feature).planning_authority)).size;
  const summary = [
    ['Applications', data.length],
    ['Councils checked', `${councilsChecked}/31`],
    ['Councils with matches', councilsWithMatches],
    ['Granted', data.filter(feature => props(feature).status_group === 'Granted').length],
    ['Pending', data.filter(feature => props(feature).status_group === 'Pending / other').length],
    ['Appealed', data.filter(feature => props(feature).appeal).length],
    ['Recorded site area', `${formatNumber(totalSiteArea, 2)} ha`],
    ['Recorded floor area', `${formatNumber(totalFloorArea, 0)} m²`]
  ];
  document.querySelector('#kpis').innerHTML = summary.map(([label, value]) => `<div class="kpi"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
}

function renderCharts() {
  const statusOrder = ['Granted', 'Pending / other', 'Refused', 'Invalid', 'Withdrawn'];
  const statusCounts = statusOrder.map(status => data.filter(feature => props(feature).status_group === status).length);
  statusChart?.destroy();
  statusChart = new Chart(document.querySelector('#statusChart'), {
    type: 'doughnut',
    data: { labels: statusOrder, datasets: [{ data: statusCounts }] },
    options: { animation: false, plugins: { legend: { position: 'bottom' } } }
  });

  const counts = new Map(COUNCILS.map(council => [council.label, 0]));
  data.forEach(feature => {
    const authority = props(feature).planning_authority;
    counts.set(authority, (counts.get(authority) || 0) + 1);
  });
  const ranked = [...counts.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
  authorityChart?.destroy();
  authorityChart = new Chart(document.querySelector('#authorityChart'), {
    type: 'bar',
    data: {
      labels: ranked.map(([authority]) => authority),
      datasets: [{ label: 'Applications', data: ranked.map(([, count]) => count) }]
    },
    options: {
      animation: false,
      indexAxis: 'y',
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });
}

function renderTable(selected) {
  const rows = selected.map(feature => {
    const item = props(feature);
    const reference = item.source_url
      ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener">${esc(item.application_number)}</a>`
      : esc(item.application_number);
    return `<tr>` +
      `<td><b>${esc(item.project_name)}</b><br><small>${esc(excerpt(item.description, 360))}</small></td>` +
      `<td>${esc(item.applicant)}</td>` +
      `<td>${esc(item.planning_authority)}</td>` +
      `<td>${reference}</td>` +
      `<td>${esc(item.received_date)}</td>` +
      `<td><span class="status-badge status-${esc(item.status_group.toLowerCase().replaceAll(' ', '-').replaceAll('/', '-'))}">${esc(item.status_group)}</span><br><small>${esc(item.decision)}</small></td>` +
      `<td>${esc(item.appeal)}</td>` +
      `<td>${item.site_area_ha ? `${formatNumber(item.site_area_ha, 3)} ha` : '—'}</td>` +
      `<td>${item.floor_area_sqm ? `${formatNumber(item.floor_area_sqm, 0)} m²` : '—'}</td>` +
      `</tr>`;
  }).join('');
  document.querySelector('#rows').innerHTML = rows || '<tr><td colspan="9">No data-centre applications match the selected filters.</td></tr>';
}

function renderDashboard() {
  const selected = filteredData();
  renderPins(selected);
  renderKpis();
  renderCharts();
  renderTable(selected);
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    renderDashboard();
  }, 250);
}

async function queryGroupWithRetry(council, stems) {
  try {
    return await queryCouncilGroup(council, stems, 14000);
  } catch (firstError) {
    return await queryCouncilGroup(council, stems, 22000);
  }
}

async function processCouncil(council) {
  const results = await Promise.allSettled(CANDIDATE_GROUPS.map(stems => queryGroupWithRetry(council, stems)));
  const features = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
  mergeFeatures(features);
  councilsChecked += 1;
  if (features.length) enableControls();
  if (results.every(result => result.status === 'rejected')) {
    failedCouncils.push(council.label);
    console.warn(`Council query failed: ${council.label}`);
  }
  setStatus(`Checked ${councilsChecked} of 31 councils · ${data.length.toLocaleString('en-IE')} applications mapped…`);
  scheduleRender();
}

async function runPool(items, concurrency, worker) {
  let nextIndex = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

function downloadCsv() {
  const selected = filteredData();
  const headers = ['Project / location', 'Applicant', 'Planning authority', 'Application number', 'Received date', 'Decision', 'Appeal', 'Site area (ha)', 'Floor area (m²)', 'Development description', 'Official link'];
  const rows = selected.map(feature => {
    const item = props(feature);
    return [item.project_name, item.applicant, item.planning_authority, item.application_number, item.received_date, item.decision, item.appeal, item.site_area_ha ?? '', item.floor_area_sqm ?? '', item.description, item.source_url];
  });
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'irish-data-centre-planning-applications-2016-2026.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialise() {
  populateCouncilFilter();
  renderKpis();
  renderCharts();
  setStatus('Checking all 31 Irish planning authorities for data-centre applications…');

  document.querySelector('#search').addEventListener('input', renderDashboard);
  document.querySelector('#status').addEventListener('change', renderDashboard);
  document.querySelector('#authority').addEventListener('change', renderDashboard);
  document.querySelector('#download').addEventListener('click', downloadCsv);

  await runPool(COUNCILS, 4, processCouncil);
  enableControls();
  renderDashboard();

  if (failedCouncils.length) {
    setStatus(`${data.length.toLocaleString('en-IE')} applications mapped across ${new Set(data.map(feature => props(feature).planning_authority)).size} councils. ${failedCouncils.length} council request${failedCouncils.length === 1 ? '' : 's'} timed out and can be retried by refreshing.`);
  } else {
    setStatus(`${data.length.toLocaleString('en-IE')} data-centre planning applications mapped after checking all 31 councils · 2016–2026.`);
  }
}

initialise().catch(error => {
  console.error(error);
  enableControls();
  renderDashboard();
  setStatus('The national planning service could not complete the council sweep. Refresh to retry; any retrieved records remain visible.');
});
