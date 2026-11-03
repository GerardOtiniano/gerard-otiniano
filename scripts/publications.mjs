import { parseBibTeX, splitNames, plainTeX } from './bibtex.mjs';

export function formatAuthor(raw) {
  if (raw.toLowerCase() === 'others') return { text: 'et al.', highlight: false };
  if (raw.startsWith('{') && raw.endsWith('}')) return { text: plainTeX(raw), highlight: false };
  const parts = splitNames(raw, /\s*,\s*/y);
  let family;
  let given;
  let suffix = '';
  if (parts.length > 1) {
    family = plainTeX(parts[0]);
    given = plainTeX(parts.at(-1));
    if (parts.length > 2) suffix = `, ${plainTeX(parts[1])}`;
  } else {
    const words = plainTeX(raw).split(/\s+/);
    family = words.pop();
    // BibTeX's lower-case name particles, e.g. Anne de Vernal.
    while (words.length && /^[a-z]/.test(words.at(-1))) family = `${words.pop()} ${family}`;
    given = words.join(' ');
  }
  const initials = (given.match(/\p{L}[\p{L}\p{M}]*/gu) || [])
    .map(part => `${part[0]}.`).join(' ');
  return {
    text: `${family}${initials ? `, ${initials}` : ''}${suffix}`,
    highlight: family.toLowerCase() === 'otiniano' && /^g/i.test(given)
  };
}

export function publicationYear(fields) {
  return plainTeX(fields.year || fields.date || '').match(/\d{4}/)?.[0] || '';
}

export function publicationLinks(fields) {
  let doi = plainTeX(fields.doi).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
  const links = [];
  if (/^10\.\d{4,9}\/\S+$/i.test(doi)) links.push({ text: `https://doi.org/${doi}`, href: `https://doi.org/${doi}` });
  else if (fields.url) {
    try {
      const url = new URL(plainTeX(fields.url));
      if (['https:', 'http:'].includes(url.protocol)) links.push({ text: url.href, href: url.href });
    } catch { /* Invalid URLs are omitted. */ }
  }
  // Zotero's local attachment paths are intentionally ignored. Store a public PDF
  // path in Extra as tex.pdf, or keep the existing tex.filename convention.
  const pdf = plainTeX(fields.pdf || (fields.filename ? `papers/${plainTeX(fields.filename).replace(/\.pdf$/i, '')}.pdf` : ''));
  if (/^papers\/(?!.*(?:\.\.|[\\?#]))[^/]+\.pdf$/i.test(pdf)) {
    links.push({ text: 'PDF', href: pdf, pdf: true });
  } else if (/^https?:\/\//i.test(pdf)) {
    try { links.push({ text: 'PDF', href: new URL(pdf).href, pdf: true }); } catch { /* Invalid URL. */ }
  }
  return links;
}

export function renderPublication(entry, inReview, document) {
  const { fields } = entry;
  const paragraph = document.createElement('p');
  const authors = splitNames(fields.author || fields.editor || '');
  authors.forEach((raw, index) => {
    if (index) paragraph.append(', ');
    const author = formatAuthor(raw);
    if (author.highlight) {
      const strong = document.createElement('strong');
      strong.textContent = author.text;
      paragraph.append(strong);
    } else paragraph.append(author.text);
  });
  const year = publicationYear(fields);
  paragraph.append(`${authors.length ? ' ' : ''}${year ? `(${year}). ` : ''}${plainTeX(fields.title)}`);
  const journal = plainTeX(fields.journal || fields.journaltitle || fields.booktitle || '');
  if (inReview) {
    const target = plainTeX(fields.submittedto || journal || fields.address || '');
    paragraph.append(` [${target ? `Submitted to ${target}` : 'In review'}].`);
  } else {
    paragraph.append('.');
    if (journal) paragraph.append(` ${journal}`);
    const volume = plainTeX(fields.volume);
    const issue = plainTeX(fields.number || fields.issue);
    if (volume) paragraph.append(`, ${volume}${issue ? `(${issue})` : ''}`);
    const pages = plainTeX(fields.pages || fields.eid);
    if (pages) paragraph.append(`, ${pages}`);
    if (journal || volume || pages) paragraph.append('.');
  }
  for (const link of publicationLinks(fields)) {
    paragraph.append(' ');
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.pdf ? `(${inReview ? 'Preprint PDF' : 'PDF'})` : link.text;
    paragraph.append(anchor);
  }
  return paragraph;
}

export async function loadPublications(container, fetcher = fetch) {
  const file = container.dataset.bib;
  container.setAttribute('aria-busy', 'true');
  try {
    const response = await fetcher(file, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const entries = parseBibTeX(await response.text());
    entries.sort((a, b) => Number(publicationYear(b.fields)) - Number(publicationYear(a.fields)));
    const document = container.ownerDocument;
    const content = document.createDocumentFragment();
    for (const entry of entries) content.append(renderPublication(entry, container.dataset.status === 'review', document));
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = container.dataset.status === 'review' ? 'No publications currently in review.' : 'No peer-reviewed publications yet.';
      content.append(empty);
    }
    container.replaceChildren(content);
  } catch (error) {
    console.error(`Could not load ${file}:`, error);
    const message = container.ownerDocument.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = 'Publications could not be loaded. Please try again later.';
    container.replaceChildren(message);
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

if (typeof document !== 'undefined') {
  // Each list loads independently: an unavailable file does not hide the other.
  document.querySelectorAll('[data-bib]').forEach(container => loadPublications(container));
}
