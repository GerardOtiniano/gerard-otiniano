import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseBibTeX, plainTeX, splitNames } from '../scripts/bibtex.mjs';
import { formatAuthor, publicationLinks, loadPublications } from '../scripts/publications.mjs';

test('reads Zotero exports, nested protection, escaped braces, strings and concatenation', () => {
  const entries = parseBibTeX(String.raw`
    % A comment with an @ sign
    @comment{Ignored {nested} content}
    @string{venue = "Climate " # {of the Past}}
    @preamble{"ignored"}
    @ARTICLE(key:2026,
      TITLE = {{Greenland} and {brGDGTs}: a \{test\}},
      author = {de Vernal, Anne and {Research and Development} and Casta{\~n}eda, I. S.},
      journal = venue, year = 2026, month = jan,
      note = "A {nested} quote: \"ok\"", abstract = {An email a@b.org},
    )`);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fields.journal, 'Climate of the Past');
  assert.equal(entries[0].fields.month, 'January');
  assert.equal(plainTeX(entries[0].fields.title), 'Greenland and brGDGTs: a test');
  assert.equal(splitNames(entries[0].fields.author).length, 3);
  assert.equal(plainTeX(String.raw`Casta{\~n}eda, Weckstr{\"o}m, Heikkil{\"a}, {\'E}milie \& brGDGTs`), 'Castañeda, Weckström, Heikkilä, Émilie & brGDGTs');
});

test('formats full names and initials, protected family names, suffixes and corporate authors', () => {
  assert.deepEqual(formatAuthor('Otiniano, Gerard A.'), { text: 'Otiniano, G. A.', highlight: true });
  assert.equal(formatAuthor('G. A. Otiniano').highlight, true);
  assert.equal(formatAuthor('Anne de Vernal').text, 'de Vernal, A.');
  assert.equal(formatAuthor('{Walcott-George}, C. K.').text, 'Walcott-George, C. K.');
  assert.equal(formatAuthor('Smith, Jr., John Paul').text, 'Smith, J. P., Jr.');
  assert.equal(formatAuthor('{Research and Development}').text, 'Research and Development');
});

test('rejects broken exports instead of silently showing incomplete lists', () => {
  for (const input of ['@article{x, title = {broken}', '@article{x, title = "broken}', '@article{x, year=2026}']) {
    assert.throws(() => parseBibTeX(input));
  }
  assert.deepEqual(parseBibTeX('% an empty collection\n'), []);
});

test('builds DOI and PDF links without exposing Zotero paths or accepting unsafe URLs', () => {
  assert.deepEqual(publicationLinks({ doi: 'https://doi.org/10.1029/2025PA005316', filename: 'Otiniano2025', file: '/Users/private.pdf' }), [
    { text: 'https://doi.org/10.1029/2025PA005316', href: 'https://doi.org/10.1029/2025PA005316' },
    { text: 'PDF', href: 'papers/Otiniano2025.pdf', pdf: true }
  ]);
  assert.equal(publicationLinks({ pdf: 'papers/Topness2026.pdf' })[0].href, 'papers/Topness2026.pdf');
  for (const field of ['javascript:alert(1)', 'data:text/html,hello', 'file:///private.pdf', '/Users/gerard/private.pdf', 'papers/../private.pdf']) {
    assert.deepEqual(publicationLinks({ url: field, pdf: field }), []);
  }
});

// A tiny DOM stand-in lets the loading/error behavior run without dependencies.
class Node {
  constructor(tag, document) { this.tag = tag; this.ownerDocument = document; this.children = []; this.attributes = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  set textContent(value) { this.children = [value]; }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
}
const document = { createElement(tag) { return new Node(tag, this); }, createDocumentFragment() { return new Node('fragment', this); } };
function container(status = 'review') {
  const node = new Node('div', document);
  node.dataset = { bib: 'source/test.bib', status };
  return node;
}

test('loads and sorts changed data, renders text safely, and supports empty collections', async () => {
  const list = container();
  let options;
  await loadPublications(list, async (_, config) => {
    options = config;
    return { ok: true, text: async () => '@article{a, title={Older}, year=2024}\n@article{b, title={<img src=x onerror=alert(1)>}, date={2026-01-02}, author={Otiniano, Gerard A.}, submittedto={New Journal}}' };
  });
  assert.equal(options.cache, 'no-cache');
  assert.match(list.textContent, /^Otiniano, G\. A\. \(2026\)\. <img/);
  assert.match(list.textContent, /Submitted to New Journal/);
  assert.equal(list.children[0].children[0].children[0].tag, 'strong');
  assert.equal(list.attributes['aria-busy'], 'false');
  await loadPublications(list, async () => ({ ok: true, text: async () => '' }));
  assert.equal(list.textContent, 'No publications currently in review.');
});

test('a failed or malformed file leaves the other collection usable', async () => {
  const bad = container();
  const good = container('published');
  const log = console.error;
  console.error = () => {};
  try {
    for (const response of [{ ok: false, status: 404 }, { ok: true, text: async () => '@article{bad, title={broken}' }]) {
      await Promise.all([
        loadPublications(bad, async () => response),
        loadPublications(good, async () => ({ ok: true, text: async () => '@article{ok, title={Working}, year=2026}' }))
      ]);
      assert.match(bad.textContent, /could not be loaded/);
      assert.match(good.textContent, /Working/);
      assert.equal(bad.attributes['aria-busy'], 'false');
    }
  } finally { console.error = log; }
});

test('both live bibliography files parse and their local PDF links exist', () => {
  for (const file of ['in-review', 'peer-reviewed']) {
    const entries = parseBibTeX(readFileSync(new URL(`../source/${file}.bib`, import.meta.url), 'utf8'));
    for (const { fields } of entries) {
      for (const link of publicationLinks(fields).filter(link => link.pdf)) {
        if (link.href.startsWith('papers/')) assert.ok(existsSync(new URL(`../${link.href}`, import.meta.url)), link.href);
      }
    }
  }
});
