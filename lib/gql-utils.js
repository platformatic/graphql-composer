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

function valueToArgumentString(node) {
  const kind = node.kind;

  if (kind === 'ObjectValue') {
    const fields = node.fields.map((f) => {
      const name = f.name.value;
      const value = valueToArgumentString(f.value);

      return `${name}: ${value}`;
    });

    return `{ ${fields.join(', ')} }`;
  } else if (kind === 'StringValue') {
    return `"${node.value}"`;
  } else {
    return node.value;
  }
}

module.exports = {
  createEmptyObject,
  unwrapSchemaType,
  valueToArgumentString
};
