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
    this.args = options.args
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

  /**
   * returns the part of ctx.result, as array if ctx.result is not
   * this is neeeded to support queries that return a list and queries that return a single item
   * to have a unified interface for .args function
   */
  partialResults (ctx) {
    let result = ctx.result

    for (let i = 0; i < this.path.length; ++i) {
      const path = this.path[i]
      const node = result[path]
      if (Array.isArray(result)) {
        result = result.map(r => r[path])
        continue
      }
      result = node
    }

    return Array.isArray(result)
      ? result
      : [result]
  }

  buildArguments (ctx, node) {
    if (typeof this.args === 'function') {
      const results = this.partialResults(ctx)
      const args = this.args(results)

      // TODO(cjihrig): Validate returned args object.
      if (args === null || typeof args !== 'object') {
        throw new TypeError(`args function did not return an object. returned ${args}.`)
      }

      // TODO filter same values on args
      return `(${toQueryArguments(args)})`
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
            let followup = ctx.followups.get(node)

            if (followup === undefined) {
              const typeName = type.schemaNode.name

              const entity = this.subgraph.entities[typeName]
              if (!entity) {
                const keys = transitiveKeys(typeName, this.subgraph.entities)
                if (!keys) {
                  // TODO test, doc
                  throw new Error(`Unable to resolve entity ${typeName} in subgraph ${this.subgraph.name}`)
                }
                keyFields = keys
              } else {
                keyFields = entity.keys
              }

              // TODO(cjihrig): Double check the next line.
              const nextSubgraph = Array.from(field.subgraphs)[0]
              // TODO(cjihrig): Throw if this doesn't exist.
              const entityOnNext = nextSubgraph.entities[typeName]
              const { args, referenceListResolverName: resolverName } = entityOnNext

              // TODO use a generator for followups?
              followup = {
                node,
                schemaNode,
                path: ctx.path.slice(),
                type,
                fields: [],
                resolverName,
                root: false,
                subgraph: nextSubgraph,
                info: this.info,
                args,
                types: this.types
                // solved: false
              }
              ctx.followups.set(node, followup)
            }

            followup.fields.push(field)
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

    if (keyFields) {
      for (let i = 0; i < keyFields.length; ++i) {
        const keyFieldName = keySelection(keyFields[i].field)

        if (!set.includes(keyFieldName)) {
          set.push(keyFieldName)
        }
      }
    }

    if (set.length < 1) {
      console.warn('something wrong here, no fields in the query selection', keyFields)
    }

    return `{ ${set.join(', ')} }`
  }
}

// TODO move to utils
function toQueryArguments (v, root = true) {
  if (v === undefined) { return '' }

  if (Array.isArray(v)) {
    return `[${v.map(v => toQueryArguments(v, false)).join(', ')}]`
  }

  if (typeof v === 'object') {
    const o = Object.keys(v).map(k => `${k}: ${toQueryArguments(v[k], false)}`)
    return root ? o : `{ ${o} }`
  }

  // TODO test: quotes
  return typeof v === 'string' ? `"${v}"` : v.toString()
}

// TODO move to utils
// TODO performance
// function keySelection(path) {
//   if (path.indexOf('.') === -1) { return path }

//   const nested = path.split('.')
//   const root = nested.shift()
//   return nested.reduce((result, k) => `${result} {${k}}`, root)
// }

function keySelection (path) {
  if (path.indexOf('.') === -1) { return path }

  return path.split('.').pop()
}

function transitiveKeys (type, subgraphEntities) {
  for (const entity of Object.values(subgraphEntities)) {
    const key = entity.keys.find(k => k.type === type)
    if (key) {
      return [key]
    }
  }
}

module.exports = { QueryBuilder }
