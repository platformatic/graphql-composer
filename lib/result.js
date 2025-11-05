'use strict'

const { copyObjectByKeys } = require('./utils')

function traverseResult (result, path) {
  if (Array.isArray(result)) {
    const r = []
    for (let i = 0; i < result.length; i++) {
      const p = traverseResult(result[i], path)

      if (p === undefined) return
      r[i] = p
    }
    return r
  }

  return result[path]
}

// important: working with references only, do not copy data
function mergeResult (mainResult, fullPath, queryNode, parentResult) {
  const path = fullPath.split('.')
  const mergingResult = queryNode.result

  if (path.length === 1 && mainResult[fullPath] === undefined) {
    // root
    mainResult[fullPath] = mergingResult
    return
  }

  const parentPath = parentResult.path ?? []
  const containerPath = parentPath.length > 0
    ? parentPath.slice(0, -1)
    : path.slice(0, -1)

  const fillPath = path.slice(containerPath.length)
  let r = resolveResultPath(mainResult, containerPath)

  while (!r && containerPath.length) {
    fillPath.unshift(containerPath.pop())
    r = resolveResultPath(mainResult, containerPath)
  }

  r ??= mainResult

  const many = parentResult.as && parentResult.many
  let key, parentKey, index
  if (many) {
    key = parentResult.many.fkey
    parentKey = parentResult.many.pkey
    index = resultIndex(mergingResult, key, true)
  } else {
    key = parentResult.keys.self
    parentKey = parentResult.keys.parent
    index = resultIndex(mergingResult, key)
  }

  if (Array.isArray(r)) {
    if (many) {
      for (let i = 0; i < r.length; i++) {
        copyResultRowList(r[i], mergingResult, index, parentKey, parentResult.path, fillPath)
      }
    } else {
      for (let i = 0; i < r.length; i++) {
        copyResultRow(r[i], mergingResult, index, parentKey, parentResult.path, fillPath)
      }
    }
    return
  }

  // r is an object
  if (many) {
    copyResultRowList(r, mergingResult, index, parentKey, parentResult.path, fillPath)
  } else {
    copyResultRow(r, mergingResult, index, parentKey, parentResult.path, fillPath)
  }
}

// !copyResultRow and copyResultRowList are similar but duplicated for performance reason
function copyResultRow (dst, src, srcIndex, parentKey, keyPath, fillPath) {
  let traverseDst = dst

  if (Array.isArray(traverseDst)) {
    for (let i = 0; i < traverseDst.length; i++) {
      const row = traverseDst[i]
      copyResultRow(row, src, srcIndex, parentKey, keyPath, fillPath)
    }
    return
  }

  let fillIndex = 0

  if (!traverseDst?.[parentKey]) { return }
  const rowIndexes = srcIndex.map.get(traverseDst[parentKey])
  if (rowIndexes === undefined) {
    // TODO if not nullable set "dst" to an empty object
    return {}
  }

  for (; fillIndex < fillPath.length; fillIndex++) {
    if (!traverseDst[fillPath[fillIndex]]) {
      // TODO get result type from types
      traverseDst[fillPath[fillIndex]] = {}
    }
    traverseDst = traverseDst[fillPath[fillIndex]]
  }

  for (let i = 0; i < rowIndexes.length; i++) {
    copyObjectByKeys(traverseDst, src[rowIndexes[i]])
  }
}

function copyResultRowList (dst, src, srcIndex, parentKey, keyPath, fillPath) {
  let traverseDst = dst

  if (Array.isArray(traverseDst)) {
    for (let i = 0; i < traverseDst.length; i++) {
      const row = traverseDst[i]
      copyResultRowList(row, src, srcIndex, parentKey, keyPath, fillPath)
    }
    return
  }

  let fillIndex = 0

  if (!traverseDst?.[parentKey]) { return } // TODO !undefined !null

  let rowIndexes = []
  // TODO more performant code
  // design a different struct to avoid loops
  if (Array.isArray(traverseDst[parentKey])) {
    for (let i = 0; i < traverseDst[parentKey].length; i++) {
      const indexes = srcIndex.map.get(traverseDst[parentKey][i])
      if (indexes) { rowIndexes = rowIndexes.concat(indexes) }
    }
  } else {
    const indexes = srcIndex.map.get(traverseDst[parentKey])
    if (indexes) { rowIndexes = indexes }
  }

  for (; fillIndex < fillPath.length; fillIndex++) {
    if (!traverseDst[fillPath[fillIndex]]) {
      // TODO get result type from types
      if (fillIndex === fillPath.length - 1) {
        // TODO more performant code
        traverseDst[fillPath[fillIndex]] = []
        for (let i = 0; i < rowIndexes.length; i++) {
          traverseDst[fillPath[fillIndex]].push(src[rowIndexes[i]])
        }
        return
      }
      traverseDst[fillPath[fillIndex]] = {}
    }
    traverseDst = traverseDst[fillPath[fillIndex]]
  }

  for (let i = 0; i < rowIndexes.length; i++) {
    copyObjectByKeys(traverseDst, src[rowIndexes[i]])
  }
}

function resultIndex (result, key) {
  if (!result.length) {
    return { list: false, map: new Map() }
  }

  const list = Array.isArray(result[0][key])
  const index = new Map()

  for (let i = 0; i < result.length; i++) {
    const keys = list ? result[i][key] : [result[i][key]]
    for (const k of keys) {
      const existing = index.get(k)
      index.set(k, existing ? existing.concat(i) : [i])
    }
  }

  return { list, map: index }
}

function resolveResultPath (result, segments) {
  if (!segments || segments.length === 0) {
    return result
  }

  let current = result
  for (let i = 0; i < segments.length; i++) {
    if (current === undefined || current === null) {
      return current
    }
    current = traverseResult(current, segments[i])
  }

  return current
}

module.exports = {
  traverseResult,
  mergeResult,
  copyResultRow
}
