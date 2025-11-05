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

  await t.test('converts non-array objects to arrays for consistent processing', () => {
    const nonArrayResult = { id: 1, name: 'test' }
    const output = toArgsAdapterInput(nonArrayResult)

    assert.deepStrictEqual(output, [{ id: 1, name: 'test' }])
  })

  await t.test('processes non-array objects through path traversal like arrays', () => {
    // Ensures non-array objects go through the same path logic as arrays
    // instead of returning early and skipping path processing

    const arrayInput = [
      {
        account: {
          organizations: [{ id: 'ff82a360-5cf5-4a06-8dbf-1e55b02f9224' }]
        }
      }
    ]

    const singleObjectInput = {
      account: {
        organizations: [{ id: 'ff82a360-5cf5-4a06-8dbf-1e55b02f9224' }]
      }
    }

    const path = ['account', 'organizations', 'id']

    const output1 = toArgsAdapterInput(arrayInput, path)
    const output2 = toArgsAdapterInput(singleObjectInput, path)

    // Both inputs should produce identical results after path traversal
    assert.ok(Array.isArray(output1))
    assert.ok(Array.isArray(output2))
    assert.strictEqual(output1.length, 1)
    assert.strictEqual(output2.length, 1)

    // Path traversal processes path.length - 1 elements, so ['account', 'organizations', 'id']
    // traverses to 'account' -> 'organizations', returning the organizations array
    assert.strictEqual(output1[0].id, 'ff82a360-5cf5-4a06-8dbf-1e55b02f9224')
    assert.strictEqual(output2[0].id, 'ff82a360-5cf5-4a06-8dbf-1e55b02f9224')
  })
})
