const SERVICE = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const map = L.map('map').setView([53.35, -7.7], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let data = [];
let layer;
let statusChart;
let authorityChart;

const STRONG_PHRASES = [
  'data centre', 'data center', 'datacentre', 'datacenter', 'data hall',
  'server hall', 'server farm', 'server facility', 'hyperscale', 'co-location',
  'colocation', 'cloud computing campus', 'compute campus', 'ai compute campus',
  'high performance computing campus', 'data storage facility',
  'digital infrastructure campus'
];

const OPERATOR_TERMS = [
  'microsoft', 'amazon', 'google', 'facebook', 'echelon', 'equinix',
  'digital realty', 'vantage', 'edgeconnex', 'keppel', 'crusoe', 'greenergy',
  'engine node', 'herbata', 'art data centres', 'pure data centres',
  'k2 strategic infrastructure ireland', 'cloudhq', 'cyrusone', 'interxion',
  'dataplex', 'digital reef'
];

const SUPPORTING_TERMS = [
  'digital infrastructure', 'backup generator', 'emergency generator',
  'generator compound', 'substation', 'transformer', 'cooling plant', 'chiller',
  'campus', 'energy centre', 'electrical switchroom', 'battery energy storage',
  'server', 'data hall'
];

const FALSE_POSITIVES = [
  'centre for data', 'data collection centre', 'data processing office',
  'training centre', 'community centre', 'recycling centre'
];

const SEARCH_TERMS = [
  'DATA CENT', 'DATACENT', 'DATA HALL', 'SERVER HALL', 'SERVER FARM',
  'HYPERSCALE', 'COLOCATION', 'CO-LOCATION', 'DIGITAL INFRASTRUCTURE',
  'CLOUD COMPUTING', 'COMPUTE CAMPUS', 'DATA STORAGE FACILITY'
];

const OPERATOR_SEARCH_TERMS = [
  'MICROSOFT', 'AMAZON', 'GOOGLE', 'FACEBOOK', 'ECHELON', 'EQUINIX',
  'DIGITAL REALTY', 'VANTAGE', 'EDGECONNEX', 'KEPPEL', 'CRUSOE',
  'ENGINE NODE', 'HERBATA', 'ART DATA', 'PURE DATA', 'K2 STRATEGIC',
  'CLOUDHQ', 'CYRUSONE', 'INTERXION', 'DATAPLEX', 'DIGITAL REEF'
];

const OUT_FIELDS = [
  'OBJECTID', 'PlanningAuthority', 'ApplicationNumber', 'DevelopmentDescription',
  'DevelopmentAddress', 'DevelopmentPostcode', 'ApplicationStatus',
  'ApplicationType', 'ApplicantForename', 'ApplicantSurname', 'Decision',
  'ReceivedDate', 'DecisionDate', 'GrantDate', 'ExpiryDate', 'AppealRefNumber',
  'AppealStatus', 'AppealDecision', 'AppealDecisionDate', 'AppealSubmittedDate',
  'FIRequestDate', 'FIRecDate', 'FloorArea', 'AreaofSite', 'LinkAppDetails'
].join(',');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const props = feature => feature.properties || {};
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLowerCase();

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
  return 'Pending / other';
}

function classify(text) {
  const value = lower(text);
  const strong = STRONG_PHRASES.filter(term => value.includes(term));
  const operators = OPERATOR_TERMS.filter(term => value.includes(term));
  const supporting = SUPPORTING_TERMS.filter(term => value.includes(term));
  const falseMatches = FALSE_POSITIVES.filter(term => value.includes(term));

  if (falseMatches.length && !strong.length) {
    return { flag: 'excluded', score: 0, reasons: { false_positive: falseMatches } };
  }
  if (strong.length) {
    return {
      flag: 'confirmed',
      score: Math.min(100, 90 + strong.length * 2),
      reasons: { strong, operator: operators, supporting }
    };
  }
  if (operators.length && supporting.length) {
    return {
      flag: 'probable',
      score: Math.min(89, 65 + operators.length * 5 + supporting.length * 3),
      reasons: { operator: operators, supporting }
    };
  }
  if (supporting.length >= 2 && ['server', 'digital', 'cloud', 'compute'].some(term => value.includes(term))) {
    return { flag: 'review', score: 55, reasons: { supporting } };
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
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ArcGIS request failed (${response.status})`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'ArcGIS query error');
  return json;
}

async function queryIds(field, terms) {
  const ids = new Set();
  for (const batch of chunks(terms, 5)) {
    const where = batch.map(term => `UPPER(${field}) LIKE '%${term.replaceAll("'", "''")}%'`).join(' OR ');
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

function normaliseFeature(feature, overrideMap, excludedKeys) {
  const raw = feature.properties || {};
  const authority = clean(raw.PlanningAuthority);
  const applicationNumber = clean(raw.ApplicationNumber);
  const key = `${authority.toUpperCase()}|${applicationNumber.toUpperCase()}`;
  if (excludedKeys.has(key)) return null;

  const description = clean(raw.DevelopmentDescription);
  const address = clean(raw.DevelopmentAddress);
  const applicant = clean([raw.ApplicantForename, raw.ApplicantSurname].filter(Boolean).join(' '));
  const text = [description, address, applicant].join(' | ');
  let result = classify(text);
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
  setStatus('Searching the national planning database…');
  const [descriptionIds, forenameIds, surnameIds, overrides] = await Promise.all([
    queryIds('DevelopmentDescription', [...SEARCH_TERMS, ...OPERATOR_SEARCH_TERMS]),
    queryIds('ApplicantForename', OPERATOR_SEARCH_TERMS),
    queryIds('ApplicantSurname', OPERATOR_SEARCH_TERMS),
    loadOverrides()
  ]);

  const ids = new Set([...descriptionIds, ...forenameIds, ...surnameIds]);
  setStatus(`Reviewing ${ids.size.toLocaleString('en-IE')} planning candidates…`);

  const [features, manualFeatures] = await Promise.all([
    fetchFeaturesByIds(ids),
    fetchManualIncludes(overrides.include || [])
  ]);

  const unique = new Map();
  [...features, ...manualFeatures].forEach(feature => {
    const id = feature.properties?.OBJECTID ?? JSON.stringify(feature.geometry);
    unique.set(id, feature);
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
  return collection.features || [];
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
    total: data.length,
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

  if (selected.length) {
    try { map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 12 }); } catch {}
  }

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
    data: { labels: topAuthorities.map(item => item[0]), datasets: [{ label: 'Applications', data: topAuthorities.map(item => item[1]) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } }
  });

  document.querySelector('#rows').innerHTML = selected.map(feature => {
    const item = props(feature);
    return `<tr><td><span class="badge ${esc(item.flag)}">${esc(item.flag)}</span></td><td><b>${esc(item.project_name)}</b><br><small>${esc(item.applicant)}</small></td><td>${esc(item.planning_authority)}</td><td>${item.source_url ? `<a target="_blank" rel="noopener" href="${esc(item.source_url)}">${esc(item.application_number)}</a>` : esc(item.application_number)}</td><td>${esc(item.received_date)}</td><td>${esc(item.decision)}</td><td>${esc(item.appeal)}</td><td>${esc(item.confidence_score)}%</td></tr>`;
  }).join('') || '<tr><td colspan="8">No records match the selected filters.</td></tr>';
}

function setStatus(message) {
  document.querySelector('#updated').textContent = message;
}

function exportCSV() {
  const keys = ['flag', 'confidence_score', 'project_name', 'operator', 'planning_authority', 'application_number', 'address', 'received_date', 'decision', 'decision_date', 'appeal', 'description', 'source_url'];
  const rows = [keys, ...filtered().map(item => keys.map(key => props(item)[key] ?? ''))];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'irish-data-centre-planning-filtered.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialise() {
  try {
    data = await loadLiveData();
    if (!data.length) throw new Error('The live query returned no classified records');
    setStatus(`Live national query completed ${new Date().toLocaleString('en-IE')} · ${data.length.toLocaleString('en-IE')} classified records`);
  } catch (error) {
    console.error(error);
    try {
      data = await loadFallbackData();
      setStatus(`Live query unavailable; showing repository snapshot · ${error.message}`);
    } catch (fallbackError) {
      setStatus(`Data could not be loaded: ${fallbackError.message}`);
      document.querySelector('#rows').innerHTML = `<tr><td colspan="8">${esc(fallbackError.message)}</td></tr>`;
      return;
    }
  }

  renderKpis();
  populateAuthorities();
  render();
}

['search', 'flag', 'authority'].forEach(id => {
  document.querySelector(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', render);
});
document.querySelector('#download').addEventListener('click', exportCSV);

initialise();
