'use strict'

const { traverseResult } = require('./result')

/**
 * A QueryNode is a node on the query-tree resolution
 * @typedef {Object} QueryNode
 * @property {String} subgraphName
 */

/**
 * @returns {QueryNode}
 */
function createQueryNode ({ subgraphName, path, field, fieldId, queryFieldNode, parent, root, query, deferred }) {
  if (deferred) {
    return { deferred }
  }

  return {
    subgraphName,
    path,
    field,
    fieldId,
    queryFieldNode,
    parent,
    root,
    query,
    result: undefined,
    keys: []
  }
}

function createQuery ({ operation = '', resolver, selection, args }) {
  return { operation, resolver, selection, args }
}

/**
 * @param {QueryNode} queryNode
 */
function createDeferredQuery ({ queryNode, resolverPath, fieldPath }) {
  return {
    subgraphName: undefined,
    queryNode,
    resolverPath,
    fieldPath,
    entity: undefined,
    keys: undefined,
    fields: []
  }
}

function addDeferredQueryField (query, fieldName, queryFieldNode) {
  query.fields.push({ fieldName, queryFieldNode })
}

/**
 * uniforms any result to an array, filters null row
 * @returns array
 */
function toArgsAdapterInput (result, path) {
  if (!result) { return [] }

  if (!Array.isArray(result)) {
    return [result]
  }

  let r = result.filter(r => !!r)

  if (!path) {
    return r.flat()
  }

  // TODO use a specific fn instead of traverseResult to speed up
  // TODO write unit tests
  let i = 0
  let start
  // path can start in the middel of result
  while (i < path.length - 1) {
    const t = traverseResult(r, path[i])
    if (t) {
      if (!start) { start = true }
      r = t
    } else {
      if (start) { break }
    }
    i++
  }

  return r.flat()
}

function buildQuery (query, parentResult) {
  const { selection, keys } = buildQuerySelection(query.selection)

  if (query.resolver?.argsAdapter) {
    // TODO try-catch, logs and so on

    // TODO filter duplicates in toArgsAdapterInput
    let r = toArgsAdapterInput(parentResult.data, parentResult.path)

    if (query.resolver.partialResults) {
      r = query.resolver.partialResults(r)
    }

    query.args = runArgsAdapter(query.resolver.argsAdapter, r, query.resolver.name)
  }

  return {
    query: `${query.operation} { ${query.resolver.name}${buildQueryArgs(query.args)} ${selection} }`,
    fieldName: query.resolver.name,
    keys
  }
}

// get keys to reuse on merge results
function buildQuerySelection (selection, parent, wrap = true, fragment = undefined) {
  if (!(selection && selection.length > 0)) {
    return { selection: '', keys: [] }
  }

  const fields = new Set()
  const keys = new Map()
  for (let i = 0; i < selection.length; i++) {
    if (selection[i].field) {
      fields.add(selection[i].field)
    } else if (selection[i].key) {
      // these keys are from selection[i].deferreds
      const k = selection[i].key
      const keyField = k.pkey || k.fkey || k.many

      if (!keyField) { continue }
      fields.add(toQuerySelection(keyField))
      keys.set('key' + keyId(k), k)
    } else if (selection[i].selection) {
      fields.add(buildQuerySelection(selection[i].selection, null, selection[i].wrap, selection[i].fragment).selection)
    } else if (selection[i].nested) {
      for (const nested of selection[i].nested.values()) {
        const s = buildSubQuery(nested.query, nested)
        fields.add(`${selection[i].parentField} ${s.subquery}`)
        for (const i of Object.keys(s.keys)) {
          const k = s.keys[i]
          keys.set(k.resolverPath + keyId(k), k)
        }
      }
    } else if (selection[i].deferreds) {
      // add parent keys for deferred queries, needed to merge results
      for (const deferred of selection[i].deferreds.values()) {
        // src parent type
        // from nested: parent type
        const parentTypeName = selection[i].typeName
        const dkeys = deferredKeys(deferred.keys, parentTypeName, selection[i].parentFieldName)
        for (const dk of dkeys) {
          fields.add(dk)
        }
        for (const i of Object.keys(deferred.keys)) {
          const k = deferred.keys[i]
          const p = deferred.resolverPath + keyId(k)
          if (keys.has(p)) { continue }

          // TODO better code, these keys will be used in composer/mergeResults/parentKey
          if (k.parent) {
            keys.set(p, {
              fkey: k.parent.fkey,
              many: k.parent.many,
              typeName: k.entity,
              parent: k.parent,

              resolverPath: deferred.resolverPath,
              fieldPath: deferred.fieldPath
            })
          } else {
            keys.set(p, {
              ...k,

              resolverPath: deferred.resolverPath,
              fieldPath: deferred.fieldPath
            })
          }
        }
      }
    }
  }

  const qselection = wrap ? `${fragment ? `... on ${fragment} ` : ''}{ ${Array.from(fields).join(' ')} }` : Array.from(fields).join(' ')
  return { selection: qselection, keys: Array.from(keys.values()) }
}

function buildSubQuery (query, parent) {
  const s = buildQuerySelection(query.selection, parent)
  return {
    subquery: `${buildQueryArgs(query.args)} ${s.selection}`,
    keys: s.keys
  }
}

function keyId (k) {
  if (k.pkey) { return `#pkey.${k.pkey}` }
  if (k.parent) {
    if (k.parent.fkey) { return `#p.fkey.${k.parent.fkey.field}` }
    if (k.parent.many) { return `#p.many.${k.parent.many.fkey}` }
  }

  if (k.fkey) { return `#fkey.${k.fkey}` }
  if (k.many) { return `#many.${k.many}` }
}

// TODO unit test
function deferredKeys (keys, typeName, fieldName) {
  return keys.map(k => {
    if (k.parent) {
      if (k.parent.fkey) {
        if ((k.parent.fkey.as && typeName === k.parent.typeName)) {
          return toQuerySelection(k.parent.fkey.field)
        } else if (!k.parent.entity && typeName === k.parent.typeName) {
          return toQuerySelection(k.parent.fkey.field || k.parent.fkey.pkey)
        }
      }

      return ''
    }

    if (k.pkey) {
      return toQuerySelection(k.pkey)
    }

    return ''
  })
}

// to avoid data transformation, both cases are covered in different functions
// args can be either from client query, which are from gql nodes structure
// or can be built by composer subquery
// TODO filter same values
function buildQueryArgs (args, root = true) {
  if (args === undefined || args === null) { return '' }

  // args from client query
  if (args.node) {
    return buildNodeQueryArgs(args, root)
  }
  // composer built args
  return buildPlainQueryArgs(args, root)
}

function buildNodeQueryArgs (args, root = true) {
  if (args === undefined || args === null) { return '' }

  if (args.type === 'ListValue') {
    const queryArgs = []
    for (let i = 0; i < args.value.length; i++) {
      const arg = buildNodeQueryArgs(args.value[i], false)
      if (arg === '') { continue }
      queryArgs.push(arg)
    }
    return `[${queryArgs.join(', ')}]`
  }

  if (args.type === 'ObjectValue') {
    const keys = Object.keys(args.value)
    const queryArgs = []
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const value = buildNodeQueryArgs(args.value[key], false)
      if (value === '') { continue }
      queryArgs.push(`${key}: ${value}`)
    }

    if (root) {
      return queryArgs?.length > 0 ? `(${queryArgs.join(',')})` : ''
    }

    return `{ ${queryArgs.join(', ')} }`
  }

  // TODO test: quotes
  if (args.value === null) {
    return null
  }
  return args.type !== 'StringValue' ? args.value?.toString() : JSON.stringify(args.value)
}

function buildPlainQueryArgs (v, root = true) {
  if (v === undefined || v === null) { return '' }

  if (Array.isArray(v)) {
    const args = []
    for (let i = 0; i < v.length; i++) {
      const arg = buildQueryArgs(v[i], false)
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
      const value = buildQueryArgs(v[key], false)
      if (value === '') { continue }
      args.push(`${key}: ${value}`)
    }

    if (root) {
      return args?.length > 0 ? `(${args.join(',')})` : ''
    }
    return `{ ${args.join(', ')} }`
  }

  // TODO test: quotes
  return typeof v === 'string' ? JSON.stringify(v) : v.toString()
}

// TODO faster code
function toQuerySelection (key) {
  return key.split('.').reduce((q, f, i) => {
    return q + (i > 0 ? `{${f}}` : f)
  }, '')
}

// get parent by result
// parent also has result keys
function queryParentResult (query) {
  if (query.root) { return }

  let parent = query.parent
  while (parent) {
    if (parent.root || parent.result) { return parent }
    parent = parent.parent
  }

  return undefined
}

function runArgsAdapter (argsAdapter, results, resolverName) {
  let args
  try {
    args = argsAdapter(results)
  } catch (err) {
    const msg = `Error running argsAdapter for ${resolverName}`
    throw new Error(msg, { cause: err })
  }

  if (args === null || typeof args !== 'object') {
    throw new TypeError(`argsAdapter did not return an object. returned ${args}.`)
  }

  return args
}

module.exports = {
  createQueryNode,
  createQuery,
  createDeferredQuery,
  addDeferredQueryField,

  queryParentResult,

  buildQuery
}
