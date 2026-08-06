# Irish Data Centre Planning Tracker

A public mapping and planning-intelligence platform for Irish planning applications associated with data-centre development.

## Live site

After GitHub Pages is enabled, the site publishes at:

`https://u7096678288-a11y.github.io/Data-Centre-Tracker---Ireland-/`

## Core functions

- Queries the official National Planning Application Database directly when the page opens.
- Searches descriptions and applicant names for data-centre terminology and known operators.
- Scores candidates as **Confirmed**, **Probable**, **Review**, or **Excluded**.
- Filters unrelated planning records out of the public map and KPIs.
- Maps projects and provides planning-status KPIs, authority charts, search, filters and CSV export.
- Uses `data/manual_overrides.json` for verified inclusions and false-positive exclusions.
- Retains `data/data-centres.geojson` as a fallback repository snapshot.
- Links to the project Patreon: https://www.patreon.com/16538169/join

## Review logic

The classifier is deliberately auditable. Edit `config/keywords.json` to tune detection. Use `data/manual_overrides.json` for verified includes and false-positive exclusions. The stable record key is:

`PLANNING AUTHORITY|APPLICATION NUMBER`

## Data source

Department of Housing, Local Government and Heritage, National Planning Application Database / `IrishPlanningApplications` FeatureServer.

The national register merges participating local-authority planning registers. Material projects should still be checked against the linked local-authority record and An Coimisiún Pleanála where applicable.

## Recommended GitHub Pages deployment

The public dashboard no longer depends on GitHub Actions for live data.

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**.
4. Click **Save**.

The browser then queries the live ArcGIS planning layer whenever the platform is opened. The GitHub Actions workflows remain available as an optional daily repository snapshot and alternative Pages deployment route.

Deployment refreshed on 6 August 2026.
