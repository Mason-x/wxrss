#!/usr/bin/env node

const major = Number(process.versions.node.split('.')[0] || 0);
const min = 22;
const maxExclusive = 24;

if (Number.isNaN(major) || major < min || major >= maxExclusive) {
  console.error(
    [
      `Unsupported Node.js version: ${process.version}`,
      `This project requires Node.js >=${min} and <${maxExclusive}.`,
      'Use Node.js 22.x LTS, then reinstall dependencies.',
    ].join('\n')
  );
  process.exit(1);
}

