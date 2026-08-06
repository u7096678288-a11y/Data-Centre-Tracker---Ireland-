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
}).fitBounds(IRELAND_BOUNDS);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  noWrap: true,
  bounds: IRELAND_BOUNDS,
  minZoom: 6,
  maxZoom: 18
}).addTo(map);

const SEARCH_GROUPS = [
  {
    label: 'core data-centre descriptions',
    terms: [
      'data centre', 'data center', 'datacentre', 'datacenter',
      'data-centre', 'data-center', 'data hall', 'server hall',
      'server farm', 'hyperscale', 'colocation', 'co-location'
    ]
  },
  {
    label: 'digital and mission-critical facilities',
    terms: [
      'cloud computing', 'compute campus', 'digital infrastructure',
      'mission critical', 'data storage', 'data processing facility',
      'server room', 'computer facility', 'ICT facility',
      'information technology facility', 'DUB1', 'DUB2', 'DUB3',
      'DUB4', 'DUB5', 'DUB6', 'DUB7', 'DUB8', 'DUB9', 'DUB10',
      'DUB12', 'DUB14', 'DUB15', 'DUB20', 'DUB30', 'DUB40',
      'DUB50', 'DUB60', 'DUB70'
    ]
  },
  {
    label: 'known data-centre operators and applicants',
    terms: [
      'Amazon Data Services', 'Amazon Web Services', 'AWS',
      'Microsoft Ireland', 'Google Ireland', 'Meta Platforms',
      'Facebook Ireland', 'Echelon', 'Equinix', 'Digital Realty',
      'Vantage Data', 'EdgeConneX', 'Edge Connex', 'Keppel',
      'CyrusOne', 'Pure Data Centres', 'Pure Data Centers',
      'EngineNode', 'Herbata', 'Art Data Centres', 'Art Data Centers',
      'Crusoe', 'Greenergy', 'Data and Power Hub'
    ]
  }
];

const CORE_PATTERNS = [
  /\bdata[\s-]*cent(?:re|er)s?\b/i,
  /\bdata halls?\b/i,
  /\bserver halls?\b/i,
  /\bserver farms?\b/i,
  /\bhyperscale\b/i,
  /\bco-?location\b/i,
  /\bcloud computing\b/i,
  /\bcompute campus\b/i,
  /\bdigital infrastructure\b/i,
  /\bmission critical\b/i,
  /\bdata storage\b/i,
  /\bdata processing facilit(?:y|ies)\b/i,
  /\b(?:DUB|DC)[- ]?\d{1,3}\b/i
];

const TECHNICAL_PATTERNS = [
  /\bserver rooms?\b/i,
  /\bcomputer facilit(?:y|ies)\b/i,
  /\bICT facilit(?:y|ies)\b/i,
  /\binformation technology facilit(?:y|ies)\b/i
];

const ANCILLARY_PATTERNS = [
  ['Substation / grid', /\b(?:electrical |electricity |grid )?sub-?stations?\b|\bgrid connection\b|\b110\s*kV\b|\b220\s*kV\b/i],
  ['Generators / power', /\bgenerators?\b|\bgas engines?\b|\bpower generation\b|\benergy cent(?:re|er)\b|\benergy plant\b/i],
  ['Cooling / plant', /\bcooling\b|\bchillers?\b|\bheat rejection\b|\bplant rooms?\b/i],
  ['Office / administration', /\boffices?\b|\badministration building\b|\bstaff facilities\b|\breception\b/i],
  ['Electrical infrastructure', /\btransformers?\b|\bswitch\s*rooms?\b|\belectrical rooms?\b|\bMV rooms?\b/i],
  ['Battery / fuel storage', /\bbattery(?: energy)? storage\b|\bBESS\b|\bfuel storage\b|\bdiesel tanks?\b/i],
  ['Campus support', /\bsecurity building\b|\bsecurity hut\b|\bcar parks?\b|\bloading bays?\b|\blogistics\b|\bwarehouse\b/i]
];

const OPERATOR_PATTERNS = [
  /Amazon Data Services|Amazon Web Services|\bAWS\b/i,
  /Microsoft Ireland|Google Ireland|Meta Platforms|Facebook Ireland/i,
  /Echelon|Equinix|Digital Realty|Vantage Data|Edge\s*Conne?x/i,
  /Keppel|CyrusOne|Pure Data Cent(?:re|er)s|EngineNode/i,
  /Herbata|Art Data Cent(?:re|er)s|Crusoe|Greenergy|Data and Power Hub/i
];

const FALSE_POSITIVES = [
  /\bcommunity data cent(?:re|er)\b/i,
  /\bdata collection cent(?:re|er)\b/i,
  /\bdata analytics cent(?:re|er)\b/i,
  /\btraining cent(?:re|er)\b/i,
  /\brecycling cent(?:re|er)\b/i,
  /\blicensed betting office\b/i
];

const OUT_FIELDS = [
  'OBJECTID', 'PlanningAuthority', 'ApplicationNumber', 'DevelopmentDescription',
  'DevelopmentAddress', 'DevelopmentPostcode', 'ApplicationStatus', 'ApplicationType',
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
let fittedInitialPins = false;
const records = new Map();
const fetchedObjectIds = new Set();
const failedSearches = [];

const props = feature => feature.properties || {};
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLowerCase();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function setStatus(message) {
  document.querySelector('#updated').textContent = message;
}

function jsonpRequest(params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const callbackName = `__irish_dc_v8_${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement('script');
    let finished = false;
    const timeout = window.setTimeout(() => finish(new Error('Request timed out')), timeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    }

    function finish(error, value) {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error); else resolve(value);
    }

    window[callbackName] = response => {
      if (response?.error) finish(new Error(response.error.message || 'ArcGIS query error'));
      else finish(null, response);
    };

    const query = new URLSearchParams({ ...params, f: 'json', callback: callbackName });
    script.src = `${SERVICE}?${query.toString()}`;
    script.onerror = () => finish(new Error('Planning service could not be reached'));
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
  const variants = [...new Set([term, term.toLowerCase(), term.toUpperCase(), titleCase(term)])];
  const descriptionWhere = variants
    .map(variant => `DevelopmentDescription LIKE '%${sqlEscape(variant)}%'`)
    .join(' OR ');
  const applicantWhere = variants
    .map(variant => `ApplicantSurname LIKE '%${sqlEscape(variant)}%'`)
    .join(' OR ');
  const where = `(${descriptionWhere} OR ${applicantWhere})`;
  const response = await jsonpRequest({ where, returnIdsOnly: 'true' }, 12000);
  return response.objectIds || [];
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchFeatureBatch(objectIds) {
  const response = await jsonpRequest({
    objectIds: objectIds.join(','),
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326'
  }, 18000);

  return (response.features || []).map(feature => {
    const geometry = feature.geometry;
    if (!geometry || !Number.isFinite(Number(geometry.x)) || !Number.isFinite(Number(geometry.y))) return null;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(geometry.x), Number(geometry.y)] },
      properties: feature.attributes || {}
    };
  }).filter(Boolean);
}

function hasIrishPointGeometry(feature) {
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) return false;
  const [longitude, latitude] = coordinates.map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) &&
    IRELAND_BOUNDS.contains(L.latLng(latitude, longitude));
}

function parseDateValue(value) {
  if (!value) return null;
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normaliseDate(value) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString('en-IE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function planningStatus(value) {
  const text = lower(value);
  if (text.includes('grant') || text.includes('conditional') || text.includes('unconditional') || text.includes('approval')) return 'Granted';
  if (text.includes('refus')) return 'Refused';
  if (text.includes('withdraw')) return 'Withdrawn';
  if (text.includes('invalid') || text.includes('incomplete')) return 'Invalid';
  return 'Pending / other';
}

function classifyRecord(description, applicant) {
  const combined = `${description} ${applicant}`;
  if (FALSE_POSITIVES.some(pattern => pattern.test(description)) && !CORE_PATTERNS.some(pattern => pattern.test(description))) return null;

  const core = CORE_PATTERNS.some(pattern => pattern.test(description));
  const technical = TECHNICAL_PATTERNS.some(pattern => pattern.test(description));
  const operator = OPERATOR_PATTERNS.some(pattern => pattern.test(combined));
  const ancillaryMatches = ANCILLARY_PATTERNS.filter(([, pattern]) => pattern.test(description)).map(([label]) => label);

  if (!core && !technical && !(operator && ancillaryMatches.length)) return null;

  let category = 'Data centre';
  if (!core && technical) category = 'Technical facility';
  if (ancillaryMatches.length && (core || operator)) category = ancillaryMatches[0];

  return { category, ancillary: ancillaryMatches.length > 0, ancillaryMatches };
}

function normaliseFeature(feature) {
  if (!hasIrishPointGeometry(feature)) return null;
  const raw = feature.properties || {};
  const received = parseDateValue(raw.ReceivedDate);
  if (!received || received.getTime() < START_DATE || received.getTime() >= END_DATE) return null;

  const description = clean(raw.DevelopmentDescription);
  const applicant = clean([raw.ApplicantForename, raw.ApplicantSurname].filter(Boolean).join(' '));
  const classification = classifyRecord(description, applicant);
  if (!classification) return null;

  const authority = clean(raw.PlanningAuthority);
  const applicationNumber = clean(raw.ApplicationNumber);
  const decision = clean(raw.Decision || raw.ApplicationStatus);
  const siteAreaHa = parseNumber(raw.AreaofSite);
  const floorAreaSqm = parseNumber(raw.FloorArea);

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
      postcode: clean(raw.DevelopmentPostcode),
      applicant,
      application_status: clean(raw.ApplicationStatus),
      application_type: clean(raw.ApplicationType),
      received_date: normaliseDate(raw.ReceivedDate),
      received_timestamp: received.getTime(),
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
      site_area_ha: siteAreaHa,
      floor_area_sqm: floorAreaSqm,
      category: classification.category,
      ancillary: classification.ancillary,
      ancillary_types: classification.ancillaryMatches,
      source_url: clean(raw.LinkAppDetails)
    }
  };
}

function excerpt(value, length = 230) {
  const text = clean(value);
  return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, '')}…` : text;
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

function pinClass(status) {
  if (status === 'Granted') return 'pin-granted';
  if (status === 'Refused' || status === 'Invalid') return 'pin-refused';
  if (status === 'Withdrawn') return 'pin-withdrawn';
  return 'pin-pending';
}

function formatNumber(value, maximumFractionDigits = 1) {
  return Number(value || 0).toLocaleString('en-IE', { maximumFractionDigits });
}

function renderKpis() {
  const totalSiteArea = data.reduce((sum, feature) => sum + (props(feature).site_area_ha || 0), 0);
  const totalFloorArea = data.reduce((sum, feature) => sum + (props(feature).floor_area_sqm || 0), 0);
  const summary = [
    ['Applications', data.length],
    ['Councils with matches', new Set(data.map(feature => props(feature).planning_authority).filter(Boolean)).size],
    ['Granted', data.filter(feature => props(feature).status_group === 'Granted').length],
    ['Pending', data.filter(feature => props(feature).status_group === 'Pending / other').length],
    ['Appealed', data.filter(feature => props(feature).appeal).length],
    ['Ancillary works', data.filter(feature => props(feature).ancillary).length],
    ['Recorded site area', `${formatNumber(totalSiteArea, 2)} ha`],
    ['Recorded floor area', `${formatNumber(totalFloorArea, 0)} m²`]
  ];
  document.querySelector('#kpis').innerHTML = summary
    .map(([label, value]) => `<div class="kpi"><b>${esc(value)}</b><span>${esc(label)}</span></div>`)
    .join('');
}

function populateAuthorities() {
  const select = document.querySelector('#authority');
  const current = select.value;
  const counts = {};
  data.forEach(feature => {
    const authority = props(feature).planning_authority;
    if (authority) counts[authority] = (counts[authority] || 0) + 1;
  });
  select.innerHTML = '<option value="">All councils with matches</option>';
  Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).forEach(([authority, count]) => {
    select.insertAdjacentHTML('beforeend', `<option value="${esc(authority)}">${esc(authority)} (${count})</option>`);
  });
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function renderCharts() {
  const statuses = ['Granted', 'Pending / other', 'Refused', 'Invalid', 'Withdrawn'];
  const statusCounts = statuses.map(status => data.filter(feature => props(feature).status_group === status).length);
  statusChart?.destroy();
  statusChart = new Chart(document.querySelector('#statusChart'), {
    type: 'doughnut',
    data: { labels: statuses, datasets: [{ data: statusCounts }] },
    options: { animation: false, plugins: { legend: { position: 'bottom' } } }
  });

  const authorityCounts = {};
  data.forEach(feature => {
    const authority = props(feature).planning_authority || 'Unknown';
    authorityCounts[authority] = (authorityCounts[authority] || 0) + 1;
  });
  const top = Object.entries(authorityCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  authorityChart?.destroy();
  authorityChart = new Chart(document.querySelector('#authorityChart'), {
    type: 'bar',
    data: { labels: top.map(item => item[0]), datasets: [{ label: 'Applications', data: top.map(item => item[1]) }] },
    options: { animation: false, indexAxis: 'y', plugins: { legend: { display: false } } }
  });
}

function renderMapAndTable() {
  const selected = filtered();
  if (layer) layer.remove();
  layer = L.geoJSON({ type: 'FeatureCollection', features: selected }, {
    pointToLayer: (feature, latlng) => L.marker(latlng, {
      icon: L.divIcon({
        className: 'map-pin-wrapper',
        html: `<span class="map-pin ${pinClass(props(feature).status_group)}"></span>`,
        iconSize: [24, 32],
        iconAnchor: [12, 30],
        popupAnchor: [0, -28]
      })
    }),
    onEachFeature: (feature, marker) => {
      const item = props(feature);
      const source = item.source_url
        ? `<p><a href="${esc(item.source_url)}" target="_blank" rel="noopener">Open official planning record</a></p>`
        : '';
      const areas = [
        item.site_area_ha ? `${formatNumber(item.site_area_ha, 2)} ha site` : '',
        item.floor_area_sqm ? `${formatNumber(item.floor_area_sqm, 0)} m² floor area` : ''
      ].filter(Boolean).join(' · ');
      marker.bindPopup(
        `<b>${esc(item.project_name)}</b>` +
        `<p>${esc(item.category)} · ${esc(item.application_number)} · ${esc(item.planning_authority)}</p>` +
        `<p><strong>${esc(item.status_group)}</strong>${item.decision ? ` — ${esc(item.decision)}` : ''}</p>` +
        (areas ? `<p>${esc(areas)}</p>` : '') +
        `<p>${esc(excerpt(item.description))}</p>${source}`
      );
    }
  }).addTo(map);

  if (!fittedInitialPins && selected.length && layer.getBounds().isValid()) {
    map.fitBounds(IRELAND_BOUNDS, { animate: false });
    fittedInitialPins = true;
  }
  map.panInsideBounds(IRELAND_BOUNDS, { animate: false });

  const rows = selected.map(feature => {
    const item = props(feature);
    const reference = item.source_url
      ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener">${esc(item.application_number)}</a>`
      : esc(item.application_number);
    return `<tr>` +
      `<td><b>${esc(item.project_name)}</b><br><small>${esc(item.category)} — ${esc(excerpt(item.description, 260))}</small></td>` +
      `<td>${esc(item.applicant)}</td>` +
      `<td>${esc(item.planning_authority)}</td>` +
      `<td>${reference}</td>` +
      `<td>${esc(item.received_date)}</td>` +
      `<td><span class="status-badge status-${lower(item.status_group).replace(/[^a-z0-9]+/g, '-')}">${esc(item.status_group)}</span><br><small>${esc(item.decision)}</small></td>` +
      `<td>${esc(item.appeal)}</td>` +
      `<td>${item.site_area_ha ? `${formatNumber(item.site_area_ha, 2)} ha` : ''}</td>` +
      `<td>${item.floor_area_sqm ? `${formatNumber(item.floor_area_sqm, 0)} m²` : ''}</td>` +
      `</tr>`;
  }).join('');
  document.querySelector('#rows').innerHTML = rows || '<tr><td colspan="9">No data-centre applications match the selected filters.</td></tr>';
}

function renderAll() {
  data = [...records.values()].sort((a, b) => props(b).received_timestamp - props(a).received_timestamp);
  renderKpis();
  populateAuthorities();
  renderCharts();
  renderMapAndTable();
}

async function fetchNewRecords(ids, label) {
  const newIds = [...ids].filter(id => !fetchedObjectIds.has(id));
  newIds.forEach(id => fetchedObjectIds.add(id));
  if (!newIds.length) return;

  const batches = chunks(newIds, 75);
  let completed = 0;
  await runPool(batches, 3, async batch => {
    try {
      const rawFeatures = await fetchFeatureBatch(batch);
      rawFeatures.forEach(rawFeature => {
        const item = normaliseFeature(rawFeature);
        if (!item) return;
        const key = props(item).key || String(props(item).object_id);
        if (!records.has(key)) records.set(key, item);
      });
      completed += 1;
      renderAll();
      setStatus(`Loaded ${data.length.toLocaleString('en-IE')} applications; processing ${label} (${completed}/${batches.length})…`);
    } catch (error) {
      failedSearches.push(`${label}: record batch`);
      console.warn('Record batch failed', error);
    }
  });
}

async function processSearchGroup(group, groupIndex) {
  setStatus(`Searching ${group.label} (${groupIndex + 1}/${SEARCH_GROUPS.length})…`);
  const ids = new Set();
  await runPool(group.terms, 5, async term => {
    try {
      const termIds = await queryTermIds(term);
      termIds.forEach(id => ids.add(id));
    } catch (error) {
      failedSearches.push(term);
      console.warn(`Search failed for ${term}`, error);
    }
  });
  await fetchNewRecords(ids, group.label);
}

function enableControls() {
  ['search', 'status', 'authority', 'download'].forEach(id => {
    document.querySelector(`#${id}`).disabled = false;
  });
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadCsv() {
  const headers = [
    'Project / location', 'Category', 'Applicant', 'Authority', 'Reference', 'Received',
    'Status', 'Decision', 'Appeal', 'Site area (ha)', 'Floor area (m²)',
    'Description', 'Official record', 'Longitude', 'Latitude'
  ];
  const rows = filtered().map(feature => {
    const item = props(feature);
    const [longitude, latitude] = feature.geometry.coordinates;
    return [
      item.project_name, item.category, item.applicant, item.planning_authority,
      item.application_number, item.received_date, item.status_group, item.decision,
      item.appeal, item.site_area_ha || '', item.floor_area_sqm || '', item.description,
      item.source_url, longitude, latitude
    ];
  });
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'irish-data-centre-planning-applications-2016-2026.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialise() {
  document.querySelector('#rows').innerHTML = '<tr><td colspan="9">Searching the national planning register for data-centre and associated campus works…</td></tr>';
  renderKpis();
  renderCharts();

  for (let index = 0; index < SEARCH_GROUPS.length; index += 1) {
    await processSearchGroup(SEARCH_GROUPS[index], index);
  }

  enableControls();
  renderAll();
  const warning = failedSearches.length
    ? ` ${failedSearches.length} searches or batches timed out; refresh to retry them.`
    : '';
  setStatus(`${data.length.toLocaleString('en-IE')} applications mapped across ${new Set(data.map(feature => props(feature).planning_authority).filter(Boolean)).size} councils.${warning}`);
}

['search', 'status', 'authority'].forEach(id => {
  document.querySelector(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', renderMapAndTable);
});
document.querySelector('#download').addEventListener('click', downloadCsv);

initialise().catch(error => {
  console.error(error);
  enableControls();
  setStatus(`The national planning service could not complete the search: ${error.message}. Refresh to retry.`);
});