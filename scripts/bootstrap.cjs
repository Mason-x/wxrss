/**
 * Bootstrap script that sets NODE_OPTIONS for worker thread memory limits
 * before spawning the actual Nuxt dev/start command.
 *
 * Worker threads created by Nitro/Vite inherit NODE_OPTIONS from the parent
 * process environment, but NOT the --max-old-space-size flag passed on the
 * command line. This script ensures all workers get adequate heap space.
 */

const { spawn } = require('child_process');

// Set NODE_OPTIONS to propagate memory limit to worker threads
const existingNodeOptions = process.env.NODE_OPTIONS || '';
if (!existingNodeOptions.includes('--max-old-space-size')) {
  process.env.NODE_OPTIONS = `--max-old-space-size=8192 ${existingNodeOptions}`.trim();
}

// Get the command to run from command line args
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/bootstrap.cjs <command>');
  process.exit(1);
}

// Parse the command: first arg may be a quoted string with the full command
const command = args.join(' ');
const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
const parsed = parts.map(p => p.replace(/^"|"$/g, ''));

const bin = parsed[0];
const binArgs = parsed.slice(1);

console.log(`[bootstrap] NODE_OPTIONS="${process.env.NODE_OPTIONS}"`);
console.log(`[bootstrap] Running: ${bin} ${binArgs.join(' ')}`);

const child = spawn(bin, binArgs, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('close', (code) => {
  process.exit(code || 0);
});

// Forward termination signals
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    child.kill(signal);
  });
});
