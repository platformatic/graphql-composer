'use strict'
const { unwrapSchemaType, valueToArgumentString } = require('./graphql-utils')

class QueryBuilder {
  constructor (options) {
    this.node = options.node
    this.schemaNode = options.schemaNode
    this.path = options.path
    this.type = options.type
    this.fields = options.fields
    this.subgraph = options.subgraph
    this.resolverName = options.resolverName
    this.root = options.root
    this.info = options.info
    this.adapter = options.adapter
    this.types = options.types
    this.operation = this.info.operation.operation

    for (const field of this.type.fieldMap.values()) {
      this.fields.push(field)
    }
  }

  buildQuery (ctx) {
    const selectionSet = this.buildSelectionSet(ctx, this.node, this.schemaNode)
    const computedArgs = this.buildArguments(ctx, this.node)
    const query = `${this.operation} { ${this.resolverName}${computedArgs} ${selectionSet} }`

    return query
  }

  buildArguments (ctx, node) {
    if (typeof this.adapter === 'function') {
      if (Array.isArray(ctx.result)) {
        // TODO
      } 

      let result = ctx.result

      for (let i = 0; i < this.path.length; ++i) {
        result = result[this.path[i]]
      }

      const args = this.adapter(result)

      if (args === null || typeof args !== 'object') {
        throw new TypeError(`adapter did not return an object. returned ${args}.`)
      }

      // TODO(cjihrig): Validate returned args object.
      const mappedArgs = Object.keys(args).map((argName) => {
        return `${argName}: ${args[argName]}`
      })

      return `(${mappedArgs.join(', ')})`
    }

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
    const set = []
    let keyFields

    for (let i = 0; i < length; ++i) {
      const s = selections[i]

      if (s.kind === 'FragmentSpread' || s.kind === 'InlineFragment') {
        // TODO(cjihrig): The fragment probably only needs to be expanded if it
        // is defined in the router. If it is defined by the subgraph server, it
        // should know how to handle it.
        const fragment = s.kind === 'FragmentSpread'
          ? this.info.fragments[s.name.value]
          : s

        for (let i = 0; i < fragment.selectionSet.selections.length; ++i) {
          const fragNode = fragment.selectionSet.selections[i]
          let value = fragNode.name.value

          if (fragNode.selectionSet) {
            // TODO(cjihrig): Need to make this whole branch equivalent to the else branch.
            value += ` ${this.buildSelectionSet(ctx, fragNode, schemaNode)}`
          }

          set.push(value)
        }
      } else {
        let value = s.name.value
        const field = fieldMap.get(value)
        const selectionSchemaNode = field?.schemaNode

        // Some nodes won't have a schema representation. For example, __typename.
        if (selectionSchemaNode) {
          if (!field.subgraphs.has(this.subgraph)) {
            let existing = ctx.followups.get(node)

            if (existing === undefined) {
              // TODO(cjihrig): Double check the next line.
              const nextSubgraph = Array.from(field.subgraphs)[0]
              const typeName = type.schemaNode.name
              // TODO(cjihrig): Throw if this doesn't exist.
              const entity = nextSubgraph.entities[typeName]
              const {
                adapter,
                foreignKeyFields,
                primaryKeyFields,
                referenceListResolverName: resolverName
              } = entity

              keyFields = primaryKeyFields ?? foreignKeyFields

              existing = {
                node,
                schemaNode,
                path: ctx.path.slice(),
                type,
                fields: [],
                resolverName,
                root: false,
                subgraph: nextSubgraph,
                info: this.info,
                adapter,
                types: this.types
              }

              ctx.followups.set(node, existing)
            }

            existing.fields.push(field)
            continue
          }

          if (s.arguments.length > 0) {
            value += this.buildArguments(ctx, s)
          }

          if (s.selectionSet) {
            value += ` ${this.buildSelectionSet(ctx, s, selectionSchemaNode)}`
          }
        }

        set.push(value)
      }
    }

    ctx.path.pop()

    if (Array.isArray(keyFields)) {
      for (let i = 0; i < keyFields.length; ++i) {
        const keyFieldName = keyFields[i]

        if (!set.includes(keyFieldName)) {
          set.push(keyFieldName)
        }
      }
    }

    return `{ ${set.join(', ')} }`
  }
}

module.exports = { QueryBuilder }
