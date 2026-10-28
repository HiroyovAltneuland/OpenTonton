import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { initialLanguage, translate, translateError, formatDate, formatStamp } from '../lib/i18n.ts';
import english from '../lib/translations.json' with { type: 'json' };

test('browser language is used only when no valid explicit preference exists', () => {
  for (const code of ['ja', 'ja-JP', 'JA-jp']) assert.equal(initialLanguage(null, code), 'ja');
  for (const code of ['en-US', 'fr-FR', 'zh-CN', '', 'japanese']) assert.equal(initialLanguage(null, code), 'en');
  assert.equal(initialLanguage('en', 'ja-JP'), 'en');
  assert.equal(initialLanguage('ja', 'en-US'), 'ja');
  assert.equal(initialLanguage('invalid', 'ja-JP'), 'ja');
});

test('errors including validation limits and diagnostic codes are localized safely', () => {
  assert.equal(translateError('en', '入力内容を確認してください（最大80文字）。'), 'Check your input (maximum 80 characters).');
  assert.equal(translateError('en', '処理できませんでした。エラーコード：OT_AUTH_HASH_LIMIT'), 'Unable to complete the operation. Error code: OT_AUTH_HASH_LIMIT');
  assert.match(translateError('en', 'ニックネームまたはパスワードを確認してください。'), /nickname or password/);
  assert.equal(translateError('ja', 'イベントが見つかりません。'), 'イベントが見つかりません。');
  assert.equal(translate('en', '__proto__'), '__proto__');
  assert.match(translateError('en', '__proto__'), /^Unable to complete/);
  assert.equal(translate('en', '{0}分の全枠に〇がある参加者を集計しています。', [60]), 'Counts participants available for every slot of the 60-minute meeting.');
});

test('localized dates and expiry remain in Japan time across UTC midnight', () => {
  const at = Date.parse('2026-10-31T15:00:00Z');
  assert.equal(formatStamp(at, 'ja'), '2026/11/1 00:00');
  assert.equal(formatStamp(at, 'en'), 'Nov 1, 2026, 00:00');
  assert.match(formatDate('2026-10-31', 'en'), /Sat.*October 31/);
  assert.match(formatDate('2026-10-31', 'en', { month: 'numeric', day: 'numeric' }), /Oct 31/);
  assert.match(formatDate('2026-10-31', 'ja'), /10月31日.*土/);
});

test('all explicit UI translation keys and fixed API/auth errors have English translations', () => {
  for (const file of ['app/page.tsx', 'lib/server.ts', 'lib/edge-security.ts', 'lib/password-client.ts', 'lib/scheduling.ts']) {
    const source = ts.createSourceFile(file, readFileSync(new URL('../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && ts.isStringLiteral(node.arguments[0])) assert(Object.hasOwn(english, node.arguments[0].text), node.arguments[0].text);
      if (file.startsWith('lib/') && ts.isStringLiteral(node) && /[\u3040-\u9fff]/.test(node.text)) assert(Object.hasOwn(english, node.text), node.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
