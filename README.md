# Irish Data Centre Planning Tracker

A public mapping and planning-intelligence platform for Irish planning applications associated with data-centre development.

## Live site

After GitHub Pages is enabled, the site publishes at:

`https://u7096678288-a11y.github.io/Data-Centre-Tracker---Ireland-/`

## Core functions

- Queries the official National Planning Application Database directly when the page opens.
- Searches the `DevelopmentDescription` field for explicit data-centre wording and supporting technical infrastructure.
- Scores description matches as **Confirmed**, **Probable**, **Review**, or **Excluded**.
- Deduplicates applications using planning authority and application number.
- Rejects point geometries outside the Ireland map extent.
- Locks the Leaflet map to Ireland and prevents world wrapping or unrestricted zooming out.
- Maps projects and provides planning-status KPIs, authority charts, search, filters and CSV export.
- Uses `data/manual_overrides.json` for verified inclusions and false-positive exclusions.
- Retains `data/data-centres.geojson` as a fallback repository snapshot.
- Links to the project Patreon: https://www.patreon.com/16538169/join

## Description matching

The live query checks planning descriptions for terms including data centre/data center, datacentre, data hall, server hall, server farm, hyperscale, colocation, cloud-computing campus, compute campus, data-storage facility and digital-infrastructure campus. Broader ICT, server-room and data-processing descriptions are included only where the description also contains supporting infrastructure such as generators, substations, transformers, cooling plant, chillers or switchrooms.

The classifier is deliberately auditable. Use `data/manual_overrides.json` for verified includes and false-positive exclusions. The stable record key is:

`PLANNING AUTHORITY|APPLICATION NUMBER`

## Data source

Department of Housing, Local Government and Heritage, National Planning Application Database / `IrishPlanningApplications` FeatureServer, Planning Application Points layer.

The national register merges participating local-authority planning registers. Material projects should still be checked against the linked local-authority record and An Coimisiún Pleanála where applicable.

## GitHub Pages deployment

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**.
4. Click **Save**.

The browser queries the live ArcGIS planning layer whenever the platform opens. The `.nojekyll` file allows direct static deployment from the branch.

Deployment refreshed on 6 August 2026.
