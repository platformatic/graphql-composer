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
const { schemaTypeName, createDefaultArgsAdapter, dummyLogger } = require('./utils')
const {
  validateArray,
  validateFunction,
  validateObject,
  validateString,
  validateResolver
} = require('./validation')
const { mergeResults } = require('./results')

class Composer {
  constructor (options = {}) {
    const v = validateOptions(options)

    this.queryTypeName = v.queryTypeName
    this.mutationTypeName = v.mutationTypeName
    this.subscriptionTypeName = v.subscriptionTypeName
    this.subgraphs = v.subgraphs
    this.subgraphsIndex = v.subgraphsIndex
    this.pubsub = v.pubsub
    this.types = v.types
    this.directives = v.directives
    this.entities = v.entities
    this.logger = v.logger
  }

  toSchema () {
    const types = []
    const directives = Array.from(this.directives.values())
    let queryType = null
    let mutationType = null
    let subscriptionType = null

    if (this.types.has(this.queryTypeName)) {
      queryType = { name: this.queryTypeName }
    }

    if (this.types.has(this.mutationTypeName)) {
      mutationType = { name: this.mutationTypeName }
    }

    if (this.types.has(this.subscriptionTypeName)) {
      subscriptionType = { name: this.subscriptionTypeName }
    }

    for (const value of this.types.values()) {
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
    const schemas = await this.fetchSubgraphSchemas()

    for (let i = 0; i < schemas.length; ++i) {
      this.mergeSchema(schemas[i], this.subgraphs[i])
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
    this.subgraphs.push(subgraph)

    const introspection = await instance.inject('/i')
    const subgraphSchema = JSON.parse(introspection.body).data

    this.mergeSchema(subgraphSchema, subgraph)
  }

  async fetchSubgraphSchemas () {
    const requests = this.subgraphs.map((subgraph) => {
      return fetchSubgraphSchema(subgraph.server)
    })
    const responses = await Promise.allSettled(requests)
    const schemas = []

    for (let i = 0; i < responses.length; ++i) {
      const { status, value: introspection } = responses[i]

      if (status !== 'fulfilled') {
        const subgraph = this.subgraphs[i]
        const msg = `Could not process schema from '${subgraph.server.host}'`

        this.onSubgraphError(new Error(msg, { cause: responses[i].reason }), subgraph.name)
        continue
      }

      schemas.push(introspection)
    }

    return schemas
  }

  mergeSchema ({ __schema: schema }, subgraph) {
    // type: fields, resolver?, subgraph
    // link: resolver 
  }

  createResolver ({ type, field, fieldName, subgraph }) {
    return async (parent, args, contextValue, info) => {
      // runResolver: subgraph, type, fields, 
      // parent { data, type, node }
    }
  }

  /**
   * generate schema and resolvers to resolve subgraphs entities
   * from sugraphs schemas and entities configuration
   */
  resolveEntities () {
    const topSchema = []
    const topResolvers = { Query: {} }
    const topEntities = {}
    const topSchemaQueries = []
    const topQueriesResolvers = {}

    const entitiesKeys = Object.keys(this.entities)
    if (entitiesKeys.length < 1) {
      return { schema: undefined, resolvers: undefined, entities: undefined }
    }

    for (const entityName of entitiesKeys) {
      topEntities[entityName] = {
        pkey: this.entities[entityName].pkey,
        fkeys: new Map()
      }
    }

    for (const entityName of entitiesKeys) {
      const entity = this.entities[entityName]
      const entitySchemaFields = {}
      const entityResolverFields = {}

      // pkey
      const type = schemaTypeName(this.types, entityName, entity.pkey)
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

    // cleanup outcome

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

function onError (error) { throw error }

module.exports = { Composer }
