#!/usr/bin/env python3
"""Turn the Monday BigQuery export row into the public impact.json (ADR 0020 and its amendment).

Standard library only. This is the second guard: it refuses to write anything if a count is under 50,
not rounded down to two significant figures, a rate is out of range, or the row carries a field we do
not publish (a country name, a language, an ID). The page never rounds or computes; this script does.

Usage: build_impact_json.py EXPORT_ROW.json STATIC.json CONFIG.json OUT.json [--now ISO8601]
"""
import datetime as dt
import json
import re
import sys

SCHEMA_VERSION = 1
CONTINENTS = ("africa", "asia", "europe", "north_america", "south_america", "oceania")
COUNTS = ("readers_week", "readers_4wk", "days_total", "days_week", "hours_total", "hours_week",
          "chapters_total", "chapters_week", "readers_3mo_plus", "step_outs_total",
          "installs_total", "active_last_month")
TENTHS = ("rate_1mo_tenths", "rate_3mo_tenths", "doorway_on_rate_tenths", "share_rate_tenths")
ROW_KEYS = set(COUNTS) | set(TENTHS) | {
    "schema_version", "generated_at", "data_through", "minutes_p25", "minutes_p75",
    "countries", "continents", "months"}
HEADLINE = ("readers_week", "days_total", "hours_total", "chapters_total")
# Weeks after launch before a figure is published (public-impact-statistics.md section 3, "Ships").
SHIPS_AFTER_WEEKS = {
    "readers_4wk": 4, "days_week": 4, "hours_week": 4, "chapters_week": 4,
    "minutes": 8, "doorway_on_rate_tenths": 8,
    "rate_1mo_tenths": 12, "step_outs_total": 12, "months": 12, "share_rate_tenths": 12,
    "readers_3mo_plus": 16, "rate_3mo_tenths": 20,
}
STATIC_KEYS = {"currency", "running_cost_text", "translations_reviewed_all", "version", "tracking_kits",
               "ad_kits", "bible_texts", "repo_public", "repo_url", "prayer_language", "contact"}
VERSES_PER_CHAPTER = 26  # 31,102 verses / 1,189 chapters, rounded down


class Refused(Exception):
    """The row breaks a publishing rule; nothing is written."""


def floor2(n):
    """Round down to two significant figures: 48,731 -> 48,000."""
    if n < 100:
        return n
    step = 10 ** (len(str(n)) - 2)
    return n // step * step


def check_count(name, v):
    if v is None:
        return None
    if not isinstance(v, int) or isinstance(v, bool):
        raise Refused(f"{name} is not a whole number")
    if v < 50:
        raise Refused(f"{name} is under the floor of 50")
    if floor2(v) != v:
        raise Refused(f"{name} is not rounded down to two significant figures")
    return v


def check_tenths(name, v):
    if v is None:
        return None
    if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 10:
        raise Refused(f"{name} is not a whole number of tenths")
    return v


def as_int(v):
    """BigQuery JSON export writes INT64 as a string."""
    if isinstance(v, str) and re.fullmatch(r"-?\d+", v):
        return int(v)
    return v


def validate_row(row):
    unknown = set(row) - ROW_KEYS
    if unknown:
        raise Refused(f"unexpected fields: {sorted(unknown)}")
    if as_int(row.get("schema_version")) != SCHEMA_VERSION:
        raise Refused("unknown schema_version")
    out = {k: check_count(k, as_int(row.get(k))) for k in COUNTS}
    out.update({k: check_tenths(k, as_int(row.get(k))) for k in TENTHS})
    p25, p75 = as_int(row.get("minutes_p25")), as_int(row.get("minutes_p75"))
    if (p25 is None) != (p75 is None):
        raise Refused("minutes_p25 and minutes_p75 must be hidden together")
    if p25 is not None and not (isinstance(p25, int) and isinstance(p75, int) and 0 < p25 <= p75 <= 30):
        raise Refused("minutes range is out of bounds")
    out["minutes"] = None if p25 is None else (p25, p75)
    countries = as_int(row.get("countries"))
    if countries is not None and (not isinstance(countries, int) or not 0 < countries < 260):
        raise Refused("countries must be a count")
    out["countries"] = countries
    continents = row.get("continents") or None
    if continents is not None:
        if not isinstance(continents, list) or not set(continents) <= set(CONTINENTS):
            raise Refused("continents must be a subset of the six slugs")
        continents = [c for c in CONTINENTS if c in continents]
    out["continents"] = continents
    out["months"] = validate_months(row.get("months") or [])
    try:
        out["data_through"] = dt.date.fromisoformat(row["data_through"]).isoformat()
    except (KeyError, TypeError, ValueError) as e:
        raise Refused("data_through must be an ISO date") from e
    return out


def validate_months(series):
    if len(series) > 13:
        raise Refused("more than 13 months")
    months, seen = [], []
    for m in series:
        if set(m) - {"month", "readers", "hours", "chapters"} or not re.fullmatch(r"\d{4}-\d{2}", m.get("month", "")):
            raise Refused("bad month entry")
        seen.append(m["month"])
        months.append({"month": m["month"], **{k: check_count(f"months.{k}", as_int(m.get(k)))
                                               for k in ("readers", "hours", "chapters")}})
    if seen != sorted(set(seen)):
        raise Refused("months must be distinct and oldest first")
    return months


def weeks_between(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days // 7


def build(row, static, config, now):
    r = validate_row(row)
    if set(static) - STATIC_KEYS:
        raise Refused(f"unexpected static fields: {sorted(set(static) - STATIC_KEYS)}")
    launched_on = config.get("launched_on")
    if launched_on is None and any(r[k] is not None for k in HEADLINE):
        launched_on = r["data_through"]
        config["launched_on"] = launched_on  # written back, so the Monday PR shows the launch
    doc = {
        "schema_version": SCHEMA_VERSION,
        "status": "live" if launched_on else "pre_launch",
        "generated_at": now,
        "data_through": r["data_through"],
    }
    if launched_on:
        if not static.get("running_cost_text"):
            raise Refused("static.running_cost_text must be confirmed before the page goes live")
        age = weeks_between(launched_on, r["data_through"])
        ships = lambda k: age >= SHIPS_AFTER_WEEKS.get(k, 0)  # noqa: E731
        doc.update(figures(r, ships))
    doc["hidden_count"] = count_hidden(doc)
    doc["static"] = static
    doc["corrections"] = config.get("corrections", [])
    return doc


def figures(r, ships):
    def total_week(k):
        d = {"total": r[f"{k}_total"]}
        if ships(f"{k}_week"):
            d["week"] = r[f"{k}_week"]
        return d

    reading = {"readers_week": r["readers_week"]}
    if ships("readers_4wk"):
        reading["readers_4wk"] = r["readers_4wk"]
    reading["days_begun"] = total_week("days")
    reading["hours"] = total_week("hours")
    reading["chapters"] = total_week("chapters")
    ch = r["chapters_total"]
    reading["verses_approx"] = None if ch is None else floor2(ch * VERSES_PER_CHAPTER)
    if ships("minutes"):
        reading["minutes_p25"], reading["minutes_p75"] = r["minutes"] or (None, None)
    out = {"reading": reading}
    returning = {k: r[k] for k in ("readers_3mo_plus", "rate_1mo_tenths", "rate_3mo_tenths") if ships(k)}
    if returning:
        out["returning"] = returning
    doorway = {}
    if ships("doorway_on_rate_tenths"):
        doorway["on_rate_tenths"] = r["doorway_on_rate_tenths"]
    if ships("step_outs_total"):
        doorway["step_outs"] = r["step_outs_total"]
    if doorway:
        out["doorway"] = doorway
    out["reach"] = {"installs_total": r["installs_total"], "active_last_month": r["active_last_month"],
                    "countries": r["countries"], "continents": r["continents"], "languages_count": 10}
    if ships("months") and r["months"]:
        out["months"] = {"series": r["months"]}
    if ships("share_rate_tenths") and r["share_rate_tenths"] is not None:
        out["honesty"] = {"share_rate_tenths": r["share_rate_tenths"]}
    return out


def count_hidden(doc):
    """Figures a reader would see as 'Not enough readers yet'. Derived lines (verses) are not counted."""
    n = 0
    for block in ("reading", "returning", "doorway", "reach", "honesty"):
        for k, v in doc.get(block, {}).items():
            if k in ("verses_approx", "minutes_p75", "languages_count"):
                continue
            if isinstance(v, dict):
                n += sum(1 for x in v.values() if x is None)
            elif v is None:
                n += 1
    return n


def main(argv):
    if len(argv) not in (5, 7):
        print(__doc__, file=sys.stderr)
        return 2
    now = argv[6] if len(argv) == 7 and argv[5] == "--now" else \
        dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(argv[1], encoding="utf-8") as f:
        lines = [ln for ln in f.read().splitlines() if ln.strip()]
    if len(lines) != 1:
        print("refused: the export must hold exactly one row", file=sys.stderr)
        return 1
    with open(argv[2], encoding="utf-8") as f:
        static = json.load(f)
    with open(argv[3], encoding="utf-8") as f:
        config = json.load(f)
    try:
        doc = build(json.loads(lines[0]), static, config, now)
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    with open(argv[4], "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(argv[3], "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {argv[4]}: status {doc['status']}, {doc['hidden_count']} hidden")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
