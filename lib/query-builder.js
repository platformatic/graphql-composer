'use strict'
const { unwrapSchemaType, valueToArgumentString } = require('./graphql-utils')
const { toQueryArgs, keySelection, traverseResult, nodeTypeName, transitivePKey } = require('./utils')

class QueryBuilder {
  constructor (options) {
    this.swap = options.swap
    this.node = options.node
    this.schemaNode = options.schemaNode
    this.path = options.path.slice()
    this.type = options.type
    this.fields = options.fields

    this.subgraph = options.subgraph
    this.resolverName = options.resolverName
    this.resolverArgsAdapter = options.argsAdapter
    this.resolverPartialResults = options.partialResults

    this.root = options.root
    this.info = options.info
    this.types = options.types
    this.entities = options.entities
    this.operation = this.info.operation.operation

    this.key = options.key
    this.parentKey = options.parentKey // field, as, many

    this.selectedFields = []
    this.args = null

    for (const field of this.type.fieldMap.values()) {
      this.fields.push(field)
    }
  }

  buildQuery (ctx) {
    if (this.resolverArgsAdapter) {
      let results = this.partialResults(ctx.result)
      if (this.resolverPartialResults) {
        results = this.runResolverPartialResults(results)
      }
      this.args = this.runArgsAdapter(results)
    }

    // TODO refactor the swap logic
    // avoid to pass back and forth path between context and folloups
    // keep the "result path" synced with "result" since it's needed to merge results and get partial results
    // then work with a subpart/branch of ctx.result and then for followups
    if (this.swap) {
      ctx.path = this.path.slice()
    } else {
      ctx.path = this.path.slice(0, -1)
    }

    const selectionSet = this.buildSelectionSet(ctx, this.node, this.schemaNode)
    const computedArgs = this.buildArguments(this.node)
    const query = `${this.operation} { ${this.resolverName}${computedArgs} ${selectionSet} }`

    return query
  }

  /**
   * returns the part of ctx.result, as array if ctx.result is not
   * need to to have the same result format for argsAdapter
   */
  partialResults (result) {
    if (!result) { return [] }

    for (let i = 0; i < this.path.length; ++i) {
      const p = this.path[i]

      result = traverseResult(result, p)
    }

    if (!Array.isArray(result)) {
      return [result]
    }

    return result.flat(2).filter(r => !!r)
  }

  runResolverPartialResults (results) {
    let r
    try {
      r = this.resolverPartialResults(results)
    } catch (err) {
      const msg = `Error running partialResults for ${this.resolverName}`
      throw new Error(msg, { cause: err })
    }

    // TODO validate results
    if (r === null) {
      throw new TypeError(`partialResults did not return an object. returned ${r}.`)
    }

    return r
  }

  runArgsAdapter (results) {
    let args
    try {
      args = this.resolverArgsAdapter(results)
    } catch (err) {
      const msg = `Error running argsAdapter for ${this.resolverName}`
      throw new Error(msg, { cause: err })
    }

    // TODO(cjihrig): Validate returned args object.
    if (args === null || typeof args !== 'object') {
      throw new TypeError(`argsAdapter did not return an object. returned ${args}.`)
    }

    return args
  }

  buildNodeArgs (node) {
    const length = node.arguments?.length ?? 0

    if (length === 0) {
      return ''
    }

    const mappedArgs = node.arguments.map((a) => {
      const name = a.name.value
      let value

      if (a.value.kind === 'Variable') {
        const varName = a.value.name.value
        const varValue = this.info.variableValues[varName]
        // const varDef = this.info.operation.variableDefinitions.find((v) => {
        //   return v.variable.name.value === varName;
        // });
        // TODO(cjihrig): Use varDef to find strings.
        const isString = false

        if (typeof varValue === 'object') {
          // TODO(cjihrig): Make this recursive and move to its own function.
          const kvs = Object.keys(varValue).map((k) => {
            let v = varValue[k]

            if (typeof v === 'string') {
              v = `"${v}"`
            }

            return `${k}: ${v}`
          }).join(', ')

          value = `{ ${kvs} }`
        } else {
          value = isString ? `"${varValue}"` : varValue
        }
      } else {
        value = valueToArgumentString(a.value)
      }

      return `${name}: ${value}`
    })

    return `(${mappedArgs.join(', ')})`
  }

  buildArguments (node) {
    // using this.argsAdapter instead of this.args since could be falsy
    if (this.resolverArgsAdapter) {
      return toQueryArgs(this.args)
    }

    return this.buildNodeArgs(node)
  }

  buildSelectionSet (ctx, node, schemaNode) {
    const selections = node.selectionSet?.selections
    const length = selections?.length ?? 0

    if (length === 0) {
      return ''
    }

    ctx.path.push(node.name.value)

    const bareType = unwrapSchemaType(schemaNode.type)
    const type = this.types.get(bareType.name)
    const { fieldMap } = type
    const set = new Set()
    let keyFields

    for (let i = 0; i < length; ++i) {
      const selection = selections[i]

      if (selection.kind === 'FragmentSpread' || selection.kind === 'InlineFragment') {
        // TODO(cjihrig): The fragment probably only needs to be expanded if it
        // is defined in the router. If it is defined by the subgraph server, it
        // should know how to handle it.
        const fragment = selection.kind === 'FragmentSpread'
          ? this.info.fragments[selection.name.value]
          : selection

        for (let i = 0; i < fragment.selectionSet.selections.length; ++i) {
          const fragNode = fragment.selectionSet.selections[i]
          let value = fragNode.name.value

          if (fragNode.selectionSet) {
            // TODO(cjihrig): Need to make this whole branch equivalent to the else branch.
            value += ` ${this.buildSelectionSet(ctx, fragNode, schemaNode)}`
          }

          set.add(value)
        }
      } else {
        let value = selection.name.value
        const field = fieldMap.get(value)
        const selectionSchemaNode = field?.schemaNode

        // Some nodes won't have a schema representation. For example, __typename.
        if (selectionSchemaNode) {
          if (!field.subgraphs.has(this.subgraph)) {
            const { index, subgraph, swap } = this.followupIndex(field, ctx.path)

            let followup = ctx.followups.get(index)
            if (!followup) {
              const parentKeys = this.getKeyFields(type)

              let followupSchema, followupNode
              if (swap) {
                followupSchema = selectionSchemaNode
                followupNode = selection
              } else {
                followupSchema = schemaNode
                followupNode = node
              }

              followup = this.createFollowup(ctx, followupSchema, followupNode, this.subgraph, type, field, subgraph, swap)

              keyFields = collectKeys(keyFields, parentKeys)
              if (followup) {
                ctx.followups.set(index, followup)
              }
            } else {
              // TODO followup can have multiple entities, now it's suppose to have only one

              // TODO use a Set for followup.fields
              followup.fields.push(field)
            }

            continue
          }

          if (selection.arguments.length > 0) {
            value += this.buildArguments(selection)
          }

          if (selection.selectionSet) {
            value += ` ${this.buildSelectionSet(ctx, selection, selectionSchemaNode)}`
          }
        }

        set.add(value)
      }
    }

    ctx.path.pop()

    // add entity pkey to selection, needed to match rows merging results
    // no followups here
    if (!keyFields) {
      const entity = this.subgraph.entities[bareType.name]
      if (!entity) {
        // TODO onError: missing entity definition', typeName, 'in subgraph', this.subgraph.name)
      } else {
        // TODO keys generator fn
        // TODO collect entity keys on composer mergeSchema to avoid collecting them every time
        // TODO lookup for entities to resolve, no need to add all the fkeys always
        keyFields = {
          pkey: entity.pkey,
          fkeys: [
            ...(entity.fkeys || []),
            ...(entity.many || [])
              .map(m => ({ field: m.pkey, as: m.as }))
          ]
        }
      }
    }

    if (keyFields) {
      set.add(keySelection(keyFields.pkey))
      for (let i = 0; i < keyFields.fkeys.length; ++i) {
        if (!keyFields.fkeys[i].field) { continue }
        const keyFieldName = keySelection(keyFields.fkeys[i].field)
        set.add(keyFieldName)
      }
    }

    // TODO improve structure
    const selectedFields = Array.from(set)
    this.selectedFields = selectedFields.map(f => f.split(' ')[0])

    return `{ ${selectedFields.join(', ')} }`
  }

  // TODO memoize by subgraph#entity
  getKeyFields (type) {
    const typeName = type.schemaNode.name

    const entity = this.subgraph.entities[typeName]

    if (!entity) {
      const pkey = transitivePKey(typeName, this.subgraph.entities)
      if (!pkey) {
        // TODO onError
        throw new Error(`Unable to resolve entity ${typeName} in subgraph ${this.subgraph.name}`)
      }
      return {
        pkey,
        fkeys: []
      }
    } else {
      return {
        pkey: entity.pkey,
        fkeys: [
          ...(entity.fkeys || []),
          ...(entity.many || [])
            .map(m => ({ field: m.pkey, as: m.as }))
        ]
      }
    }
  }

  followupSubgraph (field) {
    const fieldTypeName = nodeTypeName(field)

    const entity = this.entities[fieldTypeName]
    const subgraph = Array.from(field.subgraphs)[0]

    if (!entity) {
      return { subgraph }
    }

    // get the subgraph to resolve the entity
    // if the resolver is not set, means the entity must be resolved by another subgraph
    // in this way we save a roundtrip to a resolver on the current subgraph to resolve the entity

    // TODO use a Map on subgraph to avoid this loop
    const entitySubgraph = entity.subgraphs.find(s => {
      return s.name === subgraph.name
    })

    if (entitySubgraph.entities[fieldTypeName]?.resolver) {
      return { subgraph, swap: true }
    }

    // TODO add field filter condition
    const s = entity.subgraphs.find(s => {
      return !!s.entities[fieldTypeName].resolver
    })

    return { subgraph: s, swap: true }
  }

  createFollowup (ctx, schemaNode, node, parentSubgraph, parentType, field, subgraph, swap) {
    const parentTypeName = parentType.schemaNode.name
    let fieldTypeName = parentTypeName

    const path = ctx.path.slice()

    if (swap) {
      fieldTypeName = nodeTypeName(field)
    }

    // TODO refactor: followupSubgraph can return both subgraph and entity and probably keys
    // TODO handle error if entity or subgraphs don't exists
    const parentEntity = parentSubgraph.entities[parentTypeName]
    const entity = subgraph.entities[fieldTypeName]
    const type = this.types.get(fieldTypeName)

    let manyEntity
    let partialResults, parentKey
    let argsAdapter = entity.resolver.argsAdapter
    let resolverName = entity.resolver.name
    let key = entity.pkey

    if (parentEntity?.many) {
      manyEntity = parentEntity.many.find(m => m.type === fieldTypeName)
      if (manyEntity) {
        // TODO createKey fn
        // reverse the keys as the many relation is inverse
        key = manyEntity.fkey
        parentKey = { field: manyEntity.pkey, as: manyEntity.as, many: true }
        argsAdapter = manyEntity.resolver.argsAdapter
        resolverName = manyEntity.resolver.name
        partialResults = manyEntity.resolver.partialResults
      }
    }

    if (!manyEntity && parentEntity?.fkeys) {
      const foreignKey = parentEntity.fkeys.find(f => f.type === fieldTypeName)
      if (foreignKey) {
        parentKey = foreignKey
        if (foreignKey.resolver.partialResults) {
          partialResults = foreignKey.resolver.partialResults
        }
      }
    }

    if (!parentKey) {
      parentKey = { field: key }
    }

    return {
      swap,
      path,
      node,
      schemaNode,
      type,
      resolverName,
      argsAdapter,
      partialResults,
      subgraph,
      info: this.info,
      types: this.types,
      entities: this.entities,
      key,
      parentKey,
      root: false,
      fields: [field],
      solved: false
    }
  }

  // TODO memoize
  followupIndex (field, path) {
    const { subgraph, swap } = this.followupSubgraph(field)

    return {
      index: `path:${path.join('/')}#sg:${subgraph.name}`,
      subgraph,
      swap
    }
  }
}

function collectKeys (keyFields, parentKeys) {
  if (!keyFields) {
    return parentKeys
  }

  // TODO if parentKeys.pkey != keyFields.pkey throw Error

  keyFields.fkeys = keyFields.fkeys.concat(parentKeys.fkeys)
  return keyFields
}

module.exports = { QueryBuilder }
