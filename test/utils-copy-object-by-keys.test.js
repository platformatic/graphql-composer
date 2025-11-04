'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { copyObjectByKeys } = require('../lib/utils')

test('copyObjectByKeys', async (t) => {
  await t.test('should copy simple properties', () => {
    const to = { id: '1' }
    const src = { id: '1', name: 'John' }

    copyObjectByKeys(to, src)

    assert.deepStrictEqual(to, { id: '1', name: 'John' })
  })

  await t.test('should not overwrite existing properties', () => {
    const to = { id: '1', name: 'John' }
    const src = { id: '1', name: 'Jane', age: 30 }

    copyObjectByKeys(to, src)

    assert.deepStrictEqual(to, { id: '1', name: 'John', age: 30 })
  })

  await t.test('should handle nested objects', () => {
    const to = { id: '1', user: { name: 'John' } }
    const src = { id: '1', user: { name: 'John', age: 30 } }

    copyObjectByKeys(to, src)

    assert.deepStrictEqual(to, { id: '1', user: { name: 'John', age: 30 } })
  })

  await t.test('should handle null values in destination without error', () => {
    const to = { id: '1', user: null }
    const src = { id: '1', user: { name: 'John', age: 30 } }

    // This should not throw an error
    assert.doesNotThrow(() => {
      copyObjectByKeys(to, src)
    })

    // null should be replaced with the object from src
    assert.deepStrictEqual(to, { id: '1', user: { name: 'John', age: 30 } })
  })

  await t.test('should handle null values in source', () => {
    const to = { id: '1', user: { name: 'John' } }
    const src = { id: '1', user: null }

    copyObjectByKeys(to, src)

    // null in src should not overwrite existing object in to
    assert.deepStrictEqual(to, { id: '1', user: { name: 'John' } })
  })

  await t.test('should handle mixed null and object scenarios', () => {
    const to = {
      id: '1',
      user: null,
      profile: { name: 'John' }
    }
    const src = {
      id: '1',
      user: { name: 'Jane' },
      profile: null
    }

    copyObjectByKeys(to, src)

    assert.deepStrictEqual(to, {
      id: '1',
      user: { name: 'Jane' },
      profile: { name: 'John' }
    })
  })

  await t.test('should handle deeply nested structures with nulls', () => {
    const to = {
      artists: [{
        id: '105',
        firstName: 'Luciano',
        songs: [{
          singer: null
        }]
      }]
    }
    const src = {
      artists: [{
        id: '105',
        songs: [{
          singer: {
            id: '105',
            songs: [{ title: 'Nessun dorma' }]
          }
        }]
      }]
    }

    copyObjectByKeys(to, src)

    // firstName should be preserved, singer should be populated
    assert.strictEqual(to.artists[0].firstName, 'Luciano')
    assert.deepStrictEqual(to.artists[0].songs[0].singer, {
      id: '105',
      songs: [{ title: 'Nessun dorma' }]
    })
  })

  await t.test('should not recurse into null in destination', () => {
    const to = { id: '1', nested: null }
    const src = { id: '1', nested: { value: 'test' } }

    // Before the fix, this would throw: "Cannot convert undefined or null to object"
    // or similar error when trying to call Object.keys on null
    assert.doesNotThrow(() => {
      copyObjectByKeys(to, src)
    })

    assert.deepStrictEqual(to, { id: '1', nested: { value: 'test' } })
  })

  await t.test('should not recurse when both source and destination are not objects', () => {
    const to = { id: '1', value: 'old' }
    const src = { id: '1', value: 'new', extra: 'data' }

    copyObjectByKeys(to, src)

    // value should not be overwritten (??= operator)
    assert.strictEqual(to.value, 'old')
    assert.strictEqual(to.extra, 'data')
  })
})
