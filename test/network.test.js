'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const { NoSchemaIntrospectionCustomRule } = require('graphql')

const { compose } = require('../')
const { createGraphqlServices } = require('./helper')
const { makeGraphqlRequest } = require('../lib/network')

const gql = {
  schema: 'type Query {\n  add(x: Int, y: Int): Int\n}',
  resolvers: { Query: { add: (_, { x, y }) => x + y } }
}

test('should get the schema from a subgraph service from a custom composeEndpoint', async (t) => {
  const expectedSdl = gql.schema

  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql },
      exposeIntrospection: { path: '/get-introspection' },
      listen: true
    }]
  )

  let errors = 0
  const composer = await compose({
    onSubgraphError: () => { errors++ },
    subgraphs: [{
      server: {
        host: service.host,
        composeEndpoint: '/get-introspection',
        graphqlEndpoint: '/graphql'
      }
    }]
  })

  assert.strictEqual(errors, 0)
  assert.strictEqual(composer.toSdl(), expectedSdl)
})

test('should get the schema from a subgraph service from graphqlEndpoint using introspection query', async (t) => {
  const expectedSdl = gql.schema

  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql },
      exposeIntrospection: false,
      listen: true
    }]
  )

  let errors = 0
  const composer = await compose({
    onSubgraphError: () => { errors++ },
    subgraphs: [{ server: { host: service.host } }]
  })

  assert.strictEqual(errors, 0)
  assert.strictEqual(composer.toSdl(), expectedSdl)
})

test('should get error when is not possible to get the schema from a subgraph neither from composeEndpoint and using introspection query', async (t) => {
  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql, validationRules: [NoSchemaIntrospectionCustomRule] },
      exposeIntrospection: false,
      listen: true
    }]
  )

  let errors = 0
  await compose({
    onSubgraphError: (error) => {
      const expectedErrorMessage = `Could not process schema for subgraph '#0' from '${service.host}'`
      const expectedErrorCauseMessage = `Invalid introspection schema received from ${service.host}/custom-compose, ${service.host}/graphql`
      assert.strictEqual(error.message, expectedErrorMessage)
      assert.strictEqual(error.cause.message, expectedErrorCauseMessage)
      errors++
    },
    subgraphs: [{ server: { host: service.host, composeEndpoint: '/custom-compose' } }]
  })

  assert.strictEqual(errors, 1)
})

test('should get error when composeEndpoint and graphqlEndpoint are both unreachable', async (t) => {
  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql, path: '/graph-custom-path' },
      exposeIntrospection: false,
      listen: true
    }]
  )

  let errors = 0
  await compose({
    onSubgraphError: (error) => {
      const expectedErrorMessage = `Could not process schema for subgraph '#0' from '${service.host}'`
      const expectedErrorCauseMessage = `Unable to get schema from ${service.host}/.well-known/graphql-composition (response 404) nor ${service.host}/graphql (response 404)`
      assert.strictEqual(error.message, expectedErrorMessage)
      assert.strictEqual(error.cause.message, expectedErrorCauseMessage)
      errors++
    },
    subgraphs: [{ server: { host: service.host } }]
  })

  assert.strictEqual(errors, 1)
})

test('makeGraphqlRequest should return data for a valid query', async (t) => {
  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql },
      exposeIntrospection: false,
      listen: true
    }]
  )

  const query = '{ add(x: 1, y: 2) }'
  const data = await makeGraphqlRequest({
    server: { host: service.host, graphqlEndpoint: '/graphql' },
    headers: {},
    query
  })

  assert.deepStrictEqual(data, { add: 3 })
})

test('makeGraphqlRequest should throw an error for a query with errors', async (t) => {
  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql },
      exposeIntrospection: false,
      listen: true
    }]
  )

  const query = '{ subtract(x: 1, y: 2) }' // Invalid query
  await assert.rejects(
    makeGraphqlRequest({
      server: { host: service.host, graphqlEndpoint: '/graphql' },
      headers: {},
      query
    }),
    {
      message: 'Cannot query field "subtract" on type "Query".'
    }
  )
})

test('makeGraphqlRequest should throw an error if the subgraph returns an error', async (t) => {
  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql, validationRules: [NoSchemaIntrospectionCustomRule] },
      exposeIntrospection: false,
      listen: true
    }]
  )

  const query = '{ __schema { queryType { name } } }'
  await assert.rejects(
    makeGraphqlRequest({
      server: { host: service.host, graphqlEndpoint: '/graphql' },
      headers: {},
      query
    }),
    {
      message: 'GraphQL introspection has been disabled, but the requested query contained the field "__schema".'
    }
  )
})

test('makeGraphqlRequest should throw an error if the subgraph context returns an error', async (t) => {
  const [service] = await createGraphqlServices(t,
    [{
      mercurius: {
        ...gql,
        context: () => {
          throw new Error('Error in context')
        }
      },
      exposeIntrospection: false,
      listen: true
    }]
  )

  const query = '{ add(x: 1, y: 2) }'
  await assert.rejects(
    makeGraphqlRequest({
      server: { host: service.host, graphqlEndpoint: '/graphql' },
      headers: {},
      query
    }),
    {
      message: 'Error in context'
    }
  )
})

test('makeGraphqlRequest should throw an error if the response contains an error', async (t) => {
  const [service] = await createGraphqlServices(t,
    [{
      mercurius: { ...gql },
      exposeIntrospection: false,
      listen: true
    }]
  )

  const query = '{ add(x: 1, y: "two") }' // Invalid argument type
  await assert.rejects(
    makeGraphqlRequest({
      server: { host: service.host, graphqlEndpoint: '/graphql' },
      headers: {},
      query
    }),
    {
      message: 'Int cannot represent non-integer value: "two"'
    }
  )
})
