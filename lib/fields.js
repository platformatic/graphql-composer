'use strict'

const QUERY_TYPE = 'QUERY'
const MUTATION_TYPE = 'MUTATION'

/**
 * merge two definitions of the same type from different subgraphs, t1 the merged one so far and
 * t2 the next subgraph's, by `onConflict`
 * - ENUM: "first" keeps t1's values, "last" takes t2's, "route" and "error" take the union by name
 * - OBJECT: the union of the fields by name; a field both declare is t2's under "last", t1's otherwise
 * - unset: t1 for an enum; for an object type the field lists concatenated, and graphql-js keeps
 *   the last of a duplicated name when it builds the schema
 * - anything else: t1
 * A Query or Mutation field both publish is resolved by `Composer#buildSharedFieldResolvers`.
 */
function mergeTypes (t1, t2, onConflict) {
  if (t1.src.kind === 'ENUM' && Array.isArray(t1.src.enumValues) && Array.isArray(t2.src.enumValues)) {
    if (onConflict === 'last') {
      t1.src.enumValues = t2.src.enumValues.slice()
    } else if (onConflict === 'route' || onConflict === 'error') {
      t1.src.enumValues = unionByName(t1.src.enumValues, t2.src.enumValues)
    }
    return t1
  }

  if (t1.src.kind !== 'OBJECT' || !Array.isArray(t1.src.fields)) {
    return t1
  }
  t1.src.fields = onConflict === undefined
    ? t1.src.fields.concat(t2.src.fields)
    : unionByName(t1.src.fields, t2.src.fields ?? [], onConflict === 'last')

  // TODO t1.fields = t1.fields.concat(t2.fields)
  // TODO fields.resolvers

  return t1
}

/**
 * union of two lists of named items; an item both lists name is the second's when
 * `preferSecond`, the first's otherwise, in the first's position either way
 */
function unionByName (first, second, preferSecond = false) {
  const index = new Map(first.map((item, i) => [item.name, i]))
  const union = first.slice()
  for (const item of second) {
    const at = index.get(item.name)
    if (at === undefined) {
      index.set(item.name, union.length)
      union.push(item)
    } else if (preferSecond) {
      union[at] = item
    }
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
