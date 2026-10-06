const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
const translated = new Set(
  [...runtime.matchAll(/'((?:\\'|[^'])+)'\s*:/g)].map((match) => match[1].replace(/\\'/g, "'")),
);
const hasVietnamese = (value) => /[À-ỹĐđ]/.test(value);
const clean = (value) => value.replace(/\s+/g, ' ').trim();

const htmlFiles = [
  'public/index.html', 'public/auth.html', 'public/billing.html',
  ...fs.readdirSync(path.join(root, 'public/pages')).filter((name) => name.endsWith('.html')).map((name) => `public/pages/${name}`),
];
const jsFiles = [
  'public/js/app.js', 'public/js/navigation.js', 'public/js/support-widget.js',
  ...fs.readdirSync(path.join(root, 'public/js/pages')).filter((name) => name.endsWith('.js')).map((name) => `public/js/pages/${name}`),
];

const unresolved = new Map();
function add(file, raw) {
  const value = clean(raw);
  if (!value || !hasVietnamese(value) || translated.has(value)) return;
  if (value === 'đ' || value.includes(" ? '") || value.startsWith('col.pinned ?') || value.startsWith('secretConfigured.')) return;
  if (/^[<>=:/]|\bx-(text|show|if|for)\b|\$\{|<\/?(span|div|button|template)/.test(value)) return;
  if (!unresolved.has(file)) unresolved.set(file, new Set());
  unresolved.get(file).add(value);
}

function addStringLiterals(file, expression) {
  for (const match of expression.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (!value.includes('${')) add(file, value);
  }
}

for (const file of htmlFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const match of source.matchAll(/>([^<>]+)</g)) add(file, match[1]);
  for (const match of source.matchAll(/(?:placeholder|title|aria-label|alt)=(['"])(.*?)\1/g)) add(file, match[2]);
  for (const match of source.matchAll(/\s(?:x-[\w:-]+|:[\w:-]+|@[\w.:-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
    addStringLiterals(file, match[1] ?? match[2] ?? '');
  }
}

for (const file of jsFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  addStringLiterals(file, source);
}

let count = 0;
for (const [file, values] of unresolved) {
  count += values.size;
  console.log(`\n${file} (${values.size})`);
  for (const value of [...values].sort((a, b) => a.localeCompare(b, 'vi'))) console.log(`  ${value}`);
}
console.log(`\nUntranslated static customer UI strings: ${count}`);
process.exitCode = count ? 1 : 0;
