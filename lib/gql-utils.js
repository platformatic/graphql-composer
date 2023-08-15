'use strict';

function createEmptyObject(name) {
  return {
    kind: 'OBJECT',
    name,
    description: null,
    fields: [],
    inputFields: null,
    interfaces: [],
    enumValues: null,
    possibleTypes: null
  };
}

function unwrapSchemaType(node) {
  while (node.kind === 'NON_NULL' || node.kind === 'LIST') {
    node = node.ofType;
  }

  return node;
}

module.exports = { createEmptyObject, unwrapSchemaType };
