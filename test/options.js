'use strict'
const assert = require('node:assert')
const { test } = require('node:test')

const { compose } = require('../lib')
const { startGraphqlService, graphqlRequest, startRouter } = require('./helper')

test('should build a service using composer without subscriptions', async (t) => {
  let calls = 0

  const service = await startGraphqlService(t, {
    mercurius: {
      schema: `
    type Query {
      add(x: Int, y: Int): Int
    }`,
      resolvers: {
        Query: {
          async add (_, { x, y }) {
            calls++
            return x + y
          }
        }
      }
    }
  })
  const host = await service.listen()

  const composer = await compose({
    subgraphs: [{ server: { host } }]
  })

  const router = await startGraphqlService(t, {
    mercurius: {
      schema: composer.toSdl(),
      resolvers: composer.resolvers
    }
  })

  await router.listen({ port: 0 })

  const query = '{ add(x: 2, y: 2) }'
  const data = await graphqlRequest(router, query)
  assert.deepStrictEqual(data, { add: 4 })

  assert.strictEqual(calls, 1)
})

test('should get error when onSubgraphError is not a function', async (t) => {
  await assert.rejects(compose({
    subgraphs: [{ server: { host: 'http://graph1.local' } }],
    onSubgraphError: 1
  }), {
    name: 'TypeError',
    message: 'onSubgraphError must be a function'
  })
})

test('should use the defaultArgsAdapter provided in options', async (t) => {
  const query = '{ getReviewBook(id: 1) { title } }'
  const expectedResponse = { getReviewBook: { title: 'A Book About Things That Never Happened' } }

  let calls = 0
  const overrides = {
    defaultArgsAdapter: (partialResults) => {
      calls++
      return { ids: partialResults.map(r => r.id) }
    },
    subgraphs: {
      'books-subgraph': {
        entities: {
          Book: {
            referenceListResolverName: 'getBooksByIds',
            keys: [{ field: 'id', type: 'Book' }],
            argsAdapter: undefined
          }
        }
      }
    }
  }

  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'], overrides)

  const response = await graphqlRequest(router, query)

  assert.strictEqual(calls, 1)
  assert.deepStrictEqual(response, expectedResponse)
})

test('should use the generic argsAdapter if not provided', async (t) => {
  const query = '{ getReviewBook(id: 1) { title } }'
  const expectedResponse = { getReviewBook: { title: 'A Book About Things That Never Happened' } }

  const overrides = {
    subgraphs: {
      'books-subgraph': {
        entities: {
          Book: {
            referenceListResolverName: 'getBooksByIds',
            keys: [{ field: 'id', type: 'Book' }],
            argsAdapter: undefined
          }
        }
      }
    }
  }

  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'], overrides)

  const response = await graphqlRequest(router, query)

  assert.deepStrictEqual(response, expectedResponse)
})
