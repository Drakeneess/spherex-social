import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/astrogram.css', import.meta.url), 'utf8');
const responsive = readFileSync(new URL('../src/responsive.css', import.meta.url), 'utf8');
const notifications = readFileSync(
  new URL('../src/components/NotificationsPage.tsx', import.meta.url), 'utf8'
);

test('notifications grid content hugs the top rather than filling available viewport rows', () => {
  assert.match(css, /\.notifications-page\{[^}]*align-content:start;[^}]*grid-auto-rows:max-content;/s);
  assert.match(css, /\.notifications-panel\{[^}]*align-self:start;min-height:0/s);
  assert.match(notifications, /<main className="wrap narrow notifications-page"/);
});

test('notifications page heading cannot compete with navbar search for stacking priority', () => {
  assert.match(css, /\.astrogram-shell \.navbar\{\s*position:sticky;top:0;z-index:30;/);
  assert.match(css, /\.notifications-heading\{[^}]*position:static;top:auto;z-index:auto;/s);
  assert.match(css, /\.notifications-heading\{[^}]*background:none;border:0;backdrop-filter:none;/s);
  assert.match(responsive, /\.astrogram-shell \.navbar \.global-search\.mobile-open\{/);
});

test('activity rows remain compact while retaining a usable click target on mobile', () => {
  assert.match(css, /\.notification-item\{[^}]*min-height:68px;padding:12px 16px;/s);
  assert.match(css, /@media\(max-width:600px\)\{[^}]*\.notification-item\{[^}]*min-height:64px;padding:11px 12px/s);
  assert.match(css, /\.notification-copy small\{[^}]*margin-top:3px\}/s);
  assert.match(responsive, /\.notification-item\{gap:10px;padding:12px 10px\}/);
});
