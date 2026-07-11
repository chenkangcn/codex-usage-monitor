import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPlist } from '../src/launchd.js';

test('plist escapes paths and uses a quiet fixed-argument invocation', () => {
  const plist = renderPlist({
    nodePath: '/tmp/node&tool',
    dataDir: '/tmp/data<dir>',
    checkIntervalSeconds: 180,
  }, '/tmp/project');
  assert.match(plist, /\/tmp\/node&amp;tool/);
  assert.match(plist, /\/tmp\/data&lt;dir&gt;\/monitor.log/);
  assert.match(plist, /<string>run-once<\/string>\s+<string>--quiet<\/string>/);
  assert.match(plist, /<integer>180<\/integer>/);
});
