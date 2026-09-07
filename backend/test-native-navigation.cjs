'use strict';
// DOM state simulation over the actual embedded mobile/desktop markup.
// This is not a browser rendering or a visual approval test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const index = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'frontend/zuvyr-suite-v1.js'), 'utf8');

function fixture(markup) {
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toLowerCase(); this.children = []; this.attrs = {};
      this.parentElement = null; this.hidden = false; this.style = {};
      this._text = ''; this.listeners = [];
      this.dataset = new Proxy({}, {
        get: (_target, key) => this.attrs['data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())],
        set: (_target, key, value) => { this.attrs['data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = String(value); return true; }
      });
      this.classList = {
        contains: key => this.className.split(/\s+/).includes(key),
        add: (...keys) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...keys])].join(' '); },
        remove: (...keys) => { this.className = this.className.split(/\s+/).filter(k => !keys.includes(k)).join(' '); },
        toggle: (key, value) => { const enabled = value === undefined ? !this.classList.contains(key) : value; this.classList[enabled ? 'add' : 'remove'](key); return enabled; }
      };
    }
    get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
    get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
    get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n === document; }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
    set textContent(v) { this._text = String(v); this.children.forEach(n => { n.parentElement = null; }); this.children = []; }
    set innerHTML(html) { this.textContent = ''; parse(html, this); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(n) { if (n.parentElement) n.parentElement.children = n.parentElement.children.filter(c => c !== n); n.parentElement = this; this.children.push(n); return n; }
    insertAdjacentElement(where, n) { assert.equal(where, 'afterend'); const p = this.parentElement; n.parentElement = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentElement; } return false; }
    querySelectorAll(selector) {
      const result = [];
      function walk(n) { for (const child of n.children) { if (matches(child, selector)) result.push(child); walk(child); } }
      walk(this); return result;
    }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { let n = this; while (n) { if (matches(n, s)) return n; n = n.parentElement; } return null; }
    addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture }); }
    focus() { document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
  }
  function atom(n, selector) {
    let rest = selector;
    const tag = rest.match(/^[\w-]+/);
    if (tag) { if (n.tagName !== tag[0]) return false; rest = rest.slice(tag[0].length); }
    while (rest) {
      let m;
      if ((m = rest.match(/^\.([\w-]+)/))) { if (!n.classList.contains(m[1])) return false; }
      else if ((m = rest.match(/^#([\w-]+)/))) { if (n.id !== m[1]) return false; }
      else if ((m = rest.match(/^\[([\w-]+)(?:="([^"]*)")?\]/))) {
        if (!(m[1] in n.attrs) || (m[2] !== undefined && n.attrs[m[1]] !== m[2])) return false;
      } else { throw Error('Unsupported fixture selector: ' + rest); }
      rest = rest.slice(m[0].length);
    }
    return true;
  }
  function matches(n, selector) {
    return selector.split(',').some(group => {
      const parts = group.trim().split(/\s+/);
      if (!atom(n, parts.pop())) return false;
      let parent = n.parentElement;
      while (parts.length) { const s = parts.pop(); while (parent && !atom(parent, s)) parent = parent.parentElement; if (!parent) return false; parent = parent.parentElement; }
      return true;
    });
  }
  function parse(html, parent) {
    const stack = [parent];
    const tokens = html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
    const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    for (const token of tokens) {
      if (/^<!/.test(token)) continue;
      if (/^<\//.test(token)) { const name = token.slice(2).match(/^[\w-]+/)?.[0]?.toLowerCase(); for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === name) { stack.length = i; break; } continue; }
      if (token[0] !== '<') { stack[stack.length - 1]._text += token; continue; }
      const tag = token.match(/^<([\w-]+)/); if (!tag) continue;
      const el = new Element(tag[1]);
      const attrs = token.slice(tag[0].length, -1);
      const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let match; while ((match = re.exec(attrs))) el.setAttribute(match[1], match[2] ?? match[3] ?? match[4] ?? '');
      stack[stack.length - 1].appendChild(el);
      if (!voids.has(el.tagName) && !token.endsWith('/>')) stack.push(el);
    }
  }
  document = new Element('document');
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.querySelector('#' + id);
  parse(markup, document);
  document.documentElement = document.querySelector('html');
  Object.defineProperty(document.documentElement, 'lang', { get() { return this.attrs.lang; }, set(v) { this.attrs.lang = v; } });
  document.body = document.querySelector('body');
  document.body.style.overflow = 'unchanged';
  const observers = [];
  let network = 0;
  const context = {
    document, window: {}, console, setTimeout, clearTimeout,
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    fetch() { network++; throw Error('Navigation must not perform network or provider calls'); }
  };
  context.window.authFetch = context.fetch;
  function event(type, target, properties = {}) {
    const e = { target, prevented: false, preventDefault() { this.prevented = true; }, ...properties };
    for (const listener of document.listeners.filter(l => l.type === type && l.capture)) listener.fn(e);
    for (let n = target; n && n !== document; n = n.parentElement) for (const l of n.listeners.filter(l => l.type === type)) l.fn(e);
    for (const listener of document.listeners.filter(l => l.type === type && !l.capture)) listener.fn(e);
    return e;
  }
  return { document, context, observers, event, network: () => network };
}

for (const device of ['mobile', 'desktop']) {
  const marker = `<script type="text/plain" id="rox-src-${device}">`;
  const start = index.indexOf(marker); assert(start >= 0);
  let embedded = index.slice(start + marker.length, index.indexOf('</script>', start + marker.length));
  embedded = embedded.replace(/<\\\/script/gi, '</script');
  const markup = embedded.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const f = fixture(markup);
  const d = f.document;
  const home = d.getElementById('screen-home');
  const chat = d.getElementById('feature-chat');
  const payment = d.getElementById('topupPayBtn');
  const features = ['images','videos','code','roxip','chat'].map(id => d.getElementById('feature-' + id));
  const idsBefore = d.querySelectorAll('[id]').map(el => el.id);
  assert(home && chat && payment);
  vm.runInNewContext(source, f.context, { timeout: 5000 });
  const native = d.getElementById('screen-zuvyr-tools');
  assert(native); assert.equal(native.parentElement, home.parentElement);
  assert(native.hidden); assert(home.classList.contains('active'));
  assert.equal(d.querySelectorAll('.zuvyr-suite-launcher').length, 0);
  assert.equal(d.querySelectorAll('.zs-sidebar').length, 0);
  assert.equal(d.querySelectorAll('[data-zs-plan-form]').length, 0);
  assert.equal(d.querySelectorAll('[data-zs-ip-form]').length, 0);
  assert.equal(d.querySelectorAll('.zuvyr-native-tool').length, 11);
  assert.equal(d.querySelectorAll('.zuvyr-native-link').length, 11);
  assert.equal(d.getElementById('topupPayBtn'), payment);
  assert.equal(d.getElementById('feature-chat'), chat);
  for (const feature of features) assert(feature.isConnected);
  for (const id of idsBefore) assert(d.getElementById(id), 'Original ID lost: ' + id);

  const launch = d.querySelector('[data-zuvyr-section="voice"]');
  f.event('click', launch.children[0]); // Nested icon target.
  assert(!native.hidden); assert(!home.classList.contains('active'));
  assert.equal(native.getAttribute('aria-hidden'), 'false');
  assert.equal(native.querySelector('[data-zs-view="voice"]').dataset.active, 'true');
  assert.equal(d.activeElement, native.querySelector('[data-zs-view="voice"] h1'));
  f.event('click', d.querySelector('[data-zuvyr-section="library"]'));
  assert.equal(native.querySelector('[data-zs-view="library"]').dataset.active, 'true');
  assert.equal(native.querySelector('[data-zs-view="voice"]').dataset.active, 'false');
  f.event('click', native.querySelector('[data-zs-close]'));
  assert(native.hidden); assert(home.classList.contains('active'));
  assert.equal(d.body.style.overflow, 'unchanged');

  let originalChatClicks = 0;
  const chatTrigger = d.querySelector('[data-open="chat"]');
  chatTrigger.addEventListener('click', () => { originalChatClicks++; chat.classList.add('active'); });
  f.event('click', launch);
  const e = f.event('click', chatTrigger);
  assert.equal(originalChatClicks, 1); assert.equal(e.prevented, false);
  assert(native.hidden); assert(home.classList.contains('active')); assert(chat.classList.contains('active'));
  chat.classList.remove('active');

  f.event('click', launch);
  f.event('keydown', native, { key: 'Escape' });
  assert(native.hidden); assert(home.classList.contains('active'));

  d.documentElement.lang = 'ar'; f.observers.forEach(fn => fn());
  assert.equal(native.dir, 'rtl');
  assert.equal(launch.querySelector('[data-zuvyr-section-label]').textContent, 'الصوت');
  assert.equal(native.querySelector('[data-zs-close]').textContent, 'الرجوع');
  assert.equal(native.querySelector('.zs-status').classList.contains('ready'), false);
  d.documentElement.lang = 'fr'; f.observers.forEach(fn => fn());
  assert.equal(native.dir, 'ltr');
  assert.equal(native.querySelector('[data-zs-close]').textContent, 'Retour');
  const count = d.querySelectorAll('[data-zuvyr-section]').length;
  vm.runInNewContext(source, f.context, { timeout: 5000 });
  assert.equal(d.querySelectorAll('[data-zuvyr-section]').length, count, 'Duplicate initialization');
  assert.equal(f.network(), 0);
  console.log(`PASS: ${device} native navigation, original DOM preservation, return/Escape, language, no duplicate shell and zero network calls`);
}

console.log('DOM state simulation only. Published desktop/mobile visual checks remain required.');
