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

  // traverse result till bottom
  let r = mainResult[path[0]]
  let i = 1
  while (i < path.length) {
    const t = traverseResult(r, path[i])
    if (!t) { break }
    r = t
    i++
  }

  // fill the missing result path
  const fillPath = []
  for (let j = i; j < path.length; j++) {
    fillPath.push(path[j])
  }

  if (!r) {
    // copy reference
    r = mergingResult
    return
  }

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
  if (result.length < 1) {
    return { list: false, map: new Map() }
  }
  const list = Array.isArray(result[0][key])
  const index = new Map()

  if (list) {
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result[i][key].length; j++) {
        const s = index.get(result[i][key][j])
        if (s) {
          index.set(result[i][key][j], s.concat(i))
          continue
        }
        index.set(result[i][key][j], [i])
      }
    }
  } else {
    for (let i = 0; i < result.length; i++) {
      const s = index.get(result[i][key])
      if (s) {
        index.set(result[i][key], s.concat(i))
        continue
      }
      index.set(result[i][key], [i])
    }
  }

  return { list, map: index }
}

module.exports = {
  traverseResult,
  mergeResult,
  copyResultRow
}
