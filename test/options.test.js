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
            pkey: 'id',
            resolver: {
              name: 'getBooksByIds',
              argsAdapter: undefined
            }
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
            pkey: 'id',
            resolver: {
              name: 'getBooksByIds',
              argsAdapter: undefined
            }
          }
        }
      }
    }
  }

  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'], overrides)

  const response = await graphqlRequest(router, query)

  assert.deepStrictEqual(response, expectedResponse)
})

const cases = [
  {
    name: 'should get error when options is not an object',
    config: 'na',
    expect: {
      name: 'TypeError',
      message: 'options must be an object'
    }
  },
  {
    name: 'should get error when queryTypeName is not a string',
    config: { queryTypeName: -1 },
    expect: {
      name: 'TypeError',
      message: 'queryTypeName must be a string'
    }
  },
  {
    name: 'should get error when subgraphs is not an array',
    config: { subgraphs: 'not-an-array' },
    expect: {
      name: 'TypeError',
      message: 'subgraphs must be an array'
    }
  },
  {
    name: 'should get error when onSubgraphError is not a function',
    config: {
      subgraphs: [{ server: { host: 'http://graph1.local' } }],
      onSubgraphError: 1
    },
    expect: {
      name: 'TypeError',
      message: 'onSubgraphError must be a function'
    }
  },
  {
    name: 'should get error when subgraph entities is not an object',
    config: {
      subgraphs: [
        { server: { host: 'http://graph2.local' }, entities: 'not-an-object' }
      ]
    },
    expect: {
      name: 'TypeError',
      message: 'subgraphs[#0].entities must be an object'
    }
  },
  {
    name: 'should get error when subgraphs names are not unique',
    config: {
      subgraphs: [
        { name: 'dogs', server: { host: 'http://graph1.local' } },
        { name: 'dogs', server: { host: 'http://graph2.local' } }
      ]
    },
    expect: {
      name: 'TypeError',
      message: 'subgraphs name dogs is not unique'
    }
  }
]

for (const c of cases) {
  test(c.name, async t => {
    await assert.rejects(compose(c.config), c.expect)
  })
}
