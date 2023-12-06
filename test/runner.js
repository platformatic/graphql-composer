'use strict'

const { tap, spec } = require('node:test/reporters')
const { run } = require('node:test')
const glob = require('glob').globSync

/* eslint-disable new-cap */
const reporter = process.stdout.isTTY ? new spec() : tap

const files = glob('test/**/*.test.js')

const stream = run({
  files,
  timeout: 30_000,
  concurrency: files.length
})

stream.on('test:fail', () => {
  process.exitCode = 1
})

stream.compose(reporter).pipe(process.stdout)
