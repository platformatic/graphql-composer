'use strict'

// TODO memoize
function entityKeys ({ field, subgraph, entity }) {
  const keys = []

  // entity keys
  if (field.type.entity) {
    if (field.type.entity.pkey) {
      keys.push({ pkey: field.type.entity.pkey })
    }
    if (field.type.entity.fkeys && field.type.entity.fkeys.length > 0) {
      for (const fkey of field.type.entity.fkeys) {
        if (fkey.as) {
          keys.push({ fkey: fkey.field, as: fkey.as })
        }
      }
    }
    if (field.type.entity.many && field.type.entity.many.length > 0) {
      for (const many of field.type.entity.many) {
        if (!entity || (entity === field.type.name)) {
          keys.push({ many: many.pkey, as: many.as })
        }
      }
    }
  }

  // parent keys
  if (field.parent?.entity) {
    if (field.parent?.entity.fkeys.length > 0) {
      for (let i = 0; i < field.parent.entity.fkeys.length; i++) {
        const key = field.parent.entity.fkeys[i]
        if (field.typeName === key.type && (!subgraph || subgraph === key.subgraph)) {
          keys.push({ parent: { fkey: key, typeName: field.parent.name }, entity })
        }
      }
    }
    if (field.parent?.entity.many.length > 0) {
      for (let i = 0; i < field.parent.entity.many.length; i++) {
        const key = field.parent.entity.many[i]
        if (field.typeName === key.type && (!subgraph || subgraph === key.subgraph)) {
          keys.push({ parent: { many: key, typeName: field.parent.name }, entity })
        }
      }
    }
  }

  return keys
}

module.exports = {
  entityKeys
}
