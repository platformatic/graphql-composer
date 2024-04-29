'use strict'

const assert = require('node:assert')
const { test } = require('node:test')

const { compose } = require('../')
const { graphqlRequest, createGraphqlServices, introspectionHandler } = require('./helper')

const schema = 'type Query {\n  test: String\n}'

test('should pass headers when getting the schema from a subgraph service', async (t) => {
  const headers = { test: '123' }
  const requests = []
  const expectedResult = '123'

  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { schema },
      exposeIntrospection: {
        handler: async (req, reply) => {
          requests.push(req)
          return introspectionHandler.call(this, req, reply)
        }
      },
      listen: true
    }]
  )

  let errors = 0
  await compose({
    onSubgraphError: () => { errors++ },
    subgraphs: [{ server: { host: service.host } }]
  }, { headers })

  const [{ headers: { test }}]= requests

  assert.strictEqual(errors, 0)
  assert.strictEqual(test, expectedResult)
})

test('should pass headers when running a query on a subgraph', async (t) => {
  const headers = { test: '123' }
  const query = `
    query {
      test
    }
  `
  const expectedResult = '123'

  const [service] = await createGraphqlServices(t,
    [{
      mercurius: {
        schema,
        resolvers: {
          Query: {
            test: (_, __, { reply: { request: { headers: { test } } } }) => test
          }
        }
      },
      exposeIntrospection: false,
      listen: true
    }]
  )

  let errors = 0
  await compose({
    onSubgraphError: () => { errors++ },
    subgraphs: [{ server: { host: service.host } }]
  })

  const { test } = await graphqlRequest(service.service, query, undefined, headers)

  assert.strictEqual(errors, 0)
  assert.strictEqual(test, expectedResult)
})
