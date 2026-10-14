'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { test } = require('node:test')

const { compose } = require('../')
const { createComposerService, createGraphqlServices, graphqlRequest } = require('./helper')

const gql = {
  schema: 'type Query {\n  add(x: Int, y: Int): Int\n}',
  resolvers: { Query: { add: (_, { x, y }) => x + y } }
}

async function createTrackedGraphqlService (t, { schema, resolvers }) {
  const requests = []
  const [subgraph] = await createGraphqlServices(t, [{
    mercurius: { schema, resolvers },
    exposeIntrospection: {}
  }])
  subgraph.service.addHook('onRequest', async (request) => {
    requests.push(request.url)
  })
  subgraph.service.addHook('preHandler', async (request) => {
    if (request.body?.query?.includes('__schema')) {
      requests.push('introspection')
    }
  })
  subgraph.host = await subgraph.service.listen()

  return { ...subgraph, requests }
}

test('should compose a subgraph from sdl without fetching its schema', async (t) => {
  const subgraph = await createTrackedGraphqlService(t, gql)

  let errors = 0
  const options = {
    onSubgraphError: () => { errors++ },
    subgraphs: [{
      name: 'math',
      server: { host: subgraph.host },
      sdl: gql.schema
    }]
  }
  const { composer, service } = await createComposerService(t, { compose, options })

  assert.strictEqual(errors, 0)
  assert.strictEqual(composer.toSdl(), gql.schema)
  assert.deepStrictEqual(subgraph.requests, [])

  const result = await graphqlRequest(service, '{ add(x: 2, y: 3) }')
  assert.deepStrictEqual(result, { add: 5 })
  assert.deepStrictEqual(subgraph.requests, ['/graphql'])
})

test('should send the queries of a subgraph from sdl to its graphqlEndpoint', async (t) => {
  const [subgraph] = await createGraphqlServices(t, [{
    mercurius: { ...gql, path: '/custom-graphql' },
    listen: true
  }])

  const options = {
    subgraphs: [{
      server: { host: subgraph.host, graphqlEndpoint: '/custom-graphql' },
      sdl: gql.schema
    }]
  }
  const { service } = await createComposerService(t, { compose, options })

  const result = await graphqlRequest(service, '{ add(x: 4, y: 5) }')
  assert.deepStrictEqual(result, { add: 9 })
})

test('should compose the same supergraph from sdl as from the subgraph server', async (t) => {
  const books = require('./fixtures/books')
  const reviews = require('./fixtures/reviews')

  const services = await createGraphqlServices(t, [
    { name: 'books-subgraph', file: path.join(__dirname, 'fixtures/books.js'), listen: true },
    { name: 'reviews-subgraph', file: path.join(__dirname, 'fixtures/reviews.js'), listen: true }
  ])

  const fetched = await compose({
    subgraphs: services.map(service => ({
      name: service.name,
      entities: service.config.entities,
      server: { host: service.host }
    }))
  })

  const fromSdl = await compose({
    subgraphs: [
      { name: 'books-subgraph', entities: books.entities, server: { host: services[0].host }, sdl: books.schema },
      { name: 'reviews-subgraph', entities: reviews.entities, server: { host: services[1].host }, sdl: reviews.schema }
    ]
  })

  assert.strictEqual(fromSdl.toSdl(), fetched.toSdl())
})

test('should compose a subgraph from sdl while the subgraph server is down, and fail only the queries sent to it', async (t) => {
  const subgraph = await createTrackedGraphqlService(t, gql)
  await subgraph.service.close()

  let errors = 0
  const options = {
    onSubgraphError: () => { errors++ },
    subgraphs: [{
      name: 'math',
      server: { host: subgraph.host },
      sdl: gql.schema
    }]
  }
  const { composer, service } = await createComposerService(t, { compose, options })

  assert.strictEqual(errors, 0)
  assert.strictEqual(composer.toSdl(), gql.schema)

  await assert.rejects(graphqlRequest(service, '{ add(x: 2, y: 3) }'), (errors) => {
    assert.match(errors[0].message, /ECONNREFUSED/)
    return true
  })
})

test('should compose a subgraph from sdl and a subgraph from its server, with entities across them', async (t) => {
  const reviews = require('./fixtures/reviews')

  const services = await createGraphqlServices(t, [
    { name: 'books-subgraph', file: path.join(__dirname, 'fixtures/books.js'), listen: true },
    { name: 'reviews-subgraph', file: path.join(__dirname, 'fixtures/reviews.js') }
  ])

  const requests = []
  services[1].service.addHook('preHandler', async (request) => {
    requests.push(request.body?.query?.includes('__schema') ? 'introspection' : request.url)
  })
  services[1].host = await services[1].service.listen()

  const options = {
    subgraphs: [
      {
        name: 'books-subgraph',
        entities: services[0].config.entities,
        server: { host: services[0].host }
      },
      {
        name: 'reviews-subgraph',
        entities: services[1].config.entities,
        server: { host: services[1].host },
        sdl: reviews.schema
      }
    ]
  }
  const { service } = await createComposerService(t, { compose, options })

  const result = await graphqlRequest(service, '{ getBook(id: 1) { id, title, genre, rate } }')
  assert.deepStrictEqual(result, {
    getBook: {
      id: '1',
      title: 'A Book About Things That Never Happened',
      genre: 'FICTION',
      rate: 3
    }
  })
  // the reviews subgraph only received the query, neither the compose request nor the introspection query
  assert.ok(requests.length > 0)
  assert.ok(requests.every(request => request === '/graphql'))
})

test('should not probe the composeEndpoint of a subgraph from sdl', async (t) => {
  let composeEndpointHits = 0
  const [subgraph] = await createGraphqlServices(t, [{
    mercurius: { ...gql },
    exposeIntrospection: {},
    onComposeEndpointHit: () => { composeEndpointHits++ },
    listen: true
  }])

  const composeEndpointMissCache = new Map()
  await compose({
    composeEndpointMissCache,
    subgraphs: [{ server: { host: subgraph.host, composeEndpoint: '/.well-known/graphql-composition' }, sdl: gql.schema }]
  })

  assert.strictEqual(composeEndpointHits, 0)
  assert.strictEqual(composeEndpointMissCache.size, 0)
})

test('should call onSubgraphError on invalid sdl', async (t) => {
  let errors = 0
  const composer = await compose({
    onSubgraphError: (error, subgraphName) => {
      assert.strictEqual(subgraphName, 'math')
      assert.strictEqual(error.message, "Could not process schema for subgraph 'math' from the provided SDL")
      assert.match(error.cause.message, /Syntax Error/)
      errors++
    },
    subgraphs: [{
      name: 'math',
      server: { host: 'http://unreachable.local' },
      sdl: 'type Query { add(x: Int, y: Int): Int'
    }]
  })

  assert.strictEqual(errors, 1)
  assert.strictEqual(composer.schemas.length, 0)
})

test('should call onSubgraphError on sdl that is not a valid schema', async (t) => {
  let errors = 0
  await compose({
    onSubgraphError: (error) => {
      assert.strictEqual(error.message, "Could not process schema for subgraph '#0' from the provided SDL")
      assert.match(error.cause.message, /Unknown type "Missing"/)
      errors++
    },
    subgraphs: [{
      server: { host: 'http://unreachable.local' },
      sdl: 'type Query { missing: Missing }'
    }]
  })

  assert.strictEqual(errors, 1)
})

test('should throw on invalid sdl by default', async (t) => {
  await assert.rejects(compose({
    subgraphs: [{
      server: { host: 'http://unreachable.local' },
      sdl: ''
    }]
  }), (error) => {
    assert.strictEqual(error.message, "Could not process schema for subgraph '#0' from the provided SDL")
    assert.match(error.cause.message, /Syntax Error/)
    return true
  })
})

test('should throw if sdl is not a string', async (t) => {
  await assert.rejects(compose({
    subgraphs: [{
      name: 'math',
      server: { host: 'http://unreachable.local' },
      sdl: { kind: 'Document' }
    }]
  }), new TypeError('subgraphs[math].sdl must be a string'))
})
