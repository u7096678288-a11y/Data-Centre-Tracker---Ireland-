#!/usr/bin/env python3
"""Refresh Irish data-centre planning records from the national ArcGIS layer."""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
LAYER = "https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0"
SEARCH_FIELDS = (
    "DevelopmentDescription",
    "DevelopmentAddress",
    "ApplicantForename",
    "ApplicantSurname",
)


def get_json(url: str, params: dict) -> dict:
    request = Request(
        f"{url}?{urlencode(params)}",
        headers={"User-Agent": "IrishDataCentrePlanningTracker/2.0"},
    )
    with urlopen(request, timeout=120) as response:
        payload = json.load(response)
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(f"ArcGIS error: {payload['error']}")
    return payload


def norm(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def lower(value) -> str:
    return norm(value).lower()


def first(attributes: dict, names: list[str]):
    lookup = {key.lower(): value for key, value in attributes.items()}
    for name in names:
        value = lookup.get(name.lower())
        if value not in (None, ""):
            return value
    return None


def iso_date(value):
    if not value:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()
        return str(value)[:10]
    except Exception:
        return str(value)


def contains_term(text: str, term: str) -> bool:
    term = lower(term)
    if not term:
        return False
    if len(term) <= 4 and term.replace(" ", "").isalnum():
        return bool(re.search(rf"\b{re.escape(term)}\b", text))
    return term in text


def matching_terms(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if contains_term(text, term)]


def classify(text: str, config: dict):
    text = lower(text)
    strong = matching_terms(text, config["strong_phrases"])
    operators = matching_terms(text, config["operator_terms"])
    supporting = matching_terms(text, config["supporting_terms"])
    false_positives = matching_terms(text, config["false_positive_terms"])

    if false_positives and not strong:
        return "excluded", 0, {"false_positive": false_positives}
    if strong:
        return (
            "confirmed",
            min(100, 90 + 2 * len(strong)),
            {"strong": strong, "operator": operators, "supporting": supporting},
        )
    if operators and supporting:
        return (
            "probable",
            min(89, 65 + 5 * len(operators) + 3 * len(supporting)),
            {"operator": operators, "supporting": supporting},
        )
    if len(supporting) >= 2 and any(
        cue in text for cue in ("server", "digital", "cloud", "compute", "data hall")
    ):
        return "review", 55, {"supporting": supporting}
    return "excluded", 0, {}


def query_ids_for_term(term: str) -> set[int]:
    escaped = term.upper().replace("'", "''")
    where = " OR ".join(
        f"UPPER({field}) LIKE '%{escaped}%'" for field in SEARCH_FIELDS
    )
    result = get_json(
        f"{LAYER}/query",
        {"f": "json", "where": where, "returnIdsOnly": "true"},
    )
    return set(result.get("objectIds") or [])


def query_ids_for_manual_key(key: str) -> set[int]:
    try:
        authority, reference = key.split("|", 1)
    except ValueError:
        return set()
    authority = authority.replace("'", "''")
    reference = reference.replace("'", "''")
    where = (
        f"UPPER(PlanningAuthority) = '{authority.upper()}' AND "
        f"UPPER(ApplicationNumber) = '{reference.upper()}'"
    )
    result = get_json(
        f"{LAYER}/query",
        {"f": "json", "where": where, "returnIdsOnly": "true"},
    )
    return set(result.get("objectIds") or [])


def candidate_terms(config: dict) -> list[str]:
    terms = list(config["strong_phrases"]) + list(config["operator_terms"])
    # Avoid generic short acronyms as discovery terms; they remain usable in scoring.
    blocked = {"aws", "meta"}
    unique = []
    seen = set()
    for term in terms:
        key = lower(term)
        if not key or key in blocked or key in seen:
            continue
        seen.add(key)
        unique.append(key)
    return unique


def main():
    config = json.loads((ROOT / "config/keywords.json").read_text())
    overrides = json.loads((ROOT / "data/manual_overrides.json").read_text())
    manual = {item["key"].upper(): item for item in overrides.get("include", [])}
    excluded = {key.upper() for key in overrides.get("exclude", [])}

    object_ids: set[int] = set()
    for term in candidate_terms(config):
        object_ids.update(query_ids_for_term(term))
    for key in manual:
        object_ids.update(query_ids_for_manual_key(key))

    if not object_ids:
        raise RuntimeError("No ArcGIS candidate records were returned; existing data was preserved.")

    features_by_key = {}
    sorted_ids = sorted(object_ids)
    for start in range(0, len(sorted_ids), 200):
        batch = sorted_ids[start : start + 200]
        data = get_json(
            f"{LAYER}/query",
            {
                "f": "geojson",
                "objectIds": ",".join(map(str, batch)),
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": "4326",
            },
        )
        for feature in data.get("features", []):
            attributes = feature.get("properties", {})
            authority = norm(
                first(attributes, ["PlanningAuthority", "Planning Authority", "LocalAuthority"])
            )
            reference = norm(
                first(attributes, ["ApplicationNumber", "Application Number", "PlanningReference"])
            )
            if not authority or not reference:
                continue

            description = norm(
                first(attributes, ["DevelopmentDescription", "Development Description", "Description"])
            )
            address = norm(
                first(attributes, ["DevelopmentAddress", "Development Address", "Address"])
            )
            applicant = norm(
                " ".join(
                    part
                    for part in (
                        norm(first(attributes, ["ApplicantForename", "Applicant Forename"])),
                        norm(first(attributes, ["ApplicantSurname", "Applicant Surname"])),
                        norm(first(attributes, ["ApplicantName", "Applicant Name", "Applicant"])),
                    )
                    if part
                )
            )

            key = f"{authority.upper()}|{reference.upper()}"
            if key in excluded:
                continue

            flag, score, reasons = classify(
                " | ".join((description, address, applicant)), config
            )
            override = manual.get(key)
            if override:
                flag = override.get("flag", "confirmed")
                score = override.get("confidence_score", 100)
                reasons = {"manual_override": override.get("notes", "")}
            if flag == "excluded":
                continue

            appeal_reference = norm(
                first(attributes, ["AppealRefNumber", "AppealReference", "Appeal Ref", "ABPRef"])
            )
            properties = {
                "key": key,
                "planning_authority": authority,
                "application_number": reference,
                "description": description,
                "address": address,
                "applicant": applicant,
                "application_status": norm(
                    first(attributes, ["ApplicationStatus", "Application Status"])
                ),
                "application_type": norm(
                    first(attributes, ["ApplicationType", "Application Type"])
                ),
                "received_date": iso_date(first(attributes, ["ReceivedDate", "Received Date"])),
                "decision": norm(first(attributes, ["Decision", "DecisionType", "Status"])),
                "decision_date": iso_date(first(attributes, ["DecisionDate", "Decision Date"])),
                "grant_date": iso_date(first(attributes, ["GrantDate", "Grant Date"])),
                "expiry_date": iso_date(first(attributes, ["ExpiryDate", "Expiry Date"])),
                "appeal": appeal_reference,
                "appeal_status": norm(first(attributes, ["AppealStatus", "Appeal Status"])),
                "appeal_decision": norm(first(attributes, ["AppealDecision", "Appeal Decision"])),
                "appeal_submitted_date": iso_date(
                    first(attributes, ["AppealSubmittedDate", "Appeal Submitted Date"])
                ),
                "appeal_decision_date": iso_date(
                    first(attributes, ["AppealDecisionDate", "Appeal Decision Date"])
                ),
                "fi_requested_date": iso_date(
                    first(attributes, ["FIRequestDate", "FurtherInformationRequestDate"])
                ),
                "fi_received_date": iso_date(
                    first(attributes, ["FIRecDate", "FurtherInformationReceivedDate"])
                ),
                "floor_area": first(attributes, ["FloorArea", "Floor Area"]),
                "site_area": first(attributes, ["AreaofSite", "Area of Site"]),
                "source_url": norm(
                    first(attributes, ["LinkAppDetails", "ApplicationLink", "URL", "Link"])
                ),
                "flag": flag,
                "confidence_score": score,
                "flag_reasons": reasons,
                "project_name": (override or {}).get("project_name") or address or reference,
                "operator": (override or {}).get("operator") or applicant,
                "last_checked": datetime.now(timezone.utc).isoformat(),
            }
            feature["properties"] = properties
            features_by_key[key] = feature

    features = sorted(
        features_by_key.values(),
        key=lambda item: item["properties"].get("received_date") or "",
        reverse=True,
    )
    if not features:
        raise RuntimeError("Candidates were found but none passed classification; existing data was preserved.")

    generated_at = datetime.now(timezone.utc).isoformat()
    collection = {
        "type": "FeatureCollection",
        "features": features,
        "generated_at": generated_at,
        "source": LAYER,
    }
    (ROOT / "data/data-centres.geojson").write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":"))
    )

    summary = {
        "generated_at": generated_at,
        "candidate_records": len(object_ids),
        "total": len(features),
        "confirmed": sum(item["properties"]["flag"] == "confirmed" for item in features),
        "probable": sum(item["properties"]["flag"] == "probable" for item in features),
        "review": sum(item["properties"]["flag"] == "review" for item in features),
        "authorities": len(
            {
                item["properties"]["planning_authority"]
                for item in features
                if item["properties"]["planning_authority"]
            }
        ),
        "appealed": sum(bool(item["properties"].get("appeal")) for item in features),
        "granted": sum(
            "grant" in lower(item["properties"].get("decision")) for item in features
        ),
        "pending": sum(
            any(
                word in lower(item["properties"].get("decision"))
                for word in ("pending", "undecided", "await")
            )
            or not item["properties"].get("decision")
            for item in features
        ),
    }
    (ROOT / "data/summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Update failed: {exc}", file=sys.stderr)
        raise
