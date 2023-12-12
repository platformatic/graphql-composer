'use strict'

const pino = require('pino')

function dummyLogger () {
  return pino({ level: 'silent' })
}

function createDefaultArgsAdapter (entityName, pkey) {
  return function argsAdapter (partialResults) {
    return { [pkey + 's']: partialResults.map(r => r[pkey]) }
  }
}

function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

function copyObjectByKeys (to, src) {
  const keys = Object.keys(src)
  for (let i = 0; i < keys.length; i++) {
    to[keys[i]] = src[keys[i]]
  }
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

/**
 * add to "set" the key portion of path, if any
 * @param {string?} path
 * @param {Set} set
 */
function keySelection (path, set) {
  if (!path) { return }
  if (path.indexOf('.') === -1) { set.add(path) }

  const key = path.split('.').pop()
  if (!key) { return }
  set.add(key)
}

/**
 * Get pkey from fkeys of entities in the subgraph
 * it happens when the entity doesn't have a field to identify the fk,
 * but the key is nested in a type.
 * Example:
 *
 * type Book { id: ID, title: String, author: Writer }
 * type Writer { id: ID, name: String }
 *
 * fkeys: [{ pkey: 'author.id', type: 'Writer' }]
 */
function transitivePKey (typeName, subgraphEntities) {
  for (const entity of Object.values(subgraphEntities)) {
    for (const fkey of entity?.fkeys) {
      if (fkey.type === typeName) {
        return fkey.pkey
      }
    }
  }
}

/**
 * Get fkeys to resolve mamy-2-many relations with a linking entity,
 * Example:
 *
 * type Food { id: ID, name: String }
 * type Restaurants { id: ID, name: String }
 * type RestaurantsFoods { foodId: ID, restaurantId: ID }
 *
 * to have
 * extend type Restaurants { foods: [Food] }
 *
 * entities: { Restaurant: {
 *   ...
 *   many: [{
 *     type: 'Food', as: 'foods', pkey: 'id',
 *     link: {
 *       entity: 'RestaurantsFoods',
 *       pkey: 'foodId',
 *       fkey: 'restaurantId',
 *       resolver: { name: 'restaurantsFoods' }
 *     }
 *   }]
 * } }
 * and viceversa for Food.restaurants
 *
 * TODO memoize
 */
function linkingEntities (typeName, subgraphEntities) {
  let many = []

  // TODO optimize this loop
  for (const entity of Object.values(subgraphEntities)) {
    many = many.concat(entity?.many.filter(many => many.type === typeName && many.link))
  }

  return many.length > 0 ? many : undefined
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

module.exports = {
  dummyLogger,
  createDefaultArgsAdapter,
  isObject,
  copyObjectByKeys,
  keySelection,
  transitivePKey,
  linkingEntities,
  traverseResult,
  toQueryArgs,
  schemaTypeName,
  nodeTypeName
}
