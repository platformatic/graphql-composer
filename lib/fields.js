'use strict'

const QUERY_TYPE = 'QUERY'
const MUTATION_TYPE = 'MUTATION'

/**
 * merge two definitions of the same type coming from different subgraphs
 * - ENUM: the union of the values, by name
 * - OBJECT: the union of the fields, by name; the first definition of a field wins
 * - anything else: the first definition wins
 *
 * Same-named fields on Query or Mutation are resolved by `Composer#buildSharedFieldResolvers`,
 * which routes each call to one subgraph by the value of an enum argument.
 */
function mergeTypes (t1, t2) {
  if (t1.src.kind === 'ENUM' && Array.isArray(t1.src.enumValues) && Array.isArray(t2.src.enumValues)) {
    t1.src.enumValues = unionByName(t1.src.enumValues, t2.src.enumValues)
    return t1
  }

  if (t1.src.kind !== 'OBJECT' || !Array.isArray(t1.src.fields)) {
    return t1
  }
  t1.src.fields = unionByName(t1.src.fields, t2.src.fields ?? [])

  // TODO t1.fields = t1.fields.concat(t2.fields)
  // TODO fields.resolvers

  return t1
}

function unionByName (first, second) {
  const names = new Set(first.map(item => item.name))
  const union = first.slice()
  for (const item of second) {
    if (names.has(item.name)) { continue }
    names.add(item.name)
    union.push(item)
  }
  return union
}

// return Query or Mutation if type is one of them
// TODO Subscription
function getMainType (schema, type) {
  if (schema.queryType?.name === type.name) { return QUERY_TYPE }
  if (schema.mutationType?.name === type.name) { return MUTATION_TYPE }
}

function createType ({ name, src, fields, entity }) {
  return {
    name,
    src,
    fields: fields ?? new Map(),
    entity
  }
}

function createField ({ name, typeName, src, parent, resolver }) {
  return {
    name,
    src,
    parent,
    typeName,
    resolver
  }
}

function createFieldId (typeName, fieldName) {
  return typeName && fieldName
    ? `${typeName}.${fieldName}`
    : ''
}

module.exports = {
  QUERY_TYPE,
  MUTATION_TYPE,

  mergeTypes,
  getMainType,
  createType,
  createField,

  createFieldId
}
