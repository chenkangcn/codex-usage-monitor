#!/opt/homebrew/opt/node@22/bin/node

import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((error) => {
  console.error(`codex-usage-monitor: ${error.message}`);
  process.exitCode = 1;
});
