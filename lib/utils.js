'use strict'

const pino = require('pino')

function defaultOnError (error) { throw error }

function dummyLogger () {
  return pino({ level: 'silent' })
}

function createDefaultArgsAdapter (pkey) {
  return function argsAdapter (partialResults) {
    return { [pkey + 's']: partialResults.map(r => r[pkey]) }
  }
}

function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

// deep clone with support for function type
function objectDeepClone (object) {
  if (object === null || object === undefined) {
    return object
  }

  if (Array.isArray(object)) {
    const clone = []
    for (let i = 0; i < object.length; i++) {
      clone[i] = objectDeepClone(object[i])
    }
    return clone
  }

  if (typeof object === 'object') {
    const clone = {}
    const keys = Object.keys(object)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      clone[key] = objectDeepClone(object[key])
    }
    return clone
  }

  // TODO clone Map and Set too?
  return object
}

// copy values from src to to, recursively without overriding
function copyObjectByKeys (to, src) {
  const keys = Object.keys(src)
  for (let i = 0; i < keys.length; i++) {
    if (typeof to[keys[i]] === 'object') {
      copyObjectByKeys(to[keys[i]], src[keys[i]])
    } else {
      to[keys[i]] ??= src[keys[i]]
    }
  }
}

function mergeMaps (m1, m2) {
  for (const [k, v] of m2) {
    m1.set(k, v)
  }
}

function pathJoin (...args) {
  let p = ''
  for (let i = 0; i < args.length; i++) {
    if (i > 0 && args[i] && p) {
      p += '.' + args[i]
    } else if (args[i]) {
      p = args[i]
    }
  }
  return p
}

// -- gql utilities

function unwrapFieldTypeName (field) {
  return field.type.name || field.type.ofType.name || field.type.ofType.ofType.name
}

function collectArgs (nodeArguments, info) {
  if (!nodeArguments || nodeArguments.length < 1) {
    return {}
  }
  const args = {}
  for (let i = 0; i < nodeArguments.length; i++) {
    const a = nodeArguments[i]
    const name = a.name.value
    if (a.value.kind !== 'Variable') {
      args[name] = a.value.value
      continue
    }
    const varName = a.value.name.value
    const varValue = info.variableValues[varName]
    if (typeof varValue === 'object') {
      // TODO check this
      const object = {}
      const keys = Object.keys(varValue)
      for (let j = 0; j < keys.length; j++) {
        object[keys[j]] = varValue[keys[j]]
      }
      args[name] = object
      continue
    }
    args[name] = varValue
  }
  return args
}

function schemaTypeName (types, subgraphName, entityName, fieldName) {
  const t = types[entityName][subgraphName].fields.get(fieldName).src.type
  const notNull = t.kind === 'NON_NULL' ? '!' : ''
  return (t.name || t.ofType.name) + notNull
}

module.exports = {
  defaultOnError,
  dummyLogger,
  createDefaultArgsAdapter,
  isObject,
  objectDeepClone,
  copyObjectByKeys,
  mergeMaps,
  pathJoin,

  collectArgs,
  unwrapFieldTypeName,
  schemaTypeName
}
