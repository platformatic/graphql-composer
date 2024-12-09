'use strict'

function defaultOnError (error) {
  throw error
}

function createDefaultArgsAdapter (pkey) {
  return function argsAdapter (partialResults) {
    return { [pkey + 's']: partialResults.map((r) => r[pkey]) }
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
  return field.type.name || unwrapFieldTypeName({ type: field.type.ofType })
}

function collectPlainArgs (args, nodeArguments, info, types) {
  if (args === undefined || args === null) {
    return
  }

  if (nodeArguments?.kind === 'Variable') {
    return collectVariableArg(nodeArguments, info, types)
  }

  if (Array.isArray(args)) {
    const queryArgs = []
    for (let i = 0; i < args.length; i++) {
      const arg = collectPlainArgs(args[i], nodeArguments[i], info, types)
      if (!arg) { continue }
      queryArgs.push(arg)
    }

    return { value: queryArgs, type: 'ListValue', node: nodeArguments }
  }

  if (typeof args === 'object') {
    const keys = Object.keys(args)
    const queryArgs = {}
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const node = selectArgNode(nodeArguments, key)
      const value = collectPlainArgs(args[key], node, info, types)
      if (!value) { continue }
      queryArgs[key] = value
    }

    return { value: queryArgs, type: 'ObjectValue', node: nodeArguments }
  }

  return { value: args, type: nodeArguments.kind, node: nodeArguments }
}

function selectArgNode (nodeArguments, key) {
  let value
  if (!Array.isArray(nodeArguments)) {
    if (nodeArguments.kind === 'Variable') {
      return nodeArguments
    }

    if (nodeArguments.kind === 'ObjectValue') {
      for (const f of nodeArguments.fields) {
        if (f.name.value === key) {
          value = f.value
          break
        }
      }
    } else {
      value = nodeArguments
    }
  }

  if (!value) {
    for (const n of nodeArguments) {
      if (n.name.value === key) {
        value = n.value
        break
      }
    }
  }

  if (!value) {
    return
  }

  if (value.kind === 'ObjectValue') {
    return value.fields
  }

  if (value.kind === 'ListValue') {
    return value.values
  }

  return value
}

function collectNodeArgs (nodeArguments, info, types) {
  if (!nodeArguments || nodeArguments.length < 1) {
    return {}
  }
  const args = {}
  for (let i = 0; i < nodeArguments.length; i++) {
    const node = nodeArguments[i]
    const name = node.name.value
    if (node.value.kind !== 'Variable') {
      args[name] = node.value.value
      continue
    }
    args[name] = collectVariableArg(node.value, info, types)
  }
  return args
}

function unwrapArrayVariable (varValue, varTypes) {
  const value = []
  for (let j = 0; j < varValue.length; j++) {
    const v = varValue[j]
    value.push(unwrapVariable(v, varTypes))
  }
  return { value, type: 'ListValue' }
}

function unwrapObjectVariable (varValue, varTypes) {
  const value = {}
  const keys = Object.keys(varValue)
  for (let j = 0; j < keys.length; j++) {
    const v = varValue[keys[j]]
    value[keys[j]] = unwrapVariable(v, varTypes ? varTypes[keys[j]] : undefined)
  }
  return { value, type: 'ObjectValue' }
}

function unwrapVariable (varValue, varTypes) {
  if (Array.isArray(varValue)) {
    return unwrapArrayVariable(varValue, varTypes)
  }
  if (varValue !== null && typeof varValue === 'object') {
    return unwrapObjectVariable(varValue, varTypes)
  }
  return { value: varValue, type: mapJsToGqlType(varValue, varTypes) }
}

function collectVariableArg (node, info, types) {
  const varName = node.name.value
  const varValue = info.variableValues[varName] ?? null
  const varTypes = resolveVariableType(varName, varValue, info, types)
  return unwrapVariable(varValue, varTypes)
}

const _mapJsToGqlType = {
  string: 'StringValue',
  number: 'IntValue'
}

function mapJsToGqlType (value, varTypes) {
  return varTypes || _mapJsToGqlType[typeof value]
}

function findNamedType (obj) {
  if (obj === null || typeof obj !== 'object') {
    return null
  }
  if (obj.kind === 'NamedType') {
    return obj.name.value
  } else if (obj.type) {
    return findNamedType(obj.type)
  }
  return null
}

function resolveVariableType (varName, varValue, info, types) {
  const variableDefinition = info.operation.variableDefinitions?.find(
    (v) => v.variable?.name?.value === varName
  )
  const type = findNamedType(variableDefinition)
  return mapInputTypeToTypes(type, types)
}

const scalarTypes = {
  ID: 'StringValue',
  String: 'StringValue',
  Int: 'IntValue',
  Float: 'FloatValue',
  Boolean: 'BooleanValue'
}

function mapType (type, types) {
  switch (type.kind) {
    case 'SCALAR':
      return scalarTypes[type.name]
    case 'ENUM':
      return 'EnumValue'
    case 'INPUT_OBJECT':
      return mapInputTypeToTypes(type.name, types)
    case 'LIST':
      return mapType(type.ofType, types)
    case 'NON_NULL':
      return mapType(type.ofType, types)
    default:
      return undefined
  }
}

function mapInputTypeToTypes (inputTypeName, types) {
  if (!types || !inputTypeName || !types[inputTypeName]) {
    return undefined
  }

  const inputType = types[inputTypeName]
  switch (inputType.src?.kind) {
    case 'INPUT_OBJECT':
      return inputType.src.inputFields.reduce((result, field) => {
        result[field.name] = mapType(field.type, types)
        return result
      }, {})
    case 'OBJECT':
      return inputType.src.fields.reduce((result, field) => {
        result[field.name] = mapType(field.type, types)
        return result
      }, {})
    case 'SCALAR':
      return scalarTypes[inputType.src.name]
    case 'ENUM':
      return 'EnumValue'
    default:
      return undefined
  }
}

function schemaTypeName (types, subgraphName, entityName, fieldName) {
  const t = types[entityName][subgraphName].fields.get(fieldName).src.type
  const notNull = t.kind === 'NON_NULL' ? '!' : ''
  return (t.name || t.ofType.name) + notNull
}

module.exports = {
  defaultOnError,
  createDefaultArgsAdapter,
  isObject,
  objectDeepClone,
  copyObjectByKeys,
  mergeMaps,
  pathJoin,

  collectNodeArgs,
  collectPlainArgs,
  unwrapFieldTypeName,
  schemaTypeName
}
