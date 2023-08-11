'use strict';
function nop() {}

const visitorDefaults = {
  argument: nop,
  directive: nop,
  field: nop,
  mutationType: nop,
  queryType: nop,
  schema: nop,
  subscriptionType: nop,
  type: nop,
};

function walkSchema(schema, visitor) {
  const v = { ...visitorDefaults, ...visitor };

  visitSchema(schema, v);
}

function visitSchema(node, visitor) {
  const { __schema: s } = node;

  visitor.schema(node);

  visitor.queryType(s.queryType);

  if (s.mutationType) {
    visitor.mutationType(s.mutationType);
  }

  if (s.subscriptionType) {
    visitor.subscriptionType(s.subscriptionType);
  }

  for (let i = 0; i < s.types.length; ++i) {
    visitType(s.types[i], visitor);
  }

  for (let i = 0; i < s.directives.length; ++i) {
    visitor.directive(s.directives[i]);
  }
}

function visitArgument(node, visitor) {
  visitor.argument(node);
  visitType(node.type, visitor);
}

function visitField(node, visitor) {
  visitor.field(node);
  visitType(node.type, visitor);

  if (Array.isArray(node.args)) {
    for (let i = 0; i < node.args.length; ++i) {
      visitArgument(node, visitor);
    }
  }
}

function visitType(node, visitor) {
  visitor.type(node);

  if (Array.isArray(node.fields)) {
    for (let i = 0; i < node.fields.length; ++i) {
      visitField(node.fields[i], visitor);
    }
  }
}

module.exports = { walkSchema };
