# Irish Data Centre Planning Tracker

A public, automatically refreshed mapping platform for Irish planning applications associated with data-centre development.

## Live site
After GitHub Pages is enabled, the site publishes at:
`https://u7096678288-a11y.github.io/Data-Centre-Tracker---Ireland-/`

## Core functions
- Queries the official National Planning Application Database.
- Scores candidates as Confirmed, Probable, Review or Excluded.
- Filters unrelated planning records out of the published GeoJSON.
- Maps projects and exposes KPIs, status and authority charts, search, filtering and CSV export.
- Refreshes daily through GitHub Actions.
- Links to the project Patreon: https://www.patreon.com/16538169/join

## Review logic
The automated classifier is deliberately auditable. Edit `config/keywords.json` to tune detection. Use `data/manual_overrides.json` for verified includes and false-positive exclusions. The stable key is `PLANNING AUTHORITY|APPLICATION NUMBER`.

## Data source
Department of Housing, Local Government and Heritage, National Planning Application Database / IrishPlanningApplications FeatureServer. The national register is a merged dataset of participating local authorities and should be cross-checked against local-authority and An Coimisiún Pleanála records for material projects.

## Deployment
1. Upload all repository files to the `main` branch.
2. In GitHub: **Settings → Pages → Source: GitHub Actions**.
3. In **Actions**, run `Update planning data` once.
4. The `Publish mapping platform` workflow deploys the dashboard.
