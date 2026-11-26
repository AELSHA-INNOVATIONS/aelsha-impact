"""Tests for build_impact_json.py against sample export rows (no BigQuery needed)."""
import copy
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import build_impact_json as b  # noqa: E402

NOW = "2027-06-07T06:00:00Z"


def load(name):
    return json.loads((HERE / "fixtures" / name).read_text(encoding="utf-8"))


STATIC = json.loads((HERE.parent / "static.json").read_text(encoding="utf-8"))
LIVE_STATIC = {**STATIC, "running_cost_text": "Rs 0 last quarter (confirmed by the founder)."}


class Floor2(unittest.TestCase):
    def test_rounds_down_to_two_significant_figures(self):
        self.assertEqual(b.floor2(48731), 48000)
        self.assertEqual(b.floor2(1299), 1200)
        self.assertEqual(b.floor2(999), 990)
        self.assertEqual(b.floor2(73), 73)
        self.assertEqual(b.floor2(806000), 800000)


class Refusals(unittest.TestCase):
    def refused(self, **change):
        row = load("row_full.json")
        row.update(change)
        with self.assertRaises(b.Refused):
            b.build(row, LIVE_STATIC, {"launched_on": "2026-12-06"}, NOW)

    def test_count_under_fifty(self):
        self.refused(readers_week="49")

    def test_count_not_rounded_down(self):
        self.refused(hours_total="9123")

    def test_unknown_field_such_as_a_country_name(self):
        self.refused(top_country="IN")

    def test_language_share_is_cut(self):
        self.refused(language_time_share=[{"code": "en", "tenths": 4}])

    def test_rate_out_of_range(self):
        self.refused(rate_1mo_tenths="11")

    def test_minutes_hidden_together(self):
        self.refused(minutes_p75=None)

    def test_continent_not_in_the_six(self):
        self.refused(continents=["antarctica"])

    def test_months_out_of_order(self):
        self.refused(months=[{"month": "2027-05", "readers": None, "hours": None, "chapters": None},
                             {"month": "2027-04", "readers": None, "hours": None, "chapters": None}])

    def test_schema_version(self):
        self.refused(schema_version="2")

    def test_live_needs_confirmed_running_cost(self):
        with self.assertRaises(b.Refused):
            b.build(load("row_full.json"), STATIC, {"launched_on": "2026-12-06"}, NOW)


class PreLaunch(unittest.TestCase):
    def test_no_figures_and_no_zeros(self):
        doc = b.build(load("row_pre_launch.json"), STATIC, {"launched_on": None}, NOW)
        self.assertEqual(doc["status"], "pre_launch")
        for block in ("reading", "returning", "doorway", "reach", "months", "honesty"):
            self.assertNotIn(block, doc)
        self.assertEqual(doc["hidden_count"], 0)

    def test_first_headline_figure_launches_and_records_the_date(self):
        row = load("row_full.json")
        config = {"launched_on": None}
        doc = b.build(row, LIVE_STATIC, config, NOW)
        self.assertEqual(doc["status"], "live")
        self.assertEqual(config["launched_on"], "2027-06-06")
        # Launch week: later figures are absent, not null.
        self.assertNotIn("readers_4wk", doc["reading"])
        self.assertNotIn("week", doc["reading"]["hours"])
        self.assertNotIn("returning", doc)
        self.assertNotIn("months", doc)


class Live(unittest.TestCase):
    def setUp(self):
        self.doc = b.build(load("row_full.json"), LIVE_STATIC, {"launched_on": "2026-12-06"}, NOW)

    def test_every_figure_is_shipped_after_six_months(self):
        r = self.doc["reading"]
        self.assertEqual(r["readers_week"], 1200)
        self.assertEqual(r["days_begun"], {"total": 48000, "week": 1800})
        self.assertEqual((r["minutes_p25"], r["minutes_p75"]), (6, 14))
        self.assertEqual(self.doc["returning"]["rate_3mo_tenths"], 2)
        self.assertEqual(self.doc["doorway"], {"on_rate_tenths": 6, "step_outs": 5000})

    def test_verses_are_chapters_times_26_rounded_down(self):
        self.assertEqual(self.doc["reading"]["verses_approx"], 800000)

    def test_geography_is_counts_only_in_fixed_order(self):
        reach = self.doc["reach"]
        self.assertEqual(reach["countries"], 41)
        self.assertEqual(reach["continents"], ["africa", "asia", "europe", "north_america", "south_america"])
        self.assertNotIn("language_time_share", reach)

    def test_hidden_month_stays_null_and_is_counted_nowhere_else(self):
        self.assertIsNone(self.doc["months"]["series"][1]["readers"])
        self.assertEqual(self.doc["hidden_count"], 0)

    def test_null_figure_is_counted_as_hidden(self):
        row = load("row_full.json")
        row.update(readers_4wk=None, rate_1mo_tenths=None)
        doc = b.build(row, LIVE_STATIC, {"launched_on": "2026-12-06"}, NOW)
        self.assertIsNone(doc["reading"]["readers_4wk"])
        self.assertEqual(doc["hidden_count"], 2)

    def test_output_holds_no_name_language_or_id(self):
        text = json.dumps(self.doc).lower()
        for bad in ("india", "\"in\"", "telugu", "user_pseudo_id", "app_instance", "souls", "converts"):
            self.assertNotIn(bad, text)


class Cli(unittest.TestCase):
    def run_cli(self, row_name, static):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            (d / "static.json").write_text(json.dumps(static))
            (d / "config.json").write_text(json.dumps({"launched_on": None, "corrections": []}))
            p = subprocess.run([sys.executable, "-I", str(HERE.parent / "build_impact_json.py"),
                                str(HERE / "fixtures" / row_name), str(d / "static.json"),
                                str(d / "config.json"), str(d / "impact.json"), "--now", NOW],
                               capture_output=True, text=True)
            out = json.loads((d / "impact.json").read_text()) if (d / "impact.json").exists() else None
            return p.returncode, out, p.stderr

    def test_writes_pre_launch(self):
        code, out, _ = self.run_cli("row_pre_launch.json", STATIC)
        self.assertEqual(code, 0)
        self.assertEqual(out["status"], "pre_launch")

    def test_refusal_writes_nothing(self):
        code, out, err = self.run_cli("row_full.json", STATIC)
        self.assertEqual(code, 1)
        self.assertIsNone(out)
        self.assertIn("running_cost_text", err)

    def test_committed_site_json_is_valid_pre_launch(self):
        doc = json.loads((HERE.parent / "docs" / "impact.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["schema_version"], 1)
        self.assertEqual(doc["status"], "pre_launch")


if __name__ == "__main__":
    unittest.main()
