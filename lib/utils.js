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

// TODO filter same values
function toQueryArgs (v, root = true) {
  if (v === undefined || v === null) { return '' }

  if (Array.isArray(v)) {
    const args = []
    for (let i = 0; i < v.length; i++) {
      const arg = toQueryArgs(v[i], false)
      if (arg === '') { continue }
      args.push(arg)
    }
    return `[${args.join(', ')}]`
  }

  if (typeof v === 'object') {
    const keys = Object.keys(v)
    const args = []
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const value = toQueryArgs(v[key], false)
      if (value === '') { continue }
      args.push(`${key}: ${value}`)
    }

    if (root) {
      return args ? `(${args.join(',')})` : ''
    }
    return `{ ${args.join(', ')} }`
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

module.exports = { createDefaultArgsAdapter, isObject, keySelection, transitiveKeys, toQueryArgs }
