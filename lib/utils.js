'use strict'

function createDefaultArgsAdapter (entityName, keys) {
  const key = keys[0].field
  return function argsAdapter (partialResults) {
    return { [key + 's']: partialResults.map(r => r[key]) }
  }
}

function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

function arrayPushUnique (array, value) {
  if (!array.includes(value)) {
    array.push(value)
  }
}

// TODO filter same values
function toQueryArgs (v, root = true) {
  if (v === undefined) { return '' }

  if (Array.isArray(v)) {
    return `[${v.map(v => toQueryArgs(v, false)).filter(a => a !== '').join(', ')}]`
  }

  if (typeof v === 'object') {
    const o = Object.keys(v)
      .map(k => ({ k, v: toQueryArgs(v[k], false) }))
      .filter(({ v }) => !!v)
      .map(({ k, v }) => `${k}: ${v}`)

    if (root) {
      return o ? `(${o})` : ''
    }
    return `{ ${o} }`
  }

  // TODO test: quotes
  return typeof v === 'string' ? `"${v}"` : v.toString()
}

function keySelection (path) {
  if (path.indexOf('.') === -1) { return path }

  return path.split('.').pop()
}

function transitiveKeys (type, subgraphEntities) {
  for (const entity of Object.values(subgraphEntities)) {
    const key = entity.keys.find(k => k.type === type)
    if (key) {
      return [key]
    }
  }
}

module.exports = { createDefaultArgsAdapter, isObject, arrayPushUnique, keySelection, transitiveKeys, toQueryArgs }
