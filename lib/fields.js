'use strict'

const QUERY_TYPE = 'QUERY'
const MUTATION_TYPE = 'MUTATION'

/**
 * merge only entity types
 */
function mergeTypes (t1, t2) {
  if (t1.src.kind !== 'OBJECT' || !Array.isArray(t1.src.fields)) {
    return t1
  }
  t1.src.fields = t1.src.fields.concat(t2.src.fields)

  // TODO t1.fields = t1.fields.concat(t2.fields)
  // TODO fields.resolvers

  return t1
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
