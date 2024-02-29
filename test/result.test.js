'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const { copyResultRow } = require('../lib/result')

test('copyResultRow unit test', t => {
  const dst = [{ title: 'Every you every me', id: '1', singerId: '103' }, { title: 'The bitter end', id: '2', singerId: '103' }]
  const src = [{ firstName: 'Brian', id: '103', lastName: 'Molko' }]
  const srcIndex = { list: false, map: new Map([['103', [0]]]) }
  const parentKey = 'singerId'
  const keyPath = ['songs', 'singerId']
  const fillPath = ['singer']

  copyResultRow(dst, src, srcIndex, parentKey, keyPath, fillPath)

  assert.deepStrictEqual(dst, [{
    title: 'Every you every me',
    id: '1',
    singerId: '103',
    singer: { firstName: 'Brian', id: '103', lastName: 'Molko' }
  },
  {
    title: 'The bitter end',
    id: '2',
    singerId: '103',
    singer: { firstName: 'Brian', id: '103', lastName: 'Molko' }
  }])
})
