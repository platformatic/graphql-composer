'use strict'

const { buildClientSchema, printSchema } = require('graphql')
const { getIntrospectionQuery } = require('graphql')
const fastify = require('fastify')
const mercurius = require('mercurius')

const { fetchSubgraphSchema, makeGraphqlRequest } = require('./network')
const { validateComposerOptions } = require('./validation')
const { QUERY_TYPE, MUTATION_TYPE, mergeTypes, getMainType, createType, createField, createFieldId } = require('./fields')
const { buildQuery, queryParentResult } = require('./query-builder')
const { collectQueries } = require('./query-lookup')
const { unwrapFieldTypeName, objectDeepClone, pathJoin, schemaTypeName } = require('./utils')
const { mergeResult } = require('./result')
const { entityKeys } = require('./entity')
const { createDefaultHeadersAdapter } = require('./headers')

const COMPOSER_SUBGRAPH_NAME = '__composer__'

/**
 * @typedef {Object} ComposerField
 * @property {Object} src - graphql field definition
 * @property {string} typeName - field type name, for example "Author"
 * @property {Resolver} resolver
 */

/**
 * fields[typeName.fieldName][subgraphName] = { src, typeName, resolver }
 * @typedef {Object.<string, Object.<string, ComposerField>>} ComposerFields
 * @example fields['Book.id']['books-subgraph'] = { src, typeName, resolver }
 */

/**
 * @typedef {Object} ComposerType
 * @property {Object} src - graphql type definition
 * @property {Map<string, ComposerField>} fields - type field's, where the key is the field name
 * @property {Entity} entity
 */

/**
 * types[typeName][subgraphName] = { src, fields, entity }
 * @typedef {Object.<string, Object.<string, ComposerType>>} ComposerTypes
 * @example types['Book']['books-subgraph'] = { src, fields, entity }
 */

class Composer {
  constructor (options = {}) {
    this.mergedSchema = { _built: false }
    this.schemas = []
    this.mainTypes = new Set()
    this.resolvers = Object.create(null)

    const v = validateComposerOptions(options)

    this.logger = v.logger
    this.schemaOptions = {
      [QUERY_TYPE]: {
        schemaPropertyName: 'queryType',
        name: v.queryTypeName
      },
      [MUTATION_TYPE]: {
        schemaPropertyName: 'mutationType',
        name: v.mutationTypeName
      }
    }
    this.addEntitiesResolvers = v.addEntitiesResolvers
    this.onSubgraphError = v.onSubgraphError
    this.subgraphs = v.subgraphs
    this.defaultArgsAdapter = v.defaultArgsAdapter
    this.headersAdapter = createDefaultHeadersAdapter()

    if (this.addEntitiesResolvers) {
      this.entities = v.entities
    } else {
      this.entities = undefined
    }

    /** @type ComposerTypes */
    this.types = {}
    /** @type ComposerFields */
    this.fields = {}

    this.aliases = {}
  }

  toSchema () {
    const schema = {
      queryType: undefined,
      mutationType: undefined,
      types: [],
      // TODO support directives
      directives: []
    }

    for (const mainType of this.mainTypes.values()) {
      const s = this.schemaOptions[mainType]
      schema[s.schemaPropertyName] = { name: s.name }
    }

    for (const type of this.mergedSchema.types.values()) {
      schema.types.push(type.src)
    }

    return { __schema: schema }
  }

  toSdl () {
    return printSchema(buildClientSchema(this.toSchema()))
  }

  async compose (headers) {
    this.schemas = await this.fetchSubgraphSchemas(headers)

    for (let i = 0; i < this.schemas.length; ++i) {
      this.mergeSchema(this.schemas[i])
    }

    if (this.addEntitiesResolvers) {
      await this.setupComposerSubgraph()
    }

    this.buildMergedSchema()
  }

  // TODO return a copy to avoid writes on resolvers
  getResolvers () {
    return { ...this.resolvers }
  }

  // TODO memoize
  deferredSubgraph (fieldId) {
    const field = this.fields[fieldId]
    if (!field) {
      throw new Error('DEFERRED_SUBGRAPH_NO_FIELD')
    }

    // TODO can the field be resolved by multiple subgraphs?
    const subgraphNames = Object.keys(field)
    if (subgraphNames.length === 1) {
      return subgraphNames[0]
    }

    // ignore COMPOSER_SUBGRAPH_NAME because can't resolve fields
    return subgraphNames.filter(s => s !== COMPOSER_SUBGRAPH_NAME)[0]
  }

  buildMergedSchema () {
    this.mergedSchema = {
      types: new Map(),
      _built: false
    }

    const typeNames = Object.keys(this.types)
    // TODO handle different Query or Mutation type name between subgraphs
    for (let i = 0; i < typeNames.length; ++i) {
      const typeName = typeNames[i]

      const subgraphNames = Object.keys(this.types[typeName])
      for (let j = 0; j < subgraphNames.length; ++j) {
        const subgraphName = subgraphNames[j]

        const type = this.types[typeName][subgraphName]

        const t = this.mergedSchema.types.get(typeName)

        // TODO handle conflicts by name or type, add option to rename, mask or hide
        this.mergedSchema.types.set(typeName, t ? mergeTypes(t, type) : objectDeepClone(type))
      }
    }

    this.mergedSchema._built = true
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

    const subgraphName = COMPOSER_SUBGRAPH_NAME

    // set entities both in composer and each subgraph
    const subgraph = {
      name: subgraphName,
      server: {
        instance,
        graphqlEndpoint: '/graphql'
      },
      entities: new Map(Object.entries(entities))
    }
    this.subgraphs.set(subgraphName, subgraph)

    // collect all the alias
    // ! aliases works only in options.entities with "addEntitiesResolvers"
    for (const entityName of Object.keys(this.entities)) {
      const entity = this.entities[entityName]

      // fill entities in composer
      this.setEntity(entityName, entity.subgraph, entity)
      this.types[entityName][entity.subgraph].entity = entity

      if (entity.fkeys) {
        for (const fkey of entity.fkeys) {
          if (!fkey.as) { continue }
          const fieldId = createFieldId(entityName, fkey.as)
          this.setAlias(fieldId, subgraphName, { ...fkey, parentType: entityName, entity, mode: 'fkey' })
        }
      }

      if (entity.many) {
        for (const many of entity.many) {
          if (!many.as) { continue }
          const fieldId = createFieldId(entityName, many.as)
          this.setAlias(fieldId, subgraphName, { ...many, parentType: entityName, entity, mode: 'many' })
        }
      }
    }

    const introspection = await instance.inject('/i')
    const subgraphSchema = JSON.parse(introspection.body).data
    subgraphSchema.subgraphName = subgraphName

    this.mergeSchema(subgraphSchema)

    // add aliases in fields and types
    for (const fieldId of Object.keys(this.aliases)) {
      const alias = this.aliases[fieldId][subgraphName]
      const t = this.types[alias.parentType][alias.entity.subgraph]
      const field = this.fields[fieldId][subgraphName].src
      const f = this.addField(alias.parentType, field, alias.subgraph, t, alias.resolver)
      t.fields.set(alias.as, f)
      f.type = this.types[f.typeName][subgraphName]
    }
  }

  async fetchSubgraphSchemas (headers) {
    const subgraphs = Array.from(this.subgraphs.values())

    const requests = subgraphs.map((subgraph) => {
      return fetchSubgraphSchema(subgraph.server, headers)
    })

    const responses = await Promise.allSettled(requests)
    const schemas = []

    for (let i = 0; i < responses.length; ++i) {
      const { status, value: introspection } = responses[i]
      const subgraph = subgraphs[i]

      if (status !== 'fulfilled') {
        const msg = `Could not process schema for subgraph '${subgraph.name}' from '${subgraph.server.host}'`

        this.onSubgraphError(new Error(msg, { cause: responses[i].reason }), subgraph.name)
        continue
      }

      introspection.subgraphName = subgraph.name
      schemas.push(introspection)
    }

    return schemas
  }

  // TODO test subgraph with different Query or Mutation names
  mergeSchema ({ __schema: schema, subgraphName }) {
    if (!schema) {
      return
    }

    for (let i = 0; i < schema.types.length; ++i) {
      const schemaType = schema.types[i]
      const typeName = schemaType.name

      // Ignore built in types
      if (typeName.startsWith('__')) {
        continue
      }

      // Query or Mutation
      const mainType = getMainType(schema, schemaType)
      if (mainType) {
        this.mainTypes.add(mainType)
      }

      if (!Array.isArray(schemaType.fields)) {
        this.addType(typeName, subgraphName, schemaType)
        continue
      }

      const entity = this.getEntity(typeName, subgraphName)
      const type = this.addType(typeName, subgraphName, schemaType, entity)
      type.fields = new Map()
      for (let i = 0; i < schemaType.fields.length; ++i) {
        const field = schemaType.fields[i]
        let resolver

        if (mainType) {
          resolver = this.createResolver({
            typeName,
            subgraphName,
            fieldSrc: field
          })

          this.resolvers[typeName] ??= Object.create(null)
          this.resolvers[typeName][field.name] = resolver
        }

        // TODO alias for conflicting types, for example
        // subgraph#1: type Pizza { id: ID }
        // subgraph#2: type Pizza { id: Int! }
        // options: { ... subgraph#1: { entities: { Pizza: { id: { as: 'optionalId' ...
        // result: type Pizza { optionalId: ID (from subgraph#1), id: Int! (from subgraph#2) }

        // TODO option to hide fields
        // note: type may not be available at this point, only typeName

        const f = this.addField(typeName, field, subgraphName, type, resolver)
        type.fields.set(field.name, f)
      }
    }

    // fill types in fields by typename
    for (const fieldId of Object.keys(this.fields)) {
      for (const subgraphName of Object.keys(this.fields[fieldId])) {
        const f = this.fields[fieldId][subgraphName]
        f.type = this.types[f.typeName][subgraphName]
      }
    }
  }

  addType (typeName, subgraphName, type, entity) {
    if (this.types[typeName] && this.types[typeName][subgraphName]) {
      return this.types[typeName][subgraphName]
    }

    const t = createType({ name: typeName, src: type, entity })
    if (!this.types[typeName]) {
      this.types[typeName] = { [subgraphName]: t }
      return t
    }

    this.types[typeName][subgraphName] = t
    return t
  }

  addField (parentTypeName, field, subgraphName, parent, resolver) {
    const fieldId = createFieldId(parentTypeName, field.name)

    if (this.fields[fieldId] && this.fields[fieldId][subgraphName]) {
      this.logger.warn('TODO field already exists on subgraph')
      return
    }

    const typeName = unwrapFieldTypeName(field)
    const f = createField({ name: field.name, typeName, src: field, parent, resolver })
    if (!this.fields[fieldId]) {
      this.fields[fieldId] = { [subgraphName]: f }
      return f
    }

    this.fields[fieldId][subgraphName] = f
    return f
  }

  setEntity (typeName, subgraphName, entity) {
    const subgraph = this.subgraphs.get(subgraphName)
    if (subgraph) {
      subgraph.entities.set(typeName, entity)
    }
  }

  getEntity (typeName, subgraphName) {
    const subgraph = this.subgraphs.get(subgraphName)
    if (subgraph) {
      return subgraph.entities.get(typeName)
    }
  }

  /**
   * get existing types on subgraph
   */
  getTypes (subgraphName) {
    // TODO memoize
    const types = {}
    const typeNames = Object.keys(this.types)
    for (let i = 0; i < typeNames.length; ++i) {
      const typeName = typeNames[i]

      const subgraphNames = Object.keys(this.types[typeName])
      for (let j = 0; j < subgraphNames.length; ++j) {
        const s = subgraphNames[j]
        if (s !== subgraphName) { continue }

        types[typeName] = this.types[typeName][s]
      }
    }
    return types
  }

  /**
   * get existing types on subgraph
   */
  getFields (subgraphName) {
    // TODO memoize
    const fields = {}
    const fieldIds = Object.keys(this.fields)
    for (let i = 0; i < fieldIds.length; ++i) {
      const fieldName = fieldIds[i]

      const subgraphNames = Object.keys(this.fields[fieldName])
      for (let j = 0; j < subgraphNames.length; ++j) {
        const s = subgraphNames[j]
        if (s !== subgraphName) { continue }

        fields[fieldName] = this.fields[fieldName][s]
      }
    }
    return fields
  }

  // an alias must:
  // - exists in gql schema/s
  // - have a resolver
  // alias key: Type.field#sourceSubgraph where sourceSubgraph is the subgraph where it will be resolved/replaced
  // note! alias.subgraph is the subgraph for the resolver, see that as alias[subgraphSource].subgraphTarget
  setAlias (fieldId, subgraphName, alias) {
    if (!this.aliases[fieldId]) {
      this.aliases[fieldId] = { [subgraphName]: alias }
      return
    }
    this.aliases[fieldId][subgraphName] = alias
  }

  // TODO memoize
  // subgraphName is the subgraph that resolves the alias
  getAlias (fieldId, subgraphName) {
    const alias = this.aliases[fieldId]
    if (!alias) { return }
    return Object.values(alias).find(a => a.subgraph === subgraphName)
  }

  createResolver ({ typeName, subgraphName, fieldSrc }) {
    return async (parent, args, context, info) => {
      return this.runResolver({ typeName, subgraphName, fieldSrc, parent, args, context, info })
    }
  }

  async runResolver ({ typeName, subgraphName, fieldSrc, parent, args, context, info }) {
    const { queries, order } = this.collectQueries({
      typeName,
      subgraphName,
      fieldSrc,
      parent,
      args,
      context,
      info
    })

    const result = await this.runQueries(queries, order, this.headersAdapter(context.reply.request.headers))
    return result[fieldSrc.name]
  }

  /**
   * collect queries starting from the resolver fn
   */
  collectQueries ({
    // resolver generator
    typeName, subgraphName, fieldSrc,
    // resolver args
    parent, args, context, info
  }) {
    const types = this.getTypes(subgraphName)
    const fields = this.getFields(subgraphName)

    const queries = new Map()
    const order = new Set()
    for (const queryFieldNode of info.fieldNodes) {
      const fieldId = createFieldId(info.parentType.name, queryFieldNode.name.value)
      // TODO createContext fn
      const context = {
        info,
        done: [],
        logger: this.logger
      }
      const q = collectQueries({
        subgraphName,
        queryFieldNode,
        fieldId,
        args,
        types,
        fields,
        aliases: this.aliases,
        root: true,
        context
      })
      this.buildQueries(q, queries, order, context)
    }

    return { queries, order }
  }

  // TODO add resolution strategy here
  // - traverse horizontally, collect by subgraph/parent resolution
  buildQueries (collectedQueries, queries, order, context) {
    for (const deferred of collectedQueries.deferreds.values()) {
      // in case of alias on deferred subgraph is not possible to get the field on lookup stage
      if (!deferred.queryNode.field) {
        deferred.queryNode.field = deferred.queryNode.parent.field
        const field = Object.values(this.fields[deferred.queryNode.fieldId])[0]
        deferred.keys = entityKeys({ field, entity: field.typeName })
      } else {
        deferred.keys = entityKeys({ field: deferred.queryNode.field, entity: deferred.queryNode.field.typeName })
      }

      const deferredQueriesBatch = this.buildDeferredQueries(deferred, context)
      for (const deferredQueries of deferredQueriesBatch) {
        this.buildQueries(deferredQueries, queries, order, context)
      }
    }

    // fill queries info
    for (let [path, query] of collectedQueries.queries) {
      const currentQuery = queries.get(path)
      if (currentQuery) {
        query = mergeQueries(currentQuery, query)
      }

      // TODO calculate if entity keys are needed: keys are not needed when there are no deferred queries depending on quering entity
      // TODO add entities data here: node, parent, as, resolver...
      query.query.selection.push(
        ...entityKeys({ field: query.field, subgraph: query.subgraphName }).map(key => ({ key })))

      // append deferred queries
      queries.set(path, query)
      order.add(path)
    }
  }

  buildDeferredQueries (deferred, context) {
    this.logger.debug(' > composer.buildDeferredQueries')

    const queries = []
    const subgraphs = {}
    // group deferred fields by fields parent, and indirectly by subgraph
    for (const { fieldName } of deferred.fields) {
      const fieldId = createFieldId(deferred.queryNode.field.typeName, fieldName)
      const subgraphName = this.deferredSubgraph(fieldId)
      // TODO throw if no subgraph

      const alias = this.getAlias(fieldId, subgraphName)
      if (alias) {
        this.addDeferredSubgraph(subgraphs, alias.subgraph, alias.type, deferred.keys, deferred.queryNode)
      } else {
        this.addDeferredSubgraph(subgraphs, subgraphName, deferred.queryNode.field.typeName, deferred.keys, deferred.queryNode)
        subgraphs[subgraphName].fields.push({ fieldName })
      }
    }

    for (const subgraphName of Object.keys(subgraphs)) {
      const d = subgraphs[subgraphName]
      const types = this.getTypes(subgraphName)
      const fields = this.getFields(subgraphName)
      const selection = d.fields.map(f => f.fieldName)

      const fieldId = 'Query.' + d.resolver.name

      // collectQueries on deferred subgraph
      const q = collectQueries({
        subgraphName,
        parent: deferred.queryNode,
        queryFieldNode: deferred.queryNode.queryFieldNode,
        path: deferred.queryNode.path,
        fieldId,
        selection: selection.length > 0 ? selection : null,
        types,
        fields,
        aliases: this.aliases,
        context,
        // args?
        resolver: d.resolver
      })

      for (const query of q.queries.values()) {
        query.query.selection.push({ field: d.entity.pkey })
      }

      queries.push(q)
    }

    return queries
  }

  addDeferredSubgraph (subgraphs, subgraphName, typeName, keys, queryNode) {
    if (subgraphs[subgraphName]) { return }

    const entity = this.getEntity(typeName, subgraphName)
    if (!entity) {
      this.logger.error({ entityName: typeName, subgraphName }, 'missing entity, unable to compute deferred query')
      throw new Error('UNABLE_BUILD_DEFERRED_QUERY_MISSING_ENTITY')
    }

    const resolver = deferredResolver(entity, keys, subgraphName)
    subgraphs[subgraphName] = { fields: [], resolver, entity, queryNode }
  }

  /**
   * run queries to fullfil a request
   *
   * TODO setup queries plan here
   * TODO collect queries by: subgraph, non-dependent, fields, keys for entities involved
   * TODO run parallel / same subgraph when possible
   * @param {Map<String, QueryNode>} queries map (path, queryNode)
   * @param {Set<String>} order paths
   * @param {import('undici').Dispatcher.DispatchOptions['headers']} headers headers
   * @returns {*} merged result
   */
  async runQueries (queries, order, headers) {
    const result = {}

    // ! Set need to be reversed from inserting order
    order = Array.from(order).reverse()

    for (const p of order) {
      const q = queries.get(p)
      const path = p.split('#')[0]
      const parentResult = this.getParentResult(q, path)

      const { query, fieldName, keys } = buildQuery(q.query, parentResult)
      // TODO query can have variables
      this.logger.debug({ subgraph: q.subgraphName, path, query, headers }, 'run subgraph query')

      const data = await makeGraphqlRequest(query, this.subgraphs.get(q.subgraphName).server, headers)

      this.logger.debug({ path, query, data }, 'query result')

      q.result = data[fieldName]
      q.keys = keys

      mergeResult(result, path, q, parentResult)
    }

    return result
  }

  /**
   * collect parent info by result to build query and merge the result
   */
  getParentResult (queryNode, path) {
    const q = queryParentResult(queryNode)
    const result = {
      path: [],
      data: undefined,
      keys: {
        self: queryNode.field.type.entity?.pkey,
        parent: undefined
      }
    }

    if (!q) {
      return result
    }

    result.data = q.result

    // keys here are from "buildQuery"
    if (q.keys.length > 0) {
      const queryParentKey = parentKey(q.keys, path, queryNode.field.typeName)
      if (queryParentKey) {
        result.path = pathJoin(queryParentKey.path, queryParentKey.key).split('.')
        result.keys.parent = result.path.at(-1)

        if (queryParentKey.as) {
          result.as = queryParentKey.as
          result.many = queryParentKey.many
        }
      }
    }

    if (!result.keys.parent) {
      result.keys.parent = q.field.type.entity?.pkey
      result.path = [pathJoin(path, result.keys.parent)]
    }

    return result
  }

  /**
   * generate schema and resolvers to resolve subgraphs entities
   * from sugraphs schemas and entities configuration
   */
  resolveEntities () {
    const topSchema = []
    const topResolvers = { Query: {} }
    const topEntities = new Map()
    const topSchemaQueries = []
    const topQueriesResolvers = {}

    const entityNames = Object.keys(this.entities)

    if (entityNames.length < 1) {
      return { schema: undefined, resolvers: undefined, entities: undefined }
    }

    for (const entityName of entityNames) {
      const entity = this.entities[entityName]

      const e = {
        subgraph: entity.subgraph,
        resolver: entity.resolver,
        pkey: entity.pkey,
        fkeys: new Map(),
        many: new Map()
      }

      const entitySchemaFields = {}
      const entityResolverFields = {}

      // pkey
      const type = schemaTypeName(this.types, entity.subgraph, entityName, entity.pkey)
      entitySchemaFields[entity.pkey] = type

      // fkeys
      if (entity.fkeys) {
        for (const fkey of entity.fkeys) {
          setEntityFKey(e.fkeys, fkey)
          entitySchemaFields[fkey.as] = fkey.type
        }
      }

      // many
      if (entity.many) {
        for (const many of entity.many) {
          setEntityMany(e.many, many)
          entitySchemaFields[many.as] = `[${many.type}]`
        }
      }
      const fields = Object.entries(entitySchemaFields)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')

      topEntities.set(entityName, e)
      topSchema.push(`type ${entityName} { ${fields} }`)
      topResolvers[entityName] = entityResolverFields
    }

    // cleanup outcome

    for (const entity of topEntities.values()) {
      entity.fkeys = Array.from(entity.fkeys.values())
      entity.many = Array.from(entity.many.values())
    }

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
      entity.many = Array.from(entity.many.values())
    }

    return {
      schema: topSchema.join('\n\n'),
      resolvers: topResolvers,
      entities: Object.fromEntries(topEntities)
    }
  }
}

// TODO improve code logic, add unit tests
// key should be selected by parent type, as it is for parent/many
function parentKey (keys, path, type) {
  let pkey
  const fkeys = []

  for (const k of keys) {
    // ok-ish
    if (k.pkey) {
      pkey = k.pkey
      continue
    }

    if (path.indexOf(k.resolverPath) !== 0) { continue }

    // ok
    if (k.parent && type === k.typeName) {
      if (k.parent.many) {
        return {
          as: k.many.as,
          many: k.many,
          key: k.many.fkey,
          path: pathJoin(k.resolverPath, k.many.as)
        }
      }
    }

    // TODO improve
    if (k.fkey) {
      fkeys.push(k)
    }
  }

  // TODO should be removed and fkey should be returned in the loop above as soon as the fkey is been detected
  if (fkeys.length > 0) {
    const k = fkeys[0]
    return { key: k.fkey.field ?? k.fkey.pkey, path: k.resolverPath }
  }

  if (pkey) { return { key: pkey, path } }
}

function deferredResolver (entity, deferredKeys, subgraphName) {
  if (!deferredKeys || deferredKeys.length < 1) {
    return entity.resolver
  }

  for (const key of deferredKeys) {
    if (key.fkey && key.fkey.subgraph === subgraphName) {
      return key.fkey.resolver
    }
    if (key.parent && key.parent.fkey && key.parent.fkey.subgraph === subgraphName) {
      return key.parent.fkey.resolver
    }
    if (key.parent && key.parent.many && key.parent.many.subgraph === subgraphName) {
      return key.parent.many.resolver
    }
  }

  return entity.resolver
}

// TODO merge more query parts, for example args values
function mergeQueries (currentQuery, query) {
  // no worries, fields will be filtered later on building
  currentQuery.query.selection = currentQuery.query.selection.concat(query.query.selection)
  return currentQuery
}

function setEntityFKey (fkeys, fkey) {
  const index = `${fkey.type}.${fkey.field}`
  fkeys.set(index, fkey)
}

function setEntityMany (manys, many) {
  const index = `${many.type}.${many.field || many.pkey}`
  manys.set(index, many)
}

module.exports = { Composer }
