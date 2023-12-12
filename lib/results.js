'use strict'

const { copyObjectByKeys, traverseResult, isObject } = require('./utils')

function selectResult (query, partialResult, response) {
  let result = response[query.resolverName]
  let mergedPartial = partialResult
  let mergedPartialParentNode = null

  const path = query.parentKey?.linked
    ? query.path.slice(0, -1)
    : query.path

  for (let i = 0; i < path.length; ++i) {
    const p = path[i]
    mergedPartialParentNode = mergedPartial
    mergedPartialParentNode[p] ??= null

    if (!mergedPartial && !mergedPartial[p]) { break }

    mergedPartial = traverseResult(mergedPartial, p)
  }

  if (!query.root) {
    if (Array.isArray(mergedPartial) && !Array.isArray(result)) {
      result = [result]
    } else if (!Array.isArray(mergedPartial) && Array.isArray(result) && result.length === 1) {
      result = result[0]
    }
  }

  if (Array.isArray(result)) {
    result = result.filter(r => !!r)
  }

  return { result, mergedPartial, mergedPartialParentNode }
}

function mergeResults (query, partialResult, response) {
  const path = query.path
  let { result, mergedPartial, mergedPartialParentNode } = selectResult(query, partialResult, response)

  if (mergedPartial === null) {
    mergedPartialParentNode[path.at(-1)] = result
    mergedPartial = result
  } else if (Array.isArray(result) && result.length > 0) {
    if (query.parentKey?.linking) {
      mergeManyLinkingResults(query, result, mergedPartial)
      return
    } else if (query.parentKey?.linked) {
      mergeManyLinkedResults(query, result, mergedPartial)
      return
    }
    // TODO cover other cases to avoid the following loop with many switches

    const key = query.key
    const parentKey = query.parentKey.field
    const as = query.parentKey.as
    const many = query.parentKey.many

    const { list, resultIndex } = index(result, key, many)

    for (let i = 0; i < mergedPartial.length; i++) {
      const merging = mergedPartial[i]
      if (!merging) { continue }

      // no need to be recursive
      if (Array.isArray(merging)) {
        if (list || many) {
          for (let j = 0; j < merging.length; j++) {
            copyResults(result, resultIndex, merging[j], parentKey, as)
          }
        } else {
          for (let j = 0; j < merging.length; j++) {
            copyResult(result, resultIndex, merging[j], parentKey, as)
          }
        }
        continue
      }

      if (list || many) {
        copyResults(result, resultIndex, merging, parentKey, as)
      } else {
        copyResult(result, resultIndex, merging, parentKey, as)
      }
    }
  } else if (isObject(result)) {
    copyObjectByKeys(mergedPartial, result)
  } else {
    // no result
    mergedPartialParentNode[query.path.at(-1)] = result
  }
}

/**
 * index result by key
 */
function index (result, key, many) {
  // TODO get list from node result type?
  const list = Array.isArray(result[0][key])
  const resultIndex = new Map()
  // TODO refactor as a matrix for every case
  if (list) {
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result[i][key].length; j++) {
        const s = resultIndex.get(result[i][key][j])
        if (s) {
          resultIndex.set(result[i][key][j], s.concat(i))
          continue
        }
        resultIndex.set(result[i][key][j], [i])
      }
    }
  } else if (many) {
    for (let i = 0; i < result.length; i++) {
      const s = resultIndex.get(result[i][key])
      if (s) {
        resultIndex.set(result[i][key], s.concat(i))
        continue
      }
      resultIndex.set(result[i][key], [i])
    }
  } else {
    for (let i = 0; i < result.length; i++) {
      resultIndex.set(result[i][key], i)
    }
  }
  return { list, resultIndex }
}

/**
 * merge many to many relation
 */
function mergeManyLinkingResults (query, result, mergedPartial) {
  const key = query.key
  const parentKey = query.parentKey.field
  const as = query.parentKey.as
  const many = query.parentKey.many // true
  const { resultIndex } = index(result, parentKey, many)

  for (let i = 0; i < mergedPartial.length; i++) {
    const merging = mergedPartial[i]
    if (!merging) { continue }

    // no need to be recursive
    if (Array.isArray(merging)) {
      for (let j = 0; j < merging.length; j++) {
        copyResults(result, resultIndex, merging[j], key, as)
      }
      continue
    }
    copyResults(result, resultIndex, merging, key, as)
  }
}

function mergeManyLinkedResults (query, result, mergedPartial) {
  const key = query.key
  const parentKey = query.parentKey.field
  const as = query.parentKey.as
  const many = query.parentKey.many // false
  const { list, resultIndex } = index(result, key, many)

  for (let i = 0; i < mergedPartial.length; i++) {
    const merging = mergedPartial[i][as]
    if (!merging) { continue }

    // no need to be recursive
    if (Array.isArray(merging)) {
      if (list) {
        for (let j = 0; j < merging.length; j++) {
          copyResults(result, resultIndex, merging[j], parentKey, as)
        }
      } else {
        for (let j = 0; j < merging.length; j++) {
          copyResult(result, resultIndex, merging[j], parentKey)
        }
      }
      continue
    }

    if (list || many) {
      copyResults(result, resultIndex, merging, parentKey, as)
    } else {
      copyResult(result, resultIndex, merging, parentKey, as)
    }
  }
}

function copyResult (result, resultIndex, to, key, as) {
  if (Array.isArray(to)) {
    for (const line of to) {
      copyResult(result, resultIndex, line, key, as)
    }
    return
  }

  const index = resultIndex.get(to[key])
  if (index === undefined) {
    // TODO if not nullable set it to an empty object
    return
  }
  if (as) {
    if (!to[as]) {
      to[as] = {}
    }
    to = to[as]
  }

  // TODO copy object fn?
  const fields = Object.keys(result[index])
  for (let i = 0; i < fields.length; i++) {
    to[fields[i]] = result[index][fields[i]]
  }
}

function copyResults (result, resultIndex, to, key, as) {
  let indexes

  if (Array.isArray(to)) {
    for (const line of to) {
      copyResults(result, resultIndex, line, key, as)
    }
    return
  }

  // TODO refactor?
  if (Array.isArray(to[key])) {
    indexes = to[key].map(k => resultIndex.get(k)).flat()
  } else {
    indexes = resultIndex.get(to[key])
  }

  if (indexes === undefined) {
    // TODO get if nullable from node result type
    if (as && !to[as]) {
      to[as] = []
    }

    return
  }
  if (as) {
    if (!to[as]) {
      to[as] = []
    }
    to = to[as]
  }

  for (let i = 0; i < indexes.length; i++) {
    const r = {}
    copyObjectByKeys(r, result[indexes[i]])
    to.push(r)
  }
}

module.exports = {
  mergeResults
}
