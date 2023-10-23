'use strict'
const { once } = require('node:events')
const { isDeepStrictEqual } = require('node:util')
const { buildClientSchema, printSchema } = require('graphql')
const { SubscriptionClient } = require('@mercuriusjs/subscription-client')
const { createEmptyObject, unwrapSchemaType } = require('./graphql-utils')
const { fetchSubgraphSchema, makeGraphqlRequest } = require('./network')
const { QueryBuilder } = require('./query-builder')
const { isObject } = require('./utils')
const {
  validateArray,
  validateFunction,
  validateObject,
  validateString
} = require('./validation')

class Composer {
  #queryTypeName
  #mutationTypeName
  #subscriptionTypeName
  #subgraphs
  #pubsub
  #types
  #directives

  constructor (options = {}) {
    validateObject(options, 'options')

    const {
      queryTypeName = 'Query',
      mutationTypeName = 'Mutation',
      subscriptionTypeName = 'Subscription',
      subgraphs = [],
      onSubgraphError = onError,
      subscriptions
    } = options

    validateString(queryTypeName, 'queryTypeName')
    validateString(mutationTypeName, 'mutationTypeName')
    validateString(subscriptionTypeName, 'subscriptionTypeName')
    validateArray(subgraphs, 'subgraphs')
    validateFunction(onSubgraphError, 'onSubgraphError')

    if (subscriptions) {
      validateObject(subscriptions, 'subscriptions')
      const { onError, publish, subscribe, unsubscribe } = subscriptions
      validateFunction(onError, 'subscriptions.onError')
      validateFunction(publish, 'subscriptions.publish')
      validateFunction(subscribe, 'subscriptions.subscribe')
      validateFunction(unsubscribe, 'subscriptions.unsubscribe')
      this.#pubsub = { onError, publish, subscribe, unsubscribe }
    }

    const subgraphsCopy = []

    for (let i = 0; i < subgraphs.length; ++i) {
      const subgraph = subgraphs[i]

      validateObject(subgraph, `subgraphs[${i}]`)

      const {
        entities = {},
        server
      } = subgraph

      validateObject(server, `subgraphs[${i}].server`)

      const {
        host,
        composeEndpoint = '/.well-known/graphql-composition',
        graphqlEndpoint = '/graphql'
      } = server

      validateString(host, `subgraphs[${i}].server.host`)
      validateString(composeEndpoint, `subgraphs[${i}].server.composeEndpoint`)
      validateString(graphqlEndpoint, `subgraphs[${i}].server.graphqlEndpoint`)

      const entitiesCopy = Object.create(null)

      if (isObject(entities)) {
        const entityNames = Object.keys(entities)

        for (let j = 0; j < entityNames.length; ++j) {
          const name = entityNames[j]
          const value = entities[name]

          validateObject(value, `subgraphs[${i}].entities.${name}`)

          const {
            adapter,
            foreignKeyFields,
            primaryKeyFields,
            referenceListResolverName
          } = value

          if (adapter !== undefined && typeof adapter !== 'function') {
            throw new TypeError(
              `subgraphs[${i}].entities.${name}.adapter must be a function`
            )
          }

          validateString(
            referenceListResolverName,
            `subgraphs[${i}].entities.${name}.referenceListResolverName`
          )

          if (Array.isArray(foreignKeyFields)) {
            for (let k = 0; k < foreignKeyFields.length; ++k) {
              const field = foreignKeyFields[k]

              validateString(
                field,
                `subgraphs[${i}].entities.${name}.foreignKeyFields[${k}]`
              )
            }
          } else if (foreignKeyFields !== undefined) {
            throw new TypeError(
              `subgraphs[${i}].entities.${name}.foreignKeyFields must be an array`
            )
          }

          if (Array.isArray(primaryKeyFields)) {
            for (let k = 0; k < primaryKeyFields.length; ++k) {
              const field = primaryKeyFields[k]

              validateString(
                field,
                `subgraphs[${i}].entities.${name}.primaryKeyFields[${k}]`
              )
            }
          } else if (primaryKeyFields !== undefined) {
            throw new TypeError(
              `subgraphs[${i}].entities.${name}.primaryKeyFields must be an array`
            )
          }

          if (primaryKeyFields && foreignKeyFields) {
            throw new Error(
              `subgraphs[${i}].entities.${name} cannot specify primary and foreign key`
            )
          }

          if (!primaryKeyFields && !foreignKeyFields) {
            throw new Error(
              `subgraphs[${i}].entities.${name} must specify primary or foreign key`
            )
          }

          entitiesCopy[name] = {
            adapter: adapter ?? createDefaultAdapter(name, primaryKeyFields ?? foreignKeyFields),
            foreignKeyFields,
            primaryKeyFields,
            referenceListResolverName
          }
        }
      } else if (entities !== undefined) {
        throw new TypeError(`subgraphs[${i}].entities must be an object`)
      }

      // Make a copy of the input so that no tampering occurs at runtime. It
      // also protects against other things like weird getters.
      subgraphsCopy.push({
        server: { host, composeEndpoint, graphqlEndpoint },
        entities: entitiesCopy
      })
    }

    this.#queryTypeName = queryTypeName
    this.#mutationTypeName = mutationTypeName
    this.#subscriptionTypeName = subscriptionTypeName
    this.#subgraphs = subgraphsCopy
    this.#types = new Map()
    this.#directives = new Map()
    this.resolvers = Object.create(null)
    this.onSubgraphError = onSubgraphError
    this.subscriptionMap = new Map()
    this.onSubscriptionEnd = onSubscriptionEnd.bind(this)
  }

  toSchema () {
    const types = []
    const directives = Array.from(this.#directives.values())
    let queryType = null
    let mutationType = null
    let subscriptionType = null

    if (this.#types.has(this.#queryTypeName)) {
      queryType = { name: this.#queryTypeName }
    }

    if (this.#types.has(this.#mutationTypeName)) {
      mutationType = { name: this.#mutationTypeName }
    }

    if (this.#types.has(this.#subscriptionTypeName)) {
      subscriptionType = { name: this.#subscriptionTypeName }
    }

    for (const value of this.#types.values()) {
      types.push(value.schemaNode)
    }

    return {
      __schema: {
        queryType,
        mutationType,
        subscriptionType,
        types,
        directives
      }
    }
  }

  toSdl () {
    return printSchema(buildClientSchema(this.toSchema()))
  }

  async compose () {
    const schemas = await this.#fetchSubgraphSchemas()

    for (let i = 0; i < schemas.length; ++i) {
      this.mergeSchema(schemas[i], this.#subgraphs[i])
    }
  }

  async #fetchSubgraphSchemas () {
    const requests = this.#subgraphs.map((subgraph) => {
      return fetchSubgraphSchema(subgraph.server)
    })
    const responses = await Promise.allSettled(requests)
    const schemas = []

    for (let i = 0; i < responses.length; ++i) {
      const { status, value: introspection } = responses[i]

      if (status !== 'fulfilled') {
        const subgraph = this.#subgraphs[i]
        const endpoint = `${subgraph.server.host}${subgraph.server.composeEndpoint}`
        const msg = `Could not process schema from '${endpoint}'`

        this.onSubgraphError(new Error(msg, { cause: responses[i].reason }), { ...subgraph })
        continue
      }

      schemas.push(introspection)
    }

    return schemas
  }

  mergeSchema ({ __schema: schema }, subgraph) {
    // TODO(cjihrig): Support renaming types and handling conflicts.
    // TODO(cjihrig): Handle directives too.
    const queryType = schema?.queryType?.name
    const mutationType = schema?.mutationType?.name
    const subscriptionType = schema?.subscriptionType?.name

    if (queryType && !this.#types.has(this.#queryTypeName)) {
      this.#types.set(this.#queryTypeName, {
        schemaNode: createEmptyObject(this.#queryTypeName),
        fieldMap: new Map()
      })
    }

    if (mutationType && !this.#types.has(this.#mutationTypeName)) {
      this.#types.set(this.#mutationTypeName, {
        schemaNode: createEmptyObject(this.#mutationTypeName),
        fieldMap: new Map()
      })
    }

    if (subscriptionType && !this.#types.has(this.#subscriptionTypeName)) {
      this.#types.set(this.#subscriptionTypeName, {
        schemaNode: createEmptyObject(this.#subscriptionTypeName),
        fieldMap: new Map()
      })
    }

    for (let i = 0; i < schema.types.length; ++i) {
      const type = schema.types[i]
      const originalTypeName = type.name

      if (originalTypeName.startsWith('__')) {
        // Ignore built in types.
        continue
      }

      let typeName
      let isQueryOrMutation = false
      let isSubscription = false

      if (originalTypeName === queryType) {
        typeName = this.#queryTypeName
        isQueryOrMutation = true
      } else if (originalTypeName === mutationType) {
        typeName = this.#mutationTypeName
        isQueryOrMutation = true
      } else if (this.#pubsub && originalTypeName === subscriptionType) {
        typeName = this.#subscriptionTypeName
        isSubscription = true
      } else {
        typeName = originalTypeName
      }

      const existingType = this.#types.get(typeName)

      if (!existingType) {
        this.#types.set(typeName, {
          schemaNode: type,
          fieldMap: new Map()
        })
      }

      if (Array.isArray(type.fields)) {
        const theType = this.#types.get(typeName)
        const { fieldMap } = theType

        for (let i = 0; i < type.fields.length; ++i) {
          const field = type.fields[i]
          let existingField = fieldMap.get(field.name)

          if (!existingField) {
            existingField = {
              schemaNode: field,
              subgraphs: new Set()
            }
            fieldMap.set(field.name, existingField)
            theType.schemaNode.fields.push(field)
          }

          existingField.subgraphs.add(subgraph)
        }
      }

      if (Array.isArray(type.fields)) {
        for (let i = 0; i < type.fields.length; ++i) {
          const field = type.fields[i]
          const originalFieldName = field.name
          // const fieldName = subgraph.renameQueries?.[originalFieldName] ?? originalFieldName;
          const fieldName = originalFieldName

          // TODO(cjihrig): This is a hack. Use a transform visitor for this.
          field.name = fieldName
          // End hack.

          if (existingType) {
            addFieldToType(existingType, field, subgraph)
          }

          if (isQueryOrMutation) {
            const resolver = this.#createResolver({
              // TODO(cjihrig): Audit fields included here.
              type,
              field,
              fieldName: originalFieldName,
              subgraph
            })

            this.resolvers[typeName] ??= Object.create(null)
            this.resolvers[typeName][fieldName] = resolver
          } else if (isSubscription) {
            const subscribe = this.#createSubscription({
              type,
              field,
              fieldName: originalFieldName,
              subgraph,
              pubsub: this.#pubsub
            })

            this.resolvers[typeName] ??= Object.create(null)
            this.resolvers[typeName][fieldName] = { subscribe }
          }
        }
      } else if (existingType &&
        !isDeepStrictEqual(type, existingType.schemaNode)) {
        // TODO(cjihrig): Revisit this.
        throw new Error(`Duplicate non-entity type: ${typeName}`)
      }
    }
  }

  #createResolver ({ type, field, fieldName, subgraph }) {
    return async (parent, args, contextValue, info) => {
      const ctx = {
        path: [],
        followups: new Map(),
        result: { [fieldName]: null }
      }
      const node = info.fieldNodes[0]
      const schemaNode = type.fields.find((f) => {
        return f.name === node.name.value
      })
      const bareType = unwrapSchemaType(schemaNode.type)
      const objType = this.#types.get(bareType.name)
      const query = new QueryBuilder({
        node,
        schemaNode,
        path: [fieldName],
        type: objType,
        fields: [],
        subgraph,
        resolverName: info.fieldName,
        root: true,
        info,
        adapter: null,
        types: this.#types
      })
      await this.#runQuery(ctx, query)
      return ctx.result[fieldName]
    }
  }

  #createSubscription ({ type, field, fieldName, subgraph, pubsub }) {
    return async (parent, args, contextValue, info) => {
      // TODO(cjihrig): Get this from config.
      const wsUrl = (subgraph.server.host + subgraph.server.graphqlEndpoint).replace('http://', 'ws://')
      let client // eslint-disable-line prefer-const
      let topic // eslint-disable-line prefer-const
      const shutdown = () => {
        // Close the connection to the upstream subgraph.
        try {
          client?.unsubscribeAll()
          client?.close()
        } catch { } // Ignore error.

        // Close the connection from the client.
        try {
          pubsub.unsubscribe(contextValue, topic)
        } catch { } // Ignore error.
      }

      client = new SubscriptionClient(wsUrl, {
        serviceName: 'composer',
        failedConnectionCallback: shutdown,
        failedReconnectCallback: shutdown
      })

      client.connect()
      await once(client, 'ready')

      const ctx = {
        path: [],
        followups: new Map(),
        result: { [fieldName]: null }
      }
      const node = info.fieldNodes[0]
      const schemaNode = type.fields.find((f) => {
        return f.name === node.name.value
      })
      const bareType = unwrapSchemaType(schemaNode.type)
      const objType = this.#types.get(bareType.name)
      const query = new QueryBuilder({
        node,
        schemaNode,
        path: [fieldName],
        type: objType,
        fields: [],
        subgraph,
        resolverName: info.fieldName,
        root: true,
        info,
        adapter: null,
        types: this.#types
      })
      const text = query.buildQuery(ctx)
      topic = await client.createSubscription(text, {}, async (data) => {
        try {
          if (ctx.followups.size > 0) {
            // A new context is needed each time the subscription is triggered
            // and there are follow up queries.
            const newCtx = {
              path: [],
              followups: new Map(ctx.followups),
              result: data.payload
            }

            await this.#runFollowupQueries(newCtx, newCtx.result[fieldName])
            data.payload = newCtx.result
          }
          await pubsub.publish(contextValue, topic, data.payload)
        } catch (err) {
          await pubsub.onError(contextValue, topic, err)
        }
      })

      this.subscriptionMap.set(contextValue.id, shutdown)
      return await pubsub.subscribe(contextValue, topic)
    }
  }

  async #runQuery (ctx, query) {
    const text = query.buildQuery(ctx)
    const data = await makeGraphqlRequest(text, query.subgraph.server)
    const merged = mergeResults(query, ctx.result, data)

    await this.#runFollowupQueries(ctx, merged)
  }

  async #runFollowupQueries (ctx, merged) {
    // TODO(cjihrig): Need to query the primary owner first.
    for (const followup of ctx.followups.values()) {
      const hasUnresolvedFields = followup.fields.some((f) => {
        return !(f.schemaNode.name in merged)
      })

      if (!hasUnresolvedFields) {
        continue
      }

      const query = new QueryBuilder(followup)
      // All followups are query operations.
      query.operation = 'query'
      await this.#runQuery(ctx, query)
    }
  }
}

function mergeResults (query, partialResult, response) {
  let result = response[query.resolverName]
  let mergeAt = partialResult
  let mergeParent = null

  for (let i = 0; i < query.path.length; ++i) {
    mergeParent = mergeAt
    mergeParent[query.path[i]] ??= null
    mergeAt = mergeAt[query.path[i]]
  }

  if (!query.root) {
    if (Array.isArray(mergeAt) && !Array.isArray(result)) {
      result = [result]
    } else if (!Array.isArray(mergeAt) &&
      Array.isArray(result) &&
      result.length === 1) {
      result = result[0]
    }
  }

  if (mergeAt === null) {
    mergeParent[query.path.at(-1)] = result
    mergeAt = result
  } else if (Array.isArray(result)) {
    // TODO(cjihrig): Need to merge arrays properly.
  } else if (isObject(result)) {
    for (const [k, v] of Object.entries(result)) {
      mergeAt[k] = v
    }
  } else {
    mergeParent[query.path.at(-1)] = result
  }

  return mergeAt
}

function addFieldToType (type, field, subgraph) {
  const { schemaNode: schemaType, fieldMap } = type
  const existingField = fieldMap.get(field.name)

  if (existingField) {
    if (isDeepStrictEqual(field, existingField.schemaNode)) {
      // There is an existing field that is identical to the new field.
      existingField.subgraphs.add(subgraph)
      return
    }

    // There is an existing field that conflicts with the new one.
    const msg = `Entity '${schemaType.name}' has conflicting types for ` +
      `field '${field.name}'`

    throw new Error(msg)
  }

  schemaType.fields.push(field)
  fieldMap.set(field.name, {
    schemaNode: field,
    subgraphs: new Set()
  })
}

function onSubscriptionEnd (ctx, topic) {
  // Shut down the upstream connection.
  this.subscriptionMap.get(topic)?.()
  this.subscriptionMap.delete(topic)
}

function createDefaultAdapter (name, keyFields) {
  return function adapter (partialResult) {
    const result = {}

    for (const field of keyFields) {
      result[field] = partialResult[field]
    }

    return result
  }
}

function onError (error) { throw error }

module.exports = { Composer }
