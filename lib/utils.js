'use strict'

function createDefaultArgsAdapter (entityName, pkey) {
  return function argsAdapter (partialResults) {
    return { [pkey + 's']: partialResults.map(r => r[pkey]) }
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

/**
 * get pkey from fkeys of entities in the subgraph
 * TODO update to support composite pkey
 */
function transitivePKey (type, subgraphEntities) {
  for (const entity of Object.values(subgraphEntities)) {
    for (const fkey of entity?.fkeys) {
      if (fkey.type === type) {
        return fkey.pkey
      }
    }
  }
}

function traverseResult (result, path) {
  if (Array.isArray(result)) {
    result = result.map(r => {
      const n = traverseResult(r, path)
      return n
    })
    return result
  }
  return result[path] ?? null
}

function schemaTypeName (types, entityName, field) {
  const t = types.get(entityName).fieldMap.get(field).schemaNode.type
  const notNull = t.kind === 'NON_NULL' ? '!' : ''
  return (t.name || t.ofType.name) + notNull
}

function nodeTypeName (node) {
  return node.schemaNode.type.name || node.schemaNode.type.ofType.name || node.schemaNode.type.ofType.ofType.name
}

module.exports = { createDefaultArgsAdapter, isObject, keySelection, transitivePKey, traverseResult, toQueryArgs, schemaTypeName, nodeTypeName }
