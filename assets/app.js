const SERVICE = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const IRELAND_BOUNDS = L.latLngBounds([[51.20, -11.20], [55.60, -5.25]]);

const map = L.map('map', {
  maxBounds: IRELAND_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom: 6,
  worldCopyJump: false
}).fitBounds(IRELAND_BOUNDS);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  bounds: IRELAND_BOUNDS,
  noWrap: true,
  minZoom: 6,
  maxZoom: 18
}).addTo(map);

let data = [];
let layer;
let statusChart;
let authorityChart;

const DESCRIPTION_QUERY_TERMS = [
  'DATA CENT', 'DATACENT', 'DATA HALL', 'SERVER HALL', 'SERVER FARM',
  'SERVER ROOM', 'HYPERSCALE', 'COLOCATION', 'CO-LOCATION',
  'CLOUD COMPUT', 'COMPUTE CAMPUS', 'DATA STORAGE',
  'DIGITAL INFRASTRUCTURE', 'ICT FACIL', 'INFORMATION TECHNOLOGY FACIL',
  'COMPUTER FACIL', 'DATA PROCESSING FACIL'
];

const EXPLICIT_PATTERNS = [
  ['data centre', /\bdata[\s-]*cent(?:re|er)s?\b/i],
  ['data hall', /\bdata halls?\b/i],
  ['server hall', /\bserver halls?\b/i],
  ['server farm', /\bserver farms?\b/i],
  ['hyperscale facility', /\bhyperscale(?:\s+(?:data|computing|digital))?(?:\s+(?:centre|center|campus|facility))?\b/i],
  ['colocation facility', /\bco-?location(?:\s+(?:data|computing))?(?:\s+(?:centre|center|campus|facility))\b/i],
  ['cloud-computing facility', /\bcloud computing(?:\s+(?:centre|center|campus|facility))\b/i],
  ['compute campus', /\b(?:ai|high performance|high-performance)?\s*compute campus\b/i],
  ['data-storage facility', /\bdata storage(?:\s+(?:centre|center|campus|facility))\b/i],
  ['digital-infrastructure campus', /\bdigital infrastructure(?:\s+(?:centre|center|campus|facility))\b/i]
];

const INFRASTRUCTURE_PATTERNS = [
  ['server room', /\bserver rooms?\b/i],
  ['ICT facility', /\bict\s+(?:building|campus|centre|center|facility)\b/i],
  ['information-technology facility', /\binformation technology\s+(?:building|campus|centre|center|facility)\b/i],
  ['computer facility', /\bcomputer\s+(?:building|campus|centre|center|facility)\b/i],
  ['data-processing facility', /\bdata processing\s+(?:building|campus|centre|center|facility)\b/i],
  ['generator infrastructure', /\b(?:emergency|standby|backup)?\s*generators?\b/i],
  ['generator compound', /\bgenerator\s+(?:compound|yard|building)\b/i],
  ['substation', /\bsub-?station\b/i],
  ['transformer', /\btransformers?\b/i],
  ['cooling plant', /\bcooling\s+(?:plant|system|equipment|infrastructure)\b/i],
  ['chiller', /\bchillers?\b/i],
  ['switchroom', /\bswitch\s*rooms?\b/i],
  ['energy centre', /\benergy cent(?:re|er)\b/i],
  ['battery storage', /\bbattery energy storage\b/i],
  ['campus', /\bcampus\b/i]
];

const FALSE_POSITIVE_PATTERNS = [
  /\bcentre for data\b/i,
  /\bdata collection cent(?:re|er)\b/i,
  /\bdata analytics cent(?:re|er)\b/i,
  /\bdata processing office\b/i,
  /\btraining cent(?:re|er)\b/i,
  /\bcommunity cent(?:re|er)\b/i,
  /\brecycling cent(?:re|er)\b/i
];

const OUT_FIELDS = [
  'OBJECTID', 'PlanningAuthority', 'ApplicationNumber', 'DevelopmentDescription',
  'DevelopmentAddress', 'DevelopmentPostcode', 'ApplicationStatus',
  'ApplicationType', 'ApplicantForename', 'ApplicantSurname', 'Decision',
  'ReceivedDate', 'DecisionDate', 'GrantDate', 'ExpiryDate', 'AppealRefNumber',
  'AppealStatus', 'AppealDecision', 'AppealDecisionDate', 'AppealSubmittedDate',
  'FIRequestDate', 'FIRecDate', 'FloorArea', 'AreaofSite', 'LinkAppDetails'
].join(',');

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const props = feature => feature.properties || {};
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLowerCase();

function setStatus(message) {
  document.querySelector('#updated').textContent = message;
}

function normaliseDate(value) {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function planningStatus(value) {
  const text = lower(value);
  if (text.includes('grant') || text.includes('conditional') || text.includes('unconditional')) return 'Granted';
  if (text.includes('refus')) return 'Refused';
  if (text.includes('withdraw')) return 'Withdrawn';
  if (text.includes('invalid')) return 'Invalid';
  return 'Pending / other';
}

function classifyDescription(description) {
  const text = clean(description);
  const explicit = EXPLICIT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const infrastructure = INFRASTRUCTURE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const falsePositive = FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(text));

  if (falsePositive && !explicit.length) {
    return { flag: 'excluded', score: 0, reasons: { false_positive: true } };
  }

  if (explicit.length) {
    return {
      flag: 'confirmed',
      score: Math.min(100, 92 + explicit.length * 2 + Math.min(4, infrastructure.length)),
      reasons: { description_matches: explicit, associated_infrastructure: infrastructure }
    };
  }

  const hasTechnicalFacility = infrastructure.some(item => [
    'server room', 'ICT facility', 'information-technology facility',
    'computer facility', 'data-processing facility'
  ].includes(item));
  const enablingInfrastructure = infrastructure.filter(item => ![
    'server room', 'ICT facility', 'information-technology facility',
    'computer facility', 'data-processing facility', 'campus'
  ].includes(item));

  if (hasTechnicalFacility && enablingInfrastructure.length >= 2) {
    return {
      flag: 'probable',
      score: Math.min(89, 70 + enablingInfrastructure.length * 4),
      reasons: { technical_facility: infrastructure, enabling_infrastructure: enablingInfrastructure }
    };
  }

  if (hasTechnicalFacility && enablingInfrastructure.length >= 1) {
    return {
      flag: 'review',
      score: 58,
      reasons: { technical_facility: infrastructure, enabling_infrastructure: enablingInfrastructure }
    };
  }

  return { flag: 'excluded', score: 0, reasons: {} };
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function fetchJson(params) {
  const url = `${SERVICE}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`ArcGIS request failed (${response.status})`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'ArcGIS query error');
  return json;
}

async function queryDescriptionIds() {
  const ids = new Set();
  for (const batch of chunks(DESCRIPTION_QUERY_TERMS, 4)) {
    const where = batch
      .map(term => `UPPER(DevelopmentDescription) LIKE '%${term.replaceAll("'", "''")}%'`)
      .join(' OR ');
    const json = await fetchJson({ f: 'json', where, returnIdsOnly: 'true' });
    (json.objectIds || []).forEach(id => ids.add(id));
  }
  return ids;
}

async function fetchFeaturesByIds(ids) {
  const features = [];
  for (const batch of chunks([...ids], 200)) {
    const json = await fetchJson({
      f: 'geojson',
      objectIds: batch.join(','),
      outFields: OUT_FIELDS,
      returnGeometry: 'true',
      outSR: '4326'
    });
    features.push(...(json.features || []));
  }
  return features;
}

async function loadOverrides() {
  try {
    const response = await fetch('data/manual_overrides.json', { cache: 'no-store' });
    if (!response.ok) return { include: [], exclude: [] };
    return await response.json();
  } catch {
    return { include: [], exclude: [] };
  }
}

async function fetchManualIncludes(includes) {
  const features = [];
  for (const item of includes || []) {
    const [authority, reference] = String(item.key || '').split('|');
    if (!reference) continue;
    const whereParts = [`ApplicationNumber='${reference.replaceAll("'", "''")}'`];
    if (authority) whereParts.push(`UPPER(PlanningAuthority)='${authority.replaceAll("'", "''").toUpperCase()}'`);
    const json = await fetchJson({
      f: 'geojson',
      where: whereParts.join(' AND '),
      outFields: OUT_FIELDS,
      returnGeometry: 'true',
      outSR: '4326'
    });
    features.push(...(json.features || []));
  }
  return features;
}

function hasIrishPointGeometry(feature) {
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length < 2) return false;
  const [longitude, latitude] = coordinates.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return IRELAND_BOUNDS.contains(L.latLng(latitude, longitude));
}

function normaliseFeature(feature, overrideMap, excludedKeys) {
  if (!hasIrishPointGeometry(feature)) return null;

  const raw = feature.properties || {};
  const authority = clean(raw.PlanningAuthority);
  const applicationNumber = clean(raw.ApplicationNumber);
  const key = `${authority.toUpperCase()}|${applicationNumber.toUpperCase()}`;
  if (excludedKeys.has(key)) return null;

  const description = clean(raw.DevelopmentDescription);
  const address = clean(raw.DevelopmentAddress);
  const applicant = clean([raw.ApplicantForename, raw.ApplicantSurname].filter(Boolean).join(' '));
  let result = classifyDescription(description);
  const override = overrideMap.get(key);

  if (override) {
    result = {
      flag: override.flag || 'confirmed',
      score: Number(override.confidence_score || 100),
      reasons: { manual_override: override.notes || '' }
    };
  }
  if (result.flag === 'excluded') return null;

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      key,
      planning_authority: authority,
      application_number: applicationNumber,
      description,
      address,
      applicant,
      application_status: clean(raw.ApplicationStatus),
      application_type: clean(raw.ApplicationType),
      received_date: normaliseDate(raw.ReceivedDate),
      decision: clean(raw.Decision || raw.ApplicationStatus),
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
      source_url: clean(raw.LinkAppDetails),
      flag: result.flag,
      confidence_score: result.score,
      flag_reasons: result.reasons,
      project_name: override?.project_name || address || applicationNumber,
      operator: override?.operator || applicant,
      last_checked: new Date().toISOString()
    }
  };
}

async function loadLiveData() {
  setStatus('Searching every planning description for data-centre development…');
  const [ids, overrides] = await Promise.all([queryDescriptionIds(), loadOverrides()]);
  setStatus(`Reviewing ${ids.size.toLocaleString('en-IE')} description matches…`);

  const [features, manualFeatures] = await Promise.all([
    fetchFeaturesByIds(ids),
    fetchManualIncludes(overrides.include || [])
  ]);

  const unique = new Map();
  [...features, ...manualFeatures].forEach(feature => {
    const raw = feature.properties || {};
    const key = `${clean(raw.PlanningAuthority).toUpperCase()}|${clean(raw.ApplicationNumber).toUpperCase()}`;
    const fallbackKey = String(raw.OBJECTID ?? JSON.stringify(feature.geometry));
    const stableKey = key === '|' ? fallbackKey : key;
    if (!unique.has(stableKey) || (!unique.get(stableKey).geometry && feature.geometry)) unique.set(stableKey, feature);
  });

  const overrideMap = new Map((overrides.include || []).map(item => [String(item.key || '').toUpperCase(), item]));
  const excludedKeys = new Set((overrides.exclude || []).map(item => String(item).toUpperCase()));

  return [...unique.values()]
    .map(feature => normaliseFeature(feature, overrideMap, excludedKeys))
    .filter(Boolean)
    .sort((a, b) => String(props(b).received_date).localeCompare(String(props(a).received_date)));
}

async function loadFallbackData() {
  const response = await fetch('data/data-centres.geojson', { cache: 'no-store' });
  if (!response.ok) throw new Error('Repository fallback data is unavailable');
  const collection = await response.json();
  return (collection.features || []).filter(hasIrishPointGeometry);
}

function filtered() {
  const query = document.querySelector('#search').value.toLowerCase();
  const authority = document.querySelector('#authority').value;
  const flag = document.querySelector('#flag').value;
  return data.filter(feature => {
    const item = props(feature);
    return (!query || JSON.stringify(item).toLowerCase().includes(query)) &&
      (!authority || item.planning_authority === authority) &&
      (flag === 'all' || flag.split(',').includes(item.flag));
  });
}

function renderKpis() {
  const summary = {
    applications: data.length,
    confirmed: data.filter(item => props(item).flag === 'confirmed').length,
    probable: data.filter(item => props(item).flag === 'probable').length,
    review: data.filter(item => props(item).flag === 'review').length,
    authorities: new Set(data.map(item => props(item).planning_authority).filter(Boolean)).size,
    appealed: data.filter(item => props(item).appeal).length
  };
  document.querySelector('#kpis').innerHTML = Object.entries(summary)
    .map(([key, value]) => `<div class="kpi"><b>${value}</b><span>${esc(key)}</span></div>`)
    .join('');
}

function populateAuthorities() {
  const select = document.querySelector('#authority');
  select.innerHTML = '<option value="">All authorities</option>';
  [...new Set(data.map(item => props(item).planning_authority).filter(Boolean))]
    .sort()
    .forEach(authority => select.insertAdjacentHTML('beforeend', `<option>${esc(authority)}</option>`));
}

function render() {
  const selected = filtered();
  if (layer) layer.remove();

  layer = L.geoJSON({ type: 'FeatureCollection', features: selected }, {
    filter: hasIrishPointGeometry,
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 7,
      weight: 2,
      fillOpacity: 0.8,
      color: props(feature).flag === 'confirmed' ? '#0d6b4d' : props(feature).flag === 'probable' ? '#b66a00' : '#a83f39'
    }),
    onEachFeature: (feature, marker) => {
      const item = props(feature);
      marker.bindPopup(`<b>${esc(item.project_name)}</b><br>${esc(item.application_number)} · ${esc(item.planning_authority)}<br><span class="badge ${esc(item.flag)}">${esc(item.flag)}</span> ${esc(item.confidence_score)}%<p>${esc(item.description)}</p>${item.source_url ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener">Official planning record</a>` : ''}`);
    }
  }).addTo(map);

  if (selected.length && layer.getBounds().isValid()) {
    map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 11 });
  } else {
    map.fitBounds(IRELAND_BOUNDS);
  }
  map.panInsideBounds(IRELAND_BOUNDS, { animate: false });

  const statuses = {};
  selected.forEach(item => {
    const key = planningStatus(props(item).decision);
    statuses[key] = (statuses[key] || 0) + 1;
  });
  statusChart?.destroy();
  statusChart = new Chart(document.querySelector('#statusChart'), {
    type: 'doughnut',
    data: { labels: Object.keys(statuses), datasets: [{ data: Object.values(statuses) }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  const authorities = {};
  selected.forEach(item => {
    const key = props(item).planning_authority || 'Unknown';
    authorities[key] = (authorities[key] || 0) + 1;
  });
  const topAuthorities = Object.entries(authorities).sort((a, b) => b[1] - a[1]).slice(0, 8);
  authorityChart?.destroy();
  authorityChart = new Chart(document.querySelector('#authorityChart'), {
    type: 'bar',
    data: {
      labels: topAuthorities.map(item => item[0]),
      datasets: [{ label: 'Applications', data: topAuthorities.map(item => item[1]) }]
    },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } }
  });

  document.querySelector('#rows').innerHTML = selected.map(feature => {
    const item = props(feature);
    return `<tr><td><span class="badge ${esc(item.flag)}">${esc(item.flag)}</span></td><td><b>${esc(item.project_name)}</b><br><small>${esc(item.applicant)}</small></td><td>${esc(item.planning_authority)}</td><td>${item.source_url ? `<a target="_blank" rel="noopener" href="${esc(item.source_url)}">${esc(item.application_number)}</a>` : esc(item.application_number)}</td><td>${esc(item.received_date)}</td><td>${esc(item.decision)}</td><td>${esc(item.appeal)}</td><td>${esc(item.confidence_score)}%</td></tr>`;
  }).join('') || '<tr><td colspan="8">No Irish data-centre applications match the selected filters.</td></tr>';
}

function exportCsv() {
  const keys = [
    'flag', 'confidence_score', 'project_name', 'operator', 'planning_authority',
    'application_number', 'address', 'received_date', 'decision', 'decision_date',
    'appeal', 'description', 'source_url'
  ];
  const rows = [keys, ...filtered().map(feature => keys.map(key => props(feature)[key] ?? ''))];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'irish-data-centre-planning-applications.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialise() {
  let source = 'live national planning database';
  try {
    data = await loadLiveData();
    if (!data.length) throw new Error('The description search returned no verified Irish data-centre records');
  } catch (error) {
    console.error(error);
    source = 'repository fallback';
    setStatus('Live query unavailable; loading repository fallback…');
    data = await loadFallbackData();
  }

  renderKpis();
  populateAuthorities();
  render();
  setStatus(`${data.length.toLocaleString('en-IE')} description-matched planning applications plotted within Ireland · Source: ${source} · Checked ${new Date().toLocaleString('en-IE')}`);
}

['search', 'flag', 'authority'].forEach(id => {
  const element = document.querySelector(`#${id}`);
  element.addEventListener(id === 'search' ? 'input' : 'change', render);
});
document.querySelector('#download').addEventListener('click', exportCsv);

initialise().catch(error => {
  console.error(error);
  setStatus(`Data could not be loaded: ${error.message}`);
  document.querySelector('#rows').innerHTML = `<tr><td colspan="8">Data could not be loaded: ${esc(error.message)}</td></tr>`;
  map.fitBounds(IRELAND_BOUNDS);
});
