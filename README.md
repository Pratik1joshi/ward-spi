Shared Prosperity Dashboard

Next.js version

This repository now runs as a Next.js app.

What this version does
- Loads the local shapefile from `data/shp/hermes_NPL_new_wgs_3.*` directly in the browser with `shpjs`.
- Groups features by `LOCAL` and uses those groups as municipalities for filtering and ranking.
- Generates deterministic SPI, exclusion, poverty, and vulnerability scores so the dashboard works now without a backend.
- Keeps an optional shapefile ZIP upload so you can swap in another dataset later.

Files
- `index.html`
- `style.css`
- `js/app.js`
- `data/shp/hermes_NPL_new_wgs_3.shp`
- `data/shp/hermes_NPL_new_wgs_3.dbf`
- `data/shp/hermes_NPL_new_wgs_3.shx`
- `data/shp/hermes_NPL_new_wgs_3.prj`
- `data/shp/hermes_NPL_new_wgs_3.cpg`

How to run
1. Install dependencies with `npm install`.
2. Start the app with `npm run dev`.
3. Open `http://localhost:3000`.
4. Choose a municipality to filter the map, charts, and ward rankings.
5. Click any ward on the map or in the table to focus it.

If you want, I can also wire real SPI values from a CSV or a separate attributes file so the scores match your actual dataset instead of generated demo scores.