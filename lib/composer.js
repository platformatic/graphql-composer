'use strict'
const { once } = require('node:events')
const { isDeepStrictEqual } = require('node:util')
const { buildClientSchema, printSchema } = require('graphql')
const { SubscriptionClient } = require('@mercuriusjs/subscription-client')
const { getIntrospectionQuery } = require('graphql')
const fastify = require('fastify')
const mercurius = require('mercurius')
const metaline = require('metaline')
const { createEmptyObject, unwrapSchemaType } = require('./graphql-utils')
const { fetchSubgraphSchema, makeGraphqlRequest } = require('./network')
const { QueryBuilder } = require('./query-builder')
const { isObject, traverseResult, schemaTypeName, createDefaultArgsAdapter } = require('./utils')
const {
  validateArray,
  validateFunction,
  validateObject,
  validateString,
  validateResolver
} = require('./validation')

class Composer {
  #queryTypeName
  #mutationTypeName
  #subscriptionTypeName
  #subgraphs
  #subgraphsIndex
  #pubsub
  #types
  #directives
  #entities

  constructor (options = {}) {
    validateObject(options, 'options')

    const {
      queryTypeName = 'Query',
      mutationTypeName = 'Mutation',
      subscriptionTypeName = 'Subscription',
      subgraphs = [],
      onSubgraphError = onError,
      subscriptions,
      addEntitiesResolvers
    } = options

    let defaultArgsAdapter = options.defaultArgsAdapter

    this.addEntitiesResolvers = !!addEntitiesResolvers

    validateString(queryTypeName, 'queryTypeName')
    validateString(mutationTypeName, 'mutationTypeName')
    validateString(subscriptionTypeName, 'subscriptionTypeName')
    validateArray(subgraphs, 'subgraphs')
    validateFunction(onSubgraphError, 'onSubgraphError')

    if (defaultArgsAdapter) {
      if (typeof defaultArgsAdapter === 'string') {
        defaultArgsAdapter = metaline(defaultArgsAdapter)
      } else {
        validateFunction(defaultArgsAdapter, 'defaultArgsAdapter')
      }
    }

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
    this.#subgraphsIndex = {}
    this.#entities = {}

    for (let i = 0; i < subgraphs.length; ++i) {
      const subgraph = subgraphs[i]
      const subgraphName = subgraph?.name || '#' + i

      validateObject(subgraph, `subgraphs[${subgraphName}]`)

      const {
        entities,
        server
      } = subgraph

      validateObject(server, `subgraphs[${subgraphName}].server`)

      const {
        host,
        composeEndpoint = '/.well-known/graphql-composition',
        graphqlEndpoint = '/graphql'
      } = server

      validateString(host, `subgraphs[${subgraphName}].server.host`)
      validateString(composeEndpoint, `subgraphs[${subgraphName}].server.composeEndpoint`)
      validateString(graphqlEndpoint, `subgraphs[${subgraphName}].server.graphqlEndpoint`)

      const entitiesCopy = Object.create(null)
      if (entities) {
        validateObject(entities, `subgraphs[${subgraphName}].entities`)

        const entityNames = Object.keys(entities)

        for (let j = 0; j < entityNames.length; ++j) {
          const name = entityNames[j]
          const value = entities[name]

          validateObject(value, `subgraphs[${subgraphName}].entities.${name}`)

          const {
            pkey,
            fkeys = [],
            many = [],
            resolver
          } = value

          validateString(pkey, `subgraphs[${subgraphName}].entities.${name}.pkey`)
          validateArray(fkeys, `subgraphs[${subgraphName}].entities.${name}.fkeys`)
          validateArray(many, `subgraphs[${subgraphName}].entities.${name}.many`)

          for (let k = 0; k < fkeys.length; ++k) {
            const fkey = fkeys[k]
            for (const p of ['type']) {
              validateString(fkey[p], `subgraphs[${subgraphName}].entities.${name}.fkeys[${k}].${p}`)
            }
            for (const p of ['field', 'as', 'pkey']) {
              if (!fkey[p]) { continue }
              validateString(fkey[p], `subgraphs[${subgraphName}].entities.${name}.fkeys[${k}].${p}`)
            }
            if (fkey.resolver) {
              if (typeof fkey.resolver.argsAdapter === 'string') {
                fkey.resolver.argsAdapter = metaline(fkey.resolver.argsAdapter)
              }
              if (typeof fkey.resolver.partialResults === 'string') {
                fkey.resolver.partialResults = metaline(fkey.resolver.partialResults)
              }

              validateResolver(fkey.resolver, `subgraphs[${subgraphName}].entities.${name}.fkeys[${k}].resolver`)

              if (!fkey.resolver.argsAdapter) {
                fkey.resolver.argsAdapter = defaultArgsAdapter ?? createDefaultArgsAdapter(name, fkey.pkey)
              }
            }
          }

          for (let k = 0; k < many.length; ++k) {
            const m = many[k]
            for (const p of ['type', 'fkey', 'as', 'pkey']) {
              validateString(m[p], `subgraphs[${subgraphName}].entities.${name}.many[${k}].${p}`)
            }
            for (const p of ['subgraph']) {
              if (!m[p]) { continue }
              validateString(m[p], `subgraphs[${subgraphName}].entities.${name}.many[${k}].${p}`)
            }

            if (typeof m.resolver.argsAdapter === 'string') {
              m.resolver.argsAdapter = metaline(m.resolver.argsAdapter)
            }
            if (typeof m.resolver.partialResults === 'string') {
              m.resolver.partialResults = metaline(m.resolver.partialResults)
            }

            validateResolver(m.resolver, `subgraphs[${subgraphName}].entities.${name}.many[${k}].resolver`)
            if (!m.resolver.argsAdapter) {
              m.resolver.argsAdapter = defaultArgsAdapter ?? createDefaultArgsAdapter(name, m.pkey)
            }
          }

          if (resolver) {
            validateResolver(resolver, `subgraphs[${subgraphName}].entities.${name}.resolver`)
            if (typeof resolver.argsAdapter === 'string') {
              resolver.argsAdapter = metaline(resolver.argsAdapter)
            } else if (!resolver.argsAdapter) {
              resolver.argsAdapter = defaultArgsAdapter ?? createDefaultArgsAdapter(name, pkey)
            }
          }

          const entity = {
            resolver,
            pkey,
            fkeys,
            many
          }

          entitiesCopy[name] = entity

          this.addEntity(name, entity)
        }
      }

      // Make a copy of the input so that no tampering occurs at runtime. It
      // also protects against other things like weird getters.
      const subgraphCopy = {
        name: subgraphName,
        server: { host, composeEndpoint, graphqlEndpoint },
        entities: entitiesCopy
      }

      if (this.#subgraphsIndex[subgraphName]) {
        throw new TypeError(`subgraphs name ${subgraphName} is not unique`)
      }

      this.#subgraphsIndex[subgraphName] = subgraphCopy
      subgraphsCopy.push(subgraphCopy)
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

    if (this.addEntitiesResolvers) {
      await this.setupComposerSubgraph()
    }
  }

  /**
   * setup a dry service as composer node
   */
  async setupComposerSubgraph () {
    const { schema, resolvers, entities } = this.resolveEntities()

    // no entities to add, no need the composer subgraph
    if (!schema) { return }

    const instance = fastify()
    instance.register(mercurius, { schema, resolvers })
    instance.get('/i', (_, reply) => reply.graphql(getIntrospectionQuery()))
    await instance.ready()

    const subgraph = {
      name: '__composer__',
      server: {
        instance,
        graphqlEndpoint: '/graphql'
      },
      entities
    }
    this.#subgraphs.push(subgraph)

    const introspection = await instance.inject('/i')
    const subgraphSchema = JSON.parse(introspection.body).data

    this.mergeSchema(subgraphSchema, subgraph)
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
        const msg = `Could not process schema from '${subgraph.server.host}'`

        this.onSubgraphError(new Error(msg, { cause: responses[i].reason }), subgraph.name)
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

        if (this.#entities[typeName]) {
          this.#entities[typeName].subgraphs.push(subgraph)
        }

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
      const ctx = createContext({ fieldName })
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
        argsAdapter: null,
        types: this.#types,
        entities: this.#entities
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

      const ctx = createContext({ fieldName })
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
        argsAdapter: null,
        types: this.#types,
        entities: this.#entities
      })
      const text = query.buildQuery(ctx)
      topic = await client.createSubscription(text, {}, async (data) => {
        try {
          if (ctx.followups.size > 0) {
            // A new context is needed each time the subscription is triggered
            // and there are follow up queries.
            const newCtx = createContext({ followups: ctx.followups, result: data.payload })

            await this.#runFollowupQueries(newCtx, query)
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
    // TODO debug(' run subgraph query', query.subgraph.name, text)
    const data = await makeGraphqlRequest(text, query.subgraph.server)
    // TODO debug(' result', data)
    mergeResults(query, ctx.result, data)

    await this.#runFollowupQueries(ctx, query)
  }

  // TODO? traverse the graph in horizontal instead of vertical?
  // queries of same node could run in parallel
  async #runFollowupQueries (ctx, query) {
    // TODO(cjihrig): Need to query the primary owner first.
    for (const followup of ctx.followups.values()) {
      if (followup.solved) { continue }
      if (this.isFollowupSolved(followup, query)) {
        followup.solved = true
        continue
      }

      const followupQuery = new QueryBuilder(followup)
      followupQuery.operation = 'query'
      await this.#runQuery(ctx, followupQuery)
    }
  }

  /**
   * is followup already solved by the query
   * @param {QueryBuilder} followup
   * @param {QueryBuilder} query
   * @returns {boolean}
   */
  isFollowupSolved (followup, query) {
    return followup.fields.some(followupField => {
      return query.selectedFields.some(selectedField => {
        return selectedField === followupField.schemaNode.name
      })
    })
  }

  // TODO add fields and subgraph for each field
  // TODO handle different fields of entity by subgraph - an entity can be spread across different subgraphs
  addEntity (name, entity) {
    const e = this.#entities[name]

    const fkeys = entity.fkeys ?? []
    const many = entity.many ?? []
    const pkey = entity.pkey

    if (!e) {
      // TODO use Map on subgraphs
      this.#entities[name] = { pkey, fkeys, many, subgraphs: [] }
    } else {
      e.fkeys = e.fkeys.concat(fkeys)
      e.many = e.many.concat(many)
    }
  }

  /**
   * generate schema and resolvers to resolve subgraphs entities
   * from sugraphs schemas and entities configuration
   * TODO test: no entities, no "many", no "as"
   */
  resolveEntities () {
    const topSchema = []
    const topResolvers = { Query: {} }
    const topEntities = {}
    const topSchemaQueries = []
    const topQueriesResolvers = {}

    const entitiesKeys = Object.keys(this.#entities)
    if (entitiesKeys.length < 1) {
      return { schema: undefined, resolvers: undefined, entities: undefined }
    }

    for (const entityName of entitiesKeys) {
      topEntities[entityName] = {
        pkey: this.#entities[entityName].pkey,
        fkeys: new Map()
      }
    }

    for (const entityName of entitiesKeys) {
      const entity = this.#entities[entityName]
      const entitySchemaFields = {}
      const entityResolverFields = {}

      // pkey
      const type = schemaTypeName(this.#types, entityName, entity.pkey)
      // const pkey = { field: entity.pkey, type }
      entitySchemaFields[entity.pkey] = type

      // fkeys
      for (const fkey of entity.fkeys) {
        setEntityFKey(topEntities[entityName].fkeys, fkey)
        entitySchemaFields[fkey.as] = fkey.type

        // resolver will be replaced on query building
      }

      // many
      for (const many of entity.many) {
        entitySchemaFields[many.as] = `[${many.type}]`

        // resolver will be replaced on query building
      }

      const fields = Object.entries(entitySchemaFields)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
      topSchema.push(`type ${entityName} { ${fields} }`)
      topResolvers[entityName] = entityResolverFields
    }

    // clenup outcome

    if (topSchemaQueries.length > 0) {
      topSchema.push(`type Query {\n  ${topSchemaQueries.join('\n  ')}\n}`)
      topResolvers.Query = topQueriesResolvers
    } else {
      topSchema.push('type Query {\n  _composer: String \n}')
      topResolvers.Query = { _composer: function _composer () { return '_composer' } }
    }

    for (const name of Object.keys(topEntities)) {
      const entity = topEntities[name]
      entity.fkeys = Array.from(entity.fkeys.values())
      this.addEntity(name, entity)
    }

    return { schema: topSchema.join('\n\n'), resolvers: topResolvers, entities: topEntities }
  }
}

function mergeResults (query, partialResult, response) {
  let { result, mergedPartial, mergedPartialParentNode } = selectResult(query, partialResult, response)

  if (mergedPartial === null) {
    mergedPartialParentNode[query.path.at(-1)] = result
    mergedPartial = result
  } else if (Array.isArray(result) && result.length > 0) {
    // TODO refactor this case, too many loops, split functions, memoize if possible

    const key = query.key
    const parentKey = query.parentKey.field
    const as = query.parentKey.as
    const many = query.parentKey.many

    const resultIndex = new Map()

    // TODO get list from node result type?
    const list = Array.isArray(result[0][key])

    // TODO refactor as a matrix for every case
    if (list) {
      for (let i = 0; i < result.length; i++) {
        for (let j = 0; j < result[i][key].length; j++) {
          const s = resultIndex.get(result[i][key][j])
          if (s) {
            resultIndex.set(result[i][key][j], s.concat(i))
            continue
          }
          resultIndex.set(result[i][key][j], [i])
        }
      }
    } else if (many) {
      for (let i = 0; i < result.length; i++) {
        const s = resultIndex.get(result[i][key])
        if (s) {
          resultIndex.set(result[i][key], s.concat(i))
          continue
        }
        resultIndex.set(result[i][key], [i])
      }
    } else {
      for (let i = 0; i < result.length; i++) {
        resultIndex.set(result[i][key], i)
      }
    }

    for (let i = 0; i < mergedPartial.length; i++) {
      const merging = mergedPartial[i]
      if (!merging) { continue }

      // no need to be recursive
      if (Array.isArray(merging)) {
        if (list || many) {
          for (let j = 0; j < merging.length; j++) {
            copyResults(result, resultIndex, merging[j], parentKey, as)
          }
        } else {
          for (let j = 0; j < merging.length; j++) {
            copyResult(result, resultIndex, merging[j], parentKey, as)
          }
        }
        continue
      }

      if (list || many) {
        copyResults(result, resultIndex, merging, parentKey, as)
      } else {
        copyResult(result, resultIndex, merging, parentKey, as)
      }
    }
  } else if (isObject(result)) {
    // TODO copy object fn?
    const fields = Object.keys(result)
    for (let i = 0; i < fields.length; i++) {
      mergedPartial[fields[i]] = result[fields[i]]
    }
  } else {
    // no result
    mergedPartialParentNode[query.path.at(-1)] = result
  }
}

function createContext ({ fieldName, followups, result }) {
  return {
    path: [],
    followups: followups ? new Map(followups) : new Map(),
    result: result ?? { [fieldName]: null }
  }
}

function copyResult (result, resultIndex, to, key, as) {
  if (Array.isArray(to)) {
    for (const line of to) {
      copyResult(result, resultIndex, line, key, as)
    }
    return
  }

  const index = resultIndex.get(to[key])
  if (index === undefined) {
    // TODO if not nullable set it to an empty object
    return
  }
  if (as) {
    if (!to[as]) {
      to[as] = {}
    }
    to = to[as]
  }

  // TODO copy object fn?
  const fields = Object.keys(result[index])
  for (let i = 0; i < fields.length; i++) {
    to[fields[i]] = result[index][fields[i]]
  }
}

function copyResults (result, resultIndex, to, key, as) {
  let indexes

  if (Array.isArray(to)) {
    for (const line of to) {
      copyResults(result, resultIndex, line, key, as)
    }
    return
  }

  // TODO refactor?
  if (Array.isArray(to[key])) {
    indexes = to[key].map(k => resultIndex.get(k)).flat()
  } else {
    indexes = resultIndex.get(to[key])
  }

  if (indexes === undefined) {
    // TODO get if nullable from node result type
    if (as && !to[as]) {
      to[as] = []
    }

    return
  }
  if (as) {
    if (!to[as]) {
      to[as] = []
    }
    to = to[as]
  }

  for (let i = 0; i < indexes.length; i++) {
    // TODO copy object fn?
    const fields = Object.keys(result[indexes[i]])
    const r = {}
    for (let j = 0; j < fields.length; j++) {
      r[fields[j]] = result[indexes[i]][fields[j]]
    }
    to.push(r)
  }
}

function selectResult (query, partialResult, response) {
  let result = response[query.resolverName]
  let mergedPartial = partialResult
  let mergedPartialParentNode = null

  for (let i = 0; i < query.path.length; ++i) {
    const path = query.path[i]
    mergedPartialParentNode = mergedPartial
    mergedPartialParentNode[path] ??= null

    if (!mergedPartial && !mergedPartial[path]) { break }

    mergedPartial = traverseResult(mergedPartial, path)
  }

  if (!query.root) {
    if (Array.isArray(mergedPartial) && !Array.isArray(result)) {
      result = [result]
    } else if (!Array.isArray(mergedPartial) && Array.isArray(result) && result.length === 1) {
      result = result[0]
    }
  }

  if (Array.isArray(result)) {
    result = result.filter(r => !!r)
  }

  return { result, mergedPartial, mergedPartialParentNode }
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
    // TODO use Map on subgraphs
    subgraphs: new Set()
  })
}

function setEntityFKey (fkeys, fkey) {
  const index = `${fkey.type}.${fkey.field}`
  fkeys.set(index, fkey)
}

function onSubscriptionEnd (ctx, topic) {
  // Shut down the upstream connection.
  this.subscriptionMap.get(topic)?.()
  this.subscriptionMap.delete(topic)
}

function onError (error) { throw error }

module.exports = { Composer }
