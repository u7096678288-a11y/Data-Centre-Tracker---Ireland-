# Irish Data Centre Planning Tracker

A public mapping and planning-intelligence platform for Irish planning applications associated with data-centre development.

## Live site

`https://u7096678288-a11y.github.io/Data-Centre-Tracker---Ireland-/`

## Core functions

- Queries the official National Planning Application Database when the page opens.
- Searches the `DevelopmentDescription` field for explicit data-centre and closely equivalent terminology.
- Uses ArcGIS JSONP requests so the public GitHub Pages site can load the national planning service reliably.
- Deduplicates applications using planning authority and application number.
- Rejects point geometries outside the Ireland map extent.
- Locks the Leaflet map to Ireland and prevents world wrapping.
- Maps applications by planning status rather than confidence score.
- Provides application, authority, granted, pending, refused and appealed KPIs.
- Provides planning-status and authority charts, search, filters and CSV export.
- Links to the project Patreon: https://www.patreon.com/16538169/join

## Description matching

The live query checks planning descriptions for explicit terms including data centre/data center, datacentre/datacenter, data hall, server hall, server farm, hyperscale, colocation, cloud-computing centre or campus, compute campus, data-storage facility and digital-infrastructure campus.

The tracker does not assign confidence scores. A record is mapped only where its development description matches one of the configured data-centre patterns.

## Data source

Department of Housing, Local Government and Heritage, National Planning Application Database / `IrishPlanningApplications` FeatureServer, Planning Application Points layer.

The national register merges participating local-authority planning registers. Material projects should still be checked against the linked local-authority record and An Coimisiún Pleanála where applicable.

## GitHub Pages deployment

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**.
4. Click **Save**.

The `.nojekyll` file allows direct static deployment from the branch.

Deployment refreshed on 7 August 2026.
