const SHAPEFILE_BASE = '/data/shp/hermes_NPL_new_wgs_3';
const PILLAR_COLORS = {
  combined_spi: '#0f172a',
  exclusion_index: '#ef4444',
  poverty_index: '#f59e0b',
  vulnerability_index: '#10b981',
};

let map;
let wardLayer;
let gaugeChart;
let pieChart;
let barChart;
let wards = [];
let municipalityIndex = new Map();
let selectedMunicipality = '';
let selectedPillar = 'combined_spi';
let activeWardId = '';
let hasBootstrapped = false;
const MAX_MUNICIPALITIES = 7;

function waitForLibraries(timeoutMs = 10000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (window.L && window.ApexCharts && window.Chart && window.shp) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('dashboard libraries did not finish loading'));
        return;
      }

      window.requestAnimationFrame(check);
    };

    check();
  });
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function hashCode(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function scoreFromKey(key, offset = 0) {
  const hash = hashCode(`${key}:${offset}`);
  return round(0.12 + (hash % 7400) / 10000, 2);
}

function getColor(value) {
  if (value >= 0.8) return '#0f766e';
  if (value >= 0.68) return '#16a34a';
  if (value >= 0.55) return '#84cc16';
  if (value >= 0.42) return '#facc15';
  if (value >= 0.3) return '#f59e0b';
  return '#ef4444';
}

function humanizeName(value, fallback) {
  if (!value) return fallback;
  return String(value).replace(/\s+/g, ' ').trim();
}

async function fetchBinary(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.arrayBuffer();
}

async function loadWardShapefile() {
  // Try the simple url-based load first (works when served over HTTP)
  try {
    const raw = await window.shp(SHAPEFILE_BASE);
    const collection = Array.isArray(raw) ? raw[0] : raw;
    if (!collection || !collection.features || collection.features.length === 0) {
      throw new Error('no layers found in url-load');
    }
    return normalizeWardFeatures(collection);
  } catch (urlErr) {
    // fallback: fetch individual binary components (useful when server responds correctly)
    try {
      const [shp, dbf, shx, prj, cpg] = await Promise.all([
        fetchBinary(`${SHAPEFILE_BASE}.shp`),
        fetchBinary(`${SHAPEFILE_BASE}.dbf`),
        fetchBinary(`${SHAPEFILE_BASE}.shx`),
        fetchBinary(`${SHAPEFILE_BASE}.prj`).catch(() => null),
        fetchBinary(`${SHAPEFILE_BASE}.cpg`).catch(() => null),
      ]);

      const rawGeoJson = await window.shp({ shp, dbf, shx, prj, cpg });
      const collection = Array.isArray(rawGeoJson) ? rawGeoJson[0] : rawGeoJson;
      if (!collection || !collection.features || collection.features.length === 0) {
        throw new Error('no layers found in binary-load');
      }
      return normalizeWardFeatures(collection);
    } catch (binErr) {
      // rethrow with combined message
      const message = `URL error: ${urlErr.message}; binary error: ${binErr.message}`;
      throw new Error(message);
    }
  }
}

function normalizeWardFeatures(collection) {
  const municipalityCounters = new Map();
  const features = collection.features.map((feature, index) => {
    const props = feature.properties || {};
    const municipality = humanizeName(props.LOCAL || props.local || props.MUNICIPALITY || 'Unknown municipality', 'Unknown municipality');
    const district = humanizeName(props.DISTRICT || props.district || '', '');
    const province = humanizeName(props.PR_NAME || props.PROVINCE || '', '');
    const type = humanizeName(props.TYPE || props.type || 'Ward', 'Ward');
    const nextWardNumber = (municipalityCounters.get(municipality) || 0) + 1;
    municipalityCounters.set(municipality, nextWardNumber);

    const key = `${municipality}-${district}-${index}`;
    const exclusion = scoreFromKey(key, 1);
    const poverty = scoreFromKey(key, 2);
    const vulnerability = scoreFromKey(key, 3);
    const combined = round((exclusion * 0.3) + (poverty * 0.35) + (vulnerability * 0.35), 2);

    return {
      ...feature,
      properties: {
        ...props,
        ward_id: `ward-${index + 1}`,
        ward_name: props.ward_name || `${municipality} ${type} ${nextWardNumber}`,
        municipality_name: municipality,
        district_name: district,
        province_name: province,
        type_name: type,
        ward_number: nextWardNumber,
        exclusion_index: exclusion,
        poverty_index: poverty,
        vulnerability_index: vulnerability,
        combined_spi: combined,
      },
    };
  });

  return { type: 'FeatureCollection', features };
}

function groupByMunicipality(featureCollection) {
  const grouped = new Map();
  featureCollection.features.forEach((feature) => {
    const municipality = feature.properties.municipality_name;
    if (!grouped.has(municipality)) {
      grouped.set(municipality, []);
    }
    grouped.get(municipality).push(feature);
  });
  return grouped;
}

function buildMunicipalityIndex(featureCollection, limit = null) {
  const grouped = groupByMunicipality(featureCollection);
  const summaries = [...grouped.entries()].map(([name, features]) => {
    const totals = features.reduce((accumulator, feature) => {
      accumulator.exclusion += feature.properties.exclusion_index;
      accumulator.poverty += feature.properties.poverty_index;
      accumulator.vulnerability += feature.properties.vulnerability_index;
      accumulator.spi += feature.properties.combined_spi;
      return accumulator;
    }, { exclusion: 0, poverty: 0, vulnerability: 0, spi: 0 });

    const count = features.length || 1;
    return {
      name,
      wardCount: count,
      avgExclusion: round(totals.exclusion / count),
      avgPoverty: round(totals.poverty / count),
      avgVulnerability: round(totals.vulnerability / count),
      avgSpi: round(totals.spi / count),
      features,
      province: features[0]?.properties.province_name || '',
      district: features[0]?.properties.district_name || '',
    };
  });

  summaries.sort((left, right) => right.avgSpi - left.avgSpi || left.name.localeCompare(right.name));
  const visibleSummaries = typeof limit === 'number' ? summaries.slice(0, limit) : summaries;
  municipalityIndex = new Map(visibleSummaries.map((summary) => [summary.name, summary]));
  return visibleSummaries;
}

function buildLegend() {
  const legend = document.getElementById('legend');
  legend.innerHTML = '';

  const steps = ['0.0', '0.2', '0.4', '0.6', '0.8', '1.0'];
  steps.forEach((step, index) => {
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = getColor(index / (steps.length - 1));
    swatch.title = step;
    legend.appendChild(swatch);
    if (index < steps.length - 1) {
      const divider = document.createElement('span');
      divider.className = 'legend-divider';
      legend.appendChild(divider);
    }
  });
}

function fitMapToFeatures(featureList) {
  if (!map || !featureList.length) {
    return;
  }

  const featureBounds = L.geoJSON({ type: 'FeatureCollection', features: featureList }).getBounds();
  if (featureBounds.isValid()) {
    map.fitBounds(featureBounds.pad(0.12));
  }
}

function setStatus(message, loading = false) {
  const pill = document.getElementById('load-state');
  pill.textContent = message;
  pill.style.background = loading ? 'rgba(250, 204, 21, 0.18)' : 'rgba(37, 99, 235, 0.12)';
  pill.style.borderColor = loading ? 'rgba(250, 204, 21, 0.2)' : 'rgba(37, 99, 235, 0.16)';
}

function buildSummaryCards(summary) {
  const cards = [
    { label: 'SPI', value: summary.avgSpi.toFixed(2), meta: 'Combined shared prosperity score', fill: 'linear-gradient(135deg, #4f46e5, #5b5bdc)' },
    { label: 'Exclusion', value: summary.avgExclusion.toFixed(2), meta: 'Average exclusion index', fill: 'linear-gradient(135deg, #e5634f, #dc5b5b)' },
    { label: 'Poverty', value: summary.avgPoverty.toFixed(2), meta: 'Average poverty index', fill: 'linear-gradient(135deg, #e5b84f, #dccc5b)' },
    { label: 'Vulnerability', value: summary.avgVulnerability.toFixed(2), meta: 'Average vulnerability index', fill: 'linear-gradient(135deg, #4fe5ac, #5bdcb8)' },
  ];

  const container = document.getElementById('summary-cards');
  container.innerHTML = '';

  cards.forEach((card) => {
    const element = document.createElement('article');
    element.className = 'summary-card';
    element.style.background = card.fill;
    element.innerHTML = `
      <p class="summary-card__label">${card.label}</p>
      <p class="summary-card__value">${card.value}</p>
      <p class="summary-card__meta">${card.meta}</p>
    `;
    container.appendChild(element);
  });
}

function getSelectedSummary() {
  const filtered = selectedMunicipality
    ? wards.filter((feature) => feature.properties.municipality_name === selectedMunicipality)
    : wards;

  const municipalityCount = selectedMunicipality ? 1 : municipalityIndex.size;
  const wardCount = filtered.length;
  const totals = filtered.reduce((accumulator, feature) => {
    accumulator.exclusion += feature.properties.exclusion_index;
    accumulator.poverty += feature.properties.poverty_index;
    accumulator.vulnerability += feature.properties.vulnerability_index;
    accumulator.spi += feature.properties.combined_spi;
    return accumulator;
  }, { exclusion: 0, poverty: 0, vulnerability: 0, spi: 0 });

  const divisor = wardCount || 1;
  return {
    municipalityCount,
    wardCount,
    avgExclusion: round(totals.exclusion / divisor),
    avgPoverty: round(totals.poverty / divisor),
    avgVulnerability: round(totals.vulnerability / divisor),
    avgSpi: round(totals.spi / divisor),
  };
}

function makeGauge(value) {
  const target = round(value * 100, 0);
  const options = {
    chart: { type: 'radialBar', height: 260, sparkline: { enabled: true } },
    series: [target],
    labels: ['SPI'],
    plotOptions: {
      radialBar: {
        hollow: { size: '68%' },
        startAngle: -140,
        endAngle: 140,
        track: { background: '#e2e8f0', strokeWidth: '100%', margin: 12 },
        dataLabels: {
          name: { show: false },
          value: {
            fontFamily: 'Space Grotesk, Inter, sans-serif',
            fontSize: '40px',
            fontWeight: 700,
            color: '#0f172a',
            formatter: (currentValue) => (currentValue / 100).toFixed(2),
          },
        },
      },
    },
    fill: { colors: [getColor(value)] },
    stroke: { lineCap: 'round' },
  };

  if (gaugeChart) {
    gaugeChart.updateOptions(options, true, true);
  } else {
    gaugeChart = new ApexCharts(document.querySelector('#spi-gauge'), options);
    gaugeChart.render();
  }
}

function makeCompositionChart(summary) {
  const total = summary.avgExclusion + summary.avgPoverty + summary.avgVulnerability || 1;
  const pieData = [summary.avgExclusion, summary.avgPoverty, summary.avgVulnerability].map((value) => round((value / total) * 100, 0));
  const ctx = document.getElementById('composition-pie').getContext('2d');

  if (pieChart) {
    pieChart.data.datasets[0].data = pieData;
    pieChart.update();
    return;
  }

  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Exclusion', 'Poverty', 'Vulnerability'],
      datasets: [{
        data: pieData,
        backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            color: '#475569',
            font: { family: 'Inter, sans-serif', size: 12, weight: 600 },
          },
        },
      },
    },
  });
}

function makeBarChart(features) {
  const currentFeatures = [...features].sort((left, right) => right[selectedPillar] - left[selectedPillar]).slice(0, 5);
  const labels = currentFeatures.map((feature) => feature.properties.ward_name);
  const values = currentFeatures.map((feature) => feature.properties[selectedPillar]);

  const options = {
    chart: { type: 'bar', height: 250, toolbar: { show: false }, sparkline: { enabled: true } },
    series: [{ data: values }],
    plotOptions: { bar: { horizontal: true, borderRadius: 8, barHeight: '60%' } },
    colors: [PILLAR_COLORS[selectedPillar]],
    dataLabels: { enabled: false },
    xaxis: { categories: labels, labels: { style: { colors: '#475569' } } },
    yaxis: { labels: { style: { colors: '#475569' } } },
    grid: { borderColor: '#e2e8f0', strokeDashArray: 4 },
    tooltip: { y: { formatter: (value) => value.toFixed(2) } },
  };

  if (barChart) {
    barChart.updateOptions(options, true, true);
  } else {
    barChart = new ApexCharts(document.querySelector('#top-wards-bar'), options);
    barChart.render();
  }
}

function badgeBackground(value) {
  if (value >= 0.7) return 'rgba(22, 163, 74, 0.12)';
  if (value >= 0.5) return 'rgba(234, 179, 8, 0.14)';
  return 'rgba(239, 68, 68, 0.12)';
}

function badgeColor(value) {
  if (value >= 0.7) return '#15803d';
  if (value >= 0.5) return '#a16207';
  return '#b91c1c';
}

function makeWardTable(features) {
  const tbody = document.querySelector('#ward-table tbody');
  const sorted = [...features].sort((left, right) => right[selectedPillar] - left[selectedPillar]);
  tbody.innerHTML = '';

  sorted.forEach((feature, index) => {
    const isActive = feature.properties.ward_id === activeWardId;
    const row = document.createElement('tr');
    if (isActive) {
      row.classList.add('row-selected');
    }

    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${feature.properties.ward_name}</td>
      <td>${feature.properties.municipality_name}</td>
      <td><span class="score-badge" style="background:${badgeBackground(feature.properties.exclusion_index)}; color:${badgeColor(feature.properties.exclusion_index)}">${feature.properties.exclusion_index.toFixed(2)}</span></td>
      <td><span class="score-badge" style="background:${badgeBackground(feature.properties.poverty_index)}; color:${badgeColor(feature.properties.poverty_index)}">${feature.properties.poverty_index.toFixed(2)}</span></td>
      <td><span class="score-badge" style="background:${badgeBackground(feature.properties.vulnerability_index)}; color:${badgeColor(feature.properties.vulnerability_index)}">${feature.properties.vulnerability_index.toFixed(2)}</span></td>
      <td><span class="score-badge" style="background:${badgeBackground(feature.properties.combined_spi)}; color:${badgeColor(feature.properties.combined_spi)}">${feature.properties.combined_spi.toFixed(2)}</span></td>
      <td><a href="#" class="action-link" data-ward-id="${feature.properties.ward_id}">Details</a></td>
    `;

    row.querySelector('.action-link').addEventListener('click', (event) => {
      event.preventDefault();
      selectWard(feature.properties.ward_id, feature.properties.municipality_name);
    });

    row.addEventListener('click', () => {
      selectWard(feature.properties.ward_id, feature.properties.municipality_name);
    });

    tbody.appendChild(row);
  });
}

function renderMap() {
  if (wardLayer) {
    map.removeLayer(wardLayer);
  }

  wardLayer = L.geoJSON({ type: 'FeatureCollection', features: wards }, {
    style: (feature) => {
      const value = feature.properties[selectedPillar];
      const isSelectedMunicipality = !selectedMunicipality || feature.properties.municipality_name === selectedMunicipality;
      const isActive = feature.properties.ward_id === activeWardId;
      return {
        color: isActive ? '#0f172a' : 'rgba(15, 23, 42, 0.3)',
        weight: isActive ? 2.4 : 1,
        fillColor: getColor(value),
        fillOpacity: isSelectedMunicipality ? (isActive ? 0.96 : 0.82) : 0.18,
      };
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      const popupHtml = `
        <div class="popup-card">
          <h4>${props.ward_name}</h4>
          <p>${props.municipality_name}</p>
          <dl>
            <div><dt>Exclusion</dt><dd>${props.exclusion_index.toFixed(2)}</dd></div>
            <div><dt>Poverty</dt><dd>${props.poverty_index.toFixed(2)}</dd></div>
            <div><dt>Vulnerability</dt><dd>${props.vulnerability_index.toFixed(2)}</dd></div>
            <div><dt>SPI</dt><dd>${props.combined_spi.toFixed(2)}</dd></div>
          </dl>
        </div>
      `;

      layer.bindTooltip(`${props.ward_name} · ${props.combined_spi.toFixed(2)}`);
      layer.bindPopup(popupHtml);
      layer.on({
        mouseover: (event) => {
          if (event.target.setStyle) {
            event.target.setStyle({ weight: 2.5, color: '#0f172a', fillOpacity: 0.96 });
          }
        },
        mouseout: () => {
          wardLayer.resetStyle(layer);
          if (activeWardId === props.ward_id) {
            layer.setStyle({ weight: 2.4, color: '#0f172a', fillOpacity: 0.96 });
          }
        },
        click: () => selectWard(props.ward_id, props.municipality_name),
      });
    },
  }).addTo(map);

  const visibleFeatures = selectedMunicipality
    ? wards.filter((feature) => feature.properties.municipality_name === selectedMunicipality)
    : wards;

  fitMapToFeatures(visibleFeatures.length ? visibleFeatures : wards);
}

function renderDashboard() {
  const filtered = selectedMunicipality
    ? wards.filter((feature) => feature.properties.municipality_name === selectedMunicipality)
    : wards;

  const summary = getSelectedSummary();
  buildSummaryCards(summary);
  makeGauge(selectedMunicipality && municipalityIndex.has(selectedMunicipality)
    ? municipalityIndex.get(selectedMunicipality).avgSpi
    : summary.avgSpi);
  makeCompositionChart(summary);
  makeBarChart(filtered);
  makeWardTable(filtered);
  document.getElementById('scope-label').textContent = `${selectedMunicipality || 'All municipalities'} · ${summary.wardCount} wards`;
}

function populateMunicipalitySelect(municipalities) {
  const select = document.getElementById('municipality-select');
  municipalities.forEach((municipality) => {
    const option = document.createElement('option');
    option.value = municipality.name;
    option.textContent = `${municipality.name} (${municipality.wardCount})`;
    select.appendChild(option);
  });
}

function selectMunicipality(name) {
  selectedMunicipality = name;
  activeWardId = '';
  document.getElementById('municipality-select').value = name;
  renderMap();
  renderDashboard();

  const municipality = name ? municipalityIndex.get(name) : null;
  if (municipality) {
    fitMapToFeatures(municipality.features);
  } else {
    fitMapToFeatures(wards);
  }
}

function selectWard(wardId, municipalityName) {
  activeWardId = wardId;
  selectedMunicipality = municipalityName || selectedMunicipality;
  document.getElementById('municipality-select').value = selectedMunicipality;
  renderMap();
  renderDashboard();

  const ward = wards.find((feature) => feature.properties.ward_id === wardId);
  if (ward) {
    fitMapToFeatures([ward]);
  }
}

function exportCsv() {
  const filtered = selectedMunicipality
    ? wards.filter((feature) => feature.properties.municipality_name === selectedMunicipality)
    : wards;

  const header = ['Municipality', 'Ward', 'Province', 'District', 'Exclusion', 'Poverty', 'Vulnerability', 'SPI'];
  const rows = filtered.map((feature) => [
    feature.properties.municipality_name,
    feature.properties.ward_name,
    feature.properties.province_name,
    feature.properties.district_name,
    feature.properties.exclusion_index,
    feature.properties.poverty_index,
    feature.properties.vulnerability_index,
    feature.properties.combined_spi,
  ]);

  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(selectedMunicipality || 'all_municipalities').replace(/\s+/g, '_')}_spi.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printView() {
  window.print();
}

async function handleUploadedZip(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  setStatus('Parsing uploaded shapefile...', true);
  const buffer = await file.arrayBuffer();
  const uploaded = await window.shp(buffer);
  const collection = Array.isArray(uploaded) ? uploaded[0] : uploaded;
  const normalized = normalizeWardFeatures(collection);
  const municipalities = buildMunicipalityIndex(normalized, MAX_MUNICIPALITIES);
  wards = municipalities.flatMap((municipality) => municipality.features);
  selectedMunicipality = '';
  activeWardId = '';
  const select = document.getElementById('municipality-select');
  select.innerHTML = '<option value="">All Municipalities</option>';
  populateMunicipalitySelect(municipalities);
  renderMap();
  renderDashboard();
  setStatus(`Loaded ${wards.length} features`);
}

async function init() {
  if (hasBootstrapped) {
    return;
  }
  hasBootstrapped = true;

  await waitForLibraries();

  map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([27.72, 85.32], 11);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  }).addTo(map);

  buildLegend();
  setStatus('Loading shapefile...', true);

  let loaded;
  try {
    loaded = await loadWardShapefile();
  } catch (err) {
    console.error('Failed to load shapefile:', err);
    setStatus(`Error loading shapefile: ${err.message || err}`);
    return;
  }

  const municipalities = buildMunicipalityIndex(loaded, MAX_MUNICIPALITIES);
  wards = municipalities.flatMap((municipality) => municipality.features);
  populateMunicipalitySelect(municipalities);

  document.getElementById('municipality-select').addEventListener('change', (event) => {
    selectMunicipality(event.target.value);
  });

  document.getElementById('pillar-select').addEventListener('change', (event) => {
    selectedPillar = event.target.value;
    renderMap();
    renderDashboard();
  });

  document.getElementById('download-csv').addEventListener('click', exportCsv);
  document.getElementById('export-pdf').addEventListener('click', printView);

  renderMap();
  renderDashboard();
  setStatus(`Loaded ${wards.length} features`);
}

export { init };
