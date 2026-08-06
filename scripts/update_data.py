#!/usr/bin/env python3
"""Refresh Irish data-centre planning candidates from the national ArcGIS layer."""
from __future__ import annotations
import json, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
LAYER = "https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0"

def get_json(url: str, params: dict) -> dict:
    req = Request(f"{url}?{urlencode(params)}", headers={"User-Agent":"IrishDataCentrePlanningTracker/1.0"})
    with urlopen(req, timeout=120) as r:
        return json.load(r)

def norm(s): return re.sub(r"\s+", " ", str(s or "")).strip()
def lower(s): return norm(s).lower()
def first(a, names):
    lookup={k.lower():v for k,v in a.items()}
    for n in names:
        if n.lower() in lookup and lookup[n.lower()] not in (None, ""):
            return lookup[n.lower()]
    return None

def iso_date(v):
    if not v: return None
    try:
        if isinstance(v,(int,float)): return datetime.fromtimestamp(v/1000,tz=timezone.utc).date().isoformat()
        return str(v)[:10]
    except Exception: return str(v)

def classify(text, cfg):
    t=lower(text)
    strong=[x for x in cfg["strong_phrases"] if x in t]
    ops=[x for x in cfg["operator_terms"] if x in t]
    support=[x for x in cfg["supporting_terms"] if x in t]
    false=[x for x in cfg["false_positive_terms"] if x in t]
    if false and not strong: return "excluded",0,{"false_positive":false}
    if strong: return "confirmed", min(100,90+2*len(strong)), {"strong":strong,"operator":ops,"supporting":support}
    if ops and support: return "probable", min(89,65+5*len(ops)+3*len(support)), {"operator":ops,"supporting":support}
    if len(support)>=2 and any(x in t for x in ["server","digital","cloud","compute"]): return "review",55,{"supporting":support}
    return "excluded",0,{}

def main():
    cfg=json.loads((ROOT/"config/keywords.json").read_text())
    overrides=json.loads((ROOT/"data/manual_overrides.json").read_text())
    manual={x["key"]:x for x in overrides.get("include",[])}
    excluded=set(overrides.get("exclude",[]))
    meta=get_json(LAYER,{"f":"json"})
    string_fields=[f["name"] for f in meta.get("fields",[]) if f.get("type")=="esriFieldTypeString"]
    likely=[f for f in string_fields if any(k in f.lower() for k in ["desc","develop","address","location","applicant","name"])] or string_fields
    terms=["%DATA CENT%","%DATACENT%","%SERVER%","%HYPERSCALE%","%COLOCATION%","%DIGITAL INFRASTRUCTURE%"]
    clauses=[]
    for f in likely[:8]:
        clauses += [f"UPPER({f}) LIKE '{term}'" for term in terms]
    where=" OR ".join(clauses) or "1=0"
    ids=get_json(f"{LAYER}/query",{"f":"json","where":where,"returnIdsOnly":"true"}).get("objectIds",[])
    features=[]
    for i in range(0,len(ids),500):
        batch=ids[i:i+500]
        data=get_json(f"{LAYER}/query",{
          "f":"geojson","objectIds":",".join(map(str,batch)),"outFields":"*","returnGeometry":"true","outSR":"4326"
        })
        for ft in data.get("features",[]):
            a=ft.get("properties",{})
            authority=norm(first(a,["PlanningAuthority","Planning Authority","LA_NAME","LocalAuthority","Planning_Authority"]))
            ref=norm(first(a,["ApplicationNumber","Application Number","PlanningReference","Planning Ref","RegRef","Reg_Ref"]))
            desc=norm(first(a,["DevelopmentDescription","Development Description","Proposal","Description","DevelopmentDesc"]))
            address=norm(first(a,["DevelopmentAddress","Development Address","Address","Location"]))
            applicant=norm(first(a,["ApplicantName","Applicant Name","Applicant"]))
            text=" | ".join([desc,address,applicant])
            flag,score,reasons=classify(text,cfg)
            key=f"{authority.upper()}|{ref.upper()}"
            if key in excluded: continue
            if key in manual:
                o=manual[key]; flag=o.get("flag","confirmed"); score=o.get("confidence_score",100)
                reasons={"manual_override":o.get("notes","")}
            if flag=="excluded": continue
            decision=norm(first(a,["Decision","DecisionType","Decision Type","ApplicationStatus","Status"]))
            appeal=norm(first(a,["AppealReference","Appeal Ref","ABPRef","AppealStatus","Appeal Status"]))
            props={
              "key":key,"planning_authority":authority,"application_number":ref,
              "description":desc,"address":address,"applicant":applicant,
              "received_date":iso_date(first(a,["ReceivedDate","Received Date","ApplicationDate","Application Date"])),
              "decision":decision,"decision_date":iso_date(first(a,["DecisionDate","Decision Date"])),
              "appeal":appeal,"appeal_decision":norm(first(a,["AppealDecision","Appeal Decision"])),
              "fi_requested_date":iso_date(first(a,["FurtherInformationRequestDate","FIRequestDate","FI Request Date"])),
              "fi_received_date":iso_date(first(a,["FurtherInformationReceivedDate","FIReceivedDate","FI Received Date"])),
              "source_url":norm(first(a,["LinkAppDetails","ApplicationLink","URL","Link","PlanningLink"])),
              "flag":flag,"confidence_score":score,"flag_reasons":reasons,
              "project_name":manual.get(key,{}).get("project_name") or (address or ref),
              "operator":manual.get(key,{}).get("operator") or applicant,
              "last_checked":datetime.now(timezone.utc).isoformat()
            }
            ft["properties"]=props
            features.append(ft)
    features.sort(key=lambda x:(x["properties"].get("received_date") or ""),reverse=True)
    now=datetime.now(timezone.utc).isoformat()
    fc={"type":"FeatureCollection","features":features,"generated_at":now,"source":LAYER}
    (ROOT/"data/data-centres.geojson").write_text(json.dumps(fc,ensure_ascii=False,separators=(",",":")))
    summary={
      "generated_at":now,"total":len(features),
      "confirmed":sum(f["properties"]["flag"]=="confirmed" for f in features),
      "probable":sum(f["properties"]["flag"]=="probable" for f in features),
      "review":sum(f["properties"]["flag"]=="review" for f in features),
      "authorities":len({f["properties"]["planning_authority"] for f in features if f["properties"]["planning_authority"]}),
      "appealed":sum(bool(f["properties"].get("appeal")) for f in features),
      "granted":sum("grant" in lower(f["properties"].get("decision")) for f in features),
      "pending":sum(any(x in lower(f["properties"].get("decision")) for x in ["pending","undecided","await"]) or not f["properties"].get("decision") for f in features)
    }
    (ROOT/"data/summary.json").write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary,indent=2))
if __name__=="__main__":
    try: main()
    except Exception as e:
        print(f"Update failed: {e}",file=sys.stderr); raise
