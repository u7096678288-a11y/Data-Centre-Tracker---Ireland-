const SERVICE = 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query';
const IRELAND_BOUNDS = L.latLngBounds([[51.30, -10.85], [55.45, -5.85]]);

const map = L.map('map', {
  maxBounds: IRELAND_BOUNDS,
  maxBoundsViscosity: 1,
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

const QUERY_TERMS = [
  'data centre', 'data center', 'data-centre', 'data-center', 'datacentre',
  'datacenter', 'data hall', 'server hall', 'server farm', 'hyperscale',
  'colocation', 'co-location', 'cloud computing centre', 'cloud computing center',
  'cloud computing campus', 'compute campus', 'data storage facility',
  'digital infrastructure campus'
];

const DATA_CENTRE_PATTERNS = [
  /\bdata[\s-]*cent(?:re|er)s?\b/i,
  /\bdata halls?\b/i,
  /\bserver halls?\b/i,
  /\bserver farms?\b/i,
  /\bhyperscale\b/i,
  /\bco-?location\b/i,
  /\bcloud computing\s+(?:cent(?:re|er)|campus|facility)\b/i,
  /\b(?:ai|high[- ]performance)?\s*compute campus\b/i,
  /\bdata storage facility\b/i,
  /\bdigital infrastructure\s+(?:cent(?:re|er)|campus|facility)\b/i
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

const props = feature => feature.properties || {};
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLowerCase();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function setStatus(message) {
  document.querySelector('#updated').textContent = message;
}

function arcgisJsonp(params) {
  return new Promise((resolve, reject) => {
    const callbackName = `__irish_dc_${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The national planning service did not respond in time.'));
    }, 30000);

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

async function queryTermIds(term) {
  const variants = [...new Set([term.toLowerCase(), term.toUpperCase(), titleCase(term)])];
  const where = variants
    .map(variant => `DevelopmentDescription LIKE '%${sqlEscape(variant)}%'`)
    .join(' OR ');
  const response = await arcgisJsonp({ where, returnIdsOnly: 'true' });
  return response.objectIds || [];
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function fetchFeaturesByIds(ids) {
  const features = [];
  for (const batch of chunks([...ids], 100)) {
    const response = await arcgisJsonp({
      objectIds: batch.join(','),
      outFields: OUT_FIELDS,
      returnGeometry: 'true',
      outSR: '4326'
    });
    for (const feature of response.features || []) {
      const geometry = feature.geometry;
      if (!geometry || !Number.isFinite(Number(geometry.x)) || !Number.isFinite(Number(geometry.y))) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(geometry.x), Number(geometry.y)] },
        properties: feature.attributes || {}
      });
    }
  }
  return features;
}

function isDataCentreDescription(description) {
  return DATA_CENTRE_PATTERNS.some(pattern => pattern.test(clean(description)));
}

function hasIrishPointGeometry(feature) {
  const coordinates = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) return false;
  const [longitude, latitude] = coordinates.map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) &&
    IRELAND_BOUNDS.contains(L.latLng(latitude, longitude));
}

function normaliseDate(value) {
  if (!value) return '';
  const date = new Date(Number.isFinite(Number(value)) ? Number(value) : value);
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

function markerColour(status) {
  if (status === 'Granted') return '#0d6b4d';
  if (status === 'Refused' || status === 'Invalid') return '#a83f39';
  if (status === 'Withdrawn') return '#6f7d78';
  return '#b66a00';
}

function normaliseFeature(feature) {
  if (!hasIrishPointGeometry(feature)) return null;
  const raw = feature.properties || {};
  const description = clean(raw.DevelopmentDescription);
  if (!isDataCentreDescription(description)) return null;

  const authority = clean(raw.PlanningAuthority);
  const applicationNumber = clean(raw.ApplicationNumber);
  const applicant = clean([raw.ApplicantForename, raw.ApplicantSurname].filter(Boolean).join(' '));
  const decision = clean(raw.Decision || raw.ApplicationStatus);

  return {
    type: 'Feature',
    geometry: feature.geometry,
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
  setStatus('Searching national planning descriptions for data centres…');
  const ids = new Set();
  const failedTerms = [];

  for (let index = 0; index < QUERY_TERMS.length; index += 1) {
    const term = QUERY_TERMS[index];
    setStatus(`Searching planning descriptions (${index + 1} of ${QUERY_TERMS.length})…`);
    try {
      const termIds = await queryTermIds(term);
      termIds.forEach(id => ids.add(id));
    } catch (error) {
      console.warn(`Search failed for ${term}:`, error);
      failedTerms.push(term);
    }
  }

  if (!ids.size) {
    throw new Error('No records could be retrieved from the national planning service.');
  }

  setStatus(`Loading ${ids.size.toLocaleString('en-IE')} planning records…`);
  const rawFeatures = await fetchFeaturesByIds(ids);
  const unique = new Map();

  rawFeatures.forEach(feature => {
    const item = normaliseFeature(feature);
    if (!item) return;
    const key = props(item).key || String(feature.properties?.OBJECTID || JSON.stringify(item.geometry));
    if (!unique.has(key)) unique.set(key, item);
  });

  const results = [...unique.values()].sort((a, b) => {
    const left = props(a).received_date.split('/').reverse().join('');
    const right = props(b).received_date.split('/').reverse().join('');
    return right.localeCompare(left);
  });

  if (!results.length) {
    throw new Error('No explicit data-centre descriptions were found.');
  }

  if (failedTerms.length) {
    console.warn('Some search terms could not be checked:', failedTerms);
  }
  return results;
}

function filtered() {
  const query = lower(document.querySelector('#search').value);
  const authority = document.querySelector('#authority').value;
  const selectedStatus = document.querySelector('#status').value;

  return data.filter(feature => {
    const item = props(feature);
    const matchesText = !query || JSON.stringify(item).toLowerCase().includes(query);
    const matchesAuthority = !authority || item.planning_authority === authority;
    const matchesStatus = !selectedStatus || item.status_group === selectedStatus;
    return matchesText && matchesAuthority && matchesStatus;
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

function render() {
  const selected = filtered();
  if (layer) layer.remove();

  layer = L.geoJSON({ type: 'FeatureCollection', features: selected }, {
    pointToLayer: (feature, latlng) => {
      const status = props(feature).status_group;
      return L.circleMarker(latlng, {
        radius: 7,
        weight: 2,
        fillOpacity: 0.82,
        color: markerColour(status),
        fillColor: markerColour(status)
      });
    },
    onEachFeature: (feature, marker) => {
      const item = props(feature);
      const source = item.source_url
        ? `<p><a href="${esc(item.source_url)}" target="_blank" rel="noopener">Open official planning record</a></p>`
        : '';
      marker.bindPopup(
        `<b>${esc(item.project_name)}</b>` +
        `<p>${esc(item.application_number)} · ${esc(item.planning_authority)}</p>` +
        `<p><strong>${esc(item.status_group)}</strong>${item.decision ? ` — ${esc(item.decision)}` : ''}</p>` +
        `<p>${esc(item.description)}</p>${source}`
      );
    }
  }).addTo(map);

  if (selected.length && layer.getBounds().isValid()) {
    map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 11 });
  } else {
    map.fitBounds(IRELAND_BOUNDS);
  }
  map.panInsideBounds(IRELAND_BOUNDS, { animate: false });

  const statusCounts = {};
  selected.forEach(feature => {
    const status = props(feature).status_group;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  statusChart?.destroy();
  statusChart = new Chart(document.querySelector('#statusChart'), {
    type: 'doughnut',
    data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts) }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  const authorityCounts = {};
  selected.forEach(feature => {
    const authority = props(feature).planning_authority || 'Unknown';
    authorityCounts[authority] = (authorityCounts[authority] || 0) + 1;
  });
  const topAuthorities = Object.entries(authorityCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
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
    const reference = item.source_url
      ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener">${esc(item.application_number)}</a>`
      : esc(item.application_number);
    return `<tr>` +
      `<td><b>${esc(item.project_name)}</b><br><small>${esc(item.description)}</small></td>` +
      `<td>${esc(item.applicant)}</td>` +
      `<td>${esc(item.planning_authority)}</td>` +
      `<td>${reference}</td>` +
      `<td>${esc(item.received_date)}</td>` +
      `<td><span class="status-badge status-${esc(item.status_group.toLowerCase().replace(/[^a-z]+/g, '-'))}">${esc(item.status_group)}</span><br><small>${esc(item.decision)}</small></td>` +
      `<td>${esc(item.appeal)}</td>` +
      `</tr>`;
  }).join('') || '<tr><td colspan="7">No data-centre applications match the selected filters.</td></tr>';
}

function exportCsv() {
  const keys = [
    'project_name', 'applicant', 'planning_authority', 'application_number',
    'address', 'received_date', 'status_group', 'decision', 'decision_date',
    'appeal', 'appeal_status', 'description', 'source_url'
  ];
  const rows = [keys, ...filtered().map(feature => keys.map(key => props(feature)[key] ?? ''))];
  const csv = rows
    .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'irish-data-centre-planning-applications.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialise() {
  data = await loadLiveData();
  renderKpis();
  populateAuthorities();
  render();
  setStatus(`${data.length.toLocaleString('en-IE')} data-centre planning applications mapped in Ireland · Checked ${new Date().toLocaleString('en-IE')}`);
}

['search', 'authority', 'status'].forEach(id => {
  const element = document.querySelector(`#${id}`);
  element.addEventListener(id === 'search' ? 'input' : 'change', render);
});
document.querySelector('#download').addEventListener('click', exportCsv);

initialise().catch(error => {
  console.error(error);
  setStatus(`The planning data could not be loaded: ${error.message}`);
  document.querySelector('#rows').innerHTML = `<tr><td colspan="7">The planning data could not be loaded: ${esc(error.message)}</td></tr>`;
  map.fitBounds(IRELAND_BOUNDS);
});
