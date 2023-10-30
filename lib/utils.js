'use strict'

function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

// TODO unit test
function toQueryArguments (v, root = true) {
  if (v === undefined) { return '' }

  if (Array.isArray(v)) {
    return `[${v.map(v => toQueryArguments(v, false)).join(', ')}]`
  }

  if (typeof v === 'object') {
    const o = Object.keys(v).map(k => `${k}: ${toQueryArguments(v[k], false)}`)
    return root ? o : `{ ${o} }`
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

module.exports = { isObject, keySelection, transitiveKeys, toQueryArguments }
