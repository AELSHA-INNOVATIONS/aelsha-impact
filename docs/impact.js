// aelsha.in/impact: renders impact.json (ADR 0020). No framework, no third party, no cookies.
// Rules: a key that is absent was not shipped yet (render nothing); null was hidden by a floor
// (render the hidden sentence). The page never rounds or computes a figure; the export did.
export const SCHEMA_VERSION = 1;
export const LANGUAGES = ['English', 'Tamil', 'Spanish', 'Portuguese', 'French', 'Russian',
  'Simplified Chinese', 'German', 'Telugu', 'Malayalam'];
const LANGUAGE_BY_CODE = { en: 'English', ta: 'Tamil', es: 'Spanish', pt: 'Portuguese', fr: 'French',
  ru: 'Russian', zh: 'Simplified Chinese', de: 'German', te: 'Telugu', ml: 'Malayalam' };
export const CONTINENTS = ['north_america', 'europe', 'asia', 'south_america', 'africa', 'oceania'];
const CONTINENT_NAME = { africa: 'Africa', asia: 'Asia', europe: 'Europe', north_america: 'North America',
  south_america: 'South America', oceania: 'Oceania' };
const HIDDEN = 'Not enough readers yet to show this safely.';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatter(lang) {
  const nf = new Intl.NumberFormat(lang);
  return (n) => nf.format(n);
}

const isCount = (v) => v === null || (Number.isInteger(v) && v >= 0);
const isTenths = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 10);

/** Returns true only for a document this page knows how to show; anything else is a load error. */
export function valid(doc) {
  if (!doc || typeof doc !== 'object' || doc.schema_version !== SCHEMA_VERSION) return false;
  if (!['pre_launch', 'live'].includes(doc.status)) return false;
  if (Number.isNaN(Date.parse(doc.generated_at)) || !/^\d{4}-\d{2}-\d{2}$/.test(doc.data_through)) return false;
  const r = doc.reading;
  if (r) {
    for (const k of ['readers_week', 'readers_4wk', 'verses_approx', 'minutes_p25', 'minutes_p75']) {
      if (k in r && !isCount(r[k])) return false;
    }
    for (const k of ['days_begun', 'hours', 'chapters']) {
      if (!r[k] || !isCount(r[k].total) || ('week' in r[k] && !isCount(r[k].week))) return false;
    }
  }
  for (const [block, keys] of [['returning', ['readers_3mo_plus']], ['doorway', ['step_outs']],
    ['reach', ['installs_total', 'active_last_month', 'countries', 'languages_count']]]) {
    if (doc[block]) for (const k of keys) if (k in doc[block] && !isCount(doc[block][k])) return false;
  }
  for (const [block, k] of [['returning', 'rate_1mo_tenths'], ['returning', 'rate_3mo_tenths'],
    ['doorway', 'on_rate_tenths'], ['honesty', 'share_rate_tenths']]) {
    if (doc[block] && k in doc[block] && !isTenths(doc[block][k])) return false;
  }
  const c = doc.reach?.continents;
  if (c !== undefined && c !== null && !(Array.isArray(c) && c.every((x) => CONTINENTS.includes(x)))) return false;
  const s = doc.months?.series;
  if (s !== undefined && !(Array.isArray(s) && s.length <= 13 && s.every((m) => /^\d{4}-\d{2}$/.test(m.month)
    && isCount(m.readers) && isCount(m.hours) && isCount(m.chapters)))) return false;
  return true;
}

/** A figure card: one element so a screen reader reads the sentence once. */
function card(value, sentence, fmt, extra = '') {
  if (value === null) return `<li class="card hidden-figure"><p>${HIDDEN}</p></li>`;
  return `<li class="card"><p><span class="big" aria-hidden="true">${esc(fmt(value))}</span>`
    + `<span class="sentence">${esc(sentence(fmt(value)))}</span></p>${extra}</li>`;
}

function line(value, sentence, fmt) {
  if (value === null) return `<p class="hidden-figure">${HIDDEN}</p>`;
  return `<p>${esc(sentence(fmt(value)))}</p>`;
}

function block(id, title, inner) {
  return `<section aria-labelledby="h-${id}"><h2 id="h-${id}">${esc(title)}</h2>${inner}</section>`;
}

/** If every shown figure in a block is hidden, one hidden sentence replaces them all. */
function allHidden(values) {
  return values.length > 0 && values.every((v) => v === null);
}

const monthName = (ym, lang) => new Date(`${ym}-15T00:00:00Z`)
  .toLocaleDateString(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function chart(title, key, series, fmt, lang) {
  const vals = series.map((m) => m[key]);
  const max = Math.max(1, ...vals.filter((v) => v !== null));
  const w = 20; const gap = 6; const h = 120; const width = 13 * (w + gap); // always 13 slots, so bars keep one size
  const desc = series.map((m) => `${monthName(m.month, lang)}: `
    + (m[key] === null ? 'not enough readers to show' : `at least ${fmt(m[key])}`)).join('. ');
  const bars = series.map((m, i) => {
    const x = i * (w + gap);
    if (m[key] === null) return `<text x="${x + w / 2}" y="${h + 14}" class="hid">hidden</text>`;
    const bh = Math.max(1, Math.round((m[key] / max) * (h - 18)));
    return `<rect x="${x}" y="${h - bh}" width="${w}" height="${bh}"></rect>`
      + `<text x="${x + w / 2}" y="${h - bh - 4}">${esc(fmt(m[key]))}</text>`;
  }).join('');
  const id = `c-${key}`;
  const rows = series.map((m) => `<tr><td>${esc(monthName(m.month, lang))}</td><td>`
    + `${m[key] === null ? 'Not enough readers to show' : esc(fmt(m[key]))}</td></tr>`).join('');
  return `<figure class="chart"><svg role="img" aria-labelledby="${id}-t ${id}-d" viewBox="0 -4 ${width} ${h + 22}">`
    + `<title id="${id}-t">${esc(title)} each month, last ${series.length} months.</title>`
    + `<desc id="${id}-d">${esc(desc)}.</desc><line x1="0" y1="${h}" x2="${width}" y2="${h}"></line>${bars}</svg>`
    + `<details><summary>See the numbers as a table</summary><table><caption>${esc(title)} each month</caption>`
    + `<thead><tr><th scope="col">Month</th><th scope="col">At least</th></tr></thead><tbody>${rows}</tbody></table>`
    + '</details></figure>';
}

function continentMap(filled) {
  // A tile map, one tone, no counts or names inside: the sentence beside it carries the meaning.
  const pos = { north_america: [0, 0], europe: [2, 0], asia: [3, 0], south_america: [0, 1], africa: [2, 1], oceania: [3, 1] };
  const tiles = CONTINENTS.map((c) => `<rect x="${pos[c][0] * 26}" y="${pos[c][1] * 22}" width="22" height="18" rx="4"`
    + ` class="${filled.includes(c) ? 'on' : 'off'}"></rect>`).join('');
  return `<svg class="map" aria-hidden="true" focusable="false" viewBox="0 0 100 40">${tiles}</svg>`;
}

/** Builds the figures area. Returns HTML. */
export function render(doc, lang = 'en', now = new Date()) {
  const fmt = formatter(lang);
  const out = [];
  const gen = new Date(doc.generated_at);
  const ageDays = (now - gen) / 86400000;
  if (doc.status === 'pre_launch') {
    out.push('<p class="notice">Coming soon. We will publish the first numbers when at least 50 readers have chosen'
      + ' to share, so no one can be picked out. Until then, here is how we count.</p>');
    return { figures: out.join(''), stale: staleLines(ageDays, gen, lang), hidden: '' };
  }
  const r = doc.reading;
  if (r) {
    const shown = [r.readers_week, r.readers_4wk, r.days_begun.total, r.hours.total, r.chapters.total]
      .filter((v) => v !== undefined);
    let inner;
    if (allHidden(shown)) inner = `<p class="hidden-figure">${HIDDEN}</p>`;
    else {
      const wk = (o) => ('week' in o && o.week !== null ? `<p class="week">This week: ${esc(fmt(o.week))}</p>` : '');
      const cards = [card(r.readers_week, (n) => `At least ${n} readers began their day in God's Word this week.`, fmt,
        '<p class="small">A reader is a phone that said yes to sharing.</p>')];
      if ('readers_4wk' in r) cards.push(card(r.readers_4wk, (n) => `At least ${n} readers in the last four weeks.`, fmt));
      cards.push(card(r.days_begun.total, (n) => `At least ${n} days begun in God's Word since launch.`, fmt, wk(r.days_begun)));
      cards.push(card(r.hours.total, (n) => `At least ${n} hours with God's Word since launch.`, fmt, wk(r.hours)));
      const verses = r.chapters.total !== null && r.verses_approx !== null
        ? `<p class="small">That is about ${esc(fmt(r.verses_approx))} verses.</p>` : '';
      cards.push(card(r.chapters.total, (n) => `At least ${n} chapters read since launch.`, fmt, wk(r.chapters) + verses));
      inner = `<ul class="cards">${cards.join('')}</ul>`;
      if ('minutes_p25' in r) {
        inner += r.minutes_p25 === null ? `<p class="hidden-figure">${HIDDEN}</p>`
          : `<p>On a day they read, readers usually spend between ${esc(fmt(r.minutes_p25))} and `
            + `${esc(fmt(r.minutes_p75))} minutes. A few minutes is enough.</p>`;
      }
    }
    out.push(block('reading', 'Reading', inner));
  }
  const ret = doc.returning;
  if (ret) {
    const vals = Object.values(ret);
    let inner = allHidden(vals) ? `<p class="hidden-figure">${HIDDEN}</p>` : [
      'readers_3mo_plus' in ret ? line(ret.readers_3mo_plus, (n) => `At least ${n} readers were still reading three months or more after they began.`, fmt) : '',
      'rate_1mo_tenths' in ret ? line(ret.rate_1mo_tenths, (n) => `Of readers who start, about ${n} in 10 are still reading a month later.`, fmt) : '',
      'rate_3mo_tenths' in ret ? line(ret.rate_3mo_tenths, (n) => `About ${n} in 10 are still reading three months later.`, fmt) : '',
    ].join('');
    inner += '<p class="small">These pool every group of new readers together, so no single week or church can be picked out.</p>';
    out.push(block('returning', 'Readers who come back', inner));
  }
  const d = doc.doorway;
  if (d) {
    const inner = allHidden(Object.values(d)) ? `<p class="hidden-figure">${HIDDEN}</p>` : [
      'on_rate_tenths' in d ? line(d.on_rate_tenths, (n) => `About ${n} in 10 readers choose to open God's Word before their other apps each morning.`, fmt) : '',
      'step_outs' in d ? line(d.step_outs, (n) => `Stepping out is always one tap. Readers used it at least ${n} times, and that is fine.`, fmt) : '',
    ].join('');
    out.push(block('doorway', 'The doorway', inner));
  }
  const reach = doc.reach;
  if (reach) {
    const cont = reach.continents;
    const contLine = cont === null || cont === undefined ? `<p class="hidden-figure">${HIDDEN}</p>`
      : `<p>Installed on ${esc(fmt(cont.length))} continents: ${esc(CONTINENTS.filter((c) => cont.includes(c)).map((c) => CONTINENT_NAME[c]).join(', '))}.</p>`;
    out.push(block('reach', 'Where the app is', [
      '<p class="small">These come from Google Play, which counts every install without knowing who anyone is.</p>',
      line(reach.installs_total, (n) => `Installed on at least ${n} phones since launch.`, fmt),
      line(reach.active_last_month, (n) => `In use on at least ${n} phones last month.`, fmt),
      line(reach.countries, (n) => `Installed in ${n} countries.`, fmt),
      contLine, cont ? continentMap(cont) : '',
      `<p>The app speaks ${esc(fmt(LANGUAGES.length))} languages: ${esc(LANGUAGES.join(', '))}.</p>`,
      Object.hasOwn(LANGUAGE_BY_CODE, String(doc.static?.prayer_language))
        ? `<p>This month we pray for readers who use the app in ${esc(LANGUAGE_BY_CODE[doc.static.prayer_language])}.</p>` : '',
    ].join('')));
  }
  const series = doc.months?.series;
  if (series && series.length) {
    out.push(block('months', 'Month by month',
      '<p>Each bar is one finished calendar month. Months with fewer than 50 phones are left out.</p>'
      + chart('Readers', 'readers', series, fmt, lang) + chart('Hours', 'hours', series, fmt, lang)
      + chart('Chapters', 'chapters', series, fmt, lang) + '<p class="small">A fall is shown as plainly as a rise.</p>'));
  }
  const share = doc.honesty?.share_rate_tenths;
  out.push(block('honesty', 'What these numbers leave out', share === undefined ? '<p>Many phones chose not to share. Everyone else is missing from this page, and that is their right.</p>'
    : line(share, (n) => `About ${n} in 10 phones chose to share. Everyone else is missing from this page, and that is their right.`, fmt)));
  const n = doc.hidden_count;
  const hidden = n > 0 ? `${n === 1 ? '1 figure is' : `${fmt(n)} figures are`} hidden today because fewer than 50 phones stand behind ${n === 1 ? 'it' : 'them'}.` : '';
  return { figures: out.join(''), stale: staleLines(ageDays, gen, lang), hidden };
}

export function staleLines(ageDays, gen, lang) {
  if (ageDays <= 10) return '';
  const date = gen.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  let s = `This page is usually updated every Monday. The figures below are from ${date} and are still true as a floor.`;
  if (ageDays > 35) s += ' We are late updating this page. Write to us if you would like to know why.';
  return s;
}

export function updatedLine(doc, lang) {
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  const g = new Date(doc.generated_at).toLocaleDateString(lang, opts);
  const t = new Date(`${doc.data_through}T12:00:00Z`).toLocaleDateString(lang, opts);
  return `Updated <time datetime="${esc(doc.generated_at)}">${esc(g)}</time>. Figures up to `
    + `<time datetime="${esc(doc.data_through)}">${esc(t)}</time>.`;
}

/** The static block lines that depend on impact.json's "static" part. */
export function renderStatic(st, lang) {
  let zero;
  try {
    zero = new Intl.NumberFormat(lang, { style: 'currency', currency: st.currency || 'INR', maximumFractionDigits: 0 }).format(0);
  } catch { zero = 'nothing'; }
  const free = [`<p>Cost to you: ${esc(zero)}. Ads: 0. Purchases: 0. Accounts: 0. Times we ask for money in the app: 0.</p>`];
  if (st.running_cost_text) free.push(`<p>${esc(st.running_cost_text)}</p>`);
  const after = [];
  if (st.translations_reviewed_all === true) after.push('<p>Every translation of the app is checked by a native speaker before release.</p>');
  if (st.version && st.version.name && st.version.released) {
    const changes = (st.version.changes || []).map((c) => `<li>${esc(c)}</li>`).join('');
    after.push(`<p>Current version ${esc(st.version.name)}, released ${esc(new Date(`${st.version.released}T12:00:00Z`)
      .toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}.</p>`
      + (changes ? `<ul>${changes}</ul>` : ''));
  }
  const url = typeof st.repo_url === 'string' && /^https:\/\/github\.com\//.test(st.repo_url) ? st.repo_url : null;
  after.push(st.repo_public === true && url ? `<p><a href="${esc(url)}">Read the code</a></p>` : '<p>The code is not public yet.</p>');
  const contact = typeof st.contact === 'string' && /^[^\s@<>"]+@[^\s@<>"]+$/.test(st.contact)
    ? ` Write to us: <a href="mailto:${esc(st.contact)}">${esc(st.contact)}</a>.` : '';
  return { free: free.join(''), after: after.join(''), contact };
}

export function renderCorrections(list, lang) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return '<ul>' + [...list].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((c) => `<li><time datetime="${esc(c.date)}">`
    + `${esc(new Date(`${c.date}T12:00:00Z`).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</time>: `
    + `${esc(c.figure)}. It said ${esc(c.was)}; it is now ${esc(c.now)}.</li>`).join('') + '</ul>';
}

async function main() {
  const lang = document.documentElement.lang || 'en';
  document.getElementById('print-link').addEventListener('click', (e) => { e.preventDefault(); window.print(); });
  let doc;
  try {
    const res = await fetch('impact.json', { cache: 'no-cache', credentials: 'omit' });
    doc = await res.json();
  } catch { doc = null; }
  if (!valid(doc)) { document.getElementById('load-error').hidden = false; return; }
  const { figures, stale, hidden } = render(doc, lang);
  const updated = document.getElementById('updated');
  updated.innerHTML = updatedLine(doc, lang)
    + (stale ? `<br><span class="stale">${esc(stale)}</span>` : '')
    + (hidden ? `<br><span>${esc(hidden)}</span>` : '');
  document.getElementById('numbers').insertAdjacentHTML('beforeend', figures);
  if (doc.static) {
    const st = renderStatic(doc.static, lang);
    document.getElementById('free-dynamic').innerHTML = st.free;
    document.getElementById('free-after').innerHTML = st.after;
    document.getElementById('contact').innerHTML = st.contact;
  }
  const corr = renderCorrections(doc.corrections, lang);
  if (corr) document.getElementById('corrections-list').innerHTML = corr;
  document.getElementById('print-footer').textContent = `aelsha.in/impact. ${updated.textContent}`;
}

if (typeof document !== 'undefined') main();
