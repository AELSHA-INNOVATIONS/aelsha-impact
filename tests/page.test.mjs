// node --test tests/*.test.mjs  (no packages). Renders the page logic against sample impact.json files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, valid, renderStatic, renderCorrections, staleLines, updatedLine } from '../docs/impact.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const live = () => load('./fixtures/impact_live.json');
const pre = () => load('../docs/impact.json');
const NOW = new Date('2027-06-08T00:00:00Z');
const text = (html) => html.replace(/&#39;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('pre-launch shows no figures and no zeros', () => {
  const d = pre();
  assert.ok(valid(d));
  const { figures, hidden } = render(d, 'en', new Date(d.generated_at));
  assert.match(figures, /Coming soon/);
  assert.doesNotMatch(text(figures), /\b0\b/);
  assert.equal(hidden, '');
});

test('live page says at least, never a bare total', () => {
  const { figures } = render(live(), 'en', NOW);
  const t = text(figures);
  assert.match(t, /At least 1,200 readers began their day in God's Word this week\./);
  assert.match(t, /At least 9,000 hours with God's Word since launch\./);
  assert.match(t, /That is about 800,000 verses\./);
  assert.match(t, /between 6 and 14 minutes\. A few minutes is enough\./);
  assert.match(t, /were still reading three months or more after they began/);
  assert.match(t, /Installed in 41 countries\./);
  assert.match(t, /In use on at least 7,000 phones last month\./);
  for (const bad of [/\block\b/i, /\bblock(ed|er)?\b/i, /streak/i, /souls?/i, /convert/i, /reached/i, /%/, /record/i]) {
    assert.doesNotMatch(t, bad);
  }
});

test('null shows the hidden sentence in place, absent shows nothing', () => {
  const d = live();
  d.reading.hours.total = null;
  delete d.returning;
  d.hidden_count = 1;
  const { figures, hidden } = render(d, 'en', NOW);
  assert.match(figures, /Not enough readers yet to show this safely\./);
  assert.doesNotMatch(figures, /Readers who come back/);
  assert.equal(hidden, '1 figure is hidden today because fewer than 50 phones stand behind it.');
});

test('a block with every figure hidden shows one hidden sentence', () => {
  const d = live();
  d.doorway = { on_rate_tenths: null, step_outs: null };
  const { figures } = render(d, 'en', NOW);
  const section = figures.split('id="h-doorway"')[1].split('</section>')[0];
  assert.equal(section.match(/Not enough readers yet/g).length, 1);
});

test('verses never show without chapters', () => {
  const d = live();
  d.reading.chapters.total = null;
  assert.doesNotMatch(render(d, 'en', NOW).figures, /verses/);
});

test('charts have alt text listing every month and a table fallback', () => {
  const { figures } = render(live(), 'en', NOW);
  assert.match(figures, /<desc id="c-readers-d">April 2027: at least 2,900\. May 2027: not enough readers to show\.<\/desc>/);
  assert.match(figures, /<caption>Readers each month<\/caption>/);
});

test('numbers follow the page language', () => {
  assert.match(text(render(live(), 'en-IN', NOW).figures), /48,000 days/);
  assert.match(text(render(live(), 'de', NOW).figures), /48\.000 days/);
});

test('stale lines after 10 and 35 days', () => {
  const g = new Date('2027-06-07T06:00:00Z');
  assert.equal(staleLines(3, g, 'en'), '');
  assert.match(staleLines(12, g, 'en'), /usually updated every Monday/);
  assert.match(staleLines(40, g, 'en'), /We are late updating this page/);
});

test('invalid documents are refused, never half rendered', () => {
  assert.equal(valid(null), false);
  assert.equal(valid({ ...live(), schema_version: 2 }), false);
  const d = live(); d.reading.readers_week = '1200'; assert.equal(valid(d), false);
  const e = live(); e.reach.continents = ['IN']; assert.equal(valid(e), false);
  const f = live(); f.doorway.on_rate_tenths = 11; assert.equal(valid(f), false);
});

test('text from the json is escaped', () => {
  const d = live();
  d.corrections = [{ date: '2027-01-11', figure: '<img src=x onerror=alert(1)>', was: 'a', now: 'b' }];
  assert.doesNotMatch(renderCorrections(d.corrections, 'en'), /<img/);
  const s = renderStatic({ ...d.static, running_cost_text: '<script>x</script>', contact: 'a@b.c"><script>' }, 'en');
  assert.doesNotMatch(s.free + s.contact, /<script>/);
});

test('static lines: money, code, contact', () => {
  const s = renderStatic(live().static, 'en-IN');
  assert.match(s.free, /Cost to you: ₹0\. .*Times we ask for money in the app: 0\./);
  assert.match(s.after, /The code is not public yet\./);
  assert.match(s.contact, /mailto:hello@example\.org/);
  assert.doesNotMatch(s.after, /native speaker/);
});

test('updated line uses time elements', () => {
  assert.match(updatedLine(live(), 'en'), /<time datetime="2027-06-06">Sunday, 6 June 2027<\/time>|<time datetime="2027-06-06">Sunday, June 6, 2027<\/time>/);
});
