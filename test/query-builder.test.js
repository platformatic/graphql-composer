'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const { toArgsAdapterInput } = require('../lib/query-builder')

test('toArgsAdapterInput', async (t) => {
  await t.test('returns empty array for falsy inputs', () => {
    assert.deepStrictEqual(toArgsAdapterInput(null), [])
    assert.deepStrictEqual(toArgsAdapterInput(undefined), [])
    assert.deepStrictEqual(toArgsAdapterInput(0), [])
  })

  await t.test('converts non-array to array without path', () => {
    assert.deepStrictEqual(toArgsAdapterInput({ id: 1 }), [{ id: 1 }])
    assert.deepStrictEqual(toArgsAdapterInput('test'), ['test'])
  })

  await t.test('filters falsy values and flattens arrays', () => {
    assert.deepStrictEqual(
      toArgsAdapterInput([{ id: 1 }, null, { id: 2 }]),
      [{ id: 1 }, { id: 2 }]
    )
    assert.deepStrictEqual(
      toArgsAdapterInput([[{ id: 1 }], [{ id: 2 }]]),
      [{ id: 1 }, { id: 2 }]
    )
  })

  await t.test('ensures consistent filtering for both arrays and non-arrays', () => {
    // Non-arrays should go through the same filtering logic as arrays
    const nonArrayResult = { id: 1, name: 'test' }
    const output = toArgsAdapterInput(nonArrayResult)

    assert.deepStrictEqual(output, [{ id: 1, name: 'test' }])
  })
})
