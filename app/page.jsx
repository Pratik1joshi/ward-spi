'use client';

import { useEffect } from 'react';
import { init } from '../js/app';

export default function Page() {
  useEffect(() => {
    void init();
  }, []);

  return (
    <div className="page-shell">
      <header className="hero">
        <div className="hero__copy">
          <h1>Shared Prosperity Dashboard</h1>
        </div>

        <div className="hero__tools">
          <div className="control-group">
            <label htmlFor="municipality-select">Municipality</label>
            <select id="municipality-select">
              <option value="">All Municipalities</option>
            </select>
          </div>

          <div className="control-group">
            <label htmlFor="pillar-select">Focus metric</label>
            <select id="pillar-select">
              <option value="combined_spi">SPI</option>
              <option value="exclusion_index">Exclusion</option>
              <option value="poverty_index">Poverty</option>
              <option value="vulnerability_index">Vulnerability</option>
            </select>
          </div>

          <button id="download-csv" className="primary-btn" type="button">Download CSV</button>
          <button id="export-pdf" className="secondary-btn" type="button">Print View</button>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="map-column">
          <div className="panel map-panel">
            <div className="panel__header">
              <div>
                <p className="panel__eyebrow">Interactive map</p>
                <h2>Ward boundaries from your local shapefile</h2>
              </div>
              <div id="load-state" className="status-pill">Loading...</div>
            </div>
            <div id="map" className="map-canvas" />
            <div className="legend-row">
              <span>Low</span>
              <div id="legend" className="legend-bar" />
              <span>High</span>
            </div>
          </div>
        </section>

        <aside className="insights-column">
          <div className="summary-grid" id="summary-cards" />

          <div className="panel hero-metric">
            <div className="panel__header panel__header--stacked">
              <div>
                <p className="panel__eyebrow">SPI overview</p>
                <h2>Shared Prosperity score</h2>
              </div>
              <div id="scope-label" className="scope-label">All municipalities</div>
            </div>
            <div id="spi-gauge" />
          </div>

          <div className="mini-grid">
            <div className="panel chart-panel">
              <div className="panel__header panel__header--compact">
                <div>
                  <p className="panel__eyebrow">Composition</p>
                  <h2>SPI drivers</h2>
                </div>
              </div>
              <canvas id="composition-pie" height="180" />
            </div>

            <div className="panel chart-panel">
              <div className="panel__header panel__header--compact">
                <div>
                  <p className="panel__eyebrow">Ranked wards</p>
                  <h2>Top 5 by current metric</h2>
                </div>
              </div>
              <div id="top-wards-bar" />
            </div>
          </div>

          <div className="panel table-panel">
            <div className="panel__header panel__header--compact">
              <div>
                <p className="panel__eyebrow">Ward table</p>
                <h2>Rankings and details</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table id="ward-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Ward</th>
                    <th>Municipality</th>
                    <th>Exclusion</th>
                    <th>Poverty</th>
                    <th>Vulnerability</th>
                    <th>SPI</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody />
              </table>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}