"""Build the Data API v1 contract fixtures from real hourly index archives (spec 2026-10-14-data-api-v1-design.md).

Usage: python3 make.py <dir with YYYYMMDDTHH-index{,-aii,-aei}.json.gz for consecutive hours>
Writes one JSON per endpoint next to this file. Values are real; only the set of hours is small.
"""
import calendar, glob, gzip, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
IDX = {"abi": "index", "aii": "index-aii", "aei": "index-aei"}
NAMES = {"abi": "Arc Builders Index", "aii": "Arc Integrations Index", "aei": "Arc Ecosystem Index"}
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
unix = lambda s: calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))
KIND = {"project": "builder", "integration": "integration", "base": "base"}


def load(src):
    files = {}
    for path in sorted(glob.glob(os.path.join(src, "*-index*.json.gz"))):
        stem = os.path.basename(path)[:-8]                      # 20261014T21-index-aii
        key = stem.split("-", 1)[1]
        d = json.load(gzip.open(path))
        files.setdefault(unix(d["data_until"]), {})[key] = d
    return dict(sorted(files.items()))


def member_rows(d, close):
    """Every member's row for the hour that closes at `close` (unix), from that hour's index file."""
    act = {e["source"]: e for e in d["events"] if e["kind"] == "activity" and unix(e["t"]) == close - 3600}
    rows = []
    for p in d["projects"]:
        e = act.get(p["source"], {})
        rows.append({"id": p["source"], "hour_close": iso(close), "hour": close // 3600, "points": d["live"]["P"][p["source"]],
                     "points_earned": e.get("points", 0), "payments": e.get("payments", 0), "wallets": e.get("wallets", 0),
                     "new_payers": e.get("new_payers", 0), "usdc": e.get("usdc", 0)})
    return sorted(rows, key=lambda r: r["id"])


def close_of(d, close):
    """The index close for that hour from candles (stamped at the hour's start, 3 dp)."""
    return next(c[4] for c in d["candles"] if unix(c[0]) == close - 3600)


def write(name, obj):
    with open(os.path.join(HERE, name), "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def main(src):
    files = load(src)
    hours = list(files)
    last = hours[-1]
    cur = files[last]
    du = iso(last)
    abi = cur["index"]
    write("indices.json", {"version": 1, "data_until": du, "indices": {
        k: {"name": NAMES[k], "close": close_of(cur[f], last), "close_24h_ago": cur[f]["index_24h_ago"], "base": 1000,
            "base_date": "2026-10-02T00:00:00Z", "members": len(cur[f]["projects"])} for k, f in IDX.items()},
        "params": {"half_life_days": abi["params"]["half_life_days"], "decay_per_hour_pct": abi["params"]["decay_per_hour_pct"]}})
    write("indices-abi-hourly.json", {"version": 1, "index": "abi", "data_until": du,
                                      "rows": [{"hour_close": iso(h), "hour": h // 3600, "close": close_of(files[h]["index"], h)} for h in hours]})
    aii = cur["index-aii"]
    write("members-aii.json", {"version": 1, "index": "aii", "data_until": du, "members": [
        {"id": p["source"], "name": p["name"], "kind": KIND[p["kind"]], "verified": False, "points": aii["live"]["P"][p["source"]],
         "share": p["share"], "first_hour": "2026-10-10T23:00:00Z",
         "last_24h": {"points_earned": p["pts_24h"], "payments": p["pay_24h"], "usdc": p["usdc_24h"]}} for p in aii["projects"]]})
    mid = "domain:archery.wtf"
    write("member-hourly.json", {"version": 1, "index": "abi", "id": mid, "data_until": du,
                                 "rows": [{k: v for k, v in r.items() if k != "id"} for h in hours for r in member_rows(files[h]["index"], h) if r["id"] == mid]})
    write("members-hourly-aii.json", {"version": 1, "index": "aii", "data_until": du,
                                      "rows": [r for h in hours for r in member_rows(files[h]["index-aii"], h)]})
    write("members-new-aii.json", {"version": 1, "index": "aii", "since": iso(hours[0]), "data_until": du, "members": []})
    write("verified.json", {"version": 1, "updated": iso(last + 180), "verified": [
        {"id": "domain:example.app", "method": "registry", "since": "2026-09-30T12:00:00Z"}]})
    write("error-503.json", {"error": "The index data is not available right now. Retry later."})
    print("hours", [iso(h) for h in hours])


if __name__ == "__main__":
    main(sys.argv[1])
