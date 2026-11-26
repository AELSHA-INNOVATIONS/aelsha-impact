# Firstfruits, in numbers

The public impact page for Firstfruits, a free Bible app from Aelsha Foundation. It is served by
GitHub Pages from `docs/` and linked from aelsha.in.

Every figure is a floor ("at least"), rounded down, and hidden when fewer than 50 phones stand
behind it. The page names no country and no language figure, and shows readers per week or month,
never a running total. "How we count" on the page explains the rest.

| Path | What it is |
| --- | --- |
| `docs/` | The page: `index.html`, `impact.css`, `impact.js` and the weekly `impact.json` |
| `build_impact_json.py` | Checks the weekly export row and writes `docs/impact.json`; refuses on any floor or rounding fault |
| `static.json` | Hand-written lines: running cost, contact, version |
| `config.json` | Launch date and the dated list of corrections |
| `tests/` | `python3 -m unittest discover -s tests -t .` and `node --test tests/*.test.mjs` (no packages) |
| `.github/workflows/impact-weekly.yml` | Monday: reads the private export with Workload Identity Federation (no key), checks it and opens a PR for a person to review |

The BigQuery queries that make the weekly export live in the app's private repository.

## Settings (once)
- Settings, Pages: Deploy from a branch, `main`, folder `/docs`.
- Settings, Actions, General: "Allow GitHub Actions to create and approve pull requests" (the
  organization may need to allow it first).
- Variables `IMPACT_WIF_PROVIDER`, `IMPACT_SERVICE_ACCOUNT`, `IMPACT_EXPORT_URI`. Until all three
  are set, the Monday workflow does nothing. The Workload Identity provider should accept only
  `assertion.repository == 'AELSHA-INNOVATIONS/aelsha-impact'`.
- Before going live, fill in `running_cost_text` and `contact` in `static.json`. The build refuses
  to publish live figures without the cost line.

The page is English only for now. Every translated sentence needs a native speaker's review first.
